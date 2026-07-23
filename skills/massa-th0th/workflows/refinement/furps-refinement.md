### FURPS+ Refinement

Use this workflow for findings-only refinement of a Product Requirements Document (PRD) and/or Architecture Decision Record (ADR) against the FURPS+ quality model, before implementation. It runs The Fool as an input-validation pre-pass, then fans out one sub-agent per FURPS+ dimension, and emits a structured refinement report with open questions, suggestions, insights, risks, and Definition-of-Ready coverage gaps.

Do not use this workflow to author a new PRD (use `to-prd` or `spec-driven` Specify), author an ADR (use `adr`), propose change (use `rfc`), audit implementation against requirements (use `requirements-audit`), or audit code/security/architecture. It refines the document itself; it does not edit code.

This workflow is findings-only. Do not edit the PRD/ADR unless the user separately asks.

1. Resolve/reuse `workflowSessionId`: `furps-refinement-[entity]`. Resolve `projectId` per the router. Budget `th0th_recall` (`limit <= 3`, `minImportance >= 0.7`, `types=["critical","decision","pattern"]`) for prior ADRs, accepted decisions, DoR, and refinement patterns.
2. Load shared references:
   - `references/furps/intake.md` before intake and sub-agent dispatch
   - `references/furps/checklist.md` for the per-dimension check items
   - `references/furps/report-contract.md` before writing the report
   - `references/furps/analyst-role.md` before dispatching `furps-analyst`
   - `references/agent-orchestration.md` and `references/context-firewall.md` before dispatch
   - `references/audit-report-io.md` before writing the final report
   - `references/synapse-policy.md` when repeated th0th searches are expected
   - `references/evidence-gate.md` at completion
3. Intake and packet build (main), per `references/furps/intake.md`:
   - Detect source (file / text / Jira / Confluence). Ingest via Atlassian MCP capability discovery (read-only) or file/text fallback.
   - Resolve DoR (explicit / Jira/Confluence / built-in fallback). If none, use the fallback and mark DoR-gaps accordingly.
   - Apply the context-firewall; build the bounded document packet (sections/summaries, DoR, recalled facts).
   - If the source is missing or ambiguous, ask once before proceeding.
4. The Fool pre-validation (sub-agents, one per mode):
   - Load `workflows/the-fool.md`. Treat the PRD/ADR as the challenged thesis (direct challenge; inherit `projectId`/`workflowSessionId`).
   - Dispatch a read-only `plan-critic` sub-agent in `evidence_audit` mode with the document packet, DoR, and recalled facts.
   - Then dispatch a `plan-critic` sub-agent in `pre_mortem` mode, passing the `evidence_audit` summary as input.
   - Collect the compact validation: source-confidence gaps, unsourceable claims, and execution-phase failure assumptions.
   - Gate: if `evidence_audit` surfaces critical gaps that block meaningful FURPS analysis, ask the user whether to proceed-with-caveats or pause for document completion. Otherwise attach the Fool summary to the FURPS packets.
5. FURPS+ dimension analysis (sub-agents, one per dimension, parallel):
   - Dispatch six `furps-analyst` sub-agents: F, U, R, P, S, X (X = FURPS+ Extensions).
   - Each receives its `checklist.md` section, the bounded document packet, the DoR, and the Fool summary.
   - Each returns per check-item status (`covered|partial|missing|unclear`), `FR-<letter>-<N>` findings, and contributions to Open Questions / Suggestions / Insights / Risks / DoR-gaps.
   - Run in parallel; batch if a concurrency cap applies. Each gets its own ephemeral Synapse session only if it performs >=2 searches.
6. Synthesis (main):
   - Collect the six dimension analyses and the Fool summary.
   - Deduplicate, cross-check, and reconcile cross-dimension concerns (e.g., error flows span F3+R2+U1; components span F2+S2).
   - Build the DoR coverage gap list (criteria not satisfied by the document).
   - Assemble the report per `references/furps/report-contract.md`; assign `FR-<letter>-<N>` IDs.
   - Plan Mode save rule: in Plan Mode return the canonical path and full content; in Default mode write `audits/refinement/<YYYY-MM-DD furps-refinement>.md`.
7. Persist only durable knowledge:
   - Do not persist one-off findings.
   - Persist reusable refinement patterns and durable decisions after scoring.
   - Required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:furps-refinement`, `entity:<entity>`, and one `memory:<tier>` tag.
8. Complete the Evidence Gate from `references/evidence-gate.md`. Report deterministic evidence, changed artifacts, memory outcome, and residual risk.

## Graceful Degradation

| Failure | Behavior |
|---|---|
| Atlassian MCP unavailable / no matching capability | Ask for file/text; continue |
| th0th unavailable | Skip recall; use file reads; skip memory write and log it |
| Sub-agent spawning unavailable | Run dimensions sequentially in the main agent; record the skipped-delegation reason |
| DoR not supplied | Use the built-in fallback; mark DoR-gaps explicitly |
| Document too large | context-firewall: section summaries plus pointers to sub-agents |
| Concurrency cap on six FURPS agents | Batch dispatch; preserve order-independence |

## Examples

User asks: "Refine this PRD against FURPS before we start building."

1. `workflowSessionId=furps-refinement-<entity>`.
2. Ingest the PRD file; resolve DoR from a linked Confluence page via Atlassian MCP.
3. Run The Fool (`evidence_audit` then `pre_mortem`); proceed (no critical blocker).
4. Fan out six `furps-analyst` sub-agents (F, U, R, P, S, X) in parallel.
5. Synthesize; write `audits/refinement/<date> furps-refinement.md`; summarize in chat.

User asks: "Run a FURPS+ analysis on ADR-007."

1. `workflowSessionId=furps-refinement-adr-007`.
2. Ingest the ADR from `docs/adr/007-*.md`; no DoR supplied, so use the built-in fallback.
3. Run The Fool; `evidence_audit` flags two unresolved claims, so ask the user whether to proceed with caveats.
4. On proceed, fan out the six dimension sub-agents; synthesize and save the report.

User asks: "Check DoR coverage for this Jira epic and its Confluence ADR."

1. `workflowSessionId=furps-refinement-<epic>`.
2. Ingest the Jira epic plus Confluence ADR via Atlassian MCP; resolve DoR from the project DoR Confluence page.
3. Run The Fool; fan out FURPS dimensions; emphasize the Definition of Ready — Coverage Gaps section.
