# Phase 0 — Quick Wins Specification

Slug: `phase-0-quick-wins`. Source: `i-want-to-understand-virtual-lantern.md` Phase 0.

## Problem Statement
Four independent defects/gaps block correctness and reachability today: (1) MCP upload silently truncates to 8 file extensions while the indexing pipeline supports 34; (2) autoReindex caps are hardcoded literals (50/100) scattered across files, one a bug; (3) memories can be stored/searched/listed but never updated or deleted; (4) checkpoint tools exist in core but are unreachable from MCP/API. Each is small, independent, no DB migration.

## Goals
- [ ] 0a: MCP upload collection uses the shared canonical extension list (no silent truncation).
- [ ] 0b: autoReindex max-files is config-driven (default 200), all three cap sites derive from it, `allowFullReindex:false` kept.
- [ ] 0c: `th0th_memory_update` + `th0th_memory_delete` MCP tools + API routes work end-to-end; delete severs graph edges.
- [ ] 0d: `th0th_list_checkpoints`, `th0th_create_checkpoint`, `th0th_restore_checkpoint` reachable via MCP + API.

## Out of Scope
| Feature | Reason |
| --- | --- |
| Soft-delete (deleted_at + recall filtering) | Needs schema migration + search-filter changes → Phase 1. |
| LLM client / consolidation / decay / sessions (Phases 1-8) | Separate phases. |
| PG-specific update/delete beyond union-type parity | Phase 0 is SQLite-canonical; PG gets parity stubs only. |
| Re-indexing FTS on PG update | PG uses ILIKE, no external FTS table; update SQL suffices. |

## Assumptions & Open Questions
| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Delete semantics | HARD delete by id + sever GraphStore edges | Plan says "soft then hard"; soft needs migration (out of Phase 0). Hard delete is reversible only via re-store. | n — assumption |
| Update tags | `tags` replaces by default; `mergeTags:true` unions | Matches "tags merge" option in plan. | n — assumption |
| 0a extension source | Reuse `config.security.allowedExtensions`; shared default const for fallback | Kills drift at source; respects user config. | n — assumption |

Open questions: none unresolved-and-unmarked.

## User Stories & Acceptance Criteria

### P1-0a: Upload gate uses shared extension list ⭐
1. WHEN MCP collects files for upload THEN system SHALL accept every extension in `config.security.allowedExtensions` (34 default), not just 8.
2. WHEN a file's extension is not in the configured list THEN system SHALL skip it (byte/file guards unchanged).
3. WHEN config fails to load THEN file-collector SHALL fall back to the shared canonical default list.
- Independent Test: existing `apps/mcp-client/src/file-collector.test.ts` + new case asserting a `.go`/`.rs` file is collected.

### P1-0b: Config-driven autoReindex cap ⭐
1. WHEN autoReindex runs THEN the max-files threshold SHALL come from `config.search.autoReindexMaxFiles` (default 200) at all three sites.
2. WHEN files exceed the cap THEN system SHALL defer (NOT full-reindex); `allowFullReindex` stays false.
3. WHEN the hardcoded `> 100` (contextual-search-rlm.ts:345) is hit THEN it SHALL use the same derived cap variable (bug fix).
- Independent Test: extend `packages/core/src/__tests__/search-controller.test.ts`; assert cap read from config.

### P1-0c: Memory update + delete ⭐
1. WHEN `th0th_memory_update` called with id+content THEN system SHALL update content, re-embed, re-index FTS, return updated memory.
2. WHEN update includes importance/tags THEN system SHALL update those fields (tags merge when `mergeTags:true`).
3. WHEN `th0th_memory_delete` called with id THEN system SHALL hard-delete the row AND sever all its GraphStore edges.
4. WHEN update/delete targets a missing id THEN system SHALL return `success:false` with a clear error.
- Independent Test: new `packages/core/src/__tests__/memory-crud.test.ts` (SQLite repo update/deleteById + edge severance via MemoryGraphService).

### P1-0d: Checkpoint tools exposed ⭐
1. WHEN MCP lists tools THEN `th0th_list_checkpoints`, `th0th_create_checkpoint`, `th0th_restore_checkpoint` SHALL appear.
2. WHEN each is called THEN it SHALL hit its API route and delegate to the existing core tool handler (no new logic).
- Independent Test: new `apps/tools-api/src/__tests__/checkpoint-routes.test.ts` (or mcp-client test) asserting routes 200 + delegate.

## Edge Cases
- WHEN update content empty/whitespace THEN reject (validation).
- WHEN delete called twice (idempotent) THEN second returns success:false (not found), no error thrown.
- WHEN update tags is empty array + mergeTags THEN result is empty (explicit clear).

## Requirement Traceability
| ID | Story | Status |
| --- | --- | --- |
| P0-UG-01..03 | 0a | Pending |
| P0-RI-01..03 | 0b | Pending |
| P0-CRUD-01..04 | 0c | Pending |
| P0-CHK-01..02 | 0d | Pending |

## Success Criteria
- `bun run test` green (existing + new, no regressions). `bun run type-check` + `bun run lint` clean.
- All 4 tools reachable end-to-end; upload accepts 34 exts; reindex cap config-driven.

## Design / Tasks
- Design skipped: no architectural decisions — all four reuse existing patterns (tool→controller/manager→repo; config block; tool-defs entry). Valid skip per auto-sizing (Medium).
- Tasks inline: 4 independent deliverables, no deps, ≤5 steps each.

## Verification Approach
Per-task gate (bun test for the touched package) + atomic commit. After 0d: independent Verifier sub-agent (author≠verifier) runs spec-anchored outcome check + discrimination sensor → writes `validation.md`.
