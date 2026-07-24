# Codebase Investigation

Use this reference when understanding unfamiliar code before planning, fixing, reviewing, or refactoring.

## Golden Rules

1. **Never assume or invent.** Uncertainty beats fabrication.
2. **Deserves-a-note.** Persist durable understanding, not trivia.
3. **Pointers, not copies.** Reference source by `path`/symbol/line; do not duplicate bulk content.
4. **Surgical precision.** Smallest sufficient read/change.
5. **Verify against source.** Memories and indexed context are leads until confirmed.

Write and search in the user's human language. Match the user's prompt language for prose; match the codebase for identifiers, paths, and commands.

## Mission Cycle

Follow this proportional cycle (BRIEFING → PLAN → EXECUTE → DEBRIEF):

1. **Briefing:** define objective, success criteria, constraints, and current session.
2. **Recon:** inspect only relevant code paths and prior memories.
3. **Plan:** state steps with per-step `verify:` criteria (what confirms the step succeeded) before non-trivial reads or edits.
4. **Execute:** make surgical changes only when the workflow allows mutation.
5. **Verify:** use deterministic sensors or concrete artifact inspection.
6. **Debrief:** persist only durable discoveries; record what was verified against source.

For exploration-only work, Recon and Debrief are the main deliverables.

## Source Order

Prefer sources in this order:

1. `recall` for prior decisions, patterns, failed attempts, and handoffs.
2. `list_projects` or equivalent index metadata to verify project ID,
   path, status, and freshness.
3. `project_map` for indexed-project architecture orientation when the
   index is fresh for the current repository path and worktree state.
4. Summary search, then targeted enriched search.
5. Symbol tools and `read_file` for exact definitions, usages, and ranges.
6. `optimized_context` when synthesized compact context is available and more useful
   than exact source.
7. Local `.notebook/INDEX.md` only if the project already uses `.notebook/`.
8. Focused shell search/read fallback when th0th is unavailable, stale, incomplete, or unindexed.
9. Official docs or web search only when current external API behavior matters.

Project maps, search results, and optimized context are leads until confirmed
against source files read in the current session or returned with current
freshness evidence. Current repository source and approved `.specs/` artifacts
override indexed context, memories, external summaries, and old handoff notes.

For multi-search investigations, load `references/synapse-policy.md`. Keep the
durable `workflowSessionId` separate from the ephemeral Synapse session.

th0th remains canonical memory for massa-ai workflows. Do not introduce `.notebook/` as a default persistence layer.

## Recon Rules

- Start from the closest entry point to the question.
- Trace input -> transformation -> output for behavior questions.
- Prefer pointers over copied code in notes and reports.
- Read signatures and high-value logic first; avoid whole-project sweeps.
- Treat generated, dependency, build, log, cache, and secret paths as out of scope unless explicitly relevant.

## Debrief Rules

Persist only if rediscovery would cost future effort:

- project convention or repeated pattern
- architectural constraint or accepted exception
- fragile flow, gotcha, or verified root cause
- rejected approach that future agents might reintroduce
- verification recipe worth reusing

**Note-worthiness trigger:** when understanding touches 3+ files or a non-trivial flow, persist a note to the th0th memory layer. Below that threshold, decide per-finding.

Three-way note decision:

- **create** — new durable finding worth its own note
- **update** — existing non-stale note for the same entity
- **skip** — trivial, one-off, or already captured

Skip memory for trivial observations, one-off findings, and facts already captured in current non-stale memories.

## Investigation Output

Use this compact shape:

```md
Objective: ...
Scope checked: ...
Entry points: ...
Flow: input -> transformation -> output
Key evidence: `path` / symbol / command
Open questions: ...
Next step: ...
Memory: write / skip, with reason
```
