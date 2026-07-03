# Handoff

## Snapshot
- feature: phase-7-retrieval-polish — COMPLETE, same-author verified (PASS)
- phase/task: Execute done; validation.md written
- completed: 7e characterization tests (etl-pipeline, smart-chunker, code-compressor, contextual-search-rlm e2e) + injected-deps ctor seam on ContextualSearchRLM; 7a `LLMJudgeReranker` (services/search/reranker.ts, llmObject + RerankVerdictSchema, top-K window=50, silent-degrade) wired into SearchController after applyBoost + optional `source:"llm-judge"` on `search:reranked`; 7b `SalienceJudge` (services/memory/salience-judge.ts) + caller-wins wire in MemoryController.store + `memory:salience-scored` event; 7c `GraphStore.bfsNeighbors(seedIds, depth)` (SQLite + Pg) + 3rd RRF stream in ContextualSearchRLM.search; 7d code-compressor LLM branch (regex-always-first fallback, metadata.compressionSource); 7f EmbeddingService relocated to services/embeddings/embedding-service.ts, 4 live importers + hybrid-search dead importer redirected, data/chromadb/ deleted. New config: `search.rerank { enabled, rerankWindow }`, `memory.autoImportance { enabled }`.
- in-progress: none
- next step: Phase 8 (Web UI, G5). Consumes the stable search/recall/memory surfaces (see STATE.md Next Step).
- blockers: none
- uncommitted files: none (STATE.md/FEATURES.json/HANDOFF.md/PHASE-INTEGRATION.md/validation.md updates pending this commit)
- branch: main; commits 3d7fa86 (Phase 7 specs — prior invocation), b201531 (7e), 2c043f2 (7a), 3716e66 (7b), d0adee1 (7c), 784fe00 (7d), 9bded69 (7f)

## Key decisions for Phase 3 (and later phases)
- Query understanding gate: `config.get("search").queryUnderstanding.enabled` (default `false`, env `SEARCH_QUERY_UNDERSTANDING_ENABLED`). Sub-keys `hydeEnabled` (default true), `cacheTtlMs` (300_000), `cacheMaxSize` (256). Read via `config.get("search").queryUnderstanding`; the service also has defensive readers that fall back to these defaults if the block is absent (process-wide shared-config mock landmine).
- Query-understanding service: `import { QueryUnderstandingService, rewriteQuery, hyde, buildRewrittenFTSQuery, QueryRewriteSchema } from "packages/core/src/services/search/query-understanding.js"`. Constructor takes `{ llmSurface?, embedFn?, cacheTtlMs?, cacheMaxSize? }` for test injection; defaults to the real `llm` handle + the existing `EmbeddingService` singleton.
- LLM surface contract (unchanged from Phase 1): `llmObject`/`llmComplete` never throw — they return `{ok:false}` on disabled/timeout/error. Treat `{ok:false}` as "fall through". `_setLlmEnabledForTesting` seam still available.
- EventBus: subscribe to `search:query-rewritten` (after a successful rewrite) and `search:reranked` (after the expanded fusion) via `eventBus` from `services/events/event-bus.ts`. Phase 3's observation/hook ingestion should listen here if it wants to capture query-expansion signal.
- Fan-out shape: `ContextualSearchRLM.search()` now builds `resultSets: SearchResult[][]` (2 streams when QU off or degraded; 3 streams — vector + rewritten-FTS + HyDE — when on). Fused via the existing `fuseResults` (RRF). `sessionId?: string` is an optional option for future Synapse-biased fusion (not yet consumed).
- Embeddings: HyDE reuses the existing `EmbeddingService` (`data/chromadb/vector-store.ts:364`, `.embed(text)`). Vector-by-vector search uses `SQLiteVectorStore.searchByEmbedding(embedding, limit, projectId)` (line 610). No new provider spawned.
- Test isolation (still applies): bun `mock.module("@massa-th0th/shared")` is process-wide. The Phase-2 tests inject a fake `QueryLlmSurface` + fake `embedFn` directly (no config, no DB, no network) to avoid the collision. For new search/memory tests, prefer injection over config-mocking.

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
- Hook scripts: `apps/claude-plugin/hooks/{session-start,user-prompt-submit,post-tool-use,stop}.sh` + shared `_post.sh`. 2s curl timeout, exit 0, env `MASSA_TH0TH_API_BASE` / `MASSA_TH0TH_API_KEY` / `MASSA_TH0TH_PROJECT_ID`. README in the same dir.
- MCP tool: `hook_ingest` (POST /api/v1/hook/batch) for non-Claude hosts.
- Core exports: Phase-3 hook symbols are exported from `packages/core/src/index.ts` (and consumed by routes via `@massa-th0th/core`).
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
- Bootstrap service: `import { BootstrapService, getBootstrapService, SeedMemoriesSchema } from "packages/core/src/services/bootstrap/bootstrap-service.js"` (or via `@massa-th0th/core`). `bootstrap(projectId, { projectPath?, force? })` → `BootstrapResult`. Idempotent (marker = `bootstrap:<projectId>` tag); `force:true` refresh.
- Config block: `config.get("memory").bootstrap` = `{ enabled(true), maxSeedMemories(8), centralityLimit(10), gitLogLimit(20), refreshEnabled(true) }`. Env knobs: `BOOTSTRAP_ENABLED`, `BOOTSTRAP_MAX_SEED_MEMORIES`, `BOOTSTRAP_CENTRALITY_LIMIT`, `BOOTSTRAP_GIT_LOG_LIMIT`, `BOOTSTRAP_REFRESH_ENABLED`. LLM summarization inherits top-level `llm.enabled`.
- Seed memories: stored as normal `memories` rows with `tags:["bootstrap","bootstrap:<projectId>"]`, `embedding:[]` (FTS-only, not vector-searchable), `level: PROJECT(1)`, `metadata.source:"bootstrap"`. Searchable via `MemoryRepository.fullTextSearch`.
- Idempotency marker: `tags LIKE '%bootstrap:<projectId>%' AND deleted_at IS NULL`. Injectable `MemoryRepoSeam.hasBootstrapMarker` (default queries DB; PG falls back to "not bootstrapped" — `getDb()` is SQLite-only).
- Silent degradation: LLM off/`{ok:false}`/throw → `ruleBasedSeed` (README + git log + package.json, max 3, importance 0.6). Empty signals → `noopResult("no-signals")`. Never throws.
- EventBus: `bootstrap:completed` ({ projectId, bootstrapId, seedMemoryIds[], source llm|rule-based, signalCount, memoryCount }) added to EventMap. Published on ≥1 stored seed only.
- MCP tool: `bootstrap` (POST /api/v1/bootstrap; projectId required, optional projectPath + force). Route: 423 when disabled, 400 on empty projectId.
- Centrality reuse: consumes `SymbolGraphService.getTopCentralFiles(projectId, limit)` — existing PageRank ETL output. No reimplementation. Empty when not indexed (caught).
- Test isolation (still applies): bootstrap tests inject fake `MemoryRepoSeam` + `LlmSurface` + `CentralitySource` + `GitRunner` (no shared-config mock). P4-SEARCH-01 resets the MemoryRepository singleton to a temp DB (mirrors memory-crud.test.ts) + restores it.

## Same-author caveat (Phase 4)
Sole agent verified its own work — no independent verifier sub-agent. Mitigations: per-AC file:line evidence, discrimination sensor (idempotency-guard mutant killed), objective gate (754/0). See `.specs/features/phase-4-bootstrap/validation.md`.

## Phase 6 handoff (PASS — same-author verified)

- in-progress: none
- next step: Phase 5 (auto-improvement loop — G7). May consume the `handoff:accepted` event + the Observation store (`listRecent`) + Synapse sessions to detect patterns. The `bootstrap:<projectId>` seed memories (Phase 4) + the handoff dual-write memories (Phase 6) give a baseline for proposed edits.
- blockers: none
- uncommitted files: none (this commit)
- branch: main; commits d3ccd2e (specs), 60e799b (config+event+prisma), 4d8ac60 (store+service+injector+barrel), 8f2f0a0 (mcp+route), 1a4bc40 (tests+validation).

## Key decisions for Phase 5+ (and later phases)
- Handoff service: `import { HandoffService, getHandoffService, buildHandoffMemoryInput } from "packages/core/src/services/handoff/handoff-service.js"` (or via `@massa-th0th/core`). `begin({projectId, sourceSessionId?, targetAgent?, summary?, openQuestions?, nextSteps?, files?})` → `{ok, id, status:"open", memoryId}`. `accept({id, projectId?})` → `{ok, handoff}` (emits `handoff:accepted`). `cancel({id, projectId?})` → `{ok, handoff}`. `listPending(projectId, targetAgent?)` → open handoffs oldest-first.
- Config block: `config.get("handoffs")` = `{ enabled(true) }`. Env `HANDOFFS_ENABLED`. begin/accept/cancel have no LLM dep; optional summary-polish inherits `llm.enabled`.
- Handoff store: `import { getHandoffStore, SqliteHandoffStore, MemoryHandoffStore, resetHandoffStore } from "packages/core/src/data/handoff/handoff-repository.js"`. SQLite-canonical (`handoffs.db`, WAL + busy_timeout=3000); MemoryHandoffStore fallback. Factory mirrors ObservationStore. PG parity via Prisma `Handoff` model (no PgHandoffStore code yet — SQLite-canonical like observations/synapse_sessions/index_jobs).
- State machine: `open` → `accepted` (via accept) | `expired` (via cancel). Both terminal. `accept`/`cancel` on missing/non-open/project-mismatch → `{ok:false, reason}` (never a silent no-op).
- Dual-write memory: on `begin`, a `conversation` memory is stored via `MemoryRepository.insert` with `tags:["handoff","handoff:<id>","handoff:<projectId>"]`, `level:PROJECT(1)`, `importance:0.7`, `embedding:[]` (FTS-only), `metadata.source:"handoff"`. Searchable via `MemoryRepository.fullTextSearch`.
- Auto-injector: `HandoffAutoInjector` (`services/handoff/handoff-auto-injector.ts`) subscribes `observation:ingested`; on `source:"session-start"` calls `listPending` + logs count. Deterministic surfacing primitive is `listPending` (recall path / `handoff_list_pending` MCP tool). Never blocks; never throws.
- EventBus: `handoff:accepted` ({ handoffId, projectId?, sourceSessionId?, targetAgent?, acceptedAt }) added to EventMap. Published only on a successful `open`→`accepted` transition.
- MCP tools: `handoff_begin` / `handoff_accept` / `handoff_cancel` / `handoff_list_pending` (POST /api/v1/handoff/{begin,accept,cancel,list}). Route: 423 when disabled, 400 on missing required fields.
- Silent degradation: empty summary + LLM off → stores empty/auto summary; LLM `{ok:false}`/throw → empty summary; store insert throws → `{ok:false, store-failed}`; memory insert throws → still ok with `memoryId:null`. Never throws.
- Test isolation (still applies): handoff tests inject `MemoryHandoffStore` + fake `HandoffMemorySeam` + fake `LlmSurface` (no shared-config mock). P6-SEARCH-01 resets the MemoryRepository singleton to a temp DB (mirrors P4-SEARCH-01) + restores it.

## Same-author caveat (Phase 6)
Sole agent verified its own work — no independent verifier sub-agent. Mitigations: per-AC file:line evidence, discrimination sensor (status-guard mutant killed, 2 failing tests), objective gate (791/0). See `.specs/features/phase-6-handoffs/validation.md`.

## Phase 5 handoff (PASS — same-author verified)

- in-progress: none
- next step: Phase 7 (retrieval + compression polish). Recommended order: 7e (test coverage) first, then 7a (rerank) / 7b (salience) / 7c (graph-neighbor stream) / 7d (LLM compression), 7f (dead-code removal) last. Phase 7b salience-judge may consume auto-improved memories; 7a rerank is unaffected by proposals; 7d compression is independent.
- blockers: none
- uncommitted files: none (this commit)
- branch: main; commits a4c86ff (specs), d42086a (config+event+table+prisma), d3242cb (AutoImproveJob), ba971b0 (mcp+route+barrel), 67e9ed6 (tests + approve fix + validation).

## Key decisions for Phase 7+ (and later phases)
- Auto-improve job: `import { AutoImproveJob, getAutoImproveJob, resetAutoImproveJob, detectPatterns, enrichWithLlm } from "packages/core/src/services/jobs/auto-improve-job.js"` (or via `@massa-th0th/core`). `runOnce(projectId)` → `{ improved, proposalsCreated, proposalsApplied, source }`. `approve(id, projectId?, source?)` → `{ ok, proposal?, reason? }` (emits `memory:auto-improved`). `reject(id, projectId?, reason?)` → `{ ok, proposal?, reason? }`. `listPending(projectId)` → pending proposals newest-first. `maybeRun(projectId)` = debounce trigger (fire-and-forget).
- Config block: `config.get("memory").autoImprove` = `{ enabled(true), reviewGate(false), minObservations(8), minIntervalMs(300000), maxWindow(16), minQueryHits(3), minFileHits(3), minFixHits(2) }`. Env `AUTO_IMPROVE_*`. `reviewGate=false` (default) = auto-approve on `runOnce`; `reviewGate=true` leaves proposals pending for surfacing.
- Proposal store: `import { getProposalStore, SqliteProposalStore, MemoryProposalStore, resetProposalStore, newProposalId } from "packages/core/src/data/proposal/proposal-repository.js"`. SQLite-canonical (`proposals.db`, WAL + busy_timeout=3000); MemoryProposalStore fallback. Factory mirrors HandoffStore/ObservationStore. PG parity via Prisma `Proposal` model (no PgProposalStore code yet — SQLite-canonical like observations/handoffs/synapse_sessions/index_jobs).
- State machine: `pending` → `approved` (via approve) | `rejected` (via reject). Both terminal. `approve`/`reject` on missing/non-pending/project-mismatch → `{ok:false, reason}` (never a silent no-op). Defense-in-depth: SqliteProposalStore `setStatus` uses `WHERE status='pending'`; service post-checks `updated.status !== target`.
- Pattern detection: `detectPatterns(observations, thresholds)` is PURE + total (bad payloadJson skipped, never thrown). Signals: `user-prompt` recurring query (top-3 stems, stopword-stripped) ≥ minQueryHits → `memory.create` (PATTERN); `post-tool-use` recurring filePath ≥ minFileHits → `memory.create` (CODE); `post-tool-use` recurring tool:bucket fix signature ≥ minFixHits → `memory.create` (PATTERN). Each candidate carries a stable `signalKey` for dedup.
- LLM enrichment: `enrichWithLlm(candidates, observations, surface)` runs ONLY when `surface.isEnabled()`; single `surface.object(prompt, ProposalEnrichmentSchema)` refines content + rationale by signalKey. `{ok:false}`/throw/empty → candidates verbatim. Rule-based detection runs FIRST and unconditionally; pattern detection NEVER requires the LLM.
- Apply: `applyProposal(record)` dispatches on kind: `memory.create` → `memoryRepo.insert` (fresh id `proposal-mem-<proposalId>-<rand>`, `embedding:[]`, `metadata.source:"auto-improve"`); `memory.update` → `memoryRepo.update(targetMemoryId, patch)`; `memory.tag` → `memoryRepo.update(targetMemoryId, {tags})`. Apply throws → approve returns `{ok:false, apply-failed}`, status stays pending. The freshly-assigned id is surfaced onto the returned record + event payload (fix in 67e9ed6).
- EventBus: `memory:auto-improved` ({ proposalId, projectId?, kind, targetMemoryId?, status:"approved", appliedAt, source:"llm"|"rule-based" }) added to EventMap. Published only on a successful apply (auto-approve OR explicit approve). NOT on reject/no-op/throw.
- MCP tools: `list_proposals` / `approve_proposal` / `reject_proposal` (POST /api/v1/proposal/{list,approve,reject}). Route: 423 when `memory.autoImprove.enabled=false`, 400 on missing required fields.
- Silent degradation: LLM off → rule-based proposals; LLM `{ok:false}`/throw → rule-based candidates verbatim; store insert throw → proposal skipped (job noop); memory apply throw → `{ok:false, apply-failed}` (status pending). Outer job/service methods NEVER throw.
- Test isolation (still applies): auto-improve tests inject `MemoryProposalStore` + `MemoryObservationStore` + fake `MemoryApplySeam` + fake `LlmSurface` (no shared-config mock; no real MemoryRepository touched — the closed-singleton landmine is avoided via the ctor-seam).
- Note for Phase 7b (salience): `memory.create` proposals are inserted with `embedding:[]` (FTS-only, consistent with bootstrap/handoff seeds). They enter FTS search but NOT the vector stream unless a future step re-embeds them. Salience-judge can still score them on insert.

## Same-author caveat (Phase 5)
Sole agent verified its own work — no independent verifier sub-agent. (A prior sibling invocation landed tasks 1–4; this invocation finished task 5: tests + the `approve` targetMemoryId fix + validation + ledger.) Mitigations: per-AC file:line evidence, discrimination sensor (pending-guard mutant killed, 1 failing test), objective gate (822/0). See `.specs/features/phase-5-auto-improve/validation.md`.

## Phase 8 handoff (PASS — same-author verified — FINAL phase)

- feature: phase-8-web-ui — COMPLETE; the plan (0→8) is now fully landed.
- in-progress: none
- next step: **none (plan complete).** Residual non-blocking enhancements are recorded in each phase's validation.md (PG-runtime parity for SQLite-canonical stores; EventBus-SSE live UI; syntax-highlight + richer markdown for the web UI; memory-search e2e for the 7c graph stream).
- blockers: none
- uncommitted files: none (the docs commit finalizes Phase 8)
- branch: main; commits bd5d888 (specs), 71f0727 (8a), 46c2995 (8b), 01971e3 (8c), 58a1d5e (8d), bbb888c (docs).

## Key decisions for Phase 8 (web UI)
- Serve strategy: Tools-API-served static at `/ui/*` (single port 3333, same-origin, no second process). `apps/tools-api/src/routes/web-ui.ts` reads files verbatim from `apps/web-ui/src/static/` (content-type map, traversal guard, `WEB_UI_ENABLED=false`→404, cwd-ancestor static-root resolution robust to dev/start/test cwds). Wired after `proposalRoutes`; `webUi` swagger tag.
- Zero-dep bundle: `apps/web-ui/src/static/{index.html, styles.css, app.js}` (plain HTML/CSS/JS, no SPA framework, no markdown/highlight lib). `app.js` is the single source for pure helpers (markdownToHtml, 5 view renderers, theme helpers) — exported on `globalThis.MASSA_TH0TH_UI` with the browser-init guarded by `typeof document` so `bun:test` can `require()` the same file. `apps/web-ui/src/index.ts` is a tsc anchor only (tsc rejects a pure-JS program).
- View → API (all read-only, pre-existing routes, NO new core logic): Projects `GET /api/v1/project/list`; Memory `POST /api/v1/memory/list`; Search `POST /api/v1/memory/search`; Handoffs `POST /api/v1/handoff/list`; Checkpoints `POST /api/v1/checkpoints/list`.
- Only route change: additive optional `level` filter on `POST /api/v1/memory/list` (SQLite `level = ?` + PG row filter; `MemoryRepository` already selects level; no service/repo/migration). Backward-compatible.
- Markdown: minimal vanilla renderer (headings/bold/italic/inline-code/fenced-code/lists/safe-links/paragraphs), HTML-escape first (raw `<script>` neutralized). Dark mode: `data-theme` + `localStorage["massa-th0th-ui-theme"]` + no-FOUC inline head script.
- Read-only guarantee: `FORBIDDEN_MUTATING_PATHS` (exhaustive mutating list). `web-ui-readonly.test.ts` asserts every `request()` target ∈ the 5 READ paths + no forbidden path is a target. Discrimination sensor: injecting `api.request("/memory/store")` fails 3 tests.
- Test gate: added `"test": "bun test"` to `apps/tools-api/package.json` — brings 11 pre-existing auth/checkpoints tests + 39 new web-ui tests into turbo (previously orphaned). Gates: core 893/0/46, mcp-client 7/0, tools-api 50/0; type-check 6/6.
- Accepted assumptions (non-blocking): zero browser build; tsc anchor file; markdown subset; no syntax highlighter; no live updates (refresh UI; SSE future); same-author verification.
