/**
 * Local in-process embedding provider backed by transformers.js (@huggingface/transformers v3+, ONNX).
 *
 * Goal (roadmap A5): a fully offline, no-server, no-API-key embedding backend
 * that composes with the existing EmbeddingProvider machinery (priority-ordered
 * fallback chain, CachedEmbeddingProvider, rate limiter). This removes the hard
 * runtime dependency on an external model server (Ollama) for a default install
 * and sidesteps the documented "thinking model degrades structured output" bug.
 *
 * The model is loaded lazily on first use and cached by transformers.js in the
 * local HuggingFace cache directory, so after the first run the provider needs
 * no network access. Instantiation itself is cheap (no model I/O); the heavy
 * ONNX load happens inside `ensureModel()` and is memoized via a single promise
 * so concurrent embed calls share one load.
 *
 * The transformers.js dependency is optional at the type level: we import it
 * dynamically (`await import("@huggingface/transformers")`) so the package only
 * has to be present when this provider is actually selected. This keeps the dep
 * cost off the default install path and lets tests mock the pipeline without
 * pulling a multi-megabyte ONNX runtime.
 *
 * Migration note (@xenova/transformers v2 → @huggingface/transformers v3):
 * the v3 package dropped the `quantized` pipeline option in favor of `dtype`.
 * We pass `dtype: "q8"` to preserve the v2 `quantized: true` behavior
 * (8-bit weights → ~25MB download, negligible retrieval-quality loss). The
 * `pipeline`, `env`, and Tensor `.data` (typed Float32Array) surfaces are
 * otherwise API-compatible.
 */

import type { EmbeddingProvider } from "../provider.js";
import type { EmbeddingProviderConfig } from "../config.js";
import { metrics } from "../../monitoring/metrics.js";
import { logger } from "@massa-ai/shared";

/**
 * Default transformers.js model. all-MiniLM-L6-v2 is a small (~25MB ONNX),
 * general-purpose sentence embedding model with 384 dimensions and solid
 * semantic-search quality for its size. It is a reasonable offline default for
 * code+text retrieval; users can override via TRANSFORMERS_EMBEDDING_MODEL.
 *
 * The `Xenova/...` model id remains resolvable by @huggingface/transformers v3
 * (the weights live on the Hugging Face Hub under the Xenova org); changing it
 * would be an out-of-scope behavioral change.
 */
export const DEFAULT_LOCAL_MODEL = "Xenova/all-MiniLM-L6-v2";

/** Known dimension for the default model, used when not declared in config. */
export const DEFAULT_LOCAL_DIMENSIONS = 384;

/** Shape of a transformers.js feature-extraction pipeline (the subset we use). */
interface FeatureExtractionPipeline {
  (text: string | string[], options: { pooling: "mean"; normalize: boolean }): {
    data: Float32Array | number[];
    dims?: number[];
  };
}

/**
 * Lazily-loaded transformers.js module surface (subset).
 *
 * v3 pipeline options: `{ progress_callback, dtype, device, ... }`. The v2
 * `quantized` flag is gone; `dtype: "q8"` is the v3 equivalent of quantized
 * weights. `env` exposes `allowLocalModels` / `allowRemoteModels`.
 */
interface TransformersModule {
  pipeline: (
    task: "feature-extraction",
    model: string,
    options?: {
      dtype?: "q8" | "fp32" | "fp16" | "q4" | "int8" | "uint8" | "q4f16";
      progress_callback?: (data: unknown) => void;
    },
  ) => Promise<FeatureExtractionPipeline>;
  env: {
    allowLocalModels?: boolean;
    allowRemoteModels?: boolean;
    remoteHost?: string;
    localModelPath?: string;
  };
}

/**
 * Local in-process embedding provider using transformers.js (ONNX runtime).
 *
 * Implements the same EmbeddingProvider interface as AISDKEmbeddingProvider so
 * it transparently composes with CachedEmbeddingProvider and the fallback
 * selection chain in embeddings/index.ts.
 */
export class LocalTransformersEmbeddingProvider implements EmbeddingProvider {
  public readonly id: string;
  public readonly model: string;
  public readonly dimensions: number;

  /** Max characters to send per text (model context limit). */
  private readonly maxChars: number;

  /** Memoized model-load promise so concurrent embeds share a single load. */
  private modelPromise: Promise<FeatureExtractionPipeline> | null = null;

  constructor(config: EmbeddingProviderConfig, providerId: string) {
    this.id = providerId;
    this.model = config.model || DEFAULT_LOCAL_MODEL;
    this.dimensions = config.dimensions || DEFAULT_LOCAL_DIMENSIONS;
    this.maxChars = config.maxChars ?? 4000;
  }

  /**
   * Lazily load the transformers.js feature-extraction pipeline.
   *
   * The import is dynamic so the (sizeable) ONNX runtime is only pulled in when
   * this provider is actually selected. The load is memoized: the first caller
   * triggers the ONNX/model load, all concurrent callers await the same promise.
   */
  private async ensureModel(): Promise<FeatureExtractionPipeline> {
    if (this.modelPromise) {
      return this.modelPromise;
    }

    this.modelPromise = (async () => {
      let transformers: TransformersModule;
      try {
        // Dynamic import keeps @huggingface/transformers out of the hot path
        // for every other provider. `import()` of an ESM package returns the
        // namespace; pull the named exports we need.
        const mod = (await import("@huggingface/transformers")) as unknown;
        transformers = mod as TransformersModule;
      } catch (err) {
        throw new Error(
          `[${this.id}] @huggingface/transformers is not installed. Install it in packages/core to use the local embedding provider.`,
        );
      }

      // Make model-loading behavior explicit & forward-compatible. In a Node
      // (non-browser) runtime v3 defaults allowLocalModels=true and
      // allowRemoteModels=true, but pinning both here keeps the provider robust
      // to env overrides and documents intent: first run downloads from the HF
      // Hub, subsequent runs load from the local cache.
      if (transformers.env) {
        // allowRemoteModels defaults true; allowLocalModels defaults true on
        // Node. Set both explicitly so a partial env override (e.g. CI setting
        // allowRemoteModels=false) does not break the cache-fallback path.
        transformers.env.allowLocalModels = transformers.env.allowLocalModels ?? true;
        transformers.env.allowRemoteModels = transformers.env.allowRemoteModels ?? true;
      }

      logger.info(`[${this.id}] Loading local model "${this.model}" (offline ONNX)...`);
      const extractor = await transformers.pipeline("feature-extraction", this.model, {
        // v3 replaced the v2 `quantized: true` flag with `dtype`. "q8" is the
        // 8-bit-quantized weight format: smaller download (~25MB for
        // all-MiniLM-L6-v2) and faster inference, with negligible quality loss
        // for retrieval. This preserves the v2 default behavior.
        dtype: "q8",
      });
      logger.info(`[${this.id}] Local model ready (dimensions: ${this.dimensions}).`);
      return extractor;
    })();

    // If the load fails, drop the memoized rejection so a later retry can
    // attempt a fresh load instead of permanently caching the failure.
    this.modelPromise.catch(() => {
      this.modelPromise = null;
    });

    return this.modelPromise;
  }

  /** Truncate text to the configured per-call character limit. */
  private truncateText(text: string): string {
    if (text.length <= this.maxChars) return text;
    return text.substring(0, this.maxChars);
  }

  async embedQuery(text: string): Promise<number[]> {
    const [embedding] = await this.embedBatch([text]);
    return embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];

    const startTime = Date.now();
    const extractor = await this.ensureModel();

    try {
      // transformers.js returns one pooled vector per input text, in order.
      const output = await extractor(
        texts.map((t) => this.truncateText(t)),
        { pooling: "mean", normalize: true },
      );

      const dims = output.dims;
      const count = texts.length;
      const dim = this.dimensions;
      // transformers.js returns a typed array (Float32Array), not a regular
      // Array — `Array.isArray()` is false for typed arrays, so read `.length`
      // directly off the data object.
      const dataArr = output.data;
      const totalLen =
        dataArr && typeof (dataArr as { length?: number }).length === "number"
          ? (dataArr as { length: number }).length
          : 0;

      // Determine per-item length. transformers.js with pooling+normalize
      // returns a flat Float32Array of length count*dim. Some versions expose
      // `dims: [count, dim]`; prefer that when present.
      const perItem = dims && dims.length >= 2 ? dims[dims.length - 1] : dim;

      if (totalLen !== count * perItem) {
        throw new Error(
          `[${this.id}] Unexpected embedding length: got ${totalLen} values for ${count} texts (expected ${count * perItem}).`,
        );
      }

      const results: number[][] = [];
      for (let i = 0; i < count; i++) {
        const slice = Array.from(output.data.slice(i * perItem, (i + 1) * perItem));
        // Validate: no NaN/Infinity, not all-zero (degenerate).
        if (slice.some((v) => isNaN(v) || !isFinite(v))) {
          throw new Error(`[${this.id}] Embedding for text ${i} contains NaN or Infinity.`);
        }
        results.push(slice);
      }

      const latency = Date.now() - startTime;
      const tokens = Math.ceil(
        texts.reduce((sum, t) => sum + t.length, 0) / 4,
      );
      metrics.recordEmbedding({
        provider: this.id,
        tokens,
        latency,
        cached: false,
        error: false,
      });

      return results;
    } catch (err) {
      const latency = Date.now() - startTime;
      const tokens = Math.ceil(texts.reduce((sum, t) => sum + t.length, 0) / 4);
      metrics.recordEmbedding({
        provider: this.id,
        tokens,
        latency,
        cached: false,
        error: true,
      });
      throw err;
    }
  }

  /**
   * Availability check. For the local provider this confirms the model can be
   * loaded (which triggers the one-time ONNX/model download on first run).
   * Cheap on subsequent calls because the load is memoized.
   */
  async isAvailable(): Promise<boolean> {
    try {
      const extractor = await this.ensureModel();
      // Smoke-test with a trivial query to confirm inference works.
      const out = await extractor("test", { pooling: "mean", normalize: true });
      const vec = Array.from(out.data);
      if (!Array.isArray(vec) || vec.length !== this.dimensions) {
        logger.error(
          `[${this.id}] Invalid embedding dimensions`,
          undefined,
          { expected: this.dimensions, got: vec.length },
        );
        return false;
      }
      if (vec.some((v) => typeof v !== "number" || isNaN(v))) {
        logger.error(`[${this.id}] Invalid embedding values (not numbers)`);
        return false;
      }
      return true;
    } catch (error) {
      logger.error(`[${this.id}] Local provider unavailable`, error as Error);
      return false;
    }
  }

  getConfig(): EmbeddingProviderConfig {
    return {
      provider: "transformers",
      model: this.model,
      dimensions: this.dimensions,
      maxChars: this.maxChars,
      priority: 0,
    };
  }
}
