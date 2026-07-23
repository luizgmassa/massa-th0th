### Restart Save

Use this workflow when the user asks to save the old chat, preserve canonical restart state, prepare a clean implementation chat, or close a planning/execution chat while keeping the next chat restartable. Use `workflows/agent-handoff.md` instead when the primary deliverable is an agent-to-agent continuation package. Use `workflows/long-session.md` instead when the immediate need is same-session compaction.

1. Resolve/reuse `projectId` and preserve the active `workflowSessionId`; do not generate a new durable session for a restart save.
2. Load shared references:
   - `references/restart-state.md`
   - `references/spec-driven/artifact-store.md`
   - `references/spec-driven/memory.md`
   - `references/evidence-gate.md`
   - `references/handoff-package.md` only when the user also asks for a human-readable transfer package.
3. Load current canonical state from `.specs/` files:
   - `.specs/project/FEATURES.json`
   - `.specs/project/STATE.md`
   - `.specs/HANDOFF.md`
   - required `.specs/features/<slug>/` artifacts for the active feature, including `spec.md`, `context.md`, `design.md`, `tasks.md`, and `validation.md` when they exist or are required by the governing workflow.
   - `.specs/lessons.json` and `.specs/LESSONS.md` when they exist.
4. Build the restart preflight matrix from `references/restart-state.md`: required logical paths, active feature, active feature artifacts, optional lessons, planned writes, no-op writes, and conflicts.
5. Enforce the chat-only plan invariant:
   - Chat-only plans are not resumable restart state.
   - If no canonical feature or plan artifact exists for the user's expected continuation, either ask whether to promote the plan into `.specs/` artifacts before saving or save only a shell checkpoint.
   - A shell checkpoint must warn that the plan must be supplied separately in the clean chat and must not claim the plan is resumable.
6. Build the canonical restart save packet from exact artifact state:
   - `projectId`
   - preserved `workflowSessionId`
   - active feature slug or explicit `active_feature: null`
   - current objective and workflow
   - completed work
   - pending work
   - blockers and residual risks
   - changed files
   - verification commands and results
   - approved feature artifacts with logical paths
   - exact next step
   - new-chat instruction: `Use massa-th0th restart-load for project <projectId> and workflowSessionId <workflowSessionId>; load .specs/ artifacts before implementation.`
7. Keep the save report metadata-first:
   - Allowed metadata fields: logical path, status, feature, timestamps.
   - Allowed content fields: compact derived summaries, exact next step, owning workflow, verification results, blockers, memory outcome, residual risk, and restart-load instruction.
   - Forbidden payloads: raw command transcripts, full artifact JSON, all-version dumps, raw memory dumps, raw search output, and raw chat history.
8. Write updated `.specs/` files directly:
   - update `.specs/project/FEATURES.json` for feature status, `active_feature`, and completion evidence.
   - update `.specs/project/STATE.md` for current objective, progress, blockers, changed files, verification evidence, decisions, and exact next step.
   - update `.specs/HANDOFF.md` as the concise restart summary artifact.
   - Re-read every mutated file after writing to verify content.
   - If content and status already match, record no-op evidence instead of rewriting.
9. Persist durable memory only for reusable decisions, rejected approaches, repeated lessons, or verification recipes. `th0th_remember` must not be the only place restart state exists.
10. Optionally export `.specs-exports/` as an untracked debug projection (`cp -r .specs/ .specs-exports/`). State that the export is not canonical, not runtime fallback, and not completion evidence.
11. Complete the Evidence Gate and report saved logical paths, no-op writes, memory outcome, optional export path, residual risk, and the exact instruction for the next clean chat.

## Failure Handling

- `.specs/` directory missing or not writable: block restart save mutation; do not fall back to chat history or durable memory.
- Active feature ambiguous: ask for the intended feature before writing state.
- Required phase artifact missing: block unless the governing workflow explicitly skipped that phase and the skip reason is present in `.specs/project/STATE.md` or the feature artifacts.
promoted into .specs/ artifacts
re-read every mutated file
no-op evidence

<!-- validator anchors: `project/features.json` | `project/state.md` | `handoff.md` | `features/<slug>/spec.md` | `features/<slug>/validation.md` | normal restart-save must not run `import-legacy` -->
<!-- validator anchors: promote the plan into .specs/ artifacts | shell checkpoint | preflight matrix | planned writes | no-op writes | .specs-exports/ | not canonical | write .specs/ files directly | active-feature-only loading | metadata-only loading | verify content after write | reload every mutated logical path -->
