# Subagent Design

Use this reference only when designing or revising a reusable subagent role, adding a new role to `references/agent-orchestration.md`, or turning repeated delegated work into a stable role charter.

Do not load this reference for ordinary one-off delegation. For runtime delegation, use `references/agent-orchestration.md`.

## Principle

Subagents are execution units inside a harness, not independent workflow owners. In massa-th0th:

- the main agent owns workflow routing, memory recall and persistence, user-facing synthesis, and the final Evidence Gate
- reusable subagents own one bounded capability with explicit context inputs, permission limits, deterministic sensors, and a compact output contract
- prompt quality matters, but completion gates and concrete evidence matter more

## Local Task vs Skill vs Subagent

Use this decision tree before creating or revising a reusable subagent:

```text
Is the work immediate, small, and tightly coupled to the main thread?
  -> Keep it local.

Is the work reusable guidance that does not need isolated context?
  -> Use or create a skill/reference.

Is the work a one-off bounded delegation with an existing role?
  -> Use references/agent-orchestration.md with a task-specific prompt contract.

Is the work recurring, specialized, context-heavy, independently verifiable, and useful across workflows?
  -> Design a reusable subagent role with this reference.
```

Prefer a skill/reference when the value is procedure or domain knowledge. Prefer a subagent when the value is isolated context, parallel work, or independent verification.

Reusable role threshold:

- Create or revise a reusable subagent role only when the work recurs across workflows, needs isolated context or independent verification, has deterministic sensors, and usually meets at least one dispatch trigger from `references/agent-orchestration.md`: explicit delegation request, >=2 independent slices, >10 files, high/critical findings, or context-firewall overflow.
- Do not create a role for one-off local tasks, overlapping write sets, unresolved user intent, or tasks that need full conversation history.

## Role Charter Template

Use this shape when adding a reusable role or writing a subagent definition. Keep the charter short enough that the main agent can pass it without dragging unrelated workflow history.

```markdown
## Role: [kebab-case-name]

Purpose: [one responsibility]

Trigger description:
- Use when [specific workflow condition or user phrase].
- Do not use when [local task, unresolved intent, overlapping role, or unsafe write scope].

Permissions:
- Default: read-only.
- Write access only when the task has a disjoint write set and concrete verification.
- Model: inherit by default; use a cheaper/faster model only for low-risk mechanical checks.

Context inputs:
- exact projectId
- exact parent `workflowSessionId` and child session tag; repeated-search roles
  receive their own ephemeral Synapse session
- workflow name and role name
- scope and file/module ownership
- relevant recalled facts and source pointers
- exclusions and what to avoid redoing
- allowed tools and mutation level
- deterministic validation expected
- context-firewall limits

Process:
1. Confirm the scope and refusal conditions.
2. Inspect only the supplied scope plus minimal source needed to verify claims.
3. Run or recommend deterministic sensors when available.
4. Return compact findings, evidence, risks, and next step.

Output contract:
- Status: Complete, Partial, or Blocked
- Scope checked or files changed
- Evidence with commands, source locations, or artifacts
- Findings or implementation summary
- Risks and skipped checks
- Exact next step

Validation sensors:
- [tests, build, typecheck, lint, static search, artifact inspection, or source-location proof]

Memory boundary:
- Suggest durable memories only when useful.
- Do not persist broad project memory unless explicitly assigned by the main agent.
```

## Capability Packet

When a workflow dispatches a reusable role, send a capability packet rather than a loose instruction. The packet should include:

- `role`: the role name from `agent-orchestration.md`
- `purpose`: one sentence tied to this workflow
- `trigger`: why delegation is justified now
- `scope`: exact files, modules, diff, report finding, or task IDs
- `permissions`: read-only or write with disjoint write set
- `inputs`: recalled facts, source pointers, task/report IDs, constraints, and exclusions
- `sensors`: commands or concrete checks expected
- `output`: the exact output contract
- `firewall`: raw logs, diffs, snapshots, or research that must be summarized
- `memory`: whether the subagent may suggest memory and who persists it

## Quality Checklist

Before adding or revising a reusable role:

- One responsibility; no generic "helper" roles.
- Trigger description names when to use it and when not to use it.
- Scope can be represented as a bounded capability packet.
- Read-only by default; write permissions require disjoint ownership and verification.
- Output contract includes evidence, skipped checks, risk, and exact next step.
- Success depends on deterministic sensors or concrete source evidence, not self-evaluation.
- Context-firewall rule is explicit for verbose logs, diffs, snapshots, generated reports, and research.
- Main agent remains responsible for synthesis, memory persistence, and final Evidence Gate.
- Role count stays small; add a role only when repeated work justifies the overhead.

## Anti-Patterns

- Vague descriptions such as "use for general tasks" or "help with code".
- Creating a subagent for a task that should be a local step or a skill.
- Letting a subagent decide user intent, workflow routing, or final acceptance.
- Broad write permissions without a disjoint write set.
- Parallel write agents sharing files or working tree state without isolation.
- Prompt-only success claims such as "be thorough" without sensors.
- Returning raw logs, diffs, screenshots, CSVs, or research dumps to the main context.
- Creating many narrow roles before repeated need is proven.
- Persisting one-off subagent chatter as durable memory.
- Missing lifecycle closure: no status, no skipped checks, no next step.
