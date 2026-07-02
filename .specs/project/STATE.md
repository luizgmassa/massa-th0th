# massa-th0th Spec State

## Active
- projectId: `massa-th0th`
- workflowSessionId: `spec-virtual-lantern-plan`
- workflow: spec-driven
- feature: `phase-5-auto-improve` (complete — same-author verified PASS)
- branch: main

## Next Step
Phase 5 done. Next session: Phase 7 (retrieval + compression polish) per
`i-want-to-understand-virtual-lantern.md` (recommended order
0→1→2→3→4→6→5→7(e first, then 7a–7d, 7f last)→8). Phase 7a/7b may consume
auto-improved memories (normal rows; `memory.create` proposals have
`embedding:[]` so they enter FTS but not the vector stream unless re-embedded —
salience-judge 7b can score them; rerank 7a is unaffected). Phase 7d (LLM
compression) is independent. Phase 7e (test coverage) + 7f (dead-code removal)
gated last.

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

## Completion (Phase 3)
- Commits: 9f8b7a1 (specs), f28c30e (observation store + config + event), b950df7 (hook-service + writer-queue + 429), 8fb0cac (routes + bridge + hook scripts + mcp tool).
- Gates: `bun run test` 738 pass / 0 fail / 46 skip (baseline 700 → +38); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole agent — caveat labeled in validation.md). Discrimination mutant killed (saturation-check removal → P3-BACKPRESSURE-01 fails). Report: `.specs/features/phase-3-hook-capture/validation.md`.
- Landed: `hooks` config block (default-on ingestion, bridge inherits llm.enabled); `ObservationStore` (SQLite WAL + Memory fallback + factory); `WriterQueue` (promise-chain mutex + 429 on saturation); `HookService` (validate/normalize, fire-and-forget 202, batch atomic, observation:ingested event); Elysia routes `POST /api/v1/hook` + `/hook/batch`; `ObservationConsolidationJob` (debounce bridge, recency-window + direct LlmSurface.object with ConsolidatedBatchSchema, silent-skip when off/{ok:false}/throw); Claude Code hook scripts (SessionStart/UserPromptSubmit/PostToolUse/Stop); `th0th_hook_ingest` MCP tool; Prisma Observation model (PG parity).
- Accepted assumptions (non-blocking): bridge bypasses consolidateWindow prefilter (observations have no embeddings → recency window + direct schema-validated LLM call); no OS-level scheduler (trigger-driven debounce); PG ObservationStore code deferred (Prisma model provides parity; SQLite-canonical like synapse_sessions/index_jobs); fire-and-forget write failures logged not retried; sourceIds in memory:consolidated are observation ids (informational, no edge to non-memory rows).

## Completion (Phase 4)
- Commits: c022731 (specs), 1be1a1c (config + event), ae296e7 (bootstrap-service), 773a130 (MCP tool + route + barrel), 3fec6fd (tests + no-signals short-circuit fix).
- Gates: `bun run test` 754 pass / 0 fail / 46 skip (baseline 738 → +16); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole agent — caveat labeled in validation.md). Discrimination mutant killed (idempotency-guard removal → P4-IDEMPOTENT-01 fails). Report: `.specs/features/phase-4-bootstrap/validation.md`.
- Landed: `memory.bootstrap` config block (default-on scan/rule-based, LLM inherits llm.enabled); `BootstrapService` (scan git/README/docs/manifests/centrality via `SymbolGraphService.getTopCentralFiles`, LLM `llmObject`+zod `SeedMemoriesSchema`, rule-based fallback, idempotent via `bootstrap:<projectId>` tag marker, silent degradation, `bootstrap:completed` event); MCP tool `th0th_bootstrap`; API route `POST /api/v1/bootstrap` (423 disabled, 400 empty projectId); core barrel re-exports. No schema/migration (seeds are existing `memories` rows).
- Accepted assumptions (non-blocking): seed memories have no embeddings (FTS-only, consistent with Phase-3); marker = tag (O(rows) but rare, indexed by project_id); refresh does not delete prior seeds (consolidation handles); PG marker query falls back to "not bootstrapped" (SQLite-canonical default, dedicated bootstrap_state table deferred); P4-DEGRADE-03 (423) verified by inspection.

## Completion (Phase 6)
- Commits: d3ccd2e (specs), 60e799b (config + handoff:accepted event + Prisma Handoff), 4d8ac60 (HandoffStore + HandoffService + auto-injector + barrel), 8f2f0a0 (4 MCP tools + /api/v1/handoff route), 1a4bc40 (tests + validation).
- Gates: `bun run --filter @th0th-ai/core test` 791 pass / 0 fail / 46 skip (baseline 754 → +37); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole agent — caveat labeled in validation.md). Discrimination mutant killed (status-guard removal → P6-FAIL-02 accept + cancel fail). Report: `.specs/features/phase-6-handoffs/validation.md`.
- Landed: `handoffs.enabled` config (default-on, env `HANDOFFS_ENABLED`); `HandoffStore` (SQLite WAL `handoffs.db` + Memory fallback + factory, no isPostgresEnabled); `HandoffService` (ctor-seam {store?, memoryRepo?, llm?, idFactory?}, begin/accept/cancel/listPending, state machine open→accepted|expired, dual-write conversation memory level PROJECT/importance 0.7/tagged handoff:<id>+handoff:<projectId>/no embedding, optional LLM summary-polish default-off silent-degrade, never throws); `HandoffAutoInjector` (subscribes observation:ingested session-start → listPending observability); `handoff:accepted` event; 4 MCP tools (`th0th_handoff_begin/accept/cancel/list_pending`); API route `POST /api/v1/handoff/{begin,accept,cancel,list}` (423 disabled, 400 missing); Prisma `Handoff` model (PG parity); core barrel re-exports.
- Accepted assumptions (non-blocking): PG HandoffStore runtime deferred (Prisma model parity; SQLite-canonical like observations/synapse_sessions/index_jobs); no age-based expiry (only explicit cancel); auto-injector records via logger (listPending is the deterministic recall surface; injector is the future auto-surface hook seam); targetAgent derivation best-effort (agentId from payload or broadcast); P6-DEGRADE 423 verified by inspection.

## Completion (Phase 5)
- Commits: a4c86ff (specs), d42086a (config + memory:auto-improved event + proposals table + Prisma), d3242cb (AutoImproveJob), ba971b0 (3 MCP tools + /api/v1/proposal route + barrel), 67e9ed6 (tests + approve targetMemoryId fix + validation).
- Gates: `bun run --filter @th0th-ai/core test` 822 pass / 0 fail / 46 skip (baseline 791 → +31); `bun run type-check` 5/5 clean.
- Same-author verifier: PASS (sole agent — caveat labeled in validation.md). Discrimination mutant killed (setStatus WHERE status='pending' guard removal → repo "non-pending no-op" test fails). Report: `.specs/features/phase-5-auto-improve/validation.md`.
- Landed: `memory.autoImprove` config block (default-on detection, reviewGate default false = auto-approve, env `AUTO_IMPROVE_*`); `ProposalStore` (SQLite WAL `proposals.db` + Memory fallback + factory, no isPostgresEnabled); `AutoImproveJob` (ctor-seam {llm?, observationStore?, proposalStore?, memoryRepo?, thresholds?, reviewGate?, idFactory?}, `detectPatterns` pure rule-based query/file/fix signals, `enrichWithLlm` optional silent-degrade, `runOnce` debounce, reviewGate=false auto-approve reuses `approve()` single code path, apply/reject state machine pending→approved|rejected with defense-in-depth WHERE guard, `listPending`); `memory:auto-improved` event; 3 MCP tools (`th0th_list_proposals`/`approve`/`reject`); API route `POST /api/v1/proposal/{list,approve,reject}` (423 disabled, 400 missing); Prisma `Proposal` model (PG parity); core barrel re-exports.
- Accepted assumptions (non-blocking): PG ProposalStore runtime deferred (Prisma model parity; SQLite-canonical like observations/handoffs); no OS scheduler (trigger-driven debounce mirrors Phase-3); Synapse-session mining is a seam only (v1 keys on observation payloads); no proposal TTL; P5 423 verified by inspection; same-author verification.
- Bug fixed in 67e9ed6: `approve` now surfaces the freshly-assigned memory id onto the returned record + `memory:auto-improved` event payload (previously shadowed by the store's getById result → event emitted targetMemoryId=undefined for memory.create). Caught by P5-APPROVE-01.
