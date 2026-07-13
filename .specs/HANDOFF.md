# AI Engineering Handoff

## Active Work

Feature `close-maintenance-next-steps-2026-07-13` is active under workflow session `spec-close-maintenance-next-steps-2026-07-13`. Approved source plan: `/Users/luizmassa/Downloads/PLAN-final.md`.

## Verified Baseline

- Clean `main` at `cc985905fae3495a31a16aaf0fbd75435a2e63df`, aligned with `origin/main` before spec activation.
- Bun 1.3.11, Node 25.9.0, Turbo 2.10.2, PostgreSQL 17.10, Ollama client 0.31.2.
- Shared `:3333`: PID 9754, healthy; probe-only boundary.
- Dedicated `:3334`, `:5433`, `:11435` were free.

## Execution Contract

Follow `.specs/features/close-maintenance-next-steps-2026-07-13/tasks.md` in order. Preserve `.specs/features/repository-maintenance-2026-07-12/` byte-for-byte. Use explicit dedicated PostgreSQL/API/Ollama environment. Commit each cluster only after focused verification. Do not push.

## Completed

- TASK-001 committed as `d42eb81`.
- TASK-002 committed as `1eb7aaa`: 82 unit/Synapse tests, live dedicated PG/qwen F24, and type-check 6/6.
- TASK-003 implemented and focused-verified: 25 filter/controller/cache tests, assertion-equivalent SQLite/PostgreSQL cache parity, live dedicated PG/qwen F18, and type-check 6/6.
- Dedicated stack is active under `/tmp/massa-th0th-close-20260713-1424` with PG PID 23481, Ollama PID 24780, API PID 35336. It is owned by this run; do not signal without revalidating identity.

## Current Next Step

Implement TASK-004 dependency-outage transparency. Reprovision the dedicated DB before fixture/G10 acceptance because the current disposable search index intentionally uses a temporary path.
