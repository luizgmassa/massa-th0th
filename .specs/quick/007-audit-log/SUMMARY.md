# 007 — Audit-Log Attribution for Destructive Ops (M8) — SUMMARY

## Commit
`feat(audit): operation_log audit trail for destructive ops` (see git log).

## What landed
- **Migration** `20260718000000_add_operation_log/migration.sql` — new
  `operation_log` table: `id BIGSERIAL PK`, `occurred_at TIMESTAMPTZ default
  now()`, `actor_type TEXT default 'api_key'`, `actor_id TEXT default
  'unknown'`, `project_id TEXT`, `op TEXT`, `scope JSONB default '{}'`,
  `result TEXT` (CHECK success|failure|partial), `meta JSONB default '{}'`,
  `error TEXT`. Indexes `(project_id, occurred_at DESC)` and
  `(op, occurred_at DESC)`. Matches the repo's single-`migration.sql`
  convention + `IF NOT EXISTS` idempotency used by recent migrations.
- **Repository** `packages/core/src/data/audit/operation-log-pg.ts` —
  `OperationLogRepositoryPg` with `recordOperation` (raw SQL via Prisma
  `$executeRaw`, same pattern as `memory-repository-pg.ts`) + `listByProject`.
  Singleton + factory `getOperationLogRepository` that calls
  `requirePostgresDatabaseUrl` (matches the memory-repo factory).
- **Contract** `operation-log-contract.ts` — `ActorContext`, `UNKNOWN_ACTOR`,
  `OperationResult`, `RecordOperationInput`, `OperationLogRow`,
  `OperationLogRepository` interface. Exported from `@massa-ai/core`.
- **Actor seam** `apps/tools-api/src/middleware/auth.ts` — `deriveActor`
  reads the optional `x-actor-id` header (non-secret identifier), returns
  `{ actorType: "api_key", actorId: <header>|"unknown" }`. Exposed on every
  request via Elysia `.derive` and read directly in `project.ts`.
  **This is the single point future identity work replaces** — swap
  `deriveActor` to decode a JWT/session/MCP-agent header and every call site
  inherits the richer identity. No call site knows how the actor was derived.
- **reset_project wired** `apps/tools-api/src/routes/project.ts` — after the
  destructive work (vectors/keywords/symbols/memories) finishes, calls
  `recordOperation` with op=`"project_reset"`, scope=`{projectId,
  requestedScopes:{vectors,symbols,memories}}`, meta=`{...deleted counts}`,
  result derived from error count (success / partial / failure), error joined
  from the per-scope error list. The `await` preserves audit-after-destructive
  ordering without adding failure surface (recordOperation never throws).

## Actor seam shape (design)
```
                 ┌─────────────────────────────────────────────┐
Request headers ─▶│ deriveActor(headers) → ActorContext         │
                 │  { actorType:"api_key", actorId: header|"unknown" }│
                 └───────────────────┬─────────────────────────┘
                                     │ passed as a value
                                     ▼
   recordOperation({ actorType, actorId, op, scope, result, ... })
```
`ActorContext` is a plain struct carried by value. Today only the API layer
constructs it; tomorrow a signed-in user or MCP agent header constructs one
the same way. `recordOperation` and every destructive call site are blind to
the source — they consume `ActorContext` and never reach back into the
request, so identity upgrades are localized to `deriveActor`.

## Sites wired vs follow-up
| Site | Wired? | Notes |
|---|---|---|
| `POST /api/v1/project/reset` (project.ts) | YES (primary) | op=`project_reset`, full scope + counts + result |
| `memory-repository-pg.ts deleteByProject` | indirect | only reached via reset_project today; covered transitively |
| `keyword-search-pg.ts deleteByProject` | indirect | same — reached via reset_project |
| `symbol-repository-pg clearProject` (workspace delete) | indirect | reached via `workspaceManager.removeWorkspace` inside reset_project |
| `graph-generation-repository nukeSymbolTables` | follow-up | not on the reset path; wire when it grows a direct destructive entry point |
| `memory-repository deleteById` / `softDeleteById` | follow-up | single-row deletes; low attribution value vs reset/purge |

The single user-facing destructive entry point today is `POST /reset`, which
fans out to all the per-repo deletes. Wiring reset_project captures every
real attribution event. Per-repo wiring is defensive depth, not a gap.

## Migration reversibility
- Additive only: one new table, two new indexes. No existing column changes,
  no data backfill.
- `DROP TABLE IF EXISTS operation_log;` reverses it cleanly (verified).
- `IF NOT EXISTS` on table + indexes makes accidental re-apply idempotent
  (verified — re-apply is a no-op with NOTICE, no error).
- Verified end-to-end: `prisma migrate deploy` on a fresh isolated DB
  records `20260718000000_add_operation_log` as finished, table created,
  CHECK constraint enforces result enum, defaults applied, INSERT/SELECT
  round-trip works.

## Fail-safe proof
`recordOperation` wraps `$executeRaw` in try/catch and resolves (never
rejects). Two DB-free tests prove the contract:
1. `getClient()` throws synchronously → recordOperation resolves undefined.
2. `$executeRaw()` rejects asynchronously → recordOperation resolves undefined.
Both verified green. The destructive op always completes regardless of
operation_log health (DB down, pool exhausted, malformed JSON, etc.).

## Gate evidence
- `bunx tsc --noEmit -p packages/core/tsconfig.json` → 0 errors.
- `bunx tsc --noEmit -p apps/tools-api/tsconfig.json` → 0 errors.
- `bunx tsc --noEmit -p packages/shared/tsconfig.json` → 0 errors.
- `bun test packages/core/src/__tests__/operation-log-repository.test.ts` →
  2 pass (fail-safe), 3 skip (PG-gated) when DB unavailable.
- `DATABASE_URL=<dedicated> RUN_POSTGRES_TESTS=1 bun test ...operation-log-repository.test.ts` →
  3 pass, 0 fail, 0 skip (PG round-trip verified on dedicated DB).
- `bun test apps/tools-api/src/__tests__/project-reset.test.ts` → 4 pass
  (2 existing lifecycle + 2 new audit attribution incl. x-actor-id header capture).
- `bun test apps/tools-api/src/middleware/auth.test.ts` → 7 pass (no regression).
- Migration verified on isolated DB: apply, schema, indexes, CHECK, defaults,
  idempotent re-apply, round-trip, reversibility (DROP TABLE). Plus
  `prisma migrate deploy` accepts and records the migration.

## Residual risk
- **Best-effort logging is a real tradeoff.** If operation_log is unhealthy,
  destructive ops still run but leave no audit row. Acceptable: the
  alternative (failing the reset when the audit table is broken) would make
  the audit table a single-point-of-failure for destructive ops, which is
  worse. The fail-safe logs a warning so outages are observable.
- **actor_id is "unknown" by default** until callers send `x-actor-id`. The
  seam is in place; populating it is a deployment/client concern.
- **Per-repo destructive methods are not individually wired** (see follow-up
  table). Every user-facing destructive path today goes through reset_project,
  so no attribution event is missed in practice; per-repo wiring is defense
  in depth.
