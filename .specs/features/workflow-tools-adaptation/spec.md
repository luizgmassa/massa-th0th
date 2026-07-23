# Workflow Tools Adaptation Specification

## Problem Statement

The massa-th0th workflows (`skills/massa-th0th/workflows/`) reference only ~11 of the 52+ system tools shipped in `apps/mcp-client/src/tool-definitions.ts` and documented in `FEATURES.md`. The workflows use `th0th_*`-prefixed names (recall, remember, search, optimized_context, compress, list_projects, project_map, index, reindex, search_definitions, get_references) and never invoke the remaining capabilities: checkpoints, cross-session handoffs, bootstrap, compact_snapshot, trace_path, impact_analysis, full Synapse lifecycle (task_begin/end, prefetch), code execution (execute/execute_file/batch_execute), fetch_and_index, auto-improvement proposals, memory_update/delete, analytics, read_file, symbol_snippet, get_architecture, and hook_ingest. This leaves powerful shipped features unguided by the workflow router, so agents following massa-th0th workflows miss deterministic, first-class tool support for long-running task save/resume, cross-session continuity, code-path tracing, impact analysis, structured handoffs, compact-snapshot zero-loss across /compact, and code execution for analysis.

## Goals

- [ ] Every shipped massa-th0th system tool documented in FEATURES.md is referenced by at least one workflow where it provides a material benefit, OR is explicitly recorded as out-of-scope for workflow adoption with a reason.
- [ ] Workflows use the canonical tool names (no `th0th_` prefix) matching `tool-definitions.ts` CANONICAL_ORDER, consistent with how tools are actually exposed to agents.
- [ ] `references/th0th-tools.md` is updated to cover all 52+ tools (not just the ~20 it currently documents) so workflows can reference it as the single tool-contract source.
- [ ] Workflows that benefit from checkpoints, handoffs, compact_snapshot, bootstrap, trace_path, impact_analysis, code execution, and the full Synapse lifecycle adopt those tools in their ordered steps.
- [ ] The SKILL.md router Core Contract and Retrieval sections reflect the full tool surface.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Changing tool implementations or MCP schemas | Tools are frozen; this feature adapts workflow documentation only. |
| Adding new tools to the MCP server | No new tools; only workflow/references adoption of existing tools. |
| Rewriting workflow routing logic, precedence keys, or the router table | Routing is frozen; only tool-referencing steps inside workflow bodies change. |
| Changing the sub-agent dispatch model (already handled by `workflows-agents-consolidation`) | Agent dispatch blocks are a separate feature; this feature is about system tools. |
| Altering `lessons.py` or the lessons store | Orthogonal to tool adoption. |
| Touching `scripts/generate-subagent-artifacts.ts` or host agent files | Generator is frozen; workflows are not generated artifacts. |
| Refactoring `massa-th0th-memory` or `synapse-usage` meta-skills | Those are separate skills; this feature edits `massa-th0th` workflows + `th0th-tools.md` reference + `SKILL.md` router. |
| Adopting `hook_ingest` into workflows | `hook_ingest` is a passive-capture ingestion endpoint used by host hook scripts, not by agent workflows; agents do not call it directly. |
| Adopting `rename_project`/`merge_projects` into workflows | Those are administrative lifecycle operations, not workflow-recurring tools. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Canonical tool names = no `th0th_` prefix | Replace `th0th_recall` → `recall`, `th0th_search` → `search`, etc. in all workflows and references | `tool-definitions.ts` CANONICAL_ORDER and the OpenCode plugin expose un-prefixed names; `th0th_` prefix is a stale artifact of the th0th-era naming. The `massa-th0th-memory` SKILL.md already uses un-prefixed names. | y (assumption) |
| `references/th0th-tools.md` is the single tool-contract reference | Expand its MCP Capability Matrix to cover all 52+ tools, keep the file name for backward-compat | Workflows already point to it; renaming would break validator anchors. | y (assumption) |
| Tool adoption is selective, not blanket | Only adopt a tool in a workflow where it provides a material benefit (e.g. checkpoints in spec-driven/long-session; handoffs in agent-handoff/restart-save; trace_path/impact_analysis in debug/architecture-audit; bootstrap in onboarding; compact_snapshot in long-session; execute_file in debug/general; synapse_task_begin/end in spec-driven/feature) | Adopting every tool in every workflow would bloat workflows and violate the "minimum code" guideline. | y (assumption) |
| `get_architecture` tool is real and architecture-specific | Verified wired in `tool-defs-project.ts:114`; adopt it in `architecture-audit.md` as the architecture-map entry point alongside `project_map` | `project_map` is the general overview; `get_architecture` is the architecture-specific deep map | y (verified) |
| Graceful degradation preserved | Every new tool reference keeps the existing "if unavailable, continue with fallback" pattern from SKILL.md | Workflows must not hard-fail when a tool is absent. | y (assumption) |
| No behavior change to routing, memory tags, Evidence Gate, or failure handling | Tool adoption adds steps or replaces prose; it does not alter workflow contracts | Matches `workflows-agents-consolidation` WAC-13/14/15 precedent. | y (assumption) |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Workflows Use Canonical Tool Names ⭐ MVP

**User Story**: As a massa-th0th workflow consumer, I want workflows to reference system tools by their canonical un-prefixed names so that the references match what the MCP server and OpenCode plugin actually expose.

**Why P1**: Every other story depends on consistent naming; the `th0th_` prefix is a stale artifact that diverges from `tool-definitions.ts` and the `massa-th0th-memory` meta-skill.

**Acceptance Criteria**:

1. WHEN any file under `skills/massa-th0th/` (workflows, references, SKILL.md) is inspected THEN no `th0th_`-prefixed tool name SHALL remain; all tool references SHALL use the canonical un-prefixed names from `tool-definitions.ts` CANONICAL_ORDER.
2. WHEN `references/th0th-tools.md` is inspected THEN its MCP Capability Matrix SHALL list all tools in `tool-definitions.ts` CANONICAL_ORDER (52+ tools), each with a one-line "Primary use" note.
3. WHEN `SKILL.md` Core Contract and Retrieval And Synapse sections are inspected THEN every tool reference SHALL use the canonical un-prefixed name.

**Independent Test**: `rg 'th0th_' skills/massa-th0th/` returns zero matches across the full skill tree (workflows, references, SKILL.md).

---

### P1: Long-Running Workflows Adopt Checkpoints ⭐ MVP

**User Story**: As a developer using the spec-driven or long-session workflow on a multi-hour task, I want the workflow to create and restore checkpoints so that I can resume after interruption without losing progress state.

**Why P1**: Checkpoints are a shipped first-class feature (`create_checkpoint`/`list_checkpoints`/`restore_checkpoint`) that the spec-driven and long-session workflows describe conceptually ("checkpoint commit") but never actually invoke.

**Acceptance Criteria**:

4. WHEN `workflows/spec-driven.md` Execute phase reaches a task boundary THEN it SHALL instruct creating a checkpoint via `create_checkpoint` with `taskId`, `description`, `progressPercent`, `currentStep`, `nextAction`, `fileChanges`, and `checkpointType: "manual"` for long-running task sequences.
5. WHEN `workflows/spec-driven.md` resumes after interruption THEN it SHALL instruct calling `list_checkpoints` and `restore_checkpoint` to recover task state before continuing.
6. WHEN `workflows/long-session.md` packages a session guide THEN it SHALL instruct calling `create_checkpoint` with `checkpointType: "manual"` and `description` summarizing the session guide before compaction or stopping.
7. WHEN `workflows/restart-save.md` writes canonical restart state THEN it SHALL instruct calling `create_checkpoint` with `checkpointType: "milestone"` so the restart point is checkpoint-backed in addition to `.specs/` files.

**Independent Test**: `rg 'create_checkpoint|list_checkpoints|restore_checkpoint' skills/massa-th0th/workflows/` returns matches in spec-driven.md, long-session.md, and restart-save.md.

---

### P1: Cross-Session Handoffs Use the Handoff Tools ⭐ MVP

**User Story**: As a developer handing work between sessions or agents, I want the agent-handoff and restart workflows to actually call `handoff_begin`/`handoff_accept`/`handoff_list_pending` so that the handoff is stored in the structured handoff table, not just in memory.

**Why P1**: The `handoff_begin`/`handoff_accept`/`handoff_list_pending` tools exist specifically for this purpose and dual-write a searchable memory; the workflows currently only call `remember` and write `.specs/` files.

**Acceptance Criteria**:

8. WHEN `workflows/agent-handoff.md` persists a handoff THEN it SHALL instruct calling `handoff_begin` with `projectId`, `summary`, `nextSteps`, `files`, and `targetAgent` (when known) in addition to the existing `remember` and `.specs/` writes.
9. WHEN `workflows/agent-handoff.md` or `workflows/restart-load.md` resumes a handoff THEN it SHALL instruct calling `handoff_list_pending` to discover open handoffs and `handoff_accept` to transition the handoff to `accepted`.
10. WHEN a handoff is no longer needed THEN the workflow SHALL instruct calling `handoff_cancel` to expire it.

**Independent Test**: `rg 'handoff_begin|handoff_accept|handoff_list_pending|handoff_cancel' skills/massa-th0th/workflows/` returns matches in agent-handoff.md and restart-load.md.

---

### P1: Onboarding Adopts Bootstrap ⭐ MVP

**User Story**: As a developer onboarding to a new project, I want the onboarding workflow to call `bootstrap` so that seed memories are generated automatically from git/README/centrality instead of only manual `remember`.

**Why P1**: `bootstrap` is a shipped idempotent tool designed exactly for this; the onboarding workflow currently does manual `th0th_index` + `th0th_remember` but never calls `bootstrap`.

**Acceptance Criteria**:

11. WHEN `workflows/onboarding.md` establishes a new project THEN it SHALL instruct calling `bootstrap` with `projectId` and `projectPath` after indexing completes, before manual `remember` calls.
12. WHEN `bootstrap` returns seed memories THEN the workflow SHALL treat them as leads to confirm against current source, not as authoritative.

**Independent Test**: `rg 'bootstrap' skills/massa-th0th/workflows/onboarding.md` returns a match.

---

### P1: Long-Session Adopts compact_snapshot ⭐ MVP

**User Story**: As a developer whose context is being compacted mid-task, I want the long-session workflow to call `compact_snapshot` so that a bounded table-of-contents of the session is available for zero-loss recovery after /compact.

**Why P1**: `compact_snapshot` is a shipped tool that builds exactly this; the long-session workflow currently only uses `compress` and `remember`.

**Acceptance Criteria**:

13. WHEN `workflows/long-session.md` detects context compaction is imminent THEN it SHALL instruct calling `compact_snapshot` with `sessionId` and `projectId` before the compaction fires.
14. WHEN `compact_snapshot` is called THEN the workflow SHALL record the snapshot as a reference pointer in the session guide.

**Independent Test**: `rg 'compact_snapshot' skills/massa-th0th/workflows/long-session.md` returns a match.

---

### P2: Debug + Architecture Workflows Adopt trace_path and impact_analysis

**User Story**: As a developer debugging a call chain or assessing the blast radius of a change, I want the debug and architecture workflows to call `trace_path` and `impact_analysis` so that I get typed-edge BFS path tracing and git-diff impact ranking instead of relying only on `search` and `get_references`.

**Why P2**: These graph tools are shipped and provide capabilities `search`/`get_references` cannot (typed-edge traversal, centrality-ranked impact).

**Acceptance Criteria**:

15. WHEN `workflows/debug.md` traces a call/data-flow path THEN it SHALL instruct calling `trace_path` with `function_name` (or `qualifiedName`), `project`, `direction`, `mode`, and `depth` for root-cause tracing.
16. WHEN `workflows/architecture/architecture-audit.md` assesses the impact of a change set THEN it SHALL instruct calling `impact_analysis` with `project`, `projectPath`, and `scope` for centrality-ranked impact.
17. WHEN `workflows/refactor.md` assesses the blast radius of a structural change THEN it SHALL instruct calling `impact_analysis` with the relevant scope.

**Independent Test**: `rg 'trace_path' skills/massa-th0th/workflows/debug.md` and `rg 'impact_analysis' skills/massa-th0th/workflows/architecture/ skills/massa-th0th/workflows/refactor.md` return matches.

---

### P2: Debug + General Workflows Adopt Code Execution

**User Story**: As a developer analyzing a large file or computing a derived value, I want the debug and general workflows to call `execute_file` or `execute` so that I can run analysis code over a file instead of loading the entire file into context.

**Why P2**: `execute_file`/`execute`/`batch_execute` are shipped tools for "think in code" analysis; the workflows never reference them.

**Acceptance Criteria**:

18. WHEN `workflows/debug.md` needs to analyze a large file or compute a derived value THEN it SHALL instruct calling `execute_file` with `path`, `language`, and `code` instead of loading the full file into context.
19. WHEN `workflows/general.md` needs to run analysis code over project data THEN it SHALL instruct calling `execute` or `batch_execute` with the appropriate `language` and `code`/`commands`.

**Independent Test**: `rg 'execute_file|execute|batch_execute' skills/massa-th0th/workflows/debug.md skills/massa-th0th/workflows/general.md` return matches.

---

### P2: Workflows Adopt Full Synapse Lifecycle

**User Story**: As a developer using Synapse for multi-search tasks, I want workflows to call `synapse_task_begin`/`synapse_task_end` and `synapse_prefetch` so that task envelopes and file-open prefetch are used, not just session create + search.

**Why P2**: `synapse_task_begin/end` and `synapse_prefetch` are shipped Synapse tools that the `synapse-policy.md` reference mentions but the workflows never invoke.

**Acceptance Criteria**:

20. WHEN `workflows/spec-driven.md` or `workflows/feature.md` begins a multi-search investigation THEN it SHALL instruct calling `synapse_task_begin` with `id` (the synapse session id) and `taskContext` before the first search.
21. WHEN a workflow opens a file for deep investigation THEN it SHALL instruct calling `synapse_prefetch` with `id` and `filePath` to warm the buffer.
22. WHEN a multi-search task completes THEN the workflow SHALL instruct calling `synapse_task_end` to close the task envelope.

**Independent Test**: `rg 'synapse_task_begin|synapse_task_end|synapse_prefetch' skills/massa-th0th/workflows/` return matches in spec-driven.md and feature.md.

---

### P2: Workflows Adopt read_file and symbol_snippet

**User Story**: As a developer reading exact code lines, I want workflows to call `read_file` (with symbol metadata + imports) and `symbol_snippet` (raw code by line range) instead of only using native Read/Grep.

**Why P2**: `read_file` and `symbol_snippet` are shipped massa-th0th tools that provide symbol metadata and line-range snippets; the `massa-th0th-memory` meta-skill lists `read_file` as priority 14 but the workflows never reference it.

**Acceptance Criteria**:

23. WHEN any workflow needs to read a file with symbol metadata THEN it SHALL prefer `read_file` over native Read, per the `massa-th0th-memory` priority rule.
24. WHEN any workflow needs a raw code snippet by line range THEN it SHALL call `symbol_snippet` with `projectId`, `file`, `lineStart`, and `lineEnd`.

**Independent Test**: `rg 'read_file|symbol_snippet' skills/massa-th0th/workflows/` return matches.

---

### P2: Workflows Adopt memory_update, memory_delete, analytics

**User Story**: As a developer maintaining memories, I want workflows to call `memory_update` (re-embeds on content change) and `memory_delete` instead of only `remember`, and to call `analytics` for usage insights.

**Why P2**: These are shipped memory-management tools; workflows currently only call `remember` and never update or delete stale memories.

**Acceptance Criteria**:

25. WHEN a workflow discovers a memory is stale or needs correction THEN it SHALL instruct calling `memory_update` with `id` and the new `content` (re-embeds automatically).
26. WHEN a workflow discovers a memory is obsolete and should be removed THEN it SHALL instruct calling `memory_delete` with `id`.
27. WHEN `workflows/general.md` or `workflows/long-session.md` needs usage insights THEN it SHALL instruct calling `analytics` with `type` and `projectId`.

**Independent Test**: `rg 'memory_update|memory_delete|analytics' skills/massa-th0th/workflows/` return matches.

---

### P3: SKILL.md Router Reflects Full Tool Surface

**User Story**: As a workflow router consumer, I want the SKILL.md Core Contract and Retrieval sections to reference the full tool surface so that the router itself is consistent with the expanded workflows.

**Why P3**: Keeps the router consistent; the Core Contract currently mentions only recall/search/remember.

**Acceptance Criteria**:

28. WHEN `SKILL.md` Core Contract is inspected THEN it SHALL reference the canonical un-prefixed tool names and note the expanded tool surface (checkpoints, handoffs, bootstrap, compact_snapshot, trace_path, impact_analysis, code execution, full Synapse).
29. WHEN `SKILL.md` Retrieval And Synapse section is inspected THEN it SHALL reference `read_file`, `symbol_snippet`, `trace_path`, `impact_analysis`, and `synapse_prefetch` in the retrieval order.

**Independent Test**: `rg 'th0th_' skills/massa-th0th/SKILL.md` returns zero; `rg 'checkpoint|handoff_begin|bootstrap|compact_snapshot|trace_path|impact_analysis|execute_file|synapse_prefetch|read_file|symbol_snippet' skills/massa-th0th/SKILL.md` returns matches.

---

## Edge Cases

- WHEN a tool is unavailable (e.g. `trace_path` on an unindexed project) THEN the workflow SHALL fall back to `search`/`get_references` and record the reduced retrieval confidence (existing graceful-degradation pattern).
- WHEN a graph tool (`trace_path`, `impact_analysis`, `get_architecture`) is called THEN the workflow SHALL include an explicit freshness gate: the result only counts as evidence when the index is fresh for the current repository path and commit/worktree state; otherwise fall back to `search`/`get_references` and record reduced retrieval confidence.
- WHEN `compact_snapshot` is called THEN the workflow SHALL use the lifecycle `sessionId` (from hooks/sessions), NOT the `workflowSessionId`; the two-session-id rule from `synapse-policy.md` applies.
- WHEN `bootstrap` is called and the project has no git/README THEN it SHALL degrade to rule-based minimal seeds per its contract; the workflow SHALL not treat this as a failure.
- WHEN `create_checkpoint` is called and the `task_checkpoints` table is unavailable THEN the workflow SHALL continue with `.specs/` artifact state as the fallback (existing restart-save pattern).
- WHEN `handoff_begin` is called and `HANDOFFS_ENABLED=false` THEN the workflow SHALL fall back to `remember` + `.specs/` writes and record the skipped handoff-table write.
- WHEN `compact_snapshot` is called outside a pre-compact hook THEN the workflow SHALL treat the returned snapshot as a session-guide pointer, not as a replacement for `.specs/` state.
- WHEN `execute_file`/`execute` runs untrusted code THEN the workflow SHALL respect the local-dev-only trust model documented in FEATURES.md (no untrusted-client exposure).
- WHEN `impact_analysis` is called on a clean tree (no diff) THEN it SHALL return an empty impact set; the workflow SHALL not treat this as an error.
- WHEN a workflow references `get_architecture` and the tool is not wired in `tool-definitions.ts` THEN it SHALL be skipped (out-of-scope) and recorded in the design.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WTA-01 | P1: Canonical Names | Execute | Pending |
| WTA-02 | P1: Canonical Names | Execute | Pending |
| WTA-03 | P1: Canonical Names | Execute | Pending |
| WTA-04 | P1: Checkpoints | Execute | Pending |
| WTA-05 | P1: Checkpoints | Execute | Pending |
| WTA-06 | P1: Checkpoints | Execute | Pending |
| WTA-07 | P1: Checkpoints | Execute | Pending |
| WTA-08 | P1: Handoff Tools | Execute | Pending |
| WTA-09 | P1: Handoff Tools | Execute | Pending |
| WTA-10 | P1: Handoff Tools | Execute | Pending |
| WTA-11 | P1: Bootstrap | Execute | Pending |
| WTA-12 | P1: Bootstrap | Execute | Pending |
| WTA-13 | P1: compact_snapshot | Execute | Pending |
| WTA-14 | P1: compact_snapshot | Execute | Pending |
| WTA-15 | P2: trace_path/impact_analysis | Execute | Pending |
| WTA-16 | P2: trace_path/impact_analysis | Execute | Pending |
| WTA-17 | P2: trace_path/impact_analysis | Execute | Pending |
| WTA-18 | P2: Code Execution | Execute | Pending |
| WTA-19 | P2: Code Execution | Execute | Pending |
| WTA-20 | P2: Full Synapse | Execute | Pending |
| WTA-21 | P2: Full Synapse | Execute | Pending |
| WTA-22 | P2: Full Synapse | Execute | Pending |
| WTA-23 | P2: read_file/symbol_snippet | Execute | Pending |
| WTA-24 | P2: read_file/symbol_snippet | Execute | Pending |
| WTA-25 | P2: memory_update/delete/analytics | Execute | Pending |
| WTA-26 | P2: memory_update/delete/analytics | Execute | Pending |
| WTA-27 | P2: memory_update/delete/analytics | Execute | Pending |
| WTA-28 | P3: SKILL.md Router | Execute | Pending |
| WTA-29 | P3: SKILL.md Router | Execute | Pending |

**ID format:** `WTA-<NUMBER>` (Workflow-Tools-Adaptation)

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 29 total, 29 mapped to stories, 0 unmapped

---

## Success Criteria

- [ ] Zero `th0th_`-prefixed tool names remain in `skills/massa-th0th/` (workflows, references, SKILL.md).
- [ ] `references/th0th-tools.md` MCP Capability Matrix lists all 52+ tools from `tool-definitions.ts` CANONICAL_ORDER.
- [ ] spec-driven, long-session, restart-save workflows reference `create_checkpoint`/`list_checkpoints`/`restore_checkpoint`.
- [ ] agent-handoff, restart-load workflows reference `handoff_begin`/`handoff_accept`/`handoff_list_pending`/`handoff_cancel`.
- [ ] onboarding workflow references `bootstrap`.
- [ ] long-session workflow references `compact_snapshot`.
- [ ] debug, architecture-audit, refactor workflows reference `trace_path` and/or `impact_analysis`.
- [ ] debug, general workflows reference `execute_file`/`execute`/`batch_execute`.
- [ ] spec-driven, feature workflows reference `synapse_task_begin`/`synapse_task_end`/`synapse_prefetch`.
- [ ] Workflows reference `read_file` and `symbol_snippet` for file/code reads.
- [ ] Workflows reference `memory_update`/`memory_delete`/`analytics`.
- [ ] SKILL.md router Core Contract and Retrieval sections reference the full tool surface with canonical names.
- [ ] Independent verifier confirms no workflow routing/memory/Evidence-Gate contract changed in meaning.