# Multi-Language Tree-sitter Breadth Gate Manifest

**Workflow session:** `spec-multi-language`  
**Feature status:** Execute active; TASK-001 PASS on macOS arm64; TASK-002 ready
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
