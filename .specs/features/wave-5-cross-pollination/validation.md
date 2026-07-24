# Validation: Wave 5 — Cross-pollination (B3+B4, T17-T26)

- **Date:** 2026-07-22
- **Spec:** `.specs/features/wave-5-cross-pollination/spec.md`
- **Diff range:** `6740a3e..HEAD` (commits `2c21db6..43518e2`)
- **Verifier:** Independent sub-agent (read-only, evidence-or-zero, scratch-only mutations)
- **Scope:** B3+B4 = tasks T17-T26, ACs AC-10..AC-16

## Task completion table

| Task | Commit | Status | Evidence |
|---|---|---|---|
| T17 — read_file path containment | `2c21db6` | DONE | `read_file.ts:407-448` + `read-file-containment.test.ts` 7/7 |
| T18 — Filter revalidation + downgrade | `8c41df4` | DONE | `filter-validation.ts:67-151` + `filter-validation.test.ts` 16/16 |
| T19 — M-W5-02 scheduler migration | `1c5c624` | DONE | `20260722130000_add_scheduler_last_success/migration.sql` (additive, 4 cols) |
| T20 — Scheduler success/failure + catch-up | `e28b54d` | DONE | `scheduler.ts:299-328` catchUp + `:446-474` split; `scheduler-catchup.test.ts` 10/10 |
| T21 — TaskEnvelopeService.begin | `fd616bb` | DONE | `task-envelope.ts:104-228` + `synapse-task-envelope.test.ts` 4/4 begin |
| T22 — synapse_task_end | `577b36e` | DONE | `task-envelope.ts:236-262` + `synapse-task-envelope.test.ts` 3/3 end |
| T23 — ?jobId= filter on /api/v1/events | `e46fd63` | DONE | `events.ts:61` filter line; `events-job-filter.test.ts` 4/4 |
| T24 — IndexJobTracker publishes to eventBus | `56e5c10` | DONE | `index-job-tracker.ts:269-271,369-394`; `index-job-tracker-events.test.ts` 6/6 |
| T25 — Moonshot flavor transport wrapper | `1509732` | DONE | `moonshot-flavor.ts:54-90` + `index.ts:143-144`; `moonshot-flavor.test.ts` 19/19 |
| T26 — N45 confirmation log | `43518e2` | DONE | `.specs/HANDOFF.md:5` dated `2026-07-22` + `92b7fb4` |

## Spec-anchored AC table

| AC | Spec-defined outcome | file:line + assertion | Result |
|---|---|---|---|
| AC-10 (FR-12) | `read_file` on `/etc/passwd` (host path outside project/allowlist) → teaching error listing valid roots; same call inside project root succeeds | `read-file-containment.test.ts:102` `expect(res.success).toBe(false)` + `:106` `expect(res.error!).toMatch(/path containment/i)` + `:108` `expect(res.error!).toMatch(/Valid roots/i)`; `:138` `expect(res.success).toBe(true)` (inside project root) | PASS |
| AC-11 (FR-13) | Stopping API with job `next_run_at` in past + restart triggers exactly one catch-up tick per missed job; `last_success_at` updates only on success; `consecutive_failures` increments on failure | `scheduler-catchup.test.ts:94` `expect(result.caughtUp).toBe(1)` (one tick, not full backfill); `:254` `expect(updated.lastSuccessAt).toBe(now)` (success-only); `:287` `expect(updated.consecutiveFailures).toBe(2)` (increments on failure); `:256` `expect(updated.consecutiveFailures).toBe(0)` (resets on success) | PASS |
| AC-12 (FR-14, FR-15) | `synapse_task_begin` returns `{ sessionId, search, primed }` with populated search; `synapse_task_end` returns `{ sessionId, durationMs, accessCount, topFiles }` and deletes session (follow-up GET → 404/null) | `synapse-task-envelope.test.ts:55` `expect(result.sessionId.startsWith("syn_")).toBe(true)` + `:57` `expect(result.search).toBeTruthy()` + `:60` `expect(result.primed).toBe(1)`; `:143` `expect(endResult!.sessionId).toBe(beginResult.sessionId)` + `:144` `expect(endResult!.durationMs).toBeGreaterThanOrEqual(0)` + `:146` `expect(Array.isArray(endResult!.topFiles)).toBe(true)`; `:150` `expect(registry.get(beginResult.sessionId)).toBeNull()` (404 equivalent) | PASS |
| AC-13 (FR-16) | Subscribing to `/api/v1/events?jobId=<active>` receives `indexing:started|progress|completed` events for that job and none for other jobs | `events-job-filter.test.ts:124` `expect(jobIds.every((id) => id === target)).toBe(true)` + `:126` `expect(jobIds).not.toContain(other)`; `index-job-tracker-events.test.ts:224` `expect(failed.length).toBe(1)` (SSE receives tracker event for job) + `:257` `expect(failedForB.length).toBe(0)` (other job filtered) | PASS |
| AC-14 (FR-17) | Calling `tools/list?flavor=moonshot` on a fixture with root-level `anyOf` returns schema with combinator stripped; without flavor returns it unchanged | `moonshot-flavor.test.ts:148` `expect(plain.tools[0]!.inputSchema.anyOf).toBeDefined()` (unchanged without flavor); `:152` `expect(moon.tools[0]!.inputSchema.anyOf).toBeUndefined()` (stripped with flavor); `index.ts:143-144` `resolveFlavor` + `applyMoonshotFlavor` wired in ListTools handler | PASS |
| AC-15 (FR-18) | Search with 33+ patterns rejected with teaching error; invalid glob rejected with teaching error; same pattern in include+exclude returns results including the pattern + `filter_downgrades` entry | `filter-validation.test.ts:28` `expect(() => validateFilters(include, [])).toThrow(/exceed the maximum of 32/)` (33 patterns rejected); `:64` `expect(() => validateFilters(["", "**/*.ts"], [])).toThrow(/empty pattern is not a valid glob/)` (invalid glob); `:83` `expect(result.exclude).toEqual([])` + `:84` `expect(result.downgrades).toHaveLength(1)` + `:109` `expect(result.include).toContain("keep-me.ts")` (include survives, exclude dropped, downgrade emitted) | PASS |
| AC-16 (FR-19) | `.specs/HANDOFF.md` contains a dated entry confirming hook attribution verified complete at `92b7fb4` | `.specs/HANDOFF.md:5` `- 2026-07-22: N45 hook attribution verified complete at \`92b7fb4\`; registry entry stays \`complete\`. No code change.` | PASS |

## Discrimination sensor table

| Mutation | file:line | Description | Killed? |
|---|---|---|---|
| T23 — events.ts jobIdFilter bypass | `events.ts:61` | Removed `return` on the jobIdFilter line so non-matching jobs pass through | KILLED — `events-job-filter.test.ts` 3 fail (jobId match, AND compose, legacy skip) |
| T24 — index-job-tracker.ts inverted condition | `index-job-tracker.ts:269` | Changed `if (prevStatus === "pending")` to `if (prevStatus === "running")` so pipeline path double-publishes | KILLED — `index-job-tracker-events.test.ts` 2 fail (early-exit pending→failed no longer publishes; main pipeline path double-publishes) |
| T25 — moonshot-flavor.ts ROOT_COMBINATORS bypass | `moonshot-flavor.ts:59` | Made `ROOT_COMBINATORS.includes(...)` check always false (`if (false && ...)`) so nothing is stripped | KILLED — `moonshot-flavor.test.ts` 6 fail (allOf/anyOf/oneOf strip + result-level + AC-14) |

All mutations reverted. Tree clean after each isolation run.

## Code quality table

| File | Surgical? | Matches patterns? | Scope creep? |
|---|---|---|---|
| `packages/core/src/tools/read_file.ts` | Yes — containment check added at `:206-212`, helper `:407-448`; no unrelated changes | Yes — teaching-error shape matches Wave 4 N6; `sanitizeFilePath` import from shared per spec | No |
| `packages/core/src/services/search/filter-validation.ts` (NEW) | Yes — pure module, 151 lines, no I/O | Yes — `ToolError` matches Wave 4 N6 pattern; `minimatch.makeRe` try/catch per FR-18 | No |
| `packages/core/src/services/scheduler/scheduler.ts` | Yes — `catchUpMissedJobs` `:299-328` + success/failure split in `fireJob` finally `:446-474` | Yes — same `running` set + `fireJob` pattern; additive columns | No |
| `packages/core/src/services/scheduler/scheduler-types.ts` | Yes — 4 optional fields added to `ScheduledJob` interface | Yes — additive nullable per AD-W5-007 | No |
| `packages/core/src/services/scheduler/scheduler-store-pg.ts` | Yes — 4 columns in `ScheduledJobRow`, `rowToJob`, and SQL INSERT/UPDATE | Yes — same fire-and-forget + mirror pattern | No |
| `packages/core/src/services/synapse/task-envelope.ts` (NEW) | Yes — 263 lines, orchestrates existing primitives | Yes — delegates to `getSessionRegistry` + `SearchController`; no re-implementation | No |
| `apps/tools-api/src/routes/events.ts` | Yes — 1 line added for jobIdFilter parse + 1 filter line `:61` | Yes — extends existing `?projectId=` filter pattern; AND composition | No |
| `packages/core/src/services/jobs/index-job-tracker.ts` | Yes — `publishStateChange` method `:369-394` + conditional call `:269-271` | Yes — state-CHANGE-only pattern; best-effort try/catch | No |
| `apps/mcp-client/src/moonshot-flavor.ts` (NEW) | Yes — 106 lines, pure schema strip | Yes — transport-only, shallow clone, no mutation of original | No |
| `apps/mcp-client/src/index.ts` | Yes — 2 lines in ListTools handler `:143-144` | Yes — additive in existing handler | No |
| `apps/tools-api/src/routes/synapse.ts` | Yes — `/task/begin` `:327` + `/task/:id/end` `:367` | Yes — same Elysia route pattern | No |
| `packages/shared/src/config/index.ts` | Yes — `MASSA_AI_READ_FILE_ROOTS` `:754` + `MAX_FILTER_PATTERNS` `:763` | Yes — same `envString`/`envNum` pattern | No |
| `apps/mcp-client/src/tool-definitions.ts` | Yes — `synapse_task_begin` + `synapse_task_end` defs added | Yes — matches existing synapse tool def shape | No |
| Migration `20260722130000` | Yes — 4 additive columns, `IF NOT EXISTS` | Yes — matches AD-W5-007 additive-nullable pattern | No |

## Gate check results

| Gate | Result |
|---|---|
| `rtk bun run type-check` | **6/6 PASS** (3 cached, 6 total) |
| `rtk bun run build` | **5/5 PASS** (3 cached, 5 total) |
| T17: `read-file-containment.test.ts` | **7 pass, 0 fail** (28 expect) |
| T18: `filter-validation.test.ts` | **16 pass, 0 fail** (39 expect) |
| T19/T20: `scheduler-catchup.test.ts` | **10 pass, 0 fail** (23 expect) |
| T21/T22: `synapse-task-envelope.test.ts` | **7 pass, 0 fail** (31 expect) |
| T23: `events-job-filter.test.ts` | **4 pass, 0 fail** (10 expect) |
| T24: `index-job-tracker-events.test.ts` | **6 pass, 0 fail** (10 expect) |
| T25: `moonshot-flavor.test.ts` | **19 pass, 0 fail** (30 expect) |
| T26: static grep on HANDOFF.md | **PASS** — `2026-07-22` + `92b7fb4` at `:5` |
| **Total focused tests** | **69 pass, 0 fail, 0 skipped** |

## Edge cases

- T17: relative-path `../` traversal is sanitized via `sanitizeFilePath` before resolution — test `:154-174` proves traversal is contained (ENOENT under project root, not host-secret read).
- T17: env allowlist `MASSA_AI_READ_FILE_ROOTS` read at call time (not config-load) — test `:176-199` sets env mid-test and succeeds.
- T17: N9 500-line cap not regressed — test `:201-230` asserts `source_clipped: true` on 600-line file.
- T18: empty-string pattern rejected as invalid glob (`:62-65`) — catches minimatch v9 literal-fallback gap.
- T18: boundary case 32 patterns passes (`:31-38`); 33 rejected — exact spec boundary.
- T20: catch-up is no-op when scheduler disabled (`:209-225`).
- T20: `last_error` truncated to 2000 chars with `...` suffix (`:294-319`).
- T21: partial-failure contract (AD-W5-019) — search failure sets `partial=true`, `errors=["search"]`, `search=null`, session survives (`:67-84`).
- T22: `end()` on non-existent session returns `null` (`:153-159`).
- T24: tracker does NOT publish on progress ticks (`:83-99`) — state-CHANGE only.
- T25: non-mutation of original schema verified (`:80-85`).
- T25: `_meta.flavor` takes precedence over param `flavor` (`:179-182`).

## UAT

UAT: not applicable — backend/harness work.

## Summary verdict

**PASS**

- 7/7 ACs in scope (AC-10..AC-16) matched spec-defined outcomes with deterministic file:line + assertion evidence.
- Gate: type-check 6/6, build 5/5, 69 focused tests passed, 0 failed.
- Discrimination sensor: 3 mutations injected, 3 killed, 0 survived.
- All mutations reverted; worktree clean.
- Code quality: surgical changes, pattern-matched, no scope creep, no new external deps (AC-20 respected).