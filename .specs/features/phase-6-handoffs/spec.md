# Phase 6 — Cross-session Handoffs (G2): Specification

Slug: `phase-6-handoffs`. Workflow: `spec-driven` (TLC v3). Owner tags:
`project:massa-th0th`, `session:spec-virtual-lantern-plan`,
`workflow:spec-driven`, `entity:phase-6-handoffs`.

## Context

`massa-th0th` is a SQLite-canonical hybrid code-context + agent-memory
MCP server. Phase 3 landed passive lifecycle capture (hook ingestion →
Observation store + `observation:ingested` event). Phase 4 landed repo
bootstrap (LLM/rule-based seed memories + `bootstrap:completed` event).
The plan (`i-want-to-understand-virtual-lantern.md` § "Phase 6 —
Cross-session handoffs [G2]") calls for a handoff primitive that lets an
agent (session A) leave a structured "pass this forward" record that a
later agent (session B) discovers on its next session start, accepts,
and thereby clears. SQLite-canonical; LLM local-first default-off with
silent degradation; backend-polymorphic dispatch (no
`isPostgresEnabled()` short-circuit).

## Requirements

### R1 — Handoff storage + state machine
Create a **Handoff table** (SQLite-canonical; additive Prisma model for
PG parity) mirroring the Phase-3 `observations` posture (separate `.db`
file is acceptable; a new table on a handoffs DB is the cleanest
isolation). Cols:

```
id, source_session_id, target_agent, summary,
open_questions_json, next_steps_json, files_json,
status ('open' | 'accepted' | 'expired'),
created_at, accepted_at
```

Status state machine: `open` → `accepted` (via `accept`) or
`open` → `expired` (via `cancel`). Both are terminal; `accept`/`cancel`
on a non-`open` row is a clear failure (`{ok:false, reason}`), not a
silent no-op. `accepted_at` set only on `accept`.

### R2 — Service: begin / accept / cancel
`HandoffService` (factory-resolved, ctor-seam for tests):

- `begin({ projectId, sourceSessionId, targetAgent, summary, openQuestions?, nextSteps?, files? })`
  → creates an `open` handoff row, dual-writes a searchable
  `conversation` memory copy (R5), returns `{ id, status:"open",
  memoryId }`.
- `accept({ id, projectId? })` → flips status `open`→`accepted`, sets
  `accepted_at`, emits `handoff:accepted` (R6). Returns the handoff
  payload. Missing id / non-open status / mismatched projectId →
  `{ok:false, reason}`.
- `cancel({ id, projectId? })` → flips status `open`→`expired`. Returns
  the handoff payload. Same failure semantics as `accept`.

All three never throw to the caller (silent-degrade: errors become
`{ok:false, reason}` results). The store is injectable (test-isolation
landmine from Phase 3/4: the real `MemoryRepository` singleton is closed
by `memory-crud.test.ts` in the full suite → inject a fake).

### R3 — Auto-inject pending handoff on session start
When a new session starts, surface a pending `open` handoff for the
target agent/session. Design call: **consume the Phase-3
`observation:ingested` event** (source `session-start`) as the trigger
seam. A `HandoffAutoInjector` subscribes to `observation:ingested`; on a
`session-start` observation it queries `listPending(projectId,
targetAgent)` and (if any) records that a handoff is pending. The
primary surfacing path is `HandoffService.listPending(projectId,
targetAgent?)` — a recall-path check the agent / MCP caller may invoke
directly. Justification: the `observation:ingested` seam already exists,
is typed, and is fired by the Phase-3 SessionStart hook; a recall-path
check (`listPending`) is the deterministic surfacing primitive that does
not depend on the hook being installed (degrades gracefully when it
isn't). Never blocks; never throws.

### R4 — MCP tools + API route
- `handoff_begin` (POST `/api/v1/handoff/begin`)
- `handoff_accept` (POST `/api/v1/handoff/accept`)
- `handoff_cancel` (POST `/api/v1/handoff/cancel`)
- `handoff_list_pending` (POST `/api/v1/handoff/list` — supports
  the auto-inject / recall surfacing path)

Wire into `apps/mcp-client/src/tool-definitions.ts` + an Elysia route
`apps/tools-api/src/routes/handoff.ts` mirroring `routes/bootstrap.ts`
/`routes/checkpoints.ts`. Wire route into `apps/tools-api/src/index.ts`.

### R5 — Dual-write to memory (searchability)
On `begin`, also persist a searchable `conversation`-type memory via
`getMemoryRepository().insert(...)` tagged `["handoff",
"handoff:<id>", "handoff:<projectId>"]`, level `PROJECT=1` (so it
passes the FTS `level <= USER` recall filter, per the Phase-4
correction), importance 0.7, no embedding (FTS-only, consistent with
bootstrap seeds). This makes the handoff discoverable by the existing
`fullTextSearch` / `search` recall path independently of the
Handoff table.

### R6 — EventBus `handoff:accepted`
Add `handoff:accepted` to `EventMap` (`services/events/event-bus.ts`):
```
{ handoffId: string; projectId?: string; sourceSessionId?: string;
  targetAgent?: string; acceptedAt: number }
```
Published once on a successful `accept` (status transition
`open`→`accepted`), never on missing/already-accepted/expired.

### R7 — Optional LLM polish (default-off, silent-degrade)
Optionally summarize the handoff `summary` via the Phase-1 `llm-client`
when `llm.enabled` and a `summary` is empty/auto-generated. Default-off;
`{ok:false}`/throw → fall through to the user-provided summary verbatim.
Never blocks begin. (Handoff content is mostly user-provided; LLM is
optional polish — the begin path stores what the caller passed.)

## Acceptance Criteria

| AC ID | Outcome |
| --- | --- |
| P6-BEGIN-01 | `handoff_begin` with valid fields creates a row with `status="open"`, returns `{id, status:"open", memoryId}`, and the summary is present. |
| P6-DUALWRITE-01 | A begin call also inserts a `conversation` memory with `tags` including `handoff:<id>` and `level=PROJECT(1)`, importance 0.7, no embedding. |
| P6-SEARCH-01 | The dual-write memory is found by `MemoryRepository.fullTextSearch(<distinctive summary token>, ...)` (FTS5). |
| P6-ACCEPT-01 | `handoff_accept` on an `open` handoff flips status to `accepted`, sets `accepted_at` (epoch ms), emits `handoff:accepted` with the correct shape. |
| P6-CANCEL-01 | `handoff_cancel` on an `open` handoff flips status to `expired`; no `handoff:accepted` event. |
| P6-FAIL-01 | `accept` on a missing id → `{ok:false, reason:"not-found"}`; no status change, no event. |
| P6-FAIL-02 | `accept` on an already-`accepted` or `expired` handoff → `{ok:false, reason:"not-open"}`; no event, `accepted_at` unchanged. |
| P6-FAIL-03 | `accept`/`cancel` with a mismatched `projectId` (when provided) → `{ok:false, reason:"project-mismatch"}`. |
| P6-AUTOINJECT-01 | `HandoffService.listPending(projectId, targetAgent)` returns only `open` handoffs for that target (excludes accepted/expired); on `session-start` `observation:ingested`, the injector records a pending handoff was found (or none). |
| P6-EVENT-01 | `handoff:accepted` is in `EventMap` with the specified payload shape. |
| P6-TOOL-01 | All 4 MCP tools present in `TOOL_DEFINITIONS`; route registered in `apps/tools-api/src/index.ts`. |
| P6-DEGRADE-01 | A begin with `summary:""` and LLM-off stores the row with an empty/auto summary (no throw); LLM `{ok:false}` likewise. |
| P6-MIGRATION-01 | SQLite `CREATE TABLE IF NOT EXISTS handoffs` (idempotent) + Prisma `Handoff` model for PG parity; additive only. |

## Edge cases

- Empty `summary` with LLM off → store empty/auto summary (R7 polish is
  best-effort; never blocks).
- `accept`/`cancel` on a missing id → clear failure (P6-FAIL-01).
- `accept`/`cancel` on a terminal-status row → clear failure (P6-FAIL-02).
- `projectId` mismatch → clear failure (P6-FAIL-03).
- Store insert throws → `{ok:false, reason:"store-failed"}`, no event.
- Auto-inject when no pending handoffs → no-op (records "none").
- Multiple `open` handoffs for the same target → `listPending` returns
  all, ordered by `created_at ASC`.

## Out of scope

- Handoff expiry by age (TTL → `expired`) — only explicit `cancel`.
- Cross-project handoffs (projectId is a required scoping key).
- Handoff delivery acknowledgement beyond `accepted` (no "read" state).
- PG HandoffStore runtime code (Prisma model provides parity; a future
  PgHandoffStore mirrors the synapse_sessions/index_jobs/observations
  precedent — SQLite-canonical runtime state).
- Web UI (Phase 8).
- Auto-apply handoff `next_steps` (Phase 5 auto-improve territory).

## Non-functional

- **NF1** — Backend-polymorphic: store interface + factory; never
  `isPostgresEnabled()` short-circuit (cross-cutting §2).
- **NF2** — Migrations additive-only, both backends (cross-cutting §5).
- **NF3** — LLM local-first default-off + silent degradation
  (cross-cutting §1).
- **NF4** — Test-isolation: inject a fake store + fake `MemoryRepoSeam`
  + fake `LlmSurface`; do NOT `mock.module("@massa-th0th/shared")` (the
  process-wide landmine). The single P6-SEARCH-01 integration block may
  reset the `MemoryRepository` singleton to a temp dataDir (mirrors
  Phase-4 P4-SEARCH-01).
- **NF5** — EventBus is the integration bus (cross-cutting §3); no new
  plugin system.

## Verification (derive tests from ACs, not the implementation)

- `handoff-service.test.ts`: begin/accept/cancel happy paths + every
  P6-FAIL-* + dual-write capture + auto-injector + event subscription +
  LLM-off degradation + the single P6-SEARCH-01 FTS integration block.
- Discrimination sensor: mutate the status-guard in `accept` so it
  accepts terminal-status rows → P6-FAIL-02 must fail.
- Gate: `bun run --filter @massa-th0th/core test` no regressions vs 754;
  `bun run type-check` clean.
