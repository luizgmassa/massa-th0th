### Agent Handoff

Use this workflow when the user asks to hand work to another agent, create an agent-to-agent continuation package, reset context safely, or package work for a new chat.

Use `workflows/long-session.md` instead when the immediate trigger is context compaction during the same session; long-session still uses `references/handoff-package.md`.
Use `workflows/restart-save.md` instead when the primary goal is preserving canonical massa-ai restart state for a clean/new chat. Agent handoff may summarize state, but restart-save owns exact `.specs/project/FEATURES.json`, `.specs/project/STATE.md`, `.specs/HANDOFF.md`, and `.specs/features/<slug>/` artifact writes.

1. Resolve/reuse `projectId` and set `workflowSessionId`: `handoff-[entity]` by default. Preserve the exact existing `workflowSessionId` only when `.specs/project/STATE.md` lists that workflow as non-`complete` (active or blocked); otherwise use `handoff-[entity]`. Exclude ephemeral Synapse IDs from the durable handoff.
2. Load shared references:
   - `references/handoff-package.md`
   - `references/codebase-investigation.md` if current state needs source verification
   - `references/agent-orchestration.md` if assigning follow-up roles
   - the `ai-context-handoff` skill (host-installed, not repo-local), when available, as an output lens only
   - Do not let `ai-context-handoff` replace this workflow's memory recall, state inspection, persistence, conditional reset instruction, or Evidence Gate.
3. Recall state:
   - `recall` -> current session, prior handoffs, decisions, blockers, rejected approaches, and verification recipes.
   - Filter stale or superseded memories before treating them as current truth.
4. Inspect concrete state when available:
   - changed files, current branch, relevant specs/tasks, failing commands, and active workflow artifacts loaded from .specs/ files when canonical restart state is needed.
   - Do not copy long diffs or chat history into the handoff.
5. Produce the package using `references/handoff-package.md`:
   - project
   - current state
   - key decisions
   - implementation plan
   - active files
   - known issues
   - rejected approaches
   - next tasks
   - sensors and validators
   - continuation rules
   - AI continuation instructions
   - context recovery
   - follow-up role charters or capability packets only when assigning specific follow-up agents; otherwise list next tasks without subagent instructions
   - Apply `ai-context-handoff` constraints when loaded: assume zero prior context, keep only high-signal continuation facts, avoid chat history and generic advice, and keep the reset instruction conditional per `references/handoff-package.md`.
6. Persist the handoff:
   - Call `handoff_begin` with `projectId`, `summary` (max 1024 chars), `nextSteps`[], `files`[], and `targetAgent` (when known) to store the handoff in the structured handoff table. This dual-writes a searchable `conversation`-type memory so the handoff is discoverable by `recall`/`search` independently of the handoff table. If `handoff_begin` is unavailable (e.g. `HANDOFFS_ENABLED=false`), fall back to `remember` + `.specs/` writes and record the skipped handoff-table write.
   - Incomplete or risky work: `type=critical`, `importance=0.95`, `memory:working`, and `handoff`.
   - Routine transfer: scored `conversation`, `memory:working`, and `handoff`.
   - Use required tags: `project:<projectId>`, `session:<workflowSessionId>`, `workflow:agent-handoff`, `entity:<entity>`, and one `memory:<tier>` tag.
7. If the handoff is intended for a new chat or different agent, include the exact reset instruction from `references/handoff-package.md`. The receiving session should call `handoff_list_pending` with `projectId` to discover open handoffs and `handoff_accept` to transition the handoff to `accepted`. If a handoff is no longer needed, call `handoff_cancel` to expire it.
8. Complete the Evidence Gate from `references/evidence-gate.md`
