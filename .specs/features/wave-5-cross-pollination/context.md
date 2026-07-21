# Wave 5 — Cross-pollination Context

Source: 3 parallel `explore` subagent investigations on `main`, 2026-07-21.
Source plan: `~/Downloads/massa-th0th-improvement-plan-v3.md`. Wave 4 complete.

## Investigation findings (compact)

### Theme A — cbm graph features

| Target | Path:LOC | Current state | Gap |
|---|---|---|---|
| architecture.ts | `packages/core/src/services/symbol/architecture.ts:586` | aspects: packages/entryPoints/routes/hotspots/communities/layers; `ArchitectureOptions` only has `withCommunities`; no `aspects` param; pure consumer of snapshot | cycles aspect absent; `ArchitectureInput` has no `callEdges` slot; `call`-kind `symbol_references` rows never read for architecture (only `http_call`) |
| impact-analysis.ts | `packages/core/src/services/symbol/impact-analysis.ts:631` | TS reverse-import BFS via `buildReverseImportGraph` (inverts `repo.allImportEdges`); `MAX_IMPACTED=100`; emits `impacted_total/shown/omitted/truncated` | NO `impacted_modules` rollup; NO `direction` param; symbol-level loop calls `findReferencesByFqn` per FQN |
| serialize.ts | `packages/core/src/tools/serialize.ts:140` | `format: "json" \| "toon"` only; flat emit; `projectFields` handles dotted paths | NO `tree` mode; NO grouped emit helper (clamp/group duplicated inline in impact-analysis) |
| tool-definitions.ts | `apps/mcp-client/src/tool-definitions.ts:1574` | 49 tools registered; impact_analysis at §856-914 with enum drift (missing `"all"`); `project_map` at §622-648 has no aspects | NO `get_architecture` tool; NO `search_code` tool (only core alias); NO `aspects` anywhere |
| symbol-repository-pg.ts | `packages/core/src/services/symbol/symbol-repository-pg.ts` | `getProjectMapSnapshot` reads `symbol_imports` + filters `symbol_references` to `ref_kind='http_call'` | `call`-kind edges unread for architecture/impact |

### Theme B — indexing robustness

| Target | Path | Current state | Gap |
|---|---|---|---|
| Auto-reindex cap | `packages/shared/src/config/index.ts:410` + `massa-th0th-config.ts:206` | `autoReindexMaxFiles: 200` (env `AUTOREINDEX_MAX_FILES`) | — |
| Indexing entry | `packages/core/src/tools/index_project.ts:68` → `EtlPipeline.run()` at `packages/core/src/services/etl/pipeline.ts:119` | In-process `runTails: Map<string, Promise<void>>` chains same-project runs | NO cross-process single-writer; lost on restart |
| Discover stage | `packages/core/src/services/etl/stages/discover.ts:170` | Per-file content-hash fingerprint (closest thing to incremental state) | NO `FileCursor{path,offset}` resumable state |
| Ignore patterns | `packages/core/src/services/search/ignore-patterns.ts:15-50` | Hard-coded `DEFAULT_IGNORES` + `.gitignore` merge via `Ignore` | NO bounded module; NO `MAX_MATCH_WORK`; NO `deny_unknown_fields`; security.excludePatterns not wired to glob filtering |
| read_file path safety | `packages/core/src/tools/read_file.ts:352-365` | Refuses relative-path guess; absolute paths returned verbatim | NO filesystem-side containment; `sanitizeFilePath` exists at `packages/shared/src/utils/sanitizer.ts:87` but NOT imported |
| Scheduler | `packages/core/src/services/scheduler/scheduler.ts` + `scheduler-store-pg.ts` | Env-driven (`MASSA_TH0TH_SCHEDULER_ENABLED`); per-job state PG-backed; `last_run_at` updated unconditionally | NO `last_success_at`; NO `consecutive_failures`; NO crash-safe catch-up |
| Lease infra | `packages/core/src/data/graph-generation/graph-generation-repository-pg.ts:158` | `graph_generations` table has lease columns + CHECK + partial UNIQUE indexes | Bound to generation row; not reusable for indexing single-writer |
| Latest migrations | `packages/core/prisma/migrations/` | Latest: `20260720210000_repair_hook_attribution` | 22 migrations total |

### Theme C + defense

| Target | Path | Current state | Gap |
|---|---|---|---|
| Synapse tools | `apps/mcp-client/src/tool-definitions.ts:982-1096` | 8 synapse_* tools (session/get/update/end/prime/access/prefetch/list); 3-7 calls/task today | NO `synapse_task_begin` / `synapse_task_end` wrappers |
| Synapse API | `apps/tools-api/src/routes/synapse.ts` | Full lifecycle: POST/GET/PATCH/DELETE/prime/access/prefetch | — |
| index_status | `apps/tools-api/src/routes/project.ts:397` + `packages/core/src/tools/get_index_status.ts:74` | Polling only; `IndexJob` PG-backed; stale reaper 60s/300s | NO jobId-stream |
| SSE infra | `apps/tools-api/src/routes/events.ts:116` | `GET /api/v1/events?projectId=` filter only; 15s heartbeat; 10 min auto-close; payloads already carry jobId | NO `?jobId=` filter; `index-job-tracker` does NOT publish to eventBus (only ETL pipeline does) |
| Moonshot `filters.$and` | `apps/mcp-client/src/tool-definitions.ts` | NOT PRESENT anywhere; would be greenfield | Preemptive: build `?flavor=moonshot` transport wrapper, schema rewrite deferred until needed |
| Client hints | `packages/core/src/controllers/search-controller.ts:387-411` | `filterByPatterns` post-fetch minimatch; no glob validation, no length cap | NO server-side revalidation; client hints trusted |
| N45 hook attribution | `apps/claude-plugin/hooks/_pin.sh` + `apps/opencode-plugin/src/session-project-pin.ts` + `packages/core/src/services/hooks/attribution-resolver.ts` | Verified complete; both emitter seams + server-side resolver + repair migration + acceptance suite | Drop from active set |

### Branch / pipeline state

- `main` is post-Wave-4 (`f3d8020..92b7fb4`).
- `wave-3-codespace-sync` on origin still pending cleanup (STATE.md line 27).
- No active feature branch for Wave 5.

## Gray areas needing resolution

Recorded as open questions for Specify Discuss step:

1. **N45 disposition**: drop entirely vs. mark `complete` and retain registry entry.
2. **N15 Moonshot**: no `filters.$and` exists today. Build `?flavor=moonshot` transport only (defer schema rewrite) vs. build both vs. skip until needed.
3. **N3 BFS CTE**: replace TS walk vs. add CTE behind flag (default TS) until parity proven.
4. **N11/N12 storage**: one `managed_runs` table (lease + idempotency) vs. two separate tables.
5. **N26 collapse scope**: `synapse_task_begin` = create+prime+first search; `synapse_task_end` = DELETE+summary. Confirm minimal set vs. include prefetch/access.
6. **N27 stream path**: extend existing `/api/v1/events?jobId=` vs. new dedicated `/api/v1/project/index/status/:jobId/stream`.
7. **Branch strategy**: single `wave-5` branch off main vs. per-theme branches.
8. **Migration count**: Wave 5 may add 4-6 migrations (lease, cursor, scheduler, capture policy optional). Confirm acceptable.

## Authoritative plan extracts

From `massa-th0th-improvement-plan-v3.md` Wave 5 table:

- N2: iterative Tarjan SCC over CALLS, SCCs > 1, opt-in, 400 k-edge budget, `*truncated`.
- N3: temp-table anchor, `NOT IN` seed exclusion, `MIN(hop)`, `(hop,id)` order, `*truncated` ceiling.
- N5: shared grouped helper for tree + json; same model; not parallel impl.
- N41: cbm drift — `detect_changes` field names (`impacted_total`/`impacted_shown`/`impacted_omitted`/`impacted_modules`), `get_architecture` cycles.
- N11: unique partial index on active runs, 90s expiry + heartbeat.
- N12: deterministic ids (SHA-256 of source record + content hash) + `UNIQUE(project_id,event_id)` + persisted `FileCursor{path,offset}`.
- N13: `Keep`/`Drop`/`MetadataOnly` dispositions, `MAX_MATCH_WORK`/`MAX_IGNORE_PATTERNS` bounds, `deny_unknown_fields`, server-side re-validation.
- N14: per-job `last_success_at`, non-overlapping ticks, crash-safe catch-up.
- N26: `synapse_task_begin` (create + prime + first search) and `synapse_task_end` (DELETE + summary).
- N27: `/api/v1/project/index/status/:jobId/stream`.
- N15: `?flavor=moonshot` strips root-level combinators at `tools/list`.
- N16: server re-validates and downgrades on contradiction.
- N45: confirm done, drop.
