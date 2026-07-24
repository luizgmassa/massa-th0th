# Workflows + Agents Consolidation Specification

## Problem Statement

The massa-ai sub-agent skills (12 specialists) and the massa-ai workflow skill (router + 39 workflows + ~30 references) currently live in two separate repositories. The 12 agent charters sit in the product repo (cwd) at `skills/<name>/`, while the workflows that should invoke those agents live in the separate `Useful-Agent-Skills` repo at `skills/massa-ai/workflows/`. The workflows still use the pre-consolidation role names (`implementer`, `verifier`, `domain-mapper`, `coupling-auditor`, `deepening-architect`) and carry large blocks of duplicated inline prompt text (scope resolution, false-positive pass, severity rules, "use subagents only when useful") that now duplicate capability already captured in the 12 agent charters. This split makes the agents hard to discover from the workflows, keeps two sources of truth for dispatch contracts, and blocks the planned follow-up (noted in `skills/AGENTS.md:99`) to "update massa-ai workflows to replace duplicated inline prompt sections with agent invocations."

## Goals

- [ ] Consolidate the massa-ai workflow skill into the product repo so agents and workflows ship from one tree.
- [ ] Move the 12 agent charters from `skills/<name>/` to `skills/agents/<name>/` so agents are grouped under one directory.
- [ ] Rewrite all 39 workflow files to replace duplicated inline prompt sections with named dispatch blocks referencing the 12 agent charters.
- [ ] Update the generator, installer, registry, and parity test for the new `skills/agents/` path so shipped agent files stay drift-free.
- [ ] Update the agent-orchestration role table to map old role names to the 12 new agent names.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing agent charter content (missions, permissions, model hints) | Charters are frozen by the prior `subagent-skills-plugin-parity` feature; this feature only moves them and rewrites workflows. |
| Rewriting references/ (only agent-orchestration.md gets a role-mapping update) | References are shared contracts; bulk rewrite is a separate feature. |
| Changing the generator's per-host emission logic or model-pinning tables | Generator behavior is frozen; only its input path changes. |
| Touching `scripts/install-agents.ts` MCP-config logic | Installer writes host configs, not skill paths; unaffected by the agent directory move. |
| Removing `plan-critic`, `furps-analyst`, `handoff-writer` role-based dispatch | These three roles have no charter and stay as prompt-contract dispatches per `agent-orchestration.md`. |
| Deleting the massa-ai skill from Useful-Agent-Skills | That repo's lifecycle is the owner's decision; this feature copies the skill into the product repo and leaves the source untouched unless the user asks to remove it. |
| Changing workflow routing logic, precedence keys, or the SKILL.md router table | Routing is frozen; only dispatch-block references inside workflow bodies change. |
| Altering `lessons.py` or the lessons store | Lessons system is orthogonal to agent/workflow consolidation. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Destination repo = product repo (cwd) | Move both agents and the massa-ai skill into the product repo | User answered "massa-ai product repo (cwd)" in the clarifying question | y |
| Agent directory = `skills/agents/<name>/` | Group the 12 charters under `skills/agents/` | User explicitly said "Move agents that are inside skills/ to skills/agents/"; keeps agents discoverable separate from the workflow skill | y |
| Workflow skill path = `skills/massa-ai/` | Place the full skill (router + workflows + references + scripts) at `skills/massa-ai/` | User said "Move the entire new massa-ai workflows into this repository, at skills/" | y |
| Invocation style = named dispatch blocks | Replace inline prompts with compact dispatch blocks carrying capability-packet fields | User chose "Named dispatch blocks (Recommended)" | y |
| Workflow scope = all workflows with duplication | Rewrite every workflow that contains duplicated inline prompt sections | User chose "All workflows with duplication (Recommended)" | y |
| Plan challenge = full The Fool | Run full gate before execution | User chose "Full The Fool (Recommended)"; spec-driven + >5 files + cross-repo | y |
| `massa-ai-memory` and `synapse-usage` stay at `skills/` top level | They are meta-skills, not agent charters; the generator already excludes them | Generator `SPECIALIST_NAMES` array excludes them; moving them would break the meta-skill symlink references | y (assumption) |
| Old role names map per `skills/AGENTS.md:71-88` | `investigator`→`investigator`; `implementer`→`builder`; `verifier`→`verification-agent`; `domain-mapper`+`coupling-auditor`+`deepening-architect`→`architecture-specialist`; `plan-critic`/`furps-analyst`/`handoff-writer` stay role-based | The registry mapping table is the existing source of truth | y |
| Dispatch block format follows the Capability Packet from `agent-orchestration.md:74-87` | Each block lists role/purpose/trigger/scope/permissions/inputs/sensors/output/firewall/memory | Matches the existing dispatch contract | y |
| `audit-specialist` lens config stays in its charter, not duplicated into workflows | The 6 lenses (bugs/architecture/security/requirements/code-quality/performance) are charter-owned | Avoids re-duplicating lens definitions into workflows | y |
| The product repo's `AGENTS.md` "Sub-Agent Skills" section stays as the registry | It already lists the 12 agents; only the charter path column changes from `skills/<name>/SKILL.md` to `skills/agents/<name>/SKILL.md` | Minimal blast radius | y |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Single-Tree Agent + Workflow Skill ⭐ MVP

**User Story**: As a massa-ai maintainer, I want the 12 agent charters and the massa-ai workflow skill to live in one repository tree so that I can edit agents and workflows without switching repos and so shipped plugins stay drift-free.

**Why P1**: This is the structural prerequisite for every other story; without consolidation the dispatch-block rewrites would still cross repos.

**Acceptance Criteria**:

1. WHEN the product repo is inspected THEN `skills/agents/<name>/SKILL.md` SHALL exist for each of the 12 specialist names (investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist).
2. WHEN the product repo is inspected THEN `skills/massa-ai/` SHALL contain `SKILL.md`, `workflows/`, `references/`, and `scripts/lessons.py` copied from the Useful-Agent-Skills `skills/massa-ai/` tree.
3. WHEN `bun run scripts/generate-subagent-artifacts.ts --check` runs THEN it SHALL exit 0 with no drift, reading charters from `skills/agents/<name>/SKILL.md`.
4. WHEN the parity test runs THEN it SHALL confirm the 48 shipped agent files (12 x 4 hosts) match the checked-in files byte-for-byte.
5. WHEN `skills/AGENTS.md` is inspected THEN its Charter column SHALL point at `skills/agents/<name>/SKILL.md` for all 12 agents.

---

### P2: Workflows Invoke Agents by Named Dispatch Blocks

**User Story**: As a workflow author, I want each workflow to dispatch the 12 agents through compact named dispatch blocks instead of duplicated inline prompt text so that the dispatch contract stays in one place (the charter) and workflows stay short.

**Why P2**: This is the core simplification the user asked for; it removes the duplication that the prior `subagent-skills-plugin-parity` feature flagged for follow-up.

**Acceptance Criteria**:

6. WHEN any audit-family workflow (architecture, security, requirements, tests, bugs, code-quality, implementation) is inspected THEN its investigation/scope-resolution section SHALL dispatch `investigator` (and/or `audit-specialist` with a lens) via a named dispatch block instead of inlining the full scope-resolution prose.
7. WHEN any fix-family workflow (architecture-fix, security-fix, requirements-fix, tests-fix, bugs-fix, code-quality-fix, implementation-fix) is inspected THEN its "Use subagents only when useful" block SHALL be replaced by named dispatch blocks for `builder` (was `implementer`) and `verification-agent` (was `verifier`).
8. WHEN any workflow references an old role name (`implementer`, `verifier`, `domain-mapper`, `coupling-auditor`, `deepening-architect`) THEN it SHALL use the new agent name (`builder`, `verification-agent`, `architecture-specialist`) instead; no old role name SHALL remain in any workflow file.
9. WHEN a dispatch block is emitted THEN it SHALL include the capability-packet fields (role, purpose, trigger, scope, permissions, inputs, sensors, output, firewall, memory boundary) in a compact table or fenced block per `agent-orchestration.md:74-87`.
10. WHEN a workflow needs `plan-critic`, `furps-analyst`, or `handoff-writer` THEN it SHALL keep role-based dispatch (no charter exists) using the prompt contract from `agent-orchestration.md`.

---

### P3: Agent-Orchestration Role Map Updated

**User Story**: As a workflow reader, I want the agent-orchestration reference to map old role names to the 12 new agent names so I can trace any dispatch block back to a charter.

**Why P3**: Keeps the single source of truth for the role→agent mapping consistent with the registry.

**Acceptance Criteria**:

11. WHEN `references/agent-orchestration.md` is inspected THEN its Roles table SHALL include a "Charter" column pointing each mapped role to `skills/agents/<name>/SKILL.md` and SHALL mark `plan-critic`, `furps-analyst`, and `handoff-writer` as "role-based (no charter)".
12. WHEN `references/agent-orchestration.md` is inspected THEN the mapping (`investigator`→`investigator`, `implementer`→`builder`, `verifier`→`verification-agent`, `domain-mapper`+`coupling-auditor`+`deepening-architect`→`architecture-specialist`) SHALL be explicit in the table.

---

### P3: Workflows Stay Behavior-Preserving

**User Story**: As a massa-ai user, I want the rewritten workflows to route, recall, persist, and gate exactly as before so that no workflow behavior changes.

**Why P3**: The rewrite is structural (dispatch blocks replace inline prose), not behavioral; routing precedence, memory tags, Evidence Gate, and failure handling must stay intact.

**Acceptance Criteria**:

13. WHEN any rewritten workflow is diffed against its pre-rewrite version THEN the routing header, `workflowSessionId` rule, reference-load list, `recall` step, persistence tags, and Evidence Gate step SHALL be unchanged in meaning (prose may be tightened but contracts preserved).
14. WHEN the SKILL.md router table is inspected THEN every workflow row SHALL still point at the same relative path under `workflows/` and the router precedence keys SHALL be unchanged.
15. WHEN any rewritten audit workflow is inspected THEN its finding-ID prefix (`ARCH-`, `SEC-`, `REQ-`, `TST-`, `BUG-`, `CQ-`, `IMPL-`), severity-rule structure, and `audit-report-io.md` field contract SHALL be preserved.

---

## Edge Cases

- WHEN a workflow has no duplicated inline prompt (e.g. `onboarding.md` 20 lines, `long-session.md` 39 lines) THEN it SHALL be copied as-is; no rewrite required.
- WHEN two agents could satisfy one dispatch (e.g. `investigator` vs `audit-specialist` for scope resolution) THEN the workflow SHALL pick the most specific agent and record the trigger reason in the dispatch block.
- WHEN a workflow dispatches `architecture-specialist` for work previously split across `domain-mapper` + `coupling-auditor` + `deepening-architect` THEN the dispatch block SHALL name the lens sub-mode (domain/coupling/deepening) in the `inputs` field so the specialist knows which sub-capability to run.
- WHEN the generator reads `skills/agents/<name>/SKILL.md` and a charter is missing THEN it SHALL fail with a clear error naming the missing file (existing behavior; only the path prefix changes).
- WHEN `skills/massa-ai/scripts/lessons.py` is copied THEN its internal relative paths (it references `skills/massa-ai/...`) SHALL still resolve because the skill moves as a unit.
- WHEN a workflow references `references/agent-orchestration.md` THEN the path SHALL still resolve relative to `skills/massa-ai/` after the move.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WAC-01 | P1: Single-Tree | Execute | Pending |
| WAC-02 | P1: Single-Tree | Execute | Pending |
| WAC-03 | P1: Single-Tree | Execute | Pending |
| WAC-04 | P1: Single-Tree | Validate | Pending |
| WAC-05 | P1: Single-Tree | Execute | Pending |
| WAC-06 | P2: Dispatch Blocks | Execute | Pending |
| WAC-07 | P2: Dispatch Blocks | Execute | Pending |
| WAC-08 | P2: Dispatch Blocks | Execute | Pending |
| WAC-09 | P2: Dispatch Blocks | Execute | Pending |
| WAC-10 | P2: Dispatch Blocks | Execute | Pending |
| WAC-11 | P3: Role Map | Execute | Pending |
| WAC-12 | P3: Role Map | Execute | Pending |
| WAC-13 | P3: Behavior-Preserving | Validate | Pending |
| WAC-14 | P3: Behavior-Preserving | Validate | Pending |
| WAC-15 | P3: Behavior-Preserving | Validate | Pending |

**ID format:** `WAC-<NUMBER>` (Workflows-Agents-Consolidation)

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 15 total, 15 mapped to tasks, 0 unmapped

---

## Success Criteria

- [ ] The product repo contains `skills/agents/` (12 charters) and `skills/massa-ai/` (full workflow skill) with no agents left at `skills/<name>/` top level (except `massa-ai-memory` and `synapse-usage` meta-skills).
- [ ] `bun run scripts/generate-subagent-artifacts.ts --check` exits 0 (no drift) reading from the new path.
- [ ] Every workflow file that previously carried duplicated inline dispatch prose now uses named dispatch blocks; no old role name (`implementer`, `verifier`, `domain-mapper`, `coupling-auditor`, `deepening-architect`) remains.
- [ ] `references/agent-orchestration.md` maps old roles to new agents with charter paths.
- [ ] Independent verifier confirms behavior preservation: routing, memory tags, Evidence Gate, finding-ID prefixes, and report contracts unchanged in meaning.