# Hook Enforcement

Maps the runtime hook layer (`scripts/hooks/`, `hooks/hooks.json`) to massa-ai
workflows and references, and documents the th0th dual-write/tag contract.
Hooks **enforce** existing references and the gate the router already selected;
they never re-author policy and never re-route. One canonical location per rule.

## Platform Scoping

The full hook graph installs for **Claude Code, Codex, and Cursor**. OpenCode has
no hook model and keeps the `AGENTS.md` bootstrap only. The installer
(`scripts/agent_integrations.py`) preserves unrelated user hooks on install and
uninstall via managed-command tracking.

Platform hook formats differ; the installer translates one canonical graph
(`hooks/hooks.json`, PascalCase events) into each platform's native shape:

| Platform | Format | Event names | Matcher notes |
|---|---|---|---|
| Claude Code | nested `settings.json` `hooks.<Event>[{matcher, hooks:[{type,command}]}]` | `PreToolUse`, `PostToolUse`, `Stop`, `PreCompact`, `SessionStart` (PascalCase) | `Edit\|Write` |
| Codex | nested `hooks.json` (same shape as Claude) | same PascalCase events | same as Claude |
| Cursor | flat `hooks.json` `hooks.<event>[{command, matcher?}]` | `preToolUse`, `postToolUse`, `stop`, `preCompact`, `sessionStart` (camelCase) | tool names differ: `Edit` → `Write` (no Edit tool in Cursor) |

Blocking semantics: Claude and Codex honor the `{"decision":"block","reason"}`
JSON output. Cursor's flat protocol differs; blocking hooks (`gateguard`,
`config_protection`) still run and nudge, but Cursor's denial is best-effort.
The non-blocking hooks (observe, context_monitor, suggest_compact,
continuous_learning_evaluate, precompact_save_state, stop_evidence_gate) work
identically across all three platforms (read stdin JSON, emit JSON, stderr
nudge, exit 0).

## Environment Flags

| Flag | Values | Effect |
|---|---|---|
| `MASSA_AI_HOOK_PROFILE` | `minimal` \| `standard` \| `strict` | `minimal`: only blocking safety hooks (gateguard, config_protection). `standard` (default): blocking + nudges + observation + stop gate as nudge. `strict`: stop gate blocks once per session to force acknowledgment. |
| `MASSA_AI_DISABLED_HOOKS` | comma-separated hook names | Skip named hooks entirely. |

Every hook exits 0 on bad stdin or non-critical error. Blocking hooks are
<200 ms and make no network calls. Observation hooks are non-blocking.

## Hooks → Enforced Reference

| Hook | Event | Enforces |
|---|---|---|
| `stop_evidence_gate.py` | Stop | `references/evidence-gate.md` |
| `continuous_learning_evaluate.py` | Stop | `references/lessons.md`, `scripts/lessons.py` |
| `precompact_save_state.py` | PreCompact | `workflows/restart-save.md`, `references/restart-state.md` |
| `suggest_compact.py` | PreToolUse(Edit\|Write) | `references/context-firewall.md` (compaction boundary) |
| `gateguard_fact_force.py` | PreToolUse(Edit) | `references/context-firewall.md` (investigate-before-edit) |
| `config_protection.py` | PreToolUse(Edit\|Write) | `references/verification-ladder.md` (scope) |
| `observe_runner.py` | PostToolUse | `references/lessons.md` (observation buffer) |
| `context_monitor.py` | PostToolUse | `references/verification-ladder.md` (task sizing/scope) |

## Workflow-Aware Stop Gate

`stop_evidence_gate.py` reads the active `workflow` from `.specs/project/STATE.md`
and selects the workflow-specific gate. When `workflow` is unset or STATE is
absent, it falls back to the flat evidence matrix (graceful degradation).

| Workflow | `stop_evidence_gate` applies |
|---|---|
| `architecture-fix` | verification-fix gate (`references/verification-ladder.md`) |
| `bugs-fix` | verification-fix gate |
| `code-quality-fix` | verification-fix gate |
| `implementation-fix` | verification-fix gate |
| `maestro-fix` | verification-fix gate |
| `mobile-figma-fix` | verification-fix gate |
| `requirements-fix` | verification-fix gate |
| `security-fix` | verification-fix gate |
| `tests-fix` | verification-fix gate |
| `spec-driven` | `validation.md` verdict = Pass; 3-iteration cap |
| `debug` | reproduction no longer fails |
| `feature` | lite evidence matrix (`references/evidence-gate.md`) |
| `refactor` | lite evidence matrix |
| `exploration` | no-mutation gate (read-only invariant) |
| `restart-save` | preflight matrix (`references/restart-state.md`) |
| `architecture-audit` | flat evidence matrix |
| `bugs-audit` | flat evidence matrix |
| `code-quality-audit` | flat evidence matrix |
| `implementation-audit` | flat evidence matrix |
| `maestro-audit` | flat evidence matrix |
| `mobile-figma-audit` | flat evidence matrix |
| `requirements-audit` | flat evidence matrix |
| `security-audit` | flat evidence matrix |
| `tests-audit` | flat evidence matrix |
| `furps-refinement` | flat evidence matrix (findings-only; report written + DoR coverage gaps listed) |
| `adr` | flat evidence matrix |
| `agent-handoff` | flat evidence matrix |
| `commit` | flat evidence matrix |
| `design` | flat evidence matrix |
| `general` | flat evidence matrix |
| `long-session` | flat evidence matrix |
| `maestro` | flat evidence matrix |
| `onboarding` | flat evidence matrix |
| `restart-load` | flat evidence matrix |
| `rfc` | flat evidence matrix |
| `tdd` | flat evidence matrix |
| `the-fool` | flat evidence matrix |
| `ticket` | flat evidence matrix |

## th0th Dual-Write / Tag Contract

The continuous-learning loop writes two stores, not one:

- `lessons.py add` / `import` — deterministic grounded file store
  (`.specs/lessons.json`); refuses ungrounded lessons; promotion/quarantine.
- `remember` — durable memory, best-effort via REST (`TH0TH_API_URL`),
  file-only fallback when REST is unavailable.

**Type:** always `pattern` (lessons are procedural knowledge) or `decision`
(when a lesson captures a chosen trade-off). `procedural` is a **tag**, never a
type — th0th supports only `critical | conversation | code | decision | pattern`
(`references/mcp-tools.md`).

**Tags:** every th0th lesson write carries the full massa-ai persistence
contract: `project:<projectId>`, `session:<workflowSessionId>`,
`workflow:<type>`, `entity:<name>`, `memory:procedural`. This puts lessons in
the same recall namespace as massa-ai decisions/patterns, so future
`recall` surfaces them at Specify/Design.

`PreCompact` (`precompact_save_state.py`) writes a th0th `critical` memory
tagged `memory:working` for the active objective + exact next step before the
window compacts; file-only fallback when REST is unavailable.

## No SessionStart Recall Duplication

massa-ai's router already runs budgeted `recall` on startup. The hook
layer adds **no** competing SessionStart recall. The installer keeps the
existing SessionStart bootstrap (which transports `AGENTS.md` policy); memory
recall stays owned by the router.

## Graceful Degradation

| Failure | Behavior |
|---|---|
| th0th REST unavailable | lesson still lands in `lessons.json`; skipped memory write logged to `scripts/hooks-state/skip.log` |
| `.specs/STATE.md` absent / workflow unset | stop gate falls back to flat matrix |
| bad / malformed stdin | hook exits 0, never blocks |
| hook non-critical error | exit 0, approve, log skip |
