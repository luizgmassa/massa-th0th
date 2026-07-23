# RFC Discovery And Classification

Load this reference before source investigation, RFC classification, impact selection, or clarification questions.

## Workflow Fit

- Use RFC when the decision is open, at least two directions deserve comparison, and stakeholders need feedback or approval.
- Use ADR when a significant architecture decision is finalized or being formally recorded.
- Use TDD when the direction is settled and implementation architecture, contracts, rollout, and verification remain.
- Use spec-driven when the request spans requirements, design, task planning, and implementation.
- Use a feature, refactor, debug, or general workflow when a durable stakeholder proposal would add no decision value.

Route matrix:

| User state | Route |
|---|---|
| One architecture decision is selected and needs durable consequences recorded | ADR |
| Two or more options remain open, decision criteria are needed, or stakeholders must review before choosing | RFC |
| Direction is selected and implementation architecture/contracts/rollout need a blueprint | TDD |
| Requirements, design, tasks, and execution all need staged approval | Spec-driven |

Source relevance requires the source to name at least one target, constraint, risk, dependency, public contract, option, decision criterion, stakeholder, cost, rollout path, or rejected approach for this RFC. Style-only examples cannot support factual claims.

## Evidence Order

Use the narrowest authoritative evidence first:

1. Current repository source, schemas, tests, configuration, and project instructions.
2. Existing RFC templates and conventions, approved ADRs/TDDs, tickets, metrics, incident records, and supplied research.
3. Relevant current th0th memories, treated as evidence rather than authority.
4. Internal MCP sources such as Jira, Linear, Confluence, or NotebookLM when supplied or available and relevant.
5. Official dependency, vendor, standard, or regulatory documentation.
6. Broader external research only when authoritative local or official evidence cannot answer a material question.

Distinguish verified facts, evidence-backed inferences, generated estimates, proposed choices, and unresolved facts. Record the source of consequential claims. When sources conflict and authority remains unclear, ask rather than silently choosing one.

## RFC Types

Classify the proposal and emphasize its domain concerns:

| Type | Required emphasis |
|---|---|
| Technical/Architecture | system boundaries, compatibility, migration path, technical and operational risks |
| Process/Workflow | team impact, ownership, adoption, enforcement, pilot, and rollback if the process fails |
| Product/Feature | user impact, success metrics, go/no-go criteria, adoption, and support implications |
| Vendor/Tool Selection | capability fit, total cost, lock-in, support, security, exit strategy, and evaluation evidence |
| Policy/Compliance | obligations, scope, enforcement, exceptions, audit trail, ownership, and review cadence |

## Impact Labels

Every RFC must use one preserved label with a short justification:

- `HIGH`: affects multiple teams, systems, user groups, material cost, sensitive data, compliance, public compatibility, or a difficult-to-reverse decision.
- `MEDIUM`: materially affects one team or system, has non-trivial adoption or operational cost, or requires coordinated rollout.
- `LOW`: limited scope, low coordination cost, and easy reversibility, while still benefiting from explicit stakeholder alignment.

## Provider-Specific AskQuestion

When mandatory context is missing and the provider exposes `AskQuestion`, use it instead of an unstructured question dump. Preserve these question IDs and choices so separate runs gather consistent inputs:

```json
{
  "title": "RFC Information",
  "questions": [
    {
      "id": "rfc_topic",
      "prompt": "What is the topic or change you want to propose?",
      "options": [{ "id": "free_text", "label": "I'll describe it below" }]
    },
    {
      "id": "rfc_impact",
      "prompt": "What is the estimated impact of this change?",
      "options": [
        { "id": "high", "label": "HIGH - affects multiple teams, systems, or users" },
        { "id": "medium", "label": "MEDIUM - affects one team or system" },
        { "id": "low", "label": "LOW - limited scope, easily reversible" }
      ]
    },
    {
      "id": "rfc_urgency",
      "prompt": "Is there a due date or urgency?",
      "options": [
        { "id": "urgent", "label": "Yes, we need a decision soon" },
        { "id": "planned", "label": "Part of planned roadmap" },
        { "id": "open", "label": "No fixed deadline" }
      ]
    },
    {
      "id": "rfc_options",
      "prompt": "Do you have options or alternatives in mind?",
      "options": [
        { "id": "yes", "label": "Yes, I have 2+ options to compare" },
        { "id": "one", "label": "I have a preferred option and need alternatives" },
        { "id": "no", "label": "No, help me structure options" }
      ]
    }
  ]
}
```

Follow with focused `AskQuestion` calls for missing RACI roles, assumptions, criteria, weights, or options. If `AskQuestion` is unavailable, ask equivalent concise questions in conversation. Ask in the user's language and do not re-ask supplied or discoverable facts.

## Mandatory Inputs

Do not finalize the RFC without:

- a clear action-oriented title and evidence-backed background
- full RACI: Driver, Approver or Approvers, Contributors, and Informed parties
- `HIGH`, `MEDIUM`, or `LOW` impact with justification
- urgency or due date, including explicit `TBD` when the user cannot provide one
- at least one assumption with owner, confidence, and invalidation trigger
- at least two decision criteria defined before options, with numeric weights
- at least two credible options and explicit status quo consideration
- a recommendation tied back to the weighted criteria

When a person or date is unknown, ask for it. If the user cannot supply it, keep the required field visible as `TBD`; never pretend it was resolved.

## Language

Write the RFC in the same language as the user's request unless another language is requested. Preserve technical identifiers, product names, standards, and common terms such as API, RFC, rollback, and stakeholder when translation would reduce clarity.
