# SQLite Removal Non-Gating Follow-Ups Tasks

## Coverage Matrix

| Task | Requirements | Scope | Gate |
| --- | --- | --- | --- |
| TASK-001 | SQLRFU-001 | Standalone legacy Prisma migration probe rerun after `tags` fixture update | probe runs against owned PostgreSQL 17 + pgvector; migration/connect/read succeeds; outcome recorded |
| TASK-002 | SQLRFU-002 | Frozen qwen fixture manifest rebuild + fixture-specific E2E rerun | fresh hash-stable manifest captured; fixture E2E passes; outcome recorded |
| TASK-003 | SQLRFU-003 | Concise final aggregate for `bun run test` with required external services | single concise pass/fail/skip aggregate per package recorded in `validation.md` |

## Dependencies

- TASK-001, TASK-002, TASK-003 are independent and may run in any order.
- All three require external PostgreSQL + LLM services available.

## Gate Commands

- `bun run test` (with `DATABASE_URL` pointing at an owned PostgreSQL 17 + pgvector and an LLM endpoint configured)
- Standalone Prisma migration probe command (per parent feature `tasks.md` TASK-004 probe)
- Qwen fixture manifest rebuild + fixture-specific E2E command

## Execution Constraints

- No source changes expected; follow-ups are probe/fixture/aggregate reruns.
- Each task records its outcome in `.specs/features/sqlite-removal-followup/validation.md` (created at feature close).
- Atomic commits only if a follow-up surfaces a required source fix; otherwise the feature closes with a single validation.md write.

## Task Breakdown

### TASK-001: Legacy Prisma migration probe rerun (SQLRFU-001)

**What**: Rerun the standalone legacy Prisma migration probe after its checked `tags` fixture update.
**Depends on**: External PostgreSQL 17 + pgvector available.
**Done when**:
- [ ] Probe runs against an owned PostgreSQL instance.
- [ ] Migration/connect/read succeeds (or the earlier post-read failure is documented as an unrelated fixture issue).
- [ ] Outcome recorded in `validation.md`.

### TASK-002: Qwen fixture manifest rebuild + E2E rerun (SQLRFU-002)

**What**: Rebuild the frozen qwen fixture manifest before rerunning its fixture-specific E2E.
**Depends on**: External LLM endpoint available.
**Done when**:
- [ ] Fresh hash-stable qwen fixture manifest captured.
- [ ] Fixture-specific E2E reruns against the rebuilt manifest and passes.
- [ ] Outcome recorded in `validation.md`.

### TASK-003: Final `bun run test` aggregate capture (SQLRFU-003)

**What**: Capture a concise final aggregate for `bun run test` with required external LLM/PostgreSQL services.
**Depends on**: External PostgreSQL + LLM available.
**Done when**:
- [ ] A single concise aggregate (pass/fail/skip counts per package) is recorded in `validation.md`.
- [ ] The aggregate reflects a run with both LLM and PostgreSQL services available (not a degraded skip-heavy run).

Artifact-store evidence: task plan created 2026-07-21 (Wave 4 T16).