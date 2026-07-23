# massa-th0th TDD Workflow

Human-facing guide for the Technical Design Document workflow built directly into `massa-th0th`. Canonical agent instructions live in [`workflows/tdd.md`](../../skills/massa-th0th/workflows/tdd.md) and its [`references/tdd/`](../../skills/massa-th0th/references/tdd/) contracts.

## Purpose

Use this workflow after the product direction or RFC is settled and the engineering team needs an evidence-backed implementation design covering architecture, contracts, data, risks, verification, rollout, and recovery.

Use the massa-th0th `rfc` workflow when alternatives still need stakeholder selection. Use `adr` for one finalized architecture decision, or `spec-driven` when the request spans requirements through implementation.

## Quick Start

```text
Create a TDD for moving password reset tokens into a dedicated store.
```

```text
Write a concise technical design for adding profile photos. Inspect the existing code first.
```

```text
Crie um TDD para migrar eventos de faturamento sem interromper consumidores antigos.
```

The workflow follows the request language, inspects current source and approved documents before asking questions, and scales depth to coupling and risk rather than guessed project duration.

## Behavior

- Compact, Standard, and High-Risk document depths avoid both missing safeguards and fixed 20-section boilerplate.
- Core design covers context, scope, constraints, architecture, contracts, rationale, risks, verification, implementation sequencing, and open questions.
- Verification planning includes a test file checklist with `Done`, `Test File`, `Source Set / Location`, `Action`, `Coverage Target`, and `Gate Command`. Planned tests must say whether to `amplify in existing location: <path> (<sourceSet>)` or `create in <sourceSet>: <path>` after inspecting source-set evidence such as `commonTest`, `androidUnitTest`, `unitTest`, or the repository's actual equivalent.
- Implementation planning uses reviewable PR groups with a stable table: `Order`, `PR Group`, `Layer`, `PR Size`, `Included Work`, `Dependencies`, `Verification Gate`, and `Jira Key`.
- PR sizing is explicit: Small is `1-200 LOC / 1-3 files`, Medium is `201-500 LOC / 3-10 files`, and Large is `500+ LOC / 10+ files`. The workflow prefers Small PRs, allows Medium PRs when splitting would break build/tests/UI or dependency order, and treats Large PRs as exceptions requiring split, stacked PR, feature-flag, or containment rationale.
- Non-breaking implementation work is ordered by layer when applicable: Data, Domain, then Presentation/Navigation. Projects with different boundaries should map those labels to local repository terms before the table.
- UI/UX-affecting changes include a checklist of parallel rendering surfaces and mappers that consume the affected symbol, so every visible surface and mapper stays in scope.
- Supported mobile UI designs can use `design` as child context when Figma links, nodes, desktop selections, or screenshots are supplied. Screenshots remain context-only without exact Figma parity claims.
- A `Strings Audit` runs before TDD finalization when mappers branch on a type and call `stringResource`; otherwise the TDD records why the audit is not applicable.
- Living TDDs include `Decisions Revised During Implementation` and a `Pre-Merge TDD Fidelity Check` so implementation divergences, extra scope, production changes, and planned tests are reconciled before merge.
- Security, privacy, migrations, compatibility, observability, performance, rollout, and recovery become mandatory when project evidence triggers them.
- Unknown facts stay explicit. The workflow does not invent owners, dates, APIs, vendors, metrics, estimates, or approvals.
- Optional Jira creation is delegated to the `ticket` workflow after the task table is stable and validated. The TDD records only confirmed Jira keys, `Not requested`, `Unavailable`, or `Pending`.
- The full Plan Challenge Gate runs before finalization, followed by deterministic artifact checks and the shared Evidence Gate.

## Output

The workflow uses an explicit path or existing project convention and otherwise defaults to `docs/design/<entity>.md`. Existing documents are updated only on an explicit update request or after overwrite confirmation. New documents remain Draft or In Review until human approval is available.

## Troubleshooting

- Too many questions: provide the chosen direction, constraints, affected systems, and rollout expectations; discoverable repository facts are inspected automatically.
- Too much detail: request a Compact TDD, but risk-triggered sections remain required.
- Direction still open: use the `rfc` workflow first.
- Broad delivery request: use `spec-driven` for requirements, design, tasks, and execution.
- Missing tool integration: th0th, Synapse, diagram rendering, and external research degrade gracefully; current repository evidence remains authoritative.
