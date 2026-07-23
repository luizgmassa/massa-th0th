# FURPS+ Refinement Report Contract

Use this reference from `workflows/refinement/furps-refinement.md` before writing the final report. It extends the shared `references/audit-report-io.md` single-lens contract with FURPS-specific sections and the required refinement outputs (open questions, suggestions, insights, risks, DoR coverage gaps).

## Report path

```text
audits/refinement/<YYYY-MM-DD furps-refinement>.md
```

Use the local current date. Create `audits/refinement/` when missing. Same-day same-target collisions use `-2`, `-3`; never silently overwrite a different run.

## Plan Mode save rule

In Plan Mode, do not write the report file. Return the proposed canonical path and the complete report content. In Default mode, write the canonical report.

## Report schema

```md
# FURPS+ Refinement Report

Date: <YYYY-MM-DD>
Workflow: furps-refinement
ProjectId: <projectId>
WorkflowSessionId: <furps-refinement-[entity]>
Target: <PRD/ADR title or id>
Target Focus: <file path, Jira key, Confluence URL, or "pasted text">
Scope: <PRD | ADR | PRD+ADR>
Input Source: <file | text | Jira:<key> | Confluence:<url>>
DoR Source: <file | Jira | Confluence | built-in fallback | none>
Source Evidence Timestamp: <YYYY-MM-DD HH:MM local, or unavailable>
The Fool Validation: <modes run, compact summary, gating decision>

## Executive Summary

<one-paragraph readiness verdict; counts by severity; whether DoR is satisfied>

## The Fool Pre-Validation

<evidence_audit findings + pre_mortem findings; source-confidence gaps; execution-phase failure assumptions; the gating decision (proceed / proceed-with-caveats / paused)>

## Functionality (F)

<per check-item status; FR-F-<N> findings>

## Usability (U)

<… FR-U-<N>>

## Reliability (R)

<… FR-R-<N>>

## Performance (P)

<… FR-P-<N>>

## Supportability (S)

<… FR-S-<N>>

## FURPS+ Extensions (X)

<Design / Implementation / Interface / Physical; FR-X-<N>>

## Open Questions

<numbered unresolved questions for stakeholders>

## Suggestions

<prioritized concrete improvements>

## Insights

<non-obvious learnings or patterns surfaced>

## Risks

<severity-ordered; each with impact and mitigation>

## Definition of Ready — Coverage Gaps

<DoR criteria not satisfied by the document; if no DoR was supplied, state the built-in fallback used and list fallback gaps>

## Ruled-Out Candidates

<plausible concerns disproved by evidence, or "None">

## Scope And Evidence

<inputs inspected, DoR source, commands/searches, skipped checks, residual risk>

## Verification/Test Fidelity Checklist

| Item | Evidence |
|---|---|
| Deterministic sensor | <command, static scan, artifact inspection, or not available with reason> |
| Result | <pass, fail, not run, or not applicable> |
| Coverage target | <FR ID, no-finding claim, check item, or validation asset> |
| Validation assets protected | <tests, specs, fixtures, acceptance criteria, or none> |
| Skipped-check reason | <none or allowed reason> |
| Execution handoff | <verification command/artifact for every actionable finding> |

## Execution Handoff

<ordered actionable FR-* IDs, dependencies, and suggested next workflow (e.g., spec-driven to fill gaps, requirements-audit after implementation, adr/rfc for open decisions)>
```

## Finding fields

Every finding uses the prefix `FR-<letter>-<N>` where `<letter>` is `F|U|R|P|S|X`.

```md
### FR-<letter>-<N>: <short title>

Dimension: F | U | R | P | S | X
Severity: critical | high | medium | low
Confidence: high | medium | low
Check Item: <checklist item ID, e.g. F3>
Status: covered | partial | missing | unclear
Location: <PRD/ADR section or quote, or n/a>
Evidence: <concrete quote or documented absence>
Impact: <risk or cost if unaddressed>
Simplest Fix Direction: <smallest sufficient change>
Verification Suggestion: <deterministic command, test, or artifact check>
```

If a required field is unknown, write `Unknown` and explain the evidence gap. Execution treats unknown required fields as a stop condition unless the user explicitly accepts the risk after revalidation.

## Severity rules

- `critical`: blocks release, causes data loss, breaks auth/privacy, or invalidates core value.
- `high`: missing/contradictory core requirement, major compatibility break, or a gap that will surface as an execution-phase failure.
- `medium`: incomplete edge case, unclear acceptance gap, recoverable mismatch, or missing docs/test around a requirement.
- `low`: minor ambiguity, wording mismatch, low-impact gap, or weakly supported concern.

## Confidence

`high` = source-backed by an explicit quote; `medium` = inferred from context; `low` = plausible but unverified. Low-confidence suspects stay in Scope And Evidence unless the user explicitly asks to investigate.
