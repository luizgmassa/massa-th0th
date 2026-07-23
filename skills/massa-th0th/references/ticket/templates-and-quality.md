# Ticket Templates And Quality

Use this reference when decomposing work, selecting prefixes, drafting descriptions, and validating the review artifact.

## Title Prefixes

Every Epic, standard issue, and sub-task summary must start with exactly one allowed prefix:

`[Mobile]`, `[FE]`, `[BE]`, `[Mobile/FE/BE]`, `[Mobile/FE]`, `[Mobile/BE]`, `[FE/BE]`, `[SPIKE]`, `[E2E]`, `[INFRA]`, `[DEVOPS]`

Selection rules:

- Use `[SPIKE]`, `[E2E]`, `[INFRA]`, or `[DEVOPS]` when purpose defines the work.
- Otherwise select the exact affected application layers.
- Do not add service names as extra bracketed prefixes.
- Ask when source evidence supports multiple prefixes and the distinction changes ownership or scope.
- Keep the remaining summary concise, action-oriented, and specific enough to distinguish duplicate candidates.

## Built-In Definition Of Ready

Use when the user supplies no DoR:

- Outcome and motivation are clear.
- In-scope and out-of-scope boundaries are explicit.
- Acceptance or exit criteria are observable and testable.
- Dependencies, blockers, and parent relationships are identified.
- Required design, API, UX, data, or operational references are linked when applicable.
- Important unknowns have an owner or are explicitly excluded from the ticket.
- Jira-required fields are resolved.

## Built-In Definition Of Done

Use when the user supplies no DoD:

- Acceptance or exit criteria have objective evidence.
- Relevant automated tests and required manual checks pass.
- Lint, type, build, and validation commands required by the affected project pass.
- Security, privacy, accessibility, observability, migration, and rollback work is completed when triggered by scope.
- Documentation and operational runbooks are updated when behavior or operations changed.
- No unrelated scope is bundled into completion.
- Created or changed behavior is traceable to this Jira issue.

Do not add impossible or irrelevant default checks to a ticket. Mark a default item `Not applicable` only with a short reason, or remove it during review.

## Built-In Templates

Follow a user-provided template's compatible structure first. Otherwise use the smallest applicable built-in template.

### Epic

- **Outcome**: user or business result and why it matters.
- **Context**: source-backed background and constraints.
- **Scope**: explicit in scope and out of scope.
- **Success Measures**: observable outcomes without fabricated metrics.
- **Child Work**: proposed standard issues and dependency order.
- **Dependencies And Risks**: external teams, systems, decisions, and material risks.
- **References**: supplied documents and verified links.
- **Definition Of Ready** and **Definition Of Done**.

### Story Or Task

- **Goal**: delivered outcome and value.
- **Context**: enough source-backed context for an assignee with no prior conversation.
- **Scope**: in scope and out of scope.
- **Implementation Context**: verified files, modules, contracts, or reusable patterns when exploration ran; avoid prescribing incidental syntax.
- **Acceptance Criteria**: observable behavior, including important failure behavior.
- **Dependencies** and **References**.
- **Definition Of Ready** and **Definition Of Done**.

Use Story for user-facing value and Task for engineering or operational work without direct user value, subject to project-supported Jira issue types.

### Bug

- **Problem**: observed incorrect behavior and impact.
- **Environment**: affected platform, version, environment, or configuration when known.
- **Steps To Reproduce**: deterministic steps when available.
- **Expected Behavior** and **Actual Behavior**.
- **Evidence**: logs, screenshots, links, or verified source pointers.
- **Suspected Area**: only evidence-backed locations or hypotheses.
- **Acceptance Criteria**: corrected behavior plus regression coverage.
- **Dependencies**, **References**, **Definition Of Ready**, and **Definition Of Done**.

Never state a root cause as fact unless verified. Label hypotheses as hypotheses.

### Spike

- **Question**: the decision or uncertainty to resolve.
- **Context**: why investigation is needed now.
- **Scope**: approaches, systems, and explicit exclusions.
- **Required Evidence**: prototypes, measurements, source review, or vendor documentation.
- **Exit Criteria**: questions answered, options compared, trade-offs documented, and recommendation produced.
- **Deliverable**: expected artifact or decision record.
- **Timebox**: include only when user-provided or required by project convention.
- **Dependencies**, **References**, **Definition Of Ready**, and **Definition Of Done**.

### Sub-Task

- **Parent Outcome**: parent issue key or stable parent draft ID and contribution to it.
- **Atomic Work**: one bounded implementation or verification action.
- **Implementation Context**: verified target boundary when known.
- **Acceptance Criteria**: evidence that this action is complete.
- **Dependencies**, **References**, **Definition Of Ready**, and **Definition Of Done**.

A sub-task cannot exist without one standard parent issue. Do not use sub-tasks to hide independently deliverable scope.

## Decomposition Rules

- Prefer independently verifiable standard issues over arbitrary layer-by-layer fragments.
- Use sub-tasks only when work cannot deliver independently outside its parent because it shares the same owner, release path, acceptance outcome, and verification gate.
- Split work when acceptance criteria can pass independently, owners differ, release paths differ, one issue contains >3 outcomes, one issue contains >8 checklist items, or a draft mixes unrelated user-visible outcomes.
- Do not enforce fixed day estimates. Size by outcome coherence, dependency boundaries, reviewability, and whether an assignee can complete the work without reopening product decisions.
- Express dependency edges through stable draft IDs before Jira keys exist. Reject self-dependencies and cycles.

## Deterministic Quality Gate

Before review approval, verify every draft:

1. Project key was validated through Atlassian MCP.
2. Requested issue type exists and all Jira-required fields have values or explicit user-approved omission where Jira permits it.
3. Summary starts with exactly one allowed prefix and contains meaningful text after it.
4. Outcome, scope, and relevant context are present and source-backed.
5. Story, Task, Bug, and Sub-task drafts contain observable acceptance criteria; Spike drafts contain observable exit criteria; Epics contain success measures and child scope.
6. Parent relationships follow current Jira metadata and selected hierarchy mode.
7. Dependency graph is acyclic and references valid draft IDs or verified Jira keys.
8. No unresolved placeholder such as `TBD`, `TODO`, `[fill in]`, or invented fact blocks creation. Non-blocking unknowns are labeled and excluded from scope.
9. Duplicate search was run in the selected project and candidates have an explicit create, revise, or cancel disposition.
10. Draft artifact records source pointers, open questions, creation order, `Draft Revision`, and `Approval Status: NOT APPROVED` before review.

Do not use an LLM-only quality judgment as proof that these gates passed.
