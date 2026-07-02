# Phase 1 — Tasks

One atomic commit per item (3 commits total). Gate per item: `bun test <new+affected>` + `bun run type-check` clean.

## Item 1 — Decay fn + pinned/deleted_at (commit 1)

1. `packages/shared/src/config/index.ts`: add `envBool`, `envString` helpers; add `memory: { decay: DecayParams }` to `ServerConfig`, `defaultConfig`, `mergeConfig`; export `DecayParams` type. Add top-level `llm` block (needed by Item 2 but lands here to avoid a config round-trip — see Note). Keep `compression.llm` as deprecated alias computed from `llm`.
   - **Note:** The `llm` config block is added in Item 1's commit only because `config/index.ts` is touched once; the `llm-client.ts` consumer lands in Item 2. This keeps the config diff atomic and avoids editing the same file twice. (If Item 1's tests fail, the `llm` block is inert — no consumer yet.)
2. `packages/core/src/services/memory/decay.ts`: `DecayParams`, `DEFAULT_DECAY_PARAMS`, `decayScore(mem, params?, now?)` pure fn. Mem shape: `{ importance, accessCount?, createdAt, lastAccessed?, pinned? }`.
3. `packages/core/src/__tests__/decay.test.ts`: property + pinned + clamping + sub-threshold.
4. `packages/core/src/services/memory/memory-service.ts`: replace `temporalScore` body with `decayScore` call (read `config.memory.decay`); pinned-aware.
5. `packages/core/src/data/memory/memory-repository.ts`: CREATE TABLE add `pinned`/`deleted_at`; PRAGMA-guarded ALTER; `MemoryRow` gains fields; `insert` sets defaults; `deleteById(id, hard=false)` soft by default; `fullTextSearch` adds `deleted_at IS NULL` + (Item 2 adds superseded filter); add `update` support for `pinned`.
6. `packages/core/prisma/schema.prisma`: `Memory` gains `pinned`/`deletedAt` + index.
7. `packages/core/src/data/memory/memory-repository-pg.ts`: `RawMemory`/SELECT lists/`toMemoryRow`/`insert`/`update`/`deleteById(id, hard)` extended; soft-delete filter in FTS.
8. `packages/core/src/services/query/memory-query.service.ts`: `listMemories`/`getStats`/`getRecentMemories` exclude `deletedAt != null`.
9. Extend `memory-crud.test.ts`: soft-delete + filtering + double-delete + hard-delete still severs.
10. **Gate:** `bun test packages/core/src/__tests__/decay.test.ts packages/core/src/__tests__/memory-crud.test.ts` + `bun run type-check`. Commit.

## Item 2 — LLM client + consolidator + polymorphic job (commit 2)

1. `packages/core/src/services/memory/llm-client.ts`: `llmComplete`, `llmObject`, `isLlmEnabled`, `LlmResult`. try/catch + AbortSignal timeout + disabled-gate.
2. `packages/core/src/__tests__/llm-client.test.ts`: disabled→sentinel; enabled+throw→sentinel (no throw); enabled+mock ok→value. (Use `mock.module` to stub `ai`/`@ai-sdk/openai` so no network.)
3. `packages/core/src/services/memory/consolidator.ts`: `ConsolidatedBatch`, zod schema (enum type/level), `consolidateWindow(memories, opts)`; cosine prefilter (≥0.65, ≥2, top-N=8).
4. `packages/core/src/__tests__/consolidator.test.ts`: fake llm ok→batch; fake llm not-ok→null; single-memory→null.
5. `packages/core/src/services/events/event-bus.ts`: add `memory:consolidated` to `EventMap`.
6. `packages/core/src/services/jobs/memory-consolidation-job.ts`: remove `isPostgresEnabled`; dispatch via `getMemoryRepository`; decay via `decayScore` (pinned+deleted_at aware); prune = soft-delete; merge phase (`consolidateWindow` → insert new + `createEdge SUPERSEDES` per source); emit `memory:consolidated`; extend `ConsolidationStats { merged, batchesCreated }`.
7. `packages/core/src/data/memory/memory-repository.ts:fullTextSearch`: add `NOT EXISTS (… SUPERSEDES …)` filter (SQLite cols).
8. `packages/core/src/data/memory/memory-repository-pg.ts:fullTextSearch`: add `NOT EXISTS (… SUPERSEDES …)` filter (PG cols).
9. `packages/core/src/services/query/memory-query.service.ts:listMemories`: Prisma `NOT edgesTo some SUPERSEDES`.
10. `packages/core/src/__tests__/memory-consolidation-job.test.ts`: SQLite runs (no-op-before bug fixed); LLM-off → rule-based only no throw; LLM-fake-ok → edge + event + recall hides sources; pinned exempt.
11. **Gate:** `bun test llm-client consolidator memory-consolidation-job` + type-check. Commit.

## Item 3 — Durable sessions + index jobs (commit 3)

1. `packages/core/src/services/synapse/session/session-store.ts`: `SessionStore` interface, `MemorySessionStore` (no-op), `SqliteSessionStore` (WAL, the two tables, save/load/delete/recordAccess). Serialization helpers (Set→array, Map→rows, Float32Array→Buffer, buffer→snapshot JSON).
2. `packages/core/src/__tests__/session-store.test.ts`: round-trip; LRU order preserved; expiry respected on load.
3. `packages/core/src/services/synapse/session/session-registry.ts`: ctor takes optional store; write-through on create/updateTaskContext/recordAccess/delete; lazy-load on get-miss; `getSessionRegistry()` wires `SqliteSessionStore` with MemorySessionStore fallback.
4. `packages/core/src/services/jobs/index-job-store.ts`: `SqliteJobStore` (WAL, `index_jobs` table, save/get/listByProject/markStaleRunningFailed).
5. `packages/core/src/__tests__/index-job-store.test.ts`: persist+reload; stale `running`→`failed` on init.
6. `packages/core/src/services/jobs/index-job-tracker.ts`: ctor takes optional store; write-through; lazy-load; listJobs merges store; `getInstance()` wires `SqliteJobStore` + runs recovery.
7. **Gate:** `bun test session-store index-job-store` + type-check + full `bun run test` (regression). Commit.

## Final validation (after commit 3)

- `bun run test` (full) vs 611 baseline; `bun run type-check`.
- Discrimination sensor: 1 mutant per item (decay formula sign, llm-client gate, session write-through skip) — temporary edit, run relevant test, revert, confirm KILLED.
- Author `validation.md` (per-AC evidence table, gate output, sensor, fresh-eyes re-derivation, same-author caveat).
- Update `project/STATE.md`, `project/FEATURES.json`, `HANDOFF.md`, `PHASE-INTEGRATION.md` (Phase 1 delta + commit ledger).
