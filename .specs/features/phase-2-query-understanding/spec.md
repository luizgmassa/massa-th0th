# Phase 2 — Query Understanding: Specification

Slug: `phase-2-query-understanding`. Plan item 4 of
`i-want-to-understand-virtual-lantern.md`. Depends on Phase 1 `llm-client`.

## Goal

Improve retrieval quality by expanding the user's query before the
vector/keyword fan-out: an LLM rewrite produces structured expansions +
keywords, and HyDE (Hypothetical Document Embeddings) generates a
hypothetical implementation paragraph that is embedded and added as a
second vector stream. The original vector stream and keyword stream are
preserved; the new streams join the existing RRF fusion.

## Requirements

### Functional

- **R1 — LLM rewrite.** `rewriteQuery(query)` returns structured
  expansions + keywords via `llmObject(prompt, zodSchema)`. The schema
  enforces string arrays; malformed/empty LLM output is rejected.
- **R2 — HyDE.** `hyde(query)` generates a hypothetical implementation
  paragraph via `llmComplete`, then **embeds it with the existing
  embeddings provider** (no new provider spawned) and returns the vector.
- **R3 — Config-gated, default off.** A new `search.queryUnderstanding`
  config block gates the feature. When `enabled === false` the search
  path is byte-for-byte the pre-Phase-2 single-stream path.
- **R4 — Fan-out + fusion.** When enabled, `ContextualSearchRLM.search()`
  runs: original vector + HyDE vector (`searchByEmbedding`) + rewritten
  FTS terms, and feeds `fuseResults([...streams])` (the existing RRF
  fusion, which already accepts `SearchResult[][]`).
- **R5 — Per-query cache.** Rewrite + HyDE vector are cached per
  `(query, projectId)` with a TTL and size bound. No new dependency.
- **R6 — Synapse threading.** `sessionId` is threaded through for Synapse
  bias (Phase-1 durable sessions).
- **R7 — EventBus events.** Emit `search:query-rewritten` (after a
  successful rewrite) and `search:reranked` (after the explicit fusion of
  the expanded streams). Both added to `EventMap`.

### Non-functional (cross-cutting, non-negotiable)

- **NF1 — Silent degradation.** On any LLM throw / timeout / disabled, the
  search falls through silently to the original single-stream path. The
  feature **never blocks search, never throws to the caller.** Every LLM
  call respects `timeoutMs`.
- **NF2 — Local-first.** Default backend is local Ollama via the shared
  `llm-client`. Cloud is opt-in.
- **NF3 — SQLite-canonical.** No Postgres-only path; `searchByEmbedding`
  is part of `IVectorStore` and implemented for SQLite.
- **NF4 — No migration.** Additive config + code only.

## Acceptance Criteria (AC IDs)

| ID | Criterion |
| --- | --- |
| P2-REWRITE-01 | `rewriteQuery` returns structured `{expansions, keywords}` when the LLM is enabled and succeeds. |
| P2-REWRITE-02 | `rewriteQuery` returns `null` (sentinel) when the LLM is disabled, times out, or throws — and never throws to the caller. |
| P2-REWRITE-03 | The zod schema rejects malformed output (non-array / empty / wrong shape) → treated as failure → `null`. |
| P2-HYDE-01 | `hyde` returns a non-empty `number[]` embedding when the LLM + embeddings provider succeed. |
| P2-HYDE-02 | `hyde` returns `null` when the LLM is disabled or throws; the embeddings provider is **not** called when the LLM step fails (avoids wasted work). |
| P2-HYDE-03 | HyDE uses the **existing** embeddings provider (`EmbeddingService.embed`), not a new one. |
| P2-CONFIG-01 | `search.queryUnderstanding.enabled` exists in `ServerConfig` + `defaultConfig` + `mergeConfig`, default `false`. |
| P2-CONFIG-02 | Sub-keys `hydeEnabled`, `cacheTtlMs`, `cacheMaxSize` exist with sensible defaults. |
| P2-FANOUT-01 | When enabled, `search()` issues original vector + HyDE vector + rewritten-FTS streams and fuses them. |
| P2-FANOUT-02 | When disabled, `search()` is the original 2-stream path (no extra calls, no events). |
| P2-DEGRADE-01 | LLM disabled → search returns normal results, no error thrown. |
| P2-DEGRADE-02 | LLM throws → swallowed, search still works (original streams). |
| P2-CACHE-01 | A second call with the same `(query, projectId)` within TTL reuses the cached rewrite + HyDE vector (no second LLM call). |
| P2-CACHE-02 | Cache evicts by TTL and bounds size (LRU-ish / FIFO cap). |
| P2-EVENTS-01 | `search:query-rewritten` is added to `EventMap` and emitted after a successful rewrite. |
| P2-EVENTS-02 | `search:reranked` is added to `EventMap` and emitted after the expanded-stream fusion. |
| P2-QUALITY-01 | On a deterministic needle-in-haystack fixture, rewrite-on retrieval **beats or matches** rewrite-off retrieval (needle rank ≤ baseline rank; recall@k ≥ baseline). |

## Edge cases

- Empty query string → rewrite/HyDE skipped, original path.
- LLM returns valid JSON but empty arrays → treated as failure → fall through.
- Embeddings provider unavailable (Ollama down) → HyDE skipped (caught), original vector stream still used.
- Cache entry expired between rewrite and reuse → recomputed.
- Concurrent identical queries → at most one LLM round-trip per TTL window (best-effort; no hard mutex required, but dedupe via in-flight promise is acceptable).
- `sessionId` absent → Synapse bias simply not applied (existing behavior).

## Out of scope

- Cross-encoder / Cohere reranker (Phase 7a).
- Graph-neighbor as a 3rd RRF stream (Phase 7c).
- LLM-judge salience (Phase 7b).
- Persistent (cross-process) rewrite cache (in-memory only this phase).
- Postgres-specific fast path.

## Dependencies

- Phase 1 `llm-client` (`llmComplete`, `llmObject`, `isLlmEnabled`,
  `_setLlmEnabledForTesting`).
- Phase 1 top-level `llm` config block.
- Existing `EmbeddingService` (`data/chromadb/vector-store.ts`).
- Existing `SQLiteVectorStore.searchByEmbedding` + `IVectorStore`.
- Existing `ContextualSearchRLM.fuseResults` (RRF).
- Phase-1 `EventBus` + `EventMap`.

## Verification gates

- `bun run test` passes (no regression vs 677 pass / 0 fail / 46 skip).
- `bun run type-check` clean.
- Dedicated tests cover every AC.
- Discrimination sensor kills at least one mutant in the new code.
