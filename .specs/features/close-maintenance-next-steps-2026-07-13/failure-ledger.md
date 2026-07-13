# Failure Ledger

| ID | Cluster/gate | Classification | Decisive evidence | Attempts | Status/next |
| --- | --- | --- | --- | ---: | --- |
| E-001 | G01 plan challenge delegation | Orchestration timeout | Read-only critic did not return within its bounded window and was interrupted without writes | 1 | Closed by strict local full Evidence Audit; serious revisions applied before implementation |
| E-002 | TASK-002 analysis delegation | Orchestration timeout | Read-only mapper did not return within its bounded window and was interrupted without writes | 1 | Closed by focused local source reads; no implementation assumption remained unverified |
| E-003 | TASK-002 first unit red run | Environment/setup defect | Command omitted explicit DB/vector env; Bun loaded root `.env` and attempted PG session-store writes, which failed | 1 | Invalid evidence; shared `:3333` was not contacted; all later commands pinned dedicated `:5433/:3334/:11435` and passed |
| E-004 | TASK-002 diagnostic runner | Orchestration timeout | Read-only Test Runner did not return within its bounded window and was interrupted without edits/service control | 1 | Main rerun is measured evidence: focused 82/0/0, F24 1/0 with 35 filtered, type-check 6/6 |
| E-005 | TASK-003 first green run | Implementation defect | `retrievalWindow` was added to logging instead of the cache options; two focused assertions remained red | 1 | Closed by moving the field to the cache identity; final focused gate 25/0/0 |
| E-006 | TASK-003 live F18 | Implementation defect | Pathless graph candidates passed an include whitelist and serialized without `filePath` | 1 | Closed by making an include pattern reject pathless candidates in RLM and controller; regression assertions added |
| E-007 | TASK-003 live F18 | Implementation defect | The RLM's ad-hoc glob conversion made `**/` require a subdirectory, so a direct child under `services/` underfilled | 1 | Closed by using the existing `minimatch` semantics at both search layers; direct-child regression and final live F18 pass |

## Iteration Policy

- Maximum three fix/reverify iterations per failure cluster.
- Escalate after two unsuccessful local attempts.
- Partial logs and prior evidence never close a failure.
- Environment/setup failures remain invalid evidence until a clean rerun.
- Every skip requires an explicit reason; a new unexplained skip fails the gate.
