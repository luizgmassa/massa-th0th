# Sub-Agent Registry

Single registry for the 12 reusable sub-agent skills in this repo. Workflows remain the orchestrators; these agents are single-purpose specialists any workflow can invoke via the opencode task tool.

## Orchestration Model

```
Workflow (orchestrator)
  │  owns: routing, memory recall/persistence, user synthesis, Evidence Gate
  │
  ├─ dispatch investigator        (read-only: locate, trace, understand)
  ├─ dispatch context-curator     (read-only: build Context Packet)
  ├─ dispatch planner             (read-only: produce plan)
  ├─ dispatch builder             (write: implement approved task, disjoint write set)
  ├─ dispatch reviewer            (read-only: review diff)
  ├─ dispatch verification-agent  (read-only: run Verification Ladder)
  └─ Evidence Gate + persist memory
```

Workflows own routing, memory, user-facing synthesis, and the final Evidence Gate. Agents own one bounded capability. Dispatch follows the gates and capability-packet shape in `references/agent-orchestration.md` (symlinked massa-th0th skill).

## Capability Packet (dispatch contract)

Workflows send this packet when dispatching any agent:

- `role`: agent name from the table below
- `purpose`: one sentence tied to this workflow
- `trigger`: why delegation is justified now (must satisfy a dispatch gate from `references/agent-orchestration.md`)
- `scope`: exact files, modules, diff, report finding, or task IDs
- `permissions`: read-only or write with disjoint write set
- `inputs`: recalled facts, source pointers, task/report IDs, constraints, exclusions
- `sensors`: commands or concrete checks expected
- `output`: the exact output contract (see below)
- `firewall`: raw logs, diffs, snapshots, or research that must be summarized, not returned raw
- `memory`: whether the agent may suggest memory and who persists it (default: suggest only; main agent persists)

For `audit-specialist`, the packet also includes `lens`: one of `bugs | architecture | security | requirements | code-quality | performance`.

## Output Contract (shared by all agents)

Every agent returns:

- **Status**: `Complete` | `Partial` | `Blocked`
- **Scope**: files checked or changed
- **Evidence**: commands, source locations, artifacts inspected
- **Findings**: summary of what was found or implemented
- **Risks and skipped checks**: with reasons
- **Exact next step**: what the main agent should do with the result

Agents summarize verbose output. They never return raw logs, diffs, snapshots, or research dumps to the main context (Context Firewall).

## Agent Table

| Name | Purpose | Permission | Model hint | Trigger | Charter |
|---|---|---|---|---|---|
| investigator | Read and understand the codebase | read-only | DeepSeek V4 Pro | Locate implementations, trace flow, estimate impact | `agents/investigator/SKILL.md` |
| planner | Transform requests into implementation plans | read-only | GLM-5.2 | Break work into steps, identify risks, order execution | `agents/planner/SKILL.md` |
| builder | Implement approved plans | write | GLM-5.2 | Modify source code with a disjoint write set | `agents/builder/SKILL.md` |
| reviewer | Review implementation quality | read-only | GLM-5.2 | Analyze diffs for bugs, regressions, smells | `agents/reviewer/SKILL.md` |
| context-curator | Prepare the minimum high-quality Context Packet | read-only | DeepSeek V4 Pro | Decide files to open, retrieve memories, apply firewall | `agents/context-curator/SKILL.md` |
| verification-agent | Centralize Verification Ladder logic | read-only | GLM-5.2 | Validate outputs, choose verification level | `agents/verification-agent/SKILL.md` |
| requirements-analyst | Analyze requirements before implementation | read-only | DeepSeek V4 Pro | Detect ambiguity, gaps, contradictions, implicit needs | `agents/requirements-analyst/SKILL.md` |
| architecture-specialist | Provide architectural guidance | read-only | MiniMax M3 | Evaluate architecture, suggest boundaries, trade-offs | `agents/architecture-specialist/SKILL.md` |
| test-engineer | Generate testing strategy | read-only (test-write when scoped) | GLM-5.2 | Unit, integration, edge cases, acceptance coverage | `agents/test-engineer/SKILL.md` |
| documentation-agent | Generate engineering documentation | read-only (doc-write when scoped) | DeepSeek V4 Pro | README, ADR, RFC, changelog, KDoc | `agents/documentation-agent/SKILL.md` |
| audit-specialist | Execute specialized audits through configurable lenses | read-only | GLM-5.2 | One of: bugs, architecture, security, requirements, code-quality, performance | `agents/audit-specialist/SKILL.md` |
| mobile-specialist | Provide mobile-specific expertise (conditional) | read-only | GLM-5.2 | Mobile-related project detected (Android/iOS/KMP) | `agents/mobile-specialist/SKILL.md` |

## Mapping — New Agents ↔ Existing Roles

The symlinked massa-th0th skill defines 9 roles in `references/agent-orchestration.md`. This registry maps the 12 new agent skills to those roles:

| New agent skill | Existing role | Relationship |
|---|---|---|
| investigator | `investigator` | Identical capability; new skill is the product-repo packaging. |
| builder | `implementer` | Identical capability; renamed to match the request vocabulary. |
| verification-agent | `verifier` | Identical capability; new skill also centralizes Verification Ladder selection. |
| architecture-specialist | `domain-mapper` + `coupling-auditor` + `deepening-architect` | Three roles folded into one specialist. |
| planner | — | New capability. |
| reviewer | — | New capability. |
| context-curator | — | New capability. |
| requirements-analyst | — | New capability. |
| test-engineer | — | New capability. |
| documentation-agent | — | New capability. |
| audit-specialist | — | New capability (configurable 6-lens). |
| mobile-specialist | — | New capability (conditional). |

Three existing roles remain in `references/agent-orchestration.md` unchanged: `plan-critic`, `furps-analyst`, `handoff-writer`.

## How to Add a 13th Agent

1. Create `skills/<name>/SKILL.md` from the charter template (see any existing agent skill).
2. Add one row to the Agent Table above.
3. Add one row to the Mapping table if it maps to an existing role.
4. No other file changes.

## Future Integration

This pass adds the agents only. A follow-up feature will update massa-th0th workflows to replace duplicated inline prompt sections with agent invocations where appropriate. That work is tracked separately and will have its own spec-driven validation. Do not rewrite workflows in this pass.

## massa-th0th Concepts

All agents integrate these concepts (documented per-agent in each charter):

- **Th0th Memory**: agents suggest durable memories only when useful; the main agent persists.
- **Synapse**: repeated-search agents (investigator, context-curator) receive their own ephemeral Synapse session.
- **Context Firewall**: agents summarize verbose output and never return raw dumps.
- **Verification Ladder**: agents declare the deterministic sensors they run.
- **References**: agents point to the relevant massa-th0th reference files by name.
- **Lessons**: agents surface reusable failures for lesson distillation.

<!-- validator anchors: 12 agents | mapping table | capability packet | output contract -->