# RFC Document Contract

Load this reference when drafting or revising an RFC. Preserve the full decision structure while tailoring detail to the RFC type and impact.

## Section Contract

Every RFC contains **7 mandatory sections** and should contain the **4 recommended sections** when relevant.

### Mandatory Sections

1. **Header And Metadata**
   - Title, `HIGH / MEDIUM / LOW` impact and justification, `NOT STARTED / IN PROGRESS / COMPLETE` status, Created, Last Updated, Due Date, and related resources.
   - Full RACI: Driver, Approver or Approvers, Contributors, and Informed parties. Keep unknown required values as `TBD` rather than deleting fields.
2. **Background**
   - Current state, specific problem or opportunity, why now, evidence, and cost or consequence of inaction.
3. **Assumptions**
   - Table with assumption, owner, `High / Medium / Low` confidence, and invalidation trigger. Include at least one explicit assumption.
4. **Decision Criteria**
   - Define criteria before options. Separate non-negotiable must-haves from scored criteria.
   - Use numeric `Weight (%)` values that sum to 100 across scored criteria. Explain scoring scale and disqualification rules.
5. **Options Considered**
   - At least two credible options. Explicitly evaluate the status quo and include it as "Do Nothing" unless it is impossible; explain any omission.
   - For every option include description, how it works, honest pros and cons, dependencies, reversibility, `Estimated Cost`, effort, financial cost when applicable, and `HIGH / MEDIUM / LOW` risk.
   - Generated estimates are required when exact estimates are unavailable. Label them as rough estimates, state assumptions, and use ranges where appropriate.
6. **Action Items**
   - Concrete post-decision actions with owner, due date, and status. Include review, communication, proof-of-concept, downstream TDD, or policy rollout actions when applicable.
7. **Outcome**
   - Keep a visible placeholder while the decision is open. After explicit human decision, record chosen/rejected/deferred outcome, date, decision-makers, rationale, key factors, conditions, and follow-up.

### Recommended Sections

8. **Relevant Data**: quantitative evidence, qualitative feedback, prior attempts, external research, and links.
9. **Pros And Cons**: may live within each option, but each option must receive an honest assessment.
10. **Estimated Cost**: summarize effort, money, operational load, migration cost, and opportunity cost across options.
11. **Resources**: related Jira/Linear issues, Confluence pages, RFCs, ADRs, TDDs, dashboards, research, standards, and vendor documentation.

## Option Comparison

After describing options, include a comparison matrix evaluating each option against the predeclared criteria. Use the numeric weights consistently and show enough scoring rationale that stakeholders can challenge the result. The recommendation must identify:

- which must-haves each option satisfies or fails
- weighted result or qualitative interpretation of the weighted criteria
- decisive trade-offs and sacrifices
- why the recommendation wins despite its disadvantages
- what evidence would change the recommendation

Do not manipulate criteria or weights after seeing which option wins without documenting the change and rerunning every option comparison.

## Conditional Concerns

Add explicit subsections when the RFC type or impact triggers them:

| Trigger | Required concerns |
|---|---|
| Technical/architecture change | system impact, dependencies, compatibility, migration, security, observability, rollback or forward recovery |
| Process/workflow change | affected roles, training, adoption, pilot, enforcement, exceptions, feedback loop, process rollback |
| Product/feature change | user segments, value hypothesis, metrics, experiment or rollout, go/no-go criteria, support impact |
| Vendor/tool selection | evaluation method, pricing assumptions, contract terms, lock-in, data portability, support, exit plan |
| Policy/compliance change | authority, applicable obligations, enforcement, exceptions, audit evidence, review cadence |
| HIGH impact | broader stakeholder review, explicit risks, stronger evidence, implementation dependencies, decision deadline |

## Required Metadata Shape

Use project conventions when present; otherwise start with this Markdown table:

```markdown
# RFC: [Clear, Action-Oriented Title]

| Field | Value |
|---|---|
| **Impact** | HIGH / MEDIUM / LOW - [justification] |
| **Status** | NOT STARTED / IN PROGRESS / COMPLETE |
| **Driver** | @Name |
| **Approver(s)** | @Name1, @Name2 |
| **Contributors** | @Name3, @Name4 |
| **Informed** | @Team, @Stakeholder |
| **Due Date** | YYYY-MM-DD or TBD |
| **Resources** | Jira/Linear, Confluence, related RFC/ADR/TDD |
| **Created** | YYYY-MM-DD |
| **Last Updated** | YYYY-MM-DD |
```

## Detail Boundaries

An RFC decides whether and which direction to pursue. Include enough mechanism to compare feasibility, risk, compatibility, cost, and reversibility, but route settled implementation contracts and task sequencing to a TDD. Keep option descriptions concise and comparable rather than turning one preferred option into a complete design while leaving alternatives shallow.
