# Verification Ladder

Use this reference before completing work, and before Quick/Standard/Spec-driven sizing, shared-reference loading, or a verification recipe.

## Task Sizing Gate

Classify implementation size before editing:

- Quick: <=3 files and <=200 changed LOC, clear acceptance criteria, one ownership area, no public contract, no security/privacy, no migration, no irreversible operation, and no cross-service compatibility risk.
- Standard: <=10 files or <=500 changed LOC within one ownership area, or shared behavior/public API/test impact that still has clear acceptance criteria and no unresolved architecture decision.
- Spec-driven: >10 files, >500 changed LOC, multiple ownership areas, unclear acceptance criteria, new dependency, migration, irreversible operation, security/privacy/auth, public compatibility, cross-service contract, or any unresolved architecture/product decision.

Quick tasks can proceed inside the active workflow. Standard tasks need an explicit verification recipe before edits. Spec-driven tasks should route to `workflows/spec-driven.md` or be split into atomic tasks.

## Shared Reference Trigger Table

Load these references when the trigger condition is met:

| Reference | Deterministic trigger |
|---|---|
| `references/context-firewall.md` | Before raw artifacts >200 lines, >20 KB, >50 search hits, generated reports, logs, screenshots, external research, or broad search output. |
| `references/pr-task-fix.md` | Standard+ feature/refactor work, any work split into PR groups, or any task with >3 files or >200 LOC. |
| `references/agent-orchestration.md` | Explicit user delegation request, >=2 independent slices, >10 files, high/critical audit findings, or independent verification. Do not load for overlapping write sets or tasks needing full conversation history. |
| `references/naming-standards.md` | New, renamed, audited, or preserved implementation-facing identifiers, public contract fields, fixtures, tests, schemas, docs, or examples. |
| `references/synapse-policy.md` | Planned related `search` calls >=2, parallel delegated retrieval, or Synapse fallback diagnosis. |
| `references/mobile-context.md` | Non-debug Android, iOS, KMP, native bridge, lifecycle, offline/sync, permissions, push/background, local persistence, or backend-mobile contract work. |
| `references/mobile-diagnosis.md` | Debug target involves Android, iOS, KMP, devices, simulators/emulators, native bridges, lifecycle, or mobile-only regressions. |

## Verification Recipe

Before Quick work that touches validation assets, and before all Standard or Spec-driven edits, name:

- expected behavior or acceptance criteria
- commands, tests, builds, linters, or artifact checks to run
- validation assets that must not be weakened, such as tests, specs, benchmarks, fixtures, and snapshots
- skipped checks and the reason they cannot run

## Mandatory Verification Fix Gate

Every `*-fix` workflow must execute this gate for each selected finding or coherent finding group before it can claim closure:

- Run the report's Verification Suggestion when available, or run an equivalent deterministic command/artifact check that proves the same behavior.
- Run target-relevant tests, builds, lint, type checks, static checks, runtime checks, render sensors, or artifact inspections before final closure; model judgment alone cannot satisfy the gate.
- A finding cannot be marked `fixed` when a target-relevant command or artifact check exists but was not attempted.
- If verification cannot run, record one concrete skipped-check reason and mark the finding `blocked`, `deferred`, or `skipped`; do not silently complete it.
- Reinspect validation assets after changes and record that tests, specs, fixtures, snapshots, benchmarks, public contracts, and generated baselines were not weakened unless the user explicitly requested that validation-asset change.
- Closure evidence must include command/artifact, result, skipped reason or `none`, highest Verification Ladder level reached, validation assets protected, and residual risk.

## Ladder

Use the cheapest sufficient evidence first:

1. Static checks: lint, typecheck, import checks, schema validation, or focused static scans.
2. File integrity: confirm validation assets were not deleted, weakened, or rewritten unless the user explicitly requested that change.
3. Behavioral checks: targeted tests, reproduction commands, build outputs, CLI transcripts, UI artifact inspection, or runtime checks.
4. Higher-order checks: judge, faithfulness, or semantic similarity checks only when a concrete tool or command exists.

Do not use model self-evaluation as completion evidence. If a higher-order check is unavailable, state that it was skipped and rely on deterministic evidence.

## Output

Report the highest ladder level reached, key command or artifact evidence, skipped checks, and residual risk.
