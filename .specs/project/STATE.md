# massa-th0th Spec State

## Active
- projectId: `massa-th0th`
- workflowSessionId: `spec-virtual-lantern-plan`
- workflow: spec-driven
- feature: `phase-2-query-understanding` (complete — same-author verified PASS)
- branch: main

## Next Step
Phase 2 done. Next session: Phase 3 (passive memory capture — observation ingestion + hooks) per `i-want-to-understand-virtual-lantern.md`. Phase 3 consumes the `llm-client` surface + the `search:query-rewritten` / `search:reranked` EventBus events landed here, plus Phase 1's `SessionStore`/`JobStore`.

## Decisions
- Scope this session = Phase 0 (0a-0d) only. Phases 1-8 deferred.
- Method = inline, one task at a time (user choice).
- SQLite-canonical; no migrations in Phase 0.
- 0c delete = HARD delete + sever GraphStore edges. Soft-delete deferred to Phase 1 (needs `deleted_at` column + recall filtering; out of Phase 0 no-migration scope). [accepted assumption]
- 0c update must re-embed + re-index FTS5 on content change (SQLite external-content table).
- This repo NOT in th0th index → direct source reads authoritative; `th0th_search` N/A here.
- 0a: full shared 34-ext list for upload (incl .md/.json/.yaml); user confirmed updating the old README.md-excluded test. Single source = `DEFAULT_ALLOWED_EXTENSIONS` in shared config.
- 0b: new `search.autoReindexMaxFiles` config (default 200, env `AUTOREINDEX_MAX_FILES`); 3 sites derive; fixed hardcoded `>100` bug at contextual-search-rlm.ts:345→maxSyncFiles.

## Completion (Phase 0)
- Commits: 538fe66 (specs), 4e27925 (0a), c25f9d3 (0b), b84ea3e (0c), be65877 (0d), a1e5ca2 (edge tests+validation).
- Gates: `bun run test` 609 pass / 0 fail (61 pre-existing env-dependent skips); `bun run type-check` 5/5 clean; `bun run lint` N/A (no package-level lint task configured).
- Independent verifier: PASS, all 3 discrimination-sensor mutants killed, every AC has file:line evidence. Report: `.specs/features/phase-0-quick-wins/validation.md`.
- Residual (non-blocking): config-failure fallback branch (0a) and the `>100→maxSyncFiles` literal (0b) covered by inspection/transitive, not direct tests.

## Completion (Phase 1)
- Commits: befa3cb (specs), e49ffa9 (item 1 — decay/pinned/soft-delete), 12fe002 (item 2 — llm-client/consolidator/job/read-side), 1ccb42c (item 3 — durable sessions/jobs).
- Gates: `bun run test` 677 pass / 0 fail / 46 skip (baseline 611 → +66); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole agent — caveat labeled in validation.md). All 3 discrimination mutants killed. Report: `.specs/features/phase-1-memory-foundation/validation.md`.
- Landed: pure `decayScore` (+DEFAULT_DECAY_PARAMS) replacing temporalScore; `pinned`+`deleted_at` columns both backends (additive); soft-delete recall filtering; shared `llm-client` (default-off, silent degrade) + top-level `llm` config (Ollama defaults, `compression.llm` deprecated alias); `consolidator` (zod-enforced ConsolidatedBatch, cosine prefilter); backend-polymorphic `MemoryConsolidationJob` (no isPostgresEnabled short-circuit, decay+prune-soft+merge phases, SUPERSEDES edges, `memory:consolidated` event, ConsolidationStats extended); read-side hides superseded; durable `SessionStore`/`SqliteJobStore` (write-through + lazy-load + crash recovery).
- Accepted assumptions (non-blocking): PG parity for synapse_sessions/index_jobs deferred (SQLite-canonical runtime state, interfaces portable); WorkingMemoryBuffer snapshot best-effort; edge batch-id via SQLite `evidence` vs PG `metadata`.
- Verified source facts (corrections to plan): `GraphStore.createEdge` (not addEdge); SQLite edge cols `source_id/target_id/relation_type` (no metadata); `temporalScore` was at :200 not :146; only `envNum` helper existed (added envBool/envString); true baseline 611 (plan said 609).

## Completion (Phase 2)
- Commits: ebcc202 (specs — prior invocation), 5b0ba18 (config schema), 6a7598f (service + events), 6cb5edb (wire fan-out into search), f2acceb (tests).
- Gates: `bun run test` 700 pass / 0 fail / 46 skip (baseline 677 → +23); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole resumed agent — caveat labeled in validation.md). Discrimination mutant killed. Report: `.specs/features/phase-2-query-understanding/validation.md`.
- Landed: `search.queryUnderstanding` config block (default-off, env `SEARCH_QUERY_UNDERSTANDING_ENABLED`); `query-understanding.ts` service (`rewriteQuery` via llmObject+zod, `hyde` LLM→existing-EmbeddingService embed, TTL+size-bounded cache, `QueryUnderstandingService.understand()`, injectable `QueryLlmSurface` + `EmbedFn`, `buildRewrittenFTSQuery`); `ContextualSearchRLM.search()` fan-out (original vector + HyDE vector via `searchByEmbedding` + rewritten-FTS → existing `fuseResults`), silent-degrade outer try/catch, `sessionId` threaded; `search:query-rewritten` + `search:reranked` EventBus events.
- Accepted assumptions (non-blocking): retrieval-quality test uses an in-memory RRF replica (spec §9 permitted; live test would need Ollama + collides with process-wide shared-config mock); `sessionId` threaded but Synapse-biased fusion deferred to later phase; defensive config readers (no-op in prod, prevents mock constructor crash).
- Verified source facts: `SQLiteVectorStore.searchByEmbedding(embedding, limit, projectId)` exists (line 610); `HybridSearch.rerank(SearchResult[][])` exists (line 85) but `ContextualSearchRLM.fuseResults` already accepts `SearchResult[][]` (used directly); `EmbeddingService.embed` at `data/chromadb/vector-store.ts:412`; `sanitizeFTS5Query` re-splits composed strings (rebuilt FTS query term-by-term instead).

## Verified Source Facts (grounded this session)
- file-collector.ts:9 hardcoded 8 exts; index-manager.ts:251-260 duplicated the 8-ext fallback. → fixed via shared `DEFAULT_ALLOWED_EXTENSIONS`.
- config security.allowedExtensions = 34-ext canonical list.
- MemoryRepository (SQLite) gained update/deleteById; PG gained update + deleteById (RETURNING) for union parity.
- MemoryGraphService.onMemoryDeleted(id) already existed (severs edges) — reused by controller.delete.
- 3 checkpoint tools now wired into tool-definitions + new routes/checkpoints.ts.
