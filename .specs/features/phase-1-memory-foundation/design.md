# Phase 1 — Memory-Quality Foundation: Design

Required design doc. Covers migrations, the shared LLM client, backend-polymorphic
consolidation dispatch, the merge/SUPERSEDES phase, read-side filtering, and the
session/job durability stores. Decisions are anchored to verified source facts
(exact file:line from the Phase-1 exploration; see PHASE-INTEGRATION.md for the
ledger of corrections to the original plan).

## Verified source facts that shape this design (corrections to the plan)

| Plan claim | Verified reality | Source | Design impact |
| --- | --- | --- | --- |
| `GraphStore.addEdge` | Method is **`createEdge`**, sig `createEdge(sourceId, targetId, relationType, options:{weight?,evidence?,autoExtracted?}): MemoryEdge\|null`, **sync** | `graph-store.ts:103-184` | Use `createEdge`; for SUPERSEDES direction `newId → sourceId`, carry `{batchId}` via `evidence` (JSON string). |
| SQLite edge cols `target`/`type` | Cols are **`source_id`/`target_id`/`relation_type`**; **no `metadata`** col; `evidence` TEXT exists | `graph-store.ts:73-84` | Read-side filter: `WHERE id NOT IN (SELECT target_id FROM memory_edges WHERE relation_type='SUPERSEDES')`. Batch id via `evidence`. |
| PG edge uses `metadata` | PG `MemoryEdge` (`schema.prisma:238-257`) cols `from_id`/`to_id`/`edge_type`/`metadata Json?` | schema.prisma | PG filter uses `to_id`/`edge_type`; batch id via `metadata`. Schema drift acknowledged. |
| `temporalScore` at "146-179" | `temporalScore` is at **200-209**; 146-179 is `semanticRank` | `memory-service.ts` | Edit the right method. `decayScore` replaces `temporalScore`'s contribution; `semanticRank` weight 0.2 stays but now feeds `decayScore(mem, params, now)` normalized to `[0,1]`. |
| `envBool`/`envString` helpers | **Only `envNum` exists**; booleans inline as `process.env.X === "true"` | `config/index.ts:160-166` | Add `envBool`/`envString` helpers (small, reused by `llm` + `memory.decay`). |
| No `memory` config block | Confirmed absent | `config/index.ts:18-104` | Add `memory: { decay: DecayParams }` to `ServerConfig`, `defaultConfig`, `mergeConfig`. |
| Baseline 609 pass | Actual **611 pass / 0 fail / 61 skip** | measured | Use 611 as the regression gate. |
| SQLite migration runner | No central runner for memories; inline `CREATE TABLE IF NOT EXISTS` + `PRAGMA table_info`-guarded `ALTER TABLE` in repo ctor | `memory-repository.ts:105-174`, `symbol-db.ts:77-99` (only formal `_schema_version` runner, symbol-db only) | Mirror the inline `PRAGMA table_info` pattern for `pinned`/`deleted_at`; do NOT introduce a new central runner (out of scope, risk). |

## 1. Schema migrations (additive, both backends)

### 1a. `memories` table: add `pinned` + `deleted_at`

**SQLite** (`memory-repository.ts` ctor, after the existing `agent_id` migration block ~line 162-171):
- Extend `CREATE TABLE IF NOT EXISTS memories (...)` with `pinned INTEGER NOT NULL DEFAULT 0` and `deleted_at INTEGER`.
- Add a `PRAGMA table_info(memories)`-guarded `ALTER TABLE memories ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0` and `ALTER TABLE memories ADD COLUMN deleted_at INTEGER` for existing DBs.
- Add `CREATE INDEX IF NOT EXISTS idx_memories_deleted_at ON memories(deleted_at)` (sparse — most rows NULL).
- `MemoryRow` interface gains `pinned: number` (0/1) and `deleted_at: number | null`.

**PostgreSQL** (`schema.prisma` `model Memory`):
- Add `pinned Boolean @default(false) @map("pinned")` and `deletedAt DateTime? @map("deleted_at")`.
- Add `@@index([deletedAt])`.
- The PG raw-SQL repository (`memory-repository-pg.ts`) `RawMemory`, every `SELECT` list, `toMemoryRow`, `insert`, `update`, `deleteById` must be extended for the two new columns. `deleteById` gains a `hard: boolean = false` param: default soft (`UPDATE ... SET deleted_at = NOW()`), `hard=true` does the existing `DELETE ... RETURNING` + (caller) `MemoryGraphService.onMemoryDeleted`.

**Migration approach:** Prisma schema change is the source of truth for PG; users run `prisma migrate deploy` (existing pattern, `postgres-vector-store.ts:110`). No new raw `.sql` migration file is required for PG since the columns are additive and the raw-SQL repo enumerates columns explicitly (it does not `SELECT *`). For SQLite the ctor-time `ALTER` is the migration.

### 1b. Soft-delete filtering

- **SQLite FTS** (`memory-repository.ts:fullTextSearch`, conditions array ~line 248): add `conditions.push("(m.deleted_at IS NULL)")`.
- **PG FTS** (`memory-repository-pg.ts:fullTextSearch`, conditions ~line 198): add `conditions.push(Prisma.sql\`deleted_at IS NULL\`)`.
- **`listMemories`** (`memory-query.service.ts:56`): add `where.deletedAt = { equals: null }` to the Prisma `where` (and `getStats`/`getRecentMemories` get the same filter so dashboards don't count tombstones).
- `getById` is **not** filtered (admin/direct lookup still resolves soft-deleted rows — needed for potential restore and for the merge phase to read source content).

### 1c. `synapse_sessions` + `synapse_access_history` (new, SQLite-canonical)

`SqliteSessionStore` creates (in its own SQLite DB at `<dataDir>/synapse-sessions.db`, opened WAL):
```sql
CREATE TABLE IF NOT EXISTS synapse_sessions (
  session_id   TEXT PRIMARY KEY,
  agent_id     TEXT NOT NULL,
  workspace_id TEXT,
  task_context TEXT,
  task_tokens  TEXT,           -- JSON array of pre-tokenized taskContext
  task_embedding BLOB,         -- Float32Array buffer (may be NULL)
  ttl_ms       INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  expires_at   INTEGER NOT NULL,
  access_history_limit INTEGER NOT NULL,
  buffer_snapshot TEXT,        -- JSON of WorkingMemoryBuffer.entries (best-effort)
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_syn_sessions_expires ON synapse_sessions(expires_at);

CREATE TABLE IF NOT EXISTS synapse_access_history (
  session_id TEXT NOT NULL,
  memory_id  TEXT NOT NULL,
  access_count INTEGER NOT NULL DEFAULT 0,
  last_accessed_at INTEGER NOT NULL,
  PRIMARY KEY (session_id, memory_id)
);
CREATE INDEX IF NOT EXISTS idx_syn_access_session ON synapse_access_history(session_id);
```
- **Serialization:** `taskTokens` (Set) → array → JSON; `taskEmbedding` (Float32Array|array) → Buffer; `accessHistory` (Map) → per-row in `synapse_access_history` (head = LRU most-recent, reconstructed in insertion order on load); `buffer` → `buffer.toJSON()` snapshot if present.
- **PG parity:** out of scope this phase (sessions are SQLite-canonical; the plan's "both backends" applies to `memories`/`memory_edges`. Sessions are agent-runtime state, not queryable analytics. The `SessionStore` interface is backend-agnostic so a `PostgresSessionStore` can be added later without touching `SessionRegistry`.) — recorded as accepted assumption.

### 1d. `index_jobs` (new, SQLite-canonical)

`SqliteJobStore` creates (`<dataDir>/index-jobs.db`, WAL):
```sql
CREATE TABLE IF NOT EXISTS index_jobs (
  job_id       TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  project_path TEXT NOT NULL,
  status       TEXT NOT NULL,   -- pending|running|completed|failed
  current      INTEGER NOT NULL DEFAULT 0,
  total        INTEGER NOT NULL DEFAULT 0,
  percentage   INTEGER NOT NULL DEFAULT 0,
  files_indexed INTEGER,
  chunks_indexed INTEGER,
  errors       INTEGER,
  duration     INTEGER,
  error        TEXT,
  created_at   INTEGER NOT NULL,
  started_at   INTEGER,
  completed_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_jobs_project ON index_jobs(project_id);
CREATE INDEX IF NOT EXISTS idx_jobs_status ON index_jobs(status);
```
- **Crash recovery (ctor):** `UPDATE index_jobs SET status='failed', error='process restart', completed_at=? WHERE status='running'`.
- PG parity: same accepted-assumption as sessions (runtime state, SQLite-canonical; interface is portable).

## 2. Shared LLM client (`services/memory/llm-client.ts`)

### 2a. Config (top-level `llm` block)

`ServerConfig.llm`:
```ts
llm: {
  enabled: boolean;
  baseUrl: string;
  apiKey: string;
  model: string;
  temperature: number;
  maxOutputTokens: number;
  timeoutMs: number;
};
```
Defaults (Ollama local-first, default-off):
```ts
llm: {
  enabled: process.env.RLM_LLM_ENABLED === "true",
  baseUrl: process.env.RLM_LLM_BASE_URL || "http://localhost:11434/v1",
  apiKey: process.env.RLM_LLM_API_KEY || "ollama",
  model: process.env.RLM_LLM_MODEL || "qwen2.5-coder:7b",
  temperature: Number(process.env.RLM_LLM_TEMPERATURE || "0.2"),
  maxOutputTokens: Number(process.env.RLM_LLM_MAX_OUTPUT_TOKENS || "2000"),
  timeoutMs: Number(process.env.RLM_LLM_TIMEOUT_MS || "30000"),
};
```
`mergeConfig` gains `llm: { ...defaults.llm, ...overrides.llm }`.

**Deprecated alias:** `compression.llm` is computed from `llm` so existing readers (`code-compressor.ts`, Phase 7) see no change. In `defaultConfig`, `compression.llm` becomes a getter-free copy: assign `compression.llm = { ...llmFields }` after `llm` is defined (keep the same shape: `enabled/baseUrl/apiKey/model/temperature/maxOutputTokens/timeoutMs/prompt?`). `prompt` stays on `compression.llm` only (it's compression-specific). This preserves the public `config.get("compression").llm` shape.

### 2b. Client API

```ts
export interface LlmResult<T = string> { ok: boolean; value?: T; error?: string; }
export async function llmComplete(prompt: string, opts?: { system?: string; timeoutMs?: number }): Promise<LlmResult<string>>;
export async function llmObject<T>(prompt: string, schema: z.ZodSchema<T>, opts?: { system?: string; timeoutMs?: number }): Promise<LlmResult<T>>;
export function isLlmEnabled(): boolean;
```
- Uses `createOpenAI({ baseURL, apiKey, compatibility: "compatible" })({ model })` + `generateText`/`generateObject` from `ai`.
- `generateObject` uses `{ schema, mode: "json" }`.
- **Gate:** `if (!isLlmEnabled()) return { ok: false, error: "llm disabled" };` before any network.
- **Timeout:** `AbortSignal.timeout(opts?.timeoutMs ?? config.llm.timeoutMs)` passed to `generate*`.
- **Silent degrade:** whole body in `try/catch`; on any error `logger.warn("llm call failed", {error})` and `return { ok:false, error: e.message }`. Never throws.

## 3. Consolidator (`services/memory/consolidator.ts`)

```ts
export interface ConsolidatedBatch {
  id: string;
  sourceIds: string[];
  summary: string;
  type: MemoryType;   // zod enum
  level: MemoryLevel; // zod enum
  rationale: string;
}
export async function consolidateWindow(
  memories: MemoryRow[],
  opts: { llm: { complete: typeof llmComplete; object: typeof llmObject }; cosine?: (a,b)=>number }
): Promise<ConsolidatedBatch | null>;
```
- **Prefilter (rule-based, no LLM):** group by `project_id`; within a group compute pairwise cosine over `embedding`; if any pair ≥ 0.65 and group size ≥ 2, take top-N (N=8) by recency → candidate window. If no window meets the threshold, return `null` (no batch).
- **LLM call:** `llmObject(prompt, ConsolidatedBatchSchema)` where the zod schema enforces `type: z.enum([...MemoryType values])`, `level: z.nativeEnum(MemoryLevel)`, non-empty `summary`/`rationale`, `sourceIds` matching inputs.
- **Failure:** if `llm` disabled or `result.ok===false` → return `null`. Caller treats `null` as "no merge this cycle".

## 4. Backend-polymorphic `MemoryConsolidationJob`

- **Remove** `isPostgresEnabled()` and its `maybeRun` guard.
- **Dispatch:** `const repo = getMemoryRepository();` (returns `MemoryRepository | MemoryRepositoryPg` union). The job calls union-safe methods. Decay/prune operate via the repository's existing primitives + raw SQL where the union method is missing.
- **Decay via `decay.ts`:** fetch candidate rows (importance < 0.8, older than stale threshold, `pinned = 0`, `deleted_at IS NULL`), compute `decayScore` in-process, and `UPDATE memories SET importance = score WHERE id = ?` per row (batched). This replaces the per-type multiplicative `DECAY_RATES` raw SQL for the importance-decay decision. (The old per-type rates are retired — `decayScore`'s formula subsumes them via `salience` + access.)
- **Prune:** `deleted_at`-aware + pinned-aware: `WHERE created_at < cutoff AND importance < coldThreshold AND access_count < 2 AND pinned = 0 AND deleted_at IS NULL`. Default behavior is now **soft-delete** (`UPDATE ... SET deleted_at = NOW()`) rather than hard `DELETE`, consistent with P1-SOFTDELETE. (Hard purge of long-tombstoned rows is a future ops job, out of scope.)
- **Merge phase (new):** after decay+prune, run `consolidateWindow` over each project's candidate set. For each non-null batch:
  1. Insert a new memory (`type=batch.type, level=batch.level, importance=max(source importances), content=batch.summary, metadata={batchId, consolidated:true}`).
  2. For each `sourceId`: `graphStore.createEdge(newId, sourceId, SUPERSEDES, { evidence: JSON.stringify({batchId}), weight: 1.0 })` (SQLite) / PG equivalent via `GraphStorePg`.
  3. `eventBus.publish("memory:consolidated", { batchId, sourceIds, newMemoryId, projectId, stats })`.
  - `merged += sourceIds.length; batchesCreated += 1`.
- **GraphStore access:** use `getGraphStore()` from `graph-store-factory.ts` (returns `GraphStore | GraphStorePg`). Both expose `createEdge` (SQLite sync, PG async) — handle via `await Promise.resolve(...)` or a small `createEdgeAsync` helper inside the job to normalize.
- **`ConsolidationStats`:** `{ promoted, decayed, pruned, edgesCleaned, merged, batchesCreated }`. `edgesCleaned` stays (set to edges superseded count) for back-compat.

## 5. Read-side filtering (hide superseded)

- **SQLite FTS** `fullTextSearch`: add `AND m.id NOT IN (SELECT target_id FROM memory_edges WHERE relation_type = 'SUPERSEDES')` to the SQL template (line ~313 region). Cheaper as a `NOT EXISTS` correlated subquery: `AND NOT EXISTS (SELECT 1 FROM memory_edges me WHERE me.target_id = m.id AND me.relation_type = 'SUPERSEDES')`.
- **PG FTS:** `AND NOT EXISTS (SELECT 1 FROM memory_edges me WHERE me.to_id = memories.id AND me.edge_type = 'SUPERSEDES')`.
- **`listMemories`:** add `where.NOT = { edgesTo: { some: { edgeType: "SUPERSEDES" } } }` to the Prisma where (uses the relation; prisma-safe).

## 6. SessionStore + SessionRegistry integration

- `SessionStore` interface: `save(session): Promise<void> | void`, `load(sessionId): AgentSession | null | Promise<...>`, `delete(sessionId)`, `recordAccess(sessionId, memoryId, count, ts)`.
- `MemorySessionStore` (no-op, for tests/ephemeral) and `SqliteSessionStore` (real).
- `SessionRegistry` ctor takes an optional `store?: SessionStore`. If provided:
  - `create`/`updateTaskContext`/`recordAccess`/`delete` → write-through (best-effort `try/catch` + `logger.warn` on failure; hot cache always updated).
  - `get` → on Map miss, `store.load(id)`; if found and not expired, populate Map + return.
- The module-level `getSessionRegistry()` constructs `SqliteSessionStore` by default (lazy-opened; if the DB can't open, fall back to `MemorySessionStore` + warn — degradation).

## 7. SqliteJobStore + IndexJobTracker integration

- `SqliteJobStore` interface mirrors `IndexJobTracker` mutations: `save(job)`, `get(jobId)`, `listByProject(projectId)`, `markStaleRunningFailed()`.
- `IndexJobTracker` ctor takes optional `store?`. `createJob/updateStatus/updateProgress/setResult` write-through. `getJob` lazy-loads on miss. On first `getInstance()` with the Sqlite store, call `markStaleRunningFailed()`.
- `listJobs`/`listJobsByProject` merge hot Map + store (store is source of truth for completed-but-evicted jobs).

## 8. EventBus extension

Add to `EventMap` (`event-bus.ts:12-70`):
```ts
"memory:consolidated": {
  batchId: string;
  sourceIds: string[];
  newMemoryId: string;
  projectId?: string;
  stats: { merged: number; batchesCreated: number };
};
```

## 9. Test strategy

- `decay.test.ts`: property tests (monotonic in Δt, pinned exempt, bounded `[0,1]`, recency boosts access term, sub-threshold flagged) — pure fn, no DB.
- `llm-client.test.ts`: disabled-by-default returns `{ok:false}` without network; enabled+mocked-throw returns `{ok:false}` (no throw); enabled+mocked-success returns `{ok:true, value}`.
- `consolidator.test.ts`: inject a fake `llm.object` that (a) returns ok → batch produced with zod-enforced type/level; (b) returns not-ok → `null`; prefilter rejects single-memory windows.
- `memory-consolidation-job.test.ts`: SQLite path (mock config, temp dir); force LLM off → rule-based only, `merged=0`, no throw; force LLM fake-ok → SUPERSEDES edge created, event emitted, recall hides sources, pinned memory not decayed.
- `session-store.test.ts`: round-trip persist+load preserves buffer snapshot + access history LRU order.
- `index-job-store.test.ts`: persist + reload; stale `running` → `failed` on init.
- `memory-crud.test.ts` (extend): soft-delete sets `deleted_at`, recall excludes it, double-delete idempotent, hard-delete still severs edges.

## Risks
- **Schema drift (SQLite vs PG edge tables).** Mitigated: dispatch-aware SQL (`target_id`/`relation_type` vs `to_id`/`edge_type`). Documented in PHASE-INTEGRATION.
- **LLM latency on consolidation.** Mitigated: default-off, bounded cluster size (≤8), timeout via `AbortSignal`, silent degrade.
- **Session-store write amplification.** `recordAccess` fires per memory access. Mitigated: write-through is best-effort + fire-and-forget (do not block retrieval); hot cache is authoritative for reads.
- **Same-author verification.** Sole agent → no independent verifier. Mitigated: standalone fresh-eyes re-derivation + discrimination sensor, both labeled with the caveat in `validation.md`.
