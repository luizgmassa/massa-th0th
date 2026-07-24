# Phase 3 — Passive Memory Capture (Hook Ingestion): Specification

Slug: `phase-3-hook-capture`. Workflow: `spec-driven` (TLC v3). Plan ref:
`i-want-to-understand-virtual-lantern.md` §"Phase 3 — Passive memory capture
[G1]" + cross-cutting decisions §1 (shared LLM), §2 (SQLite first-class),
§3 (EventBus), §4 (WAL + single-writer + 429), §5 (additive migrations).

## Problem

Memory in massa-ai is **manual** today: an agent must call `remember`
explicitly. The killer feature borrowed from `ai-memory` is *passive capture* —
lifecycle events (session start, user prompts, tool calls, compaction, session
end) arrive as fire-and-forget hooks and are turned into structured memories
later by the consolidation bridge. This phase delivers that ingestion pipeline
end-to-end (SQLite-canonical, local-first, LLM-default-off with silent
degradation), plus the write-discipline that protects readers from the hook
fire-hose (cross-cutting §4).

## Scope

IN:
- Lifecycle event ingestion service for six event kinds: `session-start`,
  `user-prompt`, `pre-tool-use`, `post-tool-use`, `pre-compact`, `session-end`.
- `Observation` durable table (SQLite-canonical; additive Prisma model for PG
  parity, documented) + polymorphic repository mirroring the Phase-1 factory
  pattern.
- Tools API routes `POST /api/v1/hook` (single) + `POST /api/v1/hook/batch`
  (Elysia, same style as `routes/memory.ts`).
- Single-writer serialization queue with WAL + **HTTP 429 on saturation**.
- `observation:ingested` EventBus event (added to `EventMap`).
- Consolidation bridge: turns raw observations → structured memories via the
  Phase-1 `llm-client` + `consolidator`; **silently skips** when the LLM is off
  (observations still stored).
- Claude Code hook scripts (`SessionStart`, `UserPromptSubmit`, `PostToolUse`,
  `Stop`) that `curl` the endpoint, under `apps/claude-plugin/hooks/`.
- Optional MCP tool `hook_ingest` for non-Claude hosts.
- New `hooks` config block (default-on for ingestion; LLM-driven consolidation
  inherits the existing `llm.enabled` gate).

OUT OF SCOPE (deferred):
- Real-time streaming of observations (SSE). The EventBus event is emitted for
  internal listeners only; an SSE tap is a later-phase concern.
- Cross-session handoff auto-injection on `session-start` (Phase 6 consumes the
  SessionStart hook).
- Auto-improvement proposals from observations (Phase 5).
- Web UI observation browser (Phase 8).
- A periodic OS-level scheduler/cron for the consolidation bridge. Consistent
  with the rest of the codebase (which has no job runner — see
  `memory-consolidation-job.ts:101` debounce-on-trigger), the bridge is
  **trigger-driven with a debounce** (runs after N ingested observations or a
  min interval, kicked from the ingest path). A true scheduler is out of scope.

## Requirements

### R1 — Lifecycle event ingestion (single + batch)
The system MUST accept lifecycle events at `POST /api/v1/hook` (single event)
and `POST /api/v1/hook/batch` (array of events). Each event carries:

| Field | Type | Required | Notes |
| --- | --- | --- | --- |
| `event` | enum | yes | one of the six lifecycle kinds |
| `projectId` | string | yes | non-empty |
| `sessionId` | string | no | forwarded to observation + EventBus |
| `payload` | object | yes | event-specific; non-empty object |
| `importance` | number | no | 0–1; default 0.5 |
| `agentId` | string | no | forwarded |
| `ts` | number | no | epoch ms; defaults to server now |

Unknown top-level fields MUST be ignored (forward-compatible). The `event`
enum is the closed set of six kinds; an unknown event kind is a validation
error (4xx).

### R2 — Fire-and-forget (202) and backpressure (429)
- A single-event POST that is accepted MUST return HTTP **202 Accepted** with
  the new observation id(s); the write is enqueued, not awaited inline beyond
  the queue admission check.
- The batch endpoint MUST return 202 with an array of ids for accepted events.
- When the single-writer queue is **saturated** (`pending > queue.maxPending`),
  the endpoint MUST return HTTP **429 Too Many Requests** with a `Retry-After`
  hint, and MUST NOT enqueue the event (caller retries). This is the
  cross-cutting §4 protection: a hook fire-hose cannot starve readers.

### R3 — Validation / size cap / malformed rejection
- Payloads larger than `hooks.maxPayloadBytes` (default **64 KiB**) MUST be
  rejected with HTTP **413 Payload Too Large**.
- Malformed JSON, missing required fields, unknown `event` kind, or a non-object
  `payload` MUST be rejected with HTTP **400 Bad Request**.
- Rejection MUST happen **before** any write / queue admission (fail fast).

### R4 — Observation persistence (SQLite-canonical)
Each accepted event MUST be persisted as an Observation row:

| Column | SQLite type | Notes |
| --- | --- | --- |
| `id` | TEXT PK | `obs_<ts>_<rand>` |
| `project_id` | TEXT NOT NULL | |
| `session_id` | TEXT | nullable |
| `source` | TEXT NOT NULL | the event kind |
| `payload_json` | TEXT NOT NULL | stringified, size-capped |
| `importance` | REAL NOT NULL | 0–1 |
| `created_at` | INTEGER NOT NULL | epoch ms |

Backend: SQLite-canonical. PG parity is provided via a Prisma `Observation`
model (so a PG deployment can also store observations), but the **default and
primary path is SQLite** (see design.md for the SQLite-canonical-only
justification vs. analytics-not-needed-on-PG decision). The factory dispatches
the same way as `getMemoryRepository()` — never an `isPostgresEnabled()`
short-circuit.

### R5 — Single-writer queue + WAL
- Observation writes MUST be serialized through a single-writer promise-chain
  queue (mirrors `provider.ts:323-337` mutex). WAL mode MUST be enabled on the
  observation DB (mirrors `session-store.ts:96`, `index-job-store.ts`,
  `checkpoint-manager.ts:93`). `busy_timeout` MUST be set.
- The queue exposes a **saturation signal** (`pending` count vs `maxPending`)
  so the route can return 429 without awaiting.

### R6 — EventBus event
On each persisted observation, the service MUST publish `observation:ingested`
on the EventBus with `{ observationId, projectId, sessionId?, source, importance }`.
The event MUST be added to `EventMap` (Phase-1/2 precedent: `memory:consolidated`,
`search:query-rewritten`).

### R7 — Consolidation bridge (LLM-driven, silent-skip when off)
- A bridge MUST summarize windows of raw observations (per `projectId`, by
  recency) into structured memories using the Phase-1 `llm-client` +
  `consolidator.consolidateWindow`. It reuses `MemoryRepository.store` for the
  output memory and `GraphStore` for any SUPERSEDES edge.
- The bridge MUST run on a debounce trigger from the ingest path (every
  `bridge.minObservations` observations OR `bridge.minIntervalMs`, whichever
  first) — fire-and-forget, never blocks the 202.
- **Silent degradation:** when `isLlmEnabled()` is false, OR the LLM call
  returns `{ok:false}`, OR it throws/timeouts, the bridge MUST **skip
  consolidation silently** — no throw, observations remain stored. This is the
  same contract as Phase-2 query understanding (`{ok:false}` = fall-through).
- The bridge MUST NOT regress the read side: produced memories are normal
  memory rows subject to the existing `deleted_at IS NULL` + SUPERSEDES filters.

### R8 — Claude Code hook scripts (integration)
The repo MUST ship generated hook scripts under `apps/claude-plugin/hooks/`
for the four Claude Code lifecycle hooks that map to our events:
`SessionStart`→`session-start`, `UserPromptSubmit`→`user-prompt`,
`PostToolUse`→`post-tool-use`, `Stop`→`session-end`. Each script `curl`s the
local endpoint with a JSON body. Scripts read the API base URL + optional API
key from env (`MASSA_AI_API_BASE`, `MASSA_AI_API_KEY`) and degrade silently (exit 0,
no output on stdout) if `curl` is unavailable or the endpoint is down — never
block the agent.

### NF1 — Local-first / default-off posture
- Ingestion (R1–R6) is **default-on** (capturing raw observations has no LLM
  dependency and no external call).
- Consolidation (R7) is **default-off** because it inherits `llm.enabled`
  (default false, env `RLM_LLM_ENABLED=true`). Turning the LLM off MUST leave
  ingestion fully functional.
- No new external dependency. Reuses installed `ai` + `@ai-sdk/openai` via the
  existing `llm-client`.

### NF2 — No regressions / additive
- `bun run test` MUST stay green vs the Phase-2 baseline (**700 pass / 0 fail /
  46 skip**). New tests are additive.
- `bun run type-check` MUST be clean (5/5).
- Migrations additive-only, both backends.

## Acceptance Criteria

| AC ID | Statement |
| --- | --- |
| P3-INGEST-01 | `POST /api/v1/hook` with a valid lifecycle event persists exactly one Observation row and returns 202 + the observation id. |
| P3-INGEST-02 | `POST /api/v1/hook/batch` with N valid events persists N rows and returns 202 + N ids. |
| P3-BACKPRESSURE-01 | When the single-writer queue is saturated (pending > maxPending), `POST /api/v1/hook` returns **429** and does NOT persist a row (verified by row count unchanged). |
| P3-BACKPRESSURE-02 | After the queue drains, a subsequent valid POST returns 202 again (queue recovers). |
| P3-VALIDATE-01 | Oversized payload (> maxPayloadBytes) returns **413** and persists nothing. |
| P3-VALIDATE-02 | Malformed event (missing required field, unknown event kind, non-object payload) returns **400** and persists nothing. |
| P3-QUEUE-01 | Observations are persisted in submission order (single-writer serializes writes) even under concurrent POSTs. |
| P3-WAL-01 | The observation DB has `journal_mode = WAL` set (verified by reading `PRAGMA journal_mode`). |
| P3-EVENT-01 | `observation:ingested` is in `EventMap` and is published on each persist with the correct payload shape. |
| P3-CONSOLIDATE-01 | With the LLM on (fake surface returns a valid batch), the bridge turns observations into a structured memory + SUPERSEDES edge to source observations, and emits `memory:consolidated`. |
| P3-CONSOLIDATE-02 | With the LLM off (`isLlmEnabled()` false), the bridge is a no-op (no throw, observations still stored, no memory row created). |
| P3-CONSOLIDATE-03 | With the LLM on but the call returning `{ok:false}`, the bridge is a no-op (no throw, no memory row). |
| P3-HOOKSCRIPT-01 | Four Claude Code hook scripts exist under `apps/claude-plugin/hooks/` mapping the four lifecycle hooks; each is executable and degrades silently when `curl`/endpoint is unavailable (exit 0). |
| P3-DEGRADE-01 | Full ingestion path works with `llm.enabled=false` (proves ingestion has no LLM dependency). |

## Edge cases

| Edge case | Expected |
| --- | --- |
| Empty `payload` object `{}` | reject 400 (non-empty required) |
| `payload` is a primitive/array, not object | reject 400 |
| `event` lowercase variant accepted? | yes — normalize case-insensitively to the canonical kind |
| `importance` out of [0,1] | clamp to [0,1] (not reject — observations are best-effort) |
| `projectId` empty/whitespace | reject 400 |
| Batch with a mix of valid + invalid events | reject the **whole batch** 400 (atomic validation before any persist) — simpler + safer than partial |
| Batch with one oversized event | reject whole batch 413 |
| Concurrent POSTs while queue saturated | all get 429 until drain |
| Server restart mid-queue | observations already persisted survive (SQLite WAL); in-flight in-memory queue items are lost (acceptable — fire-and-forget, caller retries on 429) |
| LLM timeout during bridge | swallowed; observations retained; logged at warn |

## Out of scope (explicit)

See "OUT OF SCOPE" in Scope above.

## Dependencies

- Phase 1: `llm-client` (`llmComplete`/`llmObject`/`isLlmEnabled`/`llm`),
  `consolidator` (`consolidateWindow`, `ConsolidatedBatch`, `LlmSurface`),
  `MemoryRepository` (store + read filters), `GraphStore` (createEdge +
  SUPERSEDES), durable-store factory pattern (`SessionStore`, `JobStore`),
  EventBus.
- Phase 0c: `MemoryRepository.store` shape (the bridge reuses it).

## Verification summary (gate)

- `bun run test` — no regressions vs 700/0/46; new tests additive.
- `bun run type-check` — 5/5 clean.
- 429-saturation test (P3-BACKPRESSURE-01) passes.
- LLM-off consolidation-skip test (P3-CONSOLIDATE-02) passes.
- Discrimination sensor kills its mutant.
