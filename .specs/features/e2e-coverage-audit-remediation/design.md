# T14 E2E Coverage Audit — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/recap-from-previous-chat-glimmering-adleman.md` — a plan to fix all 11 OPEN findings (#4–#14) in the T14 E2E coverage audit.

## Intent and scope

The plan claimed five batches: MCP POST/tool-definition and CLI/timeout fixes; PostgreSQL symbol-filter and nullable-reference changes; XDG config support; index-job terminal-state reliability; and a test-only observability assertion. It specified a dedicated `:3334` PostgreSQL stack, MCP rebuild, migration deployment, targeted and full E2E runs, cleanup, coverage-status updates, and the residual OOM limitation for #11.

## Implemented outcome

Commit `b953ae7` changed every production/test surface named by the plan except that it did not itself apply the new #14 migration to the shared database. Its inspected diff adds POST path-param substitution and clean request bodies, aligns the named Synapse/reindex tool definitions, changes the PG symbol filters and nullable-reference writes, adds XDG config resolution, and changes index-job completion handling. It also updates the planned E2E suites and `COVERAGE.md`.

Commit `3dd9fbc` records that #14 migration application to the shared database. Later commits `1367007` and `6b5852f` add residual coverage/job-store and proxy-timeout work; these are in range but exceed the source plan's eleven-finding scope.

## Commit evidence

### Planned 11-finding rollout

- `b953ae720cb2e6c5710c08ca80b8ef7f536ca05c` — `fix(e2e): resolve 11 OPEN bugs from T14 coverage audit`
  - Inspected changes cover the plan's MCP client, PG symbol repository/schema migration, XDG loader, index-job tracker/pipeline/index tool, E2E tests, and coverage record.
  - Commit message reports a dedicated `:3334` PG verification and marks the 11 findings fixed; this is commit testimony, not a live-environment check made for this record.
- `3dd9fbca10fb0a4cf805176652c845458a16a467` — `docs(e2e): apply migration #14 to shared DB; all 11 fixes now live`
  - Commit message records shared-database application of `20260706105826_drop_symbol_refs_target_fqn_not_null` and updates `COVERAGE.md`.

### In-range follow-up hardening

- `1367007549e9b9ece28f69d44e0dd061ad04fde4` — `fix(e2e): resolve all COVERAGE residuals (#12/#15-18/N7/OOM/.env) + PG job-store parity`
  - Adds the reported MCP bootstrap timeout handling, E2E residual fixes, and PG job-store/heartbeat work.
- `6b5852f8c572ca3f459199fc3b60ce568a91e121` — `fix(core): resolve 5 OPEN COVERAGE side-findings (A–E) + verify green`
  - Adds later side-finding fixes and reports focused E2E/unit results; not evidence that this documentation task reran them.

## Spec/acceptance facts

- Plan acceptance required all eleven findings, deliberate #14 schema migration, and activation or conversion of the listed E2E checks.
- Inspected `b953ae7` changes include `02.indexing`, `09.symbol-graph`, `10.synapse`, `12.observability`, `13.cli`, and `15.nfr` E2E suites plus `COVERAGE.md`.
- Plan classified #13 as test-only. The inspected commit changes `12.observability.test.ts` and does not list `apps/tools-api/src/routes/system.ts`.
- Plan required #14 to retain null `target_fqn` values. The inspected commit adds a migration, makes Prisma `targetFqn` nullable, and removes the two PG write-path guards that skipped unresolved references.

## Deviations/unresolved gaps

- Plan said non-terminal jobs would never be evicted. The inspected `b953ae7` implementation preserves them first but still evicts non-terminal overflow as a logged last resort when the cap cannot otherwise be met.
- Plan called for `pipeline.ts` to call `updateStatus(..., "completed")`; inspected code instead calls `updateProgress(...)` and `setResult(...)` for completion, with `setResult(...)` on failure.
- Plan's specified #12 change was an env-tunable API-client timeout. `b953ae7` implements that; its commit message says live verification was deferred. `1367007` later adds a separate MCP SDK timeout change.
- No final-range command output, running dedicated stack, or current shared-database state was inspected for this record. Commit messages' live-verification and migration claims remain historical testimony.

## Existing spec crossrefs

- [Original live-stack E2E execution record](create-a-plan-to-silly-cookie.md)
- [Phase 1 memory foundation specification](../../phase-1-memory-foundation/spec.md)
- [Phase 1 memory foundation design](../../phase-1-memory-foundation/design.md)
- [Repository-maintenance analysis](../../repository-maintenance-2026-07-12/analysis.md)

## Verification evidence

- Read the complete source plan.
- Inspected the complete in-range commit subjects and the relevant path history.
- Inspected `b953ae7` commit body, changed-file list, and relevant production/test diff hunks; inspected bodies for `3dd9fbc`, `1367007`, and `6b5852f`.
- `test -s` for this record and `git diff --check` for its path passed. No test suite was run for this documentation-only task.
