# Multi-Language Tree-sitter Breadth Gate Manifest

**Workflow session:** `spec-multi-language`  
**Feature status:** Execute active; TASK-001 PASS; TASK-002 PASS; TASK-003 PASS; TASK-004 PASS; TASK-005 PASS; TASK-006 PASS; TASK-007 PASS; TASK-008 PASS; TASK-009 PASS; TASK-010 PASS; TASK-011 READY
**Baseline commit:** `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`  
**Baseline worktree:** supplied `plan-multi-language.md` was the only user-owned untracked file before feature artifact creation.

## Planning Gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Required coding bootstrap | PASS | `caveman full`, `coding-guidelines`, `massa-th0th`, persona router loaded in required order. |
| Memory/context restore | PASS with degradation | No exact-session memories; current source and `.specs/` used. Fresh index mapped the workspace; Synapse failed because shared `dist` lacks `requirePostgresDatabaseUrl`, so searches were stateless and source-confirmed. |
| Specify closure | PASS | 23 requirement IDs, 12 ACs, edge/failure cases, full implicit sweep, no open questions. |
| Discuss closure | PASS | Consequential native/readiness/generation/FQN/span/capability/custom-extension decisions recorded in `context.md`. |
| Design | PASS | Three approaches compared; supplied native-package approach selected; data/migration/concurrency/public compatibility defined. |
| Tasks | PASS | 26 tasks, seven execution phases, coverage/gate/parallelism tables, dependency cross-check, co-location validation, expected sensor counts. |
| Full Plan Challenge | PASS after revision | Pre-mortem critical/high findings revised: graph generation includes centrality/diagnostics, DB lease/snapshot/CAS and synchronous job ordering; readiness/liveness split; capability tiers conditional; FQN/SourceSpan contracts; generation completeness/last-good retention; benchmark corpus/variance/RSS semantics. Final closure pass found no remaining critical/high contradiction. |
| macOS arm64 scope challenge | PASS after revision | Removed container/runtime-image gates, enforced the Bun candidate ladder, added explicit AC traceability, and added a baseline non-touch sensor for excluded platform files. |
| Phase-worker permission | PASS | User explicitly allowed sub-agents when useful, including final verification. One sequential worker per Execute phase is selected. |

## TASK-001 Preflight

| Check | Current evidence | Status |
| --- | --- | --- |
| Canonical extensions | 33 entries, 33 unique in `DEFAULT_ALLOWED_EXTENSIONS` | PASS |
| Current structural breadth | 8 symbol extensions, 7 import extensions, 4 typed-edge extensions | BASELINE |
| Package runtime pin | root declares Bun `1.2.0`; TASK-002 must update it to the selected exact release | KNOWN DRIFT |
| Selected native runtime | Exact Bun `1.3.0`, Darwin arm64; lowest tested 1.3.x candidate | PASS |
| macOS native CI runtime | TASK-024 must pin exact Bun `1.3.0` | KNOWN DRIFT |
| Native grammar dependencies | 27 exact direct native artifacts, including the runtime, frozen and exercised | PASS |
| Candidate provenance | Exact npm versions/SRIs or Git commits, repositories, licenses, lifecycles, peers, and measured ABIs recorded in `capability-matrix.md` | PASS |

TASK-001 measures only macOS arm64 after the user's explicit scope override. It must run every grammar on that target. The source plan still forbids a WASM/runtime-download fallback.

## TASK-001 Execution Result (2026-07-13)

**Result:** PASS. Exact Bun `1.2.0` was tested first and rejected. Exact Bun `1.3.0`, the lowest tested 1.3.x candidate, passed the complete clean-install, module-load, 33-extension parse, native-linkage, and negative-sensor gate on macOS arm64.

| Command | Exit | Evidence |
| --- | ---: | --- |
| `rtk uname -s` | 0 | `Darwin` |
| `rtk uname -m` | 0 | `arm64` |
| `rtk sw_vers` | 0 | macOS `26.5.2`, build `25F84` |
| exact Bun 1.2.0 official artifact SHA check | 0 | `fa72173cb2220d00e2d2650fefdc0b5b37bfd8bb33d8d671b50efb409c2f5745`; matched release SHASUM |
| exact Bun 1.2.0 clean native attempts | nonzero | rejected: core/scoped Bun entrypoints, async ESM exports, and legacy Dart caused load failures; Dart also caused a Bun 1.2.0 SIGSEGV |
| exact Bun 1.3.0 official artifact SHA check | 0 | `85848e3f96481efcabe75a500fd3b94b9bb95686ab7ad0a3892976c7be15036a`; matched release SHASUM |
| exact Bun 1.3.0 `bun install --frozen-lockfile` with fresh cache | 0 | 37 packages in 8.58 seconds; direct native lifecycle scripts completed |
| exact Bun 1.3.0 `parse-matrix.mjs` | 0 | 33/33 extensions parsed; complete UTF-8 consumption; zero error roots; exact Bun marker restored |
| `file` and `otool -L` native inventory | 0 | 27 loaded modules and 29 files including nested duplicates; every file Mach-O 64-bit arm64; only system C++/System dynamic libraries |
| exact Bun 1.3.0 `negative-sensors.mjs` | 0 | missing package and incompatible legacy ABI 127 versus required ABI 137 both detected |
| exact Bun 1.3.0 `descriptor-sensor.mjs` | 0 | parser loaded; the complete Bun property descriptor was restored exactly after both success and a forced throw |

**Scope authority:** user instruction on 2026-07-13 makes macOS arm64 the only implementation target. Other platforms, container-native packaging, and other architectures are not gates and SHALL not be modified by this feature.

### Selected Exact Native Artifact Set

`tree-sitter@0.25.0`, `tree-sitter-javascript@0.25.0`, `tree-sitter-typescript@0.23.2`, `tree-sitter-python@0.25.0`, `tree-sitter-ruby@0.23.1`, `tree-sitter-php@0.24.2`, `@tree-sitter-grammars/tree-sitter-lua@0.4.1`, `tree-sitter-c@0.24.1`, `tree-sitter-cpp@0.23.4`, `tree-sitter-go@0.25.0`, `tree-sitter-rust@0.24.0`, `@tree-sitter-grammars/tree-sitter-zig@1.1.2`, `tree-sitter-java@0.23.5`, `@tree-sitter-grammars/tree-sitter-kotlin@1.1.0`, `tree-sitter-scala@0.24.0`, `tree-sitter-c-sharp@0.23.5`, `tree-sitter-swift@0.7.1`, `github:UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934`, `tree-sitter-elixir@0.3.5`, `github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870`, `tree-sitter-clojure-orchard@0.2.5`, `tree-sitter-ocaml@0.24.2`, `tree-sitter-haskell@0.23.1`, `tree-sitter-html@0.23.2`, `@tree-sitter-grammars/tree-sitter-markdown@0.3.2`, `tree-sitter-json@0.24.8`, and `@tree-sitter-grammars/tree-sitter-yaml@0.7.1`.

Vue uses HTML as its native SFC host plus the already-selected JavaScript/TypeScript child grammars. The legacy Vue npm binary, legacy Dart npm binary, and legacy Clojure NAN binding were rejected with recorded evidence. No WASM or runtime-download fallback was used.

### Reproduction Evidence Freeze

| Throwaway evidence artifact | SHA-256 |
| --- | --- |
| Exact candidate `package.json` | `525a2ab2ec8a5b6e348d71a4bc40b766cc8085dea58b76073f1452e63f064749` |
| Exact resolved `bun.lock` | `dc7d4290ccf92eb1a2bfb88eb5a79f66e3b5645920c36277d96c6cf850a5537b` |
| 33-extension parse/load/native-inventory sensor | `e37e6f7efa3324e04eca668696f1d97e857e597a89cc744be56aa38dd3302fb0` |
| Missing/incompatible negative sensor | `6a9748db4afdee6c8c093cb82d16d51f14de651ab193ad219eab090c4998f5bf` |
| Success/throw Bun-descriptor restoration sensor | `81feaec91cb6accb70738342ee48bd4f8f732b01b386cb7527a9e7922f3177bd` |

The clean build used exact Node `22.22.2` arm64 only as the pinned `node-gyp-build` helper because Node 25 headers require C++20 while `tree-sitter@0.25.0` declares C++17. The selected application runtime remains exact Bun `1.3.0`. Bun 1.3.0 loads the unmodified packages through a serialized compatibility shim that temporarily removes the configurable `process.versions.bun` marker, uses each package's existing `node-gyp-build` fallback, and restores the exact descriptor before parsing. TASK-004 owns the production shim and invariant tests.

### TASK-001 Post-Gate Adequacy Review

| Done-when criterion | Exact evidence | Spec-defined outcome | Covered? |
| --- | --- | --- | --- |
| Ordered Bun candidate ladder | `capability-matrix.md:146` — 1.2.0 failure retained; 1.3.0 selected as the lowest tested 1.3.x | Test 1.2.0 first, then exact 1.3.x from lowest upward | Yes |
| Frozen clean installation | `capability-matrix.md:148` — `bun install --frozen-lockfile` completed in a fresh cache | Reproducible exact install on macOS arm64 | Yes |
| Every manifest extension loads/parses | `gate-manifest.md:49` and `capability-matrix.md:149` — `33/33`, full byte consumption, `hasError=false`, repeated twice | Every required grammar parses on selected runtime | Yes |
| Native arm64 linkage | `capability-matrix.md:150` — every loaded module is Mach-O arm64 with system-only linkage | Record supported-target native linkage | Yes |
| Missing/incompatible failure discrimination | `gate-manifest.md:51` and `capability-matrix.md:151` — both negative sensors detected | Missing or ABI-incompatible grammar is rejected | Yes |
| No forbidden fallback | `capability-matrix.md:152` — no WASM or runtime/post-install download | Native pinned artifacts only | Yes |

Reverse mapping: the runtime ladder, frozen install, parse matrix, linkage inventory, and two negative sensors map only to T1 done-when plus MLTS-001-003/AC-002. No speculative sensor was added. Assertions discriminate plausible wrong implementations: a missing extension, parse error, truncated byte range, wrong architecture, failed descriptor restoration, absent package, or legacy ABI would fail. Project testing guidelines followed: `tasks.md` native gate and no skipped/deleted test assets. **Verdict: sufficient, necessary, non-shallow PASS.**

## TASK-002 Remediation Result (2026-07-14)

**Result:** PASS. The first review rejected synthetic consumers, optional disposal, queue deadlock paths, and incomplete lock assertions. Later reviews reproduced mutable-owner and cross-tree cursor-transfer SIGSEGVs plus incorrect cross-tree reset behavior. Patch v3 closes those paths in both JS and native code, was regenerated canonically from the pristine npm artifact, passed the authoritative rerun, and received fresh author-independent acceptance with no remaining findings.

| Gate | Result | Evidence |
| --- | --- | --- |
| Fresh frozen install | PASS | Isolated copy, empty cache, exact Bun 1.3.0 plus Node 22.22.2 helper; 770 packages in 8.99 seconds. |
| Focused tests | PASS | Patch v3: 9 tests, 54 assertions, zero failures/skips. |
| Durable native verifier | PASS | Real cold source/dist entries; 33+33 parses, 27+27 exact loaded modules, 54 Mach-O arm64/system-only linkage checks, 27 lock identities/integrities, ten behavior guards including owner substitution and cross-tree cursor transfer, plus missing/incompatible sensors. |
| Native lifetime discrimination | PASS | 100 explicit-delete/forced-GC cycles median delta 557,056 bytes; no-delete child growth 125,026,304 bytes; exact bound 16,777,216 bytes. |
| Patch identity | PASS | Upstream `tree-sitter@0.25.0` SRI plus repository patch SHA-256 `b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a`; root and lock mappings exact. |
| Packed-consumer feasibility | PASS | Fresh npm-packed shared/core installed 172 packages in a normal consumer. Built core imported; nested patched runtime path, immutable owners, same-tree reset, cross-tree reset/resetTo rejection, stale throw, arm64 addon, and system-only linkage passed. |
| Type-check | PASS | Six of six workspace tasks in the authoritative clean install. |
| Build | PASS | Five of five workspace tasks in the authoritative clean install. |
| Excluded-platform non-touch | PASS | No excluded platform, container, workflow, or non-arm64 native path changed. |
| Diff integrity | PASS | `git diff --check HEAD` returned zero. |
| Independent review | PASS | Final reviewer found no remaining code, native-safety, packaging, evidence, or macOS arm64 scope findings. |

Stock `tree-sitter@0.25.0` retained approximately 1 MiB RSS per repeated 32 KiB parse even after references left scope and forced GC. Its public API has no deterministic tree/cursor disposal. The checksummed patch therefore adds shared idempotent native release, cache invalidation, `Tree.delete()`, `TreeCursor.delete()`, guards for Tree, SyntaxNode, Query, parser old-tree, and cursor operations after deletion, and immutable SyntaxNode/TreeCursor owner identity. The package metadata also includes the generated addon in a bundled tarball.

Second independent review proved that native liveness checks alone were insufficient: public mutable `.tree` properties let stale nodes/cursors substitute a different live tree and crash Bun with SIGSEGV. A follow-up then proved cross-tree `resetTo` could desynchronize an otherwise immutable owner and crash, while cross-tree `reset` returned garbage. Patch v3 makes owner properties non-writable/non-configurable, marshals same-tree reset nodes, and rejects cross-tree reset/resetTo in both JS and native code. The cold child discriminates every path with clean exits and same-tree positive controls.

Bun 1.3.0 `pm pack` was rejected for core distribution because both accepted npm bundle-field spellings produced tarballs without the bundled dependency. Exact Node 22.22.2/npm 10.9.7 preserved the bundle. The core manifest now uses publish-safe `@massa-th0th/shared@1.0.0`; repository installation still resolves the matching local workspace. The local packed-consumer proof redirects only that unpublished shared package to its sibling tarball.

### TASK-002 Post-Gate Adequacy Review

| Done-when criterion | Exact assertion/gate evidence | Spec-defined outcome | Covered? |
| --- | --- | --- | --- |
| Exact runtime/build/package/trust pins | Focused contract freezes Bun 1.3.0, Node 22.22.2, ABI 137, 27 native specs/trust entries, 33 extensions, and exact patch mapping | Consume frozen T1 selections only | Yes |
| Frozen lock exhaustiveness | JSONC parser verifies all 27 resolved identities and npm SRI/Git integrity identities plus the sole patch mapping | Lock and trust set contain every and only audited native artifact | Yes |
| Full Bun descriptor restoration | Serialized success/throw plus forced setup/restoration faults prove queue release and exact descriptor restoration | Compatibility load never leaks mutated global state or deadlocks callers | Yes |
| Source and dist native parsing | Two cold PIDs import real `packages/core/src/index.ts` and built `dist/index.js`, parse all 33 extensions, and link all 27 exact modules | Every required grammar loads through real source and dist consumers | Yes |
| Deterministic native lifetime | Ten cold behavior sensors including immutable owner substitution and cursor transfer, idempotent double delete, explicit-disposal stress, and a no-delete discrimination child | No use-after-free/no-op deletion and bounded native retention | Yes |
| Packed delivery | Tar inventory, normal consumer import, nested module-path assertion, parse/delete, `file`, and `otool -L` | Packed consumers cannot fall through to stock or hoisted runtime code | Yes |
| Frozen clean install/type/build | Deterministic gate rows above | Exact pins install and the workspace compiles/builds | Yes |

Reverse mapping: every assertion maps to T2 done-when, MLTS-001-004/020, and AC-002. The no-delete process, corrupted lock identities, owner/cursor-transfer crash probes, module-path rejection, and removed/incompatible sensors each distinguish a plausible wrong implementation. No spec, fixture, or threshold was weakened. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-003 Execution Result (2026-07-14)

**Result:** PASS. Normalized structural contracts and the exact manifest are frozen for all 33 canonical extensions. Independent review found one divergent edge-field spelling (`parameterIndex`); remediation aligned it to the design and existing graph vocabulary (`paramIndex`) and added a compile-time/runtime fixture assertion.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused exact-runtime tests | PASS | Exact Bun 1.3.0: 6 tests, 451 assertions, zero failures/skips. |
| Manifest exhaustiveness | PASS | Ordered equality with `DEFAULT_ALLOWED_EXTENSIONS`: 33 expected, 33 actual, no missing, extras, or duplicates. |
| Contract coverage | PASS | 18 symbol kinds, 9 edge kinds, UTF-8/end-exclusive `SourceSpan`, typed parse outcomes/diagnostics, all capability fields, and `paramIndex` data-flow metadata. |
| Artifact pins and policies | PASS | Exact TASK-002 grammar versions/selectors, Bun/runtime/ABI/patch identity, C/C++ header handling, Vue HTML host, Markdown policy, and unhashed deterministic fingerprint inputs. |
| Unknown-extension behavior | PASS | `.toml` resolves semantic-only with `unsupported_structural_language`, remains outside required readiness, and does not mutate the manifest. |
| Type-check | PASS | Six of six workspace tasks, uncached forced execution. |
| Build | PASS | Five of five workspace tasks, uncached forced execution. |
| Diff integrity | PASS | `git diff --check` returned zero. |
| Independent review | PASS after remediation | Reviewer accepted manifest, pins, tiers, fallback, task boundary, and macOS arm64 scope after the `paramIndex` correction. |

### TASK-003 Post-Gate Adequacy Review

The equality test fails on any omitted, duplicate, extra, or reordered extension; per-entry assertions fail on wrong packages, versions, selectors, tiers, or capability keys; special-policy assertions distinguish the header/Vue/Markdown decisions; the unknown-extension test distinguishes semantic-only handling from readiness failure or hidden fallback; and the edge fixture prevents reintroduction of dual `paramIndex` vocabulary. These assertions map directly to T3 done-when, MLTS-001/005/007-009/019, and AC-001/004/005. No runtime loader, ETL routing, query pack, platform, or generation behavior was claimed. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-004 Execution Result (2026-07-14)

**Result:** PASS. Production readiness now lazily loads the audited native grammar packages through literal package cases while the Bun marker is serialized and masked, restores the exact descriptor before any parse, validates all 33 manifest entries in one cached flight, and keeps API liveness separate from parser/indexing readiness.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused exact-runtime tests | PASS | Exact Bun 1.3.0: 10 tests, 81 assertions, zero failures/skips. |
| Loader fault and concurrency sensors | PASS | FIFO/non-overlap; exact descriptor restoration after success, sync throw, async rejection, delete/setup fault, and restoration-hook fault; queue remains reusable. |
| Real readiness breadth | PASS | 33/33 manifest entries parsed with full UTF-8 consumption and no error roots; 27 package+selector artifacts loaded once; every validation tree deleted. |
| Readiness negative behavior | PASS | Missing grammar and ABI mismatch produce bounded stable failed readiness; `.toml` remains semantic-only, triggers zero loads, and does not alter the required total. |
| Liveness/startup ordering | PASS | Health response stays `status: ok` with additive parser state; deferred validation proves listen follows ready/failed state recording. |
| Pre-effect indexing guards | PASS | Tool rejects before job creation; ETL and legacy direct index paths reject before queue-map insertion or destructive work. |
| Existing queue regressions | PASS | ETL FIFO and legacy indexing mutex suites: 13 tests, 39 assertions. |
| Durable native verifier | PASS | Source/dist 33+33 parses, 27+27 native modules, 54 Mach-O arm64/system-linkage checks, ten lifecycle sensors, bounded RSS, missing and incompatible sensors. |
| Type-check and build | PASS | Forced uncached type-check 6/6 and build 5/5; built `dist` readiness independently reached 33/33 ready. |
| Independent review | PASS | No findings across loader safety, selectors, readiness, startup/liveness, direct guards, exports, task boundary, or macOS arm64 scope. |

### TASK-004 Post-Gate Adequacy Review

The fault adapters kill value-only restoration, leaked markers, poisoned queues, overlapping loads, and parsing inside the masked callback. The single-flight fixture kills load-only, 27-artifact-as-33, repeated-validation, missing-delete, and premature-ready implementations. Health/startup tests distinguish service liveness from parser readiness. Tool/ETL/legacy guards kill background-only or post-side-effect rejection. The durable verifier confirms the real source/dist artifact set and native linkage. These assertions map directly to T4 done-when, MLTS-002-003/017-019, and AC-002/007. Parser pooling/runtime behavior remains T5; ETL structural routing remains T9. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-005 Execution Result (2026-07-14)

**Result:** PASS. Structural parsing now uses one process-wide bounded FIFO pool in production, keyed by language/dialect, with deterministic capacity/timeout bounds, safe idle retargeting, and idempotent leases. The runtime owns all tracked cursors and trees, preserves recovered structure, returns typed hard failures, and retains exact diagnostic totals while exposing at most ten details.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused exact-runtime tests | PASS | Exact Bun 1.3.0: 21 tests, 212 assertions, zero failures/skips across T4 readiness and T5 pool/runtime suites. |
| Pool bounds and fairness | PASS | Default capacity 4, hard max 32; default acquisition timeout 5,000 ms, hard max 60,000 ms; FIFO ordering, matching reuse, wrong-key retarget, deterministic timeout, idempotent release. |
| Process-wide cap | PASS | Five independent default runtime instances admit exactly four concurrent leases; the fifth proceeds only after a release. |
| Failure recovery | PASS | Factory and retarget `setLanguage` failures reclaim capacity; potentially mutated native slots are evicted before reuse. |
| Runtime outcomes | PASS | Semantic-only bypass, recovered syntax with retained structure, hard grammar/ABI/query/infrastructure outcomes, and absent executor as `structural_query_executor_unavailable`; no empty successful fallback. |
| Native cleanup | PASS | All tracked cursors delete in reverse creation order before tree deletion and lease release, including forced query/cleanup failures; stale node/cursor access throws and double delete is safe. |
| Diagnostic bounding | PASS | Exact `diagnosticCount` survives while exposed details stop at ten. |
| Runtime RSS | PASS | 100 real 32 KiB runtime parses call `Bun.gc(true)` every cycle; cycles 81-100 median remains within 16 MiB of cycles 21-40. |
| Durable native verifier | PASS | Source/dist 33+33 parses, 27+27 native modules, 54 Mach-O arm64 linkage checks, ten lifecycle sensors; patched median delta 475,136 bytes versus no-delete growth 125,075,456 bytes. |
| Type-check and build | PASS | Forced uncached type-check 6/6 and build 5/5; diff integrity clean. |
| Independent review | PASS after remediation | Review found and verified fixes for per-runtime default pools, poisoned retarget slots, and public raw grammar-cache bypass; no remaining findings or scope drift. |

### TASK-005 Post-Gate Adequacy Review

FIFO/capacity tests kill overlapping same-slot use, newcomer queue bypass, wrong-language deadlock, timeout leakage, and per-runtime cap multiplication. Failure sensors kill poisoned parser reuse and silent factory-capacity loss. Runtime tests kill missing-query empty success, cleanup-order inversion, lost diagnostic totals, partial readiness-cache publication, and hard-failure-to-empty conversion. The real native lifetime and no-delete discrimination gates prove the patched binding rather than mocks. These assertions map directly to T5 done-when, MLTS-004/007-009/012/017, and AC-003/004/005/007. Query-pack extraction remains T7 and ETL routing remains T9. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-006 Execution Result (2026-07-14)

**Result:** PASS. One immutable UTF-8 source index now owns byte/point mapping, host-child remapping, snippet round trips, and legacy inclusive-line derivation. The versioned identity codec preserves simple top-level IDs, hashes nested/overloaded canonical signatures with full SHA-256, emits legacy aliases, rejects collisions, and returns deterministic ambiguity candidates.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused exact-runtime tests | PASS | Exact Bun 1.3.0: 25 tests, 79 assertions, zero failures/skips. |
| UTF-8 span goldens | PASS | Frozen 73-byte BOM/tab/accent/emoji/CRLF fixture, LF-only line index, code-point boundary rejection, host-child remap, full-buffer L1-L4 compatibility, and exact snippet bytes. |
| Canonical FQN goldens | PASS | Frozen ordered JSON and full SHA-256 `b738f0516b320c0125823b89b5d2877b20a3190de14eead3929695f63247023e`; explicit nesting/overload modes and NFC/path normalization. |
| Compatibility and failures | PASS | Simple top-level IDs and legacy aliases remain stable; malformed modern suffixes reject; reserved-looking legitimate names receive round-trippable hashed primary IDs; forced digest collision raises typed `fqn_hash_collision`; ambiguity candidates are frozen and deterministically sorted. |
| Type-check and build | PASS | Forced uncached type-check 6/6 and build 5/5; diff integrity clean. |
| Independent review | PASS after remediation | Review found malformed modern-looking suffixes falling through as legacy names and a create/parse conflict for legitimate reserved-looking names; strict rejection plus hashed primary identity fallback now have regression coverage. |
| Excluded-platform non-touch | PASS | No excluded platform, container, workflow, or non-arm64 native path changed. |

### TASK-006 Post-Gate Adequacy Review

The byte fixture kills character-column, CR-only newline, BOM stripping, and inclusive-end implementations. Boundary and child-remap tests kill split-code-point and unchecked-relative-offset behavior. Canonical JSON/hash goldens kill key-order, normalization, shortened-hash, and position-dependent identities. Collision injection, exact-before-alias resolution, idempotent registration, sorted ambiguity candidates, and malformed-suffix tests distinguish silent overwrite, first-definition wins, unstable payloads, and modern-to-legacy masquerading. These assertions map directly to T6 done-when, MLTS-005-007, and AC-004/006. Query extraction, resolver wiring, persistence, and transport remain later tasks. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-007 Execution Result (2026-07-14)

**Result:** PASS. The structural runtime now owns immutable native Query compilation/cache identity, bounded match execution, and hard overflow/compile failures. Declarative TS/JS packs normalize TS, JS, TSX, and JSX declarations, documentation, imports/bindings, type relations, calls, bare-argument flow, HTTP, and event edges into frozen deterministic structures.

| Gate | Result | Evidence |
| --- | --- | --- |
| Focused exact-runtime tests | PASS | Exact Bun 1.3.0: 17 TASK-007 tests, 130 assertions, zero failures/skips. |
| Regression breadth | PASS | Query-pack + T5 runtime: 32/32 with 274 assertions; independent query/runtime/identity rerun: 57/57 with 353 assertions. |
| Native query ownership | PASS | Query cache keys include grammar object, Query constructor, and immutable source; compile successes cache once; match limit 4,096 hard-fails before partial publication; outputs retain no native nodes. |
| TS/JS family breadth | PASS | Native `.ts`, `.js`, `.tsx`, `.jsx` fixtures cover decorators/docs, nesting, overloads, fields/private fields, arrows, constructors, anonymous/default/alias exports, ES/CommonJS/dynamic imports, typed bindings, and recovered syntax. |
| Edge precision | PASS | Qualified/generic extend/implement/type refs, constructor/direct/member calls, bare-identifier-only flow, HTTP/gql/events precedence, declarations/JSX/comments/strings/non-bare negatives, deterministic dedupe, and unresolved targets. |
| Identity continuity | PASS | Deep-frozen arity/typeTokens/direct-token modifiers survive tree deletion; type literals remain intact; private `#` names use reversible `%23`; decorator literals cannot pollute modifiers. |
| Capability enforcement | PASS | Required capabilities emit independently; forbidden/unsupported declarations/imports/relations/calls/flow/specialized edges emit no invented placeholder or downgrade. |
| Type-check and build | PASS | Forced uncached type-check 6/6 and build 5/5; diff integrity clean. |
| Independent review | PASS after remediation | Three review rounds found and verified fixes for lossy signatures/imports/exports, missing TS/JS constructs, relation/event/capability errors, private identity collisions, and AST-unsafe modifiers. |
| Excluded-platform non-touch | PASS | No excluded platform, container, workflow, or non-arm64 native path changed. |

### TASK-007 Post-Gate Adequacy Review

Exact output sets and negative assertions kill capture-presence-only tests, declaration-as-call, specialized-call duplication, non-bare flow, lossy import aliases, private/public field collision, and unsupported-capability placeholders. Native dialect fixtures kill TSX/JSX-only assumptions and cross-grammar node leakage. Compile-cache, overflow, recovered-tree, deep-freeze, and T5 lifetime regressions kill raw grammar exposure, partial success, retained native nodes, and cleanup regressions. Signature probes kill body-dependent hashes, type-literal truncation, comment-inflated arity, decorator-string modifiers, and lost async arrows. These assertions map directly to T7 done-when, MLTS-005/008-009/014, and AC-004/005/008. Resolution remains T8 and ETL parity/removal remains T9. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-008 Execution Result (2026-07-14)

**Result:** PASS. Structural resolution now uses an exact `(dialect, resolverVersion)` registry and one generation-scoped session/FQN registry. The TS/JS family resolver preserves valid modern targets, resolves tightest same-file lexical scope, deterministic imports/re-exports/namespaces/default owners/CommonJS/path aliases, exact exported globals, and unique legacy aliases while retaining frozen T6-ordered ambiguity and stable unresolved outcomes.

| Gate | Result | Evidence |
| --- | --- | --- |
| Exact focused resolver/query/identity | PASS | Exact Bun 1.3.0 passed 76/76 tests with 265 assertions. |
| Runtime regression | PASS | Combined runtime gate passed with native lifetime/RSS behavior unchanged. |
| Native source/dist verification | PASS | `verify:tree-sitter-native` passed darwin-arm64: 33 extensions, 27 native artifacts, source/dist 33+33 parses, behavior sensors, and bounded patched RSS. |
| Forced uncached type-check | PASS | 6/6 packages. |
| Forced uncached build | PASS | 5/5 packages. |
| Diff integrity | PASS | `git diff --check` clean. |
| Independent review | PASS after remediation | Direct probes closed exact-version registration, generation identity/collision, overload inference, named-import basename leakage, dynamic namespaces, re-export/barrel/default forwarding, lexical/private `%23`, type-only gating, TS-first probing, and default-owner member qualification. |
| Excluded-platform non-touch | PASS | No Linux, Docker, container, workflow, or non-arm64 implementation path changed. |

### TASK-008 Post-Gate Adequacy Review

Registry/version and generation-session tests kill fallback ownership, partial duplicate registration, process-global identities, late collisions, and first-overload wins. Import probes kill nested basename leakage, fabricated path targets, JS-before-TS selection, re-exports entering local scope, missing dynamic namespaces, type-only value leakage, barrel-marker capture, and default-owner/top-level confusion. Lexical/private/global/legacy tests kill public leakage, wrong enclosing scope, unqualified nested globals, trusted unknown FQNs, and nondeterministic ambiguity. These assertions map directly to T8 done-when, MLTS-006/008-009/014, and AC-005/008. ETL routing and regex retirement remain exclusively T9. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-009 Execution Result (2026-07-14)

**Result:** PASS. TS/JS/TSX/JSX Parse and Resolve work now routes through the native structural runtime and one generation-scoped resolver session while `smartChunk` remains byte-for-byte characterized. Persisted symbols, references, imports, aliases, ambiguity, and skipped-file seeds use the shared structural contracts; the superseded TS/JS regex typed-edge extractor and tests were removed only after the frozen baseline and approved-difference gate passed.

| Gate | Result | Evidence |
| --- | --- | --- |
| Exact focused ETL/parity gate | PASS | Exact Bun 1.3.0 passed 105/105 tests with 508 assertions. |
| Baseline characterization | PASS | Pre-T9 commit `8bc546a` baseline SHA-256 `fea48ca2470f5163130fb0181d0fb5ce984561ff45464844f56d58678ca16134`; four TS/JS fixtures freeze legacy/native projections and exact `smartChunk` counts/hashes. |
| Approved-difference ledger | PASS | Every symbol/import/edge delta is classified; executable comparison rejects unrecorded removals or mutations and permits only recorded native additions. |
| Native source/dist verification | PASS | `verify:tree-sitter-native` passed darwin-arm64: 33 extensions, 27 native artifacts, source/dist 33+33 parses, behavior sensors, and bounded patched RSS. |
| Forced uncached type-check | PASS | 6/6 packages. |
| Forced uncached build | PASS | 5/5 packages. |
| Aggregate core unit | EXCEPTION | The command remains non-green on pre-existing parser-readiness timing plus environment-dependent PostgreSQL/AutoImprove tests outside the TASK-009 diff. Isolated structural/ETL tests pass; no production or test weakening was used to mask unrelated failures. |
| Diff integrity | PASS | `git diff --check` clean. |
| Independent review | PASS after remediation | Review verified baseline provenance/checksum, executable array/count projections, duplicate persisted-ID rejection, file-scoped aliases, package-boundary resolution, skipped-file seeding, ambiguity preservation, and deleted-extractor parity. |
| Excluded-platform non-touch | PASS | No Linux, Docker, container, workflow, or non-arm64 implementation path changed. |

### TASK-009 Post-Gate Adequacy Review

The executable pre-T9 comparison kills fabricated parity, silent removals, reordered multiplicity, and undocumented semantic changes. Runtime rejection/recovery tests kill empty success, native parsing of skipped files, lost diagnostics, and structure loss; chunk hashes kill semantic-chunk drift. Resolver/load probes kill cross-file alias leakage, package-boundary probing, duplicate seed identities, invented import FQNs, re-export-as-local references, and duplicated query imports. Deleting the legacy extractor only after these gates makes the removal reversible from the frozen baseline. These assertions map directly to T9 done-when, MLTS-012/014, and AC-004/005/008. **Verdict: sufficient, non-shallow, independently accepted PASS with an explicit unrelated aggregate-suite exception.**

## TASK-010 Execution Result (2026-07-14)

**Result:** PASS. One explicit, table-locked PostgreSQL transaction creates graph generations, workspace active/pending/lease state, generation-owned graph rows, parser/FQN/span metadata, composite ownership keys, state uniqueness, and a deterministic active legacy generation for every existing workspace. The transitional repository bridge preserves current T9 operation while every graph read is active-generation scoped.

| Gate | Result | Evidence |
| --- | --- | --- |
| Owned PostgreSQL 17 migration/backfill | PASS | Dedicated native macOS PostgreSQL on `127.0.0.1:5433`; 3/3 tests with 62 assertions. |
| Clean migration chain | PASS | All 15 migrations deployed from empty into a fresh owned database. |
| Backfill integrity | PASS | Populated/empty workspaces, exact row/serial-ID preservation, zero null/orphan ownership, active counts, nullable legacy evidence, modern qualified/hash recovery, and validated reference spans. |
| Concurrency and ownership constraints | PASS | Access-exclusive migration lock, pre/post cardinality sentinels, same-project composite FKs, one active/one pending partial indexes, bounded diagnostics, lease pairs, and workspace/generation deletion sensors. |
| Active isolation and compatibility bridge | PASS | Actual repository probes hide pending files/definitions/references/imports/centrality, use canonical FQN parsing, create new workspace legacy generations atomically, and refresh complete active counts. |
| Numeric span robustness | PASS | String, huge, and fractional legacy span evidence remains null without aborting the migration; valid JS-safe integral spans survive. |
| Migrated ETL PostgreSQL regression | PASS | Fingerprint skip path passed against the fully migrated schema. |
| Prisma validation | PASS with expected warnings | Schema is valid; Prisma warns because it cannot precisely encode PostgreSQL partial-column composite `SET NULL`, which the owned PG gate executes successfully. |
| Forced uncached type-check | PASS | 6/6 packages. |
| Forced uncached build | PASS | 5/5 build tasks. |
| Diff integrity | PASS | `git diff --check` clean. |
| Independent review | PASS after remediation | Two review rounds reproduced and verified fixes for active leakage, cross-project pointers, unsafe test ownership, FQN/span loss, non-atomic bridge/count drift, unsafe numeric casts, and dropped read spans. |
| Excluded-platform non-touch | PASS | No Linux, Docker, container, workflow, or non-arm64 implementation path changed. |

### TASK-010 Post-Gate Adequacy Review

The real predecessor-schema backfill kills empty-workspace omission, row loss, orphan ownership, stale counts, serial-ID changes, fabricated canonical signatures/spans, and unbounded diagnostics. Pending poison rows across all five graph tables kill missing active filters. Composite-pointer and partial-state probes kill cross-project ownership and duplicate active/pending states while deletion probes kill circular-FK mistakes. Actual repository execution kills trigger-only conflict bridges, non-atomic workspace creation, stale aggregate counts, and duplicated FQN parsing. Huge/fractional JSON probes kill cast-driven migration aborts. A full clean migration deploy kills synthetic-fixture schema drift. These assertions map directly to T10 done-when, MLTS-006-007/010-013/017, and AC-006/007/010. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## TASK-011 Execution Result (2026-07-14)

**Result:** PASS. A typed PostgreSQL repository now serializes same-project lifecycle transitions with workspace row locks, binds each attempt to a live database lease plus distinct fingerprint/snapshot identities, recomputes completeness and active counts from owned rows, and performs expected-active CAS activation atomically. Expired takeover and abort delete pending graph rows while retaining failure metadata; superseded cleanup preserves active, pending, explicitly retained, and last-known-good generations.

| Gate | Result | Evidence |
| --- | --- | --- |
| Owned PostgreSQL 17 lifecycle | PASS | Dedicated native macOS arm64 PostgreSQL on `127.0.0.1:5433`; 11/11 tests with 67 assertions. |
| Competing ownership and heartbeat | PASS | Concurrent begin yields one owner and one busy result; successful, wrong-token, tampered-snapshot, and expired lease paths are distinguished. |
| Recovery and retry | PASS | Expired pending rows are removed, failure metadata is retained, and a distinct retry generation with the same structural fingerprint acquires ownership. |
| Completeness and activation | PASS | Missing, hard-failed, recovered, stale-active, full-count recomputation, and expected-active CAS outcomes are deterministic; only one concurrent activation succeeds. |
| Abort and cleanup safety | PASS | Expired abort is mutation-free; live abort removes all five pending graph row families without changing active visibility; cleanup protects last-known-good pointers. |
| Forced uncached type-check | PASS | 6/6 packages. |
| Forced uncached build | PASS | 5/5 build tasks. |
| Diff integrity | PASS | `git diff --check` clean. |
| Independent review | PASS after remediation | Review reproduced and verified expiry-safe abort and last-known-good retention; boundary-aware re-review confirmed snapshot-delta and discovered-file membership enforcement remain explicitly owned by T12/T13. |
| Excluded-platform non-touch | PASS | No Linux, Docker, container, workflow, or non-arm64 implementation path changed. |

### TASK-011 Post-Gate Adequacy Review

The owned database fixture executes the full migration chain and real repository transactions. Competing begin and double-activation probes kill process-local locking and duplicate terminal transitions. Wrong token, tampered immutable identity, expiry, stale-active, and abort races kill lease/CAS bypasses. Count poisoning before activation kills trust in cached aggregates; incomplete fixtures distinguish recovered syntax from hard failures and missing files. Takeover and abort assertions kill empty-metadata cleanup, child-row leakage, and active-visibility loss, while the last-known-good fixture kills dangling cleanup pointers. T12 owns generation-scoped per-file persistence/identity; T13 owns discovered-file snapshot membership and post-snapshot delta reconciliation. These assertions map directly to T11 done-when and MLTS-010-013. **Verdict: sufficient, non-shallow, independently accepted PASS within the frozen task boundary.**

## TASK-012 Execution Result (2026-07-14)

**Result:** PASS. Symbol storage now exposes live lease-bound pending generation writes and one-generation active read/write scopes. Per-file replacement, deletion, and stale fallback are atomic; removed definitions also remove stale inbound edges. Centrality replacement, full graph/diagnostic aggregates, exact-name search, and exact-first modern/legacy FQN resolution all preserve active/pending isolation and deterministic ambiguity.

| Gate | Result | Evidence |
| --- | --- | --- |
| Owned PostgreSQL 17 storage/concurrency | PASS | Dedicated native macOS arm64 PostgreSQL on `127.0.0.1:5433`; 12/12 tests with 38 assertions. |
| Active/pending isolation | PASS | Files, definitions, references, imports, centrality, aggregates, diagnostics, and ambiguity lookup expose only one captured active generation. |
| Lease-bound pending writes | PASS | Project, generation, token, expected active, fingerprint, snapshot, expected file count, and both DB expiries are validated before mutation. |
| File lifecycle | PASS | Atomic replacement/deletion/stale copy removes outgoing and obsolete inbound edges, imports, definitions, file metadata, and centrality without changing active visibility. |
| Activation-race discrimination | PASS | Advisory-trigger barrier proves a centrality batch cannot split across old/new active generations during concurrent activation. |
| FQN compatibility | PASS | Exact modern ID wins; legacy aliases resolve only when unique; ambiguity candidates are active-only and stable; malformed/inconsistent simple or qualified identity metadata is rejected. |
| Forced uncached type-check | PASS | 6/6 packages. |
| Forced uncached build | PASS | 5/5 build tasks. |
| Diff integrity | PASS | `git diff --check` clean. |
| Independent review | PASS after remediation | Review-driven kill tests closed aggregate/batch generation splitting, inbound-edge leakage, and simple/qualified identity corruption. |
| Excluded-platform non-touch | PASS | No Linux, Docker, container, workflow, or non-arm64 implementation path changed. |

### TASK-012 Post-Gate Adequacy Review

Pending poison rows across all graph tables kill missing active filters. Wrong lease identity and expiry probes kill caller-only ownership checks. Repeat replacement, deletion, stale fallback, and cross-file inbound references kill partial cleanup and empty-success behavior. The advisory-trigger activation barrier kills per-row active-pointer resolution. Exact-versus-alias and ordered ambiguity fixtures kill substring lookup, first-match ambiguity loss, and pending leakage; simple and qualified metadata mismatch fixtures kill corrupt persisted identities. Full aggregates use one locked generation. These assertions map directly to T12 done-when, MLTS-006/010-013/017-018, and AC-006/007/010. **Verdict: sufficient, non-shallow, independently accepted PASS.**

## Planned Gate Commands

- `bun run verify:tree-sitter-native`
- `bun run --filter @massa-th0th/core test:unit`
- `bun run type-check`
- `bun run build`
- Owned PostgreSQL focused generation/migration tests with `--max-concurrency 1`
- Owned sequential `02.indexing`, `09.symbol-graph`, and `15.nfr` E2E suites
- Baseline non-touch sensor rejecting feature changes to `Dockerfile`, compose/container packaging, pre-existing workflow files, or non-arm64 native paths
- `bun run bench:parser -- --baseline 5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`
- Independent spec-anchored verification and discrimination sensors

## Historical Artifact Freeze v2 (Superseded)

Committed at `c497a41838b002fde99d57a2ba6fcc81f0b06f10`. Superseded by the user's macOS arm64-only scope override; retained as historical evidence only.

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `5bd97356cd2de163bb60169fbaf80b2e68b6adf36950fcf10fc147c41ce0f619` |
| `spec.md` | `9fde60c0158c7a52c30029ffa60b669320fdb6efe96659e3d66b5fe2e80250ca` |
| `context.md` | `a785cac4cad6ad57cfc96e5743ff04d3b949ff96ee2ad8bd7b4a38bedce2979f` |
| `design.md` | `3862902bec59d181dea7714a1e4a60b76beb1b99debea349b9703da79ae14571` |
| `tasks.md` | `1c1589e30ebf693770d874ae6eaadbecff485aba51beb8a241a0cca60d9fa8f6` |
| `capability-matrix.md` | `7d226de867544e9ea9b0030a9c9f9984ff858d153606cddc33fb88c3343e1a0a` |
| `.specs/project/FEATURES.json` | `8fb0bdb03783a71fe8e47edbe4174ddf7c83445ecb141c0338259204ebc74be9` |
| `.specs/project/STATE.md` | `05cc36fd27a4a35187a65c2af7580e146ffba4365ca6d6a5af0642c2b5f9194a` |
| `.specs/HANDOFF.md` | `60fb06495fcab2e16aadadee36cdd5e634d6ccfebf53b24ca99442126b4581a3` |

## Historical Artifact Freeze v3 (macOS arm64 Scope Baseline)

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `528e01ba925c314e6f0296b2f25bc5abaa9f4a09c85eb73dd795127836b2a2f2` |
| `spec.md` | `8914a74a433e1df9878a606a9cdf647fe463a6c87ac0e33106c9d6a7c85a9aa9` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `45285b90059deeb3e7b9e720b26376048a77a28602086df6fd3e9f42a53e0ea3` |
| `tasks.md` | `81071e4f53101c58a0011355995016691e66af17ddd3facc3584f193e1b82f3f` |
| `capability-matrix.md` | `61f113d7f2cf5b783d769281d011227b0f31aaeeb6a7df53483119e0758751b6` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `ef803e536bfdc7e3ddeeb6dcc4192bdeb356446960bb8700ebb5b919b26a42ac` |
| `.specs/HANDOFF.md` | `dc159a1af7972984d5cce544563df8a32bec96378fd49eb8233e7aeb2664464d` |

`gate-manifest.md` cannot embed its own stable file checksum; record its Git blob ID at each committed freeze.

## TASK-001 Artifact Freeze v4

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `528e01ba925c314e6f0296b2f25bc5abaa9f4a09c85eb73dd795127836b2a2f2` |
| `spec.md` | `8914a74a433e1df9878a606a9cdf647fe463a6c87ac0e33106c9d6a7c85a9aa9` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `eae642248e063a56a24448242ec31cd36c6fcb08d026f90aba041eb35f1f7eff` |
| `tasks.md` | `9a0dd09d6bfecc05db83c44fe914f8900c6f0df18d19cb2bfe534d2cd9842b7a` |
| `capability-matrix.md` | `c3fcbe420f301101fbeda7ebe3f1f85cfce85a2e37a429a51eaf1e80ccf2902c` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `e9da93e8e5b5d04c23da41ac5d6cbbedb393a2a45990634045e523b71ddb4303` |
| `.specs/HANDOFF.md` | `d8877ab5797ffcaabd733f21d4d73218bf53eb09dcb42376868b573bc6b7868f` |

`gate-manifest.md` cannot embed its own stable file checksum; record its Git blob ID at the TASK-001 commit.

## TASK-002 Draft Artifact Freeze v5 (Invalidated by Independent Review)

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `528e01ba925c314e6f0296b2f25bc5abaa9f4a09c85eb73dd795127836b2a2f2` |
| `spec.md` | `8914a74a433e1df9878a606a9cdf647fe463a6c87ac0e33106c9d6a7c85a9aa9` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `eae642248e063a56a24448242ec31cd36c6fcb08d026f90aba041eb35f1f7eff` |
| `tasks.md` | `5a75dea1813c7485d3f99bfa69ed2d2550d7bcdf55fd6b47637022b98e4d022b` |
| `capability-matrix.md` | `c3fcbe420f301101fbeda7ebe3f1f85cfce85a2e37a429a51eaf1e80ccf2902c` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `9ab7d0d4f366313c0dfe3c7457ad854953823962bfe4b8fa70ad17ad49eb9c5c` |
| `.specs/HANDOFF.md` | `deeb72bed6aced95319861f634aff1f9942eb8bd7af69dba9c770b26bd9041dd` |
| `package.json` | `6821fbc4b932109395087f68b4cf04a711b22671ce85bec6bf2a131697a97ec6` |
| `packages/core/package.json` | `127714262b6860af1d3d4181094d9613d071f0d5f0d107e37966b45e8882c649` |
| `bun.lock` | `2f82c52aa8beffbc614e3630aebb947b050f610642d3b07479d85022b4cc41e6` |
| `.node-version` | `4c42fb8d6334c5cdcac68b93f96c581fb83b1f58cda898cff115e5e941ef717d` |
| `scripts/verify-tree-sitter-grammars.ts` | `032a4f3a1dd1baf1dc524faf82e97b2c7dd14a1ca245f4f9e0d69bbeb3c50ade` |
| `scripts/tests/verify-tree-sitter-grammars.test.ts` | `4eb24995e4d7630bc5d0467edf4817a87dad4e44a0028084a003a657af1133ea` |

These draft checksums are retained as failed-review evidence and are not an active freeze. A new freeze and Git blob ID are required after remediation passes.

## TASK-002 Accepted Artifact Freeze v6

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `fc0fa42186326d126455fc85b12177c5f5df238f9aaf878a219baacb562ce42a` |
| `tasks.md` | `8b2649a5d0d78bbc4b2c0577532649ac5a0ad5ce292907b8e80fa7c3ddf520f8` |
| `capability-matrix.md` | `ded3f112b391aa7042e9f8bc957cb016642ea0e8e16a2f2ebe128ad189473e18` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `bdd652146d614d9979d1dd3b3f359391655e6c9c7f4857b3faeb80ca99add648` |
| `.specs/HANDOFF.md` | `c1c605586bb386038576c6c4c54e6cbd2ba4da88667e7b07f3c79e0d388d088c` |
| `package.json` | `fd44c995c3c4fb76e4d269d53628e0845b32f7b597ba6c3368bd8be3f601734c` |
| `packages/core/package.json` | `c13ad6bcd949cc6131ebfc8ff7d0a19ca12c027f640a2b4f98989e8dfeb4ca4f` |
| `bun.lock` | `2d4c28a9db158cfbeeb8c14c839d44922923dde898a6b5368a65c82fe5b1bbcf` |
| `.node-version` | `4c42fb8d6334c5cdcac68b93f96c581fb83b1f58cda898cff115e5e941ef717d` |
| `patches/tree-sitter@0.25.0.patch` | `b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a` |
| `scripts/verify-tree-sitter-grammars.ts` | `fb7310f3c1e87b3e5827aafda38ac5aae7d9a233b5c47a387c42d08796f84ff1` |
| `scripts/tests/verify-tree-sitter-grammars.test.ts` | `dbdb332626ff151a22625ae80edb78811b7fa685c18dd2b680cb583a22701bb3` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-002 commit.

## TASK-003 Accepted Artifact Freeze v7

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `fc0fa42186326d126455fc85b12177c5f5df238f9aaf878a219baacb562ce42a` |
| `tasks.md` | `01463547d5df56d9490ecb3ed79f812986f748117f69c83b7c06e8376cfe5f53` |
| `capability-matrix.md` | `ded3f112b391aa7042e9f8bc957cb016642ea0e8e16a2f2ebe128ad189473e18` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `5391aa74a6965ee38f361625a49cfeba9b4ba61b368e12082a28710c584e9da4` |
| `.specs/HANDOFF.md` | `aaabe0e45b65d7749675a6c28cd156f4f2251b867cbf8d038a7207794a7340f5` |
| `packages/core/src/services/structural/types.ts` | `4d6b1133b9570219714825aed47e10391c7c7dfc46549a87443714ac5ed7e53e` |
| `packages/core/src/services/structural/language-manifest.ts` | `2902b1572ed28f33fb70295f5f8348cebbcfd9cf54cd4c364ac0a4c689e62237` |
| `packages/core/src/__tests__/language-manifest.test.ts` | `49c77e53e71349a1b8939a361356ee909e0ba8df3ce88a89041d032fbfe78503` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-003 commit.

## TASK-004 Accepted Artifact Freeze v8

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `fc0fa42186326d126455fc85b12177c5f5df238f9aaf878a219baacb562ce42a` |
| `tasks.md` | `afef81a41b41e1a620d5639e5ce3e18b6a837e10b257ddbb321b6f186f131b6f` |
| `capability-matrix.md` | `ded3f112b391aa7042e9f8bc957cb016642ea0e8e16a2f2ebe128ad189473e18` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `e832d9546c7cfd21ae1c4a476de8e7da500ef65640a1ac8244968ab42252b21b` |
| `.specs/HANDOFF.md` | `c1b2223998981f0a7ed85db4b26d81a8df1639803a2b53db3e50abf83f60765e` |
| `apps/tools-api/src/index.ts` | `9d63d3cfb5c37abd9df06fc9d886da50c4349a7dcf5e4246c39e55606c01ca22` |
| `apps/tools-api/src/health.ts` | `a9cbfb7912f8586e00a2d11fb767b924b303a95b4ed89257520c437f8568441d` |
| `apps/tools-api/src/__tests__/parser-readiness-health.test.ts` | `4d4238c88027b60aebbb16ad381d772cfe02fdf2e6c4590d6582615b76a3e2fd` |
| `packages/core/src/services/structural/grammar-loaders.ts` | `c1d725ea40c5d1e54968f6143bf19045cbf4e5d77aedfdae13478707abafe006` |
| `packages/core/src/services/structural/parser-readiness.ts` | `8999adee5235fa6f1791227da0ccc85c7923cebcb61af228fcb4f782b6820b99` |
| `packages/core/src/services/etl/pipeline.ts` | `dcb9997b843dc551f8a102c30c026a4f75f34da2d5a2a38d10ccaa192dd158f5` |
| `packages/core/src/services/search/contextual-search-rlm.ts` | `23e563a00452b40c9ded2544047356be6e63daed32bbefae60a2ff4e7dab7306` |
| `packages/core/src/tools/index_project.ts` | `657e4f8a531d52d7a741e9e21c0a2cac9d0d60f4ce0fad6203a0c4e654782ac5` |
| `packages/core/src/services/index.ts` | `f3a2e6656e3578ee25b8a8c26b4f7d148fb7831746655a8ef1aacb0c042bd434` |
| `packages/core/src/__tests__/structural-grammar-readiness.test.ts` | `31fbaca81f72d69d188daba6653822a0b1397e1496ad4d8194be4657eb853128` |
| `packages/core/src/__tests__/indexing-readiness-guard.test.ts` | `6c9a7451b5e7501513748c366fe974a1b631a9a737036310cb450d27bbb2d429` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-004 commit.

## TASK-005 Accepted Artifact Freeze v9

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `7223c97b10140e557fa7c4cc362672830c68fa7f583e9570630b1a6e2e7e1523` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `6eadbaa56d3bc901667fc693355b86b09e34c4e0c3498231c26bd662f73ccd95` |
| `.specs/HANDOFF.md` | `53efbac972ce234026f2d50108f496b986ec82716bdac7fd749ed39bedfd563e` |
| `packages/core/src/services/index.ts` | `d78569eee3a103b3ed7bc5ec09b066edfc962128b2d74c9abf9379cdd7aa62bd` |
| `packages/core/src/services/structural/types.ts` | `202b7cdafb24b27c55a7617423b8f5fd916fc94a864795e2d6854857fb984d0a` |
| `packages/core/src/services/structural/grammar-loaders.ts` | `d943c556350edd5ce94a471d32ca4112466b255aed53e5e6322a92340605f3d2` |
| `packages/core/src/services/structural/parser-readiness.ts` | `0b621cda71e51b3c10ed0f7341fa9f9c14eb7aae9881ab710b35d109a3d656c0` |
| `packages/core/src/services/structural/diagnostics.ts` | `27068e87391b64739ef51b5a1b1b0048c38a2b6aab316e7d0d55242d6f7e35fd` |
| `packages/core/src/services/structural/parser-pool.ts` | `5a7c511026d95decfd8ca904e118a48a0ad46ffef2aabcefd3872f3161d2bbe7` |
| `packages/core/src/services/structural/structural-runtime.ts` | `44d060b5f33d8331941014799f2c2af482ec02586b39ece79604b74cc657a45a` |
| `packages/core/src/__tests__/structural-runtime.test.ts` | `dc3113d72764d0bfd98be632a3d89354056166f01b7b41c7c9d6257a5568927e` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-005 commit.

## TASK-006 Accepted Artifact Freeze v10

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `03b406effaafd2d221f15f708dc27b7c4a035a0f1daf60ad77dbf07130d69968` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `368a8833935c62cb2f5da88fe5b94a137caa66187d4ac25bd517a846673123f0` |
| `.specs/HANDOFF.md` | `3dbea3be0795db0e51891d3fd5498826b8aa15fcd8117b3acc8d48181bfe8679` |
| `packages/core/src/services/index.ts` | `be4cede8e82493b2e2a645cb05e99103af0a9b97b83181971f266c91f842da40` |
| `packages/core/src/services/structural/source-span.ts` | `6ede4301f7ad2a90ca1d9ff848948c9224a18e3bdbf6a285d78ef2858259ab20` |
| `packages/core/src/services/structural/fqn-codec.ts` | `6d99683c8b388e7b4edb5d4d5dd33937777140706fa639a350eda5d0691e2495` |
| `packages/core/src/__tests__/structural-identity.test.ts` | `f0b5929e45cced08cc2dab23575e63b3c56c6b377f22868036967bcad549cffe` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-006 commit.

## TASK-007 Accepted Artifact Freeze v11

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `0bcb714e46ab8e803fa2e50cd01f9596c115c2b7af88987c3d5234b47d374bc3` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `90ebe7bf358a12c8cdb38219dd26d6fb47c31c454e306a03472b3fef461e85e4` |
| `.specs/HANDOFF.md` | `fa74edc5399c21cf5489f8a0440ab6d235cae35f4b710f262ebdfb5f7e2931c3` |
| `packages/core/src/services/index.ts` | `0ddc4593be674cc512dadfeb272a3d4f83aed6c2daf6d6ff0cdea1aa4f864154` |
| `packages/core/src/services/structural/types.ts` | `2a919e91afbb96a8983c4a792a7ffa8e2e7b67139876feae310f4141993b5341` |
| `packages/core/src/services/structural/grammar-loaders.ts` | `3785dd8da7d2e40b45adf84d2e7ddfe08904deb3c03d3da6bd80405785afbee2` |
| `packages/core/src/services/structural/structural-runtime.ts` | `dccc162fabfe6432d284b5c4cfe09b58542132d5b1c46351c88a77ceec7d6206` |
| `packages/core/src/services/structural/query-pack.ts` | `fa2796dbc518e3dc560c12746908c038a65e40ebe824a9ddefbbe04839667251` |
| `packages/core/src/services/structural/query-packs/typescript.ts` | `8190cb39bbcf28d4be64e8fc277c062e6394ccdc86ea8107387379b6f5f087cc` |
| `packages/core/src/__tests__/structural-query-pack.test.ts` | `51a0f0b93d265840aa0c0ac0ab7fc1c32daab1abf9b276d2de54f9ff1e901ee3` |
| `fixtures/structural/typescript-flow.ts` | `031696d122d8e1c431e944e94a4f51e591826fc2df212a2e125ac71927713634` |
| `fixtures/structural/javascript-flow.jsx` | `fe4d01d6fcf985495d45c9ec10e6d62d0ef57c165c7afee4f18f973cab556c6b` |
| `fixtures/structural/typescript-native.ts` | `051d8327e5c58281c1eb7fe4ccce10056c0b51cf7f7e3fc9275dd2072fe42de1` |
| `fixtures/structural/javascript-native.js` | `1120c33cf795c4f89b04acad2efc9ab08dd91dbad211965657013762a3de52ea` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-007 commit.

## TASK-008 Accepted Artifact Freeze v12

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `5666b15447b0a7ad878971b9b7f48fdfc0e366406e756576e73c512c64954fb4` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `851c7662bebb18fe138d1324d6f29d8a945b03e737b016f761359e20d8f5eced` |
| `.specs/project/STATE.md` | `f6550524e6bd3432f64031110aa000e0d4114e00845ae44c0131d47aa2162568` |
| `.specs/HANDOFF.md` | `b4092720175c918f967515047649929f7ff419a8960121257423ab093f10cd1d` |
| `packages/core/src/services/index.ts` | `725a63c84a3b8a70138fb1f42fcfcd04a3a853f50a226fcc473d7b39c85a8b2c` |
| `packages/core/src/services/structural/types.ts` | `eeb2f0613738d5c96248aed24b2e992631a25abf05da29f7a12c4935557842e5` |
| `packages/core/src/services/structural/query-pack.ts` | `18f223565f00730c7c84ae2394e27ea27db3326e7c87904ad078202d572329bf` |
| `packages/core/src/services/structural/resolver.ts` | `291f078b4ae33911d6b1c4f95c2caee6d9d9b37c6e27fde71bd17edfc759085d` |
| `packages/core/src/services/structural/resolvers/typescript.ts` | `2777836f9b86ef08f85c83296875904a758804dd16239484404d0db384c23b72` |
| `packages/core/src/__tests__/structural-query-pack.test.ts` | `68644bb0e40ee3e20ce4682e90c3b3f7e9439ed10ef5efd5fe89dea06614ccbc` |
| `packages/core/src/__tests__/structural-resolver.test.ts` | `aa2786a5491b653be7b683db3d891f630e0902dc44ef1edbece8dd80382d8f12` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-008 commit.

## TASK-009 Accepted Artifact Freeze v13

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `3575039cdeec40e79317fb220dc4f63439ded08bdc02bcf555b944e466f75a5d` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `ts-js-approved-differences.md` | `687a7086a791dbb70f1be1204a5cf177dbdb7ade25c2a8ec01da4b26b4f81277` |
| `.specs/project/FEATURES.json` | `077aca9d9f97926c5fc4a1dea66dcf8b6a3fde3e60ad5068da1292bfd89f23ec` |
| `.specs/project/STATE.md` | `0aacb965becec9bd4b8d7d682e09bb0d0019bfed17dcc04a103e7412f666b1f3` |
| `.specs/HANDOFF.md` | `78272a94be9f11c33e6ff5f6cddc8e98172013429a687d5bc0199ddb2b3354b8` |
| `packages/core/src/__tests__/e2e/fixtures/qwen-profile.json` | `765764b15260f19fd2aa64d29089a49b35056c4fae1d4c87a1aa04f9914b51f5` |
| `packages/core/src/__tests__/parse-long-class.test.ts` | `0933bab49c38560340ec50675e884cc354f23591f812d5797611bde48252ae66` |
| `packages/core/src/__tests__/structural-resolver.test.ts` | `3c887cc526d01df69f95936cb1c8cadc098ab9ccddcb8a355277c5f1d741885a` |
| `packages/core/src/__tests__/fixtures/structural/pre-t9-baseline.json` | `fea48ca2470f5163130fb0181d0fb5ce984561ff45464844f56d58678ca16134` |
| `packages/core/src/__tests__/structural-etl.test.ts` | `ac49250f7598840e51b2a31f6c5badc7565c2f56552860f3565d1b8d2af73ebc` |
| `packages/core/src/data/symbol/symbol-repository-pg.ts` | `c8bde7b0af62bac21a11254f8fc943e20c4a4a8321eccb6513e89b652abf4be8` |
| `packages/core/src/services/etl/stage-context.ts` | `8b9e6c3356a3ce887b9ac8abc342873b0fdf5d38ec983fb647671f60e348ea1f` |
| `packages/core/src/services/etl/stages/load.ts` | `1937d859b37d61cb1c23df93e64ad724063abb470f523a98b61e02c4318f70e1` |
| `packages/core/src/services/etl/stages/parse.ts` | `3e1b9e17aea943729d53d09a0b2280757dd516f1515dc5e8f551ac0557ce2c54` |
| `packages/core/src/services/etl/stages/resolve.ts` | `92a933b4529f70312e7df10f6aeb58901b92e08d8ab7b899afcadd601f42578b` |
| `packages/core/src/services/structural/resolver.ts` | `d2b3f83008c9922dd300a832e43c80f867bfb7206de444462b4eee527487be5d` |
| `packages/core/src/services/structural/resolvers/typescript.ts` | `9e3428c8190b30dbc3f44ec4e9904da3abdc4808c4a228df06660c0f0e75bf84` |
| removed `packages/core/src/services/etl/typed-edges.ts` (pre-T9) | `bafde31e02f6d868483ac40198c64e97d07eef93198b2b5240a421a5f1cf14b9` |
| removed `packages/core/src/__tests__/typed-edges.test.ts` (pre-T9) | `22f22e58a382b8c7788cdf4b8d4ea8d5b2a500253e439006bf3d204c61faaec1` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-009 commit.

## TASK-010 Accepted Artifact Freeze v14

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `148e8fadde442acb983acc1553486c587e34f1bbc7920f5d897382d8cea57055` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `077aca9d9f97926c5fc4a1dea66dcf8b6a3fde3e60ad5068da1292bfd89f23ec` |
| `.specs/project/STATE.md` | `6d02d04565c83322c6c2d25584fd722ec7b0d92da68068b25f2734b127223c01` |
| `.specs/HANDOFF.md` | `96ad4d13cf185f0e905fda17962e681d5e211eae1a7172fe8e1d3bcf92c8444f` |
| `packages/core/prisma/schema.prisma` | `a4646c5f9678490b12abee21c1a440f27f03d03bbe807d841bca98a9f768df94` |
| `packages/core/prisma/migrations/20260714170000_add_graph_generations/migration.sql` | `09f73b22142c91c56c9b67ab652b152703ac86b7ddacc956ea6892da1d40db6f` |
| `packages/core/src/data/symbol/symbol-repository-pg.ts` | `0354e09ef544e3136965339646f383d5c98ca5c894bbff3118fa7e86b7aebd06` |
| `packages/core/src/__tests__/graph-generation-migration.test.ts` | `30ed9aafbe3f7e2dfa1ec96a133c88270d028ad587366f1161299e9c3175832c` |
| `packages/core/src/__tests__/etl-pipeline-pg.test.ts` | `a3d06872d0318cb6984ffd99d4f69b7b9d0bc46d2be25b801ed1d63a10435c46` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-010 commit.

## TASK-011 Accepted Artifact Freeze v15

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `f9798dc99483da5bbca51139cfe04bdfc57c6516b9116dbf267df152a6b3d81e` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `077aca9d9f97926c5fc4a1dea66dcf8b6a3fde3e60ad5068da1292bfd89f23ec` |
| `.specs/project/STATE.md` | `24c4649d09af2bb93b5e04fb7f70e023d9430be1a9d32ca0cc3f0d11268c0505` |
| `.specs/HANDOFF.md` | `71f40e223ef42cdd2f5e94d843f5f35e0dda1d218c16eb04facc10490960eca3` |
| `packages/core/src/index.ts` | `86afbe0bf67d027dcabe5cde3ef4f9c6b43911b3c1ad880bca0031c63fdf2ad6` |
| `packages/core/src/data/graph-generation/graph-generation-contract.ts` | `966de4da348d2e34fcfdab0a8deb1f2ed6b0d7337c6613f33506760ce6eb8e66` |
| `packages/core/src/data/graph-generation/graph-generation-repository-pg.ts` | `a69977ab63ff1a9ae4626a9764e05f0f6ac3088a04c8069329441f3401ebde8f` |
| `packages/core/src/data/graph-generation/graph-generation-repository-factory.ts` | `ee0789a57c3b1a4c0ca1ce34a4feb1c18bbba1bbcef9b5c5cb3f888a7cc7744f` |
| `packages/core/src/data/graph-generation/index.ts` | `7ee5f94dd25676f5dc9b13c461454f7b4cb340216de527ff04263b1f5dcf52f0` |
| `packages/core/src/__tests__/graph-generation-lifecycle-pg.test.ts` | `4f70ae7aeabafbc37fb3915ad62a7554840a76b2a10c66a14008f2af5b04f5c0` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-011 commit.

## TASK-012 Accepted Artifact Freeze v16

| Artifact | SHA-256 |
| --- | --- |
| `plan-multi-language.md` | `02f183d2a23b9f9a2694289cc04c2a4c7614f87ec22918e3b59b7de66add9b10` |
| `spec.md` | `43ed4c1c37ecbcaef52750d263f93410dffcc9372a99ac4a73cd6e7f3a54f50e` |
| `context.md` | `af3339803245375d6a69890cfe49e60902a21d71ba969580f555b20fc460a7a9` |
| `design.md` | `171cdcda9412cc7ede9b523d25fa47fa98de76cdd0b5ea87b84f4551602fea65` |
| `tasks.md` | `c64292a815ebc767016126e1ec3487286a90de9c623822c5e9e282ccf2b5c38e` |
| `capability-matrix.md` | `fe462385096d97ad1fc002d4eafa5b59bcfadf2b1d0457b76d39106338df3b16` |
| `.specs/project/FEATURES.json` | `077aca9d9f97926c5fc4a1dea66dcf8b6a3fde3e60ad5068da1292bfd89f23ec` |
| `.specs/project/STATE.md` | `79578ebe9b5c2f84c28fa409dd3e764bb99fc285de81a526f94cd9ac608f4ff6` |
| `.specs/HANDOFF.md` | `c1bfdcf9ba43686f96ef8eb4b30f9a9e7774e77efc5c9d5965bf9b372998a2ee` |
| `packages/core/src/data/symbol/symbol-repository-pg.ts` | `64bf8b40bb3bc6d08b9c7b70f2ba65312d7460b6bb727252b0210200a29f62e5` |
| `packages/core/src/__tests__/graph-generation-symbol-repository-pg.test.ts` | `f74ab7e31de52080f034a66d88b4f35e5ad457e13ef4b749003bd6477ea4dcaf` |

`gate-manifest.md` cannot embed its own stable checksum; record its Git blob ID at the TASK-012 commit.

## TASK-013 Accepted Gate Evidence v17

- Platform: macOS arm64 only; exact Bun `1.3.0`; dedicated owned PostgreSQL 17 at `127.0.0.1:5433`.
- Exact focused/owned command: `RUN_GRAPH_GENERATION_LIFECYCLE=1 RUN_GRAPH_GENERATION_SYMBOL_REPOSITORY=1 MASSA_TH0TH_DEDICATED=1 GRAPH_GENERATION_TEST_ADMIN_URL='postgresql://test@127.0.0.1:5433/postgres' bunx bun@1.3.0 test --max-concurrency 1 packages/core/src/__tests__/graph-generation-etl-lifecycle.test.ts packages/core/src/__tests__/graph-generation-lifecycle-pg.test.ts packages/core/src/__tests__/graph-generation-symbol-repository-pg.test.ts` — PASS, 38 tests, 147 assertions.
- `bunx bun@1.3.0 run type-check` — PASS, 6/6 packages.
- `bunx bun@1.3.0 run build` — PASS, 5/5 packages.
- `git diff --check` — PASS.
- Scenario map: immutable membership/content snapshot; required unreadable file; recovered syntax; full hard failure retaining active; multi-file incremental stale LKG activation and recovery; deletion; pending invisibility; stale snapshot mutation; interruption with external operation settlement/no post-terminal writes; concurrent owner serialization and stale-active refresh; activation-before-awaited durable terminal UPSERT; terminal UPSERT rejection suppressing completion.
- Independent read-only source review: PASS after remediation.
- Adjudication: MLTS-013 protects structural graph generations only; the existing non-generational semantic vector/keyword lifecycle is intentionally unchanged and was not expanded.

## TASK-014 Accepted Gate Evidence v18

- Platform: macOS arm64 only; exact Bun `1.3.0`; dedicated owned PostgreSQL 17.
- Exact focused/owned command: `RUN_GRAPH_GENERATION_LIFECYCLE=1 RUN_GRAPH_GENERATION_SYMBOL_REPOSITORY=1 MASSA_TH0TH_DEDICATED=1 GRAPH_GENERATION_TEST_ADMIN_URL='postgresql://test@127.0.0.1:5433/postgres' bunx bun@1.3.0 test --max-concurrency 1 packages/core/src/__tests__/graph-generation-etl-lifecycle.test.ts packages/core/src/__tests__/graph-generation-lifecycle-pg.test.ts packages/core/src/__tests__/graph-generation-symbol-repository-pg.test.ts packages/core/src/__tests__/structural-etl.test.ts` — PASS, 50 tests, 249 assertions.
- `bunx bun@1.3.0 run type-check` — PASS, 6/6 packages. `bunx bun@1.3.0 run build` — PASS, 5/5 packages. `git diff --check` — PASS.
- Recovered evidence: exact total 14 with ten persisted details. Incremental LKG hard evidence: two files, exact total 28, hard 2, stale 2, ten original ranged details per file. Active/pending isolation and generation swap plus language aggregation passed.
- Durable evidence: parser totals/status/language summary and activated generation identity round-trip together; pre-migration-compatible NULL summary rows hydrate without a result. Top-level indexing completion preserves the pipeline summary.
- Independent read-only review: PASS after exact hard-failure count/span remediation.
- Scope: structural parser diagnostics and existing semantic lifecycle only; no HTTP/MCP transport exposure (TASK-021).
