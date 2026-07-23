# RFC Quality And Lifecycle

Load this reference before challenging, finalizing, saving, updating, or closing an RFC.

## Quality Gate

Verify every item before finalization:

- Title is clear, action-oriented, and specific.
- Impact is `HIGH`, `MEDIUM`, or `LOW` with justification.
- Background states current state, problem or opportunity, why now, evidence, and cost of inaction.
- Full RACI identifies Driver, Approver or Approvers, Contributors, and Informed parties, using `TBD` only when the user cannot resolve a role.
- Assumptions include owner, confidence, and invalidation trigger.
- Decision criteria were defined before options, include must-haves, and use numeric weights summing to 100.
- At least two credible options are evaluated, with explicit status quo consideration.
- Every option has honest pros, cons, dependencies, reversibility, generated or supplied estimates, financial cost where applicable, and risk.
- Comparison uses the declared criteria rather than isolated sales arguments.
- Recommendation traces directly to criteria, evidence, and trade-offs.
- Action items identify concrete post-decision work.
- Outcome remains a placeholder until an explicit human decision exists.
- Technical, process, product, vendor, or policy concerns are included according to the classified RFC type.

If a blocking item fails, use `AskQuestion`, research the missing evidence, or keep the required field visibly unresolved. Do not silently weaken the document contract.

## Anti-Patterns

### Predetermined Conclusion Disguised As RFC

Reject a proposal where the preferred option receives detailed benefits while alternatives are caricatures. Steelman every credible option, include disconfirming evidence, and state what would change the recommendation.

### Criteria Chosen After Options

Define and weight criteria first. If stakeholder feedback changes criteria or weights, record the revision and reevaluate every option.

### Status Quo Treated As Free

Compare the cost, risk, and opportunity loss of inaction. "Do Nothing" may have low immediate effort and high long-term cost.

### Hidden Assumptions Or False Precision

Expose assumptions with invalidation triggers. Generated estimates must be labeled, use ranges where useful, and state the capacity, pricing, volume, or complexity assumptions behind them.

### Implementation Document Masquerading As RFC

Keep focus on whether and which direction should be selected. Route detailed implementation architecture and delivery planning to TDD after decision.

## Plan Challenge Gate

Run the full configured Plan Challenge Gate after the draft exists. Challenge at least:

- strongest counterargument to the recommendation
- evidence quality and interested-party or vendor bias
- status quo, sunk cost, authority, confirmation, and planning biases
- criteria or weights that favor a predetermined answer
- weak generated estimates or missing cost categories
- assumption most likely to invalidate the recommendation
- reversibility, migration, adoption, security, compliance, and operational failure where relevant

Revise valid critical or high findings without deleting required RFC sections or stakeholder fields.

## Lifecycle

Use the preserved states honestly:

- `NOT STARTED`: initial proposal shell or discovery has not produced a reviewable draft.
- `IN PROGRESS`: reviewable proposal exists, feedback is open, or required decision input remains unresolved.
- `COMPLETE`: an explicit human decision is recorded in Outcome as accepted, rejected, or deferred.

When updating an existing RFC:

1. Read the current RFC and linked decisions.
2. Identify new evidence, feedback, assumptions, criteria, weights, options, or cost changes.
3. Preserve still-valid context and rejected-option rationale.
4. Update Last Updated and status honestly.
5. Record material changes so reviewers can identify what moved.
6. Never overwrite an existing RFC unless the user explicitly requested an update or confirmed replacement.

## Completion And Suggested Next Steps

After generating or updating the RFC, report title, impact, status, included sections, options compared, unresolved fields, and artifact path. Preserve these suggestions when relevant:

- Share with Contributors for feedback and Approvers for decision.
- Set or confirm a decision deadline and review meeting.
- Link or create related Jira or Linear work items.
- Create a follow-up TDD after the direction is approved.
- Publish or update the proposal in Confluence when the user wants shared publication.
- Update status to `IN PROGRESS` when review begins and `COMPLETE` only after the decision is recorded.

Do not claim a Jira/Linear link, Confluence publication, meeting, approval, or decision occurred unless the corresponding action or authoritative evidence exists.

## Deterministic Checks

Before completion:

1. Check Markdown structure, metadata, and local links.
2. Confirm all 7 mandatory sections and relevant recommended sections exist.
3. Confirm numeric criterion weights sum to 100 and each option appears in the comparison.
4. Confirm the Outcome placeholder remains unresolved for open proposals.
5. Run repository-specific documentation checks when available.
6. Persist only the memory tier appropriate to current lifecycle state.
7. Complete the shared Evidence Gate.
