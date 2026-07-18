# God-Files Refactor — Tasks (M14)

> Phased, one module per atomic commit. Every task's gate MUST pass before the commit. Re-confirm line ranges at each task (design.md numbers are a map, not a contract).

## Phase 1 — query-pack pure-function extraction (lowest risk)

### T1.1 — `native-node-helpers.ts`
- Create `packages/core/src/services/structural/native-node-helpers.ts`.
- Move (verbatim): `text`, `frozenSpan`, `field`, `descendants`, `symbolName`, `ancestor`, `unquote`. Carry only the imports each needs (`NativeQueryNode`, `SourceIndex`, buffer type).
- In `query-pack.ts`: `import { text, frozenSpan, field, descendants, symbolName, ancestor, unquote } from "./native-node-helpers.js"`; delete the moved bodies.
- **Gate:** `bun test src/__tests__/structural-query-pack.test.ts` green + `turbo run type-check`.
- **Commit:** `refactor(structural): extract native-node-helpers from query-pack`.

### T1.2 — `symbol-signature.ts`
- Create `symbol-signature.ts`. Move (verbatim): `SymbolDraft` iface, `symbolKind`, `leadingDocumentation`, `declarationExportWrapper`, `normalizedTypeToken`, `signatureOwner`, `structuralSignature`, `signatureMaterial`, `buildSymbols`.
- Import `text`/`field`/`descendants`/`symbolName`/`ancestor` from native-node-helpers as needed.
- `query-pack.ts`: import from `./symbol-signature.js`; delete bodies.
- **Gate:** structural-query-pack test + type-check.
- **Commit:** `refactor(structural): extract symbol-signature from query-pack`.

### T1.3 — `query-pack-registry.ts`
- Create `query-pack-registry.ts`. Move (verbatim): `StructuralQueryPack` iface, `QueryCapabilityContract` type, `QUERY_PACKS`, `SYMBOL_KINDS`, `ALL_REQUIRED_CAPABILITIES`, `enabled`, `queryPackFor`, `structuralQueryPackForDialect`.
- `query-pack.ts`: import + **re-export** the 4 public symbols (`StructuralQueryPack`, `QueryCapabilityContract`, `structuralQueryPackForDialect`, and keep `normalizeQueryCaptures`/`executeQueryPack`/`executeStructuralQueryPack` re-exported from their own modules). Delete bodies.
- **Gate:** structural-query-pack test + type-check.
- **Commit:** `refactor(structural): extract query-pack-registry from query-pack`.

### T1.4 — `query-pack-captures.ts`
- Create `query-pack-captures.ts`. Move (verbatim): `normalizeQueryCaptures` + `frozenBindings`, `importBindings`, `RustUseLeaf`, `rustPathSegments`, `rustUseLeaves`, `buildImports`, `unresolved`, `targetParts`, `callKind`, `buildCallEdges`, `buildSyntaxEdges`, `dedupeEdges`, `functionalCaptures`, `EMBEDDED_EXTENSIONS`, `collectEmbeddedChildren`, + sets `LISTEN_TERMINALS`/`HTTP_CLIENTS`/`HTTP_METHODS`.
- Import from native-node-helpers + symbol-signature + registry as needed.
- `query-pack.ts`: import + re-export `normalizeQueryCaptures`. Delete bodies.
- `query-pack.ts` now = `executeQueryPack` + `executeStructuralQueryPack` + re-exports.
- **Check LOC of captures.ts.** If >620, apply safety valve: split `buildImports`/`buildCallEdges`/`buildSyntaxEdges`/`dedupeEdges`/`callKind`/`targetParts`/`unresolved` + their sets into `query-pack-edges.ts`.
- **Gate:** structural-query-pack test + type-check + **full DB-free unit regression** `bun scripts/run-tests-isolated.ts --unit` + **barrel check**: `grep -nE "query-pack|StructuralQueryPack|QueryCapabilityContract|normalizeQueryCaptures" packages/core/src/services/index.ts` unchanged.
- **Commit:** `refactor(structural): extract query-pack-captures from query-pack`.

**Phase 1 exit:** no module >~620 LOC; barrel byte-identical; unit regression green.

---

## Phase 2 — RLM characterization tests (before touching the class)

### T2.1 — `contextual-search-rlm.characterization.test.ts`
- New file `packages/core/src/__tests__/contextual-search-rlm.characterization.test.ts`.
- Two seams (see design.md "Reachability model"): injected-deps for `search()`/mutex; `(inst as any).method()` cast for private pure helpers (precedented — `concurrent-indexing.test.ts` already casts).
- Pin:
  1. **RRF fusion** — `(inst as any).fuseResults.call(inst, kw, vec)`; `RRF_K=60`; hand-computed expectation, rank-1 either source wins, ties deterministic.
  2. **search() end-to-end** — injected `keywordSearch`/`vectorStore` stubs returning fixed ranked arrays; assert final order = hand-computed RRF. *(primary discrimination anchor)*
  3. `calculateAvgScore([])` boundary + non-empty mean.
  4. `extractPreview(content)` clamping + default maxLines=5.
  5. `filterByPatterns` include/exclude.
  6. **Mutex:** same-projectId serializes (2nd after 1st releases); different-projectId concurrent; lock cleared after completion; **lock released even if `_indexProjectInternal` throws** (pins `runWithIndexLock` try/finally — Challenge #2). Reset via `(ContextualSearchRLM as any).indexingLocks = new Map()`.
- **Gate:** new file green + existing RLM tests unchanged + type-check. **Discrimination spot-check:** flip one expected ranking + one mutex assertion + break the throw-path → each test fails → revert.
- **Commit:** `test(search): add ContextualSearchRLM characterization for RRF/mutex/search internals`.

---

## Phase 3 — RLM facade split (highest risk, delegates only)

> Before T3.1: confirm no consumer breaks from `private`→`public` field relaxation (only static read externally — verified). Apply field relaxation incrementally per module as the delegate needs it.

### T3.1 — `rlm-indexing.ts`
- Create `packages/core/src/services/search/rlm-indexing.ts`.
- Extract `runWithIndexLock(lockMap, projectId, work)` — **verbatim** lift of L188-208 INCLUDING the `try { await work() } finally { delete-if-still-owner; releaseLock() }` (Challenge #2). `work` is `() => this._indexProjectInternal(...)` so virtual dispatch + test monkey-patch still route (Challenge #1).
- Move bodies (verbatim) of: `indexProject`, `_indexProjectInternalImpl`, `ensureFreshIndex`, `indexFile`, `loadGitignore`, `checkSearchAdmission`, `ensureInitializedImpl` — functions taking the RLM instance + args.
- **Delegate-preservation contract (Challenge #1/#3):** `_indexProjectInternal` + `ensureInitialized` MUST stay instance methods as thin delegates (`async _indexProjectInternal(...a){ return _indexProjectInternalImpl(this, ...a); }`) because `concurrent-indexing.test.ts:67,181-289` monkey-patches them on the instance.
- Class `indexProject` → `return runWithIndexLock(ContextualSearchRLM.indexingLocks, projectId, () => this._indexProjectInternal(...))`. Relax moved-relevant fields private→public only as needed.
- **Gate (run immediately after converting `indexProject`+`_indexProjectInternal`, before touching other methods):** `concurrent-indexing.test.ts` + `indexing-readiness-guard.test.ts` green — this is the smallest diff that can regress the mutex. Then `search-admission-preflight.test.ts` + characterization + type-check at end.
- **Commit:** `refactor(search): extract rlm-indexing (mutex preserved) behind ContextualSearchRLM facade`.

### T3.2 — `rlm-synapse.ts`
- Create `rlm-synapse.ts`. Move (verbatim): `applySynapseState`, `correctQuery`, `buildGraphStream`. Delegates in class.
- **Gate:** `search-synapse-integration.test.ts` + characterization + type-check.
- **Commit:** `refactor(search): extract rlm-synapse behind ContextualSearchRLM facade`.

### T3.3 — `rlm-search.ts` + `rlm-admin.ts` (pre-planned split — Challenge #5)
- Create `rlm-search.ts`. Move (verbatim): `search` (~391 LOC), `fuseResults`, `generateScoreExplanation`, `addContextToResults`, `extractPreview`, `calculateAvgScore`, `filterByPatterns`. Delegates in class.
- Search-core alone ≈ 700 LOC → **planned split**: also create `rlm-admin.ts` for `clearProjectIndex`, `getProjectStats`, `warmupCache`, `getAnalytics` (~150 LOC). Delegates in class.
- (If `rlm-search.ts` lands under ~580 LOC with admin folded in, skip the admin file — but plan for the split.)
- Class file now ~300 LOC (fields + static mutex + constructor + delegates).
- **Gate:** `search-ranking-regression` + `search-synapse-integration` + characterization + full DB-free unit regression + type-check + **barrel check** `services/index.ts:6` unchanged + **LOC check** every new module ≤ ~620.
- **Commit:** `refactor(search): extract rlm-search (+rlm-admin) behind ContextualSearchRLM facade`.

**Phase 3 exit:** class <~330 LOC; every module <~620; barrel byte-identical; full unit regression green; characterization green.

---

## Final gate (before Validate)
- `wc -l` on all new modules — assert each ≤ ~620 LOC.
- `git diff main -- packages/core/src/services/index.ts` — barrel byte-identical (empty diff).
- `bun scripts/run-tests-isolated.ts --unit` green.
- `turbo run type-check` green.

## Independent Validate
- Fresh verifier (author ≠ verifier) writes `validation.md`: per-AC (REQ-GF-1..6) evidence + discrimination sensor (inject behavior faults, confirm tests kill) + diff range + PASS/FAIL.
