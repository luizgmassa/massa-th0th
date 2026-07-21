# Wave 5 — Design

Reference: `references/spec-driven/design.md`. Approved spec: `spec.md`.

## Architecture overview

Wave 5 is **additive**: no existing public contract is broken. New tools, new aspects,
new formats, new columns (NULL-safe), new opt-in flag. The only behavioral tightening
is `read_file` path containment and search filter revalidation — both emit teaching
errors per Wave 4 N6 parity rather than silently failing.

### Component map

```
┌──────────────────────────────────────────────────────────────────────┐
│ apps/mcp-client/src/                                                  │
│   tool-definitions.ts  +get_architecture, +synapse_task_begin/end,    │
│                         +format:"tree", +aspects, +?flavor transport │
│   index.ts             +_meta?flavor / query param strip in ListTools │
│   moonshot-flavor.ts   NEW — pure schema-strip helper                 │
└──────────────────────────────────────────────────────────────────────┘
                │  HTTP  │
┌──────────────────────────────────────────────────────────────────────┐
│ apps/tools-api/src/routes/                                            │
│   events.ts            +?jobId= filter                                │
│   synapse.ts           +POST /task/begin, +POST /task/:id/end         │
│   architecture.ts      NEW — GET /api/v1/project/:id/architecture     │
└──────────────────────────────────────────────────────────────────────┘
                │
┌──────────────────────────────────────────────────────────────────────┐
│ packages/core/src/                                                    │
│   tools/                                                               │
│     serialize.ts         +format:"tree", +groupRowsByPrefix()         │
│     get_architecture.ts  NEW — tool wrapper                            │
│     impact_analysis.ts   +impacted_modules, +BFS CTE behind flag       │
│     read_file.ts         +path containment (sanitize import)           │
│     search_project.ts    +filter revalidation                          │
│   services/symbol/                                                    │
│     architecture.ts      +detectCycles (iterative Tarjan), +aspects    │
│   services/search/                                                    │
│     capture-policy.ts    NEW — bounded pure module                     │
│     ignore-patterns.ts   thin wrapper over capture-policy              │
│     filter-validation.ts NEW — glob syntax + cap revalidation          │
│   services/etl/                                                       │
│     pipeline.ts          +managed_runs lease acquire/heartbeat/release │
│                            +event_id dedup, +FileCursor resume         │
│     stages/discover.ts   +read FileCursor on start                     │
│   services/scheduler/                                                 │
│     scheduler.ts         +success/failure split, +catch-up on boot     │
│     scheduler-store-pg.ts  +last_success_at/consecutive_failures      │
│   services/jobs/                                                      │
│     index-job-tracker.ts  +publish to eventBus                         │
│   services/synapse/                                                   │
│     task-envelope.ts     NEW — orchestrates begin/end multi-step       │
│   data/                                                               │
│     managed-runs/                                                     │
│       managed-run-contract.ts      NEW — interface + lease types       │
│       managed-run-repository-pg.ts NEW — CAS repository                │
│   controllers/                                                        │
│     search-controller.ts  +filter revalidation, +filter_downgrades     │
│     architecture-controller.ts  NEW — orchestrates service + serialize │
└──────────────────────────────────────────────────────────────────────┘
                │
┌──────────────────────────────────────────────────────────────────────┐
│ packages/core/prisma/                                                 │
│   schema.prisma          +ManagedRun, +ScheduledJob columns            │
│   migrations/                                                         │
│     20260722120000_add_managed_runs             NEW                    │
│     20260722130000_add_scheduler_last_success   NEW                    │
│     20260722140000_add_capture_policy_state     NEW (optional persist) │
│     20260722150000_add_architecture_aspect_log  NEW (audit only)       │
└──────────────────────────────────────────────────────────────────────┘
```

### Data flow — `get_architecture` with cycles (FR-01, FR-02)

```
MCP CallTool get_architecture
  → HTTP GET /api/v1/project/:id/architecture?aspects=cycles
  → architecture-controller
  → symbol-graph.service.computeArchitectureMap({aspects})
  → symbol-repository-pg.getProjectMapSnapshot  ← now also SELECTs callEdges
                                                 (symbol_references WHERE ref_kind='call')
  → architecture.ts.computeArchitectureMap
      for each aspect in aspects:
        if aspect==='cycles': detectCycles(snapshot.callEdges)
            → iterative Tarjan SCC (heap stack, 400k edge budget)
            → filter SCCs with >1 node
            → return {cycles, cycles_truncated}
  → serialize(response, {format, fields})
      → if format==='tree': groupRowsByPrefix(...)
```

### Data flow — `impact_analysis` with BFS CTE (FR-05)

```
MASSA_TH0TH_IMPACT_BFS_CTE=true
  → ImpactAnalysisService.analyze
      if cfg.bfsCte:
        changedFiles = diffRunner.run()
        result = repo.runBfsCteImpact(projectId, changedFiles, depth, deadlineMs)
            ← single recursive CTE over symbol_imports
              WITH RECURSIVE bfs AS (
                SELECT file_id, 0 AS hop FROM unnest(:changed) AS seed(file_id)
                WHERE file_id NOT IN (SELECT id FROM unnest(:changed) AS seed(file_id))
                UNION ALL
                SELECT si.from_file_id, b.hop+1
                FROM bfs b JOIN symbol_imports si ON si.to_file_id = b.file_id
                WHERE b.hop < :depth AND si.from_file_id NOT IN (SELECT ...)
              )
              SELECT file_id, MIN(hop) AS hop FROM bfs GROUP BY file_id
              ORDER BY hop, file_id LIMIT :max
        ← returns impacted[] (post-FQN resolution)
      else: existing TS reverse-import BFS
  → parity test asserts both paths produce identical sets on frozen fixture
```

### Data flow — `managed_runs` lease (FR-08, FR-09)

```
th0th_index(projectId)
  → ManagedRunRepository.begin(projectId, run_kind='indexing')
      INSERT INTO managed_runs (..., lease_token, lease_expires_at=now()+90s, status='active')
      ON CONFLICT DO NOTHING
      RETURNING *;
      if 0 rows: SELECT active → return {status:'busy', activeRunId}
  → EtlPipeline.run()
      spawn heartbeat loop: UPDATE managed_runs SET heartbeat_at=now()
                            WHERE lease_token=$token AND lease_expires_at>now()
                            if 0 rows: throw LeaseLost → abort ETL
      stages: discover (read file_cursor), parse, resolve, load
              each event INSERT IGNORE INTO event_log... UNIQUE(project_id,event_id)
              update file_cursor on each batch
  → on complete: ManagedRunRepository.complete(token)
      UPDATE managed_runs SET status='completed', completed_at=now()
                            WHERE lease_token=$token
```

### Data flow — Synapse task envelope (FR-14, FR-15)

```
synapse_task_begin({agentId, taskContext, query, projectId, entries?})
  → TaskEnvelopeService.begin()
      session = POST /synapse/session {agentId, taskContext}         ← existing route
      if entries:
        POST /synapse/session/:id/prime {entries}                    ← existing route
      search = POST /search/project {query, projectId, sessionId}    ← existing route
      if search.results[0]:
        POST /synapse/session/:id/prefetch {filePath: results[0].filePath}
        POST /synapse/session/:id/access {memoryId: results[0].id}
      return {sessionId, search, primed: entries?.length ?? 0}

synapse_task_end({sessionId})
  → TaskEnvelopeService.end()
      accessCount = SELECT count(*) FROM synapse_access_history WHERE session_id=$id
      topFiles = SELECT file_path, count(*) FROM synapse_access_history GROUP BY file_path ORDER BY count DESC LIMIT 5
      DELETE /synapse/session/:id                                     ← existing route
      return {sessionId, durationMs, accessCount, topFiles}
```

### Data flow — SSE jobId filter (FR-16)

```
GET /api/v1/events?jobId=<id>
  Accept: text/event-stream
  → events.ts handler
      parse ?jobId= alongside ?projectId=
      eventBus.subscribe({
        filter: (e) => (!jobIdFilter || e.jobId === jobIdFilter)
                    && (!projectIdFilter || e.projectId === projectIdFilter)
      })
      stream existing eventBus events
  ↑ needs IndexJobTracker to publish:
      tracker.on('stateChange', (job) => eventBus.publish({
        type: `indexing:${job.status}`, jobId: job.id, projectId, payload: job
      }))
```

## Architecture decisions

| ID | Decision | Rationale |
|---|---|---|
| AD-W5-001 | Tarjan SCC implementation is **iterative** (explicit heap-allocated stack), not recursive | Avoids JS stack overflow on deep CALL graphs; matches cbm pattern; Wave 3 RSS guard < 16 MiB |
| AD-W5-002 | `callEdges` added to `ArchitectureInput` (not a separate snapshot) | Existing snapshotter already reads `symbol_references`; adding a `ref_kind='call'` filter is the minimal change; preserves Wave 3 graph-generation fingerprint invariants |
| AD-W5-003 | BFS CTE is **additive behind `MASSA_TH0TH_IMPACT_BFS_CTE=true`** | TS path has passing tests today; flag allows production parity observation before flip; characterization test is the gate |
| AD-W5-004 | `managed_runs` is a new table, not a reuse of `graph_generations` | Graph lease is bound to an immutable snapshot row; indexing lease is a process-writer concept — different lifecycle. Reuse would couple unrelated invariants |
| AD-W5-005 | Capture policy is a **pure module** with config-driven policy; no DB persistence in v1 | Allows unit testing without DB; existing `DEFAULT_IGNORES` migrate to default policy JSON; `denyUnknownFields` enforces at config load |
| AD-W5-006 | `read_file` path containment uses **allowlist**: project root + cwd + `MASSA_TH0TH_READ_FILE_ROOTS` env | Strictest defensible default; teaching error exposes valid roots only (no path enumeration of host) |
| AD-W5-007 | Scheduler `last_success_at` columns are **additive nullable** | Existing rows survive; NULL = "never run successfully"; behavior change is "update on success only" — failure updates `last_failure_at` + `consecutive_failures` instead |
| AD-W5-008 | `synapse_task_begin` is **5 moves in one MCP call**, not a new REST endpoint | MCP call → envelope service calls 5 existing REST endpoints server-side; cuts 4 network round-trips for the client; failures leave the session created |
| AD-W5-009 | SSE extends `/api/v1/events?jobId=` rather than a new endpoint | Existing infra (heartbeat, auto-close, filter pattern) is proven; jobId already in payloads; one stream endpoint to maintain |
| AD-W5-010 | Moonshot `?flavor=` wrapper is **transport-only**; no schema rewrite | Today's schema has no combinators; wrapper verified by a test that injects an `anyOf` and asserts the strip; if a strict validator appears later, schema rewrite is a separate task |
| AD-W5-011 | `format:"tree"` and `format:"json"` (when grouped) share **one helper** `groupRowsByPrefix` | Plan N5 explicitly forbids parallel impls; mutation test asserts both formats change together |
| AD-W5-012 | Filter revalidation emits `filter_downgrades[]` on contradiction, never silent drop | Per Wave 4 N6 teaching-error parity; downgrade is observable so caller can correct |
| AD-W5-013 | `managed_runs.begin()` runs an inline reaper first (UPDATE expired `active` rows to `aborted`) | Addresses plan-critic F1: orphan accumulation under SIGKILL/power loss; reaper runs on every begin so cleanup is implicit, not scheduled |
| AD-W5-014 | `getActive(projectId, runKind)` filter is pinned in the contract: `status='active' AND lease_expires_at > clock_timestamp() ORDER BY lease_expires_at DESC LIMIT 1` | Addresses plan-critic F1: a stale-but-active row must not be returned as "the active run" |
| AD-W5-015 | `loadProjectIgnore` keeps the `Ignore` library merge with `.gitignore` *before* delegating to `applyPolicy`; `applyPolicy` consumes the merged rule list | Addresses plan-critic F2: capture-policy migration must preserve gitignore semantics, not bypass them |
| AD-W5-016 | Vector load + `event_id` insert occur in the same DB transaction; the marker claim is uncommitted until vectors land | Addresses plan-critic F3: kill-mid-load must leave the file re-processable, not silently skipped |
| AD-W5-017 | `detectCycles` ships with a property test against brute-force SCC reference + 5 specific cycle shapes | Addresses plan-critic F4: iterative Tarjan lowlink-update bug is silent; only a property test discriminates |
| AD-W5-018 | BFS CTE seed guarded by `WHERE file_id IS NOT NULL`; parity scoped to "same FQN set, depths may differ ≤1 hop on cyclic graphs" | Addresses plan-critic F5: NULL footgun + algorithmic divergence on cycles |
| AD-W5-019 | `synapse_task_begin` response includes `partial: boolean` and `errors: string[]`; sub-step failures are surfaced, not hidden | Addresses plan-critic cross-cutting concern: honest envelope contract |
| AD-W5-020 | B1 exports explicit TS interfaces for `groupRowsByPrefix`, `ManagedRunRepository`, `applyPolicy`; B2/B3 import verbatim | Addresses plan-critic cross-cutting concern: subagent batch handoff drift |

## Migration plan

All migrations additive, NULL-safe, backward-compatible. Applied in order:

### M-W5-01 — `20260722120000_add_managed_runs`

```sql
CREATE TABLE managed_runs (
  id BIGSERIAL PRIMARY KEY,
  project_id TEXT NOT NULL,
  run_kind TEXT NOT NULL CHECK (run_kind IN ('indexing', 'reindex', 'maintenance')),
  event_id TEXT NOT NULL,
  content_hash TEXT,
  file_cursor JSONB,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'aborted')),
  lease_token TEXT,
  lease_expires_at TIMESTAMPTZ,
  heartbeat_at TIMESTAMPTZ,
  created_at BIGINT NOT NULL,
  completed_at BIGINT,
  CHECK ((lease_token IS NULL) = (lease_expires_at IS NULL))
);

CREATE UNIQUE INDEX managed_runs_event_unique
  ON managed_runs (project_id, event_id);
CREATE UNIQUE INDEX managed_runs_one_active_per_project_kind
  ON managed_runs (project_id, run_kind)
  WHERE status = 'active' AND lease_expires_at > clock_timestamp();
CREATE INDEX managed_runs_lease_expiry
  ON managed_runs (lease_expires_at) WHERE lease_expires_at IS NOT NULL;
CREATE INDEX managed_runs_status_active
  ON managed_runs (project_id, run_kind, status) WHERE status = 'active';
```

Prisma model: `ManagedRun`. Repository: `managed-run-repository-pg.ts` (mirrors graph-generation-repository-pg.ts patterns).

**Reaper contract (AD-W5-013):** Every `begin()` call first issues
`UPDATE managed_runs SET status='aborted' WHERE project_id=? AND run_kind=? AND status='active' AND lease_expires_at <= clock_timestamp()`
before the `INSERT...ON CONFLICT DO NOTHING`. Best-effort, no row lock held across the
transaction. Tested by AC-22 (orphan row cleanup + concurrent-begin race).

**`getActive` filter (AD-W5-014):** Pinned in `ManagedRunRepository` contract:
`SELECT * FROM managed_runs WHERE project_id=$1 AND run_kind=$2 AND status='active' AND lease_expires_at > clock_timestamp() ORDER BY lease_expires_at DESC LIMIT 1`.

### M-W5-02 — `20260722130000_add_scheduler_last_success`

```sql
ALTER TABLE scheduled_jobs
  ADD COLUMN last_success_at BIGINT,
  ADD COLUMN last_failure_at BIGINT,
  ADD COLUMN consecutive_failures INT NOT NULL DEFAULT 0,
  ADD COLUMN last_error TEXT;
```

Prisma model: `ScheduledJob` gains fields (all optional except `consecutiveFailures` which defaults to 0).

### M-W5-03 — `20260722140000_add_capture_policy_state` (only if policy persistence needed)

Decision: **skip in v1**. Capture policy is config-driven (AD-W5-005); no DB state. Migration not created unless a future task needs audit log.

### M-W5-04 — `20260722150000_add_architecture_aspect_log` (audit only)

Decision: **skip in v1**. No audit log; cycles aspect is computed on demand. Migration not created unless observability requirement emerges.

**Net migrations for Wave 5: 2.** Both additive, NULL-safe, no data backfill needed.

## Public contract changes

### MCP tools (additive only)

| Change | Tool | Risk |
|---|---|---|
| +`get_architecture` | NEW | none — new tool |
| +`synapse_task_begin` | NEW | none — new tool |
| +`synapse_task_end` | NEW | none — new tool |
| +`format:"tree"` enum value | search, trace_path, impact_analysis, get_references, get_architecture | additive — existing clients send `json`/`toon` unchanged |
| +`aspects` param | get_architecture | new on new tool |
| +`scope:"all"` enum value | impact_analysis | fixes drift with core tool; no breaking change |
| +`impacted_modules`, `cycles`, `cycles_truncated` fields | impact_analysis, get_architecture responses | additive |
| +`filter_downgrades` field | search response | additive |

### REST endpoints (additive only)

| Change | Route | Risk |
|---|---|---|
| +`?jobId=` query | `GET /api/v1/events` | additive — existing `?projectId=` unchanged |
| +`?flavor=moonshot` query | MCP `tools/list` (transport) | additive — opt-in |
| +`GET /api/v1/project/:id/architecture` | NEW | none — new endpoint |

### Config schema (additive only)

| Change | File | Risk |
|---|---|---|
| +`capturePolicy` block | `packages/shared/src/config/massa-th0th-config.ts` | optional; absent → default policy |
| +`MASSA_TH0TH_IMPACT_BFS_CTE` env | `packages/shared/src/config/index.ts` | default false |
| +`MASSA_TH0TH_READ_FILE_ROOTS` env | `packages/shared/src/config/index.ts` | default empty |
| +`MAX_FILTER_PATTERNS` env (or config) | `packages/shared/src/config/index.ts` | default 32 |

### Behavioral changes (teaching-error tightenings)

| Change | Where | Backward-compat |
|---|---|---|
| `read_file` path containment | `packages/core/src/tools/read_file.ts` | Outside-roots paths that worked before now error; documented in HANDOFF.md |
| Search filter cap + glob validation | `search-controller.ts` | Patterns > 32 or invalid globs now error; documented |
| Search filter downgrade | `search-controller.ts` | Additive — emits `filter_downgrades[]` when contradictory patterns are reconciled |

## Reusable patterns

| Pattern | Location | Reused by |
|---|---|---|
| CAS lease (token + expiry + ON CONFLICT DO NOTHING) | `managed-run-repository-pg.ts` | Mirrors `graph-generation-repository-pg.ts:158-235` |
| Iterative Tarjan SCC | `packages/core/src/services/symbol/cycle-detection.ts` | Standalone; future graph tools |
| `groupRowsByPrefix` helper | `packages/core/src/tools/serialize.ts` | All grouped-format emitters |
| Capture policy pure module | `packages/core/src/services/search/capture-policy.ts` | `ignore-patterns.ts` wrapper + future path-filtering tools |
| Teaching-error parity | All new error paths | Follows Wave 4 N6 pattern |

## Dependencies

**No new external dependencies.** All implementations use existing:
- `minimatch` (already used by `filterByPatterns`)
- `crypto` (Node builtin, for SHA-256 event_id)
- Elysia (existing REST framework)
- Prisma + pg (existing)

## Test strategy

### Per-requirement focused tests

| FR | Test file | Layer |
|---|---|---|
| FR-01, FR-02 | `packages/core/src/__tests__/architecture.test.ts` (extend) + `get-architecture.test.ts` (new) | unit |
| FR-02 | `cycle-detection.test.ts` (new) | unit (incl. RSS guard on 500k-edge stress) |
| FR-03 | `impact-analysis.test.ts` (extend) | unit |
| FR-04 | `tool-definitions.test.ts` (extend) | unit |
| FR-05 | `impact-bfs-cte.test.ts` (new) + `impact-bfs-parity.test.ts` (new) | integration (PG) |
| FR-06 | `serialize.test.ts` (extend) | unit |
| FR-07 | per-tool tests (extend) | unit |
| FR-08 | `managed-run-repository.test.ts` (new) | integration (PG) |
| FR-09 | `etl-pipeline-lease.test.ts` (new) | integration (PG) |
| FR-10 | `etl-idempotent-import.test.ts` (new) | integration (PG) |
| FR-11 | `capture-policy.test.ts` (new) | unit |
| FR-12 | `read-file-containment.test.ts` (new) | unit |
| FR-13 | `scheduler-catchup.test.ts` (new) | integration (PG) |
| FR-14, FR-15 | `synapse-task-envelope.test.ts` (new) | integration |
| FR-16 | `events-job-filter.test.ts` (new) | integration |
| FR-17 | `moonshot-flavor.test.ts` (new) | unit |
| FR-18 | `filter-validation.test.ts` (new) | unit |
| FR-19 | static grep on HANDOFF.md | static |

### Characterization tests (behavior pins before refactor)

| Pin | Captures |
|---|---|
| `impact-bfs-parity.test.ts` | Frozen TS reverse-import BFS output on a fixture; gates FR-05 CTE |
| `ignore-patterns.characterization.test.ts` | Current `DEFAULT_IGNORES` outcomes on 50 sample paths; gates FR-11 migration |
| `serialize.grouped.characterization.test.ts` | Current json/toon output on sample rows; gates FR-06/FR-07 |

### Regression gates

- Full Wave 4 suite unchanged and green.
- Native tree-sitter verifier (`verify:tree-sitter-native`) PASS on macOS arm64.
- All existing E2E tests pass (excluding pre-existing shared-DB fixture failures).

## Risk-driven design choices

1. **Tarjan iterative, never recursive.** Stack depth is unbounded; JS engines reject deep recursion. Explicit heap stack + 400k edge budget + cycles_truncated flag. Property test against brute-force SCC reference (AD-W5-017) discriminates silent lowlink bugs.
2. **`managed_runs` lease CAS mirrors proven graph-generation pattern + inline reaper.** Same `ON CONFLICT DO NOTHING` + `WHERE lease_expires_at > clock_timestamp()` pattern that Wave 3 TASK-011 already validated. Reaper runs on every `begin()` (AD-W5-013) to prevent orphan accumulation under SIGKILL.
3. **BFS CTE behind a flag with parity oracle.** No flag flip in this cycle; characterization test catches drift. Parity scoped to "same FQN set, depths ≤1 hop drift on cyclic graphs" (AD-W5-018) — honest about algorithmic divergence.
4. **Capture policy is pure + `Ignore` merge preserved.** No DB writes in v1; config-load-time validation enforces bounds; characterization test pins existing outcomes. `.gitignore` merge runs *before* `applyPolicy` (AD-W5-015) — gitignore semantics survive.
5. **`synapse_task_begin` partial-failure policy: session always returned + honest `partial`/`errors` fields.** If prime, search, prefetch, or access fails mid-envelope, session exists; caller can retry or end. `partial` and `errors` fields surface which sub-steps failed (AD-W5-019).
6. **Subagent batch interface contracts.** B1 exports explicit TS interfaces; B2/B3 import verbatim. Interface drift fails a test in the dependent batch (AD-W5-020).

## Open design questions (none blocking)

None. All gray areas resolved in Specify; all architecture decisions made above.

## Handoff

Design approved → proceed to Tasks (full breakdown).
