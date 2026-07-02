# Phase 2 — Query Understanding: Design

Slug: `phase-2-query-understanding`. Required (touches search hot path,
new module, EventBus contract, config schema, degradation contract).

## 1. Component overview

```
ContextualSearchRLM.search(query, projectId, opts)
        │
        │  (when search.queryUnderstanding.enabled)
        ▼
┌──────────────────────────────────────────────────────────┐
│ QueryUnderstandingService.understand(query, projectId)   │
│   ┌────────────────────────────────────────────────┐     │
│   │ 1. cache lookup (query, projectId)             │     │
│   │ 2. rewriteQuery  → llmObject(zod) → expansions │     │
│   │ 3. hyde          → llmComplete → embed(...)    │     │
│   │ 4. cache store                                   │     │
│   └────────────────────────────────────────────────┘     │
│   returns { expansions, keywords, hydeVector } | null    │
└──────────────────────────────────────────────────────────┘
        │ null  → fall through to original 2-stream path
        │ non-null:
        ▼
fan-out:
  vectorResults   = vectorStore.search(query, ...)
  hydeResults     = vectorStore.searchByEmbedding(hydeVector, ...)
  keywordResults  = keywordSearch.searchWithFilter(rewrittenFTSQuery, ...)
        │
        ▼
fuseResults([vectorResults, keywordResults, hydeResults])
  (existing RRF; already takes SearchResult[][])
        │
        ▼
emit search:reranked; rest of search() unchanged
```

## 2. New module: `query-understanding.ts`

Path: `packages/core/src/services/search/query-understanding.ts`.

### 2.1 Zod schema (R1, P2-REWRITE-03)

```ts
const QueryRewriteSchema = z.object({
  expansions: z.array(z.string().min(1)).min(1).max(8),
  keywords: z.array(z.string().min(1)).min(1).max(12),
});
```

Non-empty arrays, bounded length. Any LLM output failing this is caught
by `llmObject` (which wraps `generateObject` and returns `{ok:false}` on
zod failure — already proven in Phase 1).

### 2.2 `rewriteQuery`

```ts
async function rewriteQuery(query: string): Promise<QueryRewrite | null> {
  const res = await llmObject(prompt, QueryRewriteSchema, { timeoutMs });
  return res.ok ? res.value : null;
}
```

`{ok:false}` covers disabled, timeout, throw, and zod-invalid. Returns
`null` → caller falls through.

### 2.3 `hyde` (R2, P2-HYDE-01..03)

```ts
async function hyde(query: string): Promise<number[] | null> {
  const text = await llmComplete(hydePrompt, { timeoutMs, system });
  if (!text.ok || !text.value) return null;
  try {
    return await embed(text.value);   // existing EmbeddingService
  } catch {
    return null;                      // Ollama down → skip HyDE
  }
}
```

**Key:** the embed call only runs if the LLM step succeeded (P2-HYDE-02).
The embeddings provider is the **existing** singleton
(`EmbeddingService` from `data/chromadb/vector-store.ts`), instantiated
once and injected — no new provider (P2-HYDE-03).

### 2.4 Cache (R5, P2-CACHE-01..02)

In-memory `Map<string, { value: QueryUnderstandingResult; expiresAt: number }>`
keyed by `${projectId}::${query}`. Bounded by `cacheMaxSize` (default 256):
on insert over the cap, evict the entry with the earliest `expiresAt`
(simple TTL + size bound; no LRU dependency). TTL default 5 min
(`cacheTtlMs: 300_000`). Lookup returns `undefined` when expired or absent.

Exposed for testing: `clearCache()`.

### 2.5 Injectable LLM surface

Mirror Phase-1 consolidator's `LlmSurface` pattern so tests can inject a
fake LLM without touching config or network:

```ts
export interface QueryLlmSurface {
  complete: typeof llmComplete;
  object: typeof llmObject;
  isEnabled: typeof isLlmEnabled;
}
```

Default = the real `llm` handle from `llm-client.ts`. Tests inject a fake.

## 3. Wiring into `ContextualSearchRLM.search()` (R4)

Minimal, surgical edit inside the existing `try` block, after the cache
check and **before** the existing `Promise.all`:

```ts
// ── Phase 2: query understanding (default-off, silent degrade) ──
let resultSets: SearchResult[][] = [];
let usedQueryUnderstanding = false;
try {
  const qu = config.get("search").queryUnderstanding;
  if (qu?.enabled && query.trim()) {
    const understood = await this.queryUnderstanding.understand(query, projectId);
    if (understood) {
      eventBus.publish("search:query-rewritten", { query, projectId, expansions, keywords });
      const [v, k, h] = await Promise.all([
        this.vectorStore.search(query, maxResults * 2, projectId),
        this.keywordSearch.searchWithFilter(rewrittenFTS, { projectId }, maxResults * 2),
        understood.hydeVector
          ? this.vectorStore.searchByEmbedding(understood.hydeVector, maxResults * 2, projectId)
          : Promise.resolve([]),
      ]);
      resultSets = understood.hydeVector ? [v, k, h] : [v, k];
      usedQueryUnderstanding = true;
    }
  }
} catch (e) {
  logger.warn("query understanding failed — falling back", { err: ... });
}

if (!usedQueryUnderstanding) {
  // ORIGINAL path — unchanged
  const [vectorResults, keywordResults] = await Promise.all([...]);
  resultSets = [vectorResults, keywordResults];
}

const fusedResults = this.fuseResults(resultSets, query, explainScores);
if (usedQueryUnderstanding) {
  eventBus.publish("search:reranked", { query, projectId, streamCount: resultSets.length });
}
// ... rest of search() unchanged (filter, threshold, cache, analytics)
```

**Why a separate branch rather than always 3-stream:** keeps the disabled
path byte-identical to Phase-1 (no behavior drift, no extra events, no
risk to the 677 baseline). The enabled path explicitly constructs the
stream list so HyDE-absent (LLM ok, embed failed) degrades to a still-
valid 2-stream fusion with the rewritten FTS query.

### 3.1 FTS query construction

Join `expansions` + `keywords` + original query into an FTS5 OR query:
`"${query}" OR ${keywords.map(k => `"${k}"`).join(" OR ")}`. Quoted to
avoid FTS5 operator injection. If rewrite returned expansions only (no
keywords), fall back to the original query for the FTS leg.

## 4. Degradation matrix (NF1)

| Condition | Behavior |
| --- | --- |
| `queryUnderstanding.enabled === false` | Original 2-stream path. No LLM call, no events. |
| LLM disabled (`isLlmEnabled() === false`) | `understand()` returns `null` immediately (llm-client sentinel). Original path. |
| LLM throws / times out | `llmObject`/`llmComplete` return `{ok:false}`. `understand()` returns `null`. Original path. |
| LLM ok, embeddings throw | `hyde` returns `null`; rewrite still used → 2-stream with rewritten FTS. |
| `understand()` itself throws (defensive) | Caught in `search()`; original path. |

At no point does `search()` throw due to query understanding.

## 5. Synapse sessionId threading (R6)

`search()` already accepts `options`; we add an optional `sessionId?: string`
to the options shape (passed through by callers that have a Synapse
session). It is forwarded to `analytics.trackSearch` and is available for
future Synapse-biased fusion. No behavior change when absent (existing
callers unaffected — the field is optional).

## 6. EventBus events (R7)

Added to `EventMap` in `services/events/event-bus.ts`:

```ts
"search:query-rewritten": {
  query: string;
  projectId: string;
  expansions: string[];
  keywords: string[];
  hydeUsed: boolean;
};
"search:reranked": {
  query: string;
  projectId: string;
  streamCount: number;
  resultCount: number;
};
```

Shape mirrors `memory:consolidated` (typed payload, publish via `eventBus.publish`).

## 7. Config schema (R3, P2-CONFIG-01..02)

Added to `ServerConfig.search`:

```ts
search: {
  autoReindexMaxFiles: number;          // Phase 0
  queryUnderstanding: {
    enabled: boolean;                    // default false
    hydeEnabled: boolean;                // default true (gates HyDE only)
    cacheTtlMs: number;                  // default 300_000 (5 min)
    cacheMaxSize: number;                // default 256
  };
};
```

`defaultConfig` + `mergeConfig` updated. Env: `SEARCH_QUERY_UNDERSTANDING_ENABLED`
(opt-in). The feature is **additive** — existing readers of
`config.get("search")` see a new nested object and are unaffected.

## 8. Reuse / no-reinvent checklist

- LLM: Phase-1 `llm-client` (`llmObject`, `llmComplete`, `isLlmEnabled`).
- Embeddings: existing `EmbeddingService.embed` (the same one
  `SQLiteVectorStore` uses).
- Vector search by vector: existing `SQLiteVectorStore.searchByEmbedding`
  (part of `IVectorStore`).
- Fusion: existing `ContextualSearchRLM.fuseResults` (RRF).
- Events: existing `eventBus` + `EventMap`.
- Config helpers: existing `envBool`/`envNum`.
- Test seam: Phase-1 `_setLlmEnabledForTesting`.

## 9. Test strategy

Co-locate under `packages/core/src/__tests__/query-understanding.test.ts`.
**Do not mock `@th0th-ai/shared`** (process-wide collision rule from
Phase 1). Instead:

- Inject a fake `QueryLlmSurface` into the service ctor for unit tests
  (no config, no network).
- Use `_setLlmEnabledForTesting(true/false)` for the integration-flavored
  degradation tests on `ContextualSearchRLM`.
- For the retrieval-quality test (P2-QUALITY-01), build a tiny in-memory
  fixture: index 5-6 short documents into a temp SQLite vector store via
  the real `ContextualSearchRLM`, run a needle query with the LLM
  surface faked to return a strong expansion, and assert the needle's
  rank with rewrite-on ≤ rank with rewrite-off.

Discrimination sensor: mutate the rewrite schema (e.g. drop `.min(1)`)
or flip the `enabled` gate, confirm the relevant test fails, revert.

## 10. Risks

- **Search hot-path latency.** Two extra LLM calls + one embed per
  uncached query. Mitigated by: default-off, per-query cache, timeoutMs,
  and full parallelism with the existing vector/keyword calls.
- **RRF score drift.** Adding a 3rd stream changes the normalization
  divisor. Mitigated by: the existing dynamic normalization uses the
  observed max, and the quality test (P2-QUALITY-01) guards against
  regression.
- **Test isolation.** Mitigated per §9 (no shared-config mock).
