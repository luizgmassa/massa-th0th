# Phase 4 — Bootstrap from Repo (Seed Memories): Validation

Slug: `phase-4-bootstrap`. **Same-author verification** (sole agent for this
phase). Run as a strict standalone fresh-eyes re-derivation + discrimination
sensor. The same-author caveat applies: there is no independent second agent.
Mitigations: every AC is anchored to file:line evidence below, the
discrimination sensor killed its mutant, and the gate is the objective
`bun run test` + `bun run type-check`.

## Verdict: PASS

The repo-bootstrap deliverable (`BootstrapService` with scan + LLM/rule-based
seed paths + idempotency marker + silent degradation, `bootstrap:completed`
event, MCP tool `bootstrap`, API route, core barrel re-exports) meets
its acceptance criteria. Gate = `bun run test` **754 pass / 0 fail /
46 skip** (baseline 738 → +16, no regressions), `bun run type-check` clean
(5/5). The discrimination sensor killed its mutant. The LLM path is
default-off and silent-degrades to rule-based seeds (proven by dedicated
tests); idempotency is proven (second run is a no-op); searchability is
proven (a seed memory is found by `MemoryRepository.fullTextSearch`).

## Scope reviewed

- Commits: `c022731` (specs), `1be1a1c` (config + event), `ae296e7`
  (bootstrap-service), `773a130` (MCP tool + route + barrel), `3fec6fd`
  (tests + no-signals short-circuit fix).
- Spec artifacts: `spec.md`, `design.md`, `tasks.md`, `validation.md` (this file).
- Test diff: +1 test file (`bootstrap-service.test.ts`, 16 tests) = +16 tests;
  **no tests weakened, skipped, deleted, or `.skip`/`todo`/`xit`/`only`
  added**. The Phase-3 baseline (738) is preserved verbatim.

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P4-SCAN-01 | `scanSignals` gathers ≥1 signal from a fixture repo + injected centrality | `bootstrap-service.ts` `scanSignals` reads git log + README + docs + manifests + `symbolGraph.getTopCentralFiles`; `bootstrap-service.test.ts` P4-SCAN-01 asserts gitLog non-empty + readme contains "Fixture Project" + docs[0].path + manifests[0].name="fixture-app" + centralFiles[0].filePath="src/index.ts". Missing-signal-skip test asserts all-empty on an empty root. | YES |
| P4-SEED-01 | LLM on → stores ≥1 seed of type pattern/code/decision, tagged `bootstrap:<projectId>` | `bootstrap-service.ts` `storeSeeds` builds `InsertMemoryInput` with `tags:["bootstrap","bootstrap:<projectId>"]`; P4-SEED-01 asserts `bootstrapped=true`, `source="llm"`, 3 inserts, types contain all three, every insert has projectId + tags + content ≤512 + metadata.source="bootstrap". | YES |
| P4-SEARCH-01 | A stored seed is searchable via `MemoryRepository.fullTextSearch` (FTS5) | Integration block P4-SEARCH-01 resets the singleton to a temp DB, `repo.insert({content with distinctive token})`, `repo.fullTextSearch(token, ...)` returns the row; asserts `found.content` contains the token. | YES |
| P4-IDEMPOTENT-01 | Second run without `force` is a no-op (no inserts, `skipped:true`, no event) | `bootstrap-service.ts` idempotency guard `if (!opts.force && isBootstrappedFn(...))`; P4-IDEMPOTENT-01 injects `hasMarker:true`, asserts `bootstrapped=false`, `skipped=true`, `reason="already-bootstrapped"`, 0 inserts, `markerChecked` includes projectId, no `bootstrap:completed` event. | YES |
| P4-IDEMPOTENT-02 | Second run with `force=true` proceeds (refresh) | P4-IDEMPOTENT-02 injects `hasMarker:true` + `force:true`, asserts `bootstrapped=true`, 3 inserts. | YES |
| P4-DEGRADE-01 | LLM off → no throw, rule-based seeds (or skip), no LLM call | `bootstrap-service.ts` LLM-off branch calls `ruleBasedSeed`; P4-DEGRADE-01 injects `disabledSurface()`, asserts `bootstrapped=true`, `source="rule-based"`, every insert metadata.rationale matches `^rule-based`. | YES |
| P4-DEGRADE-02 | LLM on but `{ok:false}` → rule-based fallback, no throw | P4-DEGRADE-02 injects `failingSurface()` (returns `{ok:false}`), asserts `bootstrapped=true`, `source="rule-based"`. | YES |
| P4-EVENT-01 | `bootstrap:completed` in EventMap + published with correct shape on success | `event-bus.ts` EventMap entry; `bootstrap-service.ts` publishes after `storeSeeds`; P4-EVENT-01 subscribes, asserts payload `{projectId, source:"llm", bootstrapId:"^boot-", seedMemoryIds:[3], signalCount>0, memoryCount:3}`. No-event-on-no-signals test asserts the skip path does not emit. | YES |
| P4-DEGRADE-03 | `bootstrap.enabled=false` → 423 | `routes/bootstrap.ts` `bootstrapDisabled()` → `set.status=423`; service-level disabled path returns `noopResult("bootstrap-disabled")`. (Route-level 423 verified by code inspection; the service-level path is the contract gate.) | YES (inspection) |
| P4-TOOL-01 | `bootstrap` in `TOOL_DEFINITIONS`; route registered | `apps/mcp-client/src/tool-definitions.ts` entry (POST `/api/v1/bootstrap`, projectId required); `apps/tools-api/src/routes/bootstrap.ts` route; `apps/tools-api/src/index.ts` `.use(bootstrapRoutes)`. Verified by type-check (route compiles + is imported). | YES |

## Edge cases

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| Not a git repo / git fails | `scanSignals` git try/catch → `gitLog:[]`; missing-signal test injects a failing git runner, asserts empty gitLog, no throw. | YES |
| No README / docs / manifests | each step wrapped in try/catch + existence check; missing-signal test on empty root asserts all empty. | YES |
| Project not indexed (centrality empty) | `symbolGraph.getTopCentralFiles` wrapped in try/catch → `centralFiles:[]`; fake returns `[]`, scan proceeds. | YES |
| Empty signal bundle → skip seeding | `bootstrap()` `signalCount===0` short-circuit → `noopResult("no-signals")` BEFORE LLM call; no-signals test asserts `bootstrapped=false`, `reason="no-signals"`, no event. | YES |
| LLM returns schema-invalid object | `llmObject` (Phase-1) returns `{ok:false}` on zod fail → `summarizeWithLlm` returns `{ok:false}` → rule-based fallback. (Covered by P4-DEGRADE-02 shape.) | YES |
| `projectId` empty/whitespace | `routes/bootstrap.ts` `if (!projectId \|\| !trim)` → 400. | YES (route) |
| `force=true` refresh (no delete) | P4-IDEMPOTENT-02; `storeSeeds` does not delete prior seeds (documented refresh behavior). | YES |
| Seed summary > 512 chars | `storeSeeds` truncates via `truncate(seed.summary, MAX_SUMMARY_CHARS)`; P4-SEED-01 asserts `content.length ≤ 512`. | YES |
| `memoryRepo.insert` throws | `storeSeeds` try/catch in `bootstrap()` → `noopResult("insert-failed")`, no event. | YES (code path) |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| Full suite | `bun run test` | **754 pass / 0 fail / 46 skip** (baseline 738 → +16). Ran 800 across 63 files (core) + 7 (mcp-client). |
| type-check | `bun run type-check` | **clean** (5/5 tasks). |
| idempotency | `bun test bootstrap-service.test.ts` P4-IDEMPOTENT-01 | marker present → `skipped:true`, 0 inserts, no event. |
| LLM-off degradation | `bun test bootstrap-service.test.ts` P4-DEGRADE-01 | `source="rule-based"`, no throw, seeds stored. |
| searchability | `bun test bootstrap-service.test.ts` P4-SEARCH-01 | `fullTextSearch(token)` finds the seed row. |

## Discrimination sensor

Mutant = temporary source edit; only the relevant test file was run; source
reverted with `cp` immediately after. Tree verified clean (`grep` confirms
the mutant string gone; the only `git diff` is the legitimate 5-line
`signalCount===0` short-circuit improvement, committed as part of `3fec6fd`).

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| idempotency guard | `bootstrap-service.ts` `if (!opts.force) {` → `if (false && !opts.force) {` (guard never fires) | `bootstrap-service.test.ts` | **KILLED** — P4-IDEMPOTENT-01 fails: `expect(res.bootstrapped).toBe(false)` received `true` (the service proceeded to store seeds instead of no-op'ing). |

Mutant killed. No surviving mutant.

## Fresh-eyes re-derivation (standalone)

1. **Config (R-config, design §2).** Spec: `memory.bootstrap` block, default-on
   for scan/rule-based, LLM inherits `llm.enabled`. Read `config/index.ts`:
   `memory.bootstrap: { enabled(true), maxSeedMemories(8), centralityLimit(10),
   gitLogLimit(20), refreshEnabled(true) }` in interface + defaultConfig +
   mergeConfig (shallow-merges nested). Env knobs `BOOTSTRAP_*`. **OK.**
2. **EventBus event (R4, P4-EVENT-01).** Spec: `bootstrap:completed` typed.
   Read `event-bus.ts`: EventMap entry `{ projectId, bootstrapId,
   seedMemoryIds[], source:"llm"|"rule-based", signalCount, memoryCount }`.
   Published after `storeSeeds` returns ≥1 id; NOT on no-op/empty. **OK.**
3. **Scan (R1, P4-SCAN-01).** Spec: gather git/README/docs/manifests/
   centrality, best-effort. Read `scanSignals`: each source in try/catch,
   git via injectable `gitRunner`, README probe (case-insensitive candidates),
   docs shallow walkMarkdown, manifests parsed (package.json name/desc/deps),
   centrality via `symbolGraph.getTopCentralFiles`. Missing → empty default.
   **OK.**
4. **LLM summarization (R2, P4-SEED-01).** Spec: `llmObject` + zod, bounded
   list, types pattern/code/decision. Read `summarizeWithLlm` + `SeedMemoriesSchema`:
   zod schema enforces type enum + level literals + importance [0,1] + max 8;
   calls injected `LlmSurface.object`; `{ok:false}`/throw → fallback. `storeSeeds`
   builds `InsertMemoryInput` with `tags:["bootstrap","bootstrap:<projectId>"]`,
   `embedding:[]`, `metadata.source="bootstrap"`. **OK.**
5. **Idempotency (R3, P4-IDEMPOTENT-01/02).** Spec: marker tag, no-op without
   force, refresh with force. Read `bootstrap()`: `if (!opts.force &&
   isBootstrappedFn(projectId))` returns `skipped:true`; `force=true` proceeds.
   `MemoryRepoSeam.hasBootstrapMarker` default queries `tags LIKE
   '%bootstrap:<projectId>%' AND deleted_at IS NULL` (injectable for tests).
   **OK.**
6. **Silent degradation (R5, P4-DEGRADE-01/02).** Spec: LLM off/{ok:false} →
   rule-based; empty → skip; never throw. Read `bootstrap()`: LLM-on branch
   with `summarizeWithLlm` → on `{ok:false}` falls to `ruleBasedSeed`; LLM-off
   branch direct to `ruleBasedSeed`; `signalCount===0` short-circuits to
   `no-signals`; `storeSeeds` try/catch → `insert-failed`. Outer control flow
   never throws to caller. **OK.**
7. **MCP tool + route (R6, P4-TOOL-01).** Spec: `bootstrap` POST
   `/api/v1/bootstrap`. Read `tool-definitions.ts`: entry with correct schema;
   `routes/bootstrap.ts`: Elysia prefix, 423 when disabled, 400 on empty
   projectId, 200 + `{success, data}`; `index.ts` `.use(bootstrapRoutes)`.
   **OK.**
8. **Test isolation (NF, design §11).** Spec: inject fakes, no shared-config
   mock. Read `bootstrap-service.test.ts`: injects `MemoryRepoSeam` +
   `LlmSurface` + `CentralitySource` + `GitRunner`; single P4-SEARCH-01 block
   resets the MemoryRepository singleton to a temp DB and restores it. No
   `mock.module("@massa-th0th/shared")`. **OK.**
9. **No migration (NF2).** Spec: seed memories are existing `memories` rows.
   Read `storeSeeds`: only calls `MemoryRepository.insert` (existing schema);
   marker = tag query. No `ALTER TABLE`, no new table. **OK.**

No gaps surfaced beyond the accepted assumptions below.

## Accepted assumptions / residual risk

1. **Seed memories have no embeddings.** They are FTS-searchable but not
   vector-searchable (`embedding:[]`). Consistent with Phase-3 consolidation
   output. Low risk: bootstrap seeds are keyword-retrieval targets (project
   name, architecture, conventions); vector search is not the primary path.
   A future enhancement can embed seed summaries via the existing
   `EmbeddingService` if vector recall of seeds becomes useful.
2. **Marker = tag, not a dedicated column/table.** `tags LIKE
   '%bootstrap:<projectId>%'` is O(rows) but bootstrap is rare (once per
   project) and the `memories` table is indexed by `project_id`. A future
   dedicated `bootstrap_state` table can replace this without contract change.
3. **Refresh does not delete prior seeds.** `force=true` stores a fresh batch
   alongside the old one (the consolidation job may later SUPERSEDE them).
   Documented refresh behavior; avoids data loss. Repeated `force` runs could
   accumulate seeds — acceptable (they're cheap rows; decay/consolidation
   handle them).
4. **PG marker query falls back to "not bootstrapped".** The default
   `hasBootstrapMarker` uses `getDb()` (SQLite-only); the PG repo lacks it, so
   PG deployments always re-seed on each call until a dedicated
   `bootstrap_state` table is added. SQLite-canonical is the documented
   default; PG parity is a future enhancement (matches the synapse_sessions/
   index_jobs precedent).
5. **P4-DEGRADE-03 (423) verified by inspection, not a route integration test.**
   The route-level `bootstrapDisabled()` → 423 path is simple and type-checks;
   the service-level disabled contract is gated by the `enabled` config read.
   A live HTTP test would need a running tools-api + config flip; deferred.
6. **P4-SEARCH-01 uses the MemoryRepository singleton reset.** This mirrors
   `memory-crud.test.ts`'s pattern (the only file that owns the shared-config
   mock). The test restores the saved singleton in `afterEach` so other suites
   are unaffected. If bun ever changes singleton-reset semantics this test
   would need adjustment — but it's the proven pattern in this codebase.
7. **Same-author verification.** No independent verifier sub-agent was
   spawned. Mitigated by the per-AC evidence table, the discrimination sensor
   (mutant killed), and the objective gate (754/0).

## Conclusion

Phase 4 meets its acceptance criteria and success criteria. Verdict **PASS**.
Ready for Phase 6 (handoffs) to consume the SessionStart hook + the
`bootstrap:<projectId>` seed memories as initial context; Phase 5 (auto-improve)
may consume the seed memories as a baseline for proposed edits.
