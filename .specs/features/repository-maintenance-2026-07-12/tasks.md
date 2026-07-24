# Repository Maintenance Tasks

No commits are authorized. Tasks remain independently verifiable and receive evidence entries.

| Task | Objective | Dependencies | Status | Gate |
| --- | --- | --- | --- | --- |
| T1 | Freeze baseline, requirements, manifest, isolation | none | Complete | Artifact |
| T2 | Source-backed architecture/performance/gap analysis | T1 | Complete | Evidence review |
| T3 | Assertion-level SQLite/PostgreSQL parity matrix | T2 | Complete (PAR-01–PAR-11 closed) | Evidence-or-zero |
| T4 | Provision isolated PostgreSQL/API/Ollama environment | T1 | Complete | Sentinels |
| T5 | Execute diagnostic manifest and populate ledger | T2-T4 | Complete | All rows classified |
| T6 | Fix failures one cluster at a time | T5 | Complete | Focused gate |
| T7 | Reprovision and rerun full manifest | T6 | Complete with documented G10 cold-qwen timeout | Build gate |
| T8 | Independent validation, handoff, TODO, memory | T7 | Complete | Report + sensor |

## Fix Loop

- Two local fixer attempts before escalation; DB/schema/MCP/cross-package escalates immediately.
- Three fix/reverify iterations maximum per cluster, then `Blocked`.
- Never weaken assertions, delete tests, or introduce skips.

## Gate Levels

- **Artifact:** existence, checksum, registry/state consistency, stale-placeholder scan.
- **Quick:** focused package/test command from `gate-manifest.md`.
- **Full:** affected unit/integration plus standard E2E.
- **Build:** all non-destructive rows on fresh dedicated stack, then root aggregate.

## Coverage Matrix

| Requirement | Evidence |
| --- | --- |
| MNT-01 | Baseline hashes and pre/post sentinels |
| MNT-02 | Analysis with exact source pointers |
| MNT-03 | One result per Gate Manifest row |
| MNT-04 | Assertion-level parity matrix |
| MNT-05 | Failure ledger, focused and full reruns |
| MNT-06 | Validation, state, handoff, TODO, massa-ai memory |
