# Restart State

Use this reference when `workflows/restart-save.md` or `workflows/restart-load.md` is selected. It defines the canonical clean-chat restart contract for massa-ai.

## Source Authority

Use this precedence order:

1. `.specs/` files loaded from the repository — canonical project state.
2. Current repository source for implementation/code evidence only.
3. A handoff package as a compact human-readable summary of already-loaded artifact state.
4. Durable th0th memories for decisions, rejected approaches, reusable verification recipes, and repeated lessons.
5. `.specs-exports/` only as optional debug output for human review.

Never reconstruct canonical restart state from `recall`, `search`, chat history, handoff prose, current source files, or `.specs-exports/`. If `.specs/` is unavailable or not writable, block restart state mutation and report the missing operation.

Chat-only plans are not resumable restart state. A plan, task list, or implementation intent that exists only in conversation history must be promoted into `.specs/` artifacts before restart-save may claim it is resumable. Otherwise restart-save may only create a shell checkpoint that warns the plan must be supplied again in the clean chat.

## Canonical Paths

Always consider these logical artifacts for project restart:

- `.specs/project/FEATURES.json`
- `.specs/project/STATE.md`
- `.specs/HANDOFF.md`
- `.specs/features/<slug>/spec.md`
- `.specs/features/<slug>/context.md`
- `.specs/features/<slug>/design.md`
- `.specs/features/<slug>/tasks.md`
- `.specs/features/<slug>/validation.md`
- `.specs/lessons.json`
- `.specs/LESSONS.md`

The active feature and current objective determine which `.specs/features/<slug>/` artifacts are required. Do not require optional phase artifacts that were explicitly skipped by the governing workflow, but record the skip reason found in the canonical state.

## Preflight Matrix

Before save or load, build a compact matrix with these columns:

| Area | Required Evidence |
|---|---|
| Required paths | `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, `.specs/HANDOFF.md`, and required active feature artifacts |
| Active feature | feature id or explicit `active_feature: null` from `.specs/project/FEATURES.json` |
| Active feature artifacts | required `.specs/features/<slug>/` paths, status, or explicit skip reason |
| Optional lessons | `.specs/lessons.json` and `.specs/LESSONS.md` present/absent result |
| Planned writes | paths expected to change in this operation |
| No-op writes | paths skipped because content already match |
| Conflicts | missing required paths or cross-artifact disagreement |

Use active-feature-only loading for feature artifacts: after resolving `active_feature`, load required `.specs/features/<slug>/` artifacts only for that active slug unless a conflict diagnosis explicitly requires metadata for another slug.

## Save Packet

A restart save must leave these fields exact enough for a new chat to continue without hidden context:

- `projectId`
- preserved `workflowSessionId`
- active feature slug or explicit `active_feature: null`
- current objective and workflow
- completed work
- pending work
- blockers and residual risks
- changed files
- approved feature artifacts and their paths
- verification commands and results
- durable decisions or lessons written
- exact next step
- new-chat instruction that tells the next agent to run `restart-load`

Write the packet into `.specs/` files, not durable memory alone. `.specs/HANDOFF.md` is the concise restart summary artifact; `.specs/project/STATE.md` owns project progress/evidence; `.specs/project/FEATURES.json` owns feature status and `active_feature`.

Allowed metadata fields in a save/load report are `path`, `status`, `active_feature`, and timestamps. Allowed content fields are compact derived summaries such as active feature, current objective, blockers, changed files, verification results, exact next step, owning workflow, and restart-load instruction.

Forbidden payloads: raw command transcripts, full artifact content dumps, raw memory dumps, raw `search` output, and raw chat history. Use summaries plus exact paths instead. Completion output must include no-op evidence when no artifact changed, memory outcome, residual risk, and the exact restart-load instruction.

## Load Packet

A restart load must produce this working state before implementation resumes:

- resolved `projectId`
- preserved `workflowSessionId`
- loaded paths and statuses
- active feature and phase artifacts
- exact next step
- blockers and verification commands
- recent durable decisions filtered against current artifacts/source
- baseline verification result or explicit skipped reason
- agreement matrix for active feature, objective, blockers, and exact next step across `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, and `.specs/HANDOFF.md`
- owning workflow for the next action

Durable memory is summarized context only after `.specs/` artifacts load and agree. Never expose full artifact content or raw memory as working context.

Every path mutated by save/load must be reloaded after writing and verified. If an operation writes `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, and `.specs/HANDOFF.md`, all three must be re-read before success.

After loading, route to the implementation workflow that owns the next action. Do not silently continue from exported projections or memory-only summaries.

## Memory Policy

Use `remember` only for durable cross-session knowledge worth reusing beyond the restart: decisions, rejected approaches, repeated lessons, and reusable verification recipes. Do not persist raw chat logs, full artifacts, command transcripts, or the restart packet as ordinary memory.

Required memory tags:

- `project:<projectId>`
- `session:<workflowSessionId>`
- `workflow:restart-save` or `workflow:restart-load`
- `entity:<feature-or-domain>`
- one of `memory:working`, `memory:episodic`, `memory:semantic`, or `memory:procedural`

## Failure Handling

- `.specs/` directory missing or not writable: block save/load state mutation; do not fall back to memory or chat.
- Active feature ambiguous: ask the user or block before writing new state.
- Export only after `.specs/` load succeeds; otherwise skip `.specs-exports/` and report the missing evidence.
- `.specs-exports/` exists but `.specs/` load fails: ignore the export for runtime state and report the missing `.specs/` evidence.
<!-- validator anchors: .specs/ files | all-version dumps | export only as debug -->
