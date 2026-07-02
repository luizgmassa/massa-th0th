# massa-th0th Spec State

## Active
- projectId: `massa-th0th`
- workflowSessionId: `spec-virtual-lantern-plan`
- workflow: spec-driven
- feature: `phase-0-quick-wins` (in_progress)
- branch: main

## Next Step
Execute Phase 0 tasks inline, one at a time, gate+commit each: 0a → 0b → 0c → 0d. Then independent verifier.

## Decisions
- Scope this session = Phase 0 (0a-0d) only. Phases 1-8 deferred.
- Method = inline, one task at a time (user choice).
- SQLite-canonical; no migrations in Phase 0.
- 0c delete = HARD delete + sever GraphStore edges. Soft-delete deferred to Phase 1 (needs `deleted_at` column + recall filtering; out of Phase 0 no-migration scope). [accepted assumption]
- 0c update must re-embed + re-index FTS5 on content change (SQLite external-content table).
- This repo NOT in th0th index → direct source reads authoritative; `th0th_search` N/A here.

## Verified Source Facts (grounded this session)
- file-collector.ts:9 hardcoded 8 exts; index-manager.ts:251-260 duplicates the 8-ext fallback.
- config security.allowedExtensions = 34-ext canonical list (config/index.ts:239).
- No `search` config block; 0b caps are literals: 50 (search-controller.ts:244), 100 (contextual-search-rlm.ts:290 default, :345 hardcoded bug).
- MemoryRepository (SQLite): no update/deleteById; has deleteByProject. MemoryRepositoryPg: HAS delete(id) + updateImportance(id).
- MemoryGraphService.onMemoryDeleted(id) exists (severs edges).
- 3 checkpoint tools exported from core tools/index.ts but ZERO refs in tool-definitions.ts + routes.
