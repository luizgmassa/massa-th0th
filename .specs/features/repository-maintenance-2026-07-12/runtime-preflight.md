# Dedicated Runtime Preflight

**Status:** PASS — 2026-07-12

Docker was unavailable, so the approved `:5433` contract was implemented with an isolated
native PostgreSQL 17 cluster under `/tmp/massa-ai-maintenance-20260712/postgres`.

- PostgreSQL: `massa_ai_test` on `127.0.0.1:5433`; pgvector `0.8.4`.
- Migrations: all 13 committed Prisma migrations applied successfully.
- Dedicated Ollama: `127.0.0.1:11435`; required embedding/instruct/coder models present.
- Dedicated API: `localhost:3334`; health `ok`; data directory isolated under the task root.
- Scheduler: disabled. API key: disabled for isolated dev test stack.
- Shared API `localhost:3333`: health `ok` after provisioning; never restarted.

Observed source/runtime fact: dedicated API selected PostgreSQL graph, job, observation, and
scheduled-job stores, but `SqliteProposalStore` remains active under PostgreSQL configuration.
This finding was fixed under the approved PAR-07/PAR-08 amendment: handoffs and proposals now
select PostgreSQL stores, and migration 14 supplies their tables. Final teardown stopped the
owned API, Ollama, and native PostgreSQL cluster; shared API `:3333` remained healthy.
