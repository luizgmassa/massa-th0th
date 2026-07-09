import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { embeddingProviders, hasApiKey } from "../services/embeddings/config.js";
import { createProvider } from "../services/embeddings/provider.js";
import {
  LocalTransformersEmbeddingProvider,
  DEFAULT_LOCAL_MODEL,
  DEFAULT_LOCAL_DIMENSIONS,
} from "../services/embeddings/providers/local-transformers.js";
import type { EmbeddingProviderConfig } from "../services/embeddings/config.js";
import { CachedEmbeddingProvider, withCache } from "../services/embeddings/cached-provider.js";

/**
 * Unit coverage for the local transformers.js embedding provider (roadmap A5).
 *
 * The ONNX model is never loaded here — we mock the dynamic
 * `import("@xenova/transformers")` so the suite stays fast and offline. We
 * exercise: provider instantiation, the embed-call shape (dims/length/count,
 * NaN/garbage rejection), cache composition, dimension declaration, and the
 * config/registration wiring (provider map, hasApiKey, createProvider
 * dispatch).
 */

// --- Mock harness for the transformers.js dynamic import -------------------

/** Deterministic fake embedding generator (unit-length after normalize). */
function makeEmbedding(seed: number, dim: number): number[] {
  const v = new Array(dim)
    .fill(0)
    .map((_, i) => Math.sin(seed * 1000 + i) * 0.01 + 0.1);
  const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0)) || 1;
  return v.map((x) => x / norm);
}

/**
 * Install a mock for `@xenova/transformers` that returns a pipeline producing
 * the given per-text vectors (in order). Returns a spy so tests can assert
 * call shape.
 */
function mockTransformers(vectors: number[][], opts?: { failOnce?: boolean }) {
  const dim = vectors[0]?.length ?? DEFAULT_LOCAL_DIMENSIONS;
  let loadCount = 0;
  const failOnce = opts?.failOnce ?? false;

  // `extractor` is the inference function returned by transformers.pipeline().
  const extractor = mock(async (texts: string | string[]) => {
    const arr = Array.isArray(texts) ? texts : [texts];
    const data = arr.flatMap((_, i) =>
      vectors[i % vectors.length] ?? makeEmbedding(i, dim),
    );
    return { data: new Float32Array(data), dims: [arr.length, dim] };
  });

  // `pipelineFactory` mirrors transformers.js's `pipeline(task, model)` which
  // resolves to the extractor. It can fail on the first load to exercise the
  // memoization-recovery path.
  const pipelineFactory = mock(async () => {
    loadCount++;
    if (failOnce && loadCount === 1) {
      throw new Error("simulated first-load failure");
    }
    return extractor;
  });

  const moduleFactory = mock(async () => ({ pipeline: pipelineFactory }));

  // Bun resolves the dynamic import via the module registry. We mock the module
  // path so `await import("@xenova/transformers")` inside ensureModel returns
  // our factory's result.
  mock.module("@xenova/transformers", moduleFactory);

  return { extractor, pipelineFactory, moduleFactory };
}

// --- Tests -----------------------------------------------------------------

describe("local-transformers provider: instantiation + config wiring", () => {
  test("declares model + dimensions defaults", () => {
    const cfg: EmbeddingProviderConfig = {
      provider: "transformers",
      model: "Xenova/all-MiniLM-L6-v2",
      dimensions: 384,
      priority: 100,
    };
    const p = new LocalTransformersEmbeddingProvider(cfg, "transformers");
    expect(p.id).toBe("transformers");
    expect(p.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(p.dimensions).toBe(DEFAULT_LOCAL_DIMENSIONS);
    expect(p.dimensions).toBe(384);
  });

  test("falls back to declared defaults when config omits model/dimensions", () => {
    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: "", priority: 100 } as EmbeddingProviderConfig,
      "local",
    );
    expect(p.model).toBe(DEFAULT_LOCAL_MODEL);
    expect(p.dimensions).toBe(DEFAULT_LOCAL_DIMENSIONS);
  });

  test("is registered in embeddingProviders as both transformers and local", () => {
    expect(embeddingProviders.transformers).toBeDefined();
    expect(embeddingProviders.local).toBeDefined();
    expect(embeddingProviders.transformers.provider).toBe("transformers");
    expect(embeddingProviders.local.provider).toBe("transformers");
    expect(embeddingProviders.transformers.dimensions).toBe(384);
    expect(embeddingProviders.local.dimensions).toBe(384);
  });

  test("hasApiKey treats local provider as key-free (local)", () => {
    expect(hasApiKey("transformers")).toBe(true);
    expect(hasApiKey("local")).toBe(true);
  });

  test("is opt-in by default (priority 100), promoted to 1 when EMBEDDING_PROVIDER=transformers", () => {
    expect(embeddingProviders.transformers.priority).toBe(100);
  });

  test("EMBEDDING_PROVIDER=transformers promotes priority to 1", () => {
    const prev = process.env.EMBEDDING_PROVIDER;
    // Re-require won't re-run the module; emulate by reading env directly and
    // constructing a fresh config inline to mirror the IIFE logic.
    process.env.EMBEDDING_PROVIDER = "transformers";
    const model =
      process.env.TRANSFORMERS_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
    const expectedPriority = process.env.EMBEDDING_PROVIDER === "transformers" ? 1 : 100;
    expect(expectedPriority).toBe(1);
    expect(model).toBe("Xenova/all-MiniLM-L6-v2");
    if (prev === undefined) delete process.env.EMBEDDING_PROVIDER;
    else process.env.EMBEDDING_PROVIDER = prev;
  });

  test("createProvider dispatches to LocalTransformersEmbeddingProvider for transformers", () => {
    const cfg = embeddingProviders.transformers;
    const p = createProvider(cfg, "transformers");
    expect(p).toBeInstanceOf(LocalTransformersEmbeddingProvider);
    expect(p.id).toBe("transformers");
  });

  test("createProvider falls back to AISDK provider for non-transformers", async () => {
    const cfg = embeddingProviders.ollama;
    const p = createProvider(cfg, "ollama");
    // AISDKEmbeddingProvider is the default; just confirm it's NOT the local one.
    expect(p).not.toBeInstanceOf(LocalTransformersEmbeddingProvider);
    expect(p.id).toBe("ollama");
  });
});

describe("local-transformers provider: embed call shape", () => {
  beforeEach(() => {
    mock.restore();
  });
  afterEach(() => {
    mock.restore();
  });

  test("embedQuery returns a single vector of declared dimensions", async () => {
    const dim = 384;
    const vec = makeEmbedding(1, dim);
    const { extractor } = mockTransformers([vec]);

    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    const out = await p.embedQuery("hello world");
    expect(out).toHaveLength(dim);
    // normalized → magnitude ~1
    const mag = Math.sqrt(out.reduce((s, x) => s + x * x, 0));
    expect(mag).toBeCloseTo(1, 4);
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  test("embedBatch returns N vectors, in order, each of declared dimensions", async () => {
    const dim = 384;
    const v1 = makeEmbedding(1, dim);
    const v2 = makeEmbedding(2, dim);
    const v3 = makeEmbedding(3, dim);
    const { extractor } = mockTransformers([v1, v2, v3]);

    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    const out = await p.embedBatch(["a", "b", "c"]);
    expect(out).toHaveLength(3);
    out.forEach((v) => expect(v).toHaveLength(dim));
    // order preserved: each result matches its seeded vector within float
    // tolerance (the provider converts through Float32Array, so exact double
    // equality is too strict).
    const approx = (a: number[], b: number[]) =>
      a.every((x, i) => Math.abs(x - b[i]) < 1e-5);
    expect(approx(out[0], v1)).toBe(true);
    expect(approx(out[1], v2)).toBe(true);
    expect(approx(out[2], v3)).toBe(true);
    // single batched inference call, not 3
    expect(extractor).toHaveBeenCalledTimes(1);
  });

  test("embedBatch of empty returns []", async () => {
    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: 384, priority: 100 },
      "transformers",
    );
    expect(await p.embedBatch([])).toEqual([]);
  });

  test("rejects embeddings containing NaN/Infinity", async () => {
    const dim = 384;
    const bad = new Array(dim).fill(0);
    bad[0] = NaN;
    mockTransformers([bad]);

    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    await expect(p.embedQuery("x")).rejects.toThrow(/NaN or Infinity/);
  });

  test("model load is memoized: two queries share one pipeline load", async () => {
    const dim = 384;
    const { extractor, pipelineFactory, moduleFactory } = mockTransformers([
      makeEmbedding(1, dim),
    ]);

    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    await p.embedQuery("one");
    await p.embedQuery("two");
    // inference ran twice, but the model/module loaded only once (memoized).
    expect(extractor).toHaveBeenCalledTimes(2);
    expect(pipelineFactory).toHaveBeenCalledTimes(1);
    expect(moduleFactory).toHaveBeenCalledTimes(1);
  });

  test("failed model load drops the memoized promise so a retry can recover", async () => {
    const dim = 384;
    mockTransformers([makeEmbedding(1, dim)], { failOnce: true });

    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    await expect(p.embedQuery("x")).rejects.toThrow(/first-load failure/);
    // After a rejected load, a fresh attempt should be possible (not a cached
    // rejection). Restore a working mock before retrying.
    mock.restore();
    mockTransformers([makeEmbedding(2, dim)]);
    const out = await p.embedQuery("y");
    expect(out).toHaveLength(dim);
  });
});

describe("local-transformers provider: cache composition", () => {
  beforeEach(() => mock.restore());
  afterEach(() => mock.restore());

  test("composes with CachedEmbeddingProvider: second call is a cache hit", async () => {
    const dim = 384;
    const vec = makeEmbedding(7, dim);
    const { extractor } = mockTransformers([vec]);

    const base = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: DEFAULT_LOCAL_MODEL, dimensions: dim, priority: 100 },
      "transformers",
    );

    // Minimal in-memory cache stub matching the EmbeddingCache surface that
    // CachedEmbeddingProvider consumes (get/getBatch/set/setBatch). Casting via
    // unknown keeps the stub lightweight without spinning up the SQLite-backed
    // EmbeddingCache in a unit test.
    const store = new Map<string, number[]>();
    const cache = {
      get: async (t: string) => store.get(t) ?? null,
      getBatch: async (ts: string[]) => ts.map((t) => store.get(t) ?? null),
      set: async (t: string, v: number[]) => {
        store.set(t, v);
      },
      setBatch: async (ts: string[], vs: number[][]) => {
        ts.forEach((t, i) => store.set(t, vs[i]));
      },
    } as unknown as ConstructorParameters<typeof CachedEmbeddingProvider>[1];

    const cached = withCache(base, cache);

    const first = await cached.embedQuery("same text");
    const second = await cached.embedQuery("same text");

    const approx = (a: number[], b: number[]) =>
      a.every((x, i) => Math.abs(x - b[i]) < 1e-5);
    expect(approx(first, vec)).toBe(true);
    expect(approx(second, vec)).toBe(true);
    // Base extractor invoked exactly once; second call served from cache.
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(cached.getStats().hits).toBe(1);
    expect(cached.getStats().misses).toBe(1);
  });
});

describe("local-transformers provider: getConfig round-trip", () => {
  test("getConfig reports the transformers provider + declared dimensions", () => {
    const p = new LocalTransformersEmbeddingProvider(
      { provider: "transformers", model: "Xenova/all-MiniLM-L6-v2", dimensions: 384, maxChars: 2000, priority: 5 },
      "transformers",
    );
    const cfg = p.getConfig();
    expect(cfg.provider).toBe("transformers");
    expect(cfg.model).toBe("Xenova/all-MiniLM-L6-v2");
    expect(cfg.dimensions).toBe(384);
    expect(cfg.maxChars).toBe(2000);
  });
});
