# TDD Document Contract

Load this reference when drafting or revising a TDD. Use the smallest set of sections that makes the design decision-complete; headings may be renamed to match the user's language and project conventions.

## Core Sections

Every TDD must cover these concerns, though Compact documents may combine sections:

1. **Title And Metadata:** status, actual created/updated dates, owner and related artifacts only when known.
2. **Context And Current State:** existing behavior, affected domain, evidence inspected, and why the design is needed now.
3. **Problem, Goals, And Non-Goals:** outcome, measurable acceptance where known, explicit scope, and excluded work.
4. **Constraints And Assumptions:** technical, product, operational, organizational, compatibility, and regulatory constraints; label assumptions by evidence state.
5. **Proposed Design:** component responsibilities, ownership boundaries, interactions, state transitions, data flow, and failure behavior.
6. **Contracts And Data:** only relevant APIs, events, schemas, storage ownership, consistency, idempotency, concurrency, versioning, and error semantics.
7. **Decisions And Rationale:** important selected approaches, alternatives rejected, trade-offs, consequences, and reversibility. Link a separate ADR when a decision deserves an independent durable record.
8. **Risks And Mitigations:** concrete technical, delivery, operational, dependency, and adoption risks with impact, likelihood, detection, mitigation, and accepted residual risk where useful.
9. **Verification Strategy:** acceptance criteria and the unit, integration, contract, end-to-end, migration, performance, security, or operational checks needed to prove them.
10. **Implementation And Delivery Plan:** ordered phases, dependencies, ownership when known, verification gates, rollout sequence, and stop conditions. Avoid fictional estimates.
11. **Decisions Revised During Implementation:** living-document log for decisions changed after implementation reveals new evidence.
12. **Pre-Merge TDD Fidelity Check:** final checklist proving implementation still matches the TDD or documents intentional divergence.
13. **Open Questions:** unresolved decisions that materially affect implementation, including owner or decision point when known.

## Test Strategy Checklist

When a TDD includes downstream implementation work, the Verification Strategy must include a test file checklist table with these exact columns:

| Done | Test File | Source Set / Location | Action | Coverage Target | Gate Command |
|---|---|---|---|---|---|
| [ ] | `<path>` | `<sourceSet or repo equivalent>` | `amplify in existing location: <path> (<sourceSet>)` or `create in <sourceSet>: <path>` | `<behavior or risk>` | `<command>` |

Use the `Done` checkbox as a pre-merge gate. Before choosing a source set, inspect existing test files and source-set configuration. When a relevant test already exists, specify `amplify in existing location: <path> (<sourceSet>)`. Create a new test only after evidence supports the source set and path; write `create in <sourceSet>: <path>`. For Android or Kotlin Multiplatform projects, distinguish `commonTest`, `androidUnitTest`, `unitTest`, or the repository's actual equivalent from build configuration and existing tests rather than defaulting to a preferred source set.

## Implementation Task Table

When a TDD includes downstream implementation work, the Implementation And Delivery Plan must include a reviewable task table with these exact columns:

| Order | PR Group | Layer | PR Size | Included Work | Dependencies | Verification Gate | Jira Key |
|---|---|---|---|---|---|---|---|

Use one row per reviewable PR group, not one row per incidental file change. A PR group must be independently buildable and testable, with no intermediate state that breaks tests, UI, migrations, public contracts, or required runtime behavior. If a group would be too large, split it into two or more groups; if tasks are too small, merge related small work only when the merged group remains independent and reviewable.

Use these PR sizes exactly:

- **Small:** `1-200 LOC / 1-3 files`. Prefer Small PRs, with a sweet spot under 50-100 LOC when practical.
- **Medium:** `201-500 LOC / 3-10 files`. Use Medium only when splitting further would break buildability, testability, UI coherence, or implementation dependency order.
- **Large:** `500+ LOC / 10+ files`. Treat Large as an exception and include explicit split, stacked PR, feature-flag, or other containment rationale in `Included Work` or `Dependencies`.

Order non-breaking groups by layer when applicable: `Data`, then `Domain`, then `Presentation/Navigation`. Data covers DTOs, DAOs, data sources, repositories, analytics, persistence, and data-layer interfaces. Domain covers use cases, models, mappers, configs, exceptions, monitoring, and business rules. Presentation/Navigation covers screens, views, view models, actions, states, routes, and navigation. When the target project uses different boundaries, map these labels to the closest repository terms and state the mapping before the table.

`Jira Key` must contain only a confirmed Jira key, `Not requested`, `Unavailable`, or `Pending`. Never invent ticket keys, links, owners, estimates, or approvals.

## Parallel Rendering Surfaces

When a method, class, enum type, sealed type, mapper, state, or model affects UI/UX, include an affected surfaces checklist before finalizing scope:

| Done | Affected Symbol | Rendering Surface / Mapper | Consumption Path | Required Update | Verification |
|---|---|---|---|---|---|
| [ ] | `<method/class/enum/type>` | `<screen/composable/view/mapper>` | `<file or reference path>` | `<change or none>` | `<test or review gate>` |

Enumerate all discovered parallel rendering surfaces and mappers that consume the symbol. Mark a surface `none` only with evidence, such as reference search, mapper inspection, or platform/source-set ownership.

## Strings Audit

Run a pre-TDD `Strings Audit` when mappers branch on a type and call `stringResource`. Record the branch condition, type values, string keys/resources, fallback behavior, localization impact, and affected rendering surfaces before proposing production or test work. If the repository has no matching mapper or no `stringResource` usage in scope, state that the audit was not applicable with the evidence used.

## Decisions Revised During Implementation

Keep this section in every TDD that includes downstream implementation work. It starts empty in the draft and is updated as implementation reveals new facts; do not silently rewrite the original decision as if it was always known.

| Date | Original Decision | New Evidence | Revised Decision | Impact | Follow-up |
|---|---|---|---|---|---|
| `TBD` | `TBD` | `TBD` | `TBD` | `TBD` | `TBD` |

## Pre-Merge TDD Fidelity Check
- [ ] All planned test files exist
- [ ] All planned production changes implemented
- [ ] Divergences documented with rationale
- [ ] Extra scope listed with justification
- [ ] Decision revisions noted

## Conditional Concerns

Include a dedicated section or explicit subsection when evidence triggers it:

Security, privacy, migration, compatibility, and production-operability concerns are conditional by context but mandatory when their trigger applies.

| Trigger | Required concerns |
|---|---|
| Authentication, authorization, secrets, payments, PII, regulated data | threat boundaries, abuse cases, least privilege, data classification, retention/deletion, secret handling, auditability, compliance assumptions, security verification |
| Production behavior or customer-facing rollout | metrics, logs, traces, dashboards, alert conditions, ownership, rollout stages, rollback or forward-recovery triggers, post-release verification |
| Schema change, backfill, storage move, or protocol migration | compatibility window, expand/migrate/contract ordering, data validation, restartability, idempotency, dual-read/write risks, cutover, recovery, decommission criteria |
| External or cross-service integration | dependency ownership, versioning, timeout/retry/circuit behavior, rate limits, failure isolation, contract tests, degraded behavior |
| Public API, event, SDK, CLI, or persisted-format change | compatibility policy, versioning, deprecation, consumer migration, error semantics, rollout coordination |
| Performance or availability-sensitive path | workload assumptions, budgets or SLOs when known, capacity/scaling behavior, load and failure tests, bottlenecks, cost trade-offs |
| User-visible behavior | user flows, accessibility/localization impacts, analytics or success signals, release and support implications |
| Material alternative or hard-to-reverse choice | alternatives considered, decision criteria, why the selected approach wins, reversal cost |

Testing is never optional as a concern, but its depth scales to risk. Rollback is not always technically possible; document forward recovery, containment, restore, or compensating actions instead of falsely promising reversible migrations.

## Detail Boundary

Include exact details when they are part of the contract or necessary to prevent incompatible implementations:

- endpoint methods, message/event names, request/response shapes, status and error semantics
- schema fields, ownership, constraints, indexes, consistency, retention, and migration invariants
- module or file boundaries when the current repository makes them stable and relevant
- algorithms, state machines, ordering, concurrency, idempotency, retry, and timeout behavior
- feature-flag, rollout, compatibility, and observability contracts

When the TDD proposes names for modules, states, events, schemas, fields, or public contract identifiers, follow `references/naming-standards.md`: use domain or precise role vocabulary supported by evidence, keep public/persisted compatibility explicit, and mark uncertain domain names as proposed rather than verified facts.

Exclude full production implementations, long command transcripts, decorative boilerplate, and framework syntax that does not express a durable constraint. Small pseudocode, tables, or schemas are acceptable when they clarify behavior better than prose.

## High-Level vs Implementation

The durable design states what must hold; implementation detail records how the current codebase satisfies it. Durable design statements survive framework, library, and tooling changes; implementation detail belongs in the task table or inline task notes, not in the durable design prose. The following framework-migration litmus test separates the two.

Framework-migration litmus test: ask "If we change frameworks, does this statement still apply?" If yes, it is high-level design and belongs in the Proposed Design or Contracts And Data sections. If no, it is implementation detail and belongs in the implementation task table, not the durable design.

Worked pairs (BAD = implementation detail leaking into the durable design; GOOD = high-level design intent):

- BAD: "Use Spring's `@Transactional` on the service method." (Framework-specific; fails the litmus test.) GOOD: "The transfer must be atomic across both account writes; partial writes must roll back." (Survives a framework change; names the invariant.)
- BAD: "Expose the endpoint via a Retrofit `@POST` interface." (Library-specific; fails the litmus test.) GOOD: "The client submits the request over HTTPS with idempotency-key semantics; duplicate retries must not double-apply the operation." (Survives a client-library change; names the contract.)

Use implementation-detail statements freely in the task table's `Included Work` and verification gates; keep the durable design prose to statements that pass the litmus test.

## Diagram Policy

Use diagrams for multi-component interactions, state transitions, deployment topology, or migration sequencing. Keep diagrams evidence-backed and consistent with the prose. A diagram is not mandatory when a table or short flow is clearer.

## Anti-Fabrication Rules

- Do not insert example vendors, tools, endpoints, tables, metrics, thresholds, dates, or team names into the final document unless the project uses them or they are clearly labeled proposals.
- Do not mandate arbitrary counts such as three risks, three in-scope items, two paragraphs, or one API endpoint.
- Do not claim compliance from generic controls; identify applicable obligations as verified, proposed, or unresolved.
- Do not claim approval, completed reviews, configured alerts, tested rollback, or production readiness without evidence.
