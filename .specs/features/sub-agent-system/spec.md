# Sub-Agent System — Specification

- feature: `sub-agent-system`
- projectId: `massa-ai`
- workflowSessionId: `spec-sub-agent-system`
- workflow: spec-driven (Large/Complex)
- branch: `main` (new branch `spec-sub-agent-system`)
- sizing: Large — 13 new files (1 registry + 12 agent skills), 1 doc update, cross-cutting integration points

## Objective

Design and implement a reusable sub-agent system for the massa-ai product repository that complements the existing workflow architecture instead of replacing it. Workflows remain the orchestrators; sub-agents are single-purpose specialists any workflow can invoke.

## Context

massa-ai today ships complete engineering workflows (feature, debug, spec-driven, RFC, TDD, audits, etc.). Many workflows repeat the same responsibilities inline: codebase investigation, planning, implementation, review, verification, context curation, requirements analysis, architecture guidance, test strategy, documentation, and audits. The existing `references/agent-orchestration.md` + `references/subagent-design.md` inside the symlinked massa-ai skill already define 9 role charters and a capability-packet dispatch model, but they live outside this product repo and are guidance-only.

This feature promotes the repeated responsibilities into 12 standalone, independently invocable opencode agent skills in the product repo, following the caveman/oh-my-opencode packaging pattern (one folder + `SKILL.md` per agent). The existing role charters are the source of truth for capability boundaries; the new agent skills make them first-class, discoverable, and reusable from any workflow.

## Scope

### In Scope

- 12 agent skills under `skills/` in the product repo, each with a `SKILL.md`:
  1. investigator (maps to existing role `investigator`)
  2. planner (new)
  3. builder (maps to existing role `implementer`)
  4. reviewer (new)
  5. context-curator (new)
  6. verification-agent (maps to existing role `verifier`)
  7. requirements-analyst (new)
  8. architecture-specialist (maps to existing roles `domain-mapper`, `coupling-auditor`, `deepening-architect`)
  9. test-engineer (new)
  10. documentation-agent (new)
  11. audit-specialist (configurable lens: bugs, architecture, security, requirements, code-quality, performance)
  12. mobile-specialist (Android/Kotlin/Compose/KMP/Swift/iOS/Gradle/CocoaPods/lifecycle/offline-sync)
- A registry document `skills/AGENTS.md` listing all agents with invocation rules, model hints, and ownership boundaries.
- Update `AGENTS.md` product root to list the new repo-local agent skills.
- Each `SKILL.md` contains: mission, responsibilities, restrictions, inputs, outputs, invocation rules, model hint, and integration with massa-ai concepts (Th0th Memory, Synapse, Context Firewall, Verification Ladder, References, Lessons).

### Out of Scope

- Rewriting existing massa-ai workflow `.md` files to replace duplicated prompts with agent invocations (deferred to a follow-up feature after the user migrates workflows into this repo).
- Creating an opencode subagent runtime or a new dispatch mechanism (uses the existing opencode skill + task tool model).
- Code changes to `packages/` or `apps/` (docs/skill artifacts only).
- Per-agent automated test harnesses (charter validation is manual via stale-reference + existence scans).
- Model enforcement at dispatch time (model hints are advisory; workflows may override).

## Guiding Principles

- Workflows remain responsible for orchestration.
- Sub-agents are single-purpose specialists with one responsibility only.
- Every agent is reusable from any workflow.
- No duplicated prompting across agents or workflows.
- Preserve existing concepts: Th0th Memory, Synapse, Context Firewall, Verification Ladder, References, Lessons, workflow conventions.
- Architecture evolves from `Workflow → Large Prompt` into `Workflow → Investigator → Context Curator → Planner → Builder → Reviewer → Verification`, where workflows orchestrate and specialists perform.

## Requirements

### FR-01 — Agent skill packaging
Each of the 12 agents lives at `skills/<agent-name>/SKILL.md` with YAML frontmatter (`name`, `description`, `license: MIT`, `metadata.author`, `metadata.version`) matching the existing repo-local skills (`massa-ai-memory`, `synapse-usage`).

### FR-02 — Single responsibility
Each agent `SKILL.md` declares exactly one mission, a bounded responsibility list, and an explicit restrictions list. No agent owns more than one responsibility.

### FR-03 — Restrictions enforced in prose
Each `SKILL.md` states what the agent must never do (e.g., investigator never modifies code; planner never implements; builder never redesigns architecture; reviewer never rewrites files). Restrictions are explicit, not implied.

### FR-04 — Inputs and outputs contract
Each `SKILL.md` declares the inputs it expects (capability packet fields) and the outputs it returns (status, scope, evidence, findings, risks, exact next step), aligned with the massa-ai output contract.

### FR-05 — Invocation rules
Each `SKILL.md` declares when a workflow should invoke it (trigger conditions) and when not to (refusal conditions), referencing the dispatch gates from `agent-orchestration.md`.

### FR-06 — Model hint (advisory)
Each `SKILL.md` records a `model_hint` field with the recommended model from the request (DeepSeek V4 Pro / GLM-5.2 / MiniMax M3). The hint is advisory; the dispatching workflow may override based on availability and cost. No hard enforcement.

### FR-07 — massa-ai concept integration
Each `SKILL.md` integrates the relevant massa-ai concepts:
- Context Firewall: agents summarize verbose output and never return raw dumps.
- Verification Ladder: agents declare the deterministic sensors they run.
- Th0th Memory: agents may suggest durable memories; main agent persists.
- Synapse: repeated-search agents (investigator, context-curator) receive an ephemeral Synapse session.
- References: agents point to the relevant massa-ai reference files by name.
- Lessons: agents surface reusable failures for lesson distillation.

### FR-08 — Registry document
`skills/AGENTS.md` is the single registry. It lists all 12 agents with: name, one-line purpose, read/write permission, model hint, trigger, and a pointer to the charter `SKILL.md`. It also documents the capability-packet shape workflows must send and the output contract every agent returns.

### FR-09 — Mapping to existing roles
The registry documents the mapping between the 12 new agent skills and the 9 existing role charters in `references/agent-orchestration.md`. Identical responsibilities are aliased (investigator, verifier, implementer→builder). Genuinely new agents get fresh charters. No duplicated responsibility between the registry and the existing roles table.

### FR-10 — Audit specialist configurability
The audit-specialist agent supports 6 lenses (bugs, architecture, security, requirements, code-quality, performance) through a single configurable `SKILL.md`. The lens is passed as a capability-packet field at dispatch time; the agent adapts its checklist and output shape per lens. No six separate agent skills.

### FR-11 — Mobile specialist conditional invocation
The mobile-specialist agent is invoked only when the workflow detects a mobile-related project (Android, iOS, KMP, Compose, Swift). The `SKILL.md` declares the detection signals and the refusal condition (non-mobile target).

### FR-12 — Product AGENTS.md update
The product root `AGENTS.md` "Available Skills (repo-local)" section is updated to list the 12 new agent skills alongside the existing `massa-ai-memory` and `synapse-usage`.

### FR-13 — No workflow rewrite
This feature does not modify any existing massa-ai workflow `.md` file. Workflow integration is documented as future work in the registry, not executed in this pass.

### FR-14 — No code changes
No source files in `packages/`, `apps/`, `benchmarks/`, or `scripts/` are modified. Only `skills/` and the root `AGENTS.md` are touched.

### FR-15 — Idempotent and additive
All new files are additive. No existing file is deleted. The feature is safe to re-run; no destructive operations.

## Acceptance Criteria

### AC-01 — All 12 agents present
`skills/<agent-name>/SKILL.md` exists for each of the 12 agents listed in FR-01. Each file has valid YAML frontmatter with `name` matching the folder and a non-empty `description`.

### AC-02 — Each agent is single-responsibility
For each `SKILL.md`, the mission is one sentence, the responsibilities list has >=1 and <=6 items, and the restrictions list has >=2 items. No two agents share the same mission sentence.

### AC-03 — Inputs/outputs contract present
Each `SKILL.md` contains an `## Inputs` section and an `## Outputs` section. The Outputs section lists: Status, Scope, Evidence, Findings, Risks, Exact next step.

### AC-04 — Invocation rules present
Each `SKILL.md` contains an `## Invocation` section with "Use when" and "Do not use when" subsections.

### AC-05 — Model hint present
Each `SKILL.md` frontmatter contains `metadata.model_hint` with one of: `DeepSeek V4 Pro`, `GLM-5.2`, `MiniMax M3`.

### AC-06 — Registry complete
`skills/AGENTS.md` lists all 12 agents in a table with columns: Name, Purpose, Permission, Model hint, Trigger, Charter. Every charter path resolves to an existing file.

### AC-07 — Mapping table present
`skills/AGENTS.md` contains a mapping table between the 12 new agents and the 9 existing `references/agent-orchestration.md` roles.

### AC-08 — Audit specialist lenses
`skills/audit-specialist/SKILL.md` documents all 6 lenses and shows how the lens field flows from the capability packet into the agent's checklist and output.

### AC-09 — Mobile specialist conditional
`skills/mobile-specialist/SKILL.md` declares detection signals and a refusal condition for non-mobile targets.

### AC-10 — Product AGENTS.md updated
Root `AGENTS.md` "Available Skills (repo-local)" section lists the 12 new agent skills.

### AC-11 — No workflow files modified
`git diff` shows no changes to any file under `skills/massa-ai/` symlink target or to any massa-ai workflow `.md`.

### AC-12 — No source code modified
`git diff` shows no changes under `packages/`, `apps/`, `benchmarks/`, `scripts/` (excluding `scripts/lessons.py` if it runs).

### AC-13 — Stale-reference scan clean
A scan of all `SKILL.md` files for referenced massa-ai reference files (e.g., `references/agent-orchestration.md`) confirms every named reference exists in the symlinked skill tree.

### AC-14 — Charter validation
Every `SKILL.md` passes the inline charter checklist from `references/subagent-design.md`: one responsibility, explicit trigger, bounded scope, read-only default, output contract with evidence, deterministic sensors, context-firewall rule, main-agent synthesis boundary.

### AC-15 — File existence check
All 13 new files (1 registry + 12 charters) exist and are non-empty.

## Non-Functional Requirements

### NFR-01 — Conciseness
Each `SKILL.md` is <= 120 lines. Prompts are concise and focused; no duplication of prompts already present in massa-ai workflows or references.

### NFR-02 — Consistency
All 12 `SKILL.md` files share the same section order: frontmatter, Mission, Responsibilities, Restrictions, Inputs, Outputs, Invocation, massa-ai Integration, Model Hint, Validation Sensors, Memory Boundary.

### NFR-03 — Maintainability
Adding a 13th agent requires only: create `skills/<name>/SKILL.md` from the template, add one row to `skills/AGENTS.md`. No other file changes.

## Risks

### R-01 — Pattern mismatch with massa-ai router
The massa-ai router is a load-only-what-you-need skill. Adding 12 agent skills increases the skill catalog surface. Mitigation: agent skills are repo-local (not installed globally), so they only appear in this repo's catalog and do not pollute other projects.

### R-02 — Duplication with existing role charters
The 9 existing roles in `references/agent-orchestration.md` overlap 3 of the 12 agents. Mitigation: the registry maps new→existing and documents that the new agent skills are the product-repo packaging of the same capabilities; the role charters remain the canonical capability spec inside the skill.

### R-03 — Workflow semantic drift
If workflows later rewrite their inline prompts to invoke agents, semantics could drift. Mitigation: this feature does NOT rewrite workflows. Future integration is a separate spec-driven feature with its own validation.

### R-04 — Model availability
Pinned models (DeepSeek V4 Pro, MiniMax M3) may be unavailable in some environments. Mitigation: model hints are advisory; workflows fall back to the configured default model.

## Dependencies

- Existing repo-local skills `massa-ai-memory` and `synapse-usage` (convention source).
- Existing `references/agent-orchestration.md` and `references/subagent-design.md` in the symlinked massa-ai skill (capability spec source).

## Assumptions

- The product repo `skills/` directory is the correct home for repo-local opencode skills (confirmed by existing `massa-ai-memory` and `synapse-usage`).
- opencode discovers repo-local skills under `skills/` automatically (confirmed by `AGENTS.md` listing them as repo-local).
- The user will migrate massa-ai workflows into this repo in a follow-up, at which point workflow integration (replacing duplicated prompts with agent invocations) becomes a separate feature.

## Out-of-Scope Artifacts

- No `design.md` diagrams beyond the registry layout (this is a docs/skill feature, not a code feature).
- No `tasks.md` beyond the linear build order (all 12 agents follow the same template; order is deterministic).

<!-- validator anchors: skills/AGENTS.md | skills/<agent>/SKILL.md | AGENTS.md | no workflow .md changes | no source code changes -->