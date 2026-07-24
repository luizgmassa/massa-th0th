# Close Maintenance Next Steps Task Manifest

- Design: `.specs/features/close-maintenance-next-steps-2026-07-13/design.md`
- Status: Complete / Verified
- Execution: sequential; at most one subagent active; main orchestrator owns diffs and commits.

## Project Testing Guidelines Scan

Sources: root `AGENTS.md`, `package.json`, `turbo.json`, package manifests, `packages/core/src/__tests__/e2e/COVERAGE.md`, and prior maintenance gate/failure/parity evidence. Bun tests with PostgreSQL/live/global state are sequential or isolated; Turbo test cache remains disabled.

## Test Coverage Matrix

| Requirements | Layer | Coverage expectation | Location |
| --- | --- | --- | --- |
| CMT-01 | Unit + live E2E | Exact session matrix, observable rank/identity change, malicious cross-project buffer | core search/Synapse tests; E2E F24 |
| CMT-02 | Unit + PG integration | Include/exclude/combined, old-window domination, cap exhaustion, one call, cache separation | search controller/RLM/cache PG tests |
| CMT-03 | Unit + transport | Zero-hit success vs required dependency failure; optional stream degradation | search/tool/MCP tests |
| CMT-04 | Unit + full E2E | Fixture validation/hash/dimension, negative needle, unchanged qwen gates, full G10 | E2E fixture/helpers/standard sequence |
| CMT-05 | Dedicated destructive E2E | N1/N3/E25/F88 execute and recover with ownership proofs | destructive harness/suite |
| CMT-06 | Unit + PG E2E/SQL | Wrong-root/profile mismatch, guarded rebuild, direct path sentinels | index/workspace/E2E cleanup tests |

## Gate Check Commands

| Gate | Command family |
| --- | --- |
| Focused | Exact affected Bun test files, sequential where PostgreSQL/live state exists |
| Build/type | `bun run build`; `bun run type-check` |
| Root | Explicit dedicated env, `TURBO_FORCE=true RUN_E2E=` and `bun run test` |
| Destructive | Explicit dedicated env and `bun test --max-concurrency 1` for owned N1/N3/E25/F88 suite |
| G10 | Reprovisioned dedicated PG/API/Ollama, qwen-only sequential standard E2E with cleanup last |

## Ordered Execution

`T1 -> T2 -> T3 -> T4 -> T5 -> T6 -> T7 -> T8`

## Task Breakdown

| Task | Deliverable | Requirements | Depends on | Tests/gate | Commit |
| --- | --- | --- | --- | --- | --- |
| T1 / TASK-001 | Freeze/activate spec, design, tasks, gates, failure ledger, validation, and parity evidence | CMT-01..06 | none | Artifact validation and clean diff review | `docs(spec): define next-step maintenance closure` |
| T2 / TASK-002 ✅ | Apply project-scoped Synapse state to search with invalid/unscoped fallbacks | CMT-01 | T1 | PASS: 82 focused tests, upgraded live F24, type-check 6/6 | `feat(search): apply Synapse state to project search` |
| T3 / TASK-003 ✅ | Bounded include/exclude retrieval and cache identity | CMT-02 | T2 | PASS: 25 focused tests, SQLite/PG cache parity, live F18, type-check 6/6 | `fix(search): prevent filtered search underfill` |
| T4 / TASK-004 ✅ | Surface required retrieval dependency outages | CMT-03 | T3 | PASS: 52 focused zero-hit/outage/optional-stream/tool tests; type-check 6/6 | `fix(search): surface retrieval dependency outages` |
| T5 / TASK-005 ✅ | Record the bounded cold-qwen sample, then add commit-locked qwen E2E fixture and embedding dimension rejection | CMT-04 | T4 | PASS: 10-file cold sample; 28 focused regressions; qwen indexing 19/19, search 36/36, needles .643/.857/.732 twice, graph 9/9, negative sensor 1/1; type-check 6/6 | `test(e2e): make qwen G10 clean-stack deterministic` |
| T6 / TASK-006 ✅ | Canonical shared-index profile and `adsads/` path prevention | CMT-06 | T5 | PASS: identity units 10/10; guarded wrong-root/direct PG path gate 3/3; search 36/36; workspace/symbol 23/23; type-check 6/6 | `fix(e2e): prevent stale shared-index path reuse` |
| T7 / TASK-007 ✅ | Test-owned destructive stack and executable N1/N3/E25/F88 | CMT-05 | T6 | PASS: owned PostgreSQL/Ollama/API recovery 4/4, 73 assertions, 0 skip; type-check 6/6 | `test(e2e): automate dedicated destructive recovery` |
| T8 / TASK-008 ✅ | Full build/type/root/destructive/G10 verification and measured documentation | CMT-01..06 | T7 | TECHNICAL PASS: qwen G10 245/6 explained/0, cleanup last; direct PG sentinels; dedicated teardown; shared PID 9754 unchanged. External `origin/main` push drift is recorded, not repaired | `docs(maintenance): record verified next-step closure` |

## Scope, Co-location, and Parallelism Checks

- Each implementation task includes its tests in the same commit.
- No task is parallel-safe because production and E2E state overlap and the user requires sequential execution.
- Diagram/body dependencies match the single chain above.
- Every CMT requirement maps to at least one task and gate; no test deferral exists.
- MCP/skill decision: `massa-ai`, `coding-guidelines`, and local source/CLI tools are selected. No shared `:3333` MCP/REST retrieval is used beyond `/health` because the user hard boundary overrides optional tool preference.

## Failure Policy

Maximum three fix/reverify iterations per cluster; escalate after two unsuccessful local attempts. New unexplained skips fail. Final-gate regressions reopen their cluster and rerun affected downstream gates.

TODO closure follows measured evidence: four named follow-ups close on CMT-01/02/04/05; the fifth `adsads/` row closes only on CMT-06.

## Artifact Store Evidence

- Active key: `.specs/features/close-maintenance-next-steps-2026-07-13/tasks.md`
- Version: 1
- Checksum: recorded in `gate-manifest.md` after artifact freeze.
