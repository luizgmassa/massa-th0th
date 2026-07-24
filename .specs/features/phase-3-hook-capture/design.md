# Phase 3 — Passive Memory Capture: Design

Slug: `phase-3-hook-capture`. Companion to `spec.md`. This design covers the
ingestion pipeline, the single-writer queue + WAL + 429 backpressure model,
the Observation schema + migrations (both backends), the consolidation bridge,
hook-script generation, and all degradation paths. Every symbol referenced is
verified against current source (file:line cited).

## 1. Architecture overview

```
Claude Code hooks (apps/claude-plugin/hooks/*.sh)
  │  curl POST /api/v1/hook  (or /hook/batch)
  ▼
Tools API (apps/tools-api/src/routes/hooks.ts, Elysia)  ── validate ──► 400/413
  │  admitted
  ▼
HookService.ingest(events)                      packages/core/src/services/hooks/hook-service.ts
  │  1. enqueue on single-writer promise-chain queue (saturation → throw QueueSaturated → 429)
  │  2. inside writer: ObservationRepository.insert  (SQLite WAL)
  │  3. eventBus.publish("observation:ingested", …)
  │  4. maybeTrigger bridge (debounce: every N or minInterval)
  ▼
ObservationRepository                           packages/core/src/data/memory/observation-repository.ts
  ├── SqliteObservationStore (default; WAL; observations.db)
  ├── MemoryObservationStore (no-op fallback / tests)
  └── factory getObservationStore()/resetObservationStore()   (mirrors SessionStore/JobStore)
        ▼ (PG path, parity)
        Prisma Observation model   packages/core/prisma/schema.prisma
  ▼ (bridge, fire-and-forget)
ObservationConsolidationJob                     packages/core/src/services/jobs/observation-consolidation-job.ts
  │  listRecentObservations(projectId) → consolidator.consolidateWindow(candidates, llmSurface)
  │     → MemoryRepository.store(summary) + GraphStore.createEdge(new, src, SUPERSEDES)
  │  silent-skip when !isLlmEnabled() || {ok:false} || throw
  └─ eventBus.publish("memory:consolidated", …)
```

The shape mirrors the Phase-1 consolidation flow and the Phase-2
query-understanding service: an LLM-dependent stage wrapped so it can never
throw to its caller and never blocks the primary path.

## 2. Config (new `hooks` block)

Add to `packages/shared/src/config/index.ts`:

Type (alongside the existing `llm`, `memory.decay`, `search.queryUnderstanding`):
```ts
hooks: {
  enabled: boolean;            // ingestion gate; default true (no LLM dep)
  maxPayloadBytes: number;     // per-event payload cap; default 65_536
  queue: {
    maxPending: number;        // saturation threshold → 429; default 256
  };
  bridge: {
    enabled: boolean;           // gate the LLM consolidation bridge; default true
                                 // (still no-ops when llm.enabled=false)
    minObservations: number;    // trigger after N new observations; default 8
    minIntervalMs: number;      // …or after this long; default 5*60*1000
    maxWindow: number;          // cap candidates per run; default 8
  };
};
```

Defaults (`defaultConfig`): `enabled: envBool("HOOKS_ENABLED", true)`,
`maxPayloadBytes: envNum("HOOKS_MAX_PAYLOAD_BYTES", 65_536)`,
`queue.maxPending: envNum("HOOKS_QUEUE_MAX_PENDING", 256)`,
`bridge.enabled: envBool("HOOKS_BRIDGE_ENABLED", true)`,
`bridge.minObservations: envNum("HOOKS_BRIDGE_MIN_OBS", 8)`,
`bridge.minIntervalMs: envNum("HOOKS_BRIDGE_MIN_INTERVAL_MS", 300_000)`,
`bridge.maxWindow: envNum("HOOKS_BRIDGE_MAX_WINDOW", 8)`.

`mergeConfig` shallow-merges `hooks` and its nested `queue`/`bridge` blocks
(same pattern as `queryUnderstanding`/`memory.decay` at config:505-515).

## 3. Observation table + migrations (both backends)

### SQLite (canonical) — `SqliteObservationStore.createSchema()`
```sql
CREATE TABLE IF NOT EXISTS observations (
  id           TEXT PRIMARY KEY,
  project_id   TEXT NOT NULL,
  session_id   TEXT,
  source       TEXT NOT NULL,          -- the event kind
  payload_json TEXT NOT NULL,
  importance   REAL NOT NULL,
  created_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_obs_project_created ON observations(project_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_obs_session ON observations(session_id);
```
DB file: `path.join(config.get("dataDir"), "observations.db")`. On open:
`PRAGMA busy_timeout = 3000; PRAGMA journal_mode = WAL;` (mirrors
`session-store.ts:95-96`, `index-job-store.ts`). No ALTER needed (new table).

### PG parity — Prisma model (additive, `packages/core/prisma/schema.prisma`)
```prisma
model Observation {
  id          String   @id
  projectId   String   @map("project_id")
  sessionId   String?  @map("session_id")
  source      String
  payloadJson String   @map("payload_json")
  importance  Float
  createdAt   DateTime @default(now()) @map("created_at")

  @@index([projectId, createdAt(sort: Desc)])
  @@index([sessionId])
  @@map("observations")
}
```
**SQLite-canonical-only decision (justified):** observations are
agent-runtime state (high-write, short-lived, consolidated away), not analytics
queried cross-project on PG. The plan's cross-cutting §2 forbids reintroducing
`isPostgresEnabled()` short-circuits, so we provide the Prisma model for parity
and a `PgObservationStore` that uses raw `$queryRawUnsafe`/`$executeRaw` (same
style as `MemoryRepositoryPg`) — but the **default local-first path is SQLite**,
exactly mirroring how `SessionStore`/`JobStore` are SQLite-canonical with a
no-op/memory fallback rather than a PG impl. PG users get parity via Prisma
migrate; the factory still routes polymorphically (no short-circuit). This
matches the existing `synapse_sessions`/`index_jobs` precedent (SQLite-only,
documented).

### Polymorphic factory — `getObservationStore()`
Mirrors `getSessionStore()` (`session-store.ts:322`) + `getJobStore()`
(`index-job-store.ts:230`):
```ts
let cachedStore: ObservationStore | null = null;
export function getObservationStore(): ObservationStore {
  if (cachedStore) return cachedStore;
  try { cachedStore = new SqliteObservationStore(); }
  catch { cachedStore = new MemoryObservationStore(); } // no-op fallback
  return cachedStore;
}
export function resetObservationStore(): void { cachedStore = null; }
```
PG dispatch lives in a separate branch only when `DATABASE_URL` is PG **and** a
PgObservationStore is wired — but for Phase 3 we ship SQLite + Memory fallback
(the local-first default) and document the PG Prisma path. This is NOT an
`isPostgresEnabled()` short-circuit in a job; it is the same factory shape every
other store uses.

## 4. Single-writer queue + 429 backpressure

The queue serializes the *persist* step so the hook fire-hose cannot starve
readers (cross-cutting §4). Reuse the existing promise-chain mutex at
`packages/core/src/services/embeddings/provider.ts:323-337`:

```ts
class WriterQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;
  constructor(private readonly maxPending: number) {}

  get pendingCount(): number { return this.pending; }
  get saturated(): boolean { return this.pending >= this.maxPending; }

  /** Returns a release fn on admit; throws QueueSaturatedError if full. */
  enqueue(work: () => Promise<void>): Promise<void> {
    if (this.saturated) throw new QueueSaturatedError();
    this.pending++;
    const run = this.tail.then(() => work(), () => work());
    // chain but don't let one failure poison the queue
    this.tail = run.then(
      () => { this.pending--; },
      () => { this.pending--; },
    );
    return run;
  }
}
```

- The route checks `queue.saturated` **before** awaiting; if saturated → 429
  with `Retry-After: 1`. No admission, no write.
- WAL + `busy_timeout=3000` means even if two writers ever race (defensive),
  SQLite waits rather than returning SQLITE_BUSY immediately.
- The queue lives on the `HookService` singleton (process-wide, like the
  `ollamaMutex`).

**Why a custom queue vs. a generic pool?** The existing codebase already uses
this exact promise-chain pattern (`provider.ts:323`) and the per-project mutex
in `contextual-search-rlm.ts:65`; introducing a dependency or worker-thread pool
would violate the "no new dependency / reuse existing patterns" rule and the
spec NF1. The single-writer discipline is also explicitly what cross-cutting §4
asks for.

## 5. HookService (ingestion)

`packages/core/src/services/hooks/hook-service.ts`:

```ts
export type LifecycleEventKind =
  | "session-start" | "user-prompt"
  | "pre-tool-use" | "post-tool-use"
  | "pre-compact" | "session-end";

export interface IncomingEvent {
  event: string;            // validated → LifecycleEventKind
  projectId: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  importance?: number;
  agentId?: string;
  ts?: number;
}

export class HookService {
  private queue: WriterQueue;
  constructor(opts?: { store?: ObservationStore; maxPending?: number; bridge?: ObservationConsolidationJob }) {}
  validate(ev: IncomingEvent): { ok: true; event: NormalizedEvent } | { ok: false; code: 400|413; error: string };
  /** Admit + enqueue persist. Throws QueueSaturatedError → caller maps to 429. */
  ingestOne(ev: NormalizedEvent): Promise<string>;     // returns obs id
  ingestBatch(evs: NormalizedEvent[]): Promise<string[]>;
}
export const hookService = new HookService();
```

Validation order (fail fast, before queue admission):
1. `event` is a known kind (case-insensitive normalize to canonical).
2. `projectId` non-empty string.
3. `payload` is a non-empty object.
4. `JSON.stringify(payload).length <= maxPayloadBytes` → else 413.
5. `importance` clamp to [0,1] if present.

On admit: `queue.enqueue(async () => { store.insert(obs); eventBus.publish("observation:ingested", …); maybeTriggerBridge(); })`. The `eventBus.publish` + bridge trigger happen **inside** the writer so ordering is consistent and the 202 returns only after admission (not after the writer drains — the caller awaits the `enqueue` admission check, the write itself is fire-and-forget from the caller's perspective; we still return the *generated* id synchronously).

> Refinement: to truly return 202 "immediately" while honoring saturation, the
> route (a) validates, (b) generates the id, (c) checks `queue.saturated` → 429,
> (d) calls `queue.enqueue(...)` (which does not await the write) and returns
> `{ status: 202, id }`. The write completes on the writer turn. If the write
> itself later fails it is logged at warn (fire-and-forget); the id is already
> returned. This matches "fire-and-forget (return 202 immediately)" in the plan.

## 6. Routes (Elysia)

`apps/tools-api/src/routes/hooks.ts` — same style as `routes/memory.ts`
(Elysia `t.Object` body schemas, lazy tool-singleton ctor, `detail.tags`):

- `POST /api/v1/hook` → body is a single event; returns `{ status: 202, id }`
  or `{ status: 429, retryAfter: 1 }` or `{ status: 400|413, error }`.
- `POST /api/v1/hook/batch` → body is `{ events: IncomingEvent[] }`; validates
  all first (atomic), then admits; returns `{ status: 202, ids: string[] }`.

Wire into `apps/tools-api/src/index.ts`:
```ts
import { hookRoutes } from "./routes/hooks.js";
// in the chain after synapseRoutes:
.use(hookRoutes)
```
Add a swagger tag `{ name: "hooks", description: "Passive lifecycle capture" }`.

## 7. EventBus event

Add to `EventMap` (`services/events/event-bus.ts`):
```ts
/** Phase 3: emitted after an observation is persisted (hook ingestion). */
"observation:ingested": {
  observationId: string;
  projectId: string;
  sessionId?: string;
  source: string;        // the LifecycleEventKind
  importance: number;
};
```
Shape follows `memory:consolidated`/`search:query-rewritten`. Published inside
the writer turn (after `store.insert`).

## 8. Consolidation bridge

`packages/core/src/services/jobs/observation-consolidation-job.ts`. Design
decision: **separate job** (not extending `memory-consolidation-job.ts`) —
justification:
- `memory-consolidation-job.ts` operates on `memories` (decay/prune/merge);
  observations are a *different* source stream with a different schema and a
  different trigger. Mixing them would muddy `ConsolidationStats` and the
  debounce gate. A focused job is simpler and testable in isolation.
- It still reuses `consolidateWindow` + `LlmSurface` + `llm-client`'s default
  surface (same as the memory job).

Shape:
```ts
export class ObservationConsolidationJob {
  constructor(opts?: { llm?: LlmSurface; store?: ObservationStore; memoryRepo?: ...; graph?: ... }) {}
  private lastRunAt = 0;
  private newSinceRun = 0;
  /** Called from HookService after each persist. Debounce-gated. */
  maybeRun(projectId: string): void;
  async runOnce(projectId: string): Promise<{ consolidated: boolean; batchesCreated: number }>;
}
export const observationConsolidationJob = new ObservationConsolidationJob();
```
`maybeRun` logic:
```
if (!config.get("hooks").bridge.enabled) return;
this.newSinceRun++;
const now = Date.now();
const cfg = config.get("hooks").bridge;
if (this.newSinceRun < cfg.minObservations && now - this.lastRunAt < cfg.minIntervalMs) return;
this.newSinceRun = 0; this.lastRunAt = now;
void this.runOnce(projectId).catch(() => {});   // fire-and-forget, never throws
```
`runOnce`:
```
if (!isLlmEnabled()) return { consolidated: false, batchesCreated: 0 };  // silent skip
const rows = store.listRecent(projectId, cfg.maxWindow);
const candidates = rowsToCandidates-ish(rows);   // map Observation → ConsolidateCandidate
const batch = await consolidateWindow(candidates, this.llm, { maxWindow: cfg.maxWindow });
if (!batch) return { consolidated: false, batchesCreated: 0 };            // {ok:false}/timeout/empty → null
// store the summary as a memory (type 'conversation' or 'pattern'), SUPERSEDES each source observation-memory
...
eventBus.publish("memory:consolidated", { ... });
return { consolidated: true, batchesCreated: 1 };
```
All LLM-call failures are caught inside `consolidateWindow` (returns null), so
the bridge cannot throw. Observations are retained regardless (never deleted by
the bridge — a later GC phase can prune old observations; out of scope here).

> Note on SUPERSEDES target: observations are not memory rows, so the edge
> can't point at an observation id through the existing memory_edges schema
> cleanly. Design choice: the bridge **stores one memory per batch** (the
> summary) and does NOT create SUPERSEDES edges to observations (there is no
> memory to supersede). It may create a SUPERSEDES edge if the same project
> produces a newer summary batch that should hide an older one (sourceIds =
> prior summary memory ids). For Phase 3 the minimal correct behavior is:
> store summary memory + emit `memory:consolidated` with `sourceIds` = the
> observation ids that fed the batch (informational; no edge to non-memory
> rows). This keeps the read-side filters intact and avoids schema drift.

## 9. Hook scripts (apps/claude-plugin/hooks/)

Four POSIX shell scripts, one per Claude Code hook:
- `session-start.sh` ← Claude `SessionStart`
- `user-prompt-submit.sh` ← `UserPromptSubmit`
- `post-tool-use.sh` ← `PostToolUse`
- `stop.sh` ← `Stop`

Each reads `$MASSA_AI_API_BASE` (default `http://localhost:3333`) and optional
`$MASSA_AI_API_KEY`, builds a JSON body from stdin/env, and:
```sh
command -v curl >/dev/null 2>&1 || exit 0
curl -sS -m 2 -o /dev/null \
  -H "Content-Type: application/json" \
  ${MASSA_AI_API_KEY:+-H "x-api-key: $MASSA_AI_API_KEY"} \
  -X POST "$MASSA_AI_API_BASE/api/v1/hook" \
  --data "$BODY" 2>/dev/null || true
exit 0
```
`-m 2` (2s timeout) + `exit 0` guarantees the agent is never blocked even if
the server is down. Claude Code passes hook payload on stdin as JSON; the
script forwards it as `payload` with the `event` kind hardcoded.

A small `README.md` in the same dir documents wiring into `.claude/settings.json`
`hooks` block.

## 10. Optional MCP tool `hook_ingest`

Add to `apps/mcp-client/src/tool-definitions.ts` (pure-data `ToolDefinition`):
name `hook_ingest`, `POST /api/v1/hook/batch`, schema `{ events: [...] }`.
Useful for non-Claude hosts (Cursor, OpenCode). Low risk; wired like the
existing `memory_update`.

## 11. Degradation paths (summary)

| Condition | Behavior |
| --- | --- |
| `hooks.enabled=false` | routes still mount but reject 503? No — simpler: routes return 202 but persist is a no-op? **Decision:** when `hooks.enabled=false`, routes return `{ status: 423, error: "hooks disabled" }` (locked) and persist nothing. (423 > 503 for "feature intentionally off".) Tests assert this. |
| `llm.enabled=false` | bridge silent-skip; ingestion fully functional. |
| LLM throws/timeout | `consolidateWindow` returns null → bridge no-op. |
| SQLite DB cannot open | factory falls back to `MemoryObservationStore` (no-op; observations not persisted, logged at warn — same as `SessionStore` fallback). |
| Queue saturated | route returns 429 + Retry-After; caller retries. |
| `curl` missing / API down (hook script) | exit 0, no output, agent unaffected. |

## 12. Test strategy (no @massa-ai/shared mock)

Following the Phase-1/2 rule (`memory-crud.test.ts` is the only file mocking
shared config), Phase-3 tests:

- `observation-repository.test.ts` — uses explicit `dbPath` (temp file or
  `:memory:`) to construct `SqliteObservationStore` directly; NO config mock.
  Asserts insert/list/WAL pragma.
- `hook-service.test.ts` — constructs `HookService` with injected
  `MemoryObservationStore` (or temp SqliteObservationStore) + a fake bridge
  (`{ maybeRun: () => { calls++ } }`). NO config mock; pass `maxPending` via
  ctor. Asserts 202/429/400/413, ordering, event emission.
- `observation-consolidation-job.test.ts` — injects a fake `LlmSurface`
  (returns a valid batch OR `{ok:false}`) + a fake store listing canned rows +
  a fake memory repo capturing `store()` calls. Asserts: memory created when
  LLM on; no-op when off / `{ok:false}` / throw. NO config mock — read
  `hooks.bridge` via the real config (the block always exists in real config;
  defensive fallback in ctor for the process-wide mock like Phase-2 did).
- `hooks-routes.test.ts` (or fold into hook-service test) — spin the Elysia
  app or test the route handler fn directly with injected service.

Discrimination sensor: drop the `maxPending` check in `enqueue` (always admit)
→ P3-BACKPRESSURE-01 must fail (no 429). Revert.

## 13. Risks / accepted assumptions

1. **No OS-level scheduler.** The bridge is trigger-driven (debounce), matching
   the rest of the codebase (`memory-consolidation-job.ts` has no setInterval).
   If observations arrive in a burst then stop, the last partial window may not
   consolidate until the next trigger. Acceptable: observations are still
   stored; consolidation is best-effort summarization, not a correctness path.
2. **PG store not wired in code for Phase 3** (only Prisma model + doc). The
   factory returns SQLite/Memory; a PG deployment uses Prisma migrate to create
   the table and a future PgObservationStore. This matches the `synapse_sessions`
   precedent and avoids speculative code. Local-first is the documented default.
3. **Fire-and-forget write failures are logged, not retried.** If the SQLite
   write throws after admission, the 202 was already returned. WAL + the
   no-op fallback mitigate this; the contract is best-effort (observations are
   telemetry-grade, not transactional). Caller retries only on 429.
4. **`sessionId` forwarded but not validated** against the SessionRegistry —
   an unknown sessionId is stored as-is (forward-compatible; Phase 6 will
   consume it).
5. **Same-author verification** (sole agent). Mitigated by per-AC evidence
   table + discrimination sensor + objective gate.
