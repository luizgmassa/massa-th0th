# Phase 1 — Memory-Quality Foundation Specification

Slug: `phase-1-memory-foundation`. Source: `i-want-to-understand-virtual-lantern.md` Phase 1 (items 1, 2, 3) + cross-cutting architecture decisions §1–5.

## Problem Statement

The memory system has three structural defects blocking retrieval quality and durability:

1. **Decay is a half-life curve divorced from salience/access.** `MemoryService.temporalScore` (`memory-service.ts:200-209`) reads only `lastAccessed||createdAt` and applies `0.5^(ageHours/72)`. It ignores `importance` (salience), `accessCount` (reinforcement), and `pinned` status. ai-memory's `decay.rs` model is strictly richer: `salience·exp(-λΔt) + σ·log(1+access)·exp(-μΔt_access)`.
2. **Consolidation is Postgres-only and merge-blind.** `MemoryConsolidationJob.maybeRun` short-circuits on SQLite (`memory-consolidation-job.ts:36-47`), so the canonical backend never consolidates. The job only decays/prunes importance; it never merges near-duplicate memories into a `ConsolidatedBatch` with `SUPERSEDES` edges, and the read side never hides superseded rows.
3. **Synapse sessions and index jobs are ephemeral.** `SessionRegistry` (`session-registry.ts:45`) and `IndexJobTracker` (`index-job-tracker.ts:37`) keep everything in a process-local `Map`. A restart loses every active session and every in-flight `running` job stays stuck.

Cross-cutting: there is no shared local-first LLM client (`compression.llm` is the only LLM config, OpenAI-cloud-default), no `memory:consolidated` EventBus event, and SQLite is not first-class in the consolidation path.

## Goals

- [ ] 1: A pure, tested `decayScore(mem, params, now)` replaces `temporalScore`; `pinned` memories are decay-exempt; `deleted_at` soft-delete lands (deferred from Phase 0) with recall filtering; both backends.
- [ ] 2: A shared `llm-client` (top-level `llm` config, Ollama defaults, default-off, silent degradation) backs a `consolidator` that produces `ConsolidatedBatch` summaries; `MemoryConsolidationJob` becomes backend-polymorphic (no `isPostgresEnabled()` short-circuit), ports decay to `decay.ts` for both backends, adds a merge phase that inserts a new memory and a `SUPERSEDES` edge per source, extends `ConsolidationStats`, and emits `memory:consolidated`; the read side hides superseded rows.
- [ ] 3: `SessionStore` (`SqliteSessionStore`) persists `AgentSession` (buffer snapshot + access history) to `synapse_sessions`/`synapse_access_history`; `SessionRegistry` write-throughs and lazy-loads with the `Map` as hot cache. `SqliteJobStore` persists `index_jobs` and on startup marks stale `running`→`failed`; `IndexJobTracker` write-throughs and lazy-loads.

## Out of Scope

| Feature | Reason |
| --- | --- |
| Auto importance/salience on `remember` (7b) | Phase 7. |
| Query rewrite + HyDE (item 4) | Phase 2; consumes `llm-client` from here. |
| Hook/observation passive capture (G1) | Phase 3; consumes `llm-client` + consolidation. |
| Multi-user attribution (G10) | Rejected in plan. |
| Markdown/git second store (G4) | Rejected; SQLite-canonical. |
| Cohere/Google cross-encoder rerank (7a) | Phase 7. |
| Soft-delete UNDELETE / trash UI | Hard-delete stays the delete path; soft-delete only hides from recall + allows future restore. |
| PG `metadata` jsonb on `memory_edges` | PG edge model already has `metadata Json?` (schema.prisma:251). SQLite edge table has no metadata col and the consolidation batch id is carried via `evidence`; adding a SQLite `metadata` col is a separate refactor — out of scope (see Design §"edge metadata"). |

## Assumptions & Open Questions

| Assumption | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| `decayScore` semantics | `salience·exp(-λΔt_days) + σ·log(1+access)·exp(-μΔt_access_days)`, clamped `[0,1]`; `salience` = `memory.importance` | Matches ai-memory `decay.rs`; importance already ∈ `[0,1]` (default 0.5). | n — assumption (formula from plan) |
| DecayParams defaults | `lambda=0.02, sigma=0.6, mu=0.04, coldThreshold=0.20` | Verbatim from plan (borrowed from ai-memory). | n — assumption |
| Pinned semantics | `pinned=1` row is exempt: `decayScore` returns `importance` (no temporal decay), and consolidation never prunes it | Plan: "pinned memories exempt from decay". | n — assumption |
| `deleted_at` filtering | Recall (FTS both backends) + `listMemories` exclude `deleted_at IS NOT NULL`; hard-delete path unchanged; no new restore API this phase | Phase-0 HANDOFF parked soft-delete here; restore is out of scope. | n — assumption |
| LLM default posture | `llm.enabled=false`; env `RLM_LLM_ENABLED=true` opts in; Ollama `baseUrl http://localhost:11434/v1`, `model qwen2.5-coder:7b`, `apiKey "ollama"` | Cross-cutting §1; matches existing `compression.llm.enabled` gate semantics. | n — assumption |
| LLM failure mode | Any throw/timeout/non-2xx → silent fall-through to non-LLM path (consolidation skips merge, returns rule-based stats) | Cross-cutting §1(b). | n — assumption |
| `compression.llm` migration | Top-level `llm` is the new home; `compression.llm` stays as a **deprecated alias** that reads from `llm` for one release; no behavior change | Cross-cutting §1. | n — assumption |
| Edge batch-id carrier (SQLite) | Use `evidence` TEXT column on SQLite `memory_edges` (already exists, `graph-store.ts:79`); carry JSON `{batchId}`. PG uses `metadata Json?` on `MemoryEdge`. | Avoids a SQLite schema migration for an unneeded column; `evidence` is the existing free-text slot. | n — assumption |
| Session persistence granularity | Write-through on create/update/recordAccess/delete (best-effort, swallow errors with a warn); lazy-load on `get` miss | Plan: "write-through; lazy-load; Map stays hot cache". | n — assumption |
| Job crash recovery | On `SqliteJobStore` init, `UPDATE index_jobs SET status='failed', error='process restart' WHERE status='running'` | Plan item 3. | n — assumption |
| `memory:consolidated` payload | `{ batchId, sourceIds[], newMemoryId, projectId?, stats }` | Cross-cutting §3. | n — assumption |

Open questions: none unresolved-and-unmarked.

## User Stories & Acceptance Criteria

### P1-DECAY: Tunable decay as a pure, tested fn ⭐
1. GIVEN a memory with `importance`, `accessCount`, `createdAt`, `lastAccessed` WHEN `decayScore(mem, params, now)` is called THEN it SHALL return `clamp(importance·exp(-λ·Δt_days) + σ·log(1+access)·exp(-μ·Δt_access_days), 0, 1)`.
2. WHEN `Δt_days` increases (other inputs fixed) THEN the score SHALL be non-increasing (monotonic).
3. WHEN a memory is `pinned` THEN `decayScore` SHALL return its `importance` unchanged (decay-exempt).
4. WHEN the score falls below `coldThreshold` THEN the memory is a candidate for pruning (consolidation prunes it if also old/low-access).
5. WHEN `accessCount` increases (recency fixed) THEN the access term SHALL not decrease.
6. The score SHALL be bounded in `[0,1]` for all finite inputs.
7. `MemoryService.semanticRank` SHALL delegate the temporal component to `decayScore` (the private `temporalScore` half-life curve is removed).
- Independent Test: `packages/core/src/__tests__/decay.test.ts` (property + pinned + clamping).

### P1-SOFTDELETE: `deleted_at` + recall filtering (deferred from Phase 0) ⭐
1. WHEN `deleteById` is called THEN the row SHALL be soft-deleted (`deleted_at = now`) by default; hard-delete remains available via an explicit flag.
2. WHEN recall/FTS/listMemories runs THEN rows with `deleted_at IS NOT NULL` SHALL be excluded.
3. WHEN `deleteById` is called twice (idempotent) THEN the second SHALL report `false` (already deleted), no error.
4. Hard-delete behavior (Phase 0: sever GraphStore edges) SHALL remain intact when explicitly requested.
- Independent Test: extend `packages/core/src/__tests__/memory-crud.test.ts` with a soft-delete + filtering case.

### P1-PINNED: `pinned` column ⭐
1. The `memories` table SHALL have a `pinned` column (default 0/`false`) on both backends.
2. WHEN a memory is pinned THEN consolidation SHALL never decay or prune it.
- Independent Test: covered by `decay.test.ts` (pinned exemption) + a consolidation test case.

### P1-LLMCLIENT: Shared local-first LLM client ⭐
1. A top-level `llm` config block SHALL exist with `enabled` (default `false`, env `RLM_LLM_ENABLED`), `baseUrl` (default `http://localhost:11434/v1`), `apiKey` (default `"ollama"`), `model` (default `qwen2.5-coder:7b`), `temperature`, `maxOutputTokens`, `timeoutMs`.
2. `llmComplete(prompt, opts?)` SHALL call `generateText` and return the text; `llmObject(prompt, zodSchema)` SHALL call `generateObject` and return parsed output.
3. WHEN `llm.enabled=false` THEN every call SHALL short-circuit to a sentinel (`{ ok:false }` / `null`) WITHOUT contacting the provider.
4. WHEN a call throws/times out THEN the client SHALL swallow the error, log a warn, and return the sentinel — the caller's non-LLM path runs.
5. `compression.llm` SHALL remain readable as a deprecated alias of `llm`.
- Independent Test: `packages/core/src/__tests__/llm-client.test.ts` (disabled-by-default + throw→sentinel).

### P1-CONSOLIDATE: LLM-driven consolidation + backend-polymorphic job ⭐
1. `MemoryConsolidationJob.maybeRun` SHALL NOT short-circuit on SQLite; it SHALL dispatch to the active backend polymorphically (mirror `memory-repository-factory.ts`).
2. The job SHALL use `decayScore` (from `decay.ts`) for the temporal/decay decision on BOTH backends (pinned exempt).
3. WHEN the LLM is enabled and a cluster of ≥2 near-duplicate memories exists (same `project_id`, cosine ≥ 0.65, bounded top-N) THEN `consolidateWindow` SHALL produce a `ConsolidatedBatch { id, sourceIds, summary, type, level, rationale }` via `generateObject` + a zod schema enforcing `type`/`level` enums.
4. The merge phase SHALL insert a new memory from the batch summary and add a `SUPERSEDES` edge from the new memory to each source id (via `GraphStore.createEdge` / PG equivalent), carrying `{batchId}`.
5. `ConsolidationStats` SHALL be extended with `{ merged, batchesCreated }`.
6. A `memory:consolidated` event SHALL be emitted per batch via `eventBus.publish`.
7. WHEN the LLM is disabled or throws THEN consolidation SHALL complete the rule-based (decay+prune) path only, with `merged=0, batchesCreated=0`, and no error propagated.
- Independent Test: `packages/core/src/__tests__/consolidator.test.ts` (LLM-off → rule-based only, no throw) + `memory-consolidation-job.test.ts` (SQLite runs, SUPERSEDES edge created, event emitted, pinned exempt).

### P1-READSIDE: Hide superseded rows ⭐
1. WHEN recall (FTS, both backends) or `listMemories` runs THEN memories that are the target of a `SUPERSEDES` edge SHALL be excluded.
2. The exclusion SHALL be idempotent and not affect the new (superseding) memory.
- Independent Test: covered by `memory-consolidation-job.test.ts` (post-merge recall hides sources).

### P1-SESSIONS: Durable Synapse sessions ⭐
1. A `SessionStore` interface + `SqliteSessionStore` SHALL persist `AgentSession` to `synapse_sessions` (snapshot JSON of buffer + scalar fields) and `synapse_access_history` (per-memory access counts).
2. `SessionRegistry.create/updateTaskContext/recordAccess/delete` SHALL write-through to the store (best-effort); `get` SHALL lazy-load on a Map miss.
3. The in-memory `Map` SHALL remain the hot cache (hit path does not hit the store).
4. Tables SHALL be additive (`CREATE TABLE IF NOT EXISTS`) on both backends.
- Independent Test: `packages/core/src/__tests__/session-store.test.ts` (persist + reload round-trip).

### P1-JOBS: Durable index jobs + crash recovery ⭐
1. A `SqliteJobStore` SHALL persist `IndexJob` to `index_jobs`.
2. `IndexJobTracker.createJob/updateStatus/updateProgress/setResult` SHALL write-through.
3. On store init, stale `running` jobs SHALL be marked `failed` with `error='process restart'`.
4. Table additive on both backends.
- Independent Test: `packages/core/src/__tests__/index-job-store.test.ts` (persist + stale-recovery).

## Edge Cases
- Decay on a memory with `importance=0` → score 0 (not negative).
- Decay with `accessCount=0`, `lastAccessed=null` → access term uses `createdAt` for `Δt_access`.
- Pinned memory also soft-deleted → still hidden from recall (soft-delete wins on visibility).
- Consolidation cluster of exactly 1 memory → no batch (need ≥2).
- LLM returns a zod-invalid object → treated as failure, fall through to rule-based.
- Session store write throws (disk full) → warn + continue (hot cache still updated).
- Two batches reference overlapping sources → second batch's edges are additive (no overwrite; `createEdge` UNIQUE constraint handles dedup).

## Requirement Traceability

| ID | Story | Status |
| --- | --- | --- |
| P1-DECAY-01..07 | Decay fn | Pending |
| P1-SOFTDELETE-01..04 | Soft-delete | Pending |
| P1-PINNED-01..02 | Pinned column | Pending |
| P1-LLMCLIENT-01..05 | LLM client | Pending |
| P1-CONSOLIDATE-01..07 | Consolidation job | Pending |
| P1-READSIDE-01..02 | Hide superseded | Pending |
| P1-SESSIONS-01..04 | Durable sessions | Pending |
| P1-JOBS-01..04 | Durable jobs | Pending |

## Success Criteria
- `bun run test` green vs Phase-0 baseline (**611 pass / 0 fail** actual baseline; plan doc said 609 — using the true measured 611). No regressions.
- `bun run type-check` clean (5/5 tasks).
- LLM features default-off and degrade silently (dedicated test forces LLM off AND forces a throw → non-LLM path runs, no error).
- One atomic commit per item (3 commits). No test weakened/skipped/deleted to pass.
- Migrations additive-only, both backends.

## Design / Tasks
- See `design.md` (required — multiple architectural decisions: migrations, llm-client, backend-polymorphic dispatch, session/job stores).
- Tasks: see `tasks.md`.

## Verification Approach
Per-task gate (`bun test <touched files>` + `bun run type-check`) + atomic commit. After all three: sole-agent standalone fresh-eyes re-derivation + discrimination sensor → `validation.md` (same-author caveat labeled).
