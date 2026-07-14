# AI Engineering Handoff

## Current: Multi-Language Tree-sitter Breadth

Implement `plan-multi-language.md` under workflow session `spec-multi-language`. Canonical feature artifacts live in `.specs/features/multi-language-tree-sitter-breadth/`.

## Approved Contract

- 33 exact default extensions, pinned native grammar artifacts, conditional capability tiers, repository-owned query/resolver packs.
- `smartChunk`, embeddings, ranking, and semantic search remain unchanged.
- Versioned full SHA-256 FQN codec and UTF-8 byte-accurate `SourceSpan`.
- Graph generations include files, definitions, references, imports, centrality, diagnostics, and active counts.
- DB-backed lease, immutable snapshot, completeness, and CAS protect activation; terminal job visibility follows activation synchronously.
- Required-file hard failures block generation; incremental hard failures retain last-known-good rows with stale diagnostics.
- Vue/Markdown embed to two levels; custom out-of-manifest extensions remain semantic-only with explicit unsupported diagnostics.
- TS/JS parser throughput and RSS gates are 25% and 50% against baseline `5d43a96` on the frozen harness.

## Completed This Session

- Loaded required coding stack and AI Engineer persona.
- Recalled memory; exact-session recall was empty. Synapse failed on a current shared-dist export mismatch, so retrieval used stateless search and current source.
- Ran two source investigators and a full pre-mortem Plan Critic. Revised the plan through two rounds; final critic found no critical/high contradiction.
- Created/activated feature spec, context, design, capability matrix, tasks, gate manifest, project state, and this handoff.
- User explicitly permitted sub-agents. Tasks select one sequential worker per Execute phase plus an independent verifier.
- Phase 0 worker ran TASK-001 target discovery and measured macOS 26.5.2 arm64 with Bun 1.3.11. The user subsequently narrowed native implementation scope to macOS arm64 only.
- TASK-001 then passed with exact Bun 1.3.0 after exact Bun 1.2.0 failed. Frozen reinstall, 33/33 parses twice, Mach-O arm64 linkage, missing/incompatible sensors, and provenance evidence are recorded in the feature manifests.
- TASK-002 pinned the exact runtime/build-helper/native dependency/trust set and lockfile. Cold real consumers, queue fault recovery, and exact resolved identities are fixed. Reference-only cleanup was empirically falsified by about 1 MiB RSS retention per repeated parse, so a checksummed binding patch now provides idempotent cursor/tree deletion, post-delete guards, and generated-addon packaging; core bundles the patch for packed consumers.
- Independent reviews found mutable node/cursor owners and cross-tree cursor reset/resetTo could bypass liveness, SIGSEGV, or return garbage. Patch v3 SHA-256 `b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a` binds immutable owners, marshals same-tree reset nodes, rejects cross-tree transfers in JS/native code, and marks owners readonly.
- Authoritative patch v3 gates pass: empty-cache install, 9 focused tests/54 assertions, source/dist 33+33 parses and 27+27 modules, ten behavior guards, RSS below the 16 MiB bound with a roughly 125 MiB no-delete control, type-check 6/6, and build 5/5.
- Fresh npm-packed shared/core installed into a normal consumer; built core resolved the nested patched runtime and passed immutable-owner, same-tree reset, cross-tree rejection, stale throw, and Mach-O arm64/system-only linkage checks.
- Exact Node 22.22.2/npm 10.9.7 packed shared/core. A normal non-workspace Bun 1.3.0 consumer imported built core, resolved the nested patched runtime, parsed/double-deleted, and loaded a system-only Mach-O arm64 addon. Bun's own 1.3.0 pack path was rejected because it omitted the bundle payload.
- TASK-003 added normalized structural contracts plus the ordered exhaustive 33-extension manifest and deterministic fingerprint inputs. Exact Bun 1.3.0 focused tests passed 6/6 with 451 assertions; forced uncached type-check/build passed. Independent review's sole `parameterIndex`/`paramIndex` finding was fixed and accepted.
- TASK-004 added lazy literal native grammar loading, exact serialized Bun-marker restoration, cached 33/33 parser readiness, additive live health status, startup validation-before-listen, and pre-side-effect indexing guards. Focused 10/10, queue regressions 13/13, native verifier, uncached type/build, built-dist readiness, and independent review passed.
- TASK-005 added one process-global FIFO parser pool (capacity 4/max 32; timeout 5s/max 60s), typed runtime outcomes, bounded diagnostics with total counts, and cursor-before-tree lifetime ownership. Focused 21/21, native/RSS, uncached type/build, and independent review passed after fixing cap multiplication, poisoned retarget slots, and raw grammar-cache exposure.
- TASK-006 added byte-accurate immutable UTF-8 source indexing, embedded span remapping, legacy line compatibility, canonical full-SHA structural FQNs, legacy aliases, collision failure, and deterministic ambiguity payloads. Focused 25/25, forced type/build, and independent review passed after closing malformed-modern-suffix masquerading and reserved-name round trips.
- TASK-007 added runtime-owned bounded native Query compilation/execution and declarative TS/JS/TSX/JSX packs with frozen declaration/import/relation/call/flow/HTTP/event output. Exact query tests 17/17 and independent query/runtime/identity review 57/57 passed after three remediation rounds covering typed identity/import material, exports, private names, capability independence, and AST-safe modifiers.

## Blocking Gate

TASK-007 passed native focused/regression/type/build/diff gates and independent review. Query compilation/overflow is hard-failed, no native node escapes tree lifetime, and typed signature/import material is ready for TASK-008 resolution.

## Exact Next Step

Freeze and commit TASK-007, then execute TASK-008 resolver registry and TS/JS resolver. Do not touch excluded platform files.

## Worktree and Safety

- Branch: `main`; baseline `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`.
- `plan-multi-language.md` was supplied untracked and is now an in-scope revised artifact.
- No push attempted.
- TASK-001 through TASK-007 are claimed with recorded gates: native discovery, dependency/verifier/patch, normalized contracts/manifest, readiness/guards, bounded runtime/lifetime, structural span/identity codecs, and declarative TS/JS family query packs. No resolver/ETL integration, graph migration, container build, or final parser benchmark has been claimed.
- Preserve existing SQLite-removal artifacts and follow-up status.
