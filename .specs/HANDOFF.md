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

## Phase 3 handoff (PASS — same-author verified)

- in-progress: none
- next step: Phase 4 (bootstrap from repo — G6). Independent of Phase 3 observations; consumes `llm-client` + `project_map` PageRank. Phase 6 (handoffs) may consume the SessionStart hook + `observation:ingested`.
- blockers: none
- uncommitted files: none
- branch: main; commits 9f8b7a1 (specs), f28c30e (store+config+event), b950df7 (hook-service+queue+429), 8fb0cac (routes+bridge+scripts+mcp).

## Key decisions for Phase 4+ (and later phases)
- Hook ingestion: `POST /api/v1/hook` (single) + `POST /api/v1/hook/batch` (atomic). Returns 202 + id(s) on admission; 429 when the single-writer queue is saturated (`hooks.queue.maxPending`, default 256, env `HOOKS_QUEUE_MAX_PENDING`); 400/413 on validation; 423 when `hooks.enabled=false`.
- Config block: `config.get("hooks")` = `{ enabled (true), maxPayloadBytes (65536), queue.{maxPending}, bridge.{enabled, minObservations(8), minIntervalMs(300000), maxWindow(8)} }`. Env knobs: `HOOKS_ENABLED`, `HOOKS_MAX_PAYLOAD_BYTES`, `HOOKS_QUEUE_MAX_PENDING`, `HOOKS_BRIDGE_ENABLED`, `HOOKS_BRIDGE_MIN_OBS`, `HOOKS_BRIDGE_MIN_INTERVAL_MS`, `HOOKS_BRIDGE_MAX_WINDOW`.
- Observation store: `import { getObservationStore, SqliteObservationStore, MemoryObservationStore, resetObservationStore } from "packages/core/src/data/memory/observation-repository.js"`. SQLite-canonical (`observations.db`, WAL + busy_timeout=3000); MemoryObservationStore no-op fallback. Factory mirrors SessionStore/JobStore. PG parity via Prisma `Observation` model (no PgObservationStore code yet — SQLite-canonical like synapse_sessions/index_jobs).
- Writer queue: `WriterQueue` (promise-chain mutex, mirrors `provider.ts:323`). `QueueSaturatedError` carries `retryAfterSeconds`. The route maps it to HTTP 429 + `Retry-After` header.
- Consolidation bridge: `ObservationConsolidationJob` (`services/jobs/observation-consolidation-job.ts`). Debounce trigger (every minObservations OR minIntervalMs). Bypasses `consolidateWindow` (observations have no embeddings) → builds a recency window + calls `llm.object(prompt, ConsolidatedBatchSchema)` directly. Silent-skip when `!isEnabled()` / `{ok:false}` / throw. Injectable `memoryRepo` for tests (avoids the process-wide MemoryRepository singleton closed-DB landmine).
- EventBus: `observation:ingested` ({ observationId, projectId, sessionId?, source, importance }) added to EventMap. Published inside the writer turn after `store.insert`.
- Hook scripts: `apps/claude-plugin/hooks/{session-start,user-prompt-submit,post-tool-use,stop}.sh` + shared `_post.sh`. 2s curl timeout, exit 0, env `TH0TH_API_BASE` / `TH0TH_API_KEY` / `TH0TH_PROJECT_ID`. README in the same dir.
- MCP tool: `th0th_hook_ingest` (POST /api/v1/hook/batch) for non-Claude hosts.
- Core exports: Phase-3 hook symbols are exported from `packages/core/src/index.ts` (and consumed by routes via `@th0th-ai/core`).
- Test isolation (still applies): hook tests inject `MemoryObservationStore` + fake `BridgeTrigger` + explicit `maxPending` (no shared-config mock). The consolidation-job test injects a fake `LlmSurface` + fake `memoryRepo` (the real MemoryRepository singleton is closed by memory-crud.test.ts in the full suite — injection avoids the closed-DB landmine).

## Same-author caveat (Phase 3)
Sole agent verified its own work — no independent verifier sub-agent. Mitigations: per-AC file:line evidence, discrimination sensor (saturation-check mutant killed), objective gate (738/0). See `.specs/features/phase-3-hook-capture/validation.md`.

## Plan reference
`i-want-to-understand-virtual-lantern.md` Phase 0 (done) → Phase 1 (done) → Phase 2 (done) → Phase 3 (done) → Phase 4 (done) → Phase 6 next.

## Phase 4 handoff (PASS — same-author verified)

- in-progress: none
- next step: Phase 6 (cross-session handoffs — G2). May consume the SessionStart hook (Phase 3) + the `bootstrap:<projectId>` seed memories (Phase 4) as initial context. Phase 5 (auto-improve) may consume seed memories as a baseline for proposed edits.
- blockers: none
- uncommitted files: none
- branch: main; commits c022731 (specs), 1be1a1c (config+event), ae296e7 (bootstrap-service), 773a130 (mcp+route+barrel), 3fec6fd (tests).

## Key decisions for Phase 6+ (and later phases)
- Bootstrap service: `import { BootstrapService, getBootstrapService, SeedMemoriesSchema } from "packages/core/src/services/bootstrap/bootstrap-service.js"` (or via `@th0th-ai/core`). `bootstrap(projectId, { projectPath?, force? })` → `BootstrapResult`. Idempotent (marker = `bootstrap:<projectId>` tag); `force:true` refresh.
- Config block: `config.get("memory").bootstrap` = `{ enabled(true), maxSeedMemories(8), centralityLimit(10), gitLogLimit(20), refreshEnabled(true) }`. Env knobs: `BOOTSTRAP_ENABLED`, `BOOTSTRAP_MAX_SEED_MEMORIES`, `BOOTSTRAP_CENTRALITY_LIMIT`, `BOOTSTRAP_GIT_LOG_LIMIT`, `BOOTSTRAP_REFRESH_ENABLED`. LLM summarization inherits top-level `llm.enabled`.
- Seed memories: stored as normal `memories` rows with `tags:["bootstrap","bootstrap:<projectId>"]`, `embedding:[]` (FTS-only, not vector-searchable), `level: PROJECT(1)`, `metadata.source:"bootstrap"`. Searchable via `MemoryRepository.fullTextSearch`.
- Idempotency marker: `tags LIKE '%bootstrap:<projectId>%' AND deleted_at IS NULL`. Injectable `MemoryRepoSeam.hasBootstrapMarker` (default queries DB; PG falls back to "not bootstrapped" — `getDb()` is SQLite-only).
- Silent degradation: LLM off/`{ok:false}`/throw → `ruleBasedSeed` (README + git log + package.json, max 3, importance 0.6). Empty signals → `noopResult("no-signals")`. Never throws.
- EventBus: `bootstrap:completed` ({ projectId, bootstrapId, seedMemoryIds[], source llm|rule-based, signalCount, memoryCount }) added to EventMap. Published on ≥1 stored seed only.
- MCP tool: `th0th_bootstrap` (POST /api/v1/bootstrap; projectId required, optional projectPath + force). Route: 423 when disabled, 400 on empty projectId.
- Centrality reuse: consumes `SymbolGraphService.getTopCentralFiles(projectId, limit)` — existing PageRank ETL output. No reimplementation. Empty when not indexed (caught).
- Test isolation (still applies): bootstrap tests inject fake `MemoryRepoSeam` + `LlmSurface` + `CentralitySource` + `GitRunner` (no shared-config mock). P4-SEARCH-01 resets the MemoryRepository singleton to a temp DB (mirrors memory-crud.test.ts) + restores it.

## Same-author caveat (Phase 4)
Sole agent verified its own work — no independent verifier sub-agent. Mitigations: per-AC file:line evidence, discrimination sensor (idempotency-guard mutant killed), objective gate (754/0). See `.specs/features/phase-4-bootstrap/validation.md`.
