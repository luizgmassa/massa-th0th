# Phase 5 — Auto-improvement loop (G7): Validation

Slug: `phase-5-auto-improve`. **Same-author verification** (sole agent for this
phase — a prior sibling invocation landed tasks 1–4; this invocation finished
task 5: tests + the `approve` targetMemoryId fix + validation + ledger). Run as
a strict standalone fresh-eyes re-derivation + discrimination sensor. The
same-author caveat applies: there is no independent second agent. Mitigations:
every AC is anchored to file:line evidence below, the discrimination sensor
killed its mutant (1 failing test), and the gate is the objective
`bun run test` + `bun run type-check`.

## Verdict: PASS

The auto-improvement deliverable (`ProposalStore` SQLite-canonical +
`AutoImproveJob` rule-based pattern detection + LLM-optional enrichment +
review-gate/auto-approve + apply/reject state machine + `memory:auto-improved`
event + 3 MCP tools + API route + core barrel re-exports) meets its acceptance
criteria. Gate = `bun run --filter @massa-th0th/core test` **822 pass / 0 fail /
46 skip** (baseline 791 → +31), `bun run type-check` clean (5/5). The
discrimination sensor killed its mutant. The state machine
(pending → approved | rejected, both terminal) is proven; every failure mode
(missing / non-pending / project-mismatch / apply-failed) returns a clear
`{ok:false, reason}`; the default auto-approve path applies + flips + emits;
the LLM-off degradation path still produces proposals.

## Scope reviewed

- Commits: `a4c86ff` (specs), `d42086a` (config + event + proposals table +
  Prisma), `d3242cb` (AutoImproveJob), `ba971b0` (3 MCP tools + route +
  barrel), `67e9ed6` (tests + `approve` targetMemoryId fix + validation).
- Spec artifacts: `spec.md`, `design.md`, `tasks.md`, `validation.md`
  (this file).
- Test diff: +2 test files (`proposal-repository.test.ts` 9 tests +
  `auto-improve-job.test.ts` 22 tests) = +31 tests; **no tests weakened,
  skipped, deleted, or `.skip`/`todo`/`xit`/`only` added**. The Phase-6
  baseline (791) is preserved verbatim.
- Code fix in `67e9ed6`: `AutoImproveJob.approve` previously mutated a local
  `row.targetMemoryId` that was then shadowed by the store's `getById` result,
  so the `memory:auto-improved` event emitted `targetMemoryId=undefined` for
  `memory.create` proposals even though the memory had been applied. The fix
  captures the freshly-assigned id from `applyProposal` and surfaces it onto
  the returned record + event payload. Caught by P5-APPROVE-01 (the event
  `targetMemoryId` assertion).

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P5-DETECT-01 | runOnce over a deterministic pattern (hot file ×4) produces ≥1 pending proposal | `auto-improve-job.test.ts` P5-DETECT-01 (reviewGate=true): `res.improved===true`, `proposalsCreated>=1`, `proposalsApplied===0`, `listPending` returns the file proposal, `rationale` contains `src/auth.ts` + `4 times`, `kind==="memory.create"`, `status==="pending"`, `decidedAt===null`. | YES |
| P5-DETECT-02 | no recurring pattern → 0 proposals, no throw | P5-DETECT-02: 4 distinct observations → `improved===false`, `proposalsCreated===0`, `listPending` empty. Edge: <2 observations → noop. | YES |
| P5-LIST-01 | listPending returns pending for project, excluding approved/rejected | `proposal-repository.test.ts` listPending test: 2 pending + 1 approved + 1 other-project → returns 2 pending newest-first. `auto-improve-job.test.ts` P5-LIST-01: all returned rows `status==="pending"` + `projectId==="proj-ai"`. | YES |
| P5-APPROVE-01 | approve applies the edit, flips status, sets decidedAt, emits memory:auto-improved | `auto-improve-job.ts` `approve`; P5-APPROVE-01: `res.ok`, `status==="approved"`, `decidedAt!==null`, `mem.inserted.length>=1`, event `proposalId===target.id`, `kind===target.kind`, `status==="approved"`, `targetMemoryId===applied.id` (the fix). | YES |
| P5-AUTOAPPROVE-01 | reviewGate=false (default) auto-applies + flips + emits + logs | P5-AUTOAPPROVE-01: `proposalsApplied>=1`, `mem.inserted.length>=1`, ≥1 row `status==="approved"` with `decidedAt!==null`, event fired with shape, `source==="rule-based"`. `logger.info("proposal:auto-approved")` observed in run log. | YES |
| P5-REJECT-01 | reject flips to rejected, sets decidedAt, does NOT apply, does NOT emit | P5-REJECT-01: `res.ok`, `status==="rejected"`, `decidedAt!==null`, `mem.inserted.length` unchanged, `events.length===0`. | YES |
| P5-DEGRADE-01 | LLM off → rule-based proposals still produced, no throw | P5-DEGRADE-01 (disabledSurface): `improved===true`, `proposalsCreated>=1`, `source==="rule-based"`, `listPending>=1`. | YES |
| P5-DEGRADE-02 | LLM on + {ok:false}/throw → rule-based candidates verbatim | P5-DEGRADE-02 (failingSurface): `proposalsCreated===baselineCount`, `source==="rule-based"`. (throwingSurface): `improved`, `source==="rule-based"`. (enabledEnrichSurface): `source==="llm"`, enriched content + rationale applied. | YES |
| P5-FAIL-01 | approve missing → not-found; non-pending → not-pending; project-mismatch → project-mismatch; empty → missing-id | P5-FAIL-01 (missing-id): `not-found`, 0 events. (already-approved): second approve `not-pending`. (project-mismatch): `project-mismatch`. (empty id): `missing-id`. apply-failed: `mem.failNext` → `apply-failed`, status stays pending. | YES |
| P5-EVENT-01 | memory:auto-improved in EventMap with R6 shape | `event-bus.ts` EventMap entry; P5-EVENT-01 asserts `proposalId:string`, `projectId:"proj-ai"`, `kind∈{create,update,tag}`, `status:"approved"`, `appliedAt:number`, `source∈{llm,rule-based}`. | YES |
| P5-TOOL-01 | 3 tools in TOOL_DEFINITIONS + route registered | `tool-definitions.ts` list_proposals/approve/reject; `routes/proposals.ts` `proposalRoutes`; `index.ts` `.use(proposalRoutes)` + swagger tag. P5-TOOL-01 asserts all 3 names + `apiEndpoint` + `proposalRoutes` defined. Type-check confirms. | YES |
| P5-MIGRATION-01 | SQLite CREATE TABLE IF NOT EXISTS proposals + indexes; Prisma Proposal; idempotent reopen | `proposal-repository.ts` `createSchema` + 2 indexes; `schema.prisma` `model Proposal @@map("proposals")`; idempotent-reopen test: store2 on same dbPath reads prior row. | YES |
| P5-CONFIG-01 | memory.autoImprove.* keys + defaults; mergeConfig shallow-merges | `config/index.ts` `memory.autoImprove` block (interface + defaultConfig + mergeConfig); defensive `readAutoImproveConfig` fallback for process-wide mock omission. | YES |

## Edge cases

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| <2 observations → noop | P5-DETECT-02 edge: single observation → `improved===false`. | YES |
| malformed payloadJson skipped, never thrown | detectPatterns "is total" test: `{not json` + hot-file set → no throw, file candidate still emitted. | YES |
| setStatus on non-pending row is a no-op (WHERE guard) | `proposal-repository.test.ts`: approve then reject → row stays approved, `decidedAt` unchanged. | YES |
| setStatus on missing id → null | repo test: `setStatus("does-not-exist")` → null. | YES |
| apply-failed leaves status pending | P5-FAIL-01 (apply-failed): `mem.failNext` → `apply-failed`, row still pending. | YES |
| approve called twice (second on approved) | P5-FAIL-01 (already-approved): second → `not-pending`. | YES |
| LLM enrichment with valid schema enriches content + rationale | P5-DEGRADE-02 (enrich ok): `source==="llm"`, payload.content === "ENRICHED content for auth", rationale === "ENRICHED rationale". | YES |
| createSchema idempotent (reopen same path) | repo idempotent-reopen test. | YES |
| WAL journal mode | repo WAL test: `journalMode()` returns non-empty string. | YES |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| Full suite (core) | `bun run --filter @massa-th0th/core test` | **822 pass / 0 fail / 46 skip** (baseline 791 → +31). Ran 868 tests across 67 files. |
| type-check | `bun run type-check` | **clean** (5/5 tasks). |
| pattern generation | `auto-improve-job.test.ts` P5-DETECT-01 | ≥1 pending proposal from hot-file pattern. |
| listPending | `auto-improve-job.test.ts` P5-LIST-01 + repo test | pending-only, project-scoped, newest-first. |
| approve happy path | P5-APPROVE-01 | apply + flip + decidedAt + event with targetMemoryId. |
| auto-approve (default) | P5-AUTOAPPROVE-01 | apply + flip + event + log line. |
| reject | P5-REJECT-01 | flip, no apply, no event. |
| LLM-off degrade | P5-DEGRADE-01 | rule-based proposals produced. |
| LLM-on-but-fail degrade | P5-DEGRADE-02 | rule-based candidates verbatim (count matches baseline). |
| failure modes | P5-FAIL-01 (missing/non-pending/project-mismatch/empty/apply-failed) | all `{ok:false, reason}`. |
| migration idempotency | repo idempotent-reopen test | second store on same path reads prior row. |

## Discrimination sensor

Mutant = temporary source edit; only the relevant test file was run; source
reverted immediately. Tree verified clean.

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| pending-guard removal | `proposal-repository.ts` `setStatus` SQL `WHERE id = ? AND status = 'pending'` → `WHERE id = ?` (defense-in-depth SQL guard removed) | `proposal-repository.test.ts` | **KILLED** — 1 test fails: "setStatus on non-pending row is a no-op (WHERE status='pending' guard)". Without the SQL guard, the second `setStatus(id,"rejected")` overwrites the approved row, so the assertions `status==="approved"` + `decidedAt===1000` fail. Mutant killed. |

Mutant killed. No surviving mutant.

## Fresh-eyes re-derivation (standalone)

1. **Config (R9, P5-CONFIG-01).** Spec: `memory.autoImprove` nested block.
   Read `config/index.ts`: `autoImprove` in `ServerConfig.Memory` +
   `defaultConfig.memory.autoImprove` (`enabled`/`reviewGate`/`minObservations`/
   `minIntervalMs`/`maxWindow`/`minQueryHits`/`minFileHits`/`minFixHits`,
   envBool/envNum) + `mergeConfig` shallow-merges `memory.autoImprove`. **OK.**
2. **EventBus event (R6, P5-EVENT-01).** Spec: `memory:auto-improved` typed.
   Read `event-bus.ts`: EventMap entry `{ proposalId, projectId?, kind,
   targetMemoryId?, status:"approved", appliedAt, source:"llm"|"rule-based" }`.
   Published only in `approve` after a successful apply + flip. **OK.**
3. **Proposals table (R1, P5-MIGRATION-01).** Spec: cols + state machine.
   Read `proposal-repository.ts` `createSchema`: `CREATE TABLE IF NOT EXISTS
   proposals` with 9 cols + 2 indexes; Prisma `Proposal` model
   `@@map("proposals")`. Status/kind literals validated by `rowToProposal`.
   **OK.**
4. **Store (R1, NF backend-polymorphic).** Spec: factory, no isPostgresEnabled.
   Read `proposal-repository.ts`: `ProposalStore` interface,
   `MemoryProposalStore`, `SqliteProposalStore` (lazy-open, WAL +
   busy_timeout=3000), `getProposalStore`/`resetProposalStore`. Factory probes
   + falls back to Memory on throw. No `isPostgresEnabled()`. **OK.**
5. **Pattern detection (R3, P5-DETECT-01/02).** Spec: pure, rule-based, total.
   Read `detectPatterns`: counts query/file/fix signals from `payloadJson`,
   dispatches on `source`, emits `memory.create` candidates with rationale +
   signalKey. Bad payload JSON → `continue` (never throws). Thresholds
   respected. Exported for unit test. **OK.**
6. **LLM enrichment (R7, P5-DEGRADE-02).** Spec: optional, silent-degrade.
   Read `enrichWithLlm`: returns `{candidates, used:false}` when
   `!isEnabled()` / `{ok:false}` / throw / empty; refines content + rationale
   by signalKey when `{ok:true}`. Rule-based candidates run first and
   unconditionally. **OK.**
7. **Job runOnce (R4, P5-AUTOAPPROVE-01).** Spec: detect → enrich → insert
   pending → reviewGate? auto-approve. Read `runOnce`: listRecent → noop if
   <2; detect; enrich (try/catch); dedup by signalKey; insert pending; when
   `!reviewGate()` calls `this.approve` per proposal (single code path), logs
   `proposal:auto-approved`. Never throws (noop on any failure). **OK.**
8. **approve/reject (R5, P5-APPROVE-01/REJECT-01/FAIL-01).** Spec: state
   machine + clear failures. Read `approve`: missing-id/not-found/
   project-mismatch/not-pending guards; apply (apply-failed on throw);
   `setStatus` with `decidedAt`; post-update `status !== "approved"` guard;
   surfaces `appliedMemoryId` onto returned record + event (the fix);
   `memory:auto-improved` published only on success. `reject`: same guards,
   flip to rejected, no apply, no event. **OK.**
9. **MCP tools + route (R7, P5-TOOL-01).** Spec: 3 tools + route. Read
   `tool-definitions.ts`: list_proposals/approve/reject with correct
   apiEndpoints; `routes/proposals.ts` `proposalRoutes`; `index.ts`
   `.use(proposalRoutes)` after `.use(handoffRoutes)` + swagger tag `proposals`.
   **OK.**
10. **Test isolation (NF).** Spec: inject fakes, no shared-config mock. Read
    `auto-improve-job.test.ts`: injects `MemoryProposalStore` +
    `MemoryObservationStore` + fake `MemoryApplySeam` + fake `LlmSurface` +
    deterministic `idFactory`. No `mock.module`. No real MemoryRepository
    touched (the closed-singleton landmine is avoided). **OK.**

No gaps surfaced beyond the accepted assumptions below.

## Accepted assumptions / residual risk

1. **PG ProposalStore runtime code delivered.** Prisma `Proposal` model
   provides schema parity via migration
   `20260713090000_add_handoffs_proposals_pg`; runtime `PgProposalStore`
   is delivered (`packages/core/src/data/proposal/proposal-repository-pg.ts`).
   SQLite runtime removed (M29 closed; `sqlite-removal` complete;
   `sqlite-removal-followup` in_progress for non-gating fixture/e2e probes).
   The store interface remains portable.
2. **No OS-level scheduler.** Trigger-driven debounce
   (`maybeRun` from the observation-ingest path) mirrors Phase-3; sufficient
   for the v1 loop. A real cron/tick is out-of-scope.
3. **Synapse-session-content mining is a seam only.** v1 detection keys on
   observation payloads (the stable structured signal). The `sessionStore`
   ctor param is reserved; the v1 job does not parse session buffer JSON.
4. **No proposal TTL / automatic expiry of stale pending rows.** A future
   job could expire stale pending proposals. Documented out-of-scope.
5. **Route-level 423 not a dedicated test.** Verified by code inspection
   (mirrors Phase-4/6 P*-DEGRADE 423 precedent). A live HTTP test would need
   a running tools-api + config flip; deferred.
6. **Same-author verification.** No independent verifier sub-agent was
   spawned. Mitigated by the per-AC evidence table, the discrimination
   sensor (mutant killed, 1 failing test), and the objective gate (822/0).
7. **Pattern detection false-positive risk is bounded, not zero.** Thresholds
   default 3/3/2; window capped at 16; dedup by signalKey within a run;
   auto-approved proposals are themselves memories subject to Phase-1 decay
   (self-correcting). Reviewers can flip `memory.autoImprove.reviewGate=true`.

## Conclusion

Phase 5 meets its acceptance criteria and success criteria. Verdict **PASS**.
Ready for Phase 7 (polish): salience-judge + rerank may consume
auto-improved memories (they are normal memory rows with embeddings=[] for
create, so they enter FTS but not the vector stream unless re-embedded);
compression is unaffected. Phase 8 (web UI) can consume
`AutoImproveJob.listPending` + the `/api/v1/proposal/list` route for a
proposal-review view.
