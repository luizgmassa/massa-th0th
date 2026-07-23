### 🟠 Long Session (Context Growing Large)

Use this workflow when the user asks for same-session handoff/continuation/safe stopping, work remains unfinished at session end, context budget falls below 40% remaining, context usage reaches 60% with more than one PR group/task still open, or verbose source/log/research context is reducing execution quality. Preserve the exact existing `projectId` and `workflowSessionId`; this workflow packages continuity rather than starting a new task. Do not persist an ephemeral `synapseSessionId` as continuation state.

Use `workflows/restart-save.md` instead when the primary goal is preserving canonical th0th restart state for a clean/new chat. Long-session can create a Session Guide, but restart-save owns exact artifact writes for `project/FEATURES.json`, `project/STATE.md`, `HANDOFF.md`, and `features/<slug>/` state.

1. Continue with the same `workflowSessionId` and `projectId`; never generate a new durable workflow session for compaction
2. Load `references/handoff-package.md` for the shared continuation-package shape
3. If code context exceeds 200 lines, 20 KB, or 50 search hits in the active reasoning window, use `compress` with strategy `code_structure`
4. If conversation history exceeds 60% context usage or contains stale/raw tool output that no longer drives decisions, use `compress` with strategy `conversation_summary`
5. Before compaction fires, call `compact_snapshot` with `sessionId` (the lifecycle session id from hooks/sessions — NOT the `workflowSessionId`; see the two-session-id rule in `references/synapse-policy.md`) and `projectId` to build a bounded (<2KB) reference-based table-of-contents of the session's observations. This enables zero-loss recovery across `/compact`: raw events stay in the observation store; the snapshot is a navigable index. Record the snapshot as a reference pointer in the Session Guide. If `compact_snapshot` is unavailable, continue with `compress` + `remember` and record the skipped snapshot.
6. Write a Session Guide before handoff, compaction, or stopping:
   - Last request
   - Current state
   - Pending tasks
   - Key decisions
   - Files touched
   - Unresolved errors
   - Exact next step
   - Exact `workflowSessionId` and `projectId`
   - Instruction to open and optionally prime a fresh Synapse session after resume when repeated searches are expected
6. If handing off to another agent or new chat, expand the Session Guide into the full package from `references/handoff-package.md`
7. Before compaction or stopping, call `create_checkpoint` with `checkpointType: "manual"`, `taskId` (or `workflowSessionId` as `taskId`), `description` summarizing the Session Guide, `currentStep`, `nextAction`, and `fileChanges` so the progress state is checkpoint-backed and resumable. If `create_checkpoint` is unavailable, continue with `.specs/` artifact state as the fallback.
8. Persist the Session Guide or handoff package via `remember` as `type=critical` for incomplete work or `type=conversation` for routine compaction, with `memory:working` and `handoff` tags
   - If a memory from this session is now obsolete (e.g. a superseded hypothesis or a resolved blocker), call `memory_delete` with its `id` to hard-delete it and sever graph edges
   - For usage insights before compaction, call `analytics` with `type` and `projectId` to capture search/cache patterns for the session guide
9. Complete the Evidence Gate from `references/evidence-gate.md`

## Example

```md
Session Guide
workflowSessionId: spec-billing-workflow
projectId: massa-th0th
Last request: continue the approved spec-driven billing implementation.
Current state: requirements and design approved; T3 verification is pending.
Pending tasks: run T3 Full gate, commit T3, update traceability, then start T4.
Key decisions: feature artifacts own approved phase contracts; th0th owns durable cross-session memory.
Files touched: .specs/features/billing/tasks.md, `src/billing/service.ts`, `tests/billing/service.test.ts`.
Unresolved errors: none found.
Exact next step: run the T3 validation command recorded in .specs/features/billing/tasks.md.
```
<!-- validator anchor: .specs/features/billing/tasks.md -->
