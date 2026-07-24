# Workflows + Agents Consolidation — Discuss Context

## Source

User request, answered via four clarifying questions:

1. **Destination repo** → massa-ai product repo (cwd). Move both agents and the workflow skill into the cwd. Useful-Agent-Skills keeps its copy; the user decides its lifecycle separately.
2. **Invocation style** → Named dispatch blocks. Each workflow replaces duplicated inline prompt text with a compact dispatch block carrying the capability-packet fields (role/purpose/trigger/scope/permissions/inputs/sensors/output/firewall/memory) per `agent-orchestration.md:74-87`.
3. **Workflow scope** → All workflows with duplication. Rewrite every workflow that contains duplicated inline prompt sections that map to an existing agent charter.
4. **Plan challenge** → Full The Fool. spec-driven + >5 files + cross-repo contracts trigger the full gate per `AGENTS.md` Plan Challenge Policy.

## Two-Repo Starting State (verified by source inspection)

- **Product repo (cwd)** `/Users/luizmassa/Personal Projects/massa-ai/`:
  - `skills/<name>/SKILL.md` for 12 specialists + 2 meta-skills (`massa-ai-memory`, `synapse-usage`)
  - `skills/AGENTS.md` — sub-agent registry (12 agents, capability packet, output contract, role-mapping table)
  - `scripts/generate-subagent-artifacts.ts` — reads `skills/<name>/SKILL.md`, emits 48 host agent files into `apps/*/agents/`, `--check` drift gate
  - `scripts/install-agents.ts` — writes MCP config into host agent config files (unaffected by the move)
  - Prior feature `subagent-skills-plugin-parity` is COMPLETE + validated PASS; `skills/AGENTS.md:99` notes the follow-up this feature implements

- **Useful-Agent-Skills** `/Users/luizmassa/Personal Projects/Useful-Agent-Skills/`:
  - `skills/massa-ai/` = `SKILL.md` (router) + `workflows/` (39 files, ~2759 LOC) + `references/` (~30 files) + `scripts/lessons.py`
  - Workflows use pre-consolidation role names: `investigator`, `implementer`, `verifier`, `domain-mapper`, `coupling-auditor`, `deepening-architect`, `plan-critic`, `furps-analyst`, `handoff-writer`
  - Workflows carry duplicated inline blocks: scope-resolution prose, false-positive pass, severity rules, "Use subagents only when useful"

## Role → Agent Mapping (from skills/AGENTS.md:71-88)

| Old role | New agent | Notes |
| --- | --- | --- |
| `investigator` | `investigator` | Identical |
| `implementer` | `builder` | Renamed to match request vocabulary |
| `verifier` | `verification-agent` | Renamed; also centralizes Verification Ladder |
| `domain-mapper` | `architecture-specialist` | Folded (3 roles → 1) |
| `coupling-auditor` | `architecture-specialist` | Folded |
| `deepening-architect` | `architecture-specialist` | Folded |
| `plan-critic` | (role-based, no charter) | Stays prompt-contract dispatch |
| `furps-analyst` | (role-based, no charter) | Stays prompt-contract dispatch |
| `handoff-writer` | (role-based, no charter) | Stays prompt-contract dispatch |

New agents with no old-role counterpart (used where workflows currently inline their capability): `planner`, `reviewer`, `context-curator`, `requirements-analyst`, `test-engineer`, `documentation-agent`, `audit-specialist`, `mobile-specialist`.

## Duplication Inventory (verified across all 39 workflows)

### Audit-family (7 workflows) — identical scope-resolution block (~15 lines each)
architecture-audit, security-audit, requirements-audit, tests-audit, bugs-audit, code-quality-audit, implementation-audit.
Each inlines: modified-files/commit-range/codebase-area/symbol/feature/whole-repo/implementation-parent scope resolution + false-positive pass + severity rules + "Use agent orchestration only when it improves signal" with old role names.

### Fix-family (7 workflows) — identical "Use subagents only when useful" block
architecture-fix, security-fix, requirements-fix, tests-fix, bugs-fix, code-quality-fix, implementation-fix.
Each inlines: `implementer` may execute one isolated finding; `verifier` may independently check.

### spec-driven.md — inline verifier contract (lines 96-98)
Verifier independence, spec-anchored outcome check, discrimination sensor, validation.md write.

### exploration.md — BRIEFING→PLAN→EXECUTE→DEBRIEF + investigation plan
Maps to `investigator` dispatch for the recon/investigation steps.

### the-fool.md — plan-critic dispatch (lines 23-49)
Already role-based; stays as prompt-contract dispatch (no charter).

### refinement/furps-refinement.md — furps-analyst fan-out (lines 24-31, 65)
Already role-based; stays as prompt-contract dispatch (no charter).

## Implicit-Requirement Dimensions Sweep (Large/Complex — every dimension)

| Dimension | Resolution |
| --- | --- |
| Input validation & bounds | N/A — no user input parsing; file paths are internal repo paths. |
| Failure / partial-failure states | Generator `--check` drift gate fails CI on any charter/path mismatch (WAC-03/04). |
| Idempotency / retry / duplicate handling | Generator is idempotent (re-run = no-op when no drift); move is one-shot. |
| Auth boundaries & rate limits | N/A — no auth surface; skill files are repo-local. |
| Concurrency / ordering | Phase ordering: move agents → move workflow skill → update generator/registry → rewrite workflows → update role map. Parallel rewrite only after the move lands. |
| Data lifecycle / expiry | N/A — no persisted data; git history is the versioning layer. |
| Observability | Parity test + `--check` drift gate are the deterministic sensors (WAC-03/04). |
| External-dependency failure | N/A — no external services; all work is local file moves + edits. |
| State-transition integrity | `skills/AGENTS.md` registry Charter column + generator path are the two transition points; both updated atomically in Phase 1. |

## Decisions

- AD-WAC-001: Destination = product repo (cwd). Agents → `skills/agents/`; workflow skill → `skills/massa-ai/`.
- AD-WAC-002: Invocation = named dispatch blocks with capability-packet fields.
- AD-WAC-003: Scope = all 39 workflows; only those with duplication get rewritten, the rest are copied as-is.
- AD-WAC-004: `massa-ai-memory` and `synapse-usage` stay at `skills/` top level (meta-skills, excluded by generator).
- AD-WAC-005: `plan-critic`, `furps-analyst`, `handoff-writer` stay role-based dispatches (no charter).
- AD-WAC-006: `audit-specialist` lens config stays in its charter; workflows name the lens in the dispatch `inputs` field, not inline.
- AD-WAC-007: Useful-Agent-Skills source tree is left untouched; the user decides its lifecycle separately.

## Risks (to feed The Fool)

- R1: Generator path change (`skills/<name>` → `skills/agents/<name>`) breaks the drift gate if any path is missed.
- R2: Old role names remain in a workflow after rewrite (search must confirm zero occurrences).
- R3: Workflow internal reference paths break after the skill moves (relative `references/` paths must still resolve).
- R4: `skills/AGENTS.md` registry Charter column not updated → generator can't find charters.
- R5: Behavior drift: rewriting dispatch prose accidentally changes routing/memory/Evidence Gate contracts.
- R6: `architecture-specialist` 3-role fold loses sub-mode signal if the dispatch block doesn't name the lens.