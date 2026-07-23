# massa-th0th RFC Workflow

Human-facing guide for RFC authoring built directly into `massa-th0th`. Canonical agent instructions live in [`workflows/rfc.md`](../../skills/massa-th0th/workflows/rfc.md) and its [`references/rfc/`](../../skills/massa-th0th/references/rfc/) contracts.

## Purpose

Use this workflow when a significant technical, process, product, vendor, tool, or policy decision remains open and stakeholders need options, evidence, costs, trade-offs, and a recommendation before committing.

Use `adr` when a significant architecture decision is finalized, `tdd` when the direction is settled and implementation design remains, or `spec-driven` when work spans requirements through execution.

## Quick Start

```text
Write an RFC for migrating our database from MySQL to PostgreSQL.
```

```text
Draft an RFC comparing self-hosted Kafka, Amazon MSK, and Confluent Cloud. Cost and vendor lock-in are the main criteria. The CTO and SRE lead approve.
```

```text
Crie um RFC para adotar um monorepo. Compare alternativas, custos e impacto nas equipes.
```

The workflow follows the request language and uses provider-specific `AskQuestion` interactions when available.

## Behavior

- Requires full RACI, `HIGH / MEDIUM / LOW` impact, assumptions with confidence and invalidation triggers, and weighted decision criteria.
- Preserves 7 mandatory and 4 recommended sections, at least two options, status quo consideration, pros and cons, comparison matrices, generated estimates, action items, and an Outcome placeholder.
- Tailors analysis for technical, process, product, vendor, and policy RFCs.
- Can use `design` as child context when supplied Figma links, nodes, desktop selections, or screenshots materially affect supported mobile UI options. Screenshots remain context-only without exact Figma parity claims.
- Runs the full Plan Challenge Gate and shared Evidence Gate.
- Keeps open proposals in working memory and records semantic decision memory only after an explicit outcome.

## Output

The workflow uses an explicit path or existing project convention and otherwise defaults to `docs/rfc/<entity>.md`. New proposals use `NOT STARTED` or `IN PROGRESS`; `COMPLETE` requires an explicit human decision in Outcome.

## Follow-Up Integrations

After drafting, the workflow suggests stakeholder review, a decision deadline or meeting, Jira/Linear linkage, a downstream TDD, and Confluence publication when relevant. Suggestions do not claim external actions occurred.

## Troubleshooting

- Too many questions: provide RACI roles, due date, impact, assumptions, criteria, weights, and candidate options in the initial request.
- Too much detail: keep the RFC focused on choosing direction; move settled implementation detail into a TDD.
- Only one option: provide constraints or allow research so alternatives and status quo receive honest evaluation.
- Decision already made: use ADR to record it or TDD to design implementation.
- Missing external tools: the RFC can still be drafted locally; Jira, Linear, and Confluence remain suggested follow-ups.
