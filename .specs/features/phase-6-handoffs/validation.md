# Phase 6 — Cross-session Handoffs (G2): Validation

Slug: `phase-6-handoffs`. **Same-author verification** (sole agent for this
phase). Run as a strict standalone fresh-eyes re-derivation + discrimination
sensor. The same-author caveat applies: there is no independent second agent.
Mitigations: every AC is anchored to file:line evidence below, the
discrimination sensor killed its mutant (2 failing tests), and the gate is
the objective `bun run test` + `bun run type-check`.

## Verdict: PASS

The cross-session handoff deliverable (`HandoffStore` SQLite-canonical +
`HandoffService` begin/accept/cancel/listPending with dual-write searchable
memory + `handoff:accepted` event + auto-injector + 4 MCP tools + API
route + core barrel re-exports) meets its acceptance criteria. Gate =
`bun run --filter @massa-th0th/core test` **791 pass / 0 fail / 46 skip**
(baseline 754 → +37), `bun run type-check` clean (5/5). The discrimination
sensor killed its mutant. The state machine (open → accepted | expired,
both terminal) is proven; every failure mode (missing / non-open /
project-mismatch) returns a clear `{ok:false, reason}`; the dual-write
memory is proven FTS-searchable; auto-inject surfaces a pending handoff on
`session-start` `observation:ingested`.

## Scope reviewed

- Commits: `d3ccd2e` (specs), `60e799b` (config + event + Prisma),
  `4d8ac60` (store + service + injector + barrel), `8f2f0a0` (MCP tools +
  route), `<this commit>` (tests + validation).
- Spec artifacts: `spec.md`, `design.md`, `tasks.md`, `validation.md`
  (this file).
- Test diff: +2 test files (`handoff-service.test.ts` 26 tests +
  `handoff-repository.test.ts` 11 tests) = +37 tests; **no tests weakened,
  skipped, deleted, or `.skip`/`todo`/`xit`/`only` added**. The Phase-4
  baseline (754) is preserved verbatim.

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P6-BEGIN-01 | begin creates an open row + returns id/status/memoryId | `handoff-service.ts` `begin()` inserts `status:"open"`; `handoff-service.test.ts` P6-BEGIN-01 asserts `res.ok`, `status:"open"`, `id` matches `^handoff_test_`, `memoryId` matches `^handoff-mem-`, row.status="open", all input fields preserved, acceptedAt null. Missing-project test asserts `{ok:false, missing-project}`, 0 rows. | YES |
| P6-DUALWRITE-01 | begin dual-writes a conversation memory, PROJECT level, 0.7 importance, handoff tags, no embedding | `handoff-service.ts` `dualWrite` → `buildHandoffMemoryInput`; P6-DUALWRITE-01 asserts type=CONVERSATION, level=PROJECT(1), importance=0.7, tags include `handoff` + `handoff:<id>` + `handoff:<projectId>`, embedding=[], metadata.source="handoff". | YES |
| P6-SEARCH-01 | the dual-write memory is FTS-searchable | Integration block P6-SEARCH-01 resets the MemoryRepository singleton to a temp DB, begins a handoff with a distinctive token, `repo.fullTextSearch(token, ...)` finds the row, asserts `found.content` contains the token. | YES |
| P6-ACCEPT-01 | accept flips open→accepted, sets acceptedAt, emits handoff:accepted | `handoff-service.ts` `accept`/`terminate`; P6-ACCEPT-01 asserts status="accepted", acceptedAt ∈ [before, after], event payload `{handoffId, projectId, targetAgent, acceptedAt:number}`. | YES |
| P6-CANCEL-01 | cancel flips open→expired, no event | `cancel`/`terminate`; P6-CANCEL-01 asserts status="expired", acceptedAt null, event NOT fired. | YES |
| P6-FAIL-01 | accept on missing id → {ok:false, not-found} | P6-FAIL-01 asserts `{ok:false, not-found}`, event NOT fired. | YES |
| P6-FAIL-02 | accept/cancel on terminal status → {ok:false, not-open} | P6-FAIL-02 (accept) asserts second accept `{ok:false, not-open}`, acceptedAt unchanged, no event. P6-FAIL-02 (cancel) asserts second cancel `{ok:false, not-open}`. | YES |
| P6-FAIL-03 | accept with projectId mismatch → {ok:false, project-mismatch} | P6-FAIL-03 asserts `{ok:false, project-mismatch}`, status unchanged (open). | YES |
| P6-AUTOINJECT-01 | listPending returns only open handoffs for project/target; injector records on session-start | `handoff-service.ts` `listPending`; test asserts ordered oldest-first, target filter (broadcast nulls included), accept excludes; `HandoffAutoInjector` subscribes `observation:ingested`, on `source:"session-start"` records pending count (log captured), listPending returns the row. Non-session-start event ignored. | YES |
| P6-EVENT-01 | handoff:accepted in EventMap with specified shape | `event-bus.ts` EventMap entry `{handoffId, projectId?, sourceSessionId?, targetAgent?, acceptedAt}`; P6-EVENT-01 asserts all fields. | YES |
| P6-TOOL-01 | 4 MCP tools in TOOL_DEFINITIONS + route registered | `tool-definitions.ts` entries handoff_begin/accept/cancel/list_pending; `routes/handoff.ts` 4 POST handlers; `index.ts` `.use(handoffRoutes)`. Type-check confirms route compiles + is imported. | YES |
| P6-DEGRADE-01 | empty summary + LLM off → stores empty summary, no throw; LLM {ok:false} likewise | P6-DEGRADE-01 (off) asserts ok:true, summary=""; (on-polished) asserts summary="Polished summary from LLM"; (on-fail) asserts summary="" with failingSurface. | YES |
| P6-MIGRATION-01 | SQLite CREATE TABLE IF NOT EXISTS handoffs + Prisma Handoff model; additive | `handoff-repository.ts` `createSchema` `CREATE TABLE IF NOT EXISTS handoffs` + 3 indexes; `schema.prisma` `model Handoff @@map("handoffs")`; idempotent-reopen test asserts second store on same path reads the row. | YES |

## Edge cases

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| begin dedup/trim openQuestions/nextSteps/files | `dedupStrings` trims + dedups + drops empties; test asserts `["  q1  ","q1","","q2"]` → `["q1","q2"]`. | YES |
| begin store insert throws → {ok:false, store-failed} | throwing-store test asserts `{ok:false, store-failed}`, no event. | YES |
| begin memory insert throws → still ok, memoryId null | throwing-mem test asserts `ok:true`, `memoryId:null`. | YES |
| listPending store throws → returns [] (never throws) | throwing-listPending test asserts no throw + `[]`. | YES |
| setStatus on non-open row (SQLite WHERE guard) | SqliteHandoffStore `setStatus` `WHERE status='open'` no-op; test asserts row unchanged (acceptedAt preserved). | YES |
| createSchema idempotent (reopen same path) | store2-on-same-dbPath test asserts getById finds the prior row. | YES |
| injector ignores non-session-start observations | post-tool-use event test asserts no effect on pending list. | YES |
| accept missing id → {ok:false, missing-id} | empty-id test asserts `missing-id`. | YES |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| Full suite (core) | `bun run --filter @massa-th0th/core test` | **791 pass / 0 fail / 46 skip** (baseline 754 → +37). Ran 837 tests across 65 files. |
| Full suite (mcp-client) | `bun run --filter @massa-th0th/mcp-client test` | **7 pass / 0 fail** (unchanged). |
| type-check | `bun run type-check` | **clean** (5/5 tasks). |
| begin happy path | `handoff-service.test.ts` P6-BEGIN-01 | open row + id + memoryId. |
| accept state transition + event | `handoff-service.test.ts` P6-ACCEPT-01 | status accepted, acceptedAt set, event fired with shape. |
| cancel state transition | `handoff-service.test.ts` P6-CANCEL-01 | status expired, no event. |
| failure modes | `handoff-service.test.ts` P6-FAIL-01/02/03 | not-found / not-open / project-mismatch. |
| dual-write searchability | `handoff-service.test.ts` P6-SEARCH-01 | `fullTextSearch(token)` finds the dual-write memory. |
| auto-inject | `handoff-service.test.ts` P6-AUTOINJECT-01 | injector records pending on session-start; listPending returns it. |

## Discrimination sensor

Mutant = temporary source edit; only the relevant test file was run; source
reverted with `cp` immediately after. Tree verified clean.

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| status-guard removal | `handoff-service.ts` `if (row.status !== "open")` → `if (false && row.status !== "open")` (guard never fires) | `handoff-service.test.ts` | **KILLED** — 2 tests fail: P6-FAIL-02 (accept on already-accepted) and P6-FAIL-02 (cancel on expired). The first accept's `setStatus` succeeded, so a second `accept`/`cancel` no longer short-circuits at the service guard; the test's `reason:"not-open"` assertion receives `"store-failed"` (the post-update status check fails because the store's `WHERE status='open'` clause no longer matches). Mutant killed. |

Mutant killed. No surviving mutant.

## Fresh-eyes re-derivation (standalone)

1. **Config (R-config, design §10).** Spec: `handoffs.enabled` top-level.
   Read `config/index.ts`: `handoffs: { enabled }` in interface + defaultConfig
   (`envBool HANDOFFS_ENABLED=true`) + `mergeConfig` shallow-merges
   `handoffs`. **OK.**
2. **EventBus event (R6, P6-EVENT-01).** Spec: `handoff:accepted` typed.
   Read `event-bus.ts`: EventMap entry `{ handoffId, projectId?,
   sourceSessionId?, targetAgent?, acceptedAt }`. Published only in
   `terminate` on a successful `accepted` transition. **OK.**
3. **Handoff table (R1, P6-MIGRATION-01).** Spec: cols + state machine.
   Read `handoff-repository.ts` `createSchema`: `CREATE TABLE IF NOT EXISTS
   handoffs` with all 11 cols + 3 indexes; Prisma `Handoff` model
   `@@map("handoffs")`. Status literals validated by `rowToHandoff`.
   **OK.**
4. **Store (R1, NF1).** Spec: backend-polymorphic factory. Read
   `handoff-repository.ts`: `HandoffStore` interface, `MemoryHandoffStore`,
   `SqliteHandoffStore` (lazy-open, WAL + busy_timeout=3000),
   `getHandoffStore`/`resetHandoffStore`. No `isPostgresEnabled()`.
   **OK.**
5. **Service begin (R2, R5, R7, P6-BEGIN-01/DUALWRITE-01/DEGRADE-01).**
   Spec: validate project, optional LLM polish, insert open row, dual-write
   memory. Read `begin`: missing-project short-circuit; LLM polish only
   when `isEnabled()` AND summary empty; `dedupStrings` on inputs;
   `store.insert`; best-effort `dualWrite` (memoryId null on throw);
   `{ok:true, id, status:"open", memoryId}`. Never throws. **OK.**
6. **Service accept/cancel (R2, R6, P6-ACCEPT/CANCEL/FAIL-*).** Spec: state
   machine + clear failures. Read `terminate`: missing-id/not-found/
   project-mismatch/not-open guards; `setStatus` with `acceptedAt` on
   accept; post-update `status !== target` guard (defense in depth);
   `handoff:accepted` published only on accept. **OK.**
7. **listPending (R3, P6-AUTOINJECT-01).** Spec: only open, ordered
   oldest-first. Read `listPending`: `store.listPending` (project + status
   + targetAgent with broadcast-null inclusion); `[]` on throw. **OK.**
8. **Auto-injector (R3).** Spec: consume observation:ingested session-start.
   Read `handoff-auto-injector.ts`: subscribes, filters
   `source==="session-start"`, calls `listPending`, logs count, never
   throws. **OK.**
9. **MCP tools + route (R4, P6-TOOL-01).** Spec: 4 tools + route. Read
   `tool-definitions.ts`: 4 entries; `routes/handoff.ts`: 4 POST handlers,
   423 disabled, 400 missing; `index.ts` `.use(handoffRoutes)` + swagger
   tag. **OK.**
10. **Test isolation (NF4).** Spec: inject fakes, no shared-config mock.
    Read `handoff-service.test.ts`: injects `MemoryHandoffStore` + fake
    `HandoffMemorySeam` + fake `LlmSurface`; single P6-SEARCH-01 block
    resets the MemoryRepository singleton. No `mock.module`. **OK.**

No gaps surfaced beyond the accepted assumptions below.

## Accepted assumptions / residual risk

1. **PG HandoffStore runtime code deferred.** Prisma `Handoff` model
   provides schema parity; a `PgHandoffStore` is deferred (mirrors
   synapse_sessions / index_jobs / observations precedent — SQLite-
   canonical runtime state). SQLite-canonical is the documented default.
   Low risk: the store interface is portable.
2. **No age-based expiry (TTL).** Only explicit `cancel` transitions
   `open`→`expired`. A future scheduled job could expire stale `open`
   handoffs. Documented out-of-scope.
3. **Auto-injector records via logger; does not auto-surface into the
   agent context.** The deterministic surfacing primitive is
   `listPending` (recall path). The injector is observability + a future
   auto-surface hook seam. When the Phase-3 hook is not installed, the
   event never fires and `listPending` still works (graceful degrade).
4. **`targetAgent` derivation in the injector is best-effort.** The
   observation payload's `agentId` is used if present; otherwise
   `listPending(projectId)` returns all open handoffs (broadcast + named).
   The agent decides which to accept.
5. **Route-level 423 (P6-DEGRADE not a dedicated test).** Verified by code
   inspection (mirrors Phase-4 P4-DEGRADE-03 precedent). A live HTTP test
   would need a running tools-api + config flip; deferred.
6. **Same-author verification.** No independent verifier sub-agent was
   spawned. Mitigated by the per-AC evidence table, the discrimination
   sensor (mutant killed, 2 failing tests), and the objective gate
   (791/0).

## Conclusion

Phase 6 meets its acceptance criteria and success criteria. Verdict
**PASS**. Ready for Phase 5 (auto-improve) to consume the
`handoff:accepted` event + the Observation store (`listRecent`) +
Synapse sessions to detect patterns; the `HandoffService.listPending` +
dual-write memory give Phase 8 (web UI) a read surface.
