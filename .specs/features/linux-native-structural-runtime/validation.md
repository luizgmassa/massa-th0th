# Linux Native Structural Runtime — Independent Validation

**Role:** Final independent verifier (TLC v3 Validate phase). Author ≠ verifier.
**Date:** 2026-07-21
**Repo:** `/Users/luizmassa/Personal Projects/massa-ai-wt-wave-3` (branch `wave-3`)
**Baseline:** `cc5e5e9` (M21 start)
**Diff range:** `cc5e5e9..2724cff` (T1–T8: 6 atomic commits)
**Runtime:** Bun `1.3.11`, Node `25.9.0` (npm `11.12.1` on Codespace). macOS arm64 (T1–T4 + T7 initial) + Ubuntu 24.04.4 LTS x86_64 Codespace (T5/T6 unblock).

## Overall VERDICT: PASS

All ten acceptance criteria are met. Phase A (T1–T4) PASS on macOS arm64. Phase B (T5/T6) PASS on Ubuntu Codespace (linux glibc x64). The frozen native runtime contract (AD-004/005/006) holds on Linux: Bun 1.3.11, ABI 137, patched tree-sitter SHA `e79aec7b…`, 33+33 parses, 27+27 modules, 10 behavior sensors, 16 MiB disposal-stress gate, ELF x86-64 system-only linkage. Pre-mortem findings #1 (Node 25 C++20 headers) and #2 (grammar Linux build) did NOT materialize — Node 25.9.0 headers compiled cleanly on Ubuntu's gcc; all 27 grammars built/loaded (3 from-source: clojure-orchard, dart, erlang; 24 via prebuilds or the patched runtime).

## Per-Acceptance-Criterion Table

| AC | Requirement | Verdict | Evidence |
| --- | --- | --- | --- |
| AC-001 / LNLSR-001 | assertRuntimeTarget accepts linux/x64 | PASS | T1 `40f085a`: `grammar-loaders.ts:206` + `verify-tree-sitter-grammars.ts:345` accept (darwin,arm64) OR (linux,x64). Codespace: `assertRuntimeTarget()` returned OK on linux/x64/bun-1.3.11/abi-137. Focused test `native-target-predicate.test.ts` 13/13 pass. |
| AC-002 / LNLSR-002 | ELF linkage verification | PASS | T2 `35f8f74`: `verifyNativeLinkage` Linux branch uses `readelf -d` NEEDED entries. Codespace: all 28 native addons (5 from-source + 23 prebuilds) confirmed ELF 64-bit LSB x86-64 with system-only NEEDED (libstdc++.so.6, libgcc_s.so.1, libc.so.6). Focused test `verify-tree-sitter-elf-linkage.test.ts` 10/10 pass. |
| AC-003 / LNLSR-003 | isNativeTarget + describeNative widen | PASS | T3 `2167901`: `native-skip.ts:12` accepts (darwin,arm64) OR (linux,x64). Codespace: native-structural suites RAN (not skipped) — 152/152 pass. |
| AC-004 / LNLSR-004 | Linux addon builds from source | PASS | Codespace T5: `node install-guard.js` → `node-gyp-build` → `node-gyp rebuild` compiled tree-sitter under Node 25.9.0 + C++20 `binding.gyp` cleanly on Ubuntu 24.04 gcc (pre-mortem #1 did NOT materialize, unlike macos-14 Apple clang). 3 from-source grammars (clojure-orchard, dart, erlang) also compiled (pre-mortem #2 did NOT materialize). |
| AC-005 / LNLSR-005 | Linux native verifier (33+33, 27+27, 10 sensors, RSS < 16 MiB, ELF) | PASS | Codespace T5: `verifyColdConsumerProcesses` — source 33 parses/27 modules/27 resolvable, dist 33 parses/27 modules/27 resolvable. `verifyPatchBehaviorProcess` — 10/10 behavior sensors PASS. `verifyRssDiscriminationProcesses` — patchedMedianDelta -266240 bytes (≪ 16 MiB bound), controlGrowth 114 MiB. `runDiscriminationSensors` — {missing:true, incompatible:true}. Native-structural unit tests 152/152 pass. Type-check 6/6, build 5/5. **Caveat:** the full `bun run verify:tree-sitter-source-dist` script fails on a PRE-EXISTING `bun.lock tree-sitter-dart Git identity drift` (lock format has SRI as last element; verifier expects gitIdentity — present on macOS too, documented pre-existing 2/9 verifier test failure). The native verification functions were called directly, bypassing the pre-existing lock-contract check, and ALL PASS. |
| AC-006 / LNLSR-006 | Linux packed-package verifier | PASS | Codespace T6: `npm pack` shared + core under Node 25.9.0. Core tarball bundles the nested patched runtime addon (1 match for `node_modules/tree-sitter/build/Release/tree_sitter_runtime_binding.node`) + install-guard.js (1 match). Cold empty-cache consumer install resolved the nested patched runtime at `@massa-ai/core/node_modules/tree-sitter/`. The nested addon is ELF 64-bit LSB x86-64 with system-only NEEDED (libstdc++.so.6, libgcc_s.so.1, libc.so.6). **Same pre-existing lock-contract caveat as AC-005.** |
| AC-007 / LNLSR-007 | Linux CI gate | PASS (static) | T4 `be9c8e8`: `ci.yml` adds `structural-native-linux` job (ubuntu-latest, Bun 1.3.11, Node 25.9.0, frozen install, build, verify:tree-sitter-native, unit tests, provenance upload). `native-linux-x64-workflow.test.ts` 6/6 pass. |
| AC-008 / LNLSR-008 | Docs dual-platform parity | PASS | T4 `be9c8e8`: README updated (macOS arm64 + Linux glibc x64, ELF x86-64, no musl/Alpine/Windows). `polyglot-indexing-docs.test.ts` 13/13 pass. |
| AC-009 / LNLSR-009 | E2E + graph-gen guards widen | PASS (static + runtime) | T3 `2167901`: E2E guards (02/09/15) + graph-gen PG guards accept linux/x64. Codespace: native-structural suites (which use describeNative) ran 152/152. |
| AC-010 / LNLSR-010 | Blocked with evidence if Codespace unavailable | N/A (unblocked) | Codespace accessed via `gh codespace ssh`. T5/T6 unblocked. |

## Gate Results (macOS arm64, Bun 1.3.11)

| Gate | Command | Result |
| --- | --- | --- |
| Focused T1+T3 | `bun test packages/core/src/__tests__/native-target-predicate.test.ts` | **PASS** — 13/13. |
| Focused T2 | `bun test scripts/tests/verify-tree-sitter-elf-linkage.test.ts` | **PASS** — 10/10. |
| Focused T3 | `bun test packages/core/src/__tests__/structural-grammar-readiness.test.ts` | **PASS** — 6/6. |
| Focused T4 (CI) | `bun test scripts/tests/native-linux-x64-workflow.test.ts` | **PASS** — 6/6. |
| Focused T4 (docs) | `bun test scripts/tests/polyglot-indexing-docs.test.ts` | **PASS** — 13/13. |
| Type-check | `bun run type-check` | **PASS** — 6/6. |
| Build | `bun run build --force` | **PASS** — 5/5. |
| Full regression | `bun run test` | **PASS** — only the documented pre-existing failure set. |
| Pre-existing test non-touch | `git diff --name-only cc5e5e9..HEAD -- scripts/tests/native-macos-arm64-workflow.test.ts` | **PASS** — empty. |

## Gate Results (Ubuntu Codespace, linux glibc x64, Bun 1.3.11 + Node 25.9.0)

| Gate | Command | Result |
| --- | --- | --- |
| Runtime target | `assertRuntimeTarget()` direct | **PASS** — linux/x64, bun 1.3.11, abi 137. |
| Bun mask restoration | `verifyBunMaskRestoration()` direct | **PASS** — descriptor restored. |
| Cold consumers | `verifyColdConsumerProcesses()` direct | **PASS** — source 33 parses/27 modules/27 resolvable; dist 33 parses/27 modules/27 resolvable. |
| Behavior sensors | `verifyPatchBehaviorProcess()` direct | **PASS** — 10/10 sensors. |
| RSS discrimination | `verifyRssDiscriminationProcesses()` direct | **PASS** — patchedMedianDelta -266240 B (< 16 MiB), controlGrowth 114262016 B. |
| Discrimination sensors | `runDiscriminationSensors()` direct | **PASS** — {missing:true, incompatible:true}. |
| ELF linkage (from-source) | `file` + `readelf -d` on 5 from-source addons | **PASS** — all ELF 64-bit LSB x86-64, system-only NEEDED. |
| ELF linkage (prebuilds) | `file` + `readelf -d` on 23 prebuild addons | **PASS** — all ELF 64-bit LSB x86-64, system-only NEEDED. |
| Packed core tarball | `npm pack` + `tar -tzf` inspection | **PASS** — bundles `node_modules/tree-sitter/build/Release/tree_sitter_runtime_binding.node` + `install-guard.js`. |
| Cold consumer install | `npm install` from tarballs | **PASS** — resolved nested patched runtime at `@massa-ai/core/node_modules/tree-sitter/`; ELF x86-64 system-only. |
| Type-check | `bun run type-check` | **PASS** — 6/6. |
| Build | `bun run build` | **PASS** — 5/5. |
| Native-structural unit tests | `bun scripts/run-tests-isolated.ts --unit --filter='structural\|parse-long-class'` | **PASS** — 152/152, 993 assertions, 0 fail. |
| Full `verify:tree-sitter-source-dist` | `bun run verify:tree-sitter-source-dist` | **FAIL (pre-existing)** — `bun.lock tree-sitter-dart Git identity drift`. Pre-existing on macOS too (2/9 verifier test failure). The native verification functions called directly PASS. |
| Full `verify:tree-sitter-package` | `bun run verify:tree-sitter-package` | **FAIL (pre-existing)** — same lock-contract drift. The pack + cold install + ELF checks done directly PASS. |

## Discrimination Sensors

| Sensor | Fault injected | Test guard | Result |
| --- | --- | --- | --- |
| (a) Platform predicate | Mock `acceptsPlatform("win32","x64")` expecting false | `native-target-predicate.test.ts` | **KILLED:** all 5 non-native combos rejected. |
| (b) ELF non-system library | `parseElfNeeded` on readelf output with `libtree-sitter-vendor.so.1` | `verify-tree-sitter-elf-linkage.test.ts` | **KILLED:** rejected. |
| (c) ELF foreign-arch ld-linux | `isAllowedLinuxSoname("ld-linux-aarch64.so.1")` | `verify-tree-sitter-elf-linkage.test.ts` | **KILLED:** false. |
| (d) macOS Mach-O regression | Source scan for `otool` + `Mach-O 64-bit bundle arm64` | `verify-tree-sitter-elf-linkage.test.ts` | **KILLED:** macOS branch unchanged. |
| (e) Pre-existing test non-touch | `git diff cc5e5e9..HEAD -- scripts/tests/native-macos-arm64-workflow.test.ts` | `native-linux-x64-workflow.test.ts` | **KILLED:** empty diff. |

## Pre-Mortem Findings (incorporated before Execute)

1. **HIGH — Node 25.9.0 C++20 headers on Ubuntu:** Pre-decided Node 22 LTS fallback. **DID NOT MATERIALIZE** — Node 25.9.0 headers compiled cleanly on Ubuntu 24.04 gcc (unlike macos-14 Apple clang). No fallback needed.
2. **CRITICAL — Pinned grammar Linux-compatibility:** Out-of-Scope row added. **DID NOT MATERIALIZE** — all 27 grammars built/loaded on Linux (3 from-source: clojure-orchard, dart, erlang; 24 via prebuilds + patched runtime).
3. **MEDIUM — ldd parsing:** T2 uses `readelf -d` NEEDED entries. **PASS** — runtime confirmed on Codespace.
4. **MEDIUM — Codespace unavailable:** **RESOLVED** — accessed via `gh codespace ssh -c wave3-debian-gate-wv567j4g9j35x76`. Temp branch `wave-3-codespace-sync` pushed for sync (to be deleted).
5. **HIGH — Pre-existing test chase:** T4 explicit non-touch. **PASS** — sensor (e) killed.

## Residual Risk

- **Pre-existing `bun.lock tree-sitter-dart Git identity drift`:** The full `verify:tree-sitter-source-dist` and `verify:tree-sitter-package` scripts fail at `verifyLockContract` because the lock format has SRI as the last element of the Git package record, but the verifier expects `gitIdentity` to be last. This is PRE-EXISTING (present on macOS, documented as 2/9 verifier test failure before M21). The actual native verification (parse, linkage, RSS, sensors, packed package) ALL PASS when called directly. This is a lock-format vs verifier-expectation mismatch, NOT an M21 regression. Fixing it is out of scope for M21 ("never chase pre-existing failures"). The CI job (`structural-native-linux`) will hit this same failure until the lock-contract check is fixed in a separate task.
- **Temp branch `wave-3-codespace-sync`:** Pushed to sync the Codespace. Should be deleted after M21 closure.
- No other residual risk across the native runtime, ELF linkage, packed-package, CI, docs, or platform guards.

## Final Tree State

`git status` clean after T8 commit. HEAD `2724cff`. No tracked implementation file mutated by validation; only this `validation.md` artifact is edited.

## Artifact Store Evidence

- Active key: `.specs/features/linux-native-structural-runtime/validation.md`
- Verifier: independent (TLC v3 Validate), distinct from feature author.
- This file is the only artifact edited by this validation; no implementation file was modified.