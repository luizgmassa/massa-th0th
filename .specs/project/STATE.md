# massa-th0th Spec State

## Current

- projectId: `massa-th0th`
- workflowSessionId: `spec-multi-language`
- workflow: spec-driven
- persona: AI Engineer
- feature: `multi-language-tree-sitter-breadth`
- status: EXECUTE ACTIVE; TASK-001 PASS; TASK-002 PASS; TASK-003 READY
- branch: `main`
- baseline: `5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03`
- push: not attempted

## Objective

Replace regex structural extraction with pinned native Tree-sitter grammars and versioned query/resolver contracts across all 33 canonical extensions while keeping semantic chunking, embeddings, ranking, and search behavior unchanged.

## Active Constraints

- TASK-001 is a no-fallback feasibility gate on exact Bun/macOS arm64. Every required grammar must install, load, and parse before production implementation.
- Native runtime downloads, WASM fallback, raw CST persistence, compiler/LSP resolution, and semantic-search changes are out of scope.
- Structural generations cover files, definitions, references, imports, centrality, diagnostics, and full counts; DB lease/snapshot/CAS activation must finish before terminal job state.
- Required-file hard failure blocks generation activation; incremental hard failure retains last-known-good active structure with stale diagnostics.
- TS/JS throughput may regress at most 25%; RSS at most 50% against baseline commit `5d43a96` on the frozen corpus/runtime/host.
- One atomic commit per task. Seven sequential phase workers are authorized; independent verification is mandatory.

## Decisions

| ID | Status | Decision | Evidence |
| --- | --- | --- | --- |
| AD-001 | active after TASK-001/TASK-002 verification | Structural parsing uses pinned native Tree-sitter grammar artifacts plus repository-owned query/resolver packs; no runtime-download or WASM fallback. | TASK-001 matrix; TASK-002 frozen dependency/verifier gates |
| AD-002 | proposed; activate after migration/CAS tests | Graph schema upgrades build generation-scoped structure beside active data and activate through DB lease, immutable snapshot, completeness, and CAS. | `design.md`, full pre-mortem |
| AD-003 | proposed; activate after FQN transport parity | One versioned FQN codec owns modern IDs, legacy aliases, collision failure, and ambiguity payloads across persistence/HTTP/MCP. | `design.md`, full pre-mortem |
| AD-004 | proposed; activate after TASK-004 invariant tests | Exact Bun 1.3.0 loads upstream native packages through one serialized compatibility loader that snapshots, removes, and restores the full `process.versions.bun` descriptor before parsing. Exact Node 22.22.2 is build-only. | TASK-001 native evidence |
| AD-005 | active after TASK-002 PASS | The runtime identity combines upstream `tree-sitter@0.25.0` SRI with patch SHA-256 `b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a`, adding idempotent cursor/tree deletion, stale-object guards, immutable JS owner identity, same-tree cursor reset enforcement, and generated-addon packaging. Core bundles the patched dependency for packed consumers. | TASK-002 no-delete control, hardened prototype, independent crash reviews, fresh normal packed consumer, final independent PASS |

## Progress

- Required coding bootstrap, memory recall, persona routing, source investigation, and full Plan Challenge completed.
- Supplied plan revised until the Plan Critic reported no remaining critical/high contradiction.
- Canonical `spec.md`, `context.md`, `design.md`, `tasks.md`, `capability-matrix.md`, and initial `gate-manifest.md` created.
- 23 requirements, 12 acceptance criteria, 26 atomic tasks, seven phases, and independent verifier contract are frozen.
- Current source evidence: 33 allowed extensions; structural extraction supports 8 symbol extensions, 7 import extensions, and 4 typed-edge extensions.
- TASK-001 target discovery measured macOS 26.5.2 arm64 with Bun 1.3.11. The user then narrowed platform scope to macOS arm64 only, reopening the grammar artifact loop. No production file changed yet.
- TASK-001 PASS: exact Bun 1.2.0 was rejected; exact Bun 1.3.0 passed a second frozen clean install, all 33 extension parses twice, 27 loaded native modules with Mach-O arm64/system-only linkage, and missing/incompatible negative sensors.
- Frozen selections include modern pinned Dart and Erlang Git commits, Clojure Orchard, and HTML as the Vue SFC host. No WASM or runtime download was used.
- TASK-002 initially pinned exact Bun 1.3.0, exact Node 22.22.2 build-helper contract, all 27 audited native dependencies/trust entries, and the frozen lockfile. Its first implementation passed fresh install, focused tests, type-check, and build, but independent review rejected the verifier as insufficient.
- TASK-002 remediation closed cold real source/dist consumers, queue release after setup/restoration faults, and exact resolved lock identities/integrities. The reference-only lifetime proposal was then falsified: stock binding parses retained about 1 MiB RSS per repeated 32 KiB parse under forced GC.
- A full native patch red-team rejected a root-only patch for packed consumers and required stale-object guards. The hardened source-and-packaging patch now adds idempotent cursor/tree deletion, live guards across Tree/Node/Query/oldTree/Cursor operations, and generated-addon delivery through core's bundled dependency.
- Independent review found a second critical native path: mutable public node/cursor `.tree` properties allowed a deleted owner to be replaced with a live tree and caused SIGSEGV. Patch v2 binds both owners as non-writable/non-configurable and adds cold substitution sensors.
- A follow-up review found cross-tree cursor reset/resetTo could bypass or desynchronize owner identity. Patch v3 marshals only same-tree reset nodes and rejects cross-tree cursor transfer in JS plus native code; the declaration marks both owners readonly.
- Authoritative patch v3 gates pass: empty-cache 770-package install; 9 focused tests/54 assertions; real cold source/dist 33+33 parses and 27+27 modules; ten behavior sensors; patched 100-cycle median below 1 MiB versus a roughly 125 MiB no-delete control; type-check 6/6; build 5/5.
- Fresh npm-packed shared/core installed into a normal consumer. Built core resolved only the nested runtime; immutable owners, same-tree reset, cross-tree reset/resetTo rejection, stale throw, and system-only Mach-O arm64 linkage passed.
- Exact Node 22.22.2/npm 10.9.7 packed shared/core after Bun 1.3.0 packing was proven to omit bundle payloads. A normal non-workspace Bun consumer imported built core, resolved the nested patched runtime, parsed/double-deleted, and loaded a system-only Mach-O arm64 addon.
- Clean build exposed pre-existing direct `zod` imports in core without a direct declaration; TASK-002 added `zod` as the minimal required dependency.

## Blocker

No blocker at the TASK-002 boundary. T23 still owns the durable all-grammar packed-artifact test introduced by the task plan.

## Next Step

Freeze and commit TASK-002, then execute TASK-003 normalized contracts and exhaustive manifest.

## Previous Feature

`sqlite-removal` remains registry `in_progress` because its documented legacy-fixture follow-up is unresolved; its implementation/validation evidence remains under `.specs/features/sqlite-removal/`. This feature does not alter that status.

### SQLite Removal Final State

- Configuration, installer, core persistence, API/health, CI, docs, and active test/E2E paths were converted to PostgreSQL-only behavior.
- Workspace type-check/build, validator discrimination, bootstrap regression, installer tests, active-reference scan, and diff integrity passed.
- Isolated PostgreSQL 17 + pgvector completed 14 migrations, vector CRUD integration (16/16), CRUD/scheduler restart checks (44), smoke (4/4), CLI (13/13), and destructive E2E (4/4; 79 assertions). Owned `:5433`, `:3334`, and `:11435` resources were removed; shared `:3333` remained healthy.
- Residual follow-up: rerun a legacy migration smoke after its checked Prisma fixture repair, rebuild/re-run the frozen qwen fixture, and capture a concise aggregate root-test result.
- Canonical evidence: `.specs/features/sqlite-removal/validation.md`.

### Historical Plan Spec Capture

- Added 14 feature-named folders for supplied Claude Code plans, each with `spec.md`, `design.md`, `tasks.md`, and `validation.md`.
- Source plans remain machine-local under `/Users/luizmassa/.claude/plans`; each feature design captures commit-backed execution facts and explicit gaps.
- Historical source range: inclusive `c1d37b8120025a69e2de0e5fd054ca8177e205de^..81d33606fb6826e1759a073006b165419d0e3ba4` contains 133 reachable commits. Historical claims are not current-session runtime verification.
