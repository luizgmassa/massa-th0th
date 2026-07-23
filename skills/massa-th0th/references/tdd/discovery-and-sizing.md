# TDD Discovery And Sizing

Load this reference before source investigation, document sizing, or clarification questions for the TDD workflow.

## Evidence Order

Use the narrowest authoritative source first:

1. Current repository source, schemas, tests, configuration, and project instructions.
2. Approved project RFCs, ADRs, TDDs, requirements, architecture documents, and tickets available in the workspace.
3. Relevant current th0th memories, treated as evidence rather than authority.
4. Official dependency or platform documentation when the design depends on external behavior.
5. External research only when local and official sources cannot answer a material question and browsing is allowed.

Record the source of consequential claims. If sources conflict, prefer current source and explicitly approved artifacts, then stop for user resolution when authority remains ambiguous.

## Testing And UI/UX Discovery

Before drafting implementation or verification sections:

- Inspect existing tests and build/source-set configuration before naming any test file location. For Android or Kotlin Multiplatform repositories, distinguish `commonTest`, `androidUnitTest`, `unitTest`, or the repository's actual equivalent from evidence.
- For each planned test, decide from source evidence whether the TDD should say `amplify in existing location: <path> (<sourceSet>)` or `create in <sourceSet>: <path>`.
- For UI/UX-affecting method, class, enum type, sealed type, mapper, state, or model changes, search references and list parallel rendering surfaces and mappers that consume the affected symbol.
- Before proposing string changes, grep or search for mappers that branch on the affected type and call `stringResource`; run a `Strings Audit` when that pattern exists.

## Fact Discipline

Classify design inputs as:

- **Verified:** directly supported by current source or an authoritative document.
- **Inferred:** strongly implied by evidence; label the inference and its basis.
- **Proposed:** a design choice introduced by the TDD and awaiting review.
- **Unknown:** not discoverable from available evidence.

Never convert an inference or example into a project fact. Omit optional metadata when absent or mark it `TBD`; do not invent people, ticket links, dates other than the actual document date, system names, traffic numbers, SLAs, compliance obligations, estimates, or approvals.

## Workflow Fit

- Use TDD when the direction is selected and implementation design remains.
- Use RFC when stakeholders still need options compared or the primary direction approved.
- Use ADR when one significant decision and its consequences need recording without a full implementation blueprint.
- Use spec-driven when the request spans requirements, design, tasks, and implementation or needs staged approval across those phases.
- Use feature, refactor, debug, or general for localized work that does not need a durable design artifact.

TDD readiness checklist:

- One product direction is selected.
- A named requirements source exists, such as user prompt, approved spec, ticket, ADR, RFC outcome, product doc, or current source contract.
- No unresolved API, data model, security/privacy, migration, rollout, public compatibility, or cross-service decision blocks implementation design.
- Required owners, decision deadlines, or explicit open questions are known for any non-blocking unknowns.

If any of the first three checks fail, route to RFC, ADR, spec-driven, or clarification before drafting the TDD.

## Adaptive Depth

### Compact

Use when all are true: <=3 files, <=200 changed LOC expected, one implementation path, no new public contract, no new dependency, no migration, no security/privacy boundary, and rollback is delete/revert-level. Include context, chosen design, affected files, tests, and completion criteria.

### Standard

Use when any are true and High-Risk is false: 4-10 files, 201-500 changed LOC expected, multiple components in one ownership area, changed internal interface, new test surface, non-destructive dependency/config change, or one coordinated rollout path. Include relevant contracts, alternatives, rollout, observability, and ownership boundaries.

### High-Risk

Use when any are true: authentication, authorization, privacy, regulated or sensitive data, irreversible operation, migration, cross-service contract, public compatibility, high availability, data-loss/outage risk, >10 files, >500 changed LOC expected, multiple teams/ownership areas, or unclear rollback. Require explicit threat/failure analysis, migration safety, rollout, rollback or forward-recovery strategy, and operational verification.

Do not use week-based project-size heuristics. Effort estimates are useful only when the user or project planning process requires them and evidence supports them; use ranges and assumptions rather than fabricated precision.

## Clarification Policy

Inspect first, ask second. Ask only when the answer changes architecture, scope, a public contract, safety, rollout, or acceptance.

- Group at most three related questions per turn.
- Offer meaningful choices when alternatives are known; otherwise ask concise free-form questions.
- Ask in the user's language.
- Do not require owner, team, ticket, API, risk-count, or timeline fields merely to satisfy a template.
- If an unknown is non-blocking, record it in Open Questions with its decision deadline or owner when known.
- If a blocking unknown cannot be resolved, stop before claiming the design is decision-complete.

## Language And Terminology

Write the TDD in the language of the user's request unless they specify another language. Preserve code identifiers, protocol names, product names, and established domain terms. Translate headings naturally rather than using a fixed translation table.
