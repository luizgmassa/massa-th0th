### Restart Load

Use this workflow in a new or clean chat when the user asks to load saved restart state, resume from canonical `.specs/` state, continue a saved plan, or start implementation after a planning chat. Use `workflows/agent-handoff.md` instead when the requested output is only a transfer package. Use `workflows/long-session.md` instead for same-session context compaction.

1. Resolve `projectId` from the prompt, workspace, or th0th project memory. Resolve the target `workflowSessionId` from the user instruction, `.specs/HANDOFF.md`, active feature state, or prior exact artifact metadata; do not use a new session id when resuming saved work.
2. Load shared references:
   - `references/restart-state.md`
   - `references/spec-driven/artifact-store.md`
   - `references/spec-driven/memory.md`
   - `references/evidence-gate.md`
   - `references/codebase-investigation.md` only when source verification is needed before implementation.
3. Load canonical state from `.specs/` files:
   - `.specs/project/FEATURES.json`
   - `.specs/project/STATE.md`
   - `.specs/HANDOFF.md`
   - required active feature artifacts under `.specs/features/<slug>/`, including `spec.md`, `context.md`, `design.md`, `tasks.md`, and `validation.md` when present or required.
   - `.specs/lessons.json` and `.specs/LESSONS.md` when they exist.
4. Produce a load report before any mutation:
   - logical path
   - status
   - active feature
   - agreement result
   - exact next step
   - owning workflow
   - baseline result or explicit skipped reason
   Load metadata first (e.g., inspect `active_feature` from `FEATURES.json`, read only the Decisions section of `STATE.md`). Load exact content only for the active artifacts needed to validate the next step.
5. Validate source authority before continuing:
   - confirm `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, and `.specs/HANDOFF.md` agree on active feature, objective, blockers, and exact next step.
   - build an agreement matrix with one row each for active feature, objective, blockers, and exact next step, with per-artifact value and pass/fail result.
   - ignore `.specs-exports/` for runtime state; it may only help humans inspect a projection.
   - do not expose raw command transcripts, full artifact JSON, or raw chat history as working context.
6. Recall durable memory with `th0th_recall` for the resolved `projectId`, `workflowSessionId`, and active entity only after `.specs/` artifacts load and agree. Treat memories as summarized context only; discard stale or superseded facts that conflict with `.specs/` artifacts or current source.
7. Inspect current source only for implementation evidence needed by the next step. Do not treat source files as canonical project state.
8. Run baseline verification before mutation when the repo harness or loaded state names a baseline command, commonly `rtk ./init.sh`; if it fails, report the failure as current baseline state before adding scope.
9. Present the loaded restart state:
   - `projectId`
   - preserved `workflowSessionId`
   - active feature and workflow
   - loaded logical paths
   - completed work
   - pending work
   - blockers and risks
   - exact next step
   - intended owning workflow for implementation.
10. Continue by routing to the owning workflow for the exact next action. Preserve the same `workflowSessionId` unless the user explicitly starts a new feature.
11. If restart-load mutates `.specs/` files, reload every mutated file after writing and verify content before success. Report no-op writes when content and status already match.

## Failure Handling

- `.specs/` directory missing or not readable: block restart load; do not fall back to chat history, current source, or durable memory.
- Required project artifact missing: block unless the current operation is an approved first-time initialization.
- Artifact disagreement: block and report the conflicting logical paths before implementation.
- Baseline verification unavailable or failing: report the skipped reason or failure and keep the loaded state active, but do not claim implementation readiness.
all-version dumps
.specs/features/<slug>/tasks.md
