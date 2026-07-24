# Repository Maintenance and PostgreSQL Verification

**Status:** Complete with documented G10 cold-qwen performance exception  
**Date:** 2026-07-12  
**Workflow session:** `spec-repository-maintenance`  
**Acceptance backend:** PostgreSQL/pgvector

## Objective

Audit the repository and runtime contracts, execute every discoverable automated gate,
fix PostgreSQL-relevant failures at root cause, and leave restartable evidence.

SQLite behavior is not a completion gate. A SQLite scenario without behaviorally
equivalent PostgreSQL evidence is a blocking coverage gap. Removing SQLite is out of scope.

## Requirements

- **MNT-01 Baseline safety:** preserve HEAD, dirty/untracked files, and shared developer
  stack; attribute failures to baseline or maintenance changes.
- **MNT-02 Repository analysis:** map components, flows, DB ownership, memory/checkpoint
  lifecycle, performance controls, invariants, sharp edges, and debt.
- **MNT-03 Test completeness:** every discovered build, type-check, unit, integration,
  script, E2E, destructive, and aggregate gate has one manifest result.
- **MNT-04 PostgreSQL parity:** map SQLite scenarios to exact PostgreSQL assertions by
  precondition, operation, expected outcome, and edge dimensions. Weaker evidence is a gap.
- **MNT-05 Correct fixes:** fix PostgreSQL-relevant failures minimally; never weaken,
  delete, or skip validation assets to make a gate green.
- **MNT-06 Continuity:** persist manifest, ledger, parity, validation, state, handoff,
  verified TODO findings, and durable massa-ai lessons.

## Acceptance Criteria

1. Every manifest row has `PASS`, justified `EXPECTED SKIP`, documented `EXCEPTION`, or
   concrete `BLOCKED`; unexplained skips are zero.
2. All reachable PostgreSQL-backed unit, integration, E2E, executable destructive, build,
   type-check, and root aggregate gates pass.
3. Every relevant SQLite scenario has assertion-equivalent PostgreSQL evidence or a
   blocking parity finding with reproduction and next action.
4. User-owned changes remain byte-identical unless an overlap report is approved.
5. Production fixes have focused regression evidence plus a clean full-manifest rerun.
6. Independent validation re-derives evidence and records a safe discrimination sensor.

## Scope Amendment — PAR-07/PAR-08 (2026-07-13)

The parity audit proved that handoffs and proposals still select SQLite during a PostgreSQL
run and that their Prisma models have no deployed tables. MNT-04 cannot be satisfied with
tests alone. The maintenance scope therefore permits one additive PostgreSQL migration plus
PG repository implementations and factory routing for these two existing contracts.

- No REST, MCP, service-state-machine, or SQLite-removal change is permitted.
- Existing SQLite behavior remains the canonical compatibility contract.
- PostgreSQL status transitions must be atomic and restart-durable.
- Dedicated test data is disposable; the shared developer database is not migrated here.
- The final clean-stack verification must apply the new migration from scratch.

## Non-Goals and Assumptions

- No SQLite removal, opportunistic refactor, or public REST/MCP change. Migrations are
  limited to the additive handoff/proposal parity amendment above.
- Shared API `localhost:3333` is user-owned and remains running; dedicated DB is disposable.
- Static `test.skip` runbooks remain documented exceptions unless safely orchestrated.
- No commit or push without separate authorization.
- Runtime cannot enforce requested subagent model tiers; role/evidence boundaries are enforced.
