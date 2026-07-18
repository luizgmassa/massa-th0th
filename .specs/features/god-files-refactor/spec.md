# God-Files Refactor Specification (M14)

> **Status: Active — Wave 2 M14.** Branch `m14-god-files` (off `wave-2`, unmerged). Spec-driven full pass. Seams re-confirmed against current source 2026-07-18; original seeded line numbers had drifted (RLM 1611→1668, QP 1248→1254; M10's `checkSearchAdmission` + M13's empty-region guard shifted downstream lines).

## Problem Statement

Two god-files concentrate too much logic in single classes/modules:
- `packages/core/src/services/search/contextual-search-rlm.ts` (**1668 LOC**, one `ContextualSearchRLM` class @L62, ~26 methods).
- `packages/core/src/services/structural/query-pack.ts` (**1254 LOC**, 44 top-level declarations, 6 exported).

Both are load-bearing (search + structural extraction) and hold shared mutable state, making change risky.

## Goals

- [ ] Decompose both files behind UNCHANGED public facades (class name, method signatures, barrel re-exports) so callers see no difference.
- [ ] Add characterization tests that pin current behavior BEFORE extraction, so any drift is caught.
- [ ] Reduce per-file size and responsibility count. **No module > ~600 LOC.**

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing search ranking / RRF / mutex semantics | Behavior preserved exactly |
| Changing structural extraction / dedup output | Same |
| Public API/facade changes | Callers unaffected |
| Algorithmic improvements / perf tuning | Pure structural refactor |

## Requirements (requirement IDs)

- **REQ-GF-1** — query-pack decomposed into ≥4 focused modules; `query-pack.ts` reduced to orchestrator + re-exports.
- **REQ-GF-2** — RLM decomposed into ≥3 focused modules behind an unchanged `ContextualSearchRLM` facade class.
- **REQ-GF-3** — No module > ~600 LOC across the new module set.
- **REQ-GF-4** — Public surface byte-identical: `ContextualSearchRLM` (+ `indexProject`/`ensureFreshIndex`/`search`/`indexFile`) via `services/index.ts:6`; query-pack's `StructuralQueryPack`/`QueryCapabilityContract`/`normalizeQueryCaptures`/`executeQueryPack`/`executeStructuralQueryPack`/`structuralQueryPackForDialect` via `services/index.ts:169-178` (value block 169-174, type block 175-178).
- **REQ-GF-5** — Static `indexingLocks` mutex map remains a static property on `ContextualSearchRLM` (observable test surface — see constraint below).
- **REQ-GF-6** — Zero behavior change: all existing structural + search tests green; new characterization tests pin behavior.

## Verify Evidence (re-confirmed 2026-07-18 against current source)

### contextual-search-rlm.ts (1668 LOC, class @L62)
- Static mutex map `indexingLocks` @**L76** (`private static indexingLocks = new Map<string, Promise<void>>()`) — queue-based tail-chaining pattern.
- Mutex ops inside `_indexProjectInternal`: `get` @L188, `set` @L193 (chains onto tail), delete-if-still-owner @L204-205. **This is the BUG-SYN-4 fix — mishandling reintroduces the concurrent-indexing race.**
- `ensureInitialized` @L108; `indexProject` @L163 (public, ~48 LOC); `_indexProjectInternal` @L211 (~127 LOC, holds mutex); `ensureFreshIndex` @L338 (public); `checkSearchAdmission` @L506 (M10 preflight, public); `indexFile` @L559 (public); `search` @**L624 (~391 LOC god-method, closes @L1015)**; `applySynapseState` @L1021; `correctQuery` @L1069; `buildGraphStream` @L1111; `fuseResults` @L1230; `generateScoreExplanation` @L1435; `addContextToResults` @L1477; `extractPreview` @L1510; `calculateAvgScore` @L1519; `filterByPatterns` @L1528; `clearProjectIndex` @L1561; `getProjectStats` @L1590; `warmupCache` @L1603; `getAnalytics` @L1665.
- **Mutex body verbatim (L188-208):** `get`→chain-`set`→optional `await prevLock`→`try { return await this._indexProjectInternal(...) } finally { delete-if-still-owner; releaseLock() }`. The try/finally + the `this._indexProjectInternal` virtual dispatch are load-bearing (test monkey-patches the instance method + asserts lock released on throw).

### query-pack.ts (1254 LOC)
- Exports: `StructuralQueryPack` @L30 (iface), `QueryCapabilityContract` @L72 (type), `normalizeQueryCaptures` @L99 (fn), `executeQueryPack` @L1145 (fn), `executeStructuralQueryPack` @L1245 (const), `structuralQueryPackForDialect` @L1252 (fn).
- Internal helpers (full map in design.md): registry block L40-114; native-node accessors L116-281; signature builders L240-548 (incl. `buildSymbols` L403-548); import/edge builders L548-1108 (`buildImports` L630-934 is the bulkiest @~304 LOC); capture/normalize L99-1145.

## Critical Constraints

- **`indexingLocks` is observable test surface** — NOT internal-only. `concurrent-indexing.test.ts` (L83,87,108,185,204,210,266) and `indexing-readiness-guard.test.ts` (L17,40) reset and assert `(ContextualSearchRLM as any).indexingLocks` directly. Extraction MUST keep it a static `Map<string, Promise<void>>` on the `ContextualSearchRLM` class.
- Shared mutable state (static mutex map, instance caches, RLM init flag): extraction MUST preserve `this` binding + static-map lifecycle.
- Barrel re-exports at `services/index.ts` must remain byte-identical.
- RLM instance fields are currently `private`; a delegate-split requires the extracted module functions to read instance state. See design.md for the accepted encapsulation decision (runtime-identical; only type-surface expansion).

## Success Criteria

- [ ] REQ-GF-1..6 satisfied.
- [ ] Both files decomposed; no module > ~600 LOC.
- [ ] Zero behavior change: existing structural + search tests green; new characterization tests pass.
- [ ] Public facade + barrel exports byte-identical.
- [ ] `.specs/features/god-files-refactor/validation.md` PASS from independent verifier.

## Sizing

Large / high-risk behavior-preserving refactor. Full spec-driven: Specify (this) → Design → Tasks → Execute → independent Validate. Full The Fool plan-challenge gate (>5 files, behavior-preserving). Re-confirm every seam against current source before extracting — seeded spec line numbers had drifted.
