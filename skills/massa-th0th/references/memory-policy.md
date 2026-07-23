# Memory Policy

Read this when writing, updating, pruning, promoting, or resolving conflicting th0th memories.

## Tiers

| Tier | Use | Persist as | Required tag |
|------|-----|------------|--------------|
| Working | Active task state, pending local intent, temporary context | Usually skip; use `conversation` only for handoff | `memory:working` |
| Episodic | Timestamped attempts, observations, command evidence, ruled-out hypotheses | `conversation` or `code` | `memory:episodic` |
| Semantic | Durable project facts, constraints, decisions, architecture patterns | `critical`, `decision`, or `pattern` | `memory:semantic` |
| Procedural | Reusable workflow, command, verification recipe, debugging protocol | `pattern` or `decision` | `memory:procedural` |

Supported th0th types are only `critical`, `conversation`, `code`, `decision`, and `pattern`.

## Observational Memory

Observational Memory is not a new storage layer. It is the discipline for deciding which execution observations become th0th memories.

- Observer mode: capture only high-signal events, decisions, failed attempts, ruled-out hypotheses, and verification recipes.
- Reflector mode: when the same lesson appears in 3+ independent sessions, promote it to semantic or procedural memory.
- Episodic observations stay lightweight: date, fact, evidence, why it matters, and what not to repeat.
- Failed or repeated tool loops become compact cognition lessons only when reusable.

A cognition lesson should use this shape:

```md
Trigger: ...
Failure pattern: ...
Prevention rule: ...
Evidence: ...
```

Persist cognition lessons as `pattern` memories with `memory:procedural` when they would prevent future repeated failures. Skip one-off tool noise.

## Allowed And Forbidden Payloads

Persist only durable decisions, rejected approaches, reusable patterns,
verification recipes, repeated lessons, and high-signal gotchas. Do not persist
raw transcripts, raw logs, copied source, raw search output, raw subagent output,
customer data, secrets, one-off observations, already-captured facts, or noisy
command output.

## Required Tags

Every persisted memory must include:

- `project:<projectId>`
- `session:<workflowSessionId>`
- `workflow:<type>`
- `entity:<name>`
- `memory:<tier>`

Add focused domain tags only when they improve future retrieval, such as `auth`, `mobile`, `tests`, `issue`, `handoff`, or `stale`.

## Write Protocol

1. Recall first using the project, entity, and likely fact name.
2. Classify the memory tier and supported th0th type.
3. Score importance with `references/decision-engine.md`.
4. Do not write duplicates. If the same fact already exists and still applies, reuse it.
5. If a new fact supersedes an old memory, write a replacement containing the date, the new fact, and why it supersedes the old one. Add `stale-replaces:<memoryId>` to the replacement; do not mark the replacement itself as `stale`.
6. If recall shows the same lesson in 3+ independent sessions, promote it to semantic or procedural memory as `pattern` or `decision`; include source memory IDs in the content.
7. Report the memory outcome in completion or handoff evidence as one of:
   written, intentionally skipped with reason, duplicate skipped, forbidden payload skipped, or failed write with recovery note.

## Example

Persist only after recall and scoring. Add `stale-replaces:<memoryId>` only when replacing a recalled memory.

```js
th0th_remember({
  projectId: "useful-agent-skills",
  sessionId: "spec-memory-routing",
  type: "decision",
  importance: 0.8,
  content: "2026-06-27 workflows/spec-driven.md owns the TLC v3 Specify, optional Design, optional Tasks, and Execute flow with mandatory independent validation as Execute's final gate. Approved feature artifacts own phase contracts, .specs/project/STATE.md owns restart state, and th0th owns durable cross-session decisions and patterns.",
  tags: [
    "project:useful-agent-skills",
    "session:spec-memory-routing",
    "workflow:spec-driven",
    "entity:massa-th0th",
    "memory:semantic",
    "stale-replaces:dec_old123" // omit unless this supersedes that memory
  ]
})
```

## Retrieval Policy

Prefer memories in this order:

1. Exact `session:<workflowSessionId>` memories for current task continuity
2. Non-stale semantic memories for project constraints and decisions
3. Recent episodic memories for attempts and evidence
4. Procedural memories for commands and verification recipes

Treat memories tagged `stale`, or old memories whose IDs are referenced by newer `stale-replaces:*` tags, as historical context rather than current truth.

Use `th0th_recall(projectId=...)` for project-scoped decisions. The v2.0.2 MCP
declaration exposes `projectId` on `th0th_memory_list`, but the verified REST
body does not; treat memory-list output as unscoped unless a runtime probe proves
the installed adapter applies the filter.
