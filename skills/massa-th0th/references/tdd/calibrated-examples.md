# Calibrated Examples

The values below are starting reference values, not requirements. They are calibration anchors, not mandates. Treat every number as a starting-point reference to be confirmed against the project's own SLOs, load profile, and regulatory scope; override per project and record the override in the TDD. None of these tables restore a prescriptive count schema or a fixed section-count mandate.

Load this reference only when the TDD's conditional concerns (rollback, rollout, latency, compliance) apply and the team needs a concrete starting point. It complements `references/tdd/document-contract.md` (which owns the Conditional Concerns trigger table) by giving example budgets; it does not replace project-verified SLOs or legal obligations.

## Rollback-Trigger Table

Calibration anchors, not mandates. Each row is a starting-point signal that typically warrants a rollback (or the documented forward-recovery equivalent); confirm thresholds against project telemetry before relying on them.

| Signal | Starting reference threshold | Action |
|---|---|---|
| Error-rate spike | error rate exceeds 2x the pre-rollout baseline for 5 consecutive minutes | rollback (or documented forward-recovery) |
| SLO burn | error-budget burn rate > 10x the normal burn rate over the rollout window | rollback (or documented forward-recovery) |
| Data-corruption signal | any confirmed write that violates a documented invariant (lost row, wrong field, orphaned reference) | rollback immediately and preserve forensic state |
| Latency regression | p95 latency exceeds 1.5x the pre-rollout p95 for the affected route | rollback (or documented forward-recovery) |
| Failed dependency | a critical dependency the rollout relies on is confirmed down | rollback (or pause rollout and contain) |

Rollback is not always technically possible; where it is not, the TDD must document forward recovery, containment, restore, or compensating actions instead of falsely promising reversibility (see `references/tdd/document-contract.md`).

## Rollout Percentages Reference

Calibration anchors, not mandates. This is a common starting-point rollout curve with hold windows; pick the curve that matches the project's risk and reversibility, and record the chosen curve plus its stop conditions in the TDD.

| Stage | Starting reference traffic share | Hold window (reference) | Exit signal |
|---|---|---|---|
| Canary | 1% | observe one full business cycle or the project's monitoring window | telemetry within thresholds for the period |
| Early ramp | 10% | hold until stability signals hold | no rollback-trigger threshold hit |
| Mid ramp | 50% | hold until stability signals hold | no rollback-trigger threshold hit |
| General availability | 100% | post-release verification | rollout complete and verified |

Shorter or longer curves are valid when reversibility, blast radius, or regulatory review differ. State the actual curve used; do not copy this reference verbatim into a final document.

## Latency Reference Values

Calibration anchors, not mandates. p50, p95, and p99 are standard percentile definitions; the example budgets are starting points only and must be replaced by project-verified SLOs.

- **p50 (median):** 50% of requests complete at or below this latency. Reference example budget for an interactive API route: 100 ms.
- **p95:** 95% of requests complete at or below this latency. Reference example budget for an interactive API route: 300 ms.
- **p99 (tail):** 99% of requests complete at or below this latency. Reference example budget for an interactive API route: 800 ms.

These example budgets fit a typical interactive user-facing API; batch, streaming, and background work have different profiles. Record the project's actual SLO targets and the measurement methodology (window, load, warm or cold) in the TDD rather than citing these reference numbers as if they were the project's budget.

## Compliance Matrix

Calibration anchors, not mandates, and not legal advice. Verify applicability per project; do not claim compliance from generic controls. Each row names the kind of obligation a regime typically implies; it does not certify any system as compliant. Confirm applicability and specific obligations with the project's legal, security, or privacy owner before relying on any row.

| Regime | Typical obligation kind (verify per project) | Verification note |
|---|---|---|
| GDPR | lawful basis, data-subject rights, data minimization, cross-border transfer controls, breach notification | applicability depends on processing EU residents' personal data; confirm scope with privacy owner |
| PCI-DSS | cardholder-data protection, access control, logging, segmentation, vulnerability management | applicability depends on storing, processing, or transmitting cardholder data; confirm scope with security owner |
| LGPD | legal basis, data-subject rights, purpose limitation, international transfer, DPO accountability | applicability depends on processing Brazil personal data; confirm scope with privacy owner |

This matrix is a starting-point index, not a compliance attestation. Per `references/tdd/document-contract.md`, do not claim compliance from generic controls; identify each applicable obligation as verified, proposed, or unresolved.
