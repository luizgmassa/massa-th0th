# massa-th0th Spec State

## Active
- projectId: `massa-th0th`
- workflowSessionId: `spec-virtual-lantern-plan`
- workflow: spec-driven
- feature: `phase-0-quick-wins` (complete — verified PASS)
- branch: main

## Next Step
Phase 0 done + independently verified. Next session: Phase 1 (memory-quality foundation: decay fn, LLM consolidation, durable sessions/jobs) per `i-want-to-understand-virtual-lantern.md`. Phase 1 needs Design (migrations, llm-client, session store).

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

## Verified Source Facts (grounded this session)
- file-collector.ts:9 hardcoded 8 exts; index-manager.ts:251-260 duplicated the 8-ext fallback. → fixed via shared `DEFAULT_ALLOWED_EXTENSIONS`.
- config security.allowedExtensions = 34-ext canonical list.
- MemoryRepository (SQLite) gained update/deleteById; PG gained update + deleteById (RETURNING) for union parity.
- MemoryGraphService.onMemoryDeleted(id) already existed (severs edges) — reused by controller.delete.
- 3 checkpoint tools now wired into tool-definitions + new routes/checkpoints.ts.
