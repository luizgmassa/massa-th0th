# FURPS+ Refinement Intake & Sub-agent Packet Contract

Use this reference from `workflows/refinement/furps-refinement.md` during intake and before dispatching sub-agents. It defines source detection, DoR sourcing, the context-firewall, the bounded document packet, and the sub-agent packet contracts.

## Source-type detection

Detect the input source and resolve it before analysis:

| Signal | Source type | Resolution |
|---|---|---|
| File path or glob | file | Read via file tool; apply context-firewall for large files |
| Pasted text / inline block | text | Use directly; record as "pasted text" |
| Jira issue key (`ABCD-123`) or URL | Jira | Atlassian MCP capability discovery (read-only) |
| Confluence page URL | Confluence | Atlassian MCP capability discovery (read-only) |
| Ambiguous / missing | — | Ask the user once for a concrete source (graceful degradation) |

A run may combine sources (e.g., a Jira PRD epic + a Confluence ADR). Record every source and its timestamp.

## Atlassian MCP (read-only capability discovery)

This workflow only reads from Atlassian; it never creates issues or pages. Reuse the capability-discovery pattern from `references/ticket/atlassian-fix.md`:

1. Inspect currently callable tools.
2. Identify Atlassian MCP operations by capability and schema, not by provider-specific function name. Needed capabilities: Jira issue retrieval and Confluence page retrieval.
3. Preflight availability. If no matching capability exists, fall back to file/text and state the skipped source.

Do not assemble Jira/Confluence REST calls outside the MCP, and do not use the Jira CLI or browser automation as a fallback. If the MCP is absent, ask the user for the content as file/text.

## Definition of Ready (DoR) sourcing

DoR is optional context used to grade coverage. Resolve in order:

1. DoR supplied explicitly in the input (file/text/inline).
2. DoR referenced in Jira/Confluence (e.g., a DoR field or linked Confluence page) via Atlassian MCP.
3. Built-in fallback DoR (below).

If no DoR is available, use the built-in fallback and mark every DoR-gap finding with "no DoR supplied — fallback used". Never imply a DoR was applied when it was not.

### Built-in fallback DoR

- Clear problem statement and business value
- Acceptance criteria (testable, unambiguous)
- Scope boundaries and explicit out-of-scope
- Identified dependencies and assumptions
- Non-functional requirements (performance/reliability/security/usability) stated
- Success metrics / measurable outcomes
- Priority and ownership assigned
- Open questions and risks documented

## Context-firewall

Before dispatching sub-agents, bound the document:

- Carry section summaries plus pointers, not full raw text, when the document exceeds context-firewall thresholds.
- Each sub-agent receives only its dimension's checklist section plus the relevant document sections plus DoR plus the Fool summary.
- Sub-agents must summarize verbose content and return evidence/findings only, never raw dumps.

## Bounded document packet

The main agent builds one packet reused across sub-agents:

- `projectId`, parent `workflowSessionId`
- document sections (or summaries) with stable section IDs for citations
- DoR criteria (resolved source)
- recalled facts (budgeted `recall`): prior ADRs, accepted decisions, patterns
- input source plus evidence timestamp
- exclusions: out-of-scope dimensions and sibling-workflow targets

## Sub-agent packet contracts

### plan-critic (The Fool) — evidence_audit

- role: `plan-critic`; mode: `evidence_audit`
- purpose: grade whether the PRD/ADR claims are source-backed, complete, falsifiable
- scope: the document as the challenged thesis
- permissions: read-only
- inputs: document packet, DoR, recalled facts
- sensors: source-location proof for each claim; absent-claim detection
- output: Fool critique contract (mode, steelmanned thesis, 3-5 challenges, severity, affected section, evidence gap, required revision, confidence impact, next step)
- firewall: summarize the document; no raw dumps
- memory: suggest only

### plan-critic (The Fool) — pre_mortem

- role: `plan-critic`; mode: `pre_mortem`
- purpose: anticipate execution-phase failures of the proposed solution
- inputs: document packet, DoR, recalled facts, AND the evidence_audit summary
- output: Fool critique contract, focused on failure narratives
- otherwise identical to evidence_audit

Dispatch `pre_mortem` after `evidence_audit` returns, so it can build on identified gaps.

### furps-analyst — one per dimension (F, U, R, P, S, X)

- role: `furps-analyst`; dimension: `<letter>`
- purpose: analyze one FURPS+ dimension against its checklist section
- scope: the assigned dimension's check items only
- permissions: read-only
- inputs: document packet, DoR, the Fool summary, the dimension's `checklist.md` section
- sensors: quote/section citation per check item; absent-claim detection
- output: per check-item status (`covered|partial|missing|unclear`) plus `FR-<letter>-<N>` findings plus contributions to Open Questions / Suggestions / Insights / Risks / DoR-gaps
- firewall: summarize the document; no raw dumps
- memory: suggest only
- parallelism: all six dispatch in parallel; batch if a concurrency cap applies
