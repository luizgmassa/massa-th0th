# Phase 3 — Tasks

One atomic commit per task. Conventional Commits. Branch `main`. Never `git push`.

## T1 — Spec artifacts
- [x] `spec.md`, `design.md`, `tasks.md` (this commit).
- AC mapping, edge cases, out-of-scope, design incl. queue/WAL/429/bridge/hooks.

## T2 — Config + Observation store + factory + EventMap
- [ ] Add `hooks` config block (type + defaults + mergeConfig) in
  `packages/shared/src/config/index.ts`. Env knobs per design §2.
- [ ] `packages/core/src/data/memory/observation-repository.ts`:
  `ObservationStore` interface, `MemoryObservationStore` (no-op),
  `SqliteObservationStore` (lazy open, WAL, busy_timeout, createSchema),
  `getObservationStore()`/`resetObservationStore()` factory.
- [ ] Prisma `Observation` model in `packages/core/prisma/schema.prisma`
  (additive, `@@map("observations")`).
- [ ] Add `observation:ingested` to `EventMap` (`services/events/event-bus.ts`).
- Tests: `observation-repository.test.ts` (insert/list/WAL pragma, explicit
  dbPath, no config mock). Commit `feat(hooks): add observation store, config, event`.

## T3 — HookService + single-writer queue + 429
- [ ] `packages/core/src/services/hooks/writer-queue.ts` — `WriterQueue` +
  `QueueSaturatedError`.
- [ ] `packages/core/src/services/hooks/hook-service.ts` — validate/normalize,
  ingestOne/ingestBatch, eventBus publish inside writer, bridge trigger hook.
- Tests: `hook-service.test.ts` — P3-INGEST-01/02, P3-BACKPRESSURE-01/02,
  P3-VALIDATE-01/02, P3-QUEUE-01, P3-EVENT-01, P3-DEGRADE-01. Inject
  MemoryObservationStore + fake bridge; NO config mock.
- Commit `feat(hooks): add hook-service with single-writer queue and 429`.

## T4 — Routes + MCP tool + bridge + hook scripts
- [ ] `apps/tools-api/src/routes/hooks.ts` (Elysia `POST /api/v1/hook` +
  `/hook/batch`); wire into `apps/tools-api/src/index.ts`.
- [ ] `packages/core/src/services/jobs/observation-consolidation-job.ts`
  (debounce trigger, silent-skip, reuse consolidator).
- [ ] `apps/mcp-client/src/tool-definitions.ts`: add `hook_ingest`.
- [ ] `apps/claude-plugin/hooks/{session-start,user-prompt-submit,post-tool-use,stop}.sh`
  + `README.md`.
- Tests: `observation-consolidation-job.test.ts` — P3-CONSOLIDATE-01/02/03
  (fake LlmSurface on/off/{ok:false}); routes test or fold into hook-service
  test for P3-HOOKSCRIPT-01 (script existence + silent-exit).
- Commit `feat(hooks): add routes, consolidation bridge, hook scripts, mcp tool`.

## T5 — Validation + ledger
- [ ] `validation.md` — PASS/Needs-Fix/Blocked + per-AC table + discrimination
  sensor + gate output + same-author caveat.
- [ ] Run gates: `bun run test` (no regressions vs 700) + `bun run type-check`.
- [ ] Discrimination sensor (drop maxPending check → P3-BACKPRESSURE-01 fails).
- [ ] Update `.specs/project/STATE.md`, `FEATURES.json`, `HANDOFF.md`.
- [ ] Append Phase-3 delta to `.specs/PHASE-INTEGRATION.md` + commit-ledger rows.
- Commit `docs(specs): phase-3 validation + integration ledger`.
