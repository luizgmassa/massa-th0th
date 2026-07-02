# Phase Integration Ledger (massa-th0th improvement plan)

Working aid for the spec-driven multi-phase rollout of
`i-want-to-understand-virtual-lantern.md`. Updated after each phase so the next
phase's sub-agent inherits exact integration points (config keys, services,
schema, EventBus events, seams). Not the spec; canonical state stays in
`project/STATE.md`, `project/FEATURES.json`, `HANDOFF.md`.

## Project / session
- projectId: `massa-th0th` (the TS MCP server repo — NOT the useful-agent-skills skills repo).
- workflowSessionId: `spec-virtual-lantern-plan`. workflow: `spec-driven`. branch: `main`.
- Recommended phase order: 1 → 2 → 3 → 4 → 6 → 5 → 7(7e first, then 7a–7d, 7f last) → 8.
- One sub-agent per phase, sequential; prior phase's summary feeds the next.

## Repo facts (every agent assumes these)
- Runtime: **bun** (`bun:test`). Build via turborepo. `bun run test` (all),
  `bun run type-check` (5 tasks, must be clean). No package-level lint task.
- Baseline after Phase 0: **609 pass / 0 fail** (61 pre-existing env-dependent
  skips). New work must not regress this.
- `node_modules`/`dist` may be absent at agent start → run `bun install` first if
  `node_modules` is missing, then build/type-check.
- **`th0th_search`/index is N/A for this repo** (not indexed; only massa-vault +
  useful-agent-skills are). Use direct source reads + `grep`/Glob/Read.
- Architecture tiers: MCP client (`apps/mcp-client`) → Tools API
  (`apps/tools-api`, routes under `src/routes/`) → core (`packages/core`) +
  shared config (`packages/shared/src/config`).
- Phase 0 commit range `4e27925^..be65877` is the precedent for spec/artifact +
  per-task commit style.

## Cross-cutting architecture decisions (apply to every phase)
1. **One shared LLM client, local-first.** `packages/core/src/services/memory/llm-client.ts`
   wrapping `generateText`/`generateObject` (`ai` + `@ai-sdk/openai` already in
   `package.json`). New top-level `llm` config block in `packages/shared/src/config/index.ts`,
   Ollama defaults (`baseUrl http://localhost:11434/v1`, model `qwen2.5-coder:7b`,
   `apiKey "ollama"`). Migrate `compression.llm` → `llm` (keep deprecated alias one
   release). Expose `llmComplete(prompt, opts?)` + `llmObject(prompt, zodSchema)`.
   Every call: (a) respect `timeoutMs`, (b) degrade silently to non-LLM path on
   failure, (c) config-gated default-off. Env toggle observed in Phase 0:
   `RLM_LLM_ENABLED`.
2. **SQLite is first-class.** No new feature may repeat the `isPostgresEnabled()`
   short-circuit (`memory-consolidation-job.ts:36-42`). New jobs route through
   backend-polymorphic dispatch mirroring factories
   (`data/vector/vector-store-factory.ts:86`, `data/memory/memory-repository-factory.ts:13`).
3. **EventBus is the integration bus** (`services/events/event-bus.ts`). New stages
   emit typed events: `memory:consolidated`, `search:query-rewritten`,
   `search:reranked`, `memory:salience-scored`, `observation:ingested`,
   `handoff:accepted`, `bootstrap:completed`. No new plugin system.
4. **SQLite write discipline.** Enable **WAL mode**; serialize observation/hook
   ingestion through a single-writer queue; 429 on saturation (protects readers).
5. **Migrations additive-only**, both backends (`ALTER TABLE … ADD COLUMN` /
   `CREATE TABLE IF NOT EXISTS`; pattern at `memory-repository.ts:148-160`).

## Phase 0 landed (reference, do not redo)
- 0a upload-gate: shared `DEFAULT_ALLOWED_EXTENSIONS` (34) in
  `packages/shared/src/config/index.ts` consumed by config default + index-manager
  + `apps/mcp-client/src/file-collector.ts` (old 8-ext drift killed).
- 0b reindex cap: `config.search.autoReindexMaxFiles` (default 200, env
  `AUTOREINDEX_MAX_FILES`); 3 sites derive (`search-controller.ts:246`,
  `contextual-search-rlm.ts:290-291,317,346`).
- 0c memory CRUD: `MemoryRepository`(SQLite) + `MemoryRepositoryPg` gained
  `update`/`deleteById`; MCP tools `th0th_memory_update` + `th0th_memory_delete`;
  routes under `apps/tools-api/src/routes/memory.ts`. **Delete = HARD delete +
  sever GraphStore edges via `MemoryGraphService.onMemoryDeleted(id)`.** Soft-delete
  (`deleted_at` + recall filtering) deferred to Phase 1. Update re-embeds + rebuilds
  FTS5 external-content index on content/tag change.
- 0d checkpoint MCP: 3 tools wired into `tool-definitions.ts` + thin
  `routes/checkpoints.ts` over existing core tools.

## Per-phase integration deltas (append as phases complete)

### Phase 1 — landed (commits befa3cb, e49ffa9, 12fe002, 1ccb42c)

**Config keys (new):**
- `memory.decay: { lambda=0.02; sigma=0.6; mu=0.04; coldThreshold=0.20 }` (`DecayParams`, exported from `@th0th-ai/shared`).
- Top-level `llm: { enabled; baseUrl; apiKey; model; temperature; maxOutputTokens; timeoutMs }` — Ollama defaults (`http://localhost:11434/v1`, `qwen2.5-coder:7b`, `apiKey "ollama"`), **default-off** (env `RLM_LLM_ENABLED=true`).
- `compression.llm` is now a **deprecated alias** of `llm` (same env vars; `prompt` stays compression-specific). Migrate readers to `config.get("llm")`.
- New env helpers in `packages/shared/src/config`: `envBool`, `envString` (alongside `envNum`).

**Services exported (path + symbol) — what Phase 2+ consumes:**
- `packages/core/src/services/memory/decay.ts` → `decayScore(mem, params?, now?)`, `isCold(mem, params?, now?)`, `DEFAULT_DECAY_PARAMS`, `DecayMemory`.
- `packages/core/src/services/memory/llm-client.ts` → `llmComplete(prompt, opts?)`, `llmObject(prompt, zodSchema, opts?)`, `isLlmEnabled()`, `llm` (bundled handle), `LlmResult<T>`. `_setLlmEnabledForTesting` is an internal test seam.
- `packages/core/src/services/memory/consolidator.ts` → `consolidateWindow(candidates, llmSurface, opts?)`, `pickConsolidationWindow`, `cosineSimilarity`, `ConsolidatedBatch`, `ConsolidatedBatchSchema`, `rowsToCandidates`, `LlmSurface`.
- `packages/core/src/services/synapse/session/session-store.ts` → `SessionStore`, `SqliteSessionStore`, `MemorySessionStore`, `getSessionStore()`, `resetSessionStore()`.
- `packages/core/src/services/jobs/index-job-store.ts` → `JobStore`, `SqliteJobStore`, `getJobStore()`, `resetJobStore()`.
- `packages/core/src/services/jobs/memory-consolidation-job.ts` → `MemoryConsolidationJob` (ctor accepts `{ llm?: LlmSurface }`), `ConsolidationStats` (now `{promoted, decayed, pruned, edgesCleaned, merged, batchesCreated}`), singleton `memoryConsolidationJob`.

**Schema delta (additive, both backends):**
- `memories`: `pinned` (SQLite `INTEGER NOT NULL DEFAULT 0` / PG `Boolean @default(false)`) + `deleted_at` (SQLite `INTEGER` nullable / PG `DateTime?`). Indexes on `deleted_at`.
- `memory_edges`: now also ensured by `MemoryRepository` (so the SUPERSEDES read filter works even when GraphStore isn't instantiated). SQLite cols unchanged (`source_id/target_id/relation_type/evidence/auto_extracted`); PG unchanged (`from_id/to_id/edge_type/metadata`). Batch id carried via SQLite `evidence` (JSON) / PG `metadata`.
- `synapse_sessions` + `synapse_access_history` (new, SQLite-canonical; `synapse-sessions.db`).
- `index_jobs` (new, SQLite-canonical; `index-jobs.db`).

**EventBus events emitted:**
- `memory:consolidated: { batchId, sourceIds[], newMemoryId, projectId?, stats:{merged, batchesCreated} }` (added to `EventMap`).

**Read-side seams (must be respected by new recall paths):**
- SQLite FTS + PG FTS + `listMemories` all exclude `deleted_at IS NOT NULL` AND targets of a `SUPERSEDES` edge. Any new recall path MUST apply both filters.

**Backend-polymorphic dispatch pattern:** use `getMemoryRepository()` / `getGraphStore()` / `getSessionStore()` / `getJobStore()`. Never re-introduce `isPostgresEnabled()` short-circuits.

**Latent landmine removed:** `graph-store-pg.ts` no longer eagerly constructs the Prisma client at module-eval (lazy Proxy) — importing `graph-store-factory` is now side-effect-free in SQLite-only environments.

**Test-isolation rule (IMPORTANT for Phase 2+):** bun `mock.module("@th0th-ai/shared")` is process-wide and collides across files. Only ONE test file (memory-crud.test.ts) mocks shared config for the memory subsystem; co-locate new memory tests there or avoid mocking config (pass explicit dbPaths / use the `_setLlmEnabledForTesting` seam). The SQLite consolidation tests live in memory-crud.test.ts for this reason.
### Phase 2 — landed (commits ebcc202 specs, 5b0ba18, 6a7598f, 6cb5edb, f2acceb)

**Config keys (new):**
- `search.queryUnderstanding: { enabled=false; hydeEnabled=true; cacheTtlMs=300_000; cacheMaxSize=256 }` — additive nested block in `ServerConfig.search`. Env opt-in `SEARCH_QUERY_UNDERSTANDING_ENABLED` (also `SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED`, `SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS`, `SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE`). Default-off; `mergeConfig` shallow-merges the nested object.

**Services exported (path + symbol) — what Phase 3+ consumes:**
- `packages/core/src/services/search/query-understanding.ts` → `QueryUnderstandingService` (ctor `{ llmSurface?, embedFn?, cacheTtlMs?, cacheMaxSize? }`; method `understand(query, projectId): Promise<QueryUnderstandingResult | null>`), `rewriteQuery(query, surface, opts?)`, `hyde(query, surface, embedFn, opts?)`, `buildRewrittenFTSQuery(query, keywords)`, `QueryRewriteSchema` + `QueryRewrite` type, `QueryLlmSurface` + `EmbedFn` interfaces, `QueryUnderstandingResult` type.
- Default `llmSurface` = the real `llm` handle from Phase-1 `llm-client.ts`. Default `embedFn` reuses the existing `EmbeddingService` singleton (lazy, `data/chromadb/vector-store.ts`) — no new provider.
- `ContextualSearchRLM.search()` now accepts `options.sessionId?: string` (forward-compatible seam for Synapse-biased fusion; not yet consumed).

**EventBus events emitted (new):**
- `search:query-rewritten: { query, projectId, expansions[], keywords[], hydeUsed }` — published after a successful LLM rewrite (only when `queryUnderstanding.enabled`).
- `search:reranked: { query, projectId, streamCount, resultCount }` — published after fusing the expanded streams (only on the query-understanding path; NOT on the original 2-stream path).

**Fan-out shape / seams Phase 3 reuses:**
- `ContextualSearchRLM.search()` builds `resultSets: SearchResult[][]` then calls the existing `fuseResults(resultSets, query, explainScores)` (RRF). When QU off/degraded → 2 streams (vector + keyword), byte-identical to Phase-1. When QU on → 3 streams (vector + rewritten-FTS + HyDE via `vectorStore.searchByEmbedding`).
- Silent-degrade contract: the QU branch is wrapped in an outer try/catch in `search()` that resets to the original 2-stream path on ANY throw. `understand()` returns `null` on disabled/timeout/error/empty-query. NEVER blocks search, NEVER throws to caller.
- Cache: in-memory `Map<projectId::query, {value, expiresAt}>`, TTL+size-bounded (no new dependency). `clearCache()` for tests.

**No schema delta, no migration.** Additive config + code + EventBus events only.

**Test-isolation note (extends Phase-1 rule):** `query-understanding.test.ts` does NOT mock `@th0th-ai/shared`. It injects a fake `QueryLlmSurface` + fake `EmbedFn` (no config, no DB, no network). The `QueryUnderstandingService` constructor has defensive config readers (fall back to spec defaults) because other test files' process-wide shared-config mock omits the `queryUnderstanding` block — this is a no-op in production.

### Phase 3 — landed (commits 9f8b7a1 specs, f28c30e store+config+event, b950df7 hook-service+queue+429, 8fb0cac routes+bridge+scripts+mcp)

**Config keys (new):**
- `hooks: { enabled (envBool HOOKS_ENABLED=true); maxPayloadBytes (envNum HOOKS_MAX_PAYLOAD_BYTES=65536); queue.{ maxPending (envNum HOOKS_QUEUE_MAX_PENDING=256) }; bridge.{ enabled (envBool HOOKS_BRIDGE_ENABLED=true); minObservations (8); minIntervalMs (300_000); maxWindow (8) } }`. Additive nested block in `ServerConfig`; `mergeConfig` shallow-merges `hooks` + nested `queue`/`bridge`.

**Services exported (path + symbol) — what Phase 4+ consumes:**
- `packages/core/src/data/memory/observation-repository.ts` → `ObservationStore` (interface), `MemoryObservationStore` (no-op fallback), `SqliteObservationStore` (lazy open, WAL + busy_timeout=3000, `observations` table), `getObservationStore()`/`resetObservationStore()` (factory mirrors SessionStore/JobStore), `newObservationId()`, `LIFECYCLE_EVENTS` (const tuple of the 6 event kinds), `LifecycleEventKind`/`Observation`/`ObservationRow` types.
- `packages/core/src/services/hooks/writer-queue.ts` → `WriterQueue` (promise-chain mutex mirroring `provider.ts:323`), `QueueSaturatedError` (carries `retryAfterSeconds`).
- `packages/core/src/services/hooks/hook-service.ts` → `HookService` (ctor `{ store?, maxPending?, maxPayloadBytes?, bridge?, idFactory? }`), `validateEvent(raw, maxPayloadBytes)` (pure), `ingestOne`/`ingestBatch`, `ValidationError` (code 400|413), `getHookService()`/`resetHookService()` singleton, `IncomingEvent`/`NormalizedEvent`/`BridgeTrigger` types.
- `packages/core/src/services/jobs/observation-consolidation-job.ts` → `ObservationConsolidationJob` (ctor `{ llm?, store?, memoryRepo?, minObservations?, minIntervalMs?, maxWindow? }`), `maybeRun(projectId)` (debounce trigger), `runOnce(projectId)` (silent-skip on LLM-off/`{ok:false}`/throw), singleton `observationConsolidationJob`.
- Core barrel re-exports Phase-3 hook symbols from `packages/core/src/index.ts` (consumed by routes via `@th0th-ai/core`).

**Routes (new, Elysia):**
- `POST /api/v1/hook` → single lifecycle event → 202 + `{ id }`; 429 + `Retry-After` when saturated; 400/413 validation; 423 when `hooks.enabled=false`.
- `POST /api/v1/hook/batch` → `{ events: [...] }` atomic validation → 202 + `{ ids: [] }`; same error mapping.
- Wired into `apps/tools-api/src/index.ts` (`.use(hookRoutes)`) + swagger tag `hooks`.

**Schema delta (additive, both backends):**
- SQLite: new `observations` table (`id TEXT PK, project_id, session_id, source, payload_json, importance, created_at`) + 2 indexes (`idx_obs_project_created`, `idx_obs_session`). DB file `observations.db` (WAL + busy_timeout=3000). No ALTER (new table).
- PG: additive Prisma `Observation` model (`@@map("observations")`, indexes on `[projectId, createdAt(sort:Desc)]` + `[sessionId]`). No PgObservationStore code yet (SQLite-canonical runtime state, like synapse_sessions/index_jobs).

**EventBus events emitted (new):**
- `observation:ingested: { observationId, projectId, sessionId?, source, importance }` — published inside the writer turn after `store.insert`.

**Single-writer queue + 429 design (cross-cutting §4):**
- `WriterQueue` serializes the persist step via a promise-chain mutex (mirrors `provider.ts:323`). `saturated = pending >= maxPending` (default 256); `enqueue` throws `QueueSaturatedError` BEFORE any side effect → route maps to 429. WAL + busy_timeout protect readers from the fire-hose. The queue lives on the `HookService` singleton.

**Consolidation bridge design:**
- Separate job (`ObservationConsolidationJob`), NOT extending `memory-consolidation-job.ts` — observations are a different source stream (no embeddings) with a different trigger. Reuses `ConsolidatedBatchSchema` + `LlmSurface` contract. Bypasses `consolidateWindow`'s cosine prefilter (observations have no embeddings → recency window + direct `llm.object` call). Silent-skip when `!isEnabled()` / `{ok:false}` / throw; observations ALWAYS retained. Debounce trigger from the ingest path (every `minObservations` OR `minIntervalMs`); fire-and-forget, never blocks the 202.

**Hook scripts + MCP tool:**
- `apps/claude-plugin/hooks/{session-start,user-prompt-submit,post-tool-use,stop}.sh` + shared `_post.sh` (2s curl timeout, `exit 0`, env `TH0TH_API_BASE`/`TH0TH_API_KEY`/`TH0TH_PROJECT_ID`) + `README.md`.
- MCP tool `th0th_hook_ingest` (POST /api/v1/hook/batch) for non-Claude hosts.

**Test-isolation note (extends Phase-1/2 rule):** Phase-3 tests do NOT mock `@th0th-ai/shared`. `observation-repository.test.ts` uses explicit temp `dbPath`; `hook-service.test.ts` injects `MemoryObservationStore` + fake `BridgeTrigger` + explicit `maxPending`; `observation-consolidation-job.test.ts` injects a fake `LlmSurface` + fake `memoryRepo` (the real `MemoryRepository` singleton is closed by `memory-crud.test.ts` in the full suite — the `memoryRepo` injection seam avoids the closed-DB landmine).

**Seams Phase 4/5/6 reuse:**
- Phase 4 (bootstrap): independent of observations; consumes `llm-client` + `project_map` PageRank.
- Phase 5 (auto-improve): consumes `observation:ingested` + the Observation store (`listRecent`) to detect patterns; may emit proposals.
- Phase 6 (handoffs): may consume the SessionStart hook (auto-inject a pending handoff on session-start) + the `observation:ingested` stream.
### Phase 4 — landed (commits c022731 specs, 1be1a1c config+event, ae296e7 bootstrap-service, 773a130 mcp+route+barrel, 3fec6fd tests)

**Config keys (new):**
- `memory.bootstrap: { enabled (envBool BOOTSTRAP_ENABLED=true); maxSeedMemories (envNum BOOTSTRAP_MAX_SEED_MEMORIES=8); centralityLimit (envNum BOOTSTRAP_CENTRALITY_LIMIT=10); gitLogLimit (envNum BOOTSTRAP_GIT_LOG_LIMIT=20); refreshEnabled (envBool BOOTSTRAP_REFRESH_ENABLED=true) }`. Additive nested block in `ServerConfig.memory` (alongside `decay`). `mergeConfig` shallow-merges `memory.bootstrap`. LLM summarization inherits the top-level `llm.enabled` gate (default false, env `RLM_LLM_ENABLED`).

**Services exported (path + symbol) — what Phase 5/6 consumes:**
- `packages/core/src/services/bootstrap/bootstrap-service.ts` → `BootstrapService` (ctor `BootstrapDeps { llm?, memoryRepo?, isBootstrapped?, symbolGraph?, gitRunner? }`; method `bootstrap(projectId, opts?): Promise<BootstrapResult>`), pure helpers `scanSignals`, `summarizeWithLlm`, `ruleBasedSeed`, `storeSeeds`, `countSignals`, `SeedMemoriesSchema` (zod, bounded list), singleton `bootstrapService`, `getBootstrapService()`/`resetBootstrapService()`. Types: `BootstrapSeed`, `BootstrapSignals`, `BootstrapResult`, `BootstrapOptions`, `BootstrapDeps`, `MemoryRepoSeam`, `CentralitySource`, `GitRunner`, `SeedType`, `BootstrapSource`, `SeedMemories`.
- Core barrel re-exports Phase-4 bootstrap symbols from `packages/core/src/index.ts` (consumed by routes via `@th0th-ai/core`).

**Idempotency marker scheme:**
- A seed memory is stored with `tags: ["bootstrap", "bootstrap:<projectId>"]`. The default `MemoryRepoSeam.hasBootstrapMarker(projectId)` queries `SELECT 1 FROM memories WHERE project_id = ? AND tags LIKE '%bootstrap:<projectId>%' AND deleted_at IS NULL LIMIT 1`. A second `bootstrap()` without `force` returns `{ bootstrapped:false, skipped:true, reason:"already-bootstrapped" }` — no inserts, no event. `force:true` refresh stores a fresh batch alongside priors (no delete; the consolidation job may SUPERSEDE them later). The marker is injectable (`isBootstrapped` dep) so tests stay deterministic and dodge the closed-singleton landmine. PG marker query falls back to "not bootstrapped" (`getDb()` is SQLite-only) — a future `bootstrap_state` table can replace this.

**`bootstrap:completed` event shape (EventMap):**
- `{ projectId: string; bootstrapId: string; seedMemoryIds: string[]; source: "llm" | "rule-based"; signalCount: number; memoryCount: number }`. Published once after `storeSeeds` returns ≥1 id. NOT published on no-op (`skipped:true`) or empty-signal (`source:"none"`) runs.

**MCP tool + route:**
- `th0th_bootstrap` in `TOOL_DEFINITIONS` (POST `/api/v1/bootstrap`; `projectId` required, optional `projectPath` + `force`). Dispatch is the generic POST path (`apps/mcp-client/src/index.ts`).
- `apps/tools-api/src/routes/bootstrap.ts` (Elysia, prefix `/api/v1/bootstrap`): 423 when `memory.bootstrap.enabled=false`; 400 on empty `projectId`; 200 + `{ success, data: BootstrapResult }`. Wired into `apps/tools-api/src/index.ts` via `.use(bootstrapRoutes)` after `.use(hookRoutes)`.

**Silent-degradation contract (mirrors Phase-2/3):**
- LLM off (`!isEnabled()`) → rule-based seeds from README + git log + package.json (`ruleBasedSeed`, max 3, importance 0.6, level PROJECT=1). LLM `{ok:false}`/throw → same fallback. Empty signal bundle (`signalCount===0`) → short-circuit `noopResult("no-signals")` BEFORE any LLM call. `storeSeeds` throw → `noopResult("insert-failed")`. Outer `bootstrap()` never throws to caller.

**Centrality reuse (no reinvention):**
- Consumes `SymbolGraphService.getTopCentralFiles(projectId, limit)` (`packages/core/src/services/symbol/symbol-graph.service.ts:272`) — the existing PageRank ETL output. If the project is not indexed, returns `[]` (caught, not thrown). The `CentralitySource` seam is injectable for tests.

**Test-isolation note (extends Phase-1/2/3 rule):** `bootstrap-service.test.ts` does NOT mock `@th0th-ai/shared`. It injects a fake `MemoryRepoSeam` (captures inserts + controls `hasBootstrapMarker`), a fake `LlmSurface` (enabled/disabled/failing), a fake `CentralitySource`, and a fake `GitRunner`; uses a temp project root with fixture README/docs/manifest files for `scanSignals`. The single P4-SEARCH-01 integration block resets the `MemoryRepository` singleton to a temp dataDir (mirrors `memory-crud.test.ts`) and restores it in `afterEach` — this is the proven pattern; no process-wide shared-config mock is added.

**Seams Phase 5/6 reuse:**
- Phase 5 (auto-improve): may consume the `bootstrap:<projectId>` seed memories (query via `tags LIKE` or the `MemoryRepoSeam.hasBootstrapMarker` seam) as a baseline for proposed edits; may also consume `bootstrap:completed` as a trigger.
- Phase 6 (handoffs): may consume the SessionStart hook (Phase 3) to auto-inject a pending handoff; the `bootstrap:<projectId>` seed memories give initial project context on session start. The `MemoryRepoSeam` + `LlmSurface` ctor-seam pattern is the reusable test-isolation template.
- Phase 7 (compression): unaffected; seed memories have no embeddings (FTS-only), so they do not enter the vector-search/compression paths.

### Phase 6 — landed (commits d3ccd2e specs, 60e799b config+event+prisma, 4d8ac60 store+service+injector+barrel, 8f2f0a0 mcp+route, 1a4bc40)

**Config keys (new):**
- `handoffs: { enabled (envBool HANDOFFS_ENABLED=true) }`. Additive top-level block in `ServerConfig`. `mergeConfig` shallow-merges `handoffs`. Default-on (begin/accept/cancel have no LLM dep; R7 summary-polish inherits `llm.enabled`).

**Services exported (path + symbol) — what Phase 5/7/8 consumes:**
- `packages/core/src/data/handoff/handoff-repository.ts` → `HandoffStore` (interface), `MemoryHandoffStore` (in-memory fallback), `SqliteHandoffStore` (lazy open, WAL + busy_timeout=3000, `handoffs` table + 3 indexes), `getHandoffStore()`/`resetHandoffStore()` (factory mirrors ObservationStore), `newHandoffId()`, `HANDOFF_STATUSES`, `HandoffRecord`/`HandoffStatus` types.
- `packages/core/src/services/handoff/handoff-service.ts` → `HandoffService` (ctor `HandoffDeps { store?, memoryRepo?, llm?, idFactory? }`; methods `begin(input): Promise<BeginResult>`, `accept({id, projectId?}): Promise<AcceptCancelResult>`, `cancel({id, projectId?}): Promise<AcceptCancelResult>`, `listPending(projectId, targetAgent?): HandoffRecord[]`), pure helpers `buildHandoffMemoryInput`, `formatMemoryContent`, singleton `getHandoffService()`/`resetHandoffService()`. Types: `BeginHandoffInput`, `BeginResult`, `AcceptCancelResult`, `HandoffMemorySeam`, `HandoffDeps`.
- `packages/core/src/services/handoff/handoff-auto-injector.ts` → `HandoffAutoInjector` (ctor takes a `HandoffService`; `start()` returns an unsubscribe; subscribes `observation:ingested` → on `source:"session-start"` calls `listPending` + logs).
- Core barrel re-exports Phase-6 handoff symbols from `packages/core/src/index.ts` (consumed by routes via `@th0th-ai/core`).

**Handoff table schema (additive, both backends):**
- SQLite: new `handoffs` table (`id TEXT PK, project_id, source_session_id, target_agent, summary, open_questions_json, next_steps_json, files_json, status(open|accepted|expired), created_at, accepted_at`) + 3 indexes (`idx_handoffs_project_status`, `idx_handoffs_target_agent`, `idx_handoffs_created`). DB file `handoffs.db` (WAL + busy_timeout=3000, separate from memories.db/observations.db). No ALTER (new table).
- PG: additive Prisma `Handoff` model (`@@map("handoffs")`, indexes on `[projectId, status]` + `[targetAgent, status]`). No PgHandoffStore code yet (SQLite-canonical runtime state, like observations/synapse_sessions/index_jobs).

**Status state machine:** `open` → `accepted` (via `accept`, sets `accepted_at`, emits `handoff:accepted`) | `open` → `expired` (via `cancel`, no event). Both terminal. `accept`/`cancel` on missing/non-open/project-mismatch → `{ok:false, reason}` (never a silent no-op). Defense-in-depth: the SQLite `setStatus` uses `WHERE status='open'`; the service post-checks `updated.status !== target`.

**`handoff:accepted` event shape (EventMap):**
- `{ handoffId: string; projectId?: string; sourceSessionId?: string; targetAgent?: string; acceptedAt: number }`. Published once after a successful `open`→`accepted` transition. NOT published on missing/non-open/expired/throw.

**Dual-write to memory (searchability):**
- On `begin`, a `conversation` memory is stored via `MemoryRepository.insert` with `tags:["handoff","handoff:<id>","handoff:<projectId>"]`, `level:PROJECT(1)` (so it passes the FTS `level <= USER` filter — Phase-4 correction), `importance:0.7`, `embedding:[]` (FTS-only, consistent with bootstrap seeds), `metadata.source:"handoff"`. Searchable via `MemoryRepository.fullTextSearch`. Best-effort (memory insert throw → `memoryId:null`, begin still ok).

**Auto-inject seam (consumes Phase-3 `observation:ingested`):**
- `HandoffAutoInjector` subscribes `observation:ingested`; on `source:"session-start"` calls `service.listPending(projectId, agentId?)` + logs count. Deterministic surfacing primitive is `listPending` (recall path / `th0th_handoff_list_pending` MCP tool). When the Phase-3 hook is not installed, the event never fires and `listPending` still works (graceful degrade). Never blocks; never throws. Justification: reusing the typed `observation:ingested` seam keeps a single integration bus (cross-cutting §3) and avoids coupling the memory recall path to the handoff table.

**MCP tools + route (new):**
- `th0th_handoff_begin` / `th0th_handoff_accept` / `th0th_handoff_cancel` / `th0th_handoff_list_pending` (POST `/api/v1/handoff/{begin,accept,cancel,list}`) in `TOOL_DEFINITIONS`.
- `apps/tools-api/src/routes/handoff.ts` (Elysia prefix `/api/v1/handoff`): 4 POST handlers; 423 when `handoffs.enabled=false`; 400 on missing `projectId`/`id`; 200 + `{success, data}`. Wired into `apps/tools-api/src/index.ts` via `.use(handoffRoutes)` after `.use(bootstrapRoutes)`. Swagger tag `handoffs`.

**Silent-degradation contract (mirrors Phase-2/3/4):**
- Optional LLM summary-polish: only when `llm.isEnabled()` AND `summary===""`. `{ok:false}`/throw → empty summary. Never blocks begin. Default-off (NF3).
- Store insert throws → `{ok:false, reason:"store-failed"}`, no event. Memory insert throws → `memoryId:null`, begin still ok. `accept`/`cancel` on missing/non-open/project-mismatch → `{ok:false, reason}`. `listPending` throws → `[]`. Outer methods never throw to caller.

**Backend-polymorphic dispatch pattern:** use `getHandoffStore()`. Never re-introduce `isPostgresEnabled()` short-circuits (NF1).

**Test-isolation note (extends Phase-1/2/3/4 rule):** `handoff-service.test.ts` does NOT mock `@th0th-ai/shared`. It injects `MemoryHandoffStore` + fake `HandoffMemorySeam` + fake `LlmSurface` + deterministic `idFactory`. The single P6-SEARCH-01 block resets the MemoryRepository singleton to a temp DB (mirrors P4-SEARCH-01) + restores it. `handoff-repository.test.ts` uses explicit temp `dbPath`. No `mock.module`.

**Seams Phase 5/7/8 reuse:**
- Phase 5 (auto-improve): may consume `handoff:accepted` as a trigger + `HandoffService.listPending` + the Observation store (`listRecent`) + Synapse sessions to detect patterns; the handoff dual-write memories + bootstrap seed memories give a baseline for proposed edits.
- Phase 7 (compression): unaffected; handoff dual-write memories have no embeddings (FTS-only).
- Phase 8 (web UI): `HandoffService.listPending` + `getById` give a read surface for a handoff list view.

### Phase 5 — landed (commits a4c86ff specs, d42086a config+event+table+prisma, d3242cb AutoImproveJob, ba971b0 mcp+route+barrel, 67e9ed6 tests+fix+validation)

**Config keys (new):**
- `memory.autoImprove: { enabled (envBool AUTO_IMPROVE_ENABLED=true); reviewGate (envBool AUTO_IMPROVE_REVIEW_GATE=false); minObservations (envNum AUTO_IMPROVE_MIN_OBS=8); minIntervalMs (envNum AUTO_IMPROVE_MIN_INTERVAL_MS=300_000); maxWindow (envNum AUTO_IMPROVE_MAX_WINDOW=16); minQueryHits (envNum AUTO_IMPROVE_MIN_QUERY_HITS=3); minFileHits (envNum AUTO_IMPROVE_MIN_FILE_HITS=3); minFixHits (envNum AUTO_IMPROVE_MIN_FIX_HITS=2) }`. Additive nested block in `ServerConfig.memory` (alongside `decay` + `bootstrap`). `mergeConfig` shallow-merges `memory.autoImprove`. LLM enrichment inherits the top-level `llm.enabled` gate (default false, env `RLM_LLM_ENABLED`).

**Services exported (path + symbol) — what Phase 7/8 consumes:**
- `packages/core/src/data/proposal/proposal-repository.ts` → `ProposalStore` (interface), `MemoryProposalStore` (in-memory fallback), `SqliteProposalStore` (lazy open, WAL + busy_timeout=3000, `proposals` table + 2 indexes), `getProposalStore()`/`resetProposalStore()` (factory mirrors HandoffStore/ObservationStore), `newProposalId()`, `PROPOSAL_STATUSES`, `ProposalStatus`, `PROPOSAL_KINDS`, `ProposalKind`, `ProposalPayload` (typed union), `ProposalRecord`. Types: `CreateMemoryPayload`/`UpdateMemoryPayload`/`TagMemoryPayload`.
- `packages/core/src/services/jobs/auto-improve-job.ts` → `AutoImproveJob` (ctor `AutoImproveJobOptions { llm?, observationStore?, proposalStore?, memoryRepo?, minObservations?, minIntervalMs?, maxWindow?, thresholds?, reviewGate?, idFactory? }`; methods `maybeRun(projectId)` debounce fire-and-forget, `runOnce(projectId): Promise<AutoImproveResult>`, `approve(id, projectId?, source?): Promise<ApproveRejectResult>`, `reject(id, projectId?, reason?): Promise<ApproveRejectResult>`, `listPending(projectId): ProposalRecord[]`), pure helpers `detectPatterns(observations, thresholds): PatternCandidate[]`, `enrichWithLlm(candidates, observations, surface)`, `ProposalEnrichmentSchema`, singleton `autoImproveJob` + `getAutoImproveJob()`/`resetAutoImproveJob()`. Types: `AutoImproveJobOptions`, `AutoImproveResult`, `PatternThresholds`, `PatternCandidate`, `ProposalEnrichment`, `MemoryApplySeam`, `ApproveRejectResult`.
- Core barrel re-exports Phase-5 symbols from `packages/core/src/index.ts` (consumed by routes via `@th0th-ai/core`).

**Proposals table schema (additive, both backends):**
- SQLite: new `proposals` table (`id TEXT PK, project_id, kind, target_memory_id?, payload_json, rationale, status(pending|approved|rejected), created_at INTEGER, decided_at INTEGER?`) + 2 indexes (`idx_proposals_project_status`, `idx_proposals_created`). DB file `proposals.db` (WAL + busy_timeout=3000, separate from memories.db/observations.db/handoffs.db). No ALTER (new table).
- PG: additive Prisma `Proposal` model (`@@map("proposals")`, index on `[projectId, status]`). No PgProposalStore code yet (SQLite-canonical runtime state, like observations/handoffs/synapse_sessions/index_jobs).

**Status state machine:** `pending` → `approved` (via approve, applies the edit via memoryRepo, sets decidedAt, emits memory:auto-improved) | `pending` → `rejected` (via reject, no apply, no event). Both terminal. approve/reject on missing/non-pending/project-mismatch/apply-throw → `{ok:false, reason}` (never a silent no-op). Defense-in-depth: SqliteProposalStore `setStatus` uses `WHERE status='pending'`; the service post-checks `updated.status !== target`.

**`memory:auto-improved` event shape (EventMap):**
- `{ proposalId: string; projectId?: string; kind: "memory.create"|"memory.update"|"memory.tag"; targetMemoryId?: string; status: "approved"; appliedAt: number; source: "llm"|"rule-based" }`. Published once after a successful apply (auto-approve OR explicit approve). NOT published on reject/no-op/throw/non-pending.

**Pattern detection (pure, rule-based, LLM-optional):**
- `detectPatterns(observations, thresholds)` is PURE + total (bad payloadJson skipped via try/catch, never thrown). Signals: `user-prompt` recurring query (normalized: lowercase, stopword-strip, top-3 longest tokens sorted) ≥ minQueryHits (3) → `memory.create` (PATTERN); `post-tool-use` recurring filePath (repo-relative normalized) ≥ minFileHits (3) → `memory.create` (CODE); `post-tool-use` recurring tool:dir-bucket fix signature ≥ minFixHits (2) → `memory.create` (PATTERN). Each candidate carries a stable `signalKey` for dedup within a run; window bounded by `maxWindow` (16). Rule-based detection runs FIRST and unconditionally; pattern detection NEVER requires the LLM.
- `enrichWithLlm`: when `llm.isEnabled()`, a single `surface.object(prompt, ProposalEnrichmentSchema)` refines content + rationale by signalKey. `{ok:false}`/throw/empty/invalid-kind → candidates verbatim (silent degrade; never throws, never blocks).

**Review-gate vs auto-approve (default auto-approve + logging):**
- `memory.autoImprove.reviewGate` (default false). When false (default), `runOnce` auto-applies each pending proposal in the SAME run by calling `this.approve(record.id, projectId, source)` — single code path, so the state machine + event emission is identical to explicit approval. `logger.info("proposal:auto-approved", { id, projectId, kind })` records the decision (audit trail = the row's decidedAt + the memory:auto-improved event + the log line). When true, proposals stay pending for surfacing via `th0th_list_proposals` + `th0th_approve_proposal`.

**Audit trail:** every approved/rejected proposal carries `status` + `decidedAt` + `rationale`; approved proposals additionally emit `memory:auto-improved` + a `proposal:auto-approved`/`proposal:approved`/`proposal:rejected` log line. The proposals row IS the audit record (no separate audit table).

**MCP tools + route (new):**
- `th0th_list_proposals` / `th0th_approve_proposal` / `th0th_reject_proposal` (POST `/api/v1/proposal/{list,approve,reject}`) in `TOOL_DEFINITIONS`.
- `apps/tools-api/src/routes/proposals.ts` (Elysia prefix `/api/v1/proposal`): 3 POST handlers; 423 when `memory.autoImprove.enabled=false`; 400 on missing `projectId`/`id`; 200 + `{ success, data }`. Wired into `apps/tools-api/src/index.ts` via `.use(proposalRoutes)` after `.use(handoffRoutes)`. Swagger tag `proposals`.

**Silent-degradation contract (mirrors Phase-2/3/4/6):**
- LLM off (`!isEnabled()`) → rule-based candidates only → still produces proposals. LLM `{ok:false}`/throw/timeout → rule-based candidates verbatim (same count). Store insert throw → proposal skipped, job returns noop. Memory apply throw → `approve` returns `{ok:false, apply-failed}`, status stays pending. `runOnce` noop when `<2` observations or no patterns. Outer job/service methods NEVER throw to the caller.

**Backend-polymorphic dispatch pattern:** use `getProposalStore()`. Never re-introduce `isPostgresEnabled()` short-circuits.

**Test-isolation note (extends Phase-1..6 rule):** `auto-improve-job.test.ts` does NOT mock `@th0th-ai/shared`. It injects `MemoryProposalStore` + `MemoryObservationStore` (pre-loaded with deterministic observations) + fake `MemoryApplySeam` (captures inserts/updates; controls failNext) + fake `LlmSurface` (enabled/disabled/failing/throwing/enriching) + deterministic `idFactory`. No `mock.module`. No real MemoryRepository singleton is touched (the closed-singleton landmine from memory-crud.test.ts is avoided via the `memoryRepo` ctor-seam — mirrors ObservationConsolidationJob/BootstrapDeps/HandoffDeps). `proposal-repository.test.ts` uses explicit temp `dbPath`.

**Bug fixed in 67e9ed6 (load-bearing for P5-APPROVE-01):** `AutoImproveJob.approve` previously mutated a local `row.targetMemoryId` that was then shadowed by the store's `getById` result, so `memory:auto-improved` emitted `targetMemoryId=undefined` for `memory.create` proposals even though the memory had been applied. The fix captures the freshly-assigned id from `applyProposal` and surfaces it onto the returned record + event payload AFTER the status flip.

**Seams Phase 7/8 reuse:**
- Phase 7b (salience): auto-improved `memory.create` proposals are inserted with `embedding:[]` (FTS-only, consistent with bootstrap/handoff seeds). They enter FTS search but NOT the vector stream unless a future step re-embeds them. Salience-judge can still score them on insert. Rerank (7a) + compression (7d) are unaffected.
- Phase 8 (web UI): `AutoImproveJob.listPending` + `GET`-equivalent `/api/v1/proposal/list` give a read surface for a proposal-review view.
### Phase 7 — (pending)
### Phase 8 — (pending)

## Commit ledger (append)
| Phase | Commit(s) | Summary |
| --- | --- | --- |
| 0 | 538fe66 4e27925 c25f9d3 b84ea3e be65877 a1e5ca2 3fb4eb1 | quick wins + specs + validation |
| 1 | befa3cb e49ffa9 12fe002 1ccb42c | memory foundation: decay/pinned/soft-delete, llm-client+consolidator+polymorphic job+read-side, durable sessions/jobs |
| 2 | ebcc202 5b0ba18 6a7598f 6cb5edb f2acceb | query understanding: config gate, rewrite+hyde+cache service, search fan-out, search:query-rewritten/reranked events, tests |
| 3 | 9f8b7a1 f28c30e b950df7 8fb0cac | passive capture: hooks config + Observation store (WAL) + writer queue + 429 + HookService + Elysia routes + consolidation bridge + Claude Code hook scripts + th0th_hook_ingest + observation:ingested event, tests |
| 4 | c022731 1be1a1c ae296e7 773a130 3fec6fd | bootstrap from repo: memory.bootstrap config + bootstrap:completed event + BootstrapService (scan git/README/docs/manifests/centrality, LLM llmObject+SeedMemoriesSchema, rule-based fallback, idempotent bootstrap:<projectId> tag marker, silent degradation) + th0th_bootstrap MCP tool + /api/v1/bootstrap route + barrel re-exports, tests |
| 6 | d3ccd2e 60e799b 4d8ac60 8f2f0a0 1a4bc40 | cross-session handoffs: handoffs.enabled config + handoff:accepted event + HandoffStore (SQLite WAL handoffs.db + Memory fallback + factory) + HandoffService (begin/accept/cancel/listPending, state machine open→accepted|expired, dual-write conversation memory PROJECT/0.7/handoff:<id> tags/no embedding, optional LLM summary-polish default-off silent-degrade, never throws) + HandoffAutoInjector (observation:ingested session-start → listPending) + 4 MCP tools + /api/v1/handoff routes + Prisma Handoff model + barrel re-exports, tests |
| 5 | a4c86ff d42086a d3242cb ba971b0 67e9ed6 | auto-improvement loop: memory.autoImprove config (default-on detect, reviewGate=false auto-approve, env AUTO_IMPROVE_*) + memory:auto-improved event + ProposalStore (SQLite WAL proposals.db + Memory fallback + factory, no isPostgresEnabled) + AutoImproveJob (ctor-seam, detectPatterns pure rule-based query/file/fix signals, enrichWithLlm optional silent-degrade, runOnce debounce, reviewGate=false auto-approve reuses approve() single code path, apply/reject state machine pending→approved|rejected with defense-in-depth WHERE guard, listPending) + 3 MCP tools + /api/v1/proposal routes + Prisma Proposal model + barrel re-exports + approve targetMemoryId fix, tests |
