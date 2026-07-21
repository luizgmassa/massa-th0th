# SQLite Removal Non-Gating Follow-Ups Specification

Slug: `sqlite-removal-followup`. Source: `.specs/features/sqlite-removal/validation.md` residual follow-up section.

## Problem Statement

`sqlite-removal` delivered PostgreSQL-only storage, all gating requirements (SQLR-001..007) PASS, and the verifier cleaned owned resources. Three non-gating residual follow-ups were recorded in `.specs/features/sqlite-removal/validation.md` and deferred so the gating work could close. This feature tracks their completion.

## Parent

- Parent feature: `sqlite-removal` (now `complete` in `.specs/project/FEATURES.json`).
- Parent validation: `.specs/features/sqlite-removal/validation.md` (Status: PASS WITH FOLLOW-UP).

## Requirements

| ID | Requirement | Acceptance criteria |
| --- | --- | --- |
| SQLRFU-001 | Rerun the standalone legacy Prisma migration probe after its checked `tags` fixture update. | The probe runs against an owned PostgreSQL 17 + pgvector instance after the `tags` fixture repair; migration/connect/read succeeds; the earlier post-read failure is either resolved or documented as an unrelated fixture issue. |
| SQLRFU-002 | Rebuild the frozen qwen fixture manifest before rerunning its fixture-specific E2E. | A fresh qwen fixture manifest is captured (hash-stable); the fixture-specific E2E reruns against the rebuilt manifest and passes. |
| SQLRFU-003 | Capture a concise final aggregate for `bun run test` with required external LLM/PostgreSQL services. | A single concise aggregate (pass/fail/skip counts per package) is recorded in `validation.md` for a full `bun run test` run with LLM + PostgreSQL services available. |

## Out of Scope

| Item | Reason |
| --- | --- |
| Re-opening `sqlite-removal` gating decisions | Parent feature is closed; this feature only tracks the three recorded residuals. |
| New storage-backend work | PostgreSQL-only is the accepted contract. |
| Installer or CI changes | Covered by parent feature and Wave 4 N34 where applicable. |

## Accepted Assumptions

| Assumption | Rationale | Affected IDs |
| --- | --- | --- |
| External services (PostgreSQL 17 + pgvector, LLM endpoint) are available for the follow-up runs. | Required to exercise the probes and capture the aggregate. | SQLRFU-001, SQLRFU-002, SQLRFU-003 |
| The `tags` fixture repair and qwen manifest rebuild are mechanical reruns, not design changes. | Parent validation recorded them as post-success fixture hash/probe issues, not gating defects. | SQLRFU-001, SQLRFU-002 |

Open questions: none.

## Verification Approach

1. Each follow-up produces a recorded run result linked from `validation.md`.
2. The feature closes when all three follow-ups have recorded outcomes (PASS or documented deferral with reason).
3. No new source changes are expected; follow-ups are probe/fixture/aggregate reruns.

Artifact-store evidence: active artifact key `sqlite-removal-followup`; created 2026-07-21 (Wave 4 T16).