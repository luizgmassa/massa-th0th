# Phase 4 — Bootstrap from Repo: Tasks

Feature slug: `phase-4-bootstrap`. One atomic commit per task. Conventional
Commits. Branch `main` (never `git push`).

## Task 1 — Spec artifacts
- [x] Write `.specs/features/phase-4-bootstrap/{spec,design,tasks}.md`.
- Commit: `docs(specs): phase-4 bootstrap spec, design, tasks`

## Task 2 — Config block + EventMap entry
- Add `memory.bootstrap` block to `ServerConfig` interface, `defaultConfig`,
  and `mergeConfig` in `packages/shared/src/config/index.ts`.
  - Keys: `enabled(envBool BOOTSTRAP_ENABLED=true)`,
    `maxSeedMemories(envNum BOOTSTRAP_MAX_SEED_MEMORIES=8)`,
    `centralityLimit(envNum BOOTSTRAP_CENTRALITY_LIMIT=10)`,
    `gitLogLimit(envNum BOOTSTRAP_GIT_LOG_LIMIT=20)`,
    `refreshEnabled(envBool BOOTSTRAP_REFRESH_ENABLED=true)`.
- Add `bootstrap:completed` to `EventMap` in
  `packages/core/src/services/events/event-bus.ts`.
- Verify: `bun run type-check` clean.
- Commit: `feat(bootstrap): add memory.bootstrap config + bootstrap:completed event`

## Task 3 — BootstrapService (scan + LLM + rule-based + idempotent + store)
- Create `packages/core/src/services/bootstrap/bootstrap-service.ts`:
  - `BootstrapService` class with `BootstrapDeps` ctor seam (lazy
    `memoryRepo`, `llm`, `isBootstrapped`, `symbolGraph`, `gitRunner`).
  - `bootstrap(projectId, opts)` control flow per design §9.
  - Pure helpers: `scanSignals`, `summarizeWithLlm` (+`SeedMemoriesSchema`),
    `ruleBasedSeed`, `storeSeeds`.
  - Exports: `BootstrapService`, `getBootstrapService`, `resetBootstrapService`,
    `SeedMemoriesSchema`, types (`BootstrapSeed`, `BootstrapSignals`,
    `BootstrapResult`, `BootstrapOptions`, `BootstrapDeps`, `MemoryRepoSeam`).
  - Singleton `bootstrapService` (deps default).
- Verify: `bun run type-check` clean.
- Commit: `feat(bootstrap): add BootstrapService with scan, LLM/rule-based seed, idempotency`

## Task 4 — MCP tool + API route + barrel re-exports
- Append `bootstrap` tool definition to `TOOL_DEFINITIONS` in
  `apps/mcp-client/src/tool-definitions.ts`.
- Create `apps/tools-api/src/routes/bootstrap.ts` (Elysia, mirroring
  `routes/hooks.ts`): `POST /api/v1/bootstrap` → `getBootstrapService().bootstrap(...)`,
  423 when disabled, 400 on empty projectId.
- Wire into `apps/tools-api/src/index.ts`: import + `.use(bootstrapRoutes)`.
- Re-export bootstrap symbols from `packages/core/src/index.ts` (core barrel).
- Verify: `bun run type-check` clean.
- Commit: `feat(bootstrap): wire bootstrap MCP tool + API route + barrel exports`

## Task 5 — Tests + validation + ledger update
- Create `packages/core/src/__tests__/bootstrap-service.test.ts` covering:
  - P4-SCAN-01, P4-SEED-01, P4-SEARCH-01, P4-IDEMPOTENT-01/02,
    P4-DEGRADE-01/02/03, P4-EVENT-01, P4-TOOL-01.
  - Injected fakes: `MemoryRepoSeam`, `LlmSurface`, `symbolGraph`,
    `gitRunner`; temp project root fixture.
- Run gates: `bun run test` (no regressions vs 738/0/46), `bun run type-check` (5/5).
- Discrimination sensor (mutant killed).
- Write `.specs/features/phase-4-bootstrap/validation.md`.
- Update `.specs/project/STATE.md`, `.specs/project/FEATURES.json`,
  `.specs/HANDOFF.md`.
- Append Phase-4 delta + commit-ledger rows to `.specs/PHASE-INTEGRATION.md`.
- Commits:
  - `test(bootstrap): cover scan, seed, idempotency, degradation, event`
  - `docs(specs): phase-4 validation + integration ledger update`
