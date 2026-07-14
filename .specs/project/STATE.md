# massa-th0th Spec State

## Current

- projectId: `massa-th0th`
- workflowSessionId: `spec-multi-language`
- workflow: spec-driven
- persona: AI Engineer
- feature: `multi-language-tree-sitter-breadth`
- status: EXECUTE ACTIVE; TASK-001 PASS; TASK-002 READY
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
| AD-001 | proposed; activate after TASK-001/TASK-002 verification | Structural parsing uses pinned native Tree-sitter grammar artifacts plus repository-owned query/resolver packs; no runtime-download or WASM fallback. | `design.md`, native feasibility gate |
| AD-002 | proposed; activate after migration/CAS tests | Graph schema upgrades build generation-scoped structure beside active data and activate through DB lease, immutable snapshot, completeness, and CAS. | `design.md`, full pre-mortem |
| AD-003 | proposed; activate after FQN transport parity | One versioned FQN codec owns modern IDs, legacy aliases, collision failure, and ambiguity payloads across persistence/HTTP/MCP. | `design.md`, full pre-mortem |
| AD-004 | proposed; activate after TASK-004 invariant tests | Exact Bun 1.3.0 loads upstream native packages through one serialized compatibility loader that snapshots, removes, and restores the full `process.versions.bun` descriptor before parsing. Exact Node 22.22.2 is build-only. | TASK-001 native evidence |

## Progress

- Required coding bootstrap, memory recall, persona routing, source investigation, and full Plan Challenge completed.
- Supplied plan revised until the Plan Critic reported no remaining critical/high contradiction.
- Canonical `spec.md`, `context.md`, `design.md`, `tasks.md`, `capability-matrix.md`, and initial `gate-manifest.md` created.
- 23 requirements, 12 acceptance criteria, 26 atomic tasks, seven phases, and independent verifier contract are frozen.
- Current source evidence: 33 allowed extensions; structural extraction supports 8 symbol extensions, 7 import extensions, and 4 typed-edge extensions.
- TASK-001 target discovery measured macOS 26.5.2 arm64 with Bun 1.3.11. The user then narrowed platform scope to macOS arm64 only, reopening the grammar artifact loop. No production file changed yet.
- TASK-001 PASS: exact Bun 1.2.0 was rejected; exact Bun 1.3.0 passed a second frozen clean install, all 33 extension parses twice, 27 loaded native modules with Mach-O arm64/system-only linkage, and missing/incompatible negative sensors.
- Frozen selections include modern pinned Dart and Erlang Git commits, Clojure Orchard, and HTML as the Vue SFC host. No WASM or runtime download was used.

## Blocker

None. TASK-002 must consume the exact T1 runtime/artifact set without version reselection.

## Next Step

Execute TASK-002: pin exact Bun 1.3.0, exact Node 22.22.2 build-helper contract, the 27 selected native artifacts, audited `trustedDependencies`, lockfile, and a deterministic macOS arm64 verifier.

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
