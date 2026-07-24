# Repository Maintenance Design

## Execution Architecture

One orchestrator owns state, classification, artifacts, memory, and acceptance. Only one
subagent runs at a time: read-only analysis, read-only test runner, one-cluster fixer, then
fresh read-only verifier. DB/schema/MCP/cross-package failures escalate immediately.

## Isolation Contract

- Shared stack: `localhost:3333`; observe only, never restart or mutate.
- Dedicated PostgreSQL: `127.0.0.1:5433`, database `massa_ai_test`, credentials
  `test`/`test`; set `DATABASE_URL` and `POSTGRES_VECTOR_URL` explicitly.
- Dedicated Tools API: `localhost:3334`, `MASSA_AI_DEDICATED=1`, scheduler off.
- Dedicated state/config root: `/tmp/massa-ai-maintenance-20260712`.
- Dedicated Ollama: prefer `127.0.0.1:11435` for destructive timing/outage scenarios.
- Record owned PIDs; stop only owned processes. Verify shared health before and after.
- Run destructive gates last, then reprovision before final non-destructive verification.

## Failure Classification

Each failure is exactly one of: production defect, incorrect test contract, environment,
flake/race, SQLite-only non-gating, or PostgreSQL parity gap. Test changes require proof that
the expectation is wrong plus user approval.

## Trade-off

Sequential agents and reprovisioning cost time but prevent Bun process-global mocks, shared
singleton state, concurrent full-index OOM, and destructive contamination from being
misdiagnosed as product defects.

## PAR-07/PAR-08 PostgreSQL Amendment

- Add only the existing Prisma `Handoff` and `Proposal` table shapes, indexes, and required
  constraints through one committed additive migration.
- Implement internal PG repositories behind the current handoff/proposal interfaces.
- Factories select PG only when the configured database backend is PostgreSQL; SQLite and
  memory fallbacks retain their current behavior.
- Terminal status changes use conditional SQL (`WHERE status = 'open'` / `pending`) so
  concurrent accept/cancel/approve/reject calls cannot overwrite a terminal decision.
- PG tests mirror every SQLite repository assertion and add restart durability, filtering,
  `NULL`/JSON round-trips, and concurrent terminal-transition evidence.
- Dedicated-stack E2E must attest that rows land in PostgreSQL rather than local `.db` files.
