# Phase 1 — Memory-Quality Foundation: Validation

Slug: `phase-1-memory-foundation`. **Same-author verification** (sole agent for
this phase — author = verifier). Run as a strict standalone fresh-eyes
re-derivation + discrimination sensor. The same-author caveat applies: there is
no independent second agent. Mitigations: every AC is anchored to file:line
evidence below, the discrimination sensor killed every mutant, and the gate is
the objective `bun run test` + `bun run type-check`.

## Verdict: PASS

All three feature deliverables (decay fn, LLM consolidation, durable
sessions/jobs) plus the cross-cutting LLM client, pinned/soft-delete columns,
and the SUPERSEDES read-side filter meet their acceptance criteria. Gate =
`bun run test` **677 pass / 0 fail / 46 skip** (baseline 611 → +66, no
regressions), `bun run type-check` clean (5/5). The discrimination sensor
killed all three mutants. LLM features default-off and degrade silently (proven
by dedicated tests forcing LLM off AND forcing a throw).

## Scope reviewed

- Commits: `befa3cb` (specs), `e49ffa9` (item 1 — decay/pinned/soft-delete),
  `12fe002` (item 2 — llm-client/consolidator/job/read-side), `1ccb42c`
  (item 3 — durable sessions/jobs).
- Test diff: +7 test files / new describes; **no tests weakened, skipped,
  deleted, or `.skip`/`todo`/`xit`/`only` added**. The Phase-0 memory-crud
  contract (hard-delete severs edges) is preserved verbatim.

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P1-DECAY-01 | decayScore formula | `decay.ts:73-86` computes `salience·exp(-λΔt)+σ·log(1+access)·exp(-μΔt_access)`; `decay.test.ts:38-49` asserts the closed form. | YES |
| P1-DECAY-02 | monotonic non-increase in Δt | `decay.test.ts:52-67` two loops (age + lastAccessed recede) assert `s <= prev+1e-9`. | YES |
| P1-DECAY-03 | pinned exempt → importance | `decay.ts:78-80` returns clamp01(salience); `decay.test.ts:91-104` pinned=1 / pinned=true both assert unchanged. | YES |
| P1-DECAY-04 | sub-threshold pruned | `decay.ts:isCold` (101-110); `decay.test.ts:138-160` flags cold + pinned-never-cold. | YES |
| P1-DECAY-05 | recency boosts access term | `decay.test.ts:122-130` accessCount 0→5→50 non-decreasing. | YES |
| P1-DECAY-06 | bounded [0,1] | `decay.ts:clamp01`; `decay.test.ts:108-121` extreme inputs (incl +∞). | YES |
| P1-DECAY-07 | semanticRank delegates | `memory-service.ts:206-220` temporalScore calls `decayScore(config.memory.decay)`; old half-life body removed. | YES |
| P1-SOFTDELETE-01 | soft-delete sets deleted_at | `memory-repository.ts:softDeleteById` (399-422); `memory-crud.test.ts:226-239` asserts deleted_at set + FTS hides. | YES |
| P1-SOFTDELETE-02 | recall excludes tombstones | SQLite FTS `m.deleted_at IS NULL` (`memory-repository.ts:287`); PG FTS + list/getStats/getRecent (`memory-query.service.ts:57,96-119,127`); PG raw lists all filter. | YES |
| P1-SOFTDELETE-03 | idempotent double-delete | `memory-crud.test.ts:242-245` second softDeleteById → false, no throw. | YES |
| P1-SOFTDELETE-04 | hard-delete intact | `deleteById` unchanged (hard); `memory-crud.test.ts:247-251` + Phase-0 `:186-197` (hard-delete severs edges). | YES |
| P1-PINNED-01 | pinned column both backends | SQLite CREATE/ALTER (`memory-repository.ts:142,189-192`); prisma `pinned Boolean` (`schema.prisma:34`); PG raw lists + insert/update. | YES |
| P1-PINNED-02 | consolidation never decay/prune pinned | candidate query `pinned = 0`/`false` (`memory-repository.ts:listConsolidationCandidates`, PG mirror); `memory-crud.test.ts:288-294` importance unchanged. | YES |
| P1-LLMCLIENT-01 | top-level llm config, Ollama defaults, default-off | `config/index.ts` ServerConfig.llm + defaultConfig.llm (envBool RLM_LLM_ENABLED=false). | YES |
| P1-LLMCLIENT-02 | llmComplete/llmObject | `llm-client.ts:81-114,116-145`; `llm-client.test.ts:142-156` success returns value. | YES |
| P1-LLMCLIENT-03 | disabled → sentinel, no network | `llm-client.ts:85-87`; `llm-client.test.ts:96-104` lastCall stays null. | YES |
| P1-LLMCLIENT-04 | throw/timeout → sentinel, no caller throw | `llm-client.ts:try/catch` (90-95, 132-137); `llm-client.test.ts:117-135` throw→{ok:false}. | YES |
| P1-LLMCLIENT-05 | compression.llm alias | `config/index.ts:defaultConfig.compression.llm` mirrors llm fields (env-driven). | YES |
| P1-CONSOLIDATE-01 | no isPostgresEnabled short-circuit | `memory-consolidation-job.ts` ctor/`consolidate` dispatch via `getMemoryRepository()`; `memory-crud.test.ts:282-287` SQLite runs (was no-op). | YES |
| P1-CONSOLIDATE-02 | decay via decayScore both backends | `memory-consolidation-job.ts:decayStaleMemories` calls `decayScore`; pinned/deleted_at-aware candidate query. | YES |
| P1-CONSOLIDATE-03 | ConsolidatedBatch via generateObject + zod | `consolidator.ts:ConsolidatedBatchSchema` (enum type/level, ≥2 sourceIds); `consolidator.test.ts:88-112`. | YES |
| P1-CONSOLIDATE-04 | merge → new memory + SUPERSEDES per source | `memory-consolidation-job.ts:mergeMemories` (insert + addSupercedesEdge); `memory-crud.test.ts:208-238` edges + new memory visible. | YES |
| P1-CONSOLIDATE-05 | ConsolidationStats {merged,batchesCreated} | `memory-consolidation-job.ts:ConsolidationStats`; `memory-crud.test.ts:209-210` batchesCreated=1, merged=2. | YES |
| P1-CONSOLIDATE-06 | memory:consolidated emitted | `event-bus.ts:EventMap` + `mergeMemories` publish; `memory-crud.test.ts:199-206` fired payload asserted. | YES |
| P1-CONSOLIDATE-07 | LLM off/throw → rule-based only, no error | `memory-crud.test.ts:179-186` (off) + `228-234` (throw) → merged=0, no throw. | YES |
| P1-READSIDE-01 | recall hides superseded | SQLite FTS `NOT EXISTS … target_id/relation_type` (`memory-repository.ts:357-362`); PG `to_id/edge_type`; `listMemories` Prisma NOT edgesTo.some SUPERSEDES (`memory-query.service.ts:60`); `memory-crud.test.ts:240-242` sources hidden. | YES |
| P1-READSIDE-02 | exclusion idempotent, superseding visible | `memory-crud.test.ts:243-244` new memory (supA.sourceId) IS in recall. | YES |
| P1-SESSIONS-01 | SessionStore + SqliteSessionStore persist | `session-store.ts` (synapse_sessions + synapse_access_history); `session-store.test.ts:46-62` round-trip. | YES |
| P1-SESSIONS-02 | registry write-through | `session-registry.ts:create/updateTaskContext/recordAccess/delete` save/recordAccess; `session-store.test.ts:130-147` reload after restart. | YES |
| P1-SESSIONS-03 | Map hot cache | `session-registry.ts:get` returns cached on hit; lazy-load only on miss. | YES (code; hit-path implicit) |
| P1-SESSIONS-04 | additive tables both backends | `CREATE TABLE IF NOT EXISTS` (SQLite); PG schema parity delivered via migration `20260710120000_add_synapse_sessions_pg`; runtime `PgSessionStore` delivered (`packages/core/src/services/synapse/session/session-store-pg.ts`). SQLite runtime removed (M29 closed). | YES |
| P1-JOBS-01 | SqliteJobStore persists index_jobs | `index-job-store.ts`; `index-job-store.test.ts:31-44` round-trip. | YES |
| P1-JOBS-02 | tracker write-through | `index-job-tracker.ts:createJob/updateStatus/updateProgress/setResult` save; `index-job-store.test.ts:107-117` reload. | YES |
| P1-JOBS-03 | stale running → failed on init | `index-job-store.ts:getDB` recovery; `index-job-store.test.ts:75-87`. | YES |
| P1-JOBS-04 | additive both backends | SQLite `CREATE TABLE IF NOT EXISTS`; PG schema parity delivered via migration `20260710120000_add_synapse_sessions_pg`; runtime `PgJobStore` delivered (`packages/core/src/services/jobs/index-job-store-pg.ts`). SQLite runtime removed (M29 closed). | YES |

## Edge cases

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| decay importance=0 → 0 | `decay.test.ts:115-118` | YES |
| accessCount=0 / lastAccessed=null → uses createdAt | `decay.test.ts:56-65` | YES |
| pinned + soft-deleted → hidden (soft-delete wins) | soft-delete filter independent of pinned; tombstone hides row. | YES (code) |
| consolidation cluster of 1 → no batch | `consolidator.ts:pickConsolidationWindow` requires ≥2; `consolidator.test.ts:127-130`. | YES |
| LLM zod-invalid → failure, fall through | `llm-client.ts` zod throws inside generateObject → caught; `llm-client.test.ts:131-135`. | YES |
| session write throws → warn + continue | `session-store.ts:save` try/catch + warn; hot cache always updated. | YES (code) |
| two batches overlap sources → additive edges | `createEdge` UNIQUE(source,target,type) dedups. | YES (code; relies on GraphStore contract) |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| Full suite | `bun run test` | **677 pass / 0 fail / 46 skip** (baseline 611 → +66). Ran 723 across 57 files. |
| type-check | `bun run type-check` | **clean** (5/5 tasks; prisma regenerate green). |
| LLM-off degradation | `bun test memory-consolidation-job/memory-crud` | LLM-disabled → rule-based only, `merged=0`, no throw, no SUPERSEDES edges (`memory-crud.test.ts:179-186`). LLM-throw → `{ok:false}`, no caller throw (`llm-client.test.ts:117-135`). |

## Discrimination sensor

Each mutant was a temporary source edit; only the relevant test file was run;
the source was reverted with `cp` immediately after. Tree verified clean.

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| decay | `decay.ts` salience term `exp(-λΔt)` → `exp(+λΔt)` | `decay.test.ts` | **KILLED** — 4 fail (monotonic + formula + cold + clamping). |
| llm-client | `isLlmEnabled` `return testEnabledOverride` → `return true` | `llm-client.test.ts` | **KILLED** — 3 fail (disabled-default sentinel + no-network). |
| session | `session-registry.ts recordAccess` write-through guarded `if (false)` | `session-store.test.ts` | **KILLED** — 1 fail (accessHistory not preserved across restart). |

All three mutants killed. No surviving mutants.

## Fresh-eyes re-derivation (standalone)

Re-deriving each AC from the spec, independent of the implementation notes:

1. **Decay formula correctness.** Spec: `salience·exp(-λΔt)+σ·log(1+access)·exp(-μΔt_access)`.
   Read `decay.ts`: terms match exactly; Δt uses `lastAccessed ?? createdAt`
   for both terms (as the spec's `Δt` and `Δt_access` both reduce to the same
   reference when access is the last touch). Clamping `[0,1]` and pinned
   short-circuit present. **OK.**
2. **Backend-polymorphic consolidation.** Spec: remove the short-circuit.
   `grep isPostgresEnabled memory-consolidation-job.ts` → 0 matches. The job
   imports `getMemoryRepository` (factory dispatch) and `getGraphStore`.
   **OK.**
3. **Silent degrade.** Spec: LLM off/throw → non-LLM path, no error. Both
   `llmComplete` and `llmObject` wrap the whole body in try/catch returning
   `{ok:false}`; `consolidateWindow` returns `null` on `{ok:false}`; the job's
   `mergeMemories` returns `{merged:0,batchesCreated:0}` on `null` batch.
   **OK.**
4. **Read-side filter.** Spec: hide superseded. SQLite FTS has the `NOT EXISTS`
   on `memory_edges(target_id, relation_type='SUPERSEDES')`; PG uses
   `(to_id, edge_type)`; `listMemories` uses Prisma `NOT edgesTo some`. The
   memory_edges table is ensured in `MemoryRepository` too (so it works without
   GraphStore instantiated). **OK.**
5. **Durable sessions.** Spec: write-through + lazy-load. Registry ctor takes a
   store; create/recordAccess/delete write-through; get lazy-loads on miss.
   Restart-reload test proves accessHistory survives. **OK.**
6. **Crash recovery.** Spec: stale running → failed. `SqliteJobStore.getDB`
   runs the UPDATE on first open; test proves a `running` row becomes `failed`
   with `error='process restart'`. **OK.**

No gaps surfaced in re-derivation beyond the two accepted assumptions below.

## Accepted assumptions / residual risk

1. **PG parity for sessions/jobs tables delivered.** `synapse_sessions` and
   `index_jobs` schema parity landed via migration
   `20260710120000_add_synapse_sessions_pg`; runtime `PgSessionStore`
   (`packages/core/src/services/synapse/session/session-store-pg.ts`) and
   `PgJobStore` (`packages/core/src/services/jobs/index-job-store-pg.ts`) are
   delivered. SQLite runtime removed (M29 closed;
   `sqlite-removal` complete; `sqlite-removal-followup` in_progress for
   non-gating fixture/e2e probes). The `SessionStore`/`JobStore` interfaces
   remain backend-agnostic.
2. **Buffer snapshot is best-effort.** The `WorkingMemoryBuffer` is a hot cache;
   on load the session is reconstructed with a fresh buffer that refills
   naturally. The scalar fields + accessHistory (the load-bearing state for
   agent-affinity) ARE fully persisted and restored. Low risk: losing the buffer
   only costs a warm-start; correctness is unaffected.
3. **Edge batch-id carrier differs by backend.** SQLite `memory_edges` has no
   `metadata` column; the batch id is carried via `evidence` (JSON). PG
   `MemoryEdge` uses `metadata`. This is documented in PHASE-INTEGRATION and
   does not affect the read-side filter (which keys on relation_type only).
4. **`isPostgresEnabled()`-style promotion preserved for PG.** The session→user
   promotion phase is SQLite-no-op (the original used PG-only raw SQL); PG
   keeps it. This matches the Phase-0 landed behavior and is not a regression.
5. **Same-author verification.** No independent verifier sub-agent was spawned.
   Mitigated by the per-AC evidence table, the discrimination sensor (3/3
   killed), and the objective gate.

## Conclusion

Phase 1 meets its acceptance criteria and success criteria. Verdict **PASS**.
Ready for Phase 2 (query understanding) to consume `llm-client` + the top-level
`llm` config + `memory:consolidated` event.
