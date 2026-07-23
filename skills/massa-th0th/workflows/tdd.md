### TDD (Technical Design Document)

Use this workflow when the readiness checklist is true: one product direction is selected, a named requirements source exists, and no unresolved API, data, security/privacy, migration, rollout, or public compatibility decision blocks implementation design. Route unresolved proposals or competing directions to `workflows/rfc.md`, isolated finalized architecture decisions to `workflows/adr.md`, and broad requirements-to-delivery work to `workflows/spec-driven.md`.

## Workflow

1. Resolve or reuse `projectId` and `workflowSessionId=tdd-[entity]`.
2. Establish evidence before asking questions:
   - `recall` approved RFCs, ADRs, prior TDD decisions, constraints, rejected approaches, and verification patterns.
   - Load `references/tdd/discovery-and-sizing.md`.
   - Inspect current source, tests, source sets, project instructions, architecture documents, and existing design artifacts. Current source and approved project artifacts override stale memory.
   - For testing plans, find whether each planned test file already exists and which source set owns it before choosing a location such as `commonTest`, `androidUnitTest`, `unitTest`, or the repository's actual equivalent.
   - For UI/UX-affecting method, class, enum, sealed type, mapper, or state changes, enumerate parallel rendering surfaces and mappers that consume the affected symbol.
   - When supplied Figma links, nodes, desktop selections, or screenshots materially affect supported Android, iOS, or KMP Compose Multiplatform UI design, use `workflows/design.md` as optional child context and keep this TDD as the owner of architecture, contracts, rollout, and verification strategy. Screenshots are context-only unless paired with structured Figma evidence.
   - Run a pre-TDD `Strings Audit` when mappers branch on a type and call `stringResource`; record affected string keys/resources, branches, fallback behavior, and surfaces before proposing string changes.
   - Load `references/synapse-policy.md` when two or more related searches are expected and `references/context-firewall.md` before broad or verbose source inspection.
3. Confirm workflow fit with the readiness checklist in `references/tdd/discovery-and-sizing.md` and classify the document as Compact, Standard, or High-Risk from the exact sizing rules there. Do not size by guessed calendar duration.
   - Record a `project_type` intake tag from this taxonomy: `integration`, `feature`, `refactor`, `infrastructure`, `payment`, `auth`, `data`. The `project_type` selects which conditional concerns in `references/tdd/document-contract.md` apply and which calibrated reference values from `references/tdd/calibrated-examples.md` are relevant; it does not mandate section counts or a fixed document shape.
   - Apply the critical-section MANDATORY trigger mapping below. These are workflow-level selectors that point at the Conditional Concerns table in `references/tdd/document-contract.md`; they do not duplicate that table. When a trigger fires, the matching concerns are mandatory, not optional:
     - `payment`, `auth`, PII, or regulated data → Security is mandatory.
     - production or customer-facing rollout → Monitoring and Rollback are mandatory.
     - external or cross-service integration → Dependencies and Security are mandatory.
4. Resolve only material unknowns:
   - Reuse facts already available in source or approved documents.
   - Ask at most three related questions at a time, in the user's language.
   - Distinguish verified facts, evidence-backed inferences, proposed decisions, and unresolved questions.
   - Never invent owners, links, APIs, schemas, vendors, dates, thresholds, estimates, approvals, or project facts to complete a template.
5. Load `references/tdd/document-contract.md`, plus `references/naming-standards.md` when the design names proposed components, modules, states, events, schemas, or fields, and draft the smallest decision-complete TDD for the selected depth.
   - Write in the user's language while preserving established project terminology and technical identifiers.
   - Focus on architecture, ownership boundaries, stable interfaces, data flow, failure behavior, and implementation strategy.
   - Include implementation detail when it defines a contract or removes material ambiguity; exclude production implementation code and incidental framework syntax.
   - For implementation planning, group task rows into independently buildable and testable PR groups using the TDD implementation task table contract. Prefer Small PRs; use Medium PRs only when splitting would break build, tests, UI, or review coherence; treat Large PRs as exceptions requiring split, stacked PR, or feature-flag rationale.
   - Order non-breaking PR groups by layer when applicable: Data first, then Domain, then Presentation/Navigation. If the target project does not use clean layer names, map those labels to the closest repository boundaries and state the mapping.
   - Include a test strategy checklist table. For each planned test file, write `amplify in existing location: <path> (<sourceSet>)` when source inspection finds an existing test, or `create in <sourceSet>: <path>` only when evidence supports the new location.
   - Include a parallel rendering surfaces checklist for UI/UX-affecting changes, covering every discovered rendering surface and mapper that consumes the affected method, class, enum type, state, or model.
   - Include `Decisions Revised During Implementation` and `Pre-Merge TDD Fidelity Check` sections so implementation-time divergences remain visible instead of silently rewriting the original design.
   - Use a diagram only when it communicates interactions or state more clearly than prose. Use `mermaid-studio` when installed and rendering or complex diagram validation is valuable; otherwise use valid inline Mermaid or prose.
6. Choose the artifact path from an explicit user path or an existing project convention. Otherwise default to `docs/design/<entity>.md`.
   - If the target exists, treat the request as an update only when the user explicitly requested one; otherwise ask before overwriting it.
   - When file mutation is unavailable or the user requested plan-only output, present the complete draft and intended path without writing.
7. Run the configured Plan Challenge Gate. TDD plans require the full gate under the default policy; revise valid critical or high findings before finalization.
8. Load `references/tdd/quality-and-lifecycle.md`, validate the document, and resolve blocking gaps. Keep non-blocking unknowns explicit with owners or decision points when known.
9. If the implementation task table is stable and validated, discover whether Atlassian MCP has readable Jira project metadata and issue-creation capability.
   - If Atlassian MCP is unavailable or read-only, leave the table's `Jira Key` values as `Unavailable` and report that ticket creation was skipped.
   - If Atlassian MCP is available, ask whether the user wants to create Jira tickets now. If declined, set `Jira Key` to `Not requested`.
   - If the user accepts, invoke `workflows/ticket.md`; Jira creation remains owned solely by the ticket workflow. Create one standard Jira issue per PR group. Create row-level sub-tasks only when the selected ticket hierarchy requires them.
   - Update `Jira Key` only with confirmed Jira keys returned by the ticket workflow. Use `Pending` for approved-but-uncreated PR groups and never fabricate keys.
10. Save the document as `Draft` or `In Review`. Never mark it `Approved`, invent sign-off, or begin downstream implementation without the required human decision.
11. Persist only durable architecture constraints, accepted trade-offs, rejected approaches, compatibility requirements, and verification recipes through `remember` after recall, deduplication, and scoring. Use `decision` with `memory:semantic` for the architectural blueprint.
12. Complete `references/evidence-gate.md` and report the artifact path, included conditional sections, unresolved questions, Jira creation outcome, memory outcome, and residual risk.

## Failure Handling

- th0th unavailable: continue from current source and project documents; report skipped durable-memory synchronization.
- Synapse unavailable: continue with stateless targeted search.
- Evidence is insufficient: ask the smallest blocking question set or mark the point unresolved; do not fabricate completion.
- Direction is still disputed: stop and route to RFC rather than embedding an unapproved choice in the TDD.
- Existing document conflicts with current source or approved decisions: surface the conflict and request resolution before replacing the authoritative statement.
- Diagram tooling unavailable: use simple validated Mermaid or prose; diagram rendering must not block a complete design.

## Example

User asks: "Create a TDD for moving password reset tokens from the users table into a dedicated store."

1. Recall approved auth decisions and inspect the current token flow, persistence model, tests, and operational constraints.
2. Classify High-Risk because the design affects authentication and sensitive data.
3. Ask only unresolved security, compatibility, or rollout questions that source cannot answer.
4. Draft the core design plus conditional security, data migration, observability, rollout, and rollback sections.
5. Challenge the plan, revise serious findings, validate decision completeness, and save a Draft without fabricated approval.
