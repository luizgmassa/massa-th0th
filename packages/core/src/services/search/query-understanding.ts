/**
 * Query Understanding (Phase 2, plan item 4).
 *
 * Expands the user's query before the vector/keyword fan-out:
 *   1. `rewriteQuery` — LLM produces structured `{ expansions, keywords }`
 *      via `llmObject` + a zod schema (rejects malformed/empty output).
 *   2. `hyde` — LLM produces a hypothetical implementation paragraph, which
 *      is then **embedded with the existing EmbeddingService** (no new
 *      provider spawned) and returned as an extra vector-query stream.
 *
 * Contract (cross-cutting §1 + spec NF1):
 *   - Default-off via `config.search.queryUnderstanding.enabled`.
 *   - Silent degradation: on any LLM throw / timeout / disabled, `understand()`
 *     returns `null` → caller falls through to the original 2-stream search.
 *     NEVER blocks search, NEVER throws to the caller.
 *   - HyDE's embed call runs ONLY after the LLM step succeeds (no wasted work).
 *
 * Pure over its inputs + the injected `llm` handle + the injected `embedFn`,
 * so tests inject fakes without touching config or network.
 */

import { z } from "zod";
import { config, logger } from "@massa-th0th/shared";
import { sanitizeFTS5Query } from "@massa-th0th/shared";
import { llm as llmHandle } from "../memory/llm-client.js";
import { EmbeddingService } from "../embeddings/index.js";

// ─── Zod schema (R1, P2-REWRITE-03) ────────────────────────────────────────────

/** Non-empty arrays, bounded length. `llmObject` returns `{ok:false}` on zod failure. */
export const QueryRewriteSchema = z.object({
  expansions: z.array(z.string().min(1)).min(1).max(8),
  keywords: z.array(z.string().min(1)).min(1).max(12),
});

export type QueryRewrite = z.infer<typeof QueryRewriteSchema>;

// ─── Injectable surfaces (mirror Phase-1 consolidator's LlmSurface) ───────────

/** Injectable LLM surface (matches the `llm` export from llm-client.ts). */
export interface QueryLlmSurface {
  complete(
    prompt: string,
    opts?: { system?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; value?: string; error?: string }>;
  object<T>(
    prompt: string,
    schema: z.ZodSchema<T>,
    opts?: { system?: string; timeoutMs?: number },
  ): Promise<{ ok: boolean; value?: T; error?: string }>;
  isEnabled(): boolean;
}

/** Inject an embed function so tests don't touch the EmbeddingService singleton. */
export type EmbedFn = (text: string) => Promise<number[]>;

// ─── Result shape ──────────────────────────────────────────────────────────────

export interface QueryUnderstandingResult {
  expansions: string[];
  keywords: string[];
  /** Null when HyDE is disabled, the LLM step failed, or the embed call threw. */
  hydeVector: number[] | null;
}

// ─── Prompt templates ─────────────────────────────────────────────────────────

const REWRITE_SYSTEM =
  "You expand a search query for a code-knowledge retrieval system. " +
  "Return ONLY a JSON object with two non-empty string arrays: " +
  "`expansions` (1-8 paraphrases / synonym phrasings of the query) and " +
  "`keywords` (1-12 distinctive terms likely present in the target document). " +
  "No prose, no markdown.";

function rewritePrompt(query: string): string {
  return `Query: ${query}\nReturn the JSON object now.`;
}

const HYDE_SYSTEM =
  "You write a hypothetical implementation paragraph that a code-knowledge " +
  "search system will embed and match against real documents. Write ONE " +
  "concise paragraph (3-6 sentences) of plausible implementation detail " +
  "(types, function signatures, control flow) that a relevant document would " +
  "contain. No preamble, no markdown.";

function hydePrompt(query: string): string {
  return `Query: ${query}\nWrite the hypothetical implementation paragraph.`;
}

// ─── Standalone fns (unit-testable with a fake surface) ───────────────────────

/**
 * Rewrite the query into structured expansions + keywords. Returns `null`
 * when the LLM is disabled, times out, throws, or returns zod-invalid output
 * (P2-REWRITE-01/02/03). Never throws.
 */
export async function rewriteQuery(
  query: string,
  surface: QueryLlmSurface,
  opts: { timeoutMs?: number } = {},
): Promise<QueryRewrite | null> {
  const res = await surface.object(rewritePrompt(query), QueryRewriteSchema, {
    system: REWRITE_SYSTEM,
    timeoutMs: opts.timeoutMs,
  });
  if (!res.ok || !res.value) return null;
  // Defensive: schema guarantees non-empty arrays, but double-check in case a
  // future schema relaxation lets empties through.
  if (
    !Array.isArray(res.value.expansions) ||
    res.value.expansions.length === 0 ||
    !Array.isArray(res.value.keywords) ||
    res.value.keywords.length === 0
  ) {
    return null;
  }
  return res.value;
}

/**
 * Generate a hypothetical implementation paragraph and embed it. The embed
 * call runs ONLY if the LLM step succeeded (P2-HYDE-02). Uses the **existing**
 * EmbeddingService via the injected `embedFn` (P2-HYDE-03). Returns `null` on
 * any failure; never throws.
 */
export async function hyde(
  query: string,
  surface: QueryLlmSurface,
  embedFn: EmbedFn,
  opts: { timeoutMs?: number } = {},
): Promise<number[] | null> {
  const text = await surface.complete(hydePrompt(query), {
    system: HYDE_SYSTEM,
    timeoutMs: opts.timeoutMs,
  });
  if (!text.ok || !text.value || text.value.trim().length === 0) {
    // LLM disabled / timed out / threw → do NOT call embedFn (no wasted work).
    return null;
  }
  try {
    const vec = await embedFn(text.value);
    if (!Array.isArray(vec) || vec.length === 0) return null;
    return vec;
  } catch (e) {
    // Embeddings provider unavailable (e.g. Ollama down) → skip HyDE.
    logger.warn("hyde embed failed — skipping HyDE stream", {
      error: (e as Error).message,
    });
    return null;
  }
}

// ─── Bounded cache (R5, P2-CACHE-01/02) ───────────────────────────────────────

interface CacheEntry {
  value: QueryUnderstandingResult;
  expiresAt: number;
}

class QueryUnderstandingCache {
  private store = new Map<string, CacheEntry>();
  private ttlMs: number;
  private maxSize: number;

  constructor(ttlMs: number, maxSize: number) {
    this.ttlMs = ttlMs;
    this.maxSize = maxSize;
  }

  get(key: string): QueryUnderstandingResult | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (Date.now() >= entry.expiresAt) {
      this.store.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: QueryUnderstandingResult): void {
    // Evict the entry with the earliest expiresAt when over the cap.
    // (TTL-based eviction rather than true LRU — no new dependency, per spec.)
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      let oldestKey: string | null = null;
      let oldestExpiry = Infinity;
      for (const [k, e] of this.store) {
        if (e.expiresAt < oldestExpiry) {
          oldestExpiry = e.expiresAt;
          oldestKey = k;
        }
      }
      if (oldestKey !== null) this.store.delete(oldestKey);
    }
    this.store.set(key, { value, expiresAt: Date.now() + this.ttlMs });
  }

  clear(): void {
    this.store.clear();
  }

  /** @internal — for tests. */
  get size(): number {
    return this.store.size;
  }
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Orchestrates rewrite + HyDE behind a per-`(projectId, query)` cache.
 * `understand()` returns `null` on any failure path → caller falls through.
 */
export class QueryUnderstandingService {
  private readonly llmSurface: QueryLlmSurface;
  private readonly embedFn: EmbedFn;
  private readonly cache: QueryUnderstandingCache;
  /** Capture the last-call telemetry for tests/observability. */
  lastHydeUsed: boolean = false;

  constructor(opts: {
    llmSurface?: QueryLlmSurface;
    embedFn?: EmbedFn;
    cacheTtlMs?: number;
    cacheMaxSize?: number;
  } = {}) {
    this.llmSurface = opts.llmSurface ?? (llmHandle as unknown as QueryLlmSurface);
    // Reuse the existing EmbeddingService singleton (instantiated once here;
    // no new provider spawned). Injectable for tests.
    this.embedFn =
      opts.embedFn ??
      ((text: string) => getEmbeddingSingleton().embed(text));
    // Defensive against partial/mocked config (the shared-config mock is
    // process-wide and omits the queryUnderstanding block in some test files).
    const qu = readQueryUnderstandingConfig();
    this.cache = new QueryUnderstandingCache(
      opts.cacheTtlMs ?? qu.cacheTtlMs,
      opts.cacheMaxSize ?? qu.cacheMaxSize,
    );
  }

  /**
   * Run rewrite + HyDE for `(query, projectId)`. Cached per the configured TTL.
   * Returns `null` on any failure / disabled → caller's original search path.
   * Never throws.
   */
  async understand(
    query: string,
    projectId: string,
  ): Promise<QueryUnderstandingResult | null> {
    const trimmed = query?.trim();
    if (!trimmed) return null;

    const key = `${projectId}::${trimmed}`;
    const cached = this.cache.get(key);
    if (cached) {
      this.lastHydeUsed = cached.hydeVector !== null;
      return cached;
    }

    const qu = readQueryUnderstandingConfig();
    const timeoutMs = readLlmTimeoutMs();

    const rewrite = await rewriteQuery(trimmed, this.llmSurface, { timeoutMs });
    if (!rewrite) {
      // Rewrite is the gate: if it failed, no point running HyDE either.
      this.lastHydeUsed = false;
      return null;
    }

    let hydeVector: number[] | null = null;
    if (qu.hydeEnabled !== false) {
      hydeVector = await hyde(trimmed, this.llmSurface, this.embedFn, {
        timeoutMs,
      });
    }
    this.lastHydeUsed = hydeVector !== null;

    const result: QueryUnderstandingResult = {
      expansions: rewrite.expansions,
      keywords: rewrite.keywords,
      hydeVector,
    };
    this.cache.set(key, result);
    return result;
  }

  /** @internal — clear cache between tests. */
  clearCache(): void {
    this.cache.clear();
  }
}

// ─── FTS5 query construction (design §3.1) ────────────────────────────────────

/**
 * Build a quoted FTS5 OR query from the original query + keywords. Each term
 * is FTS5-quoted (internal `"` doubled) and joined with `OR` so the keyword
 * search treats them as a recall-broadening disjunction. Mirrors the per-term
 * quoting that `sanitizeFTS5Query` applies, but operates on already-distinct
 * terms (calling sanitizeFTS5Query on the composed string would re-split the
 * quoted phrases). Returns a sanitized form of the original query when no
 * keywords survive cleaning.
 */
export function buildRewrittenFTSQuery(
  query: string,
  keywords: string[],
): string {
  const quoteTerm = (t: string): string => `"${t.replace(/"/g, '""')}"`;
  const parts: string[] = [];
  const q = query?.trim();
  if (q) parts.push(quoteTerm(q));
  for (const kw of keywords) {
    const clean = kw.trim();
    if (clean) parts.push(quoteTerm(clean));
  }
  if (parts.length === 0) return sanitizeFTS5Query(query);
  return parts.join(" OR ");
}

// ─── Shared EmbeddingService singleton (lazy) ─────────────────────────────────
// One instance reused by all QueryUnderstandingService consumers — mirrors how
// SQLiteVectorStore instantiates its own. Do NOT spawn extra providers.
let embeddingSingleton: EmbeddingService;
function getEmbeddingSingleton(): EmbeddingService {
  if (!embeddingSingleton) embeddingSingleton = new EmbeddingService();
  return embeddingSingleton;
}

// ─── Defensive config readers ─────────────────────────────────────────────────
// `bun mock.module("@massa-th0th/shared")` is process-wide (Phase-1 finding) and
// some test files' mock omits the queryUnderstanding block. These readers fall
// back to the spec defaults so the constructor never throws under a mock.
function readQueryUnderstandingConfig() {
  const qu = (config.get("search") as any)?.queryUnderstanding;
  return {
    enabled: qu?.enabled === true,
    hydeEnabled: qu?.hydeEnabled !== false,
    cacheTtlMs: qu?.cacheTtlMs ?? 300_000,
    cacheMaxSize: qu?.cacheMaxSize ?? 256,
  };
}

function readLlmTimeoutMs(): number {
  const llmCfg = (config.get("llm") as any) ?? {};
  return typeof llmCfg.timeoutMs === "number" ? llmCfg.timeoutMs : 30000;
}
