# FURPS+ Refinement Checklist

Use this reference from `workflows/refinement/furps-refinement.md` when analyzing a PRD and/or ADR against the FURPS+ quality model. One `furps-analyst` sub-agent loads only its assigned dimension section; the main agent loads the full file only when synthesizing or when no dimension split is used.

## Source

FURPS+ — a requirements/quality classification from the Rational Unified Process (RUP). The five core categories are Functionality, Usability, Reliability, Performance, Supportability; the "+" adds Design, Implementation, Interface, and Physical requirements. Source reference: QualidadeBR, "FURPS+", 2008 (https://qualidadebr.wordpress.com/2008/07/10/furps/), derived from RUP / Rational Library / Peter Eeles (IBM Rational).

## Status rubric (every check item)

| Status | Meaning |
|---|---|
| covered | Requirement/decision is explicitly present, source-backed, and unambiguous |
| partial | Present but incomplete, vague, or missing a non-trivial sub-aspect |
| missing | Absent from the document; execution would have to assume or invent it |
| unclear | Present but contradictory, unverifiable, or without an owner |

Every item must record: status, evidence (quote or "absent"), and the output section it feeds (Open Questions / Suggestions / Insights / Risks / DoR-gaps). `missing` and `unclear` always produce at least one `FR-<letter>-<N>` finding; `partial` produces a finding when the gap is non-trivial.

## Dimension: F — Functionality

Functional aspects of the software and compliance with specified requirements.

- **F1 Functional completeness & compliance** — Are all required capabilities and flows present, and do they comply with the specified requirements? covered = every capability listed with acceptance criteria; missing = capabilities referenced but not defined. Feeds: Risks, DoR-gaps.
- **F2 Components** — Are components/services and their responsibilities, boundaries, and contracts defined? covered = decomposition + ownership + contracts; partial = components named without boundaries. Feeds: Suggestions, Insights.
- **F3 Error flows** — Are error states, exception paths, failure handling, and input validation defined per flow? covered = per-flow error taxonomy + user-facing messages; missing = happy-path only. Feeds: Risks, Open Questions.
- **F4 Data integrity & validation** — Validation rules, constraints, idempotency, persistence correctness. Feeds: Risks.
- **F5 Interoperability & contracts** — External API/system contracts, backward/forward compatibility. Feeds: Risks, DoR-gaps.
- **F6 Edge cases & boundaries** — Identified and handled? Feeds: Open Questions, Risks.
- **F7 Security-relevant functional requirements** — authn/authz/access-control flows (cross-ref, not duplicating security-audit). Feeds: Risks.

## Dimension: U — Usability

User-interface quality: error prevention, aesthetics, help/docs, consistency/standards.

- **U1 Error prevention** — Does the design prevent user errors (destructive-action confirmations, validation messages, undo)? Cross-ref F3. Feeds: Suggestions.
- **U2 Aesthetics & design consistency.** Feeds: Suggestions.
- **U3 Help & documentation** — user-facing docs/help planned? Feeds: DoR-gaps.
- **U4 Consistency & standards** — design-system adherence, patterns. Feeds: Suggestions.
- **U5 Accessibility (a11y)** — WCAG, contrast, keyboard, screen-reader. Feeds: Risks, DoR-gaps.
- **U6 Internationalization/localization (i18n/l10n).** Feeds: DoR-gaps.
- **U7 Onboarding & learnability.** Feeds: Suggestions.

## Dimension: R — Reliability

Integrity, compliance, interoperability: failure frequency/severity, recoverability, predictability, accuracy, MTBF.

- **R1 Failure frequency & severity** — assumptions stated? Feeds: Risks.
- **R2 Recoverability** — retry, idempotency, rollback, compensation. Feeds: Risks.
- **R3 Predictability** — determinism, race conditions, ordering. Feeds: Risks.
- **R4 Accuracy & precision** — guarantees stated? Feeds: Open Questions.
- **R5 MTBF / availability / SLO targets.** Feeds: DoR-gaps, Risks.
- **R6 Data-loss prevention** — backups, disaster recovery. Feeds: Risks.
- **R7 Graceful degradation** under partial failure. Feeds: Suggestions.

## Dimension: P — Performance

Response time, memory, CPU, load capacity, availability.

- **P1 Response-time targets / SLOs.** Feeds: DoR-gaps.
- **P2 Memory-consumption bounds.** Feeds: Risks.
- **P3 CPU utilization.** Feeds: Risks.
- **P4 Load capacity / throughput / concurrency.** Feeds: DoR-gaps.
- **P5 Scalability under load** (horizontal/vertical). Feeds: Suggestions.
- **P6 Startup/warm-up, cold-start.** Feeds: Risks.
- **P7 Resource quotas/limits.** Feeds: DoR-gaps.

## Dimension: S — Supportability

Testability, adaptability, maintainability, compatibility, configurability, installability, scalability, localizability.

- **S1 Testability** — strategy, seams, fixtures, coverage targets. Feeds: DoR-gaps.
- **S2 Maintainability** — modularity, coupling, readability, changeability. Feeds: Suggestions, Insights.
- **S3 Adaptability/flexibility/extensibility.** Feeds: Suggestions.
- **S4 Compatibility** (backward/forward, browser/OS/device). Feeds: Risks.
- **S5 Configurability** (feature flags, env config). Feeds: Suggestions.
- **S6 Installability/deployability/operability.** Feeds: DoR-gaps.
- **S7 Observability** — logging, metrics, tracing, alerting, runbooks. Feeds: Risks, DoR-gaps.
- **S8 Localizability** (cross-ref U6). Feeds: DoR-gaps.

## Dimension: X — FURPS+ Extensions

Non-functional requirements beyond the five core ("+").

- **X1 Design requirements/constraints** — languages, frameworks, tools, libraries, process. Feeds: Insights, Risks.
- **X2 Implementation requirements** — mandatory standards, DB integrity policies, resource limits, operating environments. Feeds: Risks, DoR-gaps.
- **X3 Interface requirements** — UI/system interface specs. Feeds: Open Questions.
- **X4 Physical requirements** — hardware, device, network constraints. Feeds: Risks.

## Cross-dimension note

Some concerns span dimensions (e.g., error flows touch F3+R2+U1; components touch F2+S2). A `furps-analyst` may flag a cross-dimension concern in its findings, but must not expand its scope into another dimension. The main agent deduplicates and reconciles cross-dimension concerns during synthesis.
