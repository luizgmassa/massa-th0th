# Agent Orchestration

Use this reference when a workflow benefits from isolated context, parallel work, or independent verification.

Load `references/context-firewall.md` first when the delegated work may involve verbose logs, snapshots, generated reports, external research, or broad source inspection.

Load `references/subagent-design.md` only when designing or revising reusable subagent roles, adding a new role to this file, or turning repeated delegated work into a stable role charter. Do not load it for ordinary one-off delegation.

## Principle

The main agent is the orchestrator. It owns:

- workflow routing
- memory recall and persistence
- user questions and trade-off synthesis
- conversation feedback status updates
- final Evidence Gate
- final user-facing report

Subagents do bounded work only. Do not delegate everything.

## Delegation Gates

Delegate only when all base requirements are true and at least one dispatch trigger is true.

Base requirements:

- The task is isolated, concrete, and has a clear output contract.
- The subagent can make progress without full conversation history.
- The work is parallelizable, context-heavy, or useful as independent verification.
- The task has deterministic sensors or concrete artifact checks.
- The write set is disjoint from other active agents when edits are allowed.

Dispatch triggers:

- User explicitly asks for subagents, delegation, parallel agent work, or independent review.
- The scope has >=2 independent slices with disjoint write sets.
- The scope touches >10 files, >500 LOC, or >2 modules.
- A high/critical audit finding needs independent verification.
- Verbose context would exceed the context-firewall thresholds and can be summarized independently.

Keep local when any are true:

- The next main-agent step is blocked on the result.
- The task needs unresolved user intent.
- The work is tightly coupled across many files without a clear owner.
- The subagent would only duplicate main-agent thinking.
- Platform policy does not permit spawning an agent for this request.

## Plan Challenge Exception

Plan Challenge `plan-critic` is a standing policy exception to the normal dispatch triggers after a concrete plan exists. Always attempt a read-only `plan-critic` for both `depth: lite` and `depth: full` when subagent tooling is available and platform policy permits spawning. Normal base requirements still matter for packet quality: the critique must be bounded, read-only, and concrete, but it does not need to satisfy the ordinary dispatch triggers such as file count, module count, or explicit user delegation.

For all other roles, preserve the normal delegation gates above.

## Roles

Use these role names in prompts and memory tags when useful.

Before adding a new reusable role, load `references/subagent-design.md` and write a bounded role charter. For one-off tasks, use an existing role plus the prompt contract below instead of inventing a new role.

| Role | Use For | Read/Write | Charter |
|---|---|---|---|
| `investigator` | Trace code paths, find entry points, summarize current behavior | read-only | `skills/agents/investigator/SKILL.md` |
| `implementer` → `builder` | Execute one atomic task with a disjoint write set | write | `skills/agents/builder/SKILL.md` |
| `verifier` → `verification-agent` | Independently run sensors and inspect whether claims hold | read-only | `skills/agents/verification-agent/SKILL.md` |
| `domain-mapper` → `architecture-specialist` | Identify subdomains, bounded contexts, language conflicts, cohesion | read-only | `skills/agents/architecture-specialist/SKILL.md` (lens: `domain`) |
| `coupling-auditor` → `architecture-specialist` | Analyze strength, distance, volatility, and risky dependencies | read-only | `skills/agents/architecture-specialist/SKILL.md` (lens: `coupling`) |
| `deepening-architect` → `architecture-specialist` | Find shallow modules and deepening opportunities | read-only | `skills/agents/architecture-specialist/SKILL.md` (lens: `deepening`) |
| `plan-critic` | Stress-test a constructed plan using The Fool mode and return bounded critique | read-only | role-based (no charter) |
| `furps-analyst` | Analyze one FURPS+ dimension of a PRD/ADR against the checklist and return structured findings | read-only | role-based (no charter) |
| `handoff-writer` | Build a compact continuation package | read-only unless asked to save | role-based (no charter) |

**Role mapping:** `investigator`→`investigator` (identical); `implementer`→`builder` (renamed); `verifier`→`verification-agent` (renamed, centralizes Verification Ladder); `domain-mapper`+`coupling-auditor`+`deepening-architect`→`architecture-specialist` (three roles folded into one specialist; the `lens` input field selects the sub-mode). Workflows dispatch the new agent names via named dispatch blocks; the old role names above are kept for traceability only.

## Capability Packet

When dispatching a subagent, send a compact capability packet rather than a loose instruction. Include:

- role and purpose for this workflow
- trigger: why delegation is justified now
- exact scope: files, modules, diff, report finding, task IDs, or artifact
- permissions: read-only or write with disjoint ownership
- inputs: recalled facts, source pointers, constraints, and exclusions
- sensors: expected commands or concrete checks
- output: the exact output contract
- firewall: raw logs, diffs, snapshots, reports, or research that must be summarized
- memory boundary: whether the subagent may suggest memories and who persists them
- exact next step: what the main agent should do with the result

## Prompt Contract

Every delegated task must include:

- exact `projectId`
- exact parent `workflowSessionId` or child session tag
- workflow name
- role name
- scope and file/module ownership
- facts already known
- what to avoid redoing
- allowed tools or mutation level
- deterministic validation expected
- context-firewall limit: what raw output must not be returned
- skipped-check policy and how to report unavailable sensors
- memory boundary: whether to suggest memories only or write none
- exact output format

## Output Contract

Every subagent returns:

- Status: `Complete`, `Blocked`, or `Partial`
- Scope checked or files changed
- Evidence: command result, static finding, source location, or artifact inspected
- Findings or implementation summary
- Risks and skipped checks
- Exact next step

Subagents must summarize verbose research, logs, snapshots, diffs, search output,
and transcripts. The main agent should receive only evidence, findings, risk,
skipped checks, memory suggestions when allowed, and the next step, not raw dumps.

## Conversation Feedback

Use `references/conversation-feedback.md` when subagent lifecycle visibility would help the user understand what is running. Keep status updates to 1-2 human-readable lines.

Use these labels for delegated work:

- `Agent Started` when a role is launched with scope and permission mode.
- `Agent Running` when waiting on a long-running role or reporting its current bounded task.
- `Agent Done` when the role returns usable evidence, findings, implementation, or verification.
- `Agent Blocked` when the role cannot complete its assigned scope.

Do not expose raw subagent prompts, raw logs, private reasoning, or full output dumps in feedback lines.

Example:

```md
🤖 [Agent Started] Verifier is checking the docs-only change set. Scope: massa-th0th references and README.
🤖 [Agent Done] Verifier found no stale references. Skipped checks: none.
```

## Plan-Critic Contract

Use `plan-critic` only after a concrete plan exists. Dispatch it with the capability packet above and the standard output contract. The subagent receives the plan, scope, constraints, compact recalled facts/evidence, selected depth, selected The Fool mode only for full gates, known risks, verification recipe, parent identifiers, and context-firewall limits. It never receives full conversation context.

For `depth: lite`, the packet uses the low-risk checklist and does not include The Fool mode references. It returns:

- strongest low-risk challenges
- assumption most likely to fail
- deterministic check that would falsify success
- high-risk or broad-scope trigger found, if any
- `escalate_to_full: true|false`
- escalation reason

For `depth: full`, or after lite escalation, the main agent selects the mode, loads the relevant The Fool references, and dispatches a full packet. It returns:

- selected mode
- steelmanned thesis
- 3-5 strongest challenges
- severity: `critical`, `high`, `medium`, or `low`
- affected plan section
- evidence gap or assumption at risk
- required revision or accepted-risk framing
- confidence impact
- exact next step

The main agent owns final synthesis and applies the configured Plan Challenge Policy from root `AGENTS.md`.

## Memory Rules

- Main agent persists durable conclusions after synthesis.
- Subagents may suggest memory content but should not create broad project memories unless explicitly assigned.
- Use tags such as `agent:verifier` or `agent:domain-mapper` only when they improve retrieval.
- Do not persist one-off subagent chatter.

## Synapse Isolation

For delegated tasks that expect repeated searches:

- create one ephemeral Synapse session per subagent
- pass only that agent's `synapseSessionId` to its `search` calls
- keep parent/child `workflowSessionId` values in memory tags and output packets
- never share one Synapse session across concurrent agents
- allow stateless fallback when session creation or adapter translation fails

## Guardrails

- No self-evaluation: claims need deterministic sensors or concrete source evidence.
- No hidden scope expansion: subagents must not improve adjacent code.
- No context dragging: send only task-specific source pointers and constraints, and receive compact summaries only.
- No conflicting writes: parallel implementers need disjoint files or worktrees.
