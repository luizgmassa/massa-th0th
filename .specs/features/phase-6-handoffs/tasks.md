# Phase 6 — Cross-session Handoffs (G2): Tasks

One atomic commit per task. Conventional Commits. Branch `main`.

## Task 1 — Config + EventBus + Handoff table migration (specs committed separately)
- Add `handoffs: { enabled }` to `ServerConfig` interface + defaultConfig
  + `mergeConfig` (`packages/shared/src/config/index.ts`). Env
  `HANDOFFS_ENABLED` default true.
- Add `handoff:accepted` to `EventMap`
  (`packages/core/src/services/events/event-bus.ts`).
- Add Prisma `Handoff` model (`packages/core/prisma/schema.prisma`).
- **Commit:** `feat(handoff): add handoffs config + handoff:accepted event + Handoff schema`.

## Task 2 — HandoffStore (SQLite + Memory + factory)
- Create `packages/core/src/data/handoff/handoff-repository.ts`:
  `HandoffStore` interface, `MemoryHandoffStore` (in-memory fallback),
  `SqliteHandoffStore` (lazy-open `handoffs.db`, WAL + busy_timeout=3000,
  `CREATE TABLE IF NOT EXISTS handoffs` + 3 indexes),
  `getHandoffStore()`/`resetHandoffStore()` (mirrors
  `getObservationStore()`), `newHandoffId()`, types (`HandoffRecord`,
  `HandoffStatus`, etc.).
- Methods: `insert`, `getById`, `listPending(projectId, targetAgent?)`,
  `setStatus(id, status, acceptedAt?)`, `journalMode()`.
- **Commit:** `feat(handoff): add HandoffStore (SQLite WAL + Memory fallback + factory)`.
- Unit test `packages/core/src/__tests__/handoff-repository.test.ts`
  (insert/getById/listPending/setStatus ordering + status filter). May
  fold into Task 4 test commit.

## Task 3 — HandoffService (begin/accept/cancel/listPending + dual-write + auto-injector)
- Create `packages/core/src/services/handoff/handoff-service.ts`:
  `HandoffService` (ctor `HandoffDeps { store?, memoryRepo?, llm?,
  idFactory? }`), `begin`/`accept`/`cancel`/`listPending`, pure helpers
  (`buildHandoffMemoryInput`, `HandoffSummarySchema`), singleton
  `getHandoffService()`/`resetHandoffService()`.
- Create `packages/core/src/services/handoff/handoff-auto-injector.ts`:
  `HandoffAutoInjector` subscribing to `observation:ingested`
  (`source==="session-start"`).
- Barrel re-exports in `packages/core/src/index.ts`.
- **Commit:** `feat(handoff): add HandoffService + auto-injector (begin/accept/cancel/dual-write/listPending)`.

## Task 4 — MCP tools + API route + barrel
- 4 entries in `apps/mcp-client/src/tool-definitions.ts`
  (`handoff_begin/accept/cancel/list_pending`).
- `apps/tools-api/src/routes/handoff.ts` (Elysia prefix
  `/api/v1/handoff`; 423 disabled, 400 missing, 200 + `{success, data}`).
- Wire `.use(handoffRoutes)` into `apps/tools-api/src/index.ts`.
- Swagger tag `handoffs`.
- **Commit:** `feat(handoff): wire MCP tools + /api/v1/handoff routes`.

## Task 5 — Tests + validation + ledger update
- `packages/core/src/__tests__/handoff-service.test.ts`: all ACs
  (P6-BEGIN/ACCEPT/CANCEL/FAIL/SEARCH/DUALWRITE/AUTOINJECT/EVENT/DEGRADE/TOOL/MIGRATION).
- Discrimination sensor (mutate accept status-guard → P6-FAIL-02 fails).
- `handoff-repository.test.ts`: SqliteHandoffStore direct unit test.
- Run gates: `bun run --filter @massa-th0th/core test` (no regressions vs
  754), `bun run type-check` (clean).
- `validation.md` (verdict, per-AC evidence, gate output, discrimination
  sensor, accepted assumptions, same-author caveat).
- Update `.specs/project/STATE.md`, `.specs/project/FEATURES.json` (add
  phase-6 row), `.specs/HANDOFF.md`.
- Append Phase-6 delta to `.specs/PHASE-INTEGRATION.md` + commit-ledger
  rows.
- **Commit:** `test(handoff): cover begin/accept/cancel/fail/dual-write/auto-inject + validation`.
