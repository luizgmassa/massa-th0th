# Multi-Language Tree-sitter Breadth Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement with the active `massa-th0th` Spec Driven Execute flow, `coding-guidelines`, and `caveman full`. One task produces one atomic commit after its gate passes. Never weaken, skip, or delete tests to make a gate pass. Phase workers execute one whole phase sequentially and never spawn nested workers. The main agent updates this file after every phase.

**Design:** `.specs/features/multi-language-tree-sitter-breadth/design.md`  
**Capability contract:** `.specs/features/multi-language-tree-sitter-breadth/capability-matrix.md`  
**Status:** TASK-001 PASS; TASK-002 PASS; TASK-003 PASS; TASK-004 PASS; TASK-005 PASS; TASK-006 PASS; TASK-007 READY

## Project Testing Guidelines Scan

- Startup/project policy: user-supplied `AGENTS.md` requires `caveman full`, `coding-guidelines`, `massa-th0th`, persona routing, RTK-prefixed shell commands, and evidence-backed completion.
- Package commands: root `package.json` defines `bun run type-check`, `bun run build`, and `bun run test`; `packages/core/package.json` defines isolated `test:unit` and sequential `test:e2e` runners.
- Test isolation: `packages/core/scripts/run-tests-isolated.ts` groups pure tests but isolates module mocks, PostgreSQL/integration tests, and process-global state. E2E files always run sequentially.
- CI: `.github/workflows/ci.yml` currently floats Bun `latest`; this feature adds only the macOS arm64 native smoke and leaves other platform jobs unchanged.
- Existing style sampled: `typed-edges.test.ts`, `etl-pipeline-pg.test.ts`, `etl-cache-invalidation.test.ts`, `symbol-repository-pg-mtime.test.ts`, `symbol-graph-service.test.ts`, `index-project-identity.test.ts`, `apps/tools-api/src/__tests__/startup-config.test.ts`, `apps/mcp-client/src/tool-definitions-checkpoints.test.ts`, plus E2E `02.indexing`, `09.symbol-graph`, and `15.nfr`.
- Strong default: every spec AC and listed edge case needs deterministic evidence; existing best-effort skips are not an acceptance ceiling.

## Test Coverage Matrix

> Generated from current source, project scripts, existing tests, and the approved spec. Guidelines found: user-supplied `AGENTS.md`, root/core `package.json`, `.github/workflows/ci.yml`, and `packages/core/scripts/run-tests-isolated.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Manifest, codec, spans, diagnostics, query packs, resolvers | unit/golden | All branches; 1:1 AC outcomes; every listed edge/negative case | `packages/core/src/__tests__/*tree-sitter*.test.ts`, `fixtures/polyglot/**` | `bun test <focused files>` |
| Parser pool/runtime/readiness | unit + native smoke | Lease serialization, timeout, failure cleanup, all grammars load/parse, negative ABI/missing sensor | core and Tools API unit tests; `scripts/verify-tree-sitter-grammars.ts` | `bun run verify:tree-sitter-native` plus focused Bun tests |
| ETL Parse/Resolve/Load | unit + PostgreSQL integration | Recovered/hard outcomes, no empty-success erasure, generation context, deleted/stale behavior | `packages/core/src/__tests__/etl-*.test.ts` | `bun test --max-concurrency 1 <focused files>` |
| Graph generation repository/migration | PostgreSQL integration | Backfill, active filters, lease/CAS, interruption, retry, stale snapshot, centrality/diagnostic ownership | `packages/core/src/__tests__/graph-generation-*.test.ts` | `bun test --max-concurrency 1 <focused files>` with owned `DATABASE_URL` |
| HTTP/MCP controllers and schemas | unit/contract + E2E | Exact modern/legacy FQN results, ambiguity parity, diagnostics summaries, additive kinds | Tools API/MCP tests and core E2E | focused Bun tests; owned sequential E2E command |
| macOS arm64 packaging and CI | artifact/native smoke | Frozen clean install, source/dist/packed-package grammar load, arm64 linkage | package scripts, `.github/workflows/*.yml`, native verifier | `bun run verify:tree-sitter-native` on macOS arm64 |
| Parser performance | benchmark | Frozen corpus/checksum, exact baseline/candidate isolation, throughput/RSS thresholds, native-retention stress | `benchmarks/parser/**`, root/core scripts | `bun run bench:parser -- --baseline 5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03` |
| End-to-end graph behavior | owned sequential E2E | `02.indexing`, `09.symbol-graph`, `15.nfr`: happy, edge, error, concurrency, old visibility, polyglot results | `packages/core/src/__tests__/e2e/*.test.ts` | `RUN_E2E=1 bun test --max-concurrency 1 src/__tests__/e2e/02.indexing.test.ts src/__tests__/e2e/09.symbol-graph.test.ts src/__tests__/e2e/15.nfr.test.ts` from `packages/core` with owned stack env |
| Schema/config-only changes | build/migration | Prisma generation, migration deploy/backfill sentinels, type declarations compile | Prisma schema/migrations and config | `bun run type-check`; `bun run build`; owned migration gate |

## Parallelism Assessment

| Test Type | Parallel-Safe? | Isolation Model | Evidence |
| --- | --- | --- | --- |
| Pure unit/golden | Yes | Injected runtime/repository; unique fixtures; no global DB | Existing pure shared group in `run-tests-isolated.ts` |
| Native install/load | No locally | Shared Bun cache, node_modules, native build outputs, process-global grammar loader | Package lifecycle and runtime-global native modules |
| Parser-pool unit | Yes when isolated | Fresh pool instance per test; no singleton mutation | Required task design |
| PostgreSQL integration | No | Owned database; unique project/generation IDs; sequential cleanup | `run-tests-isolated.ts` database classification |
| Tools API startup/global env | No | Isolated process/env restore | Existing startup test and process-global classification |
| Owned E2E | No | One dedicated API/PostgreSQL/Ollama stack; `--max-concurrency 1` | Existing E2E runner and maintenance evidence |
| macOS native CI smoke | Yes | Dedicated macOS arm64 runner and clean package cache | CI job isolation |
| Benchmark | No | One fresh process per measurement on one otherwise-idle host | Spec benchmark contract |

## Gate Check Commands

| Gate | When | Command |
| --- | --- | --- |
| Focused | After one pure component/query-pack task | `bun test <task-owned test files>` |
| Core unit | After each phase touching core behavior | `bun run --filter @massa-th0th/core test:unit` |
| Type | After every code/config task | `bun run type-check` |
| Build | After every phase and native packaging change | `bun run build` |
| Native | TASK-001/TASK-002 and packaging phases | `bun run verify:tree-sitter-native` |
| PostgreSQL | Generation/migration tasks | `bun test --max-concurrency 1 <task-owned PG tests>` with an owned migrated `DATABASE_URL` |
| E2E | After public integration | `RUN_E2E=1 bun test --max-concurrency 1 src/__tests__/e2e/02.indexing.test.ts src/__tests__/e2e/09.symbol-graph.test.ts src/__tests__/e2e/15.nfr.test.ts` from `packages/core`, using the owned-stack environment frozen in `gate-manifest.md` |
| Benchmark | Performance phase/final validation | `bun run bench:parser -- --baseline 5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03` |
| Final | Before verifier | macOS arm64 native package checks; focused/core tests; type; build; owned PG/E2E; benchmark; artifact checksum/stale-reference checks |

## MCP and Skill Decision

- Selected skills: `caveman full`, `coding-guidelines`, `massa-th0th` Spec Driven, and the routed AI Engineer persona.
- Selected MCP: th0th recall/search for discovery only; current source and `.specs/` remain authoritative. Synapse is unavailable due the current shared `dist` export mismatch, so searches fall back to stateless retrieval.
- External research: official Tree-sitter, Bun, npm registry, and grammar repositories only when native API/package behavior is not proven locally.
- Local tools: `rtk`-prefixed shell commands, `apply_patch`, Bun, PostgreSQL, macOS arm64 native linker tools, and macOS CI when needed.
- Sub-agents: user authorized them. Seven phase workers run sequentially; an independent verifier runs after TASK-026. No nested workers.

## Execution Plan

```text
Phase 0 Native Gate:
  T1 -> T2

Phase 1 Structural Foundation:
  T2 -> T3 -> T4 -> T5
              \-> T6

Phase 2 TS/JS Vertical Slice:
  T5,T6 -> T7 -> T8 -> T9

Phase 3 Graph Generation:
  T6 -> T10 -> T11 -> T12
  T9,T12 -> T13 -> T14

Phase 4 Language Cohorts:
  T9,T14 -> T15 [P]
         -> T16 [P]
         -> T17 [P]
         -> T18 [P]
         -> T19 [P]

Phase 5 Public Integration:
  T13,T15-T19 -> T20
  T14,T20 -> T21 -> T22

Phase 6 Packaging, CI, Benchmark, Docs:
  T2,T5,T15-T19 -> T23 -> T24
  T9,T15-T19 -> T25
  T21,T22,T24,T25 -> T26

Phase 7 Validate:
  T26 -> independent verifier -> fix/reverify loop (maximum 3)
```

## Task Breakdown

### T1 / TASK-001: Prove native grammar feasibility on macOS arm64

**Status:** PASS on 2026-07-13. Exact Bun 1.2.0 was rejected; exact Bun 1.3.0 passed frozen clean install, 33/33 parse twice, Mach-O arm64 linkage, and two negative sensors. Evidence is in `capability-matrix.md` and `gate-manifest.md`.

**What:** In throwaway clean caches, vet and load/parse every unique grammar artifact on exact Bun/macOS arm64; freeze package/commit, license, scripts, ABI, integrity, arm64 linkage, and failures in `capability-matrix.md` and `gate-manifest.md`.  
**Where:** `.specs/features/multi-language-tree-sitter-breadth/{capability-matrix,gate-manifest}.md`; throwaway `/tmp` probes only.  
**Depends on:** None. **Requirements:** MLTS-001-003.  
**Non-goals:** No production parser/schema code; no WASM/runtime-download fallback.  
**Tests:** Native clean-install/load/parse and missing/incompatible negative sensors. **Gate:** Native.  
**Done when:** Repository-declared Bun `1.2.0` is tested first; if it fails, failures are retained and exact `1.3.x` candidates are tested from lowest version upward. Every grammar row is measured PASS on the selected exact Bun/macOS build, the selected runtime is frozen for T2, or execution stops Blocked with exact failed artifact/evidence.  
**Commit:** `docs(specs): record native tree-sitter feasibility`

### T2 / TASK-002: Pin native dependencies and one Bun runtime

**Status:** PASS on 2026-07-14. Two independent reviews exposed mutable-owner and cross-tree cursor-transfer crashes. Patch v3 binds immutable owners, marshals same-tree reset nodes, rejects cross-tree reset/resetTo in JS and native code, passes every fresh gate, and received author-independent acceptance with no remaining findings.

**What:** Consume the exact Bun and grammar selections frozen by T1; add those dependencies, lockfile, explicit `trustedDependencies`, exact Node `22.22.2` build-helper contract, the checksummed explicit-disposal/packaging patch plus core bundled dependency, a publish-safe internal semver, and `verify:tree-sitter-native` script without reselecting versions.
**Where:** root/core package manifests, `bun.lock`, `patches/tree-sitter@0.25.0.patch`, `scripts/verify-tree-sitter-grammars.ts`, focused tests.  
**Depends on:** T1 PASS. **Requirements:** MLTS-001-004,020.  
**Non-goals:** Non-macOS and Docker packaging; macOS CI is T24.  
**Tests:** Manifest/package/patch exhaustiveness, source and `dist` grammar load, post-delete safety, no-delete discrimination, and bounded native retention. **Gate:** Native + Type + Build.  
**Done when:** Frozen install and verifier pass with only audited lifecycle packages trusted, exact patch identity, deterministic stale-object failure, and bounded explicit disposal.  
**Commit:** `build(parser): pin native tree-sitter grammars`

### T3 / TASK-003: Define normalized structural contracts and exhaustive manifest

**Status:** PASS on 2026-07-14. The exact 33-entry manifest and normalized contracts passed 6 focused tests/451 assertions, uncached workspace type-check/build, diff integrity, and independent review after remediating the `paramIndex` vocabulary finding.

**What:** Add normalized symbol/edge kinds, `SourceSpan`, parse outcomes, diagnostics, capability types, and the exact 33-extension manifest/fingerprint inputs.  
**Where:** `packages/core/src/services/structural/{types,language-manifest}.ts` and unit tests.  
**Depends on:** T2. **Requirements:** MLTS-001,005,007-009,019.  
**Tests:** Unit/golden; exact extension equality and custom-extension negative case. **Gate:** Focused + Type.  
**Done when:** All contracts compile and manifest comparison returns 33/33 with no duplicates/extras.  
**Commit:** `feat(parser): define structural language manifest`

### T4 / TASK-004: Implement grammar loaders and parser readiness

**Status:** PASS on 2026-07-14. Exact Bun 1.3.0 focused tests passed 10/10 with 81 assertions; existing queue/mutex regressions passed 13/13; the native verifier, uncached type-check/build, built-dist readiness, diff integrity, and independent review all passed.

**What:** Add explicit native imports, a serialized Bun-marker compatibility loader with exact descriptor restoration in `finally`, idempotent `validateAllGrammars`, parser readiness state, `/health` liveness separation, and indexing guard.
**Where:** structural grammar loader/readiness modules, Tools API startup/routes, direct-core guard, tests.  
**Depends on:** T3. **Requirements:** MLTS-002-003,017-019.  
**Tests:** Unit/native smoke; loader serialization/restoration on success and throw; missing/ABI-incompatible grammar keeps liveness but rejects indexing. **Gate:** Focused + Native + Type.
**Done when:** All required grammars validate before indexing, the Bun descriptor is always restored before parsing, and custom semantic-only extensions do not fail readiness.
**Commit:** `feat(parser): add native grammar readiness`

### T5 / TASK-005: Implement bounded parser pool and structural runtime

**Status:** PASS on 2026-07-14. Exact Bun 1.3.0 focused tests passed 21/21 with 212 assertions; the native verifier, forced uncached type-check/build, diff integrity, and independent review passed after remediating process-global cap bypass, poisoned retarget-slot reuse, and raw grammar-cache exposure.

**What:** Add FIFO bounded parser leases, per-language reuse, acquisition timeout, parse/query/cursor-delete/tree-delete `finally`, recovered/hard outcomes, and diagnostics bounding using the T2-frozen patched binding.  
**Where:** structural parser pool/runtime/diagnostic modules and tests.  
**Depends on:** T4. **Requirements:** MLTS-004,007-009,012,017.  
**Tests:** Unit/native; overlap detector, timeout, forced query failure cleanup, recovered syntax, cursor-before-tree ordering, double-delete/stale-object sensors, and 100 forced-GC/RSS cycles. **Gate:** Focused + Native + Type.  
**Done when:** No parser is concurrent, every cursor is deleted before its tree even on failure, the cycles 81-100 median RSS is at most 16 MiB above the cycles 21-40 median after per-cycle `Bun.gc(true)`, and hard failure never becomes empty success.  
**Commit:** `feat(parser): add bounded structural runtime`

### T6 / TASK-006: Implement SourceSpan and versioned FQN codec

**Status:** PASS on 2026-07-14. Exact Bun 1.3.0 focused tests passed 25/25 with 79 assertions; forced uncached workspace type-check/build and diff integrity passed. Independent review's strict-parser and round-trip findings were remediated so malformed modern-looking suffixes cannot masquerade as legacy FQNs and legitimate reserved-looking names receive hashed primary IDs.

**What:** Add byte/point mapping, embedded remap/newline index, line compatibility derivation, canonical signatures, full SHA-256 FQNs, legacy aliases, deterministic ambiguity payload, and collision failure.  
**Where:** structural span/FQN modules and golden tests.  
**Depends on:** T3. **Requirements:** MLTS-005-007.  
**Tests:** Unicode, emoji, BOM, CRLF, tabs, nesting, overloads, forced digest collision, snippet round trip. **Gate:** Focused + Type.  
**Done when:** Exact golden bytes/points/FQNs and collision behavior pass.  
**Commit:** `feat(graph): add structural identity codecs`

### T7 / TASK-007: Build declarative query execution and TS/JS packs

**Status:** READY after TASK-005 and TASK-006 PASS.

**What:** Implement query-pack execution, capture normalization/dedupe, documentation and all required TS/JS symbol/import/edge captures.  
**Where:** structural query engine, TS/JS/TSX/JSX packs, fixtures, unit tests.  
**Depends on:** T5,T6. **Requirements:** MLTS-005,008-009,014.  
**Tests:** Unit/golden for decorators, methods, nesting, overloads, imports, calls, data flow, HTTP/events, and negatives. **Gate:** Focused + Type.  
**Done when:** TS/JS query packs meet exact required/forbidden fixtures.  
**Commit:** `feat(parser): add typescript query packs`

### T8 / TASK-008: Build resolver registry and TS/JS resolver

**What:** Replace TS-only hard-coding with resolver interfaces/registry and a TS/JS resolver using syntax/import/build metadata plus shared FQN codec.  
**Where:** structural resolvers and Resolve-stage adapter tests.  
**Depends on:** T6,T7. **Requirements:** MLTS-006,008-009,014.  
**Tests:** Same-file, import, namespace, exact global, ambiguity, unresolved, and legacy cases. **Gate:** Focused + Type.  
**Done when:** Resolver returns stable modern/legacy/unresolved outcomes without first-definition ambiguity loss.  
**Commit:** `feat(graph): add language resolver registry`

### T9 / TASK-009: Integrate TS/JS runtime into ETL and retire regex after parity

**What:** Delegate Parse/Resolve structural work to the new engine while keeping `smartChunk` unchanged; add baseline characterization/approved-difference ledger; remove regex/typed-edge extractors only after parity.  
**Where:** ETL stages/context/pipeline, temporary characterization adapter, tests.  
**Depends on:** T7,T8. **Requirements:** MLTS-012,014.  
**Tests:** Characterization, parse-failure retention contract, unchanged chunk snapshots, focused ETL tests. **Gate:** Focused + Core Unit + Type + Build.  
**Done when:** TS/JS uses native Tree-sitter, all approved differences are explicit, and semantic chunk output is unchanged.  
**Commit:** `refactor(parser): route etl through tree-sitter`

### T10 / TASK-010: Add graph-generation schema and legacy backfill

**What:** Add generation lifecycle model, workspace active/pending/lease fields, generation ownership for all graph tables/centrality/diagnostics, FQN/span metadata, and safe legacy backfill.  
**Where:** Prisma schema, one migration, migration/backfill tests.  
**Depends on:** T6. **Requirements:** MLTS-006-007,010-013,017.  
**Tests:** Owned PostgreSQL migration, row-count/orphan sentinels, active legacy result parity. **Gate:** PostgreSQL + Type.  
**Done when:** Existing workspaces have one valid active legacy generation and every graph-derived row is owned.  
**Commit:** `feat(db): version structural graph generations`

### T11 / TASK-011: Implement graph-generation lifecycle repository

**What:** Add begin/heartbeat/complete/activate/abort APIs with DB lease token, expiry recovery, snapshot/fingerprint separation, expected-active CAS, and pending cleanup.  
**Where:** graph-generation repository/coordinator lifecycle modules and PG tests.  
**Depends on:** T10. **Requirements:** MLTS-010-013.  
**Tests:** Competing owners, heartbeat, lease loss, stale expected active, retry, abort cleanup. **Gate:** PostgreSQL + Type.  
**Done when:** Only the lease owner with matching CAS can activate.  
**Commit:** `feat(graph): coordinate graph generation lifecycle`

### T12 / TASK-012: Scope symbol repository reads/writes by generation

**What:** Add generation-scoped per-file writes, active-generation reads, exact FQN/legacy lookup, centrality ownership, full aggregates, and deleted/stale file operations.  
**Where:** symbol repository interfaces/PG implementation and tests.  
**Depends on:** T10,T11. **Requirements:** MLTS-006,010-013,017-018.  
**Tests:** Active/pending isolation, stale-edge deletion, exact versus substring lookup, ambiguity candidates, centrality/diagnostic filtering. **Gate:** PostgreSQL + Type.  
**Done when:** Pending data is invisible and all active reads share one generation.  
**Commit:** `feat(graph): scope symbol storage by generation`

### T13 / TASK-013: Integrate generation lifecycle into ETL and job ordering

**What:** Thread generation/snapshot through Discover/Parse/Resolve/Load; build pending beside active; enforce completeness; retain last-good incremental rows; activate/count synchronously before terminal job; reconcile deletes.  
**Where:** ETL stages/pipeline, workspace/job lifecycle, event ordering, tests.  
**Depends on:** T9,T12. **Requirements:** MLTS-010-014,017.  
**Tests:** Interruption, required-file failure, recovered syntax, incremental hard failure, same-project concurrent processes, old visibility, deletion, terminal ordering. **Gate:** PostgreSQL + Core Unit + Type + Build.  
**Done when:** No failure erases active graph and terminal jobs always name an activated generation.  
**Commit:** `feat(index): activate structural generations atomically`

### T14 / TASK-014: Persist and aggregate parser diagnostics

**What:** Store per-file parser metadata/bounded ranges and durable job/project summaries with active-generation and stale counts.  
**Where:** stage/job types, job store, symbol repository aggregates, tests.  
**Depends on:** T13. **Requirements:** MLTS-012,017-018.  
**Tests:** Recovered/hard/stale states, >10 detail bound, durable round trip, active-only aggregation. **Gate:** PostgreSQL + Type.  
**Done when:** Exact totals survive persistence while details never exceed ten per file.  
**Commit:** `feat(index): persist parser diagnostics`

### T15 / TASK-015: Implement Python/Ruby/PHP/Lua query packs and resolvers [P]

**What:** Add independently testable packs/resolvers/fixtures for the scripting cohort according to the capability matrix.  
**Where:** structural packs/resolvers and golden fixtures/tests.  
**Depends on:** T9,T14. **Requirements:** MLTS-008-009,015.  
**Tests:** Required symbols/docs/imports/type relations/calls/data flow/specialized edges plus negatives/unresolveds. **Gate:** Focused + Type.  
**Done when:** Every cohort capability meets exact floors.  
**Commit:** `feat(parser): add scripting language packs`

### T16 / TASK-016: Implement C/C++/Go/Rust/Zig query packs and resolvers [P]

**What:** Add systems cohort plus `.h` C/C++ evidence policy and deterministic source resolution.  
**Where:** structural packs/resolvers and golden fixtures/tests.  
**Depends on:** T9,T14. **Requirements:** MLTS-008-009,015.  
**Tests:** Cohort capabilities, includes/imports, types/traits, calls/flow, `.h` default/evidence, negatives. **Gate:** Focused + Type.  
**Done when:** Every cohort capability and `.h` policy passes.  
**Commit:** `feat(parser): add systems language packs`

### T17 / TASK-017: Implement Java/Kotlin/Scala/C#/Swift/Dart packs and resolvers [P]

**What:** Add managed/mobile cohort with nesting, overloads, constructors, properties, inheritance, imports, and flow.  
**Where:** structural packs/resolvers and golden fixtures/tests.  
**Depends on:** T9,T14. **Requirements:** MLTS-005-009,015.  
**Tests:** Exact capability fixtures, overload FQNs, negative declarations/calls, unresolveds. **Gate:** Focused + Type.  
**Done when:** Every cohort capability meets exact floors.  
**Commit:** `feat(parser): add managed language packs`

### T18 / TASK-018: Implement Elixir/Erlang/Clojure/OCaml/Haskell packs and resolvers [P]

**What:** Add functional/BEAM cohort with module/import/type/function/call/data-flow conventions and deterministic resolution.  
**Where:** structural packs/resolvers and golden fixtures/tests.  
**Depends on:** T9,T14. **Requirements:** MLTS-008-009,015.  
**Tests:** Exact cohort capability/negative/unresolved fixtures. **Gate:** Focused + Type.  
**Done when:** Every cohort capability meets exact floors.  
**Commit:** `feat(parser): add functional language packs`

### T19 / TASK-019: Implement Vue/Markdown/JSON/YAML and embedded parsing [P]

**What:** Add Vue script/template, Markdown headings/fences, JSON/YAML qualified keys, two-level embedding, host remap, stable scope FQNs, fallback, and dedupe.  
**Where:** embedded adapters, data/document packs, fixtures/tests.  
**Depends on:** T9,T14. **Requirements:** MLTS-005,007-009,015-016.  
**Tests:** Declared/unknown/malformed/repeated/nested blocks, Unicode/CRLF/BOM/tabs, keys/headings, recursion limit, dedupe. **Gate:** Focused + Type.  
**Done when:** Exact embedded spans/snippets/FQNs/diagnostics and data-symbol outputs pass.  
**Commit:** `feat(parser): add embedded and data language packs`

### T20 / TASK-020: Integrate FQN ambiguity and additive kinds across graph consumers

**What:** Route definition/reference/trace/architecture/impact consumers through active generation and shared FQN resolver; expose all additive kinds and stable ambiguity type.  
**Where:** core graph services/controllers/tools and tests.  
**Depends on:** T13,T15,T16,T17,T18,T19. **Requirements:** MLTS-005-006,013,023.  
**Tests:** Exact modern/legacy/ambiguous results and active-only graph traversal. **Gate:** Focused + PostgreSQL + Type.  
**Done when:** No consumer uses verbatim/first-match FQN behavior.  
**Commit:** `feat(graph): expose versioned symbol identities`

### T21 / TASK-021: Expose parser diagnostics through HTTP and MCP

**What:** Add parser readiness, durable index diagnostics, project-map summaries, generation identity, kinds, and one ambiguity schema to HTTP/MCP definitions.  
**Where:** Tools API routes, MCP tool definitions, shared types, tests.  
**Depends on:** T14,T20. **Requirements:** MLTS-003,005-006,017-018,023.  
**Tests:** Unit/contract transport parity, bounded details, liveness/readiness split. **Gate:** Focused + Type + Build.  
**Done when:** PostgreSQL, HTTP, and MCP serialize identical expected values.  
**Commit:** `feat(api): expose parser diagnostics and ambiguity`

### T22 / TASK-022: Replace polyglot limitation tests with deterministic E2E

**What:** Expand the polyglot fixture to all 33 extensions and replace best-effort/zero-symbol expectations with manifest-tier assertions, generation safety, and transport parity.  
**Where:** E2E fixtures and `02.indexing`, `09.symbol-graph`, `15.nfr` tests.  
**Depends on:** T21. **Requirements:** MLTS-001,005-019,023.  
**Tests:** Owned sequential E2E; no unexplained skip. **Gate:** E2E + Type.  
**Done when:** All required extensions and failure/concurrency paths assert exact outcomes.  
**Commit:** `test(e2e): enforce polyglot graph contracts`

### T23 / TASK-023: Verify macOS arm64 package artifacts

**What:** With exact Node `22.22.2`/npm `10.9.7`, pack shared then core and prove clean source, built `dist`, and packed-package native grammar link/load/parse/disposal on macOS arm64 with only audited lifecycle scripts trusted. Prove the tarball contains the generated arm64 addon and resolves the exact nested patched `tree-sitter` runtime rather than stock or hoisted code.  
**Where:** package manifests/scripts, packed-artifact helpers, native verifier tests.  
**Depends on:** T2,T5,T15,T16,T17,T18,T19. **Requirements:** MLTS-002-004,020.  
**Tests:** Clean-cache source/dist/packed-package parse, disposal, publish-manifest semver, exact loaded-module path, generated-addon presence, and arm64 linkage. **Gate:** Native + Build.  
**Done when:** Every packed surface loads, parses, and disposes every required grammar on macOS arm64 through the exact bundled patched runtime.  
**Commit:** `build(parser): verify macos native artifacts`

### T24 / TASK-024: Add frozen macOS arm64 CI and publish gates

**What:** Pin exact Bun for the native check; add a dedicated macOS arm64 smoke with provenance/linkage artifacts while leaving every pre-existing workflow and platform job unchanged.  
**Where:** new `.github/workflows/native-macos-arm64.yml`, scripts/config tests.  
**Depends on:** T23. **Requirements:** MLTS-002,020-021.  
**Tests:** Workflow static tests, baseline non-touch allowlist sensor, plus actual macOS arm64 target evidence; frozen install only. **Gate:** Native/CI artifact.  
**Done when:** The declared macOS arm64 target reports measured PASS.  
**Commit:** `ci(parser): gate macos native grammars`

### T25 / TASK-025: Add frozen parser benchmark and explicit-disposal stress

**What:** Add corpus manifest/checksum, baseline checkout runner, candidate parser-only runner, fresh-process sampling, variance rule, RSS method, thresholds, and a 100-cycle explicit-disposal/forced-GC native-retention sensor using the MLTS-004 16 MiB median-delta bound.  
**Where:** `benchmarks/parser/**`, package scripts, tests/docs.  
**Depends on:** T9,T15,T16,T17,T18,T19. **Requirements:** MLTS-004,014,022.  
**Tests:** Harness unit/smoke and measured same-host baseline/candidate result. **Gate:** Benchmark + Type.  
**Done when:** TS/JS throughput regression <=25%, RSS regression <=50%, corpus checksum matches, and stress passes.  
**Commit:** `perf(parser): add frozen tree-sitter benchmark`

### T26 / TASK-026: Complete active documentation and compatibility guidance

**What:** Document supported tiers, macOS arm64 native target, readiness, graph schema v2/rebuild visibility, diagnostics, modern/legacy FQNs, examples, rollout, and exact verification evidence; remove stale regex limitation text.  
**Where:** active README/docs/examples/spec state/handoff/gate manifest.  
**Depends on:** T21,T22,T24,T25. **Requirements:** MLTS-023 and all acceptance evidence.  
**Tests:** Link/stale-reference scans, manifest/docs parity, artifact checksums, Type/Build/full gates unchanged. **Gate:** Final pre-verifier gate.  
**Done when:** All active docs match measured behavior and no stale regex/zero-symbol claim remains.  
**Commit:** `docs(parser): document polyglot structural indexing`

## Task Granularity Check

| Tasks | Scope | Status |
| --- | --- | --- |
| T1-T2 | One native feasibility/package contract each | PASS |
| T3-T6 | One structural foundation component each | PASS |
| T7-T9 | Query engine, resolver registry, ETL vertical slice | PASS |
| T10-T14 | Schema, lifecycle repo, symbol repo, ETL coordinator, diagnostics | PASS |
| T15-T19 | One independently testable language-family component each | PASS |
| T20-T22 | Graph consumer contract, diagnostics transport, E2E fixture | PASS |
| T23-T26 | macOS arm64 package artifacts, CI, benchmark, docs | PASS |

No task mixes unrelated cleanup. Tests are included with the component they protect.

## Diagram-Definition Cross-Check

| Task | Depends on | Diagram shows | Status |
| --- | --- | --- | --- |
| T1 | none | phase root | PASS |
| T2 | T1 | T1 -> T2 | PASS |
| T3 | T2 | T2 -> T3 | PASS |
| T4 | T3 | T3 -> T4 | PASS |
| T5 | T4 | T4 -> T5 | PASS |
| T6 | T3 | T3 -> T6 | PASS |
| T7 | T5,T6 | join -> T7 | PASS |
| T8 | T6,T7 | T7 -> T8 with T6 | PASS |
| T9 | T7,T8 | T8 -> T9 | PASS |
| T10 | T6 | T6 -> T10 | PASS |
| T11 | T10 | T10 -> T11 | PASS |
| T12 | T10,T11 | T11 -> T12 | PASS |
| T13 | T9,T12 | join -> T13 | PASS |
| T14 | T13 | T13 -> T14 | PASS |
| T15-T19 | T9,T14 | parallel branches after join | PASS |
| T20 | T13,T15-T19 | cohort join -> T20 | PASS |
| T21 | T14,T20 | T20 -> T21 with T14 | PASS |
| T22 | T21 | T21 -> T22 | PASS |
| T23 | T2,T5,T15-T19 | native/cohort join -> T23 | PASS |
| T24 | T23 | T23 -> T24 | PASS |
| T25 | T9,T15-T19 | vertical/cohort join -> T25 | PASS |
| T26 | T21,T22,T24,T25 | final join -> T26 | PASS |

## Test Co-location Validation

| Tasks | Code layer | Matrix requires | Planned location | Status |
| --- | --- | --- | --- | --- |
| T1-T2 | Native config/runtime | native smoke + artifact | verifier script and feasibility artifacts in same tasks | PASS |
| T3-T8 | Structural domain | unit/golden | core structural tests/fixtures with component | PASS |
| T9 | ETL | unit/integration | focused ETL characterization tests in task | PASS |
| T10-T14 | Schema/repository/ETL | PG integration | migration/repository/ETL tests in each task | PASS |
| T15-T19 | Query packs/resolvers | unit/golden | family fixtures/tests in each task | PASS |
| T20 | Graph consumers | PG/unit | graph service/tool tests in task | PASS |
| T21 | HTTP/MCP | unit/contract | Tools API/MCP tests in task | PASS |
| T22 | E2E | owned E2E | exact E2E suites/fixture in task | PASS |
| T23-T24 | macOS package/CI | native/artifact smoke | source/dist/package/workflow smokes in task | PASS |
| T25 | Benchmark | performance/harness | benchmark tests and corpus in task | PASS |
| T26 | Docs/config | artifact/build | stale/link/parity scans plus unchanged full gates | PASS |

## Requirement Coverage

All MLTS-001 through MLTS-023 map to at least one task and one Test Coverage Matrix row. No requirement depends on hidden chat context.

| Acceptance criterion | Task evidence |
| --- | --- |
| AC-001 | T3, T19 |
| AC-002 | T1, T2, T4, T23, T24 |
| AC-003 | T5, T25 |
| AC-004 | T6-T9, T15-T19 |
| AC-005 | T7, T15-T19 |
| AC-006 | T10-T13, T20 |
| AC-007 | T4, T9, T13-T14, T21 |
| AC-008 | T7, T9, T25 |
| AC-009 | T6, T19 |
| AC-010 | T6, T8, T12, T20-T21 |
| AC-011 | T14, T21 |
| AC-012 | T22-T26 |

## Expected Test and Sensor Counts

Counts below are minimum new focused cases/sensors, not total repository pass counts. Each task records its pre-task baseline and SHALL finish with no unexplained decrease.

| Tasks | Minimum new cases/sensors |
| --- | ---: |
| T1 | One clean install/load/parse per unique grammar on macOS arm64, plus 2 negative sensors |
| T2 | 7 manifest/source/dist/patch/lifetime/frozen-install cases plus cold behavior subprocesses |
| T3 | 6 manifest/type/custom-extension cases |
| T4 | 5 readiness/liveness/direct-core/negative cases |
| T5 | 8 pool/recovery/failure/explicit-disposal cases |
| T6 | 12 span/FQN/ambiguity/collision goldens |
| T7 | 16 TS/JS symbol/import/edge/negative goldens |
| T8 | 8 resolver/FQN cases |
| T9 | 12 characterization/ETL/chunker cases |
| T10 | 8 migration/backfill/parity sentinels |
| T11 | 8 lifecycle/lease/CAS cases |
| T12 | 10 active-filter/repository/ambiguity cases |
| T13 | 12 ETL generation/failure/concurrency/order cases |
| T14 | 6 diagnostics/bounding/durability cases |
| T15 | 4 cases per extension in the scripting cohort |
| T16 | 4 cases per extension plus 3 `.h` dialect cases |
| T17 | 4 cases per extension plus overload FQN cases |
| T18 | 4 cases per extension in the functional/BEAM cohort |
| T19 | 5 cases per extension plus 10 embedded/span/fallback cases |
| T20 | 10 graph-consumer/FQN parity cases |
| T21 | 8 HTTP/MCP/readiness/diagnostics contract cases |
| T22 | At least 33 extension assertions across 12 deterministic E2E cases |
| T23 | 6 source/dist/packed-package install/load/parse/linkage sensors |
| T24 | One measured macOS arm64 native smoke, 2 workflow static tests, and 1 baseline non-touch sensor |
| T25 | 4 harness tests, 20 measured processes, and 100 explicit-disposal/forced-GC iterations |
| T26 | 4 docs/manifest/stale-reference/checksum scans |

## Artifact Store Evidence

- Active key: `.specs/features/multi-language-tree-sitter-breadth/tasks.md`
- Version: 9; TASK-005 PASS and TASK-006 READY
- Checksum: recorded in `gate-manifest.md` after artifact freeze.
