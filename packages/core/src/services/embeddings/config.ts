/**
 * Embedding Provider Configuration
 *
 * Multi-provider configuration using Vercel AI SDK
 * Supports: OpenAI, Google, Cohere, Ollama (local), Mistral
 */

import { parsePositiveIntEnv } from "@massa-ai/shared/config";

export interface EmbeddingProviderConfig {
  provider: "openai" | "google" | "cohere" | "ollama" | "mistral" | "vercel" | "custom" | "litellm" | string;
  model: string;
  apiKey?: string;
  baseURL?: string; // For Ollama local server
  dimensions?: number; // Auto-detect if not specified
  priority: number; // Lower = higher priority (1 = try first)
  timeout?: number; // milliseconds
  maxRetries?: number;
  maxChars?: number; // Max characters to send per text (model-specific context limit)
  rateLimits?: {
    requestsPerMinute?: number; // RPM limit
    tokensPerMinute?: number; // TPM limit (approximate)
    requestsPerDay?: number; // RPD limit
    batchSize?: number; // Max texts per batch
    batchDelayMs?: number; // Delay between batches
  };
}

/**
 * Get rate limits from environment variables for a provider
 * 
 * Supports provider-specific env vars:
 * - {PROVIDER}_EMBEDDING_RPM - Requests per minute
 * - {PROVIDER}_EMBEDDING_TPM - Tokens per minute  
 * - {PROVIDER}_EMBEDDING_RPD - Requests per day
 * - {PROVIDER}_EMBEDDING_BATCH_SIZE - Max texts per batch
 * - {PROVIDER}_EMBEDDING_BATCH_DELAY - Delay between batches (ms)
 * 
 * Falls back to generic EMBEDDING_* vars if provider-specific not set
 */
export function getRateLimits(providerPrefix: string): EmbeddingProviderConfig['rateLimits'] {
  // Prefix-specific var wins; empty/unset falls back to the generic
  // EMBEDDING_* var (so `||`, not `??`, to match the original fall-through for
  // an explicitly-empty prefix var). The single winning raw value is then
  // handed to parsePositiveIntEnv, which fixes the falsy-`0` footgun of
  // `Number(env) || ...`: an explicit positive int survives, while
  // unset/garbage/non-integer floors to 0. `batchDelayMs` opts into
  // `{ allowZero: true }` because a zero delay is a legitimate "no delay
  // between batches" intent.
  const rpmRaw = process.env[`${providerPrefix}_EMBEDDING_RPM`] || process.env.EMBEDDING_RPM;
  const tpmRaw = process.env[`${providerPrefix}_EMBEDDING_TPM`] || process.env.EMBEDDING_TPM;
  const rpdRaw = process.env[`${providerPrefix}_EMBEDDING_RPD`] || process.env.EMBEDDING_RPD;
  const batchSizeRaw =
    process.env[`${providerPrefix}_EMBEDDING_BATCH_SIZE`] || process.env.EMBEDDING_BATCH_SIZE;
  const batchDelayRaw =
    process.env[`${providerPrefix}_EMBEDDING_BATCH_DELAY`] || process.env.EMBEDDING_BATCH_DELAY;

  const rpm = parsePositiveIntEnv(rpmRaw, 0);
  const tpm = parsePositiveIntEnv(tpmRaw, 0);
  const rpd = parsePositiveIntEnv(rpdRaw, 0);
  const batchSize = parsePositiveIntEnv(batchSizeRaw, 0);
  const batchDelayMs = parsePositiveIntEnv(batchDelayRaw, 0, { allowZero: true });

  // A knob counts as "configured" when its raw winner is a non-empty string
  // AND the helper accepted it (positive int, or a deliberate 0 for
  // batchDelayMs via allowZero). This keeps a garbage value from masquerading
  // as configured while still honoring an explicit batchDelayMs=0.
  const isConfigured = (raw: string | undefined, parsed: number): boolean =>
    raw !== undefined && raw !== "" && parsed > 0;

  const rpmOn = isConfigured(rpmRaw, rpm);
  const tpmOn = isConfigured(tpmRaw, tpm);
  const rpdOn = isConfigured(rpdRaw, rpd);
  const batchSizeOn = isConfigured(batchSizeRaw, batchSize);
  // batchDelayMs=0 is a deliberate no-delay value, so 0 counts as configured.
  const batchDelayOn =
    batchDelayRaw !== undefined &&
    batchDelayRaw !== "" &&
    (batchDelayMs > 0 || Number(batchDelayRaw) === 0);

  // Only return rateLimits if at least one knob is configured.
  if (!(rpmOn || tpmOn || rpdOn || batchSizeOn || batchDelayOn)) {
    return undefined;
  }

  return {
    requestsPerMinute: rpmOn ? rpm : undefined,
    tokensPerMinute: tpmOn ? tpm : undefined,
    requestsPerDay: rpdOn ? rpd : undefined,
    batchSize: batchSizeOn ? batchSize : undefined,
    // Preserve an explicit "0" (no-delay intent); otherwise emit the parsed
    // positive value, or undefined when unconfigured.
    batchDelayMs: batchDelayOn
      ? Number(batchDelayRaw) === 0
        ? 0
        : batchDelayMs
      : undefined,
  };
}

export function getMaxChars(providerPrefix: string, model: string): number {
  const fromEnv = parsePositiveIntEnv(
    process.env[`${providerPrefix}_EMBEDDING_MAX_CHARS`] || process.env.EMBEDDING_MAX_CHARS,
    0,
  );
  if (fromEnv) return fromEnv;

  const lower = model.toLowerCase();
  // Strip common namespace prefixes (e.g. "alibaba/qwen3-embedding-8b" → "qwen3-embedding-8b")
  const bare = lower.includes("/") ? lower.split("/").pop()! : lower;
  if (bare.startsWith("qwen3-embedding")) return 8000;
  if (bare.startsWith("bge-m3")) return 4000;
  if (bare.startsWith("text-embedding-3")) return 8000;
  if (bare.startsWith("gemini-embedding")) return 8000;
  if (bare.startsWith("mistral-embed") || bare.startsWith("codestral-embed")) return 8000;
  if (bare.startsWith("embed-v-4")) return 500000;
  // transformers.js local models (all-MiniLM-L6-v2 etc.) have a 512-token
  // context window (~2000 chars at ~4 chars/token with headroom).
  if (bare.includes("all-minilm") || bare.includes("minilm")) return 2000;
  return 4000;
}

/**
 * Provider configurations sorted by priority
 *
 * Priority order (default):
 * 1. Ollama (local, low latency) - ENABLED
 * 2. Mistral Text (general purpose, good quality) - ENABLED
 * 3. Mistral Code (specialized for code) - ENABLED
 * 4. Google (API key required) - ENABLED if GOOGLE_API_KEY is set
 * 
 * Override with EMBEDDING_PROVIDER env var:
 * - EMBEDDING_PROVIDER=google - Force Google
 * - EMBEDDING_PROVIDER=ollama - Force Ollama
 * - EMBEDDING_PROVIDER=mistral - Force Mistral
 * 
 * Rate Limiting (all providers):
 * Set provider-specific vars (e.g., GOOGLE_EMBEDDING_RPM) or generic vars (e.g., EMBEDDING_RPM)
 * 
 * DISABLED (no API keys configured):
 * - OpenAI (no API key)
 * - Cohere (no API key)
 */
export const embeddingProviders: Record<string, EmbeddingProviderConfig> = {
  // === ENABLED PROVIDERS ===

  google: (() => {
    const model = process.env.GOOGLE_EMBEDDING_MODEL || "gemini-embedding-001";
    return {
      provider: "google",
      model,
      apiKey: process.env.GOOGLE_GENERATIVE_AI_API_KEY || process.env.GOOGLE_API_KEY,
      dimensions: 3072,
      priority: process.env.EMBEDDING_PROVIDER === "google" ? 1 : 10,
      timeout: 60000,
      maxRetries: 3,
      maxChars: getMaxChars("GOOGLE", model),
      rateLimits: getRateLimits("GOOGLE"),
    };
  })(),

  vercel: (() => {
    const model = process.env.VERCEL_EMBEDDING_MODEL || "alibaba/qwen3-embedding-8b";
    return {
      provider: "vercel",
      model,
      apiKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_AI_GATEWAY_API_KEY,
      baseURL: process.env.VERCEL_AI_GATEWAY_URL,
      dimensions: Number(process.env.VERCEL_EMBEDDING_DIMENSIONS || "4096"),
      priority: process.env.EMBEDDING_PROVIDER === "vercel" ? 1 : 20,
      timeout: 60000,
      maxRetries: 3,
      maxChars: getMaxChars("VERCEL", model),
      rateLimits: getRateLimits("VERCEL"),
    };
  })(),

  ollama: (() => {
    const model = process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b";
    return {
      provider: "ollama",
      model,
      baseURL: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      dimensions: Number(process.env.OLLAMA_EMBEDDING_DIMENSIONS || "4096"),
      priority: process.env.EMBEDDING_PROVIDER === "ollama" || !process.env.EMBEDDING_PROVIDER ? 1 : 50, // Highest priority by default
      timeout: 300000, // 5 minutes (local can be slow on first run)
      maxRetries: 2,
      maxChars: getMaxChars("OLLAMA", model),
      rateLimits: getRateLimits("OLLAMA"),
    };
  })(),

  mistralText: (() => {
    const model = process.env.MISTRAL_TEXT_EMBEDDING_MODEL || "mistral-embed";
    return {
      provider: "mistral",
      model,
      apiKey: process.env.MISTRAL_API_KEY,
      dimensions: 1024,
      priority: process.env.EMBEDDING_PROVIDER === "mistral" ? 1 : 2, // Fallback to Mistral if Ollama is unavailable
      timeout: 60000,
      maxRetries: 3,
      maxChars: getMaxChars("MISTRAL", model),
      rateLimits: getRateLimits("MISTRAL"),
    };
  })(),

  mistralCode: (() => {
    const model = process.env.MISTRAL_CODE_EMBEDDING_MODEL || "codestral-embed";
    return {
      provider: "mistral",
      model,
      apiKey: process.env.MISTRAL_API_KEY,
      dimensions: 1536, // Default, can go up to 3072
      priority: process.env.EMBEDDING_PROVIDER === "mistral" ? 1 : 3,
      timeout: 60000,
      maxRetries: 3,
      maxChars: getMaxChars("MISTRAL", model),
      rateLimits: getRateLimits("MISTRAL"),
    };
  })(),
  litellm: (() => {
    const model = process.env.LITELLM_EMBEDDING_MODEL || "embed-v-4-0";
    return {
      provider: "litellm",
      model,
      apiKey: process.env.LITELLM_API_KEY,
      baseURL: process.env.LITELLM_BASE_URL,
      dimensions: Number(process.env.LITELLM_EMBEDDING_DIMENSIONS || "1024"),
      priority: process.env.EMBEDDING_PROVIDER === "litellm" ? 1 : 15,
      timeout: Number(process.env.LITELLM_EMBEDDING_TIMEOUT || "60000"),
      maxRetries: 3,
      maxChars: getMaxChars("LITELLM", model),
      rateLimits: getRateLimits("LITELLM"),
    };
  })(),

  custom: (() => {
    const model = process.env.CUSTOM_EMBEDDING_MODEL || "text-embedding-3-small";
    return {
      provider: "custom",
      model,
      apiKey: process.env.CUSTOM_API_KEY,
      baseURL: process.env.CUSTOM_EMBEDDING_BASE_URL,
      dimensions: Number(process.env.CUSTOM_EMBEDDING_DIMENSIONS || "1536"),
      priority: process.env.EMBEDDING_PROVIDER === "custom" ? 1 : 100,
      timeout: Number(process.env.CUSTOM_EMBEDDING_TIMEOUT || "60000"),
      maxRetries: 3,
      maxChars: getMaxChars("CUSTOM", model),
      rateLimits: getRateLimits("CUSTOM"),
    };
  })(),

  /**
   * Local in-process provider (roadmap A5): transformers.js ONNX runtime, no
   * model server, no API key, fully offline after first model download.
   *
   * OPT-IN by default (priority 100) so the existing Ollama default path is
   * untouched. Select it with `EMBEDDING_PROVIDER=transformers` (priority 1).
   * `transformers` is the canonical id; `local` is accepted as an alias in
   * the provider map for ergonomics.
   */
  transformers: (() => {
    const model =
      process.env.TRANSFORMERS_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
    return {
      provider: "transformers",
      model,
      dimensions: Number(
        process.env.TRANSFORMERS_EMBEDDING_DIMENSIONS || "384",
      ),
      priority: process.env.EMBEDDING_PROVIDER === "transformers" ? 1 : 100,
      timeout: 300000, // 5 minutes (first-run model download can be slow)
      maxRetries: 1,
      maxChars: getMaxChars("TRANSFORMERS", model),
      rateLimits: getRateLimits("TRANSFORMERS"),
    };
  })(),

  /**
   * `local` alias → same backing config as `transformers`. Kept as a separate
   * entry (not a self-reference, which can't run during object construction)
   * so `EMBEDDING_PROVIDER=local` resolves in the fallback chain.
   */
  local: (() => {
    const model =
      process.env.TRANSFORMERS_EMBEDDING_MODEL || "Xenova/all-MiniLM-L6-v2";
    return {
      provider: "transformers",
      model,
      dimensions: Number(
        process.env.TRANSFORMERS_EMBEDDING_DIMENSIONS || "384",
      ),
      priority: process.env.EMBEDDING_PROVIDER === "local" ? 1 : 100,
      timeout: 300000,
      maxRetries: 1,
      maxChars: getMaxChars("TRANSFORMERS", model),
      rateLimits: getRateLimits("TRANSFORMERS"),
    };
  })(),

  // === DISABLED PROVIDERS (uncomment and configure to enable) ===
  
  /*

  openai: {
    provider: "openai",
    model: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
    apiKey: process.env.OPENAI_API_KEY,
    dimensions: 1536,
    priority: 10,
    timeout: 60000, // 60 seconds
    maxRetries: 3,
  },

  cohere: {
    provider: "cohere",
    model: process.env.COHERE_EMBEDDING_MODEL || "embed-english-v3.0",
    apiKey: process.env.COHERE_API_KEY,
    dimensions: 1024,
    priority: 10,
    timeout: 60000,
    maxRetries: 3,
  },
  */
};

/**
 * Get providers sorted by priority
 */
export function getProvidersByPriority(): Array<
  [string, EmbeddingProviderConfig]
> {
  return Object.entries(embeddingProviders).sort(
    ([, a], [, b]) => a.priority - b.priority,
  );
}

/**
 * Check if provider has required API key or is a local provider
 */
export function hasApiKey(providerName: string): boolean {
  const config = embeddingProviders[providerName];
  
  if (!config) {
    return false;
  }

  // Ollama doesn't need an API key (local)
  if (config.provider === "ollama") {
    return true;
  }

  // transformers.js local provider runs in-process; no API key needed.
  if (config.provider === "transformers") {
    return true;
  }

  // Mistral requires API key
  if (config.provider === "mistral") {
    return !!config.apiKey;
  }

  // Vercel AI Gateway — requires AI_GATEWAY_API_KEY
  if (config.provider === "vercel") {
    return !!config.apiKey;
  }

  // LiteLLM proxy — requires baseURL at minimum (API key optional)
  if (config.provider === "litellm") {
    return !!config.baseURL;
  }

  // Custom OpenAI-compatible provider — requires baseURL at minimum
  if (config.provider === "custom") {
    return !!config.baseURL;
  }

  // All other providers need API keys
  return !!config.apiKey;
}

/**
 * Retry configuration (OpenClaw pattern)
 */
export const RETRY_CONFIG = {
  MAX_ATTEMPTS: 3,
  BASE_DELAY_MS: 500,
  MAX_DELAY_MS: 8000,
  BACKOFF_MULTIPLIER: 2,
};

/**
 * Batching configuration (OpenClaw pattern)
 */
export const BATCH_CONFIG = {
  MAX_TOKENS: 8000,
  APPROX_CHARS_PER_TOKEN: 4,
  CONCURRENCY: 4,
};
