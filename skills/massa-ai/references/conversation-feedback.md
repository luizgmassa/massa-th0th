# Conversation Feedback

Use this reference when a massa-ai workflow needs chat-visible status updates for routing, loading, memory, NotebookLM, subagents, divergences, errors, verification, or completion.

## Principle

Conversation feedback is a user-facing progress layer, not a log system. Keep each update readable, factual, and short enough that it helps the user understand what is happening without dragging raw tool output into the chat.

## Policy Source

Read the canonical Conversation Feedback Policy from root `AGENTS.md`. If that
file is unavailable, emit concise transition updates automatically, keep each
update to 1-2 lines, and suppress chain-of-thought, raw logs, secrets, and
repeated micro-events.

## Line Shape

Each status update must be 1-2 lines. Use an emoji, a capitalized label in square brackets, and one or two plain sentences.

Do:

```md
🔵 [Start] Planning visual feedback for massa-ai. Workflow: Spec Driven. Session: Visual Feedback.
🔄 [Loading] Reading AGENTS.md and massa-ai router guidance before planning.
🧠 [Context] Found 8 relevant massa-ai memories and queried the requested NotebookLM source.
🤖 [Agent Running] Plan Critic is checking failure modes for the proposed design.
⚠️ [Divergence] Expected the legacy router path, but this checkout uses skills/massa-ai/SKILL.md.
✅ [Verified] Stale-reference checks and skill validation passed.
🏁 [Finished] Plan complete. Changed files: none. Remaining risk: none found.
```

Avoid terse machine-shaped status lines, lowercase labels, equals-sign syntax, and tiny abbreviations.

When relevant, compactly surface phase, loaded context, context pressure,
checks, risk, handoff state, queue/delegation state, sync outcome, memory
outcome, skipped checks, and residual risk. Omit fields that do not affect the
next user decision.

## Supported Labels

| Label | Use When |
|---|---|
| `Start` | A coding, planning, audit, debug, handoff, ADR, RFC, or TDD workflow begins. |
| `Routing` | The workflow, entity, project, or session is selected. |
| `Loading` | Reading a rule, skill, workflow, reference, document, NotebookLM source, or other context source. |
| `Context` | Reporting memory, search, NotebookLM, source, or repo context that was found or unavailable. |
| `Decision` | A meaningful tradeoff, scope decision, workflow choice, or default has been chosen. |
| `Agent Started` | A subagent or delegated role is launched. |
| `Agent Running` | A subagent is active, waiting, or doing a bounded task. |
| `Agent Done` | A subagent returns usable evidence, findings, implementation, or verification. |
| `Agent Blocked` | A subagent cannot complete its assigned scope or needs main-thread/user action. |
| `Divergence` | Expected context, paths, plan details, user claims, or repo reality disagree. |
| `Warning` | Work can continue, but confidence or verification is limited. |
| `Error` | A command, tool, workflow, or required check failed and needs recovery. |
| `Verified` | Deterministic checks, source inspection, or artifact validation produced evidence. |
| `Finished` | The workflow closes with changed artifacts, memory outcome, and residual risk. |

## When To Emit

Emit status updates at lifecycle boundaries and during any work phase lasting >30 seconds:

- workflow start and routing
- before loading substantial rules, workflows, references, docs, NotebookLM sources, or broad context
- after memory/search/context discovery when it changes the next step
- before and after NotebookLM, web, MCP, or shell checks expected to take >30 seconds
- after a Synapse fallback or schema divergence changes retrieval behavior;
  report the behavior, not secret values or raw session payloads
- before starting a subagent, while waiting on a long-running subagent, and after it returns
- when repo reality diverges from expected paths, names, branches, files, docs, or user-provided assumptions
- when a warning, recoverable tool failure, or blocking error appears
- after deterministic verification
- at final completion

Skip updates for micro-events such as every small file read, every search retry, or repeated polling with no new state.

## Privacy And Context Discipline

Never include private reasoning, chain-of-thought, raw logs, raw diffs, raw snapshots, raw search output, raw subagent prompts, secrets, or long tool output in feedback updates.

Use `references/context-firewall.md` when raw output is verbose. Feedback should summarize the visible state and point to evidence later in the final report.

## Subagent Feedback

When a subagent is used, the main agent reports only the role, scope, permission mode, current task, and status. Do not expose raw subagent prompts or internal deliberation.

Examples:

```md
🤖 [Agent Started] Verifier is checking the docs-only change set. Scope: massa-ai references and README.
🤖 [Agent Done] Verifier found no stale references. Skipped checks: none.
```

## Completion Feedback

Use `Verified` after checks pass or when the strongest available evidence is inspected. Use `Finished` only after the Evidence Gate summary is ready.

Example:

```md
✅ [Verified] Skill validation and stale-reference scans passed.
🏁 [Finished] Updated conversation feedback docs. Memory outcome: durable decision stored. Remaining risk: none found.
```
