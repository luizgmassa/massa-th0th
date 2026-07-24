# Session State: Checkpoints vs Compaction Snapshots

massa-ai has two state-preservation mechanisms that both "save state" but
serve **orthogonal purposes**. This document reconciles the split so users and
contributors know which to use, how they compose, and why they do not collide.

---

## TL;DR

| Aspect | **Checkpoint** | **Compaction Snapshot** |
|---|---|---|
| What it versions | **INDEX / TASK state** | **SESSION continuity** |
| One-line purpose | Roll back a task's progress + index context | Survive `/compact` with zero loss |
| Data shape | gzip-compressed `TaskState` JSON blob | Bounded XML table-of-contents with runnable retrieval calls |
| Persisted content | Full task state (progress, decisions, files, agent state) | Event references + retrieval calls (NOT the raw events) |
| Keyed by | `taskId` (+ optional `projectId`) | `sessionId` (+ `projectId`) |
| Storage | `task_checkpoints` table in **`PostgreSQL memories table`** (PostgreSQL-only) | `observations` table in **`PostgreSQL observations table`** (PostgreSQL) + PG parity via Prisma |
| Service | `CheckpointManager` (`services/checkpoint/`) | `CompactionSnapshotService` (`services/hooks/`) |
| Tools | `create_checkpoint`, `restore_checkpoint`, `list_checkpoints` | `compact_snapshot` |
| TTL | 7 days (manual) / 14 days (milestone) / 3 days (auto) | Inherits observation TTL (no separate expiry) |
| Typical trigger | Milestone reached, before risky step, error, every N ops | Pre-compact hook, explicit `compact_snapshot` call |

**They do not collide**: different DB files, different tables, different keys,
different services. A single session can produce many checkpoints AND many
snapshots independently.

---

## 1. Checkpoint — versioned INDEX/TASK state

### What it is
A checkpoint is a **full serialized snapshot of a task's execution state** at a
point in time: progress percentage, current step, decisions made, files
modified, pending validations, next action, and referenced memory IDs. The state
is gzip-compressed and stored as an opaque blob.

### When to use it
- **Roll back a task** to a known-good state after a wrong turn.
- **Resume a long-running task** across sessions (restore picks up progress,
  decisions, and next action).
- **Recover from a bad reindex / index corruption** by restoring the task
  context that surrounded the indexing operation.
- **Compare index versions** by diffing the `fileChanges` + `decisions` between
  two checkpoints of the same task.
- **Milestone marking** before a risky, irreversible, or experimental step.

### Data model
Table: `task_checkpoints` (in `PostgreSQL memories table`, PostgreSQL-only — no Prisma/PG model)

```
id, task_id, task_description, agent_id, project_id,
state (BLOB, gzip JSON), state_schema_version,
memory_ids (JSON array), file_changes (JSON array),
checkpoint_type (manual|milestone|auto), parent_checkpoint_id,
created_at, expires_at
```

The `state` blob deserializes to `TaskState`:
- `progress` — total/completed steps, current step, percentage
- `context` — decisions, filesRead, filesModified, errors, learnings
- `agentState` — lastAction, nextAction, pendingValidations

### Restore semantics
`restore_checkpoint` returns the full state **plus integrity checks**:
- Which referenced memories still exist (`validMemoryIds` vs `missingMemoryIds`)
- Which files changed on disk since the checkpoint (`fileConflicts`)
- Generated human-readable `restoreInstructions`

Restore is **non-destructive**: it returns the saved state + integrity report;
the caller decides whether to apply it.

### TTL / cleanup
- Manual: 7 days. Milestone: 14 days. Auto: 3 days.
- `purgeExpired()` reaps past-TTL checkpoints.
- `expires_at` is nullable (a checkpoint can be permanent).

---

## 2. Compaction Snapshot — SESSION continuity

### What it is
A compaction snapshot is a **bounded (<~2KB) table-of-contents** of a session's
lifecycle events. It does NOT inline the raw events — instead each section
provides a brief summary + a **runnable `recall`/`search` call** that re-fetches
the full raw events from the observation store on demand. This achieves zero
truncation and zero information loss across `/compact`.

### When to use it
- **Survive `/compact`** — the resuming agent gets a TOC it can follow to
  reconstruct what happened, instead of a truncated inline summary.
- **Resume a session** in a new chat by following the retrieval references.
- **Hand off context** to another agent/session (the snapshot is portable XML).
- **Audit session activity** by category (files-read, git-changes, decisions,
  errors, etc.) without re-reading every event.

### Data model
The snapshot itself is an XML string. When persisted (`persist: true`), it is
stored as an **observation** of category `compaction-snapshots` in the
`observations` table:

```
id, project_id, session_id, source ("pre-compact"),
category ("compaction-snapshots"),
payload_json ({ snapshot: <xml>, eventCount, compactCount, ... }),
importance (0.8), created_at
```

The XML structure:
```xml
<session_resume events="N" compact_count="K" session_id="..." project_id="...">
  <how_to_search>This is a TABLE OF CONTENTS. Each section has a runnable
    recall/search call to re-fetch full event detail...</how_to_search>
  <files-read count="12">
    12 event(s)
      - src/foo.ts
      - src/bar.ts
    For full details:
    recall(query: "files-read", projectId: "...", limit: 10)
  </files-read>
  <decisions count="3"> ... </decisions>
  ...
</session_resume>
```

### Retrieval model
Raw events stay in the `observations` table (capped by `maxEvents=200` per
build). The snapshot only points to them. The resuming agent executes the
provided `recall`/`search` calls to fetch full detail on demand — so a 2KB
snapshot can represent a session with hundreds of events.

### Bounded size guarantee
Hard ceiling: 2048 bytes. If exceeded, the least-active sections are trimmed
from the TOC (the raw events are NOT dropped — they remain in the store and are
still retrievable). Structural bounds, not a byte budget that silently discards
data.

### Storage / PG parity
- PostgreSQL-backed observations via `PgObservationStore`.
- PG parity: the Prisma `Observation` model (`packages/core/prisma/schema.prisma`)
  maps to the same `observations` table shape, so a Postgres deployment can
  store snapshots identically.

---

## 3. How they compose

A session and a task are **independent dimensions**:

```
Session A ──┬── snapshot #1 (pre-compact)
            ├── snapshot #2 (pre-compact)
            └── snapshot #3 (explicit compact_snapshot call)

Task T1 ────┬── checkpoint #1 (manual, 0%)
            ├── checkpoint #2 (auto, 40%)
            └── checkpoint #3 (milestone, 100%)

Task T2 ────┬── checkpoint #1 (manual)
            └── checkpoint #2 (error)
```

- A **session** produces snapshots (what happened in the conversation).
- A **task** produces checkpoints (where the task's execution state is).
- One session can work on multiple tasks; one task can span multiple sessions.
- Snapshots and checkpoints reference each other only loosely (a snapshot's
  `tasks` section may mention a task that has checkpoints, but there is no
  hard foreign key — they live in separate stores).

**Composed workflow example**: Before a risky refactor, an agent (a) calls
`create_checkpoint` to save task progress, then (b) continues working. If the
context grows too large and `/compact` fires, the `compact_snapshot` captures
session continuity. After compact, the resuming agent can both
`restore_checkpoint` (to get task state back) AND follow the snapshot's
retrieval calls (to recover session context) — the two are complementary.

---

## 4. Storage isolation (no collision)

| Store | DB file | Table | Backend | Keyed by |
|---|---|---|---|---|
| Checkpoints | `PostgreSQL memories table` | `task_checkpoints` | PostgreSQL-only | `task_id` |
| Snapshots (persisted) | `PostgreSQL observations table` | `observations` | PostgreSQL + PG (Prisma) | `session_id` |

- **Different DB files**: `PostgreSQL memories table` ≠ `PostgreSQL observations table`. No shared table.
- **Different primary keys**: `task_id` vs `session_id`. No key overlap.
- **Different services**: `CheckpointManager` (singleton, raw PostgreSQL) vs
  `CompactionSnapshotService` (factory over `ObservationStore`). No shared
  mutable state, no import cycle.
- **Different backends**: checkpoints have no Prisma model and no PG path;
  observations have PG parity. A PG deployment stores snapshots but not
  checkpoints.

There is no naming, storage, or service-level collision between the two.

---

## 5. Decision: no unified `session_state` view

The plan (C3) suggested *considering* a unified `session_state` view that
surfaces both. After analysis, **we deliberately did not add one**, because:

1. **No shared key**: checkpoints are keyed by `taskId`, snapshots by
   `sessionId`. A unified view would need to join across two stores with no
   natural join key — it would be an artificial aggregator.
2. **Different backends**: checkpoint is PostgreSQL-only; snapshot is PostgreSQL+PG.
   A unified accessor would either (a) be PostgreSQL-only (losing PG parity) or
   (b) require a PG checkpoint model that does not exist (scope creep).
3. **Marginal clarity, real coupling**: the two are used at different times
   (checkpoints = explicit task milestones; snapshots = compact/resume).
   Forcing them behind one call adds a join that callers rarely need and
   couples two services that are intentionally independent.
4. **Documentation suffices**: the distinction is now visible at the API
   surface (tool descriptions + this doc). A unified view would not add
   clarity beyond what the descriptions already provide.

If a future use case genuinely needs both in one call (e.g. a "session resume"
orchestrator that restores task state AND session context), a thin
read-only aggregator can be added at that point — but it should be built
on demand, not speculatively.

---

## 6. Tool descriptions (API-surface distinction)

Each tool's `description` field carries a one-line "what it preserves" note so
the split is visible without reading this doc:

- `create_checkpoint` — "Save current task progress (versioned TASK state:
  progress, decisions, files) for resumption or rollback."
- `restore_checkpoint` — "Restore a saved task checkpoint (TASK state + memory
 /file integrity checks). Distinct from compact_snapshot (session continuity)."
- `list_checkpoints` — "List saved task checkpoints (TASK state versions)."
- `compact_snapshot` — "Build a session-continuity snapshot (bounded TOC of
  SESSION events with runnable retrieval calls). Distinct from checkpoints
  (task state). Zero information loss across /compact."

---

## 7. File map

| Concern | Path |
|---|---|
| Checkpoint service | `packages/core/src/services/checkpoint/checkpoint-manager.ts` |
| Auto-checkpointer | `packages/core/src/services/checkpoint/auto-checkpointer.ts` |
| Checkpoint barrel | `packages/core/src/services/checkpoint/index.ts` |
| Snapshot service | `packages/core/src/services/hooks/compaction-snapshot-service.ts` |
| Observation store (snapshot persistence) | `packages/core/src/data/memory/observation-repository.ts` |
| create_checkpoint tool | `packages/core/src/tools/create_checkpoint.ts` |
| restore_checkpoint tool | `packages/core/src/tools/restore_checkpoint.ts` |
| list_checkpoints tool | `packages/core/src/tools/list_checkpoints.ts` |
| compact_snapshot tool | `packages/core/src/tools/compact_snapshot.ts` |
| Prisma Observation model (PG parity) | `packages/core/prisma/schema.prisma` |
| This document | `packages/core/src/services/SESSION-STATE.md` |
