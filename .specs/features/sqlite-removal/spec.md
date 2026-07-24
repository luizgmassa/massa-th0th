# PostgreSQL-Only Storage Specification

Slug: `sqlite-removal`. Source: `plan-sqlite-removal.md`.

## Problem Statement

Runtime behavior currently selects SQLite or PostgreSQL in many independent paths. This creates untested backend drift and allows startup without the required PostgreSQL/pgvector data plane.

## Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| SQLR-001 | Require one valid PostgreSQL URL. | Missing, malformed, non-PostgreSQL, or database-less `DATABASE_URL` fails before API/store initialization; `postgres://` and `postgresql://` are accepted. |
| SQLR-002 | Remove runtime backend selection. | `DATABASE_URL` is the sole DB/vector source; runtime no longer reads `DATABASE_TYPE`, `VECTOR_STORE_TYPE`, `POSTGRES_VECTOR_URL`, or SQLite path configuration. |
| SQLR-003 | Use PostgreSQL implementations only. | Existing neutral factory/getter entry points construct Pg implementations; SQLite stores, adapters, cache, and synchronization/import paths are gone. |
| SQLR-004 | Preserve durable behavior. | CRUD, filtering, graph traversal, clustering/deduplication, caches, restart persistence, and singleton behavior have PostgreSQL or in-memory-double coverage. |
| SQLR-005 | Enforce operations contract. | Docker/setup migrates after URL validation; health/system responses report PostgreSQL, pgvector, and database metadata rather than SQLite files. |
| SQLR-006 | Remove public SQLite support. | Active source, manifests, scripts, tests, CI, installer, and docs contain no active SQLite backend selection or `.db` backend heuristics. Historical `.specs/` and immutable migration history are excluded. |
| SQLR-007 | Constrain installer choice. | `MASSA_AI_DB_BACKEND` permits only `native` or `docker`; `sqlite` is rejected and an unusable URL stops setup. |

## Out of Scope

| Item | Reason |
| --- | --- |
| Migrating existing SQLite data | Explicitly excluded by supplied plan. |
| Removing historical `.specs/` or immutable migration-history references | Historical records remain truthful. |
| Automatic deletion of users' SQLite files | Existing files remain untouched. |
| Compatibility fallback or dual-write mode | PostgreSQL-only is deliberate breaking change. |

## Accepted Assumptions

| Assumption | Rationale | Affected IDs |
| --- | --- | --- |
| Current Prisma migrations cover every active PostgreSQL table/index before legacy migration-directory deletion. | Required confirmation gate in supplied plan. | SQLR-003 |
| PostgreSQL with pgvector is available for runtime, CI, and integration tests. | Explicit plan prerequisite. | SQLR-001, SQLR-004, SQLR-005 |
| Public concrete SQLite exports can be removed pre-production. | Explicit accepted breaking change. | SQLR-003 |

Open questions: none; supplied plan resolves scope and breaking-change policy.

## Verification Approach

1. Static forbidden-token scan excludes historical `.specs/` and immutable migrations.
2. Isolated pgvector PostgreSQL starts, receives Prisma migrations, and runs PostgreSQL integration and dedicated E2E checks.
3. Type-check, build, root tests, and a clean-start durable-store test pass.

Artifact-store evidence: active artifact key `sqlite-removal`; created 2026-07-13.
