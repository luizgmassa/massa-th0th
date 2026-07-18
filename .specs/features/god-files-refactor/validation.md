# M14 God-Files Refactor — Independent Validation

> Verifier: independent (did NOT author any of the changes). Branch `m14-god-files`,
> base `wave-2`. Coverage re-derived from evidence (commands run, code read); author
> claims and commit messages not inherited.

## Verdict: **PASS**

All six requirements (REQ-GF-1..6) satisfied. Discrimination sensor killed all 3
mutations. Working tree left clean of test mutations.

---

## Part 1 — Per-AC Evidence

| REQ | Status | Evidence |
| --- | --- | --- |
| **REQ-GF-1** (query-pack decomposed; QP.ts = orchestrator + re-exports) | **PASS** | 5 focused modules extracted: `native-node-helpers.ts` (145), `symbol-signature.ts` (325), `query-pack-registry.ts` (73), `query-pack-captures.ts` (201), `query-pack-edges.ts` (512). `query-pack.ts` reduced from **1254 → 73 LOC** and contains ONLY the `executeQueryPack` / `executeStructuralQueryPack` orchestrator bodies + re-exports (`export type {…}`, `export { structuralQueryPackForDialect }`, `export { normalizeQueryCaptures }`). Verified at `packages/core/src/services/structural/query-pack.ts:1-74`. ≥4 modules satisfied (5). |
| **REQ-GF-2** (RLM decomposed into ≥3 modules behind unchanged facade) | **PASS** | 5 modules extracted: `rlm-indexing.ts` (537), `rlm-synapse.ts` (226), `rlm-search.ts` (501), `rlm-admin.ts` (125), `rlm-fusion.ts` (263). `contextual-search-rlm.ts` reduced from **1668 → 463 LOC** and the `ContextualSearchRLM` class is preserved with all original public method names (`indexProject`, `_indexProjectInternal`, `ensureFreshIndex`, `checkSearchAdmission`, `indexFile`, `search`, `applySynapseState`, `correctQuery`, `buildGraphStream`, `fuseResults`, `generateScoreExplanation`, `addContextToResults`, `extractPreview`, `calculateAvgScore`, `filterByPatterns`, `clearProjectIndex`, `getProjectStats`, `warmupCache`, `getAnalytics`, `ensureInitialized`) as thin delegates to `*Impl(rlm, …)` module functions. Verified at `packages/core/src/services/search/contextual-search-rlm.ts:91-463`. ≥3 modules satisfied (5). |
| **REQ-GF-3** (no module > ~600 LOC) | **PASS** | All 12 new/refactored modules measured (`wc -l`): `query-pack.ts` 73, `symbol-signature.ts` 325, `native-node-helpers.ts` 145, `query-pack-registry.ts` 73, `query-pack-captures.ts` 201, `query-pack-edges.ts` 512, `contextual-search-rlm.ts` 463, `rlm-indexing.ts` 537, `rlm-synapse.ts` 226, `rlm-search.ts` 501, `rlm-admin.ts` 125, `rlm-fusion.ts` 263. **Max = 537 (`rlm-indexing.ts`), under the 600 budget.** None flagged. |
| **REQ-GF-4** (public surface byte-identical) | **PASS** | (a) `git diff wave-2 -- packages/core/src/services/index.ts` → **EMPTY** (zero changes, verified). (b) All 6 QP public symbols re-exported from `services/index.ts`: `executeQueryPack`/`executeStructuralQueryPack`/`normalizeQueryCaptures`/`structuralQueryPackForDialect` at L170-173 (value block); `QueryCapabilityContract`/`StructuralQueryPack` at L176-177 (type block). `ContextualSearchRLM` re-exported at `services/index.ts:6`. (c) Public method signatures vs `wave-2`: `indexProject(projectPath, projectId, options=IndexProjectOptions)`, `ensureFreshIndex(projectId, projectPath, options=…)`, `indexFile(filePath, projectId, projectRoot, centralityMap?)`, `search(query, projectId, options=…)` — all unchanged. Signature comparison confirmed via `git show wave-2:…/contextual-search-rlm.ts` vs HEAD. (Note: instance-field visibility was relaxed from `private` to default-public so delegate modules can read via the `rlm` parameter — runtime-identical, type-surface only, documented in design.md; this is the accepted encapsulation decision and does NOT change any public method signature or the class's exported name.) |
| **REQ-GF-5** (`indexingLocks` static + mutex semantics survive) | **PASS** | (a) `private static indexingLocks = new Map<string, Promise<void>>()` at `contextual-search-rlm.ts:113` (was L76 on `wave-2`). (b) `runWithIndexLock` in `rlm-indexing.ts:89-115` preserves the exact `try { return await work() } finally { if (lockMap.get(projectId) === myLock) lockMap.delete(projectId); releaseLock() }` shape (L106-114) — `releaseLock()` runs unconditionally in `finally`, so the BUG-SYN-4 race cannot re-emerge. (c) `ContextualSearchRLM.indexProject` (L169-187) passes `() => this._indexProjectInternal(projectPath, projectId, options)` as `work` — virtual dispatch through `this` preserved, so test monkey-patches on `(inst as any)._indexProjectInternal` still route. |
| **REQ-GF-6** (zero behavior change) | **PASS** | From `packages/core`, all suites green:<br>• `structural-query-pack.test.ts` — **36/36 pass, 365 expect()**<br>• `concurrent-indexing.test.ts` + `indexing-readiness-guard.test.ts` — **10/10 pass, 30 expect()** (2 files)<br>• `contextual-search-rlm.characterization.test.ts` — **21/21 pass, 33 expect()**<br>• `search-ranking-regression.test.ts` — **2/2 pass**<br>• `search-synapse-integration.test.ts` — **5/5 pass**<br>• `search-admission-preflight.test.ts` — **5/5 pass**<br>• `synapse-stability.test.ts` — **9/9 pass**<br>Combined: **88/88 pass** across the targeted behavior-preservation suites. Pre-existing baseline failures (PG-integration / process-global-state / module-mock categories in the broader isolated suite) were not exercised here and are out of scope for this refactor. |

---

## Part 2 — Discrimination Sensor

Three behavior-level faults injected in scratch state, each reverted before the next.
All mutations targeted the highest-risk seams (mutex, RRF fusion, structural dedup).

| # | Mutation | Targeted seam | Tests run | Outcome |
| --- | --- | --- | --- | --- |
| **M1** | In `rlm-indexing.ts:runWithIndexLock`, commented out both `delete-if-still-owner` and `releaseLock()` in the `finally` block (simulates a lock leak). | Mutex try/finally | `concurrent-indexing.test.ts` | **KILLED — 8/9 fail**. Lock-map cleanup test failed at L185 (`expect(...indexingLocks.has("proj-d")).toBe(false)` got `true`); 4 successor tests timed out at 5000ms (queued callers hang forever waiting for a never-released lock); return-value-propagation test timed out. The one pass was the first caller's return-value check (runs before leak matters). Mutant eliminated. |
| **M2** | In `rlm-fusion.ts:fuseResultsImpl`, flipped the sort comparator from `b.rrfScore - a.rrfScore` (desc) to `a.rrfScore - b.rrfScore` (asc) — ranking inversion. | RRF fusion ordering | `contextual-search-rlm.characterization.test.ts`, `search-ranking-regression.test.ts` | **KILLED — 3/21 characterization tests fail** (RRF ordering anchors: e.g. `maxResults bounds the final slice` expected `V2` got `K1` at L296). Ranking-regression stayed green (only 2 tests, less discriminating). Mutant eliminated by the characterization pins added in Phase 2. |
| **M3** | In `query-pack-edges.ts:dedupeEdges`, replaced the filter-and-freeze body with `return Object.freeze([])` (simulates broken extraction). | Structural dedup/extraction | `structural-query-pack.test.ts` | **KILLED — 10/36 fail** (e.g. Elixir metadata test at L700 expected edges to contain `"call"`, got `[]`). Mutant eliminated. |

**No mutant survived.** All three high-risk seams are covered by discriminating
behavior-level tests; coverage gaps = none.

### Clean-tree confirmation

After all mutations reverted:

```
git status --short packages/core/   →  (empty)
git diff packages/core/src/services/search/rlm-indexing.ts
git diff packages/core/src/services/search/rlm-fusion.ts
git diff packages/core/src/services/structural/query-pack-edges.ts
                                      →  (all three: zero diff vs HEAD)
```

The only working-tree changes vs HEAD are the spec artifacts themselves
(`spec.md` modified, `design.md` + `tasks.md` untracked) — these are the spec
documents, NOT test mutations. No production code was left mutated. Post-revert
re-run of the 4 critical suites confirmed **67/67 pass, 428 expect()** — green
state restored.

---

## Part 3 — Diff Range

`git diff --stat wave-2..HEAD`: **13 files changed, 3629 insertions(+), 2529 deletions(-)**.
**9 commits** (`git rev-list --count wave-2..HEAD`).

Files:
- `packages/core/src/__tests__/contextual-search-rlm.characterization.test.ts` (+578, new)
- `packages/core/src/services/search/contextual-search-rlm.ts` (-1447 net)
- `packages/core/src/services/search/rlm-admin.ts` (+125, new)
- `packages/core/src/services/search/rlm-fusion.ts` (+263, new)
- `packages/core/src/services/search/rlm-indexing.ts` (+537, new)
- `packages/core/src/services/search/rlm-search.ts` (+501, new)
- `packages/core/src/services/search/rlm-synapse.ts` (+226, new)
- `packages/core/src/services/structural/native-node-helpers.ts` (+145, new)
- `packages/core/src/services/structural/query-pack-captures.ts` (+201, new)
- `packages/core/src/services/structural/query-pack-edges.ts` (+512, new)
- `packages/core/src/services/structural/query-pack-registry.ts` (+73, new)
- `packages/core/src/services/structural/query-pack.ts` (-1225 net)
- `packages/core/src/services/structural/symbol-signature.ts` (+325, new)

Net delta: +1099 LOC across the codebase (characterization tests +578 account for
~53% of the net growth; the refactor itself is roughly LOC-neutral with the test
additions). `services/index.ts` barrel **unchanged** (0/0).

---

## Part 4 — Ranked Gap List

**None.** All 6 ACs pass; all 3 discrimination mutations killed; public surface
byte-identical; mutex semantics intact; characterization tests pin behavior.

Minor non-blocking observations (not gaps, do not require fix tasks):
- `search-ranking-regression.test.ts` (2 tests) was insufficient on its own to
  catch the M2 RRF inversion — the M2 kill came from the characterization suite.
  This is a coverage observation, not a defect: the characterization suite
  added in Phase 2 covers the gap. No action needed.
- Instance-field visibility on `ContextualSearchRLM` was relaxed from `private`
  to default-public to enable the delegate split. This is the explicitly
  accepted encapsulation decision documented in design.md; runtime-identical,
  type-surface only. Not a defect.

---

## Verifier Independence Note

I did **not** author any of the M14 changes, the spec, design, or tasks. All
evidence above was re-derived by: (a) running `wc -l`, `git diff`, `git show
wave-2:…`, and `grep` directly; (b) reading the refactored modules in full
(query-pack.ts, contextual-search-rlm.ts, rlm-indexing.ts, rlm-fusion.ts); (c)
running every REQ-GF-6 test suite myself and counting pass/expect(); (d)
injecting and reverting three independent behavior mutations. No commit message
or author claim was trusted without independent confirmation.

## Residual Risk

**Low.** Behavior is pinned by 88 passing tests including a dedicated
characterization suite; the highest-risk seam (mutex try/finally +
virtual-dispatch `work` lambda) is verified by both code reading and a
mutation that the suite killed. The only residual surface is the
type-visibility relaxation on RLM instance fields, which is additive
(runtime-identical) and documented.
