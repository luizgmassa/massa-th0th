# Sub-Agent System — Design

- feature: `sub-agent-system`
- workflowSessionId: `spec-sub-agent-system`

## Design Summary

Add 12 standalone opencode agent skills under `skills/` in the product repo, each a single-purpose specialist invocable by any massa-ai workflow. A registry `skills/AGENTS.md` lists all agents and maps them to the 9 existing role charters in `references/agent-orchestration.md`. No workflow or source code is modified.

## Architecture

### Directory layout

```
skills/
  AGENTS.md                          # registry + mapping + capability-packet spec
  massa-ai-memory/SKILL.md        # existing (unchanged)
  synapse-usage/SKILL.md             # existing (unchanged)
  investigator/SKILL.md              # new
  planner/SKILL.md                   # new
  builder/SKILL.md                   # new
  reviewer/SKILL.md                  # new
  context-curator/SKILL.md           # new
  verification-agent/SKILL.md         # new
  requirements-analyst/SKILL.md       # new
  architecture-specialist/SKILL.md   # new
  test-engineer/SKILL.md             # new
  documentation-agent/SKILL.md       # new
  audit-specialist/SKILL.md          # new
  mobile-specialist/SKILL.md         # new
```

### Orchestration model

```
Workflow (orchestrator)
  │
  ├─ recall + load .specs/ artifacts
  ├─ dispatch investigator   (read-only: locate, trace, understand)
  ├─ dispatch context-curator (read-only: build Context Packet)
  ├─ dispatch planner         (read-only: produce plan)
  ├─ dispatch builder         (write: implement approved task, disjoint write set)
  ├─ dispatch reviewer        (read-only: review diff)
  ├─ dispatch verification-agent (read-only: run Verification Ladder)
  └─ Evidence Gate + persist memory
```

Workflows own routing, memory, user synthesis, and the final Evidence Gate. Agents own one bounded capability. Dispatch follows the gates and capability-packet shape in `references/agent-orchestration.md`.

## Role Mapping — New Agents ↔ Existing Roles

Existing roles in `references/agent-orchestration.md`:

| Existing role | New agent skill | Relationship |
|---|---|---|
| `investigator` | `investigator` | Identical capability; new skill is the product-repo packaging. |
| `implementer` | `builder` | Identical capability; renamed to match the request vocabulary. |
| `verifier` | `verification-agent` | Identical capability; new skill also centralizes Verification Ladder selection. |
| `domain-mapper` | `architecture-specialist` | Folded: the architecture-specialist absorbs domain-mapping plus coupling and deepening. |
| `coupling-auditor` | `architecture-specialist` | Folded into architecture-specialist. |
| `deepening-architect` | `architecture-specialist` | Folded into architecture-specialist. |
| `plan-critic` | (no new agent) | Stays as-is in `references/agent-orchestration.md`; not part of the 12. |
| `furps-analyst` | (no new agent) | Stays as-is; not part of the 12. |
| `handoff-writer` | (no new agent) | Stays as-is; not part of the 12. |
| — | `planner` | New capability: transform requests into implementation plans. |
| — | `reviewer` | New capability: diff review for bugs, regressions, smells. |
| — | `context-curator` | New capability: build the minimum Context Packet. |
| — | `requirements-analyst` | New capability: ambiguity, gaps, contradictions, implicit requirements. |
| — | `test-engineer` | New capability: test strategy, edge cases, acceptance coverage. |
| — | `documentation-agent` | New capability: README, ADR, RFC, changelog, KDoc. |
| — | `audit-specialist` | New capability: configurable 6-lens audit. |
| — | `mobile-specialist` | New capability: mobile-specific expertise, conditional invocation. |

Net: 3 identical, 3 folded into 1, 8 genuinely new = 12 agent skills. 3 existing roles (`plan-critic`, `furps-analyst`, `handoff-writer`) remain in `references/agent-orchestration.md` unchanged.

## Charter Template

Every `skills/<agent>/SKILL.md` follows this exact shape:

```markdown
---
name: <agent-name>
description: <one-paragraph trigger description for the opencode skill catalog>
license: MIT
metadata:
  author: S1LV4, luizgmassa
  version: "1.0.0"
  model_hint: <DeepSeek V4 Pro | GLM-5.2 | MiniMax M3>
  permission: <read-only | write>
---

# <Agent Name> Agent Skill

## Mission
<one sentence>

## Responsibilities
- <1..6 items>

## Restrictions
- <2..4 items>

## Inputs
<capability-packet fields this agent expects>

## Outputs
- Status: Complete | Partial | Blocked
- Scope: <files checked or changed>
- Evidence: <commands, source locations, artifacts>
- Findings: <summary>
- Risks and skipped checks
- Exact next step

## Invocation
### Use when
<trigger conditions>
### Do not use when
<refusal conditions>

## massa-ai Integration
- Context Firewall: <how this agent summarizes verbose output>
- Verification Ladder: <sensors this agent runs>
- Massa-ai Memory: <suggest only | never>
- Synapse: <own session | none>
- References: <named reference files>

## Model Hint
<advisory model + fallback note>

## Validation Sensors
<deterministic checks>

## Memory Boundary
<suggest durable memories only when useful; main agent persists>
```

## Capability Packet (dispatch contract)

Workflows send this packet when dispatching any agent. Spec from `references/agent-orchestration.md`:

- `role`: agent name from the registry
- `purpose`: one sentence tied to this workflow
- `trigger`: why delegation is justified now
- `scope`: exact files, modules, diff, report finding, or task IDs
- `permissions`: read-only or write with disjoint write set
- `inputs`: recalled facts, source pointers, task/report IDs, constraints, exclusions
- `sensors`: commands or concrete checks expected
- `output`: the exact output contract (Status, Scope, Evidence, Findings, Risks, next step)
- `firewall`: raw logs, diffs, snapshots, or research that must be summarized
- `memory`: whether the agent may suggest memory and who persists it

For `audit-specialist`, the packet also includes `lens`: one of `bugs | architecture | security | requirements | code-quality | performance`.

## Per-Agent Design

### 1. investigator
- Maps to existing role `investigator`.
- Permission: read-only.
- Model hint: DeepSeek V4 Pro.
- Responsibilities: locate implementations, understand architecture, trace execution flow, identify dependencies, estimate change impact, answer engineering questions.
- Restrictions: never modify code, never generate implementation, never perform reviews.
- Synapse: own ephemeral session for repeated searches.
- References: `references/codebase-investigation.md`, `references/agent-orchestration.md`.

### 2. planner
- New capability.
- Permission: read-only.
- Model hint: GLM-5.2.
- Responsibilities: break work into steps, identify dependencies, identify risks, suggest execution order, produce implementation strategy.
- Restrictions: never implement, never review code.
- References: `references/agent-orchestration.md`, `references/subagent-design.md`.

### 3. builder
- Maps to existing role `implementer`.
- Permission: write (disjoint write set required).
- Model hint: GLM-5.2.
- Responsibilities: modify source code, create files, update existing code, follow project conventions.
- Restrictions: never redesign architecture, never perform reviews, never generate implementation plans.
- References: `references/agent-orchestration.md`, `references/naming-standards.md`.

### 4. reviewer
- New capability.
- Permission: read-only.
- Model hint: GLM-5.2.
- Responsibilities: analyze diffs, detect bugs, detect regressions, detect code smells, detect missing edge cases, suggest improvements.
- Restrictions: never implement, never rewrite files, never plan features.
- References: `references/agent-orchestration.md`.

### 5. context-curator
- New capability.
- Permission: read-only.
- Model hint: DeepSeek V4 Pro.
- Responsibilities: decide which files to open, decide which references are relevant, retrieve memories, use Synapse when appropriate, apply Context Firewall rules, produce a concise Context Packet.
- Restrictions: never implement, never review, never plan.
- Output: a reusable Context Packet consumed by other agents.
- Synapse: own ephemeral session.
- References: `references/context-firewall.md`, `references/synapse-policy.md`, `references/mcp-tools.md`.

### 6. verification-agent
- Maps to existing role `verifier`.
- Permission: read-only.
- Model hint: GLM-5.2.
- Responsibilities: validate outputs, choose verification level, execute verification checklist, detect incomplete work, produce verification reports.
- Restrictions: never modify implementation.
- References: `references/verification-ladder.md`, `references/evidence-gate.md`.

### 7. requirements-analyst
- New capability.
- Permission: read-only.
- Model hint: DeepSeek V4 Pro.
- Responsibilities: detect ambiguity, detect missing requirements, detect contradictions, infer implicit requirements, identify uncovered scenarios.
- Restrictions: never implement.
- References: `references/spec-driven/specify.md`, `references/furps/`.

### 8. architecture-specialist
- Folds existing roles `domain-mapper`, `coupling-auditor`, `deepening-architect`.
- Permission: read-only.
- Model hint: MiniMax M3.
- Responsibilities: evaluate architecture, suggest boundaries, recommend abstractions, evaluate trade-offs, suggest modularization.
- Restrictions: never implement, never rewrite code.
- References: `references/architecture-lenses.md`, `references/architecture-domain-lens.md`, `references/architecture-coupling-lens.md`, `references/architecture-deepening-lens.md`.

### 9. test-engineer
- New capability.
- Permission: read-only default; write only test files when explicitly scoped with a disjoint write set.
- Model hint: GLM-5.2.
- Responsibilities: unit tests, integration tests, edge cases, negative scenarios, test plans, acceptance coverage.
- Restrictions: focus only on testing; no production code changes outside test files; write only when scoped + disjoint write set (same constraint as builder).
- References: `references/verification-ladder.md`.

### 10. documentation-agent
- New capability.
- Permission: read-only default; write only doc files when explicitly scoped with a disjoint write set.
- Model hint: DeepSeek V4 Pro.
- Responsibilities: README, ADR, RFC, changelog, KDoc, architecture documentation.
- Restrictions: never modify implementation; write only when scoped + disjoint write set (same constraint as builder).
- References: `references/adr-authoring.md`, `references/rfc/`.

### 11. audit-specialist
- New capability, configurable.
- Permission: read-only.
- Model hint: GLM-5.2.
- Lenses: bugs, architecture, security, requirements, code-quality, performance.
- Responsibilities: execute specialized audits through the selected lens.
- Mechanism: the `lens` field in the capability packet selects the checklist and output shape. One `SKILL.md` documents all 6 lenses; no separate agent skills per lens.
- References: `references/audit-scope.md`, `references/audit-report-io.md`, plus per-lens workflow references (bugs→`workflows/bugs/bugs-audit.md`, architecture→`references/architecture-lenses.md` + `references/architecture-*-lens.md`, security→`workflows/security/security-audit.md`, requirements→`workflows/requirements/requirements-audit.md`, code-quality→`workflows/code-quality/code-quality-audit.md`, performance→domain-specific; no separate `references/bugs/` or `references/security/` dirs exist).

### 12. mobile-specialist
- New capability, conditional.
- Permission: read-only.
- Model hint: GLM-5.2.
- Topics: Android, Kotlin, Compose, KMP, Swift, iOS, Gradle, CocoaPods, performance, lifecycle, offline sync.
- Invocation: only when the workflow detects a mobile-related project. Detection signals: `build.gradle(.kts)`, `Podfile`, `*.kt`, `*.swift`, `compose` imports, KMP `expect/actual`, `ios/` or `android/` directories.
- Refusal: non-mobile target.
- References: `references/mobile-context.md`, `references/mobile-diagnosis.md`, `references/maestro.md`.

## Registry Document (`skills/AGENTS.md`)

Sections:

1. Purpose and orchestration model.
2. Capability-packet dispatch contract.
3. Output contract (shared by all agents).
4. Agent table: Name, Purpose, Permission, Model hint, Trigger, Charter path.
5. Mapping table: new agents ↔ existing `references/agent-orchestration.md` roles.
6. How to add a 13th agent (copy template, add row).
7. Future integration note: workflows will invoke agents in a follow-up feature; this pass adds the agents only.

## Validation Approach

- File existence: all 13 files present and non-empty.
- Frontmatter: every `SKILL.md` has valid YAML with `name`, `description`, `metadata.model_hint`, `metadata.permission`.
- Section order: every `SKILL.md` has the 11 required sections in order.
- Registry integrity: every charter path in `skills/AGENTS.md` resolves to an existing file.
- Stale-reference scan: every massa-ai reference named in any `SKILL.md` exists in the symlinked skill tree.
- No workflow/source changes: `git diff` confirms only `skills/` and root `AGENTS.md` touched.

## Decisions

| ID | Decision | Rationale |
|---|---|---|
| AD-01 | 12 standalone opencode skills, not role charters in a single file | User chose standalone packaging (caveman/oh-my-opencode pattern) to prepare for migrating workflows into this repo. |
| AD-02 | Model hints advisory in frontmatter, not enforced | opencode does not enforce per-skill models; advisory matches graceful degradation. |
| AD-03 | Map 3 identical + 3 folded + 8 new = 12 | Avoids duplication with existing role charters; registry documents the mapping. |
| AD-04 | Registry + charters only, no workflow rewrite | User chose lowest risk; preserves workflow semantics. |
| AD-05 | audit-specialist is one configurable agent, not six | Request explicitly says single configurable agent with lenses. |
| AD-06 | mobile-specialist conditional on project detection | Request says invoke only when mobile-related. |
| AD-07 | Location is product repo `skills/`, not the symlinked skill | User chose product repo; existing repo-local skills set the convention. |

<!-- validator anchors: skills/AGENTS.md | skills/<agent>/SKILL.md | 12 agents | mapping table | no workflow changes -->