# Native Runtime Re-baseline Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/native-runtime-rebaseline/design.md`
**Status**: Draft (revised after Plan Challenge pre-mortem)

---

## Project Testing Guidelines Scan

Scanned: `package.json` (turbo scripts: `test`, `type-check`, `build`, `verify:tree-sitter-*`), `turbo.json` (passThroughEnv for DB env vars), `packages/core/package.json` (`test: bun scripts/run-tests-isolated.ts`, `build: tsc + cp generated`), `scripts/tests/` (Bun test runner, `describeNative` skip helper for native tests).

Guidelines found:
- `bun run test` (turbo) is the full suite; `bun run type-check` (6/6); `bun run build --force` (5/5).
- `verify:tree-sitter-source-dist` = `bun scripts/verify-tree-sitter-grammars.ts`; `verify:tree-sitter-package` = `bun scripts/verify-tree-sitter-package-artifact.ts`; `verify:tree-sitter-native` = both chained.
- Native-structural unit tests: `cd packages/core && bun scripts/run-tests-isolated.ts --unit --filter='structural|parse-long-class'` (152/152).
- Verifier tests: `bun test scripts/tests/verify-tree-sitter-grammars.test.ts` (9/9); `native-macos-arm64-workflow.test.ts` (3/3); `native-linux-x64-workflow.test.ts` (6/6).
- DB-gated acceptance tests use dedicated DB env vars (turbo passThroughEnv forwards them).
- `AGENTS.md` (repo-level) absent; global `~/.config/opencode/AGENTS.md` applies (one atomic commit per task, no push unless asked).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `package.json` turbo scripts, `turbo.json` passThroughEnv, `packages/core/package.json` test runner.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Merge main into wave-3 (README conflict) | build gate | 1:1 to spec ACs NVR-001..006; merge auto-merges verifier + ci.yml + polyglot; README conflict resolved combining Linux + Bun 1.3.14 | `README.md`, `scripts/verify-tree-sitter-grammars.ts`, `.github/workflows/ci.yml` | `bun run type-check && bun run build --force`; `bun test scripts/tests/verify-tree-sitter-grammars.test.ts` |
| Missing-workflow test (`native-macos-arm64-workflow.test.ts`) | unit | 1:1 to spec ACs NVR-007..010; asserts `ci.yml:137` `structural-native`; baseline non-touch sensor retained; linux-x64 test-name string updated | `scripts/tests/native-macos-arm64-workflow.test.ts`, `scripts/tests/native-linux-x64-workflow.test.ts` | `bun test scripts/tests/native-macos-arm64-workflow.test.ts` |
| Six-suite classification | integration (existing tests, run-only classification) | 1:1 to spec ACs NVR-011..016; per-group solo 3× + suite run; root cause recorded; prior-memory cross-check | `packages/core/src/__tests__/{auto-improve-job,etl-cache-invalidation,etl-pipeline-queue,qwen-e2e-fixture,scheduler-store-pg,trace-path}.test.ts` | `bun test <file>` solo 3×; `bun run test` suite |
| Cross-platform end-to-end | integration | NVR-025..027; `verify:tree-sitter-native` exit 0 on macOS arm64 + Ubuntu Codespace under 1.3.14; ABI 137 confirmed on Codespace | both platforms | macOS: `bun run verify:tree-sitter-native`; Codespace: `gh codespace ssh -c <name> -- '...'` |
| npm reconciliation | unit + build gate | NVR-028; `EXPECTED_NPM_VERSION` matches both platforms; test literals updated | `scripts/verify-tree-sitter-package-artifact.ts:29`, `scripts/tests/verify-tree-sitter-package-artifact.test.ts:24`, `scripts/tests/polyglot-indexing-docs.test.ts:101` | `bun test scripts/tests/verify-tree-sitter-package-artifact.test.ts` |
| AD amendment | artifact check | NVR-029..030; STATE.md Decisions table records wave-3 absorption + cross-platform evidence | `.specs/project/STATE.md` | manual inspection |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick (verifier tests) | After T1, T2 | `bun test scripts/tests/verify-tree-sitter-grammars.test.ts` |
| Quick (workflow test) | After T2 | `bun test scripts/tests/native-macos-arm64-workflow.test.ts` |
| Quick (native-target predicate) | After T1 | `bun test packages/core/src/__tests__/native-target-predicate.test.ts` |
| Quick (native-structural unit) | After T1, T5 | `cd packages/core && bun scripts/run-tests-isolated.ts --unit --filter='structural\|parse-long-class'` |
| Full (suite group solo 3×) | During T3 (classification) | `bun test <suite-file>` ×3 per group |
| Full (suite) | After T3 | `bun run test` (turbo) |
| Build | After T1, T2 | `bun run type-check && bun run build --force` |
| End-to-end (macOS native) | After T1, T5 | `bun run verify:tree-sitter-native` (under machine default 1.3.14, no shim) |
| End-to-end (Codespace native) | After T5 | `gh codespace ssh -c wave3-debian-gate-wv567j4g9j35x76 -- 'cd <repo> && bun run verify:tree-sitter-native'` |
| Pin grep (no stale 1.3.11) | After T1 | `grep -rn '1\.3\.11' package.json packages/core/src/services/structural/language-manifest.ts scripts/verify-tree-sitter-grammars.ts scripts/tests/ .github/workflows/ci.yml README.md` (expect: none in pin sites after merge; historical `.specs/` OK) |
| npm version confirm | During T4 | `gh codespace ssh -c wave3-debian-gate-wv567j4g9j35x76 -- '. "$NVM_DIR/nvm.sh" && nvm use 25.9.0 && npm --version'` |

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Absorb main (merge + lock-contract fix + Bun bump)

T1

### Phase 2: Test Repair

T2

### Phase 3: Six-Suite Classification

T3

### Phase 4: Codespace + npm + Cross-Platform Verification

T4 → T5

### Phase 5: AD Amendment + Closure

T6

---

## Task Breakdown

### T1: Merge main into wave-3 + resolve README conflict

**What**: Merge `origin/main` (`e12c4e4`) into `wave-3` to absorb the Bun 1.3.14 bump + lock-contract `record.includes` fix. Resolve the README.md conflict (combine wave-3's "macOS arm64 and Linux glibc x64" with main's "Bun `1.3.14`"). Confirm the merge brings `EXPECTED_BUN_VERSION = "1.3.14"`, `STRUCTURAL_BUN_VERSION = "1.3.14"`, `packageManager = "bun@1.3.14"`, ci.yml Bun 1.3.14, `record.includes(expected.gitIdentity)`. Run the gate matrix to confirm the merge is clean.
**Where**: `README.md` (conflict), `scripts/verify-tree-sitter-grammars.ts` (auto-merged), `.github/workflows/ci.yml` (auto-merged), `package.json` (auto-merged), `packages/core/src/services/structural/language-manifest.ts` (auto-merged), `scripts/tests/polyglot-indexing-docs.test.ts` (auto-merged)
**Depends on**: None
**Reuses**: Main's already-shipped lock-contract fix + Bun 1.3.14 bump
**Requirement**: NVR-001, NVR-002, NVR-003, NVR-004, NVR-005, NVR-017, NVR-018, NVR-019, NVR-020, NVR-021, NVR-022, NVR-023, NVR-024

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `git merge origin/main` completed; merge commit on wave-3
- [ ] README.md conflict resolved: "macOS arm64 and Linux glibc x64. Application runtime is **Bun `1.3.14`**" (both true); CI table row resolved similarly
- [ ] `scripts/verify-tree-sitter-grammars.ts:412-414` uses `record.includes(expected.gitIdentity)` (from main)
- [ ] `EXPECTED_BUN_VERSION === "1.3.14"` (verifier line 26)
- [ ] `STRUCTURAL_BUN_VERSION === "1.3.14"` (manifest line 20)
- [ ] `packageManager === "bun@1.3.14"` (package.json line 60)
- [ ] ci.yml `structural-native` pins Bun `1.3.14`; `structural-native-linux` pins Bun `1.3.14` (wave-3's Linux job preserved)
- [ ] `bun test scripts/tests/verify-tree-sitter-grammars.test.ts` passes 9/9 (1.3.14 assertions + `record.includes` discrimination sensors)
- [ ] `bun run verify:tree-sitter-source-dist` exits 0 under machine default Bun 1.3.14 (no PATH shim) — lock-contract now passes
- [ ] `bun run type-check` 6/6; `bun run build --force` 5/5
- [ ] `cd packages/core && bun scripts/run-tests-isolated.ts --unit --filter='structural|parse-long-class'` passes 152/152 (native-structural under 1.3.14)
- [ ] `grep -rn '1\.3\.11' package.json packages/core/src/services/structural/language-manifest.ts scripts/verify-tree-sitter-grammars.ts scripts/tests/verify-tree-sitter-grammars.test.ts .github/workflows/ci.yml README.md` returns NO matches in pin sites (historical `.specs/` OK)
- [ ] No test weakened, skipped, or deleted

**Tests**: unit (co-located in `scripts/tests/verify-tree-sitter-grammars.test.ts`)
**Gate**: quick + build + end-to-end (`bun test scripts/tests/verify-tree-sitter-grammars.test.ts && bun run type-check && bun run build --force && bun run verify:tree-sitter-source-dist`)

**Commit**: `merge(parser): absorb main bun 1.3.14 bump and lock-contract record.includes fix`

---

### T2: Rewrite native-macos-arm64-workflow test + fix linux-x64 test-name string

**What**: Rewrite `native-macos-arm64-workflow.test.ts` sub-tests 1-2 to read `.github/workflows/ci.yml` and assert the `structural-native` job block (lines 137-176) instead of a deleted `native-macos-arm64.yml`; keep sub-test 3 (baseline non-touch) unchanged. Fix the stale test-name string in `native-linux-x64-workflow.test.ts:22` ("Bun 1.3.11" → "Bun 1.3.14"; assertion is already dynamic via `EXPECTED_BUN_VERSION`).
**Where**: `scripts/tests/native-macos-arm64-workflow.test.ts`, `scripts/tests/native-linux-x64-workflow.test.ts:22`
**Depends on**: T1 (merge must land first so `EXPECTED_BUN_VERSION` is 1.3.14 and ci.yml is the merged state)
**Reuses**: Existing `EXPECTED_BUN_VERSION`, `EXPECTED_NODE_BUILD_VERSION`, `EXPECTED_NPM_VERSION` imports; baseline non-touch sensor (sub-test 3)
**Requirement**: NVR-007, NVR-008, NVR-009, NVR-010

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `WORKFLOW_PATH` = `.github/workflows/ci.yml` (not deleted `native-macos-arm64.yml`)
- [ ] `readWorkflow()` returns `ci.yml` content
- [ ] Sub-test 1 asserts the `structural-native` job block pins `runs-on: macos-14`, `bun-version: ${EXPECTED_BUN_VERSION}` (= 1.3.14), `node-version: '22'`, `bun install --frozen-lockfile`, `bun run build`, native-structural unit tests; does not target `ubuntu` / `macos-13` / `macos-12` / `windows`
- [ ] Sub-test 2 asserts the `structural-native` job runs frozen install + build + native-structural unit tests (the actual job does NOT run `verify:tree-sitter-native` — confirm against `ci.yml:174-176` and assert exactly what's there)
- [ ] Sub-test 3 (baseline non-touch) unchanged and passes
- [ ] `native-linux-x64-workflow.test.ts:22` test-name string updated from "Bun 1.3.11" to "Bun 1.3.14" (assertion already dynamic)
- [ ] `bun test scripts/tests/native-macos-arm64-workflow.test.ts` passes 3/3
- [ ] `bun test scripts/tests/native-linux-x64-workflow.test.ts` passes 6/6
- [ ] No test weakened, skipped, or deleted

**Tests**: unit (co-located)
**Gate**: quick (`bun test scripts/tests/native-macos-arm64-workflow.test.ts && bun test scripts/tests/native-linux-x64-workflow.test.ts`)

**Commit**: `test(parser): assert ci.yml structural-native job in macos workflow test`

---

### T3: Classify six-suite failure groups with evidence (solo 3×, cross-check prior memory)

**What**: Run each of the six failing suite groups solo 3× (to detect flakiness), inspect the failures, cross-check prior memory for known bugs, classify each as FIX (real bug), DOCUMENTED-ACCEPT (test-isolation gap), or FLAKY-TIMEOUT (fix the timeout or document non-determinism). Fix the real bugs. Document the accepted gaps with root cause in a classification ledger (appended to `validation.md` in T6).
**Where**: `packages/core/src/__tests__/auto-improve-job.test.ts`, `etl-cache-invalidation.test.ts`, `etl-pipeline-queue.test.ts`, `qwen-e2e-fixture.test.ts`, `scheduler-store-pg.test.ts`, `trace-path.test.ts`
**Depends on**: T1 (run on the merged state so the baseline is current)
**Reuses**: Existing test files; `_bun-mock-guard.ts` documentation for process-global mock contamination; prior memories `dec_1783712242283` (trace-path callerFqn bug), `dec_1783808565314` (scheduler resume bug)
**Requirement**: NVR-011, NVR-012, NVR-013, NVR-014, NVR-015, NVR-016

**Tools**:
- MCP: NONE
- Skill: `massa-ai` (for the classification ledger discipline + `recall` for prior bugs)

**Done when**:
- [ ] Each group run solo 3×: `bun test <file>` ×3 — record pass/fail count + failure messages per run
- [ ] Each group run in-suite context if solo passes (to confirm isolation gap): inspect the colliding test if process-global
- [ ] Prior memory cross-check: `recall` for trace-path callerFqn bug, scheduler resume bug; confirm whether wave-3 (post-merge) includes their fixes
- [ ] Classification ledger (appended to this task's commit message + `validation.md` in T6) records per-group: 3× solo results, suite result, failure mode, root cause, verdict (FIX / DOCUMENTED-ACCEPT / FLAKY-TIMEOUT), fix commit if FIX
- [ ] `auto-improve-job` classified as FLAKY-TIMEOUT (2 flaky 5s timeouts, fails solo) — NOT isolation gap; either fix the timeout or document non-determinism (never weaken)
- [ ] Real bugs fixed in-task (one sub-commit per fix within this task's scope); groups pass solo 3× after fix
- [ ] Test-isolation gaps documented with the specific root cause (e.g., "process-global `mock.module` collision with memory-crud.test.ts per `_bun-mock-guard.ts:5-6`", "shared-DB fixture race on `graph_generation_workspace_missing`", "DB env `DATABASE_URL` not set so `DB_AVAILABLE=false` skips PG tests")
- [ ] No test weakened, skipped, or deleted to make a group pass
- [ ] `bun run test` (turbo) after classification: fixed groups pass; accepted/flaky groups may still fail in-suite (documented)

**Tests**: integration (run-only classification; fixes include co-located test updates only if a real bug is found)
**Gate**: full (`bun run test`)

**Commit**: `test(core): classify and fix pre-existing suite failure groups` (or multiple commits if fixes are substantial — one atomic commit per real-bug fix)

---

### T4: Reconcile npm version (Codespace + test literals)

**What**: SSH to the Codespace, confirm npm version under Node 25.9.0 (verified: `11.12.1`). Decide whether to install npm 11.14.1 on the Codespace (to match the contract literal) OR amend `EXPECTED_NPM_VERSION` to the actual. Update `EXPECTED_NPM_VERSION` in `scripts/verify-tree-sitter-package-artifact.ts:29` AND the test literal `scripts/tests/verify-tree-sitter-package-artifact.test.ts:24` AND `scripts/tests/polyglot-indexing-docs.test.ts:101` to match the reconciled value.
**Where**: `scripts/verify-tree-sitter-package-artifact.ts:29`, `scripts/tests/verify-tree-sitter-package-artifact.test.ts:24`, `scripts/tests/polyglot-indexing-docs.test.ts:101`
**Depends on**: T1 (merged state); can run in parallel with T2/T3
**Reuses**: Existing `EXPECTED_NPM_VERSION` pin
**Requirement**: NVR-028

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `gh codespace ssh -c wave3-debian-gate-wv567j4g9j35x76 -- 'export NVM_DIR="/usr/local/share/nvm"; . "$NVM_DIR/nvm.sh"; nvm use 25.9.0 && npm --version'` returns a version string (confirmed: `11.12.1`)
- [ ] Decision recorded: install npm 11.14.1 on Codespace (safest, matches contract) OR amend `EXPECTED_NPM_VERSION` to `11.12.1` (if 11.14.1 install is impractical)
- [ ] If install: `gh codespace ssh -c <name> -- 'npm i -g npm@11.14.1'` under Node 25.9.0; confirm `npm --version` returns `11.14.1`
- [ ] `EXPECTED_NPM_VERSION` updated to the reconciled value in `scripts/verify-tree-sitter-package-artifact.ts:29`
- [ ] `scripts/tests/verify-tree-sitter-package-artifact.test.ts:24` literal updated to match
- [ ] `scripts/tests/polyglot-indexing-docs.test.ts:101` literal updated to match
- [ ] `bun test scripts/tests/verify-tree-sitter-package-artifact.test.ts` passes (npm version assertion matches)
- [ ] `bun test scripts/tests/polyglot-indexing-docs.test.ts` passes (npm literal matches)

**Tests**: unit (co-located in `verify-tree-sitter-package-artifact.test.ts` + `polyglot-indexing-docs.test.ts`)
**Gate**: quick (`bun test scripts/tests/verify-tree-sitter-package-artifact.test.ts && bun test scripts/tests/polyglot-indexing-docs.test.ts`)

**Commit**: `build(parser): reconcile expected npm version across contract and tests`

---

### T5: Cross-platform end-to-end native verification under Bun 1.3.14 (Codespace install + both platforms)

**What**: Install Bun 1.3.14 on the Codespace (currently ABSENT — `bun: command not found`), confirm ABI 137 on the Codespace, sync the worktree to wave-3 HEAD, run the full `verify:tree-sitter-native` script end-to-end on macOS arm64 (machine default Bun 1.3.14, no shim) AND on the Ubuntu Codespace. Confirm exit 0 on both. Run native-structural unit tests on both.
**Where**: macOS arm64 (local worktree); Ubuntu Codespace (`wave3-debian-gate-wv567j4g9j35x76`)
**Depends on**: T1, T2, T4 (all pins + test fixes + npm reconciliation done)
**Reuses**: Existing `verify:tree-sitter-native` script, Codespace access via `gh codespace ssh`
**Requirement**: NVR-005, NVR-006, NVR-025, NVR-026, NVR-027

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] macOS arm64: `bun --version` returns `1.3.14` (no PATH shim)
- [ ] macOS arm64: `bun run verify:tree-sitter-native` exits 0 (source/dist 33+33 parses, 27+27 modules, 10 sensors, RSS < 16 MiB, packed package)
- [ ] macOS arm64: `cd packages/core && bun scripts/run-tests-isolated.ts --unit --filter='structural|parse-long-class'` passes 152/152
- [ ] Codespace: install Bun 1.3.14 — `curl -fsSL https://bun.sh/install | bash -s bun-v1.3.14` OR `npm i -g bun@1.3.14` under Node 25.9.0
- [ ] Codespace: `bun --version` returns `1.3.14`
- [ ] Codespace: `bun -e 'console.log(process.versions.modules)'` returns `137` (ABI gate — do NOT assume the install delivers the same binary; plan-critic finding #1)
- [ ] Codespace: sync worktree to `wave-3` HEAD (`git fetch origin wave-3 && git checkout wave-3 && git reset --hard origin/wave-3` — or push a temp sync branch if wave-3 not yet pushed; the prompt says no push unless asked, so use `gh codespace ssh` to pull the local worktree state via a temp branch if needed, OR rsync)
- [ ] Codespace: `bun run verify:tree-sitter-native` exits 0 (ELF x86-64 system-only linkage, all gates)
- [ ] Codespace: native-structural unit tests pass 152/152
- [ ] Evidence recorded for T6 `validation.md`

**Tests**: integration (end-to-end native verifier)
**Gate**: end-to-end (`bun run verify:tree-sitter-native` on both platforms)

**Commit**: `test(parser): verify native contract under bun 1.3.14 on macos and linux` (evidence-only; may be a docs commit if no code change)

---

### T6: Record AD-004/005/006 amendment + write validation.md + update feature registry

**What**: Append the AD-004/005/006 re-baseline amendment rows to `.specs/project/STATE.md` Decisions table with evidence (wave-3 absorbed main's Bun 1.3.14 bump via merge; Node 25.9.0 unchanged; ABI 137 unchanged; patch SHA unchanged; end-to-end verifier PASS on macOS + Codespace under 1.3.14). Write `.specs/features/native-runtime-rebaseline/validation.md` with per-AC evidence, six-suite classification ledger (3× solo + verdict + root cause), discrimination sensor results, and residual risk. Update `.specs/HANDOFF.md` and `.specs/project/FEATURES.json` feature status.
**Where**: `.specs/project/STATE.md`, `.specs/features/native-runtime-rebaseline/validation.md`, `.specs/HANDOFF.md`, `.specs/project/FEATURES.json`
**Depends on**: T1-T5 all complete
**Reuses**: Existing STATE.md Decisions table structure; M21 `validation.md` format
**Requirement**: NVR-029, NVR-030

**Tools**:
- MCP: NONE
- Skill: `massa-ai` (evidence-gate + validation)

**Done when**:
- [ ] STATE.md Decisions table has AD-004/005/006 amendment rows citing: wave-3 absorbed main's Bun `1.3.14` bump via merge (`e12c4e4`); Node `25.9.0` unchanged; ABI `137` unchanged; patch SHA `e79aec7b...` unchanged; evidence = `verify:tree-sitter-native` PASS on macOS arm64 + Codespace under 1.3.14
- [ ] `validation.md` written with: per-AC verdict table (NVR-001..030), six-suite classification ledger (per-group 3× solo/suite/verdict/root-cause), discrimination sensor results (corrupt-SRI, corrupt-gitIdentity via `record.includes`, corrupt-patch, baseline non-touch all killed), diff range, residual risk
- [ ] `.specs/HANDOFF.md` updated with the follow-up status (feature COMPLETE, no push)
- [ ] `.specs/project/FEATURES.json` feature `native-runtime-rebaseline` status = `complete` (added to features array)
- [ ] Independent verifier (author ≠ verifier) runs the full gate matrix + discrimination sensors and confirms PASS

**Tests**: artifact check (validation.md + STATE.md inspection)
**Gate**: build (final validation gate; `massa-ai` evidence-gate)

**Commit**: `docs(specs): validate native runtime rebaseline and record ad amendment`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1:  T1
Phase 2:  T2
Phase 3:  T3
Phase 4:  T4 ──→ T5
Phase 5:  T6
```

Execution is strictly sequential — there is no intra-phase parallelism. A single agent works one task at a time, in order. T4 can run in parallel with T2/T3 in principle (npm reconciliation is independent of the test rewrite + classification), but the plan keeps it sequential for commit-history clarity.

**How phase-based execution works:**

This feature has 6 tasks — fits a single batch (≤ ~8 tasks), so execution happens inline in the main window with no sub-agents spawned. The user is not offered batch sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Merge main + resolve README conflict | 1 merge + 1 conflict resolution (README) | ✅ Granular |
| T2: Rewrite native-macos test + fix linux-x64 string | 2 test files (rewrite + string fix) | ✅ Granular |
| T3: Classify six-suite failure groups | 6 files (run-only 3× + per-fix commits) | ⚠️ OK if cohesive — classification is one deliverable; fixes are sub-commits within the task scope |
| T4: Reconcile npm version | 3 files (pin + 2 test literals) | ✅ Granular |
| T5: Cross-platform end-to-end verification | 2 platforms (install + run-only + evidence) | ✅ Granular |
| T6: AD amendment + validation.md | 4 spec files (docs) | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | No incoming arrow | ✅ Match |
| T2 | T1 | Arrow T1 → T2 (Phase 1 → Phase 2) | ✅ Match |
| T3 | T1 | Arrow T1 → T3 (Phase 1 → Phase 3) | ✅ Match |
| T4 | T1 | Arrow T1 → T4 (Phase 1 → Phase 4) | ✅ Match |
| T5 | T1, T2, T4 | Arrows Phase 2 → Phase 4, Phase 4 internal T4 → T5 | ✅ Match (T2 dependency: T5 runs verifier which needs the test fixes; T1 transitive) |
| T6 | T1-T5 | Arrow Phase 4 → Phase 5 (T6 after T5) | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | Merge (verifier auto-merged; README conflict) | unit (verifier) + build | unit + build + end-to-end | ✅ OK |
| T2 | Missing-workflow test + linux-x64 test string | unit | unit (co-located) | ✅ OK |
| T3 | Six-suite classification (run-only; fixes if real bugs) | integration | integration (run-only 3×; fixes include co-located test updates) | ✅ OK |
| T4 | npm pin + 2 test literals | unit | unit (co-located) | ✅ OK |
| T5 | None (run-only verification) | integration | integration (end-to-end) | ✅ OK |
| T6 | Spec docs (no code layer) | artifact check | artifact check | ✅ OK |

---

## Plan Challenge Gate Result

Ran The Fool in pre-mortem mode (full gate; frozen contract + >5 files + cross-platform). 5 narratives, 3 HIGH severity. Key findings incorporated:
1. Main already has the lock-contract fix (`record.includes`) + Bun 1.3.14 bump — T1 now merges main instead of re-implementing (strictly stronger).
2. Codespace Bun is ABSENT (not 1.3.11) — T5 now installs Bun 1.3.14 from scratch + confirms ABI 137.
3. npm is 11.12.1 on Codespace (not 11.14.1) — T4 reconciles (install 11.14.1 or amend).
4. Pin site count is 10+ (not 8) — T1 (merge) absorbs most; T2/T4 handle the remaining test literals.
5. 6-suite classification must run solo 3× + distinguish flaky-timeout from isolation-gap — T3 updated.

Plan revised: 8 tasks → 6 tasks (merge absorbs the lock-contract fix + Bun bump). Inversion check passed: the guaranteed-failure condition (merge conflict with main) is now the primary task (T1).

---

## Artifact-Store Evidence

- Active artifact key: `.specs/features/native-runtime-rebaseline/tasks.md`
- Version: 2 (revised after Plan Challenge)
- Checksum: git-tracked (recorded by commit)