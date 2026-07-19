# M16 + M17 — Transactional Project Identity

## Goal

Rename or merge a durable project identity without losing, duplicating, partially moving, or serving stale project-scoped state. Retired IDs remain compatible aliases and can never be reused.

## Public Contract

- `POST /api/v1/project/rename`
- `POST /api/v1/project/merge`
- MCP `rename_project`
- MCP `merge_projects`
- Core `ProjectIdentityService.preview()` and `ProjectIdentityService.apply()`

Requests contain `sourceProjectId`, `targetProjectId`, and `dryRun` (default `true`). Preview returns mode, canonical roots, per-store counts, conflicts, and `planHash`. Apply requires `dryRun: false`, `operationId`, and `expectedPlanHash`.

## Requirements

1. Rename requires a live source and unused, never-retired target. Merge requires live source and target with the same canonical root. Equal IDs, different roots, conflicts, aliases as sources, unknown scoped storage, or changed previews fail before mutation.
2. Durable aliases resolve retired IDs to the current target for compatible reads and writes. Alias chains are flattened; retired IDs cannot be registered again.
3. Every project-scoped writer passes through one PostgreSQL identity guard. Apply takes ordered exclusive identity locks and drains guarded in-process writes so a concurrent writer either commits before the move or resolves the post-commit alias.
4. Preview discovers direct identity columns using `information_schema` and supplements them with explicit adapters for metadata/JSON/text identities, scheduler state, checkpoints, vector metadata, and runtime-created tables. An unclassified project-scoped store blocks apply.
5. One transaction rewrites direct and adapted identities, deduplicates only byte-equivalent conflicting records, preserves graph histories, selects the newest activated graph generation, supersedes other active generations, recomputes workspace counts, creates the alias, updates durable caches, and writes exactly one strict result keyed by `operationId`.
6. Historical operation audit rows are immutable. Composite-key or semantic conflicts abort the entire transaction with no partial state.
7. A repeated `operationId` returns the stored result. Reuse with different request material fails.
8. After commit, registered in-memory invalidators run directly for both IDs. Best-effort event publication cannot turn a committed operation into failure.
9. Errors are typed and sanitized. Preview and apply never expose SQL or stored payloads.

## Acceptance Criteria

- Rename and merge preview/apply parity across Core, HTTP, and MCP.
- Two PostgreSQL processes prove writers cannot strand the source ID during apply.
- Lost-response retry returns the one stored operation result and exactly one audit entry.
- Different-root, collision, stale-plan, unknown-storage, and operation-reuse conflicts fail without mutation.
- Injected pre-commit failures preserve a byte-equivalent database snapshot; post-commit invalidator/event failures do not change the committed response.
- Zero mutable source references remain after apply; immutable audit and alias records are the only allowed source-ID references.
- Both source and target caches are invalidated after commit.

## Non-goals

- Deleting retired aliases, rewriting immutable historical audit rows, orphan deletion, or changing retention policy.
- Cross-root merges or best-effort partial migration.
