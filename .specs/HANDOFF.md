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

## Blocking Gate

TASK-002 passed fresh install/focused/native/RSS/type/build/packed-consumer gates and final independent review. Exact Bun 1.3.0 requires a serialized startup loader that restores the complete Bun-version property descriptor before parsing; exact Node 22.22.2 is the native build helper. T4 owns the production loader.

## Exact Next Step

Freeze and commit TASK-002, then execute TASK-003. Do not touch excluded platform files.

## Worktree and Safety

- Branch: `main`; baseline `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`.
- `plan-multi-language.md` was supplied untracked and is now an in-scope revised artifact.
- No push attempted.
- TASK-001 native discovery and TASK-002 dependency/verifier/patch implementation are claimed with recorded gates. No graph migration, container build, or parser benchmark has been claimed.
- Preserve existing SQLite-removal artifacts and follow-up status.
