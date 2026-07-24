# PostgreSQL-Only Storage Validation

Status: PASS WITH FOLLOW-UP — implementation, local deterministic gates, and isolated PostgreSQL/pgvector validation pass. Two legacy non-gating probes were not rerun after their final fixture repairs.

## Evidence

| Gate | Result | Evidence |
| --- | --- | --- |
| Workspace type-check | PASS | `bun run type-check` completed all six packages. |
| Workspace build | PASS | `bun run build` completed all five build tasks. |
| URL discrimination | PASS | `db-guard.test.ts`: 11 pass / 35 assertions; missing, malformed, non-PostgreSQL, and database-less URLs fail closed. |
| Bootstrap regression | PASS | `bootstrap-service.test.ts`: 15 pass / 95 assertions after removal of obsolete SQLite singleton coverage. |
| Installer contract | PASS | `test-setup-wizard-db-selection.sh`: 11 pass; native/docker only, URL/migration/pgvector failure closes setup. |
| Active runtime reference scan | PASS | No active `bun:sqlite`, SQLite adapter/store, legacy backend env, or `data/sqlite` reference outside the documented scanner exclusions. |
| Diff integrity | PASS | `git diff --check` passed. |
| Root suite | PARTIAL | The collision-safe wire test passes outside the sandbox (8 pass / 22 assertions). Full-suite output remained too verbose to retain a final aggregate summary, but stale concrete-store failures were repaired and focused coverage passed. |
| PostgreSQL migration/integration/E2E | PASS | Owned PostgreSQL 17 + pgvector 0.8.4 on `:5433` received 14 migrations; dedicated API ran on `:3334`. Vector integration: 16/16; smoke: 4/4; CLI: 13/13; destructive E2E: 4/4 and 79 assertions. |

## Requirement Coverage

| Requirement | Status | Notes |
| --- | --- | --- |
| SQLR-001 | PASS | Central validator is used at startup/factory boundaries and has deterministic negative coverage. |
| SQLR-002 | PASS | `DATABASE_URL` is sole runtime database/vector input; legacy selectors removed. |
| SQLR-003 | PASS | SQLite runtime namespace/adapter removed; a clean isolated PostgreSQL database deployed all 14 Prisma migrations. |
| SQLR-004 | PASS | PostgreSQL vector CRUD/batch integration passed 16/16; CRUD/parity passed 39 checks and scheduler restart parity passed 5/5. |
| SQLR-005 | PASS | Dedicated API/health stack ran on owned `:3334` resources; N3 validated PostgreSQL outage/recovery over HTTP and MCP. |
| SQLR-006 | PASS | Active scanner is clean with historical `.specs/`, immutable Prisma migration comments, plan source, benchmark fixture, and explicit unsupported-installer rejection excluded. |
| SQLR-007 | PASS | Installer supports only native/docker and rejects SQLite. |

## Discrimination Sensor

`requirePostgresDatabaseUrl()` tests prove that missing, malformed, non-PostgreSQL, and database-less URL inputs cannot reach initialization. Both supported PostgreSQL URL schemes remain accepted.

## Residual Follow-Up

1. Rerun the standalone legacy Prisma migration probe after its checked `tags` fixture update; its earlier failure was after migration/connect/read success and is not used as migration evidence.
2. Rebuild the frozen qwen fixture manifest before rerunning its fixture-specific E2E; it hash-mismatched changed PostgreSQL-vector source.
3. Capture a concise final aggregate for `bun run test` with the required external LLM/PostgreSQL services.

## Owned Resource Cleanup

The verifier removed its PostgreSQL/API/Ollama processes and `/private/tmp/massa-ai-*` resources. Ports `5433`, `3334`, and `11435` were free afterward; shared `:3333` remained healthy.
