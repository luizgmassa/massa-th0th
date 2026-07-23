# TDD Quality And Lifecycle

Load this reference before challenging, finalizing, saving, or updating a TDD.

## Quality Gate

The document is decision-complete only when an implementer can proceed without inventing architecture or contract decisions. Verify:

- The problem, goals, non-goals, scope, and constraints agree with approved product or RFC direction.
- Current-state claims and proposed changes are distinguishable and evidence-backed.
- Component ownership, interactions, data authority, contracts, and failure behavior are explicit where relevant.
- Important choices include rationale, trade-offs, consequences, and compatibility impact.
- Security, privacy, migration, production, integration, performance, and user-facing concerns are included when triggered.
- Risks include detection and concrete mitigation rather than generic warnings.
- Verification maps to goals, contracts, failure modes, and migration invariants.
- Verification includes a test file checklist with `Done`, `Test File`, `Source Set / Location`, `Action`, `Coverage Target`, and `Gate Command` when implementation work is planned.
- Planned tests specify `amplify in existing location: <path> (<sourceSet>)` for existing tests or `create in <sourceSet>: <path>` for new tests, backed by inspected source-set evidence such as `commonTest`, `androidUnitTest`, `unitTest`, or the repository's actual equivalent.
- Implementation phases are ordered by dependency and include gates, rollout, and stop conditions.
- Implementation task tables use the exact columns `Order`, `PR Group`, `Layer`, `PR Size`, `Included Work`, `Dependencies`, `Verification Gate`, and `Jira Key` when implementation work is planned.
- PR groups are independently buildable and testable. Small PRs are preferred, Medium PRs have a dependency or coherence reason, and Large PRs include split, stacked PR, feature-flag, or containment rationale.
- Non-breaking implementation groups are ordered Data, Domain, then Presentation/Navigation, or the TDD explicitly maps those labels to the repository's actual boundaries.
- Jira creation remains delegated to `workflows/ticket.md`; `Jira Key` contains only confirmed keys, `Not requested`, `Unavailable`, or `Pending`.
- UI/UX-affecting symbol changes include a parallel rendering surfaces and mappers checklist, or explicitly state why none apply.
- A `Strings Audit` is present when scoped mappers branch on a type and call `stringResource`, or the TDD records evidence that the audit was not applicable.
- `Decisions Revised During Implementation` is present for living implementation updates.
- `Pre-Merge TDD Fidelity Check` is present and all checkboxes are resolved before merge.
- Unknowns are explicit; no placeholder is presented as a decided fact.
- The document contains no fabricated approvals, estimates, metrics, vendors, or project details.

If a blocking item fails, revise the draft or ask the user. Non-blocking gaps remain visible under Open Questions.

## Challenge Gate

Run the configured Plan Challenge Gate after the draft exists. For the default full TDD gate, prefer pre-mortem mode unless security/adversarial risk calls for red-team or source claims call for evidence audit.

Challenge at least:

- the assumption most likely to invalidate the design
- boundary, ownership, or dependency failures
- data-loss, compatibility, migration, and rollback/forward-recovery risks
- operational detection gaps and untestable success claims
- implementation sequencing that creates an unsafe intermediate state
- PR grouping that hides multiple independent outcomes, creates a Large PR without containment, or relies on fabricated Jira keys
- planned test files that are missing, assigned to unverified source sets, or not reflected in the pre-merge fidelity checklist
- UI/UX parallel rendering surfaces, mapper branches, or string resources that can drift from the production change

Revise valid critical or high findings before presentation. Keep accepted residual risks explicit.

## Lifecycle

Use honest document states:

- **Draft:** design is being developed or has unresolved blocking review.
- **In Review:** decision-complete draft awaits named review or approval.
- **Approved:** use only after explicit human approval is available in the current context or authoritative project records.
- **Superseded:** retain a pointer to the replacement when project convention preserves design history.

When updating an existing TDD:

1. Read the current document and its linked decisions.
2. Identify what evidence or requirement changed.
3. Preserve still-valid constraints and rationale.
4. Add material implementation-time changes to `Decisions Revised During Implementation` instead of rewriting history.
5. Reconcile the test file checklist, source-set actions, parallel rendering surfaces, `Strings Audit`, and `Pre-Merge TDD Fidelity Check`.
6. Update the date and status honestly.
7. Summarize material design changes and newly invalidated assumptions.

Do not silently replace an existing TDD, erase unresolved risks, or rewrite history to make the new design appear previously approved.

## Artifact And Completion

Follow an explicit path or established repository convention. Otherwise use `docs/design/<entity>.md`. Create only directories required for the approved artifact.

Before completion:

1. Check Markdown structure and local links.
2. Validate Mermaid syntax when diagrams are present and tooling exists.
3. Run repository-specific documentation or schema checks when available.
4. Confirm stale statements or placeholders are not presented as final decisions.
5. Persist only durable decisions after recall, deduplication, and scoring.
6. Complete the shared Evidence Gate.

Report the artifact path and status, depth selected, conditional concerns included, challenge revisions, unresolved questions, deterministic checks, memory outcome, and residual risk.
