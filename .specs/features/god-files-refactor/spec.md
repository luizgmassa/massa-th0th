# God-Files Refactor Specification (M14) — DEFERRED

> **Status: Deferred (2026-07-18).** Seeded as a feature spec per Wave 2 plan; NOT executed this wave. Large + high behavior-preservation risk — warrants its own spec-driven pass with characterization tests before any extraction. Verify evidence and decomposition seams captured below for the future implementer.

## Problem Statement

Two god-files concentrate too much logic in single classes/modules: `packages/core/src/services/search/contextual-search-rlm.ts` (~1611 LOC, one `ContextualSearchRLM` class with ~31 methods) and `packages/core/src/services/structural/query-pack.ts` (~1248 LOC, ~45 top-level declarations). Both are load-bearing (search + structural extraction) and hold shared mutable state, making change risky.

## Goals

- [ ] Decompose both files behind UNCHANGED public facades (class names, method signatures, barrel re-exports) so callers see no difference.
- [ ] Add characterization tests that pin current behavior BEFORE extraction, so any drift is caught.
- [ ] Reduce per-file size and responsibility count without altering search ranking, RRF fusion, mutex ordering, or structural extraction output.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing search ranking / RRF / mutex semantics | Behavior must be preserved exactly |
| Changing structural extraction / dedup output | Same |
| Public API/facade changes | Callers (18 importers of ContextualSearchRLM, 11 of query-pack) must be unaffected |

## Verify Evidence (2026-07-18 fan-out)

### contextual-search-rlm.ts (1611 LOC, single class @L62)
- Indexing mutex queue: `indexingLocks` @L76, queue pattern @L174-195 (**load-bearing ordering logic** — mishandling reintroduces the BUG-SYN-4 concurrent-indexing race; see [[e2e-suite-and-stack-gotchas]]).
- init/ensureInitialized @L108; indexProject/_indexProjectInternal @L163/211; ensureFreshIndex @L338; indexFile @L502.
- `search()` @L567 — ~397 LOC god-method.
- Synapse: applySynapseState @L964, correctQuery @L1012, buildGraphStream @L1054.
- fuseResults/RRF @L1173; scoreExplanation @L1378; addContextToResults @L1420.

### query-pack.ts (1248 LOC)
- QUERY_PACKS registry + queryPackFor @L40/90; normalizeQueryCaptures @L99 (exported).
- 20+ pure node helpers @L116-240 (text/field/descendants/symbolName); symbolKind @L240; signature builders @L299-316.
- Capability contract @L72-86.

## Proposed Decomposition (phased — do NOT attempt as one commit)

1. **query-pack pure-function extraction FIRST (lowest risk):** extract `native-node-helpers.ts` (text/field/descendants ~200 LOC) + `symbol-signature.ts` (signatureMaterial/structuralSignature/symbolKind ~250 LOC) + `query-pack-registry.ts` (maps/packs/capabilities ~100 LOC) + `query-pack-captures.ts` (normalize + capture logic). Anchored by existing `structural-query-pack.test.ts` (826 LOC).
2. **Add ContextualSearchRLM characterization tests** (currently thin: search-ranking-regression 49 LOC, search-synapse-integration 179 LOC, concurrent-indexing 311 LOC; broad e2e 08/15/16/18 via real API but NO unit characterization of `search()` internals or mutex ordering). Pin behavior BEFORE touching the class.
3. **Extract RLM modules behind unchanged facade:** `rlm-indexing.ts` (mutex + indexProject + ensureFreshIndex + indexFile ~600), `rlm-search.ts` (search + fuse + score ~800), `rlm-synapse.ts` (applySynapseState + correctQuery + buildGraphStream ~350). Keep `ContextualSearchRLM` as a thin facade re-exporting method names.

## Critical Constraints

- `ContextualSearchRLM` class + methods `indexProject`/`ensureFreshIndex`/`search`/`indexFile` are re-exported via `services/index.ts:6` (18 importers incl. search-controller, lexical-search, index_project tool, discover stage, warmup). MUST stay stable.
- query-pack exports `StructuralQueryPack`, `QueryCapabilityContract`, `normalizeQueryCaptures` (`services/index.ts:174-178`, 11 importers). MUST stay stable.
- Shared mutable state (static `indexingLocks` map, caches, RLM state): extraction MUST preserve `this` binding + static mutex-map lifecycle.
- Barrel re-exports at `services/index.ts` must remain identical.

## Success Criteria

- [ ] Both files decomposed; no single module > ~600 LOC.
- [ ] Zero behavior change: all existing search + structural tests green; new characterization tests pin behavior.
- [ ] Public facade + barrel exports byte-identical.

## Sizing

Large / high-risk refactor. Full spec-driven: Specify (this doc) → Design (extraction map + test plan) → Tasks (phased, one module per atomic commit) → Execute → independent validate. Requires the concurrent-indexing + search mutex expertise — re-read [[e2e-suite-and-stack-gotchas]] BUG-SYN-4 before starting.
