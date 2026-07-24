# massa-ai Spec-Driven Workflow

Human-facing guide for the TLC Spec-Driven v3 workflow built directly into `massa-ai`. Canonical agent instructions live in [`workflows/spec-driven.md`](../../skills/massa-ai/workflows/spec-driven.md) and its [`references/spec-driven/`](../../skills/massa-ai/references/spec-driven/) contracts.

## Purpose

The workflow turns broad or risky delivery into a compact sequence:

```text
Specify -> (Design) -> (Tasks) -> Execute
```

Specify and Execute always run. Validation is the mandatory final Execute gate, not a separate optional phase. Design runs for Large/Complex work and when architecture, interfaces, data, migration, security/privacy, public contract, or reusable pattern decisions exist. Tasks runs for Large/Complex work and when execution has more than 3 obvious linear steps or dependency/parallelism complexity.

## State

The workflow combines .specs/ artifact files with massa-ai durable memory:

- `features/<slug>/spec.md` owns requirements.
- `features/<slug>/context.md` records Discuss decisions when gray areas are material.
- `features/<slug>/design.md` exists only when Design is needed.
- `features/<slug>/tasks.md` exists only when Tasks is needed.
- `features/<slug>/validation.md` is written by the final Execute validation gate.
- `project/FEATURES.json` tracks active feature and completion evidence.
- `project/STATE.md` tracks progress, verification evidence, blockers, exact next step, and active/superseded `AD-NNN` decisions.
- `HANDOFF.md` tracks handoff state and exact restart instructions.
- `lessons.json` and `LESSONS.md` store project-local lessons in `.specs/lessons.json` and `.specs/LESSONS.md`.
- massa-ai stores durable decisions, rejected approaches, reusable patterns, and verification recipes across sessions.

Use `skills/massa-ai/references/spec-driven/artifact-store.md` for guidance on reading and writing `.specs/` files directly with standard shell commands. Root aliases are not runtime fallback. Optional `.specs-exports/` projections are untracked review aids only.

Restart-save and restart-load are artifact checkpoint/resume mechanisms. They are not substitutes for saving an unattached plan file; chat-only plans must be promoted into `.specs/` artifacts or supplied again after restart.

## Quick Start

```text
Use the spec-driven workflow to specify offline draft sync, design it, create tasks, implement it, and verify it.
```

```text
This migration affects public contracts and state. Run it through spec-driven.
```

```text
Use restart-load to resume the active spec-driven feature from canonical `.specs/` artifacts.
```

These are natural-language requests, not CLI commands.

## Hardened Gates

- Specify: stable requirement IDs, testable acceptance criteria, edge cases, accepted assumptions, explicit out-of-scope boundaries, and an implicit-requirement sweep with `N/A because <reason>` entries where a dimension is irrelevant.
- Discuss: user-confirmed context for gray areas, risks, accepted assumptions, rejected alternatives, and follow-up needed before Design, Tasks, or Execute.
- Design: codebase evidence, ownership, interface/data/security/migration decisions, approach tradeoffs for Large/Complex work, active/superseded `AD-NNN` handling, rejected alternatives, and verification design.
- Tasks: always-generated Test Coverage Matrix, project testing guideline scan, Gate Check Commands, phase execution map, test co-location validation, pre-approval checks, and exact task validation tables.
- Execute: one approved step at a time, protected validation assets, per-task test adequacy review, evidence-or-zero mapping, shallow assertion rejection, payload/conjunction checks, build/test count evidence, and restartable state updates.
- Validate: independent read-only verifier or standalone fresh-eyes fallback, spec-anchored outcome checks, interactive UAT when user-facing behavior needs human judgment, reversible scratch-state discrimination sensor, expanded validation report, and 3-iteration fix loop.
- Lessons and memory: section-scoped `project/STATE.md` artifact writes, explicit lesson signal table, no-script fallback, and massa-ai memory used as context until confirmed against current source.
- Restart across clean chats: save artifact state with `workflows/restart-save.md`, load artifact state with `workflows/restart-load.md`, then return to spec-driven for the owning phase or Execute step.

## Verification Rules

Validation is not optional. The implementation author cannot be the verifier when independent verifier tooling is available. If subagents are unavailable, run the standalone fresh-eyes fallback from `validate.md` before claiming completion.

The fix loop is capped at 3 verification iterations. Each `Needs Fix` verdict returns to Execute; after 3 unsuccessful iterations, preserve evidence and ask for direction.

## Troubleshooting

- Requirements remain ambiguous: keep Specify open or record an accepted assumption.
- Design was skipped but a contract decision appears: stop and write `design.md`.
- Tasks were skipped but execution exceeds 3 steps or has dependencies: stop and write `tasks.md`.
- A validation asset conflicts with the spec: ask for a decision; do not silently weaken either artifact.
- `lessons.py` is unavailable: record the skipped reason and avoid hand-maintained lesson bookkeeping unless code execution is unavailable.
- `.specs/` files unavailable: block spec-driven state mutation instead of falling back to files.
