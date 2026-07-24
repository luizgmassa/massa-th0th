# Phase 6 — Cross-session Handoffs (G2): Design

Slug: `phase-6-handoffs`. Companion to `spec.md`. This design realizes
R1–R7 + NF1–NF5. It reuses the proven Phase-3/4 patterns (Observation
store shape, ctor-seam test isolation, EventBus event, Elysia route,
MCP tool wiring) and the Phase-1 `llm-client` for optional polish.

## 1. Handoff table schema + migrations (both backends)

### SQLite (`packages/core/src/data/handoff/handoff-repository.ts`)

A **new `handoffs.db`** file (isolated from `memories.db` and
`observations.db`, mirroring the per-concern DB discipline). WAL +
`busy_timeout=3000` (cross-cutting §4). Lazy-open so constructing the
store is side-effect-free.

```sql
CREATE TABLE IF NOT EXISTS handoffs (
  id                   TEXT PRIMARY KEY,
  project_id           TEXT NOT NULL,
  source_session_id    TEXT,
  target_agent         TEXT,
  summary              TEXT NOT NULL DEFAULT '',
  open_questions_json  TEXT NOT NULL DEFAULT '[]',
  next_steps_json      TEXT NOT NULL DEFAULT '[]',
  files_json           TEXT NOT NULL DEFAULT '[]',
  status               TEXT NOT NULL DEFAULT 'open',  -- open|accepted|expired
  created_at           INTEGER NOT NULL,
  accepted_at          INTEGER
);
CREATE INDEX IF NOT EXISTS idx_handoffs_project_status ON handoffs(project_id, status);
CREATE INDEX IF NOT EXISTS idx_handoffs_target_agent ON handoffs(target_agent, status);
CREATE INDEX IF NOT EXISTS idx_handoffs_created ON handoffs(created_at DESC);
```

Why `project_id NOT NULL`: every handoff is scoped to a project
(out-of-scope: cross-project). `target_agent` nullable so a handoff may
be broadcast ("any next agent"). All three `*_json` cols default to
`'[]'` (validated arrays on input). `status` is TEXT with the three
literals (validated by the service). `accepted_at` is NULL until
`accept`.

### PostgreSQL (Prisma `packages/core/prisma/schema.prisma`)

Additive `Handoff` model mirroring the Observation precedent (PG runtime
store code deferred — SQLite-canonical runtime state):

```prisma
model Handoff {
  id                String   @id
  projectId         String   @map("project_id")
  sourceSessionId   String?  @map("source_session_id")
  targetAgent       String?  @map("target_agent")
  summary           String   @default("")
  openQuestionsJson String   @map("open_questions_json") @default("[]")
  nextStepsJson     String   @map("next_steps_json") @default("[]")
  filesJson         String   @map("files_json") @default("[]")
  status            String   @default("open") // open|accepted|expired
  createdAt         DateTime @default(now()) @map("created_at")
  acceptedAt        DateTime? @map("accepted_at")

  @@index([projectId, status])
  @@index([targetAgent, status])
  @@map("handoffs")
}
```

## 2. Status state machine

```
        begin            accept
  ─────────────► [open] ─────────► [accepted]   (terminal)
                     │
                     │ cancel
                     └─────► [expired]          (terminal)
```

- `accept`/`cancel` only valid on `open`. Any other source status →
  `{ok:false, reason:"not-open"}` (P6-FAIL-02).
- Missing id → `{ok:false, reason:"not-found"}` (P6-FAIL-01).
- `projectId` mismatch (when caller provides one and the row's differs)
  → `{ok:false, reason:"project-mismatch"}` (P6-FAIL-03).
- `accept` sets `accepted_at = now` (epoch ms SQLite / ISO Prisma) and
  publishes `handoff:accepted` exactly once.

## 3. Store interface + factory (backend-polymorphic)

```ts
export interface HandoffStore {
  insert(h: HandoffRecord): void;
  getById(id: string): HandoffRecord | null;
  listPending(projectId: string, targetAgent?: string): HandoffRecord[];
  setStatus(id: string, status: "accepted" | "expired", acceptedAt?: number): HandoffRecord | null;
  journalMode(): string;
}
```

- `MemoryHandoffStore` (no-op/in-memory fallback for tests + when SQLite
  unavailable).
- `SqliteHandoffStore` (lazy-open `handoffs.db`, WAL + busy_timeout,
  `CREATE TABLE IF NOT EXISTS`).
- `getHandoffStore()` / `resetHandoffStore()` factory mirroring
  `getObservationStore()` / `getSessionStore()` / `getJobStore()`. On
  SQLite open failure, fall back to `MemoryHandoffStore`.

The factory never short-circuits on `isPostgresEnabled()` (NF1).

## 4. `HandoffService` (begin / accept / cancel / listPending)

```ts
export class HandoffService {
  constructor(deps: HandoffDeps = {}) { /* lazy defaults */ }
  async begin(input: BeginHandoffInput): Promise<BeginResult>;
  async accept(input: { id: string; projectId?: string }): Promise<AcceptResult>;
  async cancel(input: { id: string; projectId?: string }): Promise<CancelResult>;
  listPending(projectId: string, targetAgent?: string): HandoffRecord[];
}
```

`HandoffDeps`:
- `store?: HandoffStore` (lazy default `getHandoffStore()`).
- `memoryRepo?: HandoffMemorySeam` (lazy default
  `getMemoryRepository().insert(...)`) — the dual-write target.
- `llm?: LlmSurface` (lazy default the Phase-1 `llm` handle) — R7 polish.
- `idFactory?: () => string` (default `handoff_<ts>_<rand>`).

### begin flow (R1, R2, R5, R7)
1. Validate required `projectId` (non-empty) — else `{ok:false,
   reason:"missing-project"}`. (Route-level 400 also enforces.)
2. Optional R7 LLM polish: if `llm.isEnabled()` AND `summary===""`,
   call `llm.object(prompt, HandoffSummarySchema)`; on `{ok:true}` use
   the summarized summary; on `{ok:false}`/throw/off → use the
   caller-provided summary (possibly empty). Never blocks.
3. Insert the `open` handoff row.
4. Dual-write a `conversation` memory (R5):
   `content = "Handoff: " + summary`, `type=CONVERSATION`,
   `level=PROJECT(1)`, `importance=0.7`, `tags=["handoff",
   "handoff:<id>", "handoff:<projectId>"]`, `embedding=[]`,
   `metadata={source:"handoff", handoffId:id, targetAgent,
   source:"handoff"}`. Capture `memoryId`.
5. Return `{ ok:true, id, status:"open", memoryId }`.

On any store/memory throw → `{ok:false, reason:"store-failed"}`, no
event, no partial state visible to caller (the store insert is the
authoritative row; the dual-write is best-effort but the memoryId is
returned when it succeeds, `null` when it fails).

### accept flow (R1, R2, R6)
1. `row = store.getById(id)`. Missing → `{ok:false, reason:"not-found"}`.
2. `row.projectId !== projectId` (when provided) → `{ok:false,
   reason:"project-mismatch"}`.
3. `row.status !== "open"` → `{ok:false, reason:"not-open"}`.
4. `acceptedAt = Date.now()`. `store.setStatus(id, "accepted",
   acceptedAt)`.
5. `eventBus.publish("handoff:accepted", { handoffId:id, projectId,
   sourceSessionId, targetAgent, acceptedAt })`.
6. Return `{ ok:true, handoff: <updated row> }`.

On store throw → `{ok:false, reason:"store-failed"}` (no event).

### cancel flow (R1, R2)
Same as accept but `status="expired"`, no `acceptedAt`, no event.

### listPending flow (R3 surfacing)
`store.listPending(projectId, targetAgent?)` → all `open` rows ordered
`created_at ASC`. Pure read; never throws (returns `[]` on error).

## 5. Auto-inject seam (R3)

`HandoffAutoInjector`:
```ts
export class HandoffAutoInjector {
  constructor(svc: HandoffService) {}
  start(): () => void;   // returns unsubscribe
}
```

Subscribes to `observation:ingested`. On a payload with
`source === "session-start"`, calls
`svc.listPending(payload.projectId, <targetAgent derived from payload>)`
and records (via `logger.info`) how many pending handoffs were found.
The deterministic surfacing primitive is `listPending` itself — the
agent / MCP caller invokes `handoff_list_pending` (or the service
directly) to fetch them. The injector is observability + a future
auto-surface hook; it never blocks the session-start path and never
throws. When the Phase-3 hook is not installed, `observation:ingested`
simply never fires for `session-start` and `listPending` still works as
the recall-path check — graceful degradation.

Justification for the seam choice (vs a check baked into `recall`): the
`observation:ingested` event is already typed, already fired by the
Phase-3 SessionStart hook, and already consumed by the
`ObservationConsolidationJob`. Reusing it keeps a single integration bus
(cross-cutting §3) and avoids coupling the memory recall path to the
handoff table (separation of concerns: recall searches `memories`;
handoffs live in their own table + a dual-write memory for FTS).

## 6. Dual-write to memory (R5)

Memory row built by `storeSeeds`-style helper (mirrors Phase-4
`storeSeeds` but with `type=CONVERSATION`, `level=PROJECT`, importance
0.7, `embedding:[]`). Tag scheme:
- `"handoff"` — generic.
- `"handoff:<id>"` — link back to the Handoff row.
- `"handoff:<projectId>"` — project-scoped (mirrors
  `"bootstrap:<projectId>"`).

Level `PROJECT=1` so it passes the `fullTextSearch` filter
`level <= USER(2)` (the Phase-4 correction). No embedding → FTS-only
search target (consistent with bootstrap seeds; vector search is not
the primary path for handoff discovery).

## 7. EventBus `handoff:accepted` (R6)

`EventMap["handoff:accepted"]`:
```ts
{ handoffId: string; projectId?: string; sourceSessionId?: string;
  targetAgent?: string; acceptedAt: number }
```

Published inside `accept` after a successful `setStatus` transition.
Never on missing/non-open/throw. Mirrors the
`observation:ingested`/`bootstrap:completed` shape contract.

## 8. Optional LLM polish (R7)

`HandoffSummarySchema` (zod):
```ts
z.object({ summary: z.string().min(1).max(512) })
```

Only invoked when `llm.isEnabled()` AND the caller passed
`summary===""` (the "auto-summarize from open_questions/next_steps"
case). On `{ok:false}`/throw → use the empty summary (or a trivial
concatenation of next_steps). The begin path is dominated by
user-provided content; LLM is purely a fill-in for the empty case.
Default-off + silent-degrade (NF3).

## 9. MCP tools + route (R4)

### `apps/mcp-client/src/tool-definitions.ts`
Four entries (mirror the `bootstrap` shape):
- `handoff_begin` → POST `/api/v1/handoff/begin`.
- `handoff_accept` → POST `/api/v1/handoff/accept`.
- `handoff_cancel` → POST `/api/v1/handoff/cancel`.
- `handoff_list_pending` → POST `/api/v1/handoff/list`.

### `apps/tools-api/src/routes/handoff.ts`
Elysia prefix `/api/v1/handoff`. Four POST handlers mirroring
`routes/bootstrap.ts`:
- 423 when `handoffs.enabled === false`.
- 400 on missing required `projectId` (begin) / `id` (accept/cancel).
- 200 + `{ success:true, data: <result> }`.

Wired into `apps/tools-api/src/index.ts` via `.use(handoffRoutes)`
after `.use(bootstrapRoutes)`. Swagger tag `handoffs`.

## 10. Config (new)

`handoffs: { enabled (envBool HANDOFFS_ENABLED=true) }`. Additive
top-level block in `ServerConfig`. `mergeConfig` shallow-merges
`handoffs`. Default-on (the begin/accept/cancel primitive has no LLM
dep; R7 polish inherits `llm.enabled`).

## 11. Test isolation (NF4)

`handoff-service.test.ts`:
- Inject a fake `HandoffStore` (in-memory array) — no `handoffs.db`
  touch except optionally via `SqliteHandoffStore` direct unit test.
- Inject a fake `HandoffMemorySeam` (captures inserts).
- Inject a fake `LlmSurface` (enabled/disabled/failing).
- The single P6-SEARCH-01 block resets the `MemoryRepository` singleton
  to a temp dataDir (mirrors Phase-4 P4-SEARCH-01) and restores it in
  `afterEach`.
- No `mock.module("@massa-ai/shared")`.

A separate `handoff-repository.test.ts` exercises `SqliteHandoffStore`
with an explicit temp `dbPath` (mirrors
`observation-repository.test.ts`).

## 12. Degradation summary

| Failure | Behavior |
| --- | --- |
| `handoffs.enabled=false` | 423 (route); service returns `{ok:false, reason:"disabled"}`. |
| LLM off / `{ok:false}` / throw | begin uses caller summary verbatim (R7). |
| store insert throws | `{ok:false, reason:"store-failed"}`, no event. |
| memory insert throws (dual-write) | begin still returns `ok:true` with `memoryId:null` (best-effort). |
| accept on missing/non-open/mismatch | `{ok:false, reason}`, no event. |
| Phase-3 hook not installed | `observation:ingested` never fires; `listPending` still works. |

## 13. Files touched

**Created:**
- `packages/core/src/data/handoff/handoff-repository.ts`
- `packages/core/src/services/handoff/handoff-service.ts`
- `packages/core/src/services/handoff/handoff-auto-injector.ts`
- `packages/core/src/__tests__/handoff-service.test.ts`
- `packages/core/src/__tests__/handoff-repository.test.ts`
- `apps/tools-api/src/routes/handoff.ts`

**Modified:**
- `packages/core/src/services/events/event-bus.ts` (add `handoff:accepted`)
- `packages/core/src/index.ts` (barrel re-exports)
- `packages/core/prisma/schema.prisma` (add `Handoff` model)
- `packages/shared/src/config/index.ts` (add `handoffs` block)
- `apps/mcp-client/src/tool-definitions.ts` (4 tool entries)
- `apps/tools-api/src/index.ts` (`.use(handoffRoutes)`)
