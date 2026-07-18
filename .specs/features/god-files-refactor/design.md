# God-Files Refactor — Design (M14)

> Behavior-preserving decomposition. All seams re-confirmed against current source. Two god-files split behind byte-identical facades.

## Guiding Principle

**Move, don't change.** Every extraction is a literal relocation of code plus an import/ delegation seam. No logic edits, no renames, no opportunistic cleanup. The diff at each step should read as "code moved from A to B; A now imports/re-exports B."

---

## Part A — query-pack.ts Decomposition (Phase 1, lowest risk)

### Dependency layering (clean DAG, no cycles)

```
query-pack.ts  (orchestrator + public executors + re-exports)
  ├─ query-pack-registry.ts      (packs, capabilities, dialect lookup)
  ├─ query-pack-captures.ts      (normalize + imports + edges + captures)
  │    ├─ symbol-signature.ts    (symbolKind, signature builders, buildSymbols)
  │    │    └─ native-node-helpers.ts  (text/field/descendants/symbolName/ancestor)
  │    └─ native-node-helpers.ts
```

### Module 1: `native-node-helpers.ts` (~130 LOC)
Pure native-node accessors — no `this`, no other internal deps. The leaves of the graph.
- `text` (L116), `frozenSpan` (L120), `field` (L129), `descendants` (L133), `symbolName` (L145), `ancestor` (L272), `unquote` (L548).
- Types it needs (`NativeQueryNode`, `SourceIndex`) stay imported from existing native-query types — not moved.

### Module 2: `symbol-signature.ts` (~360 LOC)
Symbol classification + signature derivation + `buildSymbols`. Depends on native-node-helpers.
- `SymbolDraft` interface (L65), `symbolKind` (L240), `leadingDocumentation` (L266), `declarationExportWrapper` (L281), `normalizedTypeToken` (L290), `signatureOwner` (L294), `structuralSignature` (L299), `signatureMaterial` (L322), `buildSymbols` (L403 — bulkiest single fn ~145 LOC).

### Module 3: `query-pack-registry.ts` (~120 LOC)
Pack registry + capability contract + dialect dispatch.
- `StructuralQueryPack` interface (L30 — **exported**), `QueryCapabilityContract` type (L72 — **exported**), `QUERY_PACKS` Map (L40), `SYMBOL_KINDS` Set (L50), `ALL_REQUIRED_CAPABILITIES` (L76), `enabled` (L86), `queryPackFor` (L90), `structuralQueryPackForDialect` (L1252 — **exported**).

### Module 4: `query-pack-captures.ts` (~600 LOC — at budget)
Capture normalization, import binding, edge construction. Depends on native-node-helpers + symbol-signature + registry.
- `normalizeQueryCaptures` (L99 — **exported**), `frozenBindings` (L556), `importBindings` (L566), `RustUseLeaf` (L596), `rustPathSegments` (L598), `rustUseLeaves` (L608), `buildImports` (L630 — ~304 LOC), `unresolved` (L934), `targetParts` (L938), `callKind` (L944), `buildCallEdges` (L958), `buildSyntaxEdges` (L1022), `dedupeEdges` (L1108), `functionalCaptures` (L1119), `EMBEDDED_EXTENSIONS` (L1177), `collectEmbeddedChildren` (L1185).
- Edge-builder constant sets `LISTEN_TERMINALS`/`HTTP_CLIENTS`/`HTTP_METHODS` (L55-61) move here (only consumers are edge builders).
- **Safety valve:** if final LOC > 620 after extraction, split edge builders (`buildImports`/`buildCallEdges`/`buildSyntaxEdges`/`dedupeEdges`/`callKind`/`targetParts`/`unresolved` + their sets) into `query-pack-edges.ts`. Re-evaluate after the move; do not pre-split.

### Orchestrator: `query-pack.ts` (~160 LOC after)
- `executeQueryPack` (L1145 — **exported**), `executeStructuralQueryPack` (L1245 — **exported**).
- Re-exports the 6 public symbols from the 4 submodules so `services/index.ts` barrel stays byte-identical.

### Barrel impact
None. `services/index.ts:171-178` re-exports from `./structural/query-pack.js`; that file still owns the 6 public symbols (now re-exported from submodules).

### Anchor
`structural-query-pack.test.ts` (845 LOC) — comprehensive. Run after every module move. No new tests required for Phase 1 (existing coverage pins behavior); the gate is "test file unchanged + green."

---

## Part B — ContextualSearchRLM Characterization Tests (Phase 2)

### Problem
RLM has no unit characterization of `search()` internals or mutex ordering. Existing coverage:
- `search-ranking-regression.test.ts` (49 LOC) — thin.
- `search-synapse-integration.test.ts` (179 LOC) — Synapse path only.
- `concurrent-indexing.test.ts` (311 LOC) — mutex ordering (good, but only end-to-end via `indexProject`).
- `search-admission-preflight.test.ts` — M10 admission (exists).

### Reachability model (revised after plan-critic — Challenge #4)
Two test seams are available; each characterization item uses the one that actually reaches it:
- **Injected-deps seam** (constructor `deps`): reaches `search()` end-to-end and the mutex path — these consume `keywordSearch`/`vectorStore`/`searchCache`/`symbolRepo` injected at construction.
- **`(inst as any).method()` cast**: reaches the private pure-ish helpers (`fuseResults` @L1230, `generateScoreExplanation` @L1435, `calculateAvgScore` @L1519, `extractPreview` @L1510, `filterByPatterns` @L1528). These are private and read `this.RRF_K` (fuseResults L1302) — NOT reachable via injected deps. The cast is **precedented** (`concurrent-indexing.test.ts` already does `(inst as any)._indexProjectInternal` and `(inst as any).ensureInitialized`). This is test-only reflection, not a production encapsulation change.

### New test file: `contextual-search-rlm.characterization.test.ts`
Pin observable behavior **before** the split:
1. **RRF fusion** — via `(inst as any).fuseResults.call(inst, keywordRanked, vectorRanked)`; assert fusion with `RRF_K=60`: rank-1 from either source wins, ties broken deterministically. Hand-computed expectation over two fixed ranked arrays. *(discrimination anchor for rlm-search.ts)*
2. **search() end-to-end** — via injected-deps seam: stub `keywordSearch`/`vectorStore` returning fixed ranked arrays, assert final ordering matches a hand-computed RRF ranking. *(primary discrimination anchor)*
3. **calculateAvgScore** — `(inst as any).calculateAvgScore([])` boundary + non-empty mean.
4. **extractPreview** — `(inst as any).extractPreview(content)` clamping + default maxLines=5.
5. **filterByPatterns** — `(inst as any).filterByPatterns(...)` include/exclude glob.
6. **Mutex ordering** — via injected-deps + `(ContextualSearchRLM as any).indexingLocks` reset + `(inst as any)._indexProjectInternal` timing stub (same pattern as `concurrent-indexing.test.ts`): same-projectId serializes (2nd starts only after 1st releases), different-projectId concurrent, lock map cleared after completion, AND lock released even if `_indexProjectInternal` throws (this last assertion is the discrimination anchor for `runWithIndexLock`'s try/finally — Challenge #2).

These tests are added BEFORE Phase 3 and must stay green through every Phase 3 commit (they are the mutation-killing anchors).

---

## Part C — ContextualSearchRLM Facade Split (Phase 3)

### Pattern: thin-delegate class + module functions

Keep `ContextualSearchRLM` as a real class owning state; move method **bodies** into module functions that receive the instance (or the specific deps) as a parameter. Class methods become 1-line delegates.

### Encapsulation decision (accepted cost)
RLM instance fields are currently `private`. A delegate-split requires module functions to read instance state (`this.keywordSearch`, `this.RRF_K`, etc.). TS `private` is compile-time-only. **Decision: relax the moved-relevant fields from `private` to `public` (drop the modifier) in the class, so module functions can read them via the passed instance.**
- Runtime behavior: identical.
- Type-surface: expanded (fields become visible in `.d.ts`). Additive, not breaking — verified via grep: no consumer reads instance fields (only the static `indexingLocks` is read externally; the few `.keywordSearch`/`.vectorStore` grep hits are unrelated classes `hybrid-search.ts`/`index-manager.ts`/`etl/load.ts`, not RLM consumers).
- This is the standard god-class-to-delegate refactor cost. Documented, intentional, minimal.
- Alternative considered: pass deps explicitly as params to every function — rejected: explodes signatures (26 methods × ~6 deps), higher churn/risk than the relaxation.

### Delegate-preservation contract (MANDATORY — from plan-critic gate)
Two instance methods are monkey-patched by the existing test surface and MUST remain instance methods (thin delegates to module functions), so `(inst as any).X = ...` overrides still route through the virtual dispatch:
- **`_indexProjectInternal`** — `concurrent-indexing.test.ts:181-289` patches `(inst as any)._indexProjectInternal` to inject controlled timing/throw/order assertions.
- **`ensureInitialized`** — `concurrent-indexing.test.ts:67` patches `(inst as any).ensureInitialized` to short-circuit factory calls.

Pattern (MUST follow for these two):
```ts
// class
private async _indexProjectInternal(...args) { return _indexProjectInternalImpl(this, ...args); }
private async ensureInitialized() { return ensureInitializedImpl(this); }
```
Every other method may be a plain `async m(...a){ return rlmX(this, ...a); }` delegate (no test overrides them).

### Mutex extraction — exact verbatim lift (MANDATORY — from plan-critic gate)
The current lock body `contextual-search-rlm.ts:188-208` is:
```ts
const prevLock = ContextualSearchRLM.indexingLocks.get(projectId);
const isQueued = prevLock !== undefined;
let releaseLock!: () => void;
const myLock = new Promise<void>((resolve) => { releaseLock = resolve; });
ContextualSearchRLM.indexingLocks.set(projectId, myLock);
if (isQueued) { logger.info(...); await prevLock; }
try { return await this._indexProjectInternal(projectPath, projectId, options); }
finally {
  if (ContextualSearchRLM.indexingLocks.get(projectId) === myLock) ContextualSearchRLM.indexingLocks.delete(projectId);
  releaseLock();
}
```
`runWithIndexLock(lockMap, projectId, work)` extracts this EXACTLY, including:
1. The **try/finally** around `await work()` (the finally does delete-if-still-owner + `releaseLock()`). `concurrent-indexing.test.ts:242-267` pins "lock released even if work throws" — linearizing without finally leaks the lock and fails this test.
2. `work` is `() => this._indexProjectInternal(...)` — the lambda captures the **virtual dispatch through `this`**, so the test's instance-level patch is still invoked. Do NOT call a module-local `_indexProjectInternal` from inside the lock helper.
The class `indexProject` method becomes:
```ts
async indexProject(projectPath, projectId, options) {
  return runWithIndexLock(ContextualSearchRLM.indexingLocks, projectId, () =>
    this._indexProjectInternal(projectPath, projectId, options));
}
```
Static `indexingLocks` stays the single source of truth on the class; tests' `(ContextualSearchRLM as any).indexingLocks` reset/assert keep working unchanged.

### Module 1: `rlm-indexing.ts` (~480 LOC)
Mutex + indexing lifecycle.
- Functions: `runWithIndexLock`, `indexProject`, `_indexProjectInternalImpl`, `ensureFreshIndex`, `indexFile`, `loadGitignore`, `checkSearchAdmission`, `ensureInitializedImpl`.
- Mutex extraction follows the **Mutex extraction — exact verbatim lift** contract above (try/finally + virtual-dispatch `work` lambda). `_indexProjectInternal` + `ensureInitialized` stay instance delegates per the **Delegate-preservation contract**.

### Module 2: `rlm-search.ts` (~540 LOC) + Module 2b: `rlm-admin.ts` (~150 LOC) — pre-planned split
Search god-method + fusion + scoring + context. `search` is ~391 LOC (L624-1015); plus `fuseResults` (~204 LOC), `generateScoreExplanation`, `addContextToResults`, `extractPreview`, `calculateAvgScore`, `filterByPatterns` → search core alone ≈ 700 LOC, over budget.
- **Planned split** (not contingency — Challenge #5 arithmetic): `rlm-search.ts` holds `search` + `fuseResults` + `generateScoreExplanation` + `addContextToResults` + `extractPreview` + `calculateAvgScore` + `filterByPatterns` (~540 LOC). `rlm-admin.ts` holds `clearProjectIndex` + `getProjectStats` + `warmupCache` + `getAnalytics` (~150 LOC).
- If the actual move lands `rlm-search.ts` under ~580 LOC with admin folded in, skip the admin split — but plan for it.

### Module 3: `rlm-synapse.ts` (~330 LOC)
Synapse graph + query correction.
- Functions: `applySynapseState`, `correctQuery`, `buildGraphStream`.

### Facade: `contextual-search-rlm.ts` (~300 LOC after)
- Imports + fields (now public), static `indexingLocks`, constructor, `ensureInitialized`, and 1-line delegates for every public/private method.
- `this` binding preserved: delegates call `moduleFn(this, ...)`.

### Barrel impact
None. `services/index.ts:6` re-exports `ContextualSearchRLM` from `./search/contextual-search-rlm.js`; the class still lives there.

---

## Size Budget (post-refactor target)

| File | LOC | Status |
| --- | --- | --- |
| native-node-helpers.ts | ~130 | ✓ |
| symbol-signature.ts | ~360 | ✓ |
| query-pack-registry.ts | ~120 | ✓ |
| query-pack-captures.ts | ~600 | ✓ (watch; safety-valve → query-pack-edges.ts) |
| query-pack.ts | ~160 | ✓ |
| rlm-indexing.ts | ~480 | ✓ |
| rlm-search.ts | ~540 | ✓ (pre-planned admin split) |
| rlm-admin.ts | ~150 | ✓ (planned) |
| rlm-synapse.ts | ~330 | ✓ |
| contextual-search-rlm.ts | ~300 | ✓ |

---

## Risk Register

| Risk | Mitigation |
| --- | --- |
| Mutex regression (BUG-SYN-4) | `runWithIndexLock` is a verbatim lift; `concurrent-indexing.test.ts` + `indexing-readiness-guard.test.ts` unchanged and green every commit |
| `this` binding lost in delegates | delegates are `async search(...){ return rlmSearch(this, ...) }` — `this` passed explicitly |
| Encapsulation relaxation breaks a consumer | pre-check: only static read externally; type-check gate every commit |
| QP capture module >600 LOC | safety-valve split into `query-pack-edges.ts` |
| search module >600 LOC | safety-valve split into `rlm-admin.ts` |
| Line drift mid-refactor | re-confirm ranges at each task; never edit blind from this doc's numbers |

## Verification recipe (DB-free, no Ollama — run from `packages/core`)

```bash
# Per-task gate (fast, targeted)
bun test src/__tests__/structural-query-pack.test.ts
bun test src/__tests__/concurrent-indexing.test.ts src/__tests__/indexing-readiness-guard.test.ts
bun test src/__tests__/search-ranking-regression.test.ts src/__tests__/search-synapse-integration.test.ts src/__tests__/search-admission-preflight.test.ts src/__tests__/contextual-search-rlm.characterization.test.ts

# Type gate (every commit)
turbo run type-check

# Full DB-free regression (end of each phase)
bun scripts/run-tests-isolated.ts --unit
```
