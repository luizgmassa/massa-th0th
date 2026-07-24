# Hook Attribution Repair — Context

## Verify-First Fan-out (2026-07-20, 3 read-only subagents, branch wave-3 @ 356b8bd)

Plan text (~/Downloads/massa-ai-improvement-plan.md):

- **M45** `[new]` Feat — Session-sticky attribution (override-wins + containment + broad-root-exclusion) *if massa-ai attributes by cwd*. Evidence: ai-memory `d43e859` (`router.rs` +253).
- **M47** `[new]` Feat — Idempotent data-repair migration pattern (V27 shape) for systematic attribution bugs. Evidence: ai-memory `d43e859` (`V27__….sql`).

Fan-out verdict: M45 precondition TRUE (attribution is client-side cwd basename); all four bug modes REAL (subdirectory, worktree/symlink, unregistered/$HOME silent bucket, basename collision); no sentinel; zero pinned tests for attribution correctness. M47 warranted; in-repo template precedent `20260714170000_add_graph_generations` (backfill UPDATE + self-verifying `DO $$`). No discrepancy between plan text and current source.

## User Decisions (2026-07-20, Requirement Closure)

1. Resolution lives at **both** seams: server-side authoritative resolver in `HookService` + emitter-side session pinning (Claude `_post.sh` family, OpenCode plugin).
2. Unresolvable events: **fail-open + provenance tag** (`verbatim`), never reject, never silent-drop.
3. Verification side findings **both in scope**: `observations.agent_id` persistence; observation mirror keyed by canonical id.
4. (Pre-decided for M21, next feature) Linux gate target env: **Ubuntu Codespace** (M19 precedent, user-approved substitution for Debian 12).

## Key Source Anchors

| Concern | Anchor |
| --- | --- |
| Hook entry routes | `apps/tools-api/src/routes/hooks.ts:45-164` (single, batch, compact-snapshot) |
| Ingest service | `packages/core/src/services/hooks/hook-service.ts:183,230` (`ingestOne`, `ingestBatch`) |
| Emitter: Claude | `apps/claude-plugin/hooks/_post.sh:44`, `pre-compact.sh:13` |
| Emitter: OpenCode | `apps/opencode-plugin/src/index.ts:118`, `observation-emitter.ts:243` |
| Workspace roots | `workspaces.project_path`; canonicalize precedent `index_project.ts:37-42`; manager `workspace-manager.ts:39-55` |
| Containment precedent | `apps/tools-api/src/routes/workspace.ts:85-91,488-497` (realpathSafe + inside-root check) |
| Alias seam (M16+M17) | `observation-repository-pg.ts:181`, `alias-resolver.ts:80-98`, SQL `project_identity_resolve` |
| Mirror divergence | `observation-repository-pg.ts:160-161` (raw id) vs `:213-236` (reads) |
| agentId drop | `hook-service.ts:134-135` normalized, `:192-201,252-261` discarded |
| Repair template | `prisma/migrations/20260714170000_add_graph_generations/migration.sql:128-205` |
| Migration style | timestamped `YYYYMMDDHHMMSS_snake/migration.sql`; newest uses explicit `BEGIN…COMMIT` |

## Discuss Notes

Gray areas ran inside Specify and closed via the four user decisions above. Persistence dimension resolved: additive nullable columns only (`attribution_source`, `agent_id`), no destructive change; repair migration is the only data-mutating asset and is guarded unambiguous-only + self-verifying + idempotent. Concurrency dimension: resolver runs pre-enqueue inside the existing single-writer queue admission, so no new write race; session pin map is process-local to tools-api (single writer process for hooks).
