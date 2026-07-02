# Handoff

## Snapshot
- feature: phase-2-query-understanding — COMPLETE, same-author verified (PASS)
- phase/task: Execute done; validation.md written
- completed: `search.queryUnderstanding` config block (default-off); `query-understanding.ts` service (`rewriteQuery` + `hyde` + bounded cache + `QueryUnderstandingService.understand()` + `buildRewrittenFTSQuery`); `ContextualSearchRLM.search()` 3-stream fan-out (original vector + HyDE vector via `searchByEmbedding` + rewritten-FTS → existing `fuseResults`) with silent-degrade outer try/catch; `search:query-rewritten` + `search:reranked` EventBus events; `sessionId` threaded on `search()` options.
- in-progress: none
- next step: Phase 3 (passive memory capture — observation ingestion + hooks). Consumes `llm-client` + the new `search:*` events + Phase 1's `SessionStore`/`JobStore`.
- blockers: none
- uncommitted files: none (STATE.md/FEATURES.json/HANDOFF.md/PHASE-INTEGRATION.md/validation.md updates pending this commit)
- branch: main; commits 538fe66..3fb4eb1 (Phase 0), befa3cb..1ccb42c (Phase 1), ebcc202 (Phase 2 specs), 5b0ba18, 6a7598f, 6cb5edb, f2acceb (Phase 2 impl)

## Key decisions for Phase 3 (and later phases)
- Query understanding gate: `config.get("search").queryUnderstanding.enabled` (default `false`, env `SEARCH_QUERY_UNDERSTANDING_ENABLED`). Sub-keys `hydeEnabled` (default true), `cacheTtlMs` (300_000), `cacheMaxSize` (256). Read via `config.get("search").queryUnderstanding`; the service also has defensive readers that fall back to these defaults if the block is absent (process-wide shared-config mock landmine).
- Query-understanding service: `import { QueryUnderstandingService, rewriteQuery, hyde, buildRewrittenFTSQuery, QueryRewriteSchema } from "packages/core/src/services/search/query-understanding.js"`. Constructor takes `{ llmSurface?, embedFn?, cacheTtlMs?, cacheMaxSize? }` for test injection; defaults to the real `llm` handle + the existing `EmbeddingService` singleton.
- LLM surface contract (unchanged from Phase 1): `llmObject`/`llmComplete` never throw — they return `{ok:false}` on disabled/timeout/error. Treat `{ok:false}` as "fall through". `_setLlmEnabledForTesting` seam still available.
- EventBus: subscribe to `search:query-rewritten` (after a successful rewrite) and `search:reranked` (after the expanded fusion) via `eventBus` from `services/events/event-bus.ts`. Phase 3's observation/hook ingestion should listen here if it wants to capture query-expansion signal.
- Fan-out shape: `ContextualSearchRLM.search()` now builds `resultSets: SearchResult[][]` (2 streams when QU off or degraded; 3 streams — vector + rewritten-FTS + HyDE — when on). Fused via the existing `fuseResults` (RRF). `sessionId?: string` is an optional option for future Synapse-biased fusion (not yet consumed).
- Embeddings: HyDE reuses the existing `EmbeddingService` (`data/chromadb/vector-store.ts:364`, `.embed(text)`). Vector-by-vector search uses `SQLiteVectorStore.searchByEmbedding(embedding, limit, projectId)` (line 610). No new provider spawned.
- Test isolation (still applies): bun `mock.module("@th0th-ai/shared")` is process-wide. The Phase-2 tests inject a fake `QueryLlmSurface` + fake `embedFn` directly (no config, no DB, no network) to avoid the collision. For new search/memory tests, prefer injection over config-mocking.

## Same-author caveat (Phase 2)
Sole resumed agent verified its own work — no independent verifier sub-agent. The prior invocation wrote the spec (commit `ebcc202`); this invocation implemented + validated. Mitigations: per-AC file:line evidence, discrimination sensor (mutant killed), objective gate (700/0). See `.specs/features/phase-2-query-understanding/validation.md`.

## Plan reference
`i-want-to-understand-virtual-lantern.md` Phase 0 (done) → Phase 1 (done) → Phase 2 (done) → Phase 3 next.
