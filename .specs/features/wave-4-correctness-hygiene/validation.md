# Wave 4 — Correctness, Hygiene, and Spec Reconciliation Validation

**Status: PASS**

**Verifier:** independent (author ≠ verifier). Re-derived coverage from evidence-or-zero; did not trust implementation-author claims.

**Baseline commit:** `f3d802098215c0dd9cbfcd8374605484f9a8a5b2` (`f3d8020`) on `main`
**Feature artifacts:** `.specs/features/wave-4-correctness-hygiene/` (spec.md, design.md, tasks.md, validation.md — untracked on purpose)

---

## Per-Requirement Evidence Table

| ID | Spec AC | Evidence (re-derived) | Verdict |
| --- | --- | --- | --- |
| **WAVE4-N1** | Generation staleness signal (ACs 1–7): surface `activatedGraphGenerationId` on 4 graph-reader tools; opt-in `ifNoneMatch` 412 on stale/no-active; `search_code` excluded. | `wave-4-generation-staleness.test.ts` (21 tests pass): `assertGenerationNotStale` 4 branches + precedence (no-active wins over stale); `getActiveGeneration` null/non-null; 4 tool handlers (impact/trace/refs/defs) surface `activatedGraphGenerationId` + 412 on stale + 412 on no-active + `null` when omitted. `search_code` exclusion (AC 7) asserted at `wave-4-correctness.test.ts:786-795` (result has no `activatedGraphGenerationId` own property). Transport parity `wave-4-transport.test.ts` (5 tests pass): 4 routes return 412 + "Stale generation"; `/search/code` does NOT 412. Source `active-generation.ts` (66 LOC) matches design contract. **Sensor: removed `if (!ifNoneMatch) return` guard → 5 tests fail.** | PASS |
| **WAVE4-N4** | Clamped lists emit `*_total`/`*_shown`/`*_omitted` (ACs 1–5). | `wave-4-correctness.test.ts`: impact 150 symbols → `impacted_total=150, impacted_shown=100, impacted_omitted=50, truncated=true` + under-cap=0 + empty=0; search_definitions 600 → `definitions_total=600, definitions_shown=20, definitions_omitted=580, definitions_total_exact=true` + sentinel 150k → `definitions_total=100000, total_exact=false`; get_references 100 → `total=100, shown=50, omitted=50`; search_code 50 → `results_total=50, results_shown=10, results_omitted=40`. trace_path N4 fields covered by type system + existing `trace-path.test.ts` invariant (noted in test header lines 466-470). | PASS |
| **WAVE4-N6** | Enum/finite-set params throw `ToolError` with valid-values list (AC 6). | `wave-4-enum-validation.test.ts` (29 tests in file): `ToolError` statusCode default 400 + 412 honored; `validateEnum` 7 cases (valid narrow, invalid throws with list, empty/undefined/null/non-string all throw, singleton); T5 section 11 tool-handler teaching-error cases across `impact_analysis.scope`, `trace_path.direction/mode`, `get_analytics.type`, `list_projects.status`, `search_definitions.kind` (18 kinds sampled), `create_checkpoint.status/checkpointType`, `compress_context.strategy`, `ExecutorController.execute/executeFile.language` (10 langs). Source `enum-validation.ts` (54 LOC) matches design. **Sensor: `validateEnum` returns `validValues[0]` instead of throwing → 17 tests fail.** | PASS |
| **WAVE4-N7** | Three-source diff + secrets denylist (ACs 7, 8, 9, 9a): `scope=unstaged/staged/all` merge untracked; `committed` single-source; secret-like untracked excluded + `untrackedFiltered` counted; Set dedup. | `wave-4-correctness.test.ts` (6 N7 tests pass): unstaged merges untracked normal + excludes `.env` + `untrackedFiltered=1`; staged merges + excludes `.key`; committed excludes both untracked; `all` merges 3-source deduped (Set size === length); secrets denylist covers all 12 patterns (`.env`, `.env.local`, `prod.env`, `.key`, `.pem`, `.p12`, `.pfx`, `secrets.json`, `secret.yaml`, `.keystore`, `id_rsa`, `.asc`); dedup edge (`git rm --cached` + re-created). Source `impact-analysis.ts:599-628` + `isSecretLike:503`. **Sensor: `includeUntracked=false` → 5 tests fail.** | PASS |
| **WAVE4-N8** | `base_branch`/`since` shell-arg guard before git (AC 10): reject `--` prefix or non-`[A-Za-z0-9._\/+-]` with teaching error. | `wave-4-enum-validation.test.ts` `validateGitRef` (10 tests pass): 6 valid refs pass (`main`, `feature/foo-bar`, `v1.0.0`, `abc123`, `origin/main`, `2026-07-01`); empty string passes (caller falls back to `main`); 7 invalid rejected with `ToolError` + "Valid pattern:" (`--upload-pack=evil`, `main;rm -rf /`, `$(whoami)`, `--exec=/tmp/evil`, `\n`, `main with space`, `` `whoami` ``). Source `git-ref-validation.ts`. | PASS |
| **WAVE4-N9** | `read_file` cap at `MASSA_AI_READ_FILE_MAX_LINES` (default 500) + `source_clipped` (ACs 11–16); internal enrichment excluded (AC 15). | `wave-4-correctness.test.ts` (4 N9 tests pass): 1000-line no-range → 500 lines + `source_clipped:true` + `total=1000`; 200-line → 200 + `source_clipped:false`; range-within-cap (201 lines) → full + `source_clipped:false`; range-exceeding-cap (2000 requested) → clamped to 500 + `source_clipped:true`. Source `read_file.ts:33-36` IIFE (invalid/negative → 500) + cap logic at `:224-232`. Internal enrichment exclusion documented in `symbol-graph.service.ts` (AC 15). **Sensor: cap default 500 → 999999 → 2 tests fail.** | PASS |
| **WAVE4-N10** | SQL bounds regression (ACs 1–4): Phase 1 LIMIT 200; ref_kind enum ≤9 parameterized; vocabulary chunked at 5000; zero `snprintf`/`sprintf`. | `wave-4-sql-bounds.test.ts` (4 tests pass): `searchTwoPhase` limit=20 → candidates=200 (clamped), limit=5 → 100 (below); `findEdges` 9 RefKind values all parameterized (`$N::text`, no string interpolation); `populateVocabulary` 5001 words → 2 batches (5000 + 1); `rg snprintf|sprintf packages/` → zero (rg exit 1). | PASS |
| **WAVE4-N25** | Phase-1/5/6 `validation.md` "PG parity deferred" reconciled (ACs 2–4). | `rg -n "PG parity deferred" .specs/features/phase-*/validation.md` → **0 matches** (exit 1). | PASS |
| **WAVE4-M29** | `sqlite-removal` → `complete`; `sqlite-removal-followup` split out (AC 1). | `python3 ... FEATURES.json` → `['sqlite-removal']` (status complete). `.specs/features/sqlite-removal-followup/spec.md` + `tasks.md` exist with 3 follow-ups (SQLRFU-001 legacy Prisma probe, SQLRFU-002 qwen fixture rebuild, SQLRFU-003 aggregate test capture). | PASS |
| **WAVE4-N33** | Dead code sweep (ACs 1–3): remove `normalizeRRFScore` singular; `metrics.ts` `console.error` → `logger.error`; two bare `catch {}` in `session-registry.ts` → `logger.warn`. Keep `relation-extractor.ts:44` "deprecated" literal. | `rg 'catch \{' packages/core/src/services/synapse/session/session-registry.ts` → **0** (exit 1). `rg 'console.error' packages/core/src/services/monitoring/metrics.ts` → **0** (exit 1). `normalizeRRFScore` singular removed (batch `normalizeRRFScores` remains). `relation-extractor.ts:44` "deprecated" unchanged (audit-confirmed functional keyword data). | PASS |
| **WAVE4-N34** | CI grammar gate (ACs 1–4): path-filtered `verify:tree-sitter-native` on structural/`bun.lock`/`package.json` touches; existing `structural-native-linux` unchanged. | `.github/workflows/ci.yml`: `dorny/paths-filter@v3` at `:64-72` filters on `packages/core/src/services/structural/**`, `bun.lock`, `package.json`; `Grammar integrity verifier` step at `:74-76` gated by `if: steps.filter.outputs.grammar == 'true'` runs `bun run verify:tree-sitter-native`. Existing `structural-native-linux` job `:207-241` unchanged (runs verify at `:241`). `grep -c "verify:tree-sitter-native"` → **2**; `grep -c "dorny"` → **1**. | PASS |
| **WAVE4-N36** | `xdg.ts` (zero project-module imports) extracted; both config files import from it (ACs 1–5). | `xdg.test.ts` (16 tests pass): `xdgConfigHome/DataHome/CacheHome/RuntimeDir/StateHome` env-override + default + empty/whitespace-as-unset; `configDir/dataDir/cacheDir` app-suffixed + default fallback. Source `xdg.ts` imports only Node builtins (`path`, `os`) — zero project-module imports (acyclic). `config-loader.ts` + `massa-ai-config.ts` import from `./xdg.js`. typecheck + build pass. | PASS |
| **WAVE4-M35** | `scheduler-store-pg.test.ts` passes against shared DB with `scheduled-*` rows (ACs 1–5): instance-scoped seam + `afterEach` restore + follow-up restore proof. | `scheduler-store-pg.test.ts` (6 tests pass) against shared DB (log: `PgScheduledJobStore hydrated {"rows":4}`). `installScheduledFilterSeam` (`:21-27`) wraps `store.listAll` per-instance (NOT class-prototype/global SQL); `restoreSeam` in `afterEach` (`:83-86`). Exact-listAll assertion at `:134` passes. Follow-up test at `:143-169` proves restoration: install seam → filters `scheduled-*`; restore → `listAll` returns identical unfiltered set. `describe.skipIf(!DB_AVAILABLE)` gate preserved (`:76`). `cleanup()` deletes only `TEST_PREFIX%` rows (never `scheduled-*`). | PASS |

**Coverage:** 13/13 requirements PASS, 0 FAIL, 0 GAP.

---

## Discrimination Sensor Results (4/4 mutations killed)

| # | Requirement | Mutation (temporary source edit) | Test file | Result | Reverted |
| --- | --- | --- | --- | --- | --- |
| 1 | WAVE4-N6 | `enum-validation.ts`: `validateEnum` returns `validValues[0]` instead of throwing `ToolError` on invalid input. | `wave-4-enum-validation.test.ts` | **17 fail** / 12 pass (baseline 29 pass) — KILLED | `git checkout -- packages/core/src/tools/enum-validation.ts` ✅ |
| 2 | WAVE4-N7 | `impact-analysis.ts`: `includeUntracked = false` (drops `git ls-files --others` merge for all scopes). | `wave-4-correctness.test.ts` | **5 fail** / 19 pass (baseline 24 pass) — KILLED (all untracked-merge + secrets-denylist tests) | `git checkout -- packages/core/src/services/symbol/impact-analysis.ts` ✅ |
| 3 | WAVE4-N9 | `read_file.ts`: cap default `500` → `999999` (effectively disables the cap). | `wave-4-correctness.test.ts` | **2 fail** / 22 pass (baseline 24 pass) — KILLED (1000-line cap + range-exceeding cap tests) | `git checkout -- packages/core/src/tools/read_file.ts` ✅ |
| 4 | WAVE4-N1 | `active-generation.ts`: removed `if (!ifNoneMatch) return` guard (always checks staleness even when `ifNoneMatch` omitted). | `wave-4-generation-staleness.test.ts` | **5 fail** / 16 pass (baseline 21 pass) — KILLED (omitted → no-throw + success-with-null tests) | `git checkout -- packages/core/src/services/symbol/active-generation.ts` ✅ |

**Sensor verdict: 4/4 killed.** Each mutation was reverted with `git checkout -- <file>` and the baseline re-confirmed green (78 pass / 0 fail on the 4 core wave-4 files). Working tree clean post-revert (only untracked `.specs/features/wave-4-correctness-hygiene/` remains, as intended).

---

## Gate Exit Results

| Gate | Command | Result |
| --- | --- | --- |
| Type-check (workspace) | `bun run type-check` (turbo) | **6/6 tasks successful** |
| Build (workspace) | `bun run build` (turbo) | **5/5 tasks successful** |
| Core wave-4 focused | `DATABASE_URL="" bun test packages/core/src/__tests__/wave-4-*.test.ts` (4 files) | **78 pass / 0 fail** (268 expect calls) |
| — `wave-4-enum-validation.test.ts` | (subset) | 29 pass (N6 + N8) |
| — `wave-4-correctness.test.ts` | (subset) | 24 pass (N7 + N9 + N4) |
| — `wave-4-generation-staleness.test.ts` | (subset) | 21 pass (N1) |
| — `wave-4-sql-bounds.test.ts` | (subset) | 4 pass (N10) |
| N1 transport parity | `bun test apps/tools-api/src/__tests__/wave-4-transport.test.ts` | **5 pass / 0 fail** (17 expect calls) |
| N36 xdg | `bun test packages/shared/src/config/__tests__/xdg.test.ts` | **16 pass / 0 fail** (18 expect calls) |
| M35 scheduler seam | `DATABASE_URL="" bun test packages/core/src/__tests__/scheduler-store-pg.test.ts` | **6 pass / 0 fail** (29 expect calls; shared DB hydrated 4 `scheduled-*` rows — seam filtered them) |

**Total Wave 4 focused tests: 105 pass / 0 fail.**

`DATABASE_URL=""` was used for core tests per task instruction (Bun auto-loads `.env` with a PG URL; the empty prefix forces SQLite-free mode where relevant). The scheduler-store-pg suite still connected to the shared DB (Bun's `.env` auto-load won the env precedence) — this is the intended M35 scenario (shared DB with real `scheduled-*` rows) and the seam passed.

---

## Artifact Checks

| Check | Command | Expected | Actual |
| --- | --- | --- | --- |
| N25 | `rg -n "PG parity deferred" .specs/features/phase-*/validation.md` | 0 matches | 0 (exit 1) ✅ |
| N33 (catch) | `rg -n 'catch \{' packages/core/src/services/synapse/session/session-registry.ts` | 0 matches | 0 (exit 1) ✅ |
| N33 (console) | `rg -n 'console.error' packages/core/src/services/monitoring/metrics.ts` | 0 matches | 0 (exit 1) ✅ |
| M29 | `python3 -c "... FEATURES.json ..."` | `['sqlite-removal']` | `['sqlite-removal']` ✅ |
| N34 (verify) | `grep -c "verify:tree-sitter-native" .github/workflows/ci.yml` | 2 | 2 ✅ |
| N34 (dorny) | `grep -c "dorny" .github/workflows/ci.yml` | 1 | 1 ✅ |

---

## Diff Range

`git log --oneline f3d8020..HEAD` → **23 commits**:

```
2f8501a fix(read-file-test): update listDefinitions stub to T9 return shape {...
f372554 fix(transport-test): stub SearchCodeTool to avoid embedding timeout i...
846cf69 fix(dead-code): replace remaining bare catch {} in session-registry w...
e59563e docs(state): add Wave 4 active section, flip sqlite-removal invariant...
8aaea1e docs(handoff): document Wave 4 breaking changes (N7/N6/N9)
eceb047 test(sql-bounds): regression test for bounded placeholder builders (N10)
f40c92b ci(grammar): path-filtered verify:tree-sitter-native on structural/bu...
7f6e1bf chore(specs): close sqlite-removal, split follow-ups into sqlite-remo...
452b172 docs(specs): reconcile Phase-1/5/6 PG parity claims with delivered mi...
1b8df0a chore(dead-code): remove deprecated normalizeRRFScore, route metrics/...
eec781b test(scheduler-store-pg): instance-scoped seam filters scheduled-* ro...
e155f63 test(transport): assert activatedGraphGenerationId + ifNoneMatch pari...
877ab1f feat(graph-tools): surface activatedGraphGenerationId + ifNoneMatch p...
0fc3eab perf(search-definitions): sentinel total for >100k match sets (N4 perf)
c5bee53 feat(search,references): emit total/shown/omitted on clamped lists (N4)
83afb19 feat(impact-analysis,trace-path): emit impacted_total/shown/omitted +...
89fd63d feat(read-file): cap at MASSA_AI_READ_FILE_MAX_LINES (default 500)...
dae53de feat(impact-analysis): merge untracked files + secrets denylist in de...
8b26c0b feat(tools): wire validateEnum into all tool handlers for teaching-er...
9444a67 refactor(config): extract xdg.ts to kill duplicated-XDP circular-dep ...
96216f8 feat(symbol): add getActiveGeneration + assertGenerationNotStale help...
7886272 feat(impact-analysis): add validateGitRef shell-arg guard (N8)
1fbc88a feat(tools): add ToolError + validateEnum helper for teaching-error p...
```

20 task commits (T1–T20) + 3 follow-up fix commits (test-stub shape alignment, transport SearchCodeTool stub, dead-code catch cleanup). No squash; one commit per task per the tasks.md plan.

---

## Residual Risk

**Pre-existing `qwen-e2e-fixture` failure — NOT Wave 4 task-owned.**

- Documented at `.specs/HANDOFF.md:43`: "Pre-existing failures NOT task-owned (unchanged): ... qwen-e2e-fixture ...".
- Root cause: frozen qwen fixture manifest hash-mismatched after `c9e361b` (identity-guard) legitimately changed `postgres-vector-store.ts` + 13 other files post-lock (`.specs/HANDOFF.md:23`).
- Ownership transferred to the `sqlite-removal-followup` feature as **SQLRFU-002** (`.specs/features/sqlite-removal-followup/spec.md:19`, `tasks.md:39`): "Rebuild the frozen qwen fixture manifest before rerunning its fixture-specific E2E."
- Wave 4 does NOT touch the qwen fixture or `postgres-vector-store.ts` source; the failure is unchanged by this feature's diff range.

No other residual risk identified. All 13 requirements pass their spec-anchored acceptance criteria, all 4 discrimination sensors killed, all gate exits green, all artifact checks pass.

---

## Spec-Anchored Outcome Check (independence note)

The verifier read each test file AND its corresponding source file to confirm tests assert the **spec-defined expected outcome**, not the implementation's output:

- **N6**: tests assert the spec error shape `"Invalid <param> value: <received>. Valid values: <list>."` (spec AC 6, line 132) — not just "throws".
- **N7**: tests assert the spec's 3-scope merge semantics + 9-pattern secrets denylist + `untrackedFiltered` count (spec ACs 7/8/9/9a) — not just "returns paths".
- **N9**: tests assert the spec's `source_clipped:true` + true total + 500 default (spec ACs 11–13) — not just "caps content".
- **N1**: tests assert the spec's 412 status + "Stale generation"/"No active generation" messages + `search_code` exclusion (spec ACs 1–7) — not just "checks generation".
- **N4**: tests assert the spec's `*_total`/`*_shown`/`*_omitted` arithmetic (spec ACs 1–5) — not just "fields exist".
- **M35**: tests assert the spec's instance-scoped seam + `afterEach` restore + follow-up restoration proof (spec ACs 2/5) — not just "passes".
- **N36**: tests assert the spec's zero-imports purity + env-override/default semantics (spec AC 1) — not just "xdg.ts exists".

No test was found to mirror the implementation without an independent spec anchor.

---

## Verifier Verdict

**PASS.** 13/13 requirements verified against spec ACs. 4/4 discrimination sensors killed. Type-check 6/6, build 5/5, focused tests 105 pass / 0 fail. All 6 artifact checks pass. Residual risk (qwen-e2e-fixture) is pre-existing, documented, and owned by `sqlite-removal-followup` — not Wave 4 task-owned. No gaps.
