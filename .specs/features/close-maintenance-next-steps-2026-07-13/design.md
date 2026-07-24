# Close Maintenance Next Steps Design

- Spec: `.specs/features/close-maintenance-next-steps-2026-07-13/spec.md`
- Status: Approved

## Design Summary

Implement the approved plan as six sequential production/test clusters. Reuse existing SearchController, ContextualSearchRLM, SynapseManager/session registry, workspace/index lifecycle, PostgreSQL cache/storage, and E2E helpers. Keep public request/response contracts unchanged.

## Current Codebase Evidence

| Concern | Current source evidence |
| --- | --- |
| Session not wired | `SearchController.searchProject` accepts `sessionId` but calls `ContextualSearchRLM.search` without it; `ContextualSearchRLM` declares the option. |
| Session resolution | `SynapseManager.process` synchronously resolves the registry and can merge buffer results without project filtering. |
| Filter underfill | Controller filters after RLM; RLM streams currently fetch `2N`, then filter and slice. |
| Hidden outage | `ContextualSearchRLM.search` catches the outer retrieval error and returns `[]`. |
| Root reuse | `IndexProjectTool` derives/reuses project IDs without canonical-root identity enforcement. |
| E2E gaps | `16.destructive.test.ts` statically skips N1/N3/E25/F88; standard suites reuse literal `e2e-ai-shared`; `02.indexing` retains 420-second gates. |

## Approach Tradeoffs

| Approach | Verdict | Rationale |
| --- | --- | --- |
| Approved bounded seams | Selected | Surgical changes, fixed retrieval bound, unchanged public contract, deterministic fixture and ownership guards. |
| Push filters into every store | Rejected for this iteration | Wider cross-backend contract change and greater parity risk. |
| Retry/unbounded over-fetch or timeout increase | Rejected | Violates explicit performance and determinism constraints. |

## Component Ownership and Requirements

| Component | Ownership | Requirements |
| --- | --- | --- |
| Search controller/service/Synapse pipeline | Resolve async session, scope/modulate, reapply project/filter/limit, bounded streams, propagate required outages | CMT-01..03 |
| Embedding cache and E2E fixture builder | Dimension check, manifest/hash validation, local sparse clone, negative sensor | CMT-04 |
| Workspace/index identity guard | Canonical root and profile identity, dedicated prefix reset policy, path sentinels | CMT-06 |
| Dedicated stack harness | Spawn/attest/signal/restart/teardown owned PG/Ollama/API; shared sentinel | CMT-05 |
| Evidence/docs | Measured gates, skip ledger, parity rows, validation, state/handoff/TODO/COVERAGE | CMT-01..06 |

## Requirements Traceability

| Requirement | Design seam | Verification seam |
| --- | --- | --- |
| CMT-01 | Controller/session resolver/Synapse post-processing | Session-case matrix and F24 |
| CMT-02 | Bounded per-stream candidate window and final filter/slice | Underfill, cap, single-call, cache, and PG tests |
| CMT-03 | Required retrieval error propagation boundary | Zero-hit versus outage tool/MCP tests |
| CMT-04 | Sparse-clone fixture/profile and cache dimension guard | Manifest/hash tests, negative needle, qwen G10 |
| CMT-05 | Owned process harness and scenario state machine | N1/N3/E25/F88 failure/recovery logs |
| CMT-06 | Canonical root/profile identity and direct path checks | Wrong-root regression and PostgreSQL SQL sentinels |

## Compatibility and Safety

- No public field, response shape, migration, qwen threshold, or timeout change.
- Base search cache remains independent of `sessionId`; final Synapse modulation occurs after base retrieval.
- Project/filter/limit scope is defensively reapplied after modulation.
- Only test-created, ownership-revalidated child processes may receive signals.
- Exact dedicated env variables override Bun root `.env` for every live command.
- Existing project decision remains: PostgreSQL/pgvector is acceptance; no superseding project-level decision is required.

## Verification Design

Each cluster carries co-located unit/integration/E2E tests and its focused gate. G10 uses provider/model/dimension and fixture attestations plus a reversible negative fixture. Destructive verification records ownership before every signal and restores health. Final reviewer is read-only and checks plan, contracts, test strength, isolation, skips, and evidence.

## Risks and Mitigations

| Risk | Mitigation |
| --- | --- |
| Async session registry changes propagate broadly | Add a narrow resolver seam and exact invalid-session matrix before integration. |
| Synapse buffer leaks cross-project hits | Restrict injection by session/workspace and reapply project scope after processing. |
| Bounded window still underfills | Deterministic cap-exhaustion test documents the only permitted underfill. |
| Fixture omits needed E2E source | Explicit manifest contains every indexed/searched/asserted path; negative needle mutation proves sensors discriminate. |
| Wrong process signaled | Refuse occupied ports and revalidate PID/start/executable/command/listener/data directory immediately before signals. |
| Documentation claims partial results | Frozen gate rows require exit/duration/count/backend/model/ownership and explicit skip reasons.
| Developer independently restarts shared `:3333` | Record before/after PID/start/health and report drift; do not treat drift alone as failure or attempt repair. |
| Throughput sample becomes another unbounded cold run | Stop after 10 completed files or 180 active seconds, record both counters, and discard only the owned sample stack. |

## Artifact Store Evidence

- Active key: `.specs/features/close-maintenance-next-steps-2026-07-13/design.md`
- Version: 1
- Checksum: recorded in `gate-manifest.md` after artifact freeze.
