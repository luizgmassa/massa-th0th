# Workflow Tools Adaptation Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/workflow-tools-adaptation/design.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

**Guidelines found:** `AGENTS.md` (root + skills/), `CONTRIBUTING.md`, `.specs/` harness protocol. This is a documentation-layer feature (Markdown workflow/reference/SKILL.md edits). No code, no DB, no migration. Verification is deterministic grep/rg sensors against `skills/massa-ai/` confirming tool-name presence/absence and behavior-preservation diff checks.

**Test placement:** No unit/integration/e2e tests — this feature edits `.md` files only. The "tests" are deterministic `rg` sensors run by the verifier.

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md`, `CONTRIBUTING.md`. This is a documentation-layer feature; all "tests" are deterministic `rg` sensors.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Markdown workflows/references/SKILL.md | none (deterministic sensor) | Every AC has a grep sensor; behavior-preservation diff check | `skills/massa-ai/**/*.md` | `rg` sensors (see Gate Check Commands) |

## Gate Check Commands

> Generated from codebase — all are deterministic `rg` sensors against `skills/massa-ai/`.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick (per-task sensor) | After each task | `rg -c '<pattern>' <file>` returns expected count |
| Full (all ACs) | After all tasks | See validation sensors below |
| Build (type-check + build unaffected) | After all tasks | `bun run type-check && bun run build` (must remain green — no code changed) |

**Full validation sensors (run by verifier):**
1. `rg 'th0th_' skills/massa-ai/` → **zero matches** (WTA-01/03 — full tree: workflows + references + SKILL.md)
2. `rg -c 'create_checkpoint|list_checkpoints|restore_checkpoint' skills/massa-ai/workflows/spec-driven.md skills/massa-ai/workflows/long-session.md skills/massa-ai/workflows/restart-save.md` → ≥1 each (WTA-04..07)
3. `rg -c 'handoff_begin|handoff_accept|handoff_list_pending|handoff_cancel' skills/massa-ai/workflows/agent-handoff.md skills/massa-ai/workflows/restart-load.md` → ≥1 each (WTA-08..10)
4. `rg 'bootstrap' skills/massa-ai/workflows/onboarding.md` → ≥1 match (WTA-11)
5. `rg 'compact_snapshot' skills/massa-ai/workflows/long-session.md` → ≥1 match (WTA-13)
6. `rg 'trace_path' skills/massa-ai/workflows/debug.md` → ≥1 match (WTA-15)
7. `rg 'impact_analysis' skills/massa-ai/workflows/architecture/architecture-audit.md skills/massa-ai/workflows/refactor.md` → ≥1 each (WTA-16/17)
8. `rg 'execute_file|execute|batch_execute' skills/massa-ai/workflows/debug.md skills/massa-ai/workflows/general.md` → ≥1 each (WTA-18/19)
9. `rg 'synapse_task_begin|synapse_task_end|synapse_prefetch' skills/massa-ai/workflows/spec-driven.md skills/massa-ai/workflows/feature.md` → ≥1 each (WTA-20..22)
10. `rg 'read_file|symbol_snippet' skills/massa-ai/workflows/` → ≥1 match (WTA-23/24)
11. `rg 'memory_update|memory_delete|analytics' skills/massa-ai/workflows/` → ≥1 match (WTA-25..27)
12. `rg 'checkpoint|handoff_begin|bootstrap|compact_snapshot|trace_path|impact_analysis|execute_file|synapse_prefetch|read_file|symbol_snippet' skills/massa-ai/SKILL.md` → ≥1 match (WTA-28/29)
13. `rg 'get_architecture' skills/massa-ai/workflows/architecture/architecture-audit.md` → ≥1 match
14. `rg 'fetch_and_index' skills/massa-ai/workflows/exploration.md` → ≥1 match
15. `rg 'get_architecture|rename_project|merge_projects|memory_update|memory_delete|create_checkpoint|list_checkpoints|restore_checkpoint|compact_snapshot|bootstrap|handoff_begin|handoff_accept|handoff_cancel|handoff_list_pending|list_proposals|approve_proposal|reject_proposal|execute|execute_file|batch_execute|fetch_and_index|synapse_get|synapse_update|synapse_end|synapse_prefetch|synapse_list|synapse_task_begin|synapse_task_end|symbol_snippet|read_file|impact_analysis|trace_path|get_architecture' skills/massa-ai/references/mcp-tools.md` → all 52 tools present (WTA-02)
16. `bun run type-check` → 6/6 green (no code changed)
17. `bun run build` → 5/5 green (no code changed)

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Foundation — Canonical Naming + Expanded Tool Reference

T1 → T2

### Phase 2: P1 Tool Adoption — Checkpoints, Handoffs, Bootstrap, compact_snapshot

T4 → T5 → T6 → T7

### Phase 3: P2 Tool Adoption — Graph, Execution, Synapse, read_file, memory ops

T8 → T9 → T10 → T11

### Phase 4: SKILL.md Router + Final Gate

T3 → T12

---

## Task Breakdown

### T1: Canonical naming rename — all `th0th_*` → un-prefixed across full skill tree

**What**: Replace every `th0th_<tool>` reference with the canonical un-prefixed `<tool>` name across ALL files in `skills/massa-ai/` (workflows, references, SKILL.md). This is a mechanical transform covering ~58 `.md` files.
**Where**: `skills/massa-ai/**/*.md` (workflows + references + SKILL.md)
**Depends on**: None
**Reuses**: `tool-definitions.ts` CANONICAL_ORDER as the name source of truth
**Requirement**: WTA-01 (revised — full tree, not just workflows)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'th0th_' skills/massa-ai/` returns zero matches (full tree, not just workflows)
- [ ] Every workflow, reference, and SKILL.md `recall`/`remember`/`search`/etc. reference uses un-prefixed names
- [ ] No workflow routing/memory/Evidence-Gate contract changed in meaning

**Tests**: none (deterministic sensor)
**Gate**: quick — `rg 'th0th_' skills/massa-ai/` returns zero

**Commit**: `docs(skills): rename th0th_ tool refs to canonical un-prefixed names across full tree`

---

### T2: Expand `references/mcp-tools.md` to full 52-tool matrix

**What**: Expand the MCP Capability Matrix from ~20 rows to all 52 tools; rename existing `th0th_*` entries to un-prefixed; add rows for every tool in CANONICAL_ORDER; update the Retrieval Order to include `read_file`, `symbol_snippet`, `trace_path`, `impact_analysis`, `get_architecture`.
**Where**: `skills/massa-ai/references/mcp-tools.md`
**Depends on**: T1 (naming consistency)
**Reuses**: `tool-definitions.ts` CANONICAL_ORDER, `FEATURES.md` tool roster, `tool-defs-*.ts` descriptions
**Requirement**: WTA-02

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'th0th_' skills/massa-ai/references/mcp-tools.md` returns zero
- [ ] All 52 tools from CANONICAL_ORDER appear in the MCP Capability Matrix
- [ ] Retrieval Order includes `read_file`, `symbol_snippet`, `trace_path`, `impact_analysis`, `get_architecture`
- [ ] REST-Only Operations and Verified MCP/REST Differences sections updated with un-prefixed names

**Tests**: none (deterministic sensor)
**Gate**: quick — grep each of the 52 tool names in `mcp-tools.md`

**Commit**: `docs(th0th-tools): expand MCP capability matrix to all 52 tools`

---

### T3: Update SKILL.md router Core Contract + Retrieval for full tool surface

**What**: Update `SKILL.md` Core Contract to note the expanded tool surface (checkpoints, handoffs, bootstrap, compact_snapshot, trace_path, impact_analysis, code execution, full Synapse, read_file, symbol_snippet); update Retrieval And Synapse to include `read_file`, `symbol_snippet`, `trace_path`, `impact_analysis`, `synapse_prefetch`; add graceful-degradation rows for new tools. (The canonical rename of SKILL.md is already done by T1; this task adds the new tool-surface content.)
**Where**: `skills/massa-ai/SKILL.md`
**Depends on**: T1 (canonical naming), T4..T11 (tool adoption complete, so router reflects what workflows now use)
**Reuses**: T2 expanded matrix, T4..T11 adoption map
**Requirement**: WTA-28, WTA-29

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'checkpoint|handoff_begin|bootstrap|compact_snapshot|trace_path|impact_analysis|execute_file|synapse_prefetch|read_file|symbol_snippet' skills/massa-ai/SKILL.md` returns ≥1 match
- [ ] Core Contract references canonical un-prefixed names and notes expanded tool surface
- [ ] Retrieval And Synapse includes `read_file`, `symbol_snippet`, `trace_path`, `impact_analysis`, `synapse_prefetch`
- [ ] Graceful Degradation has rows for checkpoint/handoff/bootstrap/compact_snapshot/execution/graph-tool unavailability

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensor above

**Commit**: `docs(skill): update router Core Contract and Retrieval for full tool surface`

---

### T4: Adopt checkpoints in spec-driven, long-session, restart-save

**What**: Add `create_checkpoint`/`list_checkpoints`/`restore_checkpoint` references to `spec-driven.md` (Execute: task boundary + resume), `long-session.md` (before compaction/stopping), and `restart-save.md` (milestone checkpoint after `.specs/` writes).
**Where**: `skills/massa-ai/workflows/spec-driven.md`, `skills/massa-ai/workflows/long-session.md`, `skills/massa-ai/workflows/restart-save.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `FEATURES.md` Checkpoints section, `tool-defs-memory.ts` checkpoint schemas
**Requirement**: WTA-04, WTA-05, WTA-06, WTA-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'create_checkpoint' skills/massa-ai/workflows/spec-driven.md` returns ≥1
- [ ] `rg 'list_checkpoints|restore_checkpoint' skills/massa-ai/workflows/spec-driven.md` returns ≥1
- [ ] `rg 'create_checkpoint' skills/massa-ai/workflows/long-session.md` returns ≥1
- [ ] `rg 'create_checkpoint' skills/massa-ai/workflows/restart-save.md` returns ≥1
- [ ] Graceful degradation: checkpoint unavailability falls back to `.specs/` state

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt checkpoints in spec-driven, long-session, restart-save`

---

### T5: Adopt handoff tools in agent-handoff and restart-load

**What**: Add `handoff_begin`/`handoff_accept`/`handoff_list_pending`/`handoff_cancel` references to `agent-handoff.md` (persist + resume) and `restart-load.md` (discover + accept).
**Where**: `skills/massa-ai/workflows/agent-handoff.md`, `skills/massa-ai/workflows/restart-load.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `FEATURES.md` Cross-session Handoffs section, `tool-defs-hooks-exec.ts` handoff schemas
**Requirement**: WTA-08, WTA-09, WTA-10

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'handoff_begin' skills/massa-ai/workflows/agent-handoff.md` returns ≥1
- [ ] `rg 'handoff_accept|handoff_list_pending' skills/massa-ai/workflows/agent-handoff.md skills/massa-ai/workflows/restart-load.md` returns ≥1 each
- [ ] `rg 'handoff_cancel' skills/massa-ai/workflows/agent-handoff.md` returns ≥1
- [ ] Graceful degradation: `HANDOFFS_ENABLED=false` falls back to `remember` + `.specs/` writes

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt handoff tools in agent-handoff and restart-load`

---

### T6: Adopt bootstrap in onboarding

**What**: Add `bootstrap` reference to `onboarding.md` after indexing completes, before manual `remember` calls.
**Where**: `skills/massa-ai/workflows/onboarding.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `FEATURES.md` Bootstrap section, `tool-defs-hooks-exec.ts` bootstrap schema
**Requirement**: WTA-11, WTA-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'bootstrap' skills/massa-ai/workflows/onboarding.md` returns ≥1
- [ ] Workflow notes bootstrap seed memories are leads to confirm against current source

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensor above

**Commit**: `docs(workflows): adopt bootstrap in onboarding`

---

### T7: Adopt compact_snapshot in long-session

**What**: Add `compact_snapshot` reference to `long-session.md` before compaction fires, with `sessionId` and `projectId`.
**Where**: `skills/massa-ai/workflows/long-session.md`
**Depends on**: T1 (canonical naming), T4 (checkpoints in long-session)
**Reuses**: `FEATURES.md` Compact Snapshot section, `tool-defs-hooks-exec.ts` compact_snapshot schema
**Requirement**: WTA-13, WTA-14

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'compact_snapshot' skills/massa-ai/workflows/long-session.md` returns ≥1
- [ ] Workflow records the snapshot as a reference pointer in the session guide
- [ ] Workflow explicitly states `compact_snapshot` takes the lifecycle `sessionId` (from hooks/sessions), NOT the `workflowSessionId`; references the two-session-id rule from `synapse-policy.md` (Pre-mortem F3 mitigation)

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensor above

**Commit**: `docs(workflows): adopt compact_snapshot in long-session`

---

### T8: Adopt trace_path, impact_analysis, get_architecture in debug, architecture-audit, refactor

**What**: Add `trace_path` to `debug.md` (root-cause tracing); `impact_analysis` to `architecture-audit.md` and `refactor.md` (blast-radius); `get_architecture` to `architecture-audit.md` (architecture-specific deep map).
**Where**: `skills/massa-ai/workflows/debug.md`, `skills/massa-ai/workflows/architecture/architecture-audit.md`, `skills/massa-ai/workflows/refactor.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `FEATURES.md` Symbol Graph section, `tool-defs-search.ts` trace_path/impact_analysis schemas, `tool-defs-project.ts` get_architecture schema
**Requirement**: WTA-15, WTA-16, WTA-17

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'trace_path' skills/massa-ai/workflows/debug.md` returns ≥1
- [ ] `rg 'impact_analysis' skills/massa-ai/workflows/architecture/architecture-audit.md` returns ≥1
- [ ] `rg 'impact_analysis' skills/massa-ai/workflows/refactor.md` returns ≥1
- [ ] `rg 'get_architecture' skills/massa-ai/workflows/architecture/architecture-audit.md` returns ≥1
- [ ] Every graph-tool reference includes an explicit freshness gate: result only counts as evidence when index is fresh for current repository path and commit/worktree state; fall back to `search`/`get_references` and record reduced retrieval confidence otherwise (Pre-mortem F2 mitigation)
- [ ] `architecture-audit.md` explicitly distinguishes `project_map` (general overview: PageRank + symbol counts) from `get_architecture` (architecture-specific: packages, routes, hotspots, communities, cycles) (Pre-mortem F5 mitigation)

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt trace_path, impact_analysis, get_architecture in debug, architecture, refactor`

---

### T9: Adopt code execution in debug and general

**What**: Add `execute_file` to `debug.md` (large-file analysis); `execute`/`batch_execute` to `general.md` (analysis code / parallel commands).
**Where**: `skills/massa-ai/workflows/debug.md`, `skills/massa-ai/workflows/general.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `FEATURES.md` Code Execution section, `tool-defs-hooks-exec.ts` execute/execute_file/batch_execute schemas
**Requirement**: WTA-18, WTA-19

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'execute_file' skills/massa-ai/workflows/debug.md` returns ≥1
- [ ] `rg 'execute|batch_execute' skills/massa-ai/workflows/general.md` returns ≥1
- [ ] Workflow notes the local-dev-only trust model

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt code execution in debug and general`

---

### T10: Adopt full Synapse lifecycle in spec-driven and feature

**What**: Add `synapse_task_begin`/`synapse_task_end` to `spec-driven.md` and `feature.md` (task envelope); `synapse_prefetch` to `spec-driven.md`, `feature.md`, and `debug.md` (warm buffer on file open).
**Where**: `skills/massa-ai/workflows/spec-driven.md`, `skills/massa-ai/workflows/feature.md`, `skills/massa-ai/workflows/debug.md`
**Depends on**: T1 (canonical naming)
**Reuses**: `synapse-usage` SKILL.md (5 moves), `synapse-policy.md` reference, `tool-defs-synapse.ts` schemas
**Requirement**: WTA-20, WTA-21, WTA-22

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'synapse_task_begin' skills/massa-ai/workflows/spec-driven.md skills/massa-ai/workflows/feature.md` returns ≥1 each
- [ ] `rg 'synapse_task_end' skills/massa-ai/workflows/spec-driven.md skills/massa-ai/workflows/feature.md` returns ≥1 each
- [ ] `rg 'synapse_prefetch' skills/massa-ai/workflows/spec-driven.md skills/massa-ai/workflows/feature.md skills/massa-ai/workflows/debug.md` returns ≥1 each
- [ ] Workflow notes task_begin/end require an existing `synapse_session` id

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt full Synapse lifecycle in spec-driven, feature, debug`

---

### T11: Adopt read_file, symbol_snippet, memory_update/delete, analytics, fetch_and_index

**What**: Add `read_file`/`symbol_snippet` references to workflows that read files/code; `memory_update`/`memory_delete` to `general.md`/`debug.md`/`long-session.md`; `analytics` to `general.md`/`long-session.md`; `fetch_and_index` to `exploration.md`.
**Where**: `skills/massa-ai/workflows/general.md`, `skills/massa-ai/workflows/debug.md`, `skills/massa-ai/workflows/long-session.md`, `skills/massa-ai/workflows/exploration.md`, and other workflows that read files
**Depends on**: T1 (canonical naming)
**Reuses**: `massa-ai-memory` SKILL.md (read_file priority 14), `tool-defs-project.ts` read_file schema, `tool-defs-search.ts` symbol_snippet schema, `tool-defs-memory.ts` memory_update/delete/analytics schemas, `tool-defs-hooks-exec.ts` fetch_and_index schema
**Requirement**: WTA-23, WTA-24, WTA-25, WTA-26, WTA-27

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `rg 'read_file' skills/massa-ai/workflows/` returns ≥1 match
- [ ] `rg 'symbol_snippet' skills/massa-ai/workflows/` returns ≥1 match
- [ ] `rg 'memory_update' skills/massa-ai/workflows/general.md skills/massa-ai/workflows/debug.md skills/massa-ai/workflows/long-session.md` returns ≥1 total
- [ ] `rg 'memory_delete' skills/massa-ai/workflows/general.md skills/massa-ai/workflows/long-session.md` returns ≥1 total
- [ ] `rg 'analytics' skills/massa-ai/workflows/general.md skills/massa-ai/workflows/long-session.md` returns ≥1 total
- [ ] `rg 'fetch_and_index' skills/massa-ai/workflows/exploration.md` returns ≥1

**Tests**: none (deterministic sensor)
**Gate**: quick — grep sensors above

**Commit**: `docs(workflows): adopt read_file, symbol_snippet, memory ops, analytics, fetch_and_index`

---

### T12: Final full-gate sensor sweep + behavior-preservation diff

**What**: Run all full validation sensors from the Gate Check Commands section; diff each rewritten workflow against its pre-rewrite version confirming routing/memory/Evidence-Gate/failure-handling contracts unchanged in meaning.
**Where**: All `skills/massa-ai/**/*.md` files touched by T1..T11
**Depends on**: T1..T11 all complete (T3 SKILL.md router update now in Phase 1, depends on T1+T2+T4..T11 content)
**Reuses**: Gate Check Commands sensor list
**Requirement**: All WTA-01..29

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] All full validation sensors pass (see Gate Check Commands)
- [ ] `bun run type-check` → 6/6 green (no code changed)
- [ ] `bun run build` → 5/5 green (no code changed)
- [ ] Behavior-preservation diff: routing header, workflowSessionId rule, reference-load list, recall step, persistence tags, Evidence Gate step unchanged in meaning across all rewritten workflows
- [ ] Discrimination sensor: inject a `th0th_`-prefixed reference into a scratch copy; confirm `rg 'th0th_'` catches it

**Tests**: none (deterministic sensor)
**Gate**: full — all sensors + type-check + build

**Commit**: `docs(workflows): final gate sensor sweep for workflow-tools-adaptation`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ──→ T2
Phase 2:  T4 ──→ T5 ──→ T6 ──→ T7
Phase 3:  T8 ──→ T9 ──→ T10 ──→ T11
Phase 4:  T3 ──→ T12
```

Execution is strictly sequential — there is no intra-phase parallelism. A single agent works one task at a time, in order.

**Batch packing:** 12 tasks total. Packed into ~7-task batches: Batch 1 (T1, T2, T4-T7, Phase 1+2), Batch 2 (T8-T11, T3, T12, Phase 3+4). Since 12 tasks > ~8, the sub-agent offer fires. However, all tasks are Markdown edits with deterministic sensors — a single inline execution is efficient and avoids sub-agent context overhead for documentation work. Recommend inline execution unless the user prefers batch sub-agents.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Canonical naming rename (full skill tree) | ~58 .md files, one rename pattern | ✅ Granular (single mechanical transform) |
| T2: Expand mcp-tools.md matrix | 1 reference file | ✅ Granular |
| T3: SKILL.md router Core Contract + Retrieval update | 1 file | ✅ Granular |
| T4: Checkpoints in 3 workflows | 3 files, one tool family | ✅ Granular (cohesive tool family) |
| T5: Handoff tools in 2 workflows | 2 files, one tool family | ✅ Granular |
| T6: Bootstrap in onboarding | 1 file, 1 tool | ✅ Granular |
| T7: compact_snapshot in long-session | 1 file, 1 tool | ✅ Granular |
| T8: trace_path/impact_analysis/get_architecture in 3 workflows | 3 files, one graph-tool family | ✅ Granular (cohesive) |
| T9: Code execution in 2 workflows | 2 files, one tool family | ✅ Granular |
| T10: Full Synapse in 3 workflows | 3 files, one tool family | ✅ Granular |
| T11: read_file/symbol_snippet/memory ops/analytics/fetch_and_index | 5 files, one "remaining tools" family | ✅ Granular (cohesive remaining-tools sweep) |
| T3: SKILL.md router Core Contract + Retrieval update | 1 file | ✅ Granular |
| T12: Final gate sensor sweep | All files, verification only | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | Phase 1 start | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T4 | T1 | T4 (Phase 2 start, depends on Phase 1) | ✅ Match |
| T5 | T1 | T4 → T5 (T5 depends on T1) | ✅ Match |
| T6 | T1 | T5 → T6 (T6 depends on T1) | ✅ Match |
| T7 | T1, T4 | T6 → T7 (T7 depends on T1 + T4) | ✅ Match |
| T8 | T1 | T8 (Phase 3 start) | ✅ Match |
| T9 | T1 | T8 → T9 | ✅ Match |
| T10 | T1 | T9 → T10 | ✅ Match |
| T11 | T1 | T10 → T11 | ✅ Match |
| T3 | T1, T4..T11 | T11 → T3 (Phase 4 start; T3 depends on T1 rename + T4..T11 adoption content) | ✅ Match |
| T12 | T1..T11, T3 | T3 → T12 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1..T12 | Markdown workflows/references/SKILL.md | none (deterministic sensor) | none (deterministic sensor) | ✅ OK (all documentation-layer) |

**Rules satisfied:** No task creates code; all tasks edit `.md` files. The coverage matrix requires "none (deterministic sensor)" for all Markdown layers. Each task's gate is a `rg` sensor confirming tool-name presence/absence. No test deferral.

---

## MCP and Skill Question

**Available MCPs**: massa-ai (search, recall, remember, index, etc. — the 52 tools being adopted)
**Available Skills**: `massa-ai` (workflow router), `massa-ai-memory` (tool priority rules), `synapse-usage` (Synapse lifecycle), `coding-guidelines`

**Selected answer**: No MCP or skill materially changes implementation or verification for this documentation-layer feature. All tasks are Markdown edits with deterministic `rg` sensors. The `massa-ai` skill is the execution protocol owner (per the Execution Protocol above). `massa-ai-memory` and `synapse-usage` are reference sources for tool descriptions and lifecycle patterns (read-only, already loaded in context). No additional MCP calls are needed during execution.