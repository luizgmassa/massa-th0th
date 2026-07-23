### RFC (Request for Comments)

Use this workflow when a significant technical, process, product, vendor, tool, or policy decision is still open and stakeholders need a structured proposal before committing to a direction. Route a finalized architecture decision to `workflows/adr.md`, settled implementation design to `workflows/tdd.md`, and broad requirements-through-delivery work to `workflows/spec-driven.md`.

## Workflow

1. Resolve or reuse `projectId` and `workflowSessionId=rfc-[entity]`.
2. Establish evidence before asking questions:
   - `th0th_recall` relevant constraints, existing architecture or process, related proposals, prior attempts, rejected options, stakeholder expectations, and verification patterns.
   - Load `references/rfc/discovery-and-sizing.md`.
   - Inspect current source, project instructions, existing RFC conventions, decision records, tickets, and supplied research. Current source and approved project artifacts override stale memory.
   - When supplied Figma links, nodes, desktop selections, or screenshots materially affect mobile UI options, use `workflows/design.md` as optional child context for visual feasibility only; the RFC still owns option comparison and recommendation. Screenshots are context-only unless paired with structured Figma evidence.
   - Load `references/synapse-policy.md` when two or more related searches are expected and `references/context-firewall.md` before broad or verbose source inspection.
3. Confirm workflow fit, classify the RFC type, and assign the required impact label `HIGH`, `MEDIUM`, or `LOW` using the preserved criteria in the discovery reference.
4. Gather every missing mandatory field interactively in the user's language:
   - Use the provider-specific `AskQuestion` capability and the preserved question schema when available.
   - Ask concise conversational questions when `AskQuestion` is unavailable.
   - Require title, background, full RACI roles, impact, urgency or due date, assumptions with confidence and invalidation triggers, weighted decision criteria, at least two options, and a recommendation.
   - Reuse supplied or discoverable facts; do not ask for information already present.
5. Load `references/rfc/document-contract.md` and draft the RFC in the same language as the user's request.
   - Preserve the 7 mandatory and 4 recommended sections, numeric criterion weights, honest option comparison, generated cost and effort estimates, status quo consideration, action items, and outcome placeholder.
   - Tailor conditional concerns to technical/architecture, process/workflow, product/feature, vendor/tool, or policy/compliance proposals.
   - Mark generated estimates as estimates and state their assumptions when exact project data is unavailable.
6. Choose the artifact path from an explicit user path or established project convention. Otherwise default to `docs/rfc/<entity>.md`.
   - If the target exists, update it only when the user explicitly requested an update; otherwise ask before overwriting.
   - When file mutation is unavailable or the user requested plan-only output, present the complete draft and intended path without writing.
7. Run the full configured Plan Challenge Gate. Preserve all required RFC fields while revising valid critical or high findings, especially one-sided options, unsupported claims, hidden assumptions, status quo bias, weak cost estimates, and criteria chosen to justify a predetermined conclusion.
8. Load `references/rfc/quality-and-lifecycle.md`, validate every required behavior, and resolve blocking gaps. Keep unresolved facts explicit instead of silently removing mandatory fields.
9. Save the proposal with status `NOT STARTED` or `IN PROGRESS`. Set `COMPLETE` and fill the Outcome section only when an explicit human decision or authoritative project record is available.
10. Persist proposal state after recall, deduplication, and scoring:
   - Pending or in-review proposal: scored `conversation` memory with `memory:working`.
   - Explicitly decided outcome, durable rejected options, and accepted constraints: scored `decision` memory with `memory:semantic`.
11. Offer the preserved follow-up actions for stakeholder review, a decision deadline or meeting, Jira/Linear linkage, a downstream TDD, and Confluence publication when relevant.
12. Complete `references/evidence-gate.md` and report the artifact path, status, RFC type, impact, options compared, challenge revisions, unresolved fields, memory outcome, and residual risk.

## Failure Handling

- th0th unavailable: continue from current source and project documents; report skipped durable-memory synchronization.
- Evidence insufficient: use `AskQuestion` or concise conversation questions; do not omit a required field without naming the gap.
- Direction already settled: stop and route to ADR or TDD instead of disguising implementation documentation as an RFC.
- Only one credible option exists: research or elicit another option and compare the status quo; do not produce a one-sided proposal.
- Existing document conflicts with current evidence: surface the conflict and request resolution before replacing the authoritative statement.
- Jira, Linear, or Confluence unavailable: keep the suggested next step, but do not claim publication or linkage occurred.

## Example

User asks: "Draft an RFC comparing self-hosted Kafka, Amazon MSK, and Confluent Cloud. Cost and vendor lock-in matter most."

1. Recall related platform decisions and inspect current messaging usage, operational constraints, and existing RFC conventions.
2. Classify a technical/vendor RFC and assign impact from affected systems and teams.
3. Use `AskQuestion` for missing Driver, Approvers, Contributors, Informed parties, due date, assumptions, and criterion weights.
4. Compare all named options plus the status quo, generate transparent estimates, run the full challenge, and save the document under the project RFC convention.
5. Persist the pending proposal as working memory and offer review, Jira/Linear, TDD, and Confluence follow-ups.
