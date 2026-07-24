# Wave 5 — Tasks

Reference: `references/spec-driven/tasks.md`. Approved design: `design.md`.

## Auto-size classification

**Large/Complex** — 19 requirements, 27 atomic tasks, 7 phases, 4+ migrations (2 net),
multiple public-contract additions. Full pipeline.

## Phase plan

| Phase | Theme | Tasks | Dependencies |
|---|---|---|---|
| P1 | Graph: cycles aspect (N2, N41) | T01–T04 | — |
| P2 | Graph: impact rollup + drift (N41) + BFS CTE (N3) | T05–T08 | P1 |
| P3 | Graph: grouped tree format (N5) | T09–T10 | P1, P2 |
| P4 | Indexing: managed_runs + capture policy (N11, N12, N13) | T11–T16 | — |
| P5 | Search: read_file containment + filter revalidation (N16, N9-ext) | T17–T18 | P4 (capture policy) |
| P6 | Scheduler: persisted state (N14) | T19–T20 | — |
| P7 | Synapse UX + SSE (N26, N27) | T21–T24 | — |
| P8 | Defense: Moonshot (N15) + N45 confirm | T25–T26 | — |
| P9 | Independent validation | T27 | all |

## Test Coverage Matrix

| AC | Test file | Layer |
|---|---|---|
| AC-1, AC-2 | `architecture.cycles.test.ts` (new) | unit |
| AC-1 | `get-architecture.test.ts` (new) | integration |
| AC-3 | `impact-analysis.test.ts` (extend) | unit |
| AC-4 | `tool-definitions.wave5.test.ts` (new) | unit |
| AC-5 | `impact-bfs-cte.test.ts` + `impact-bfs-parity.test.ts` (new) | integration (PG) |
| AC-6 | `serialize.test.ts` (extend) + per-tool tests | unit |
| AC-7 | `managed-run-repository.test.ts` (new) | integration (PG) |
| AC-8 | `etl-idempotent.test.ts` (new) | integration (PG) |
| AC-9 | `capture-policy.test.ts` (new) | unit |
| AC-10 | `read-file-containment.test.ts` (new) | unit |
| AC-11 | `scheduler-catchup.test.ts` (new) | integration (PG) |
| AC-12 | `synapse-task-envelope.test.ts` (new) | integration |
| AC-13 | `events-job-filter.test.ts` (new) | integration |
| AC-14 | `moonshot-flavor.test.ts` (new) | unit |
| AC-15 | `filter-validation.test.ts` (new) | unit |
| AC-16 | static grep on HANDOFF.md | static |
| AC-17 | Wave 4 regression suite unchanged | regression |
| AC-18 | `verify:tree-sitter-native` | native |
| AC-19 | tsc + build per commit | workspace |
| AC-20 | package.json diff (no new external deps) | static |
| AC-21 | per-tool negative tests | unit |

## Gate Check Commands

Per atomic commit:

```bash
rtk bun run typecheck
rtk bun run build
rtk bun test packages/core/src/__tests__/<focused>.test.ts   # or path
```

Per phase boundary:

```bash
rtk bun run typecheck
rtk bun run build
rtk bun test   # full suite, pre-existing shared-DB failures allowed
```

Final validation:

```bash
rtk bun run verify:tree-sitter-native    # AC-18
rtk bun run typecheck && rtk bun run build && rtk bun test
```

---

## Phase 1 — Graph: cycles aspect (FR-01, FR-02 partial, FR-04 partial)

### W5-T01 — `callEdges` input + repository read

**Files:**
- `packages/core/src/services/symbol/architecture.ts` (extend `ArchitectureInput`, `ArchitectureOptions`)
- `packages/core/src/services/symbol/symbol-graph.service.ts` (extend `ProjectMapGraphSnapshot`)
- `packages/core/src/services/symbol/symbol-repository-pg.ts` (`getProjectMapSnapshot` adds `callEdges`)

**Behavior:** `symbol_references WHERE ref_kind='call'` rows flow into `ArchitectureInput.callEdges: {from: string, to: string}[]`. Bounded (default 400k, configurable).

**ACs touched:** AC-1 (partial), AC-2 (partial).

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/symbol-graph.test.ts`; tsc 6/6; build 5/5.

---

### W5-T02 — Iterative Tarjan SCC

**Files:**
- `packages/core/src/services/symbol/cycle-detection.ts` (NEW)
- `packages/core/src/__tests__/cycle-detection.test.ts` (NEW)
- `packages/core/src/__tests__/cycle-detection.property.test.ts` (NEW — property test vs brute-force reference)

**Behavior:** Pure function `detectCycles(edges: Edge[], budget: number): { sccs: SCC[]; truncated: boolean }`. Iterative (explicit heap stack). Returns SCCs with >1 node. Sets `truncated=true` when edges exceed budget.

**Plan-critic revisions (FR-23 / AD-W5-017):**
- Property test: 100 random small graphs, compare against brute-force SCC finder.
- Specific fixtures: self-loop, two cycles sharing one node, K5 (fully connected 5-node), disconnected cycles, DAG (empty result).

**RSS guard clarification (AC-2):** Build the 500k-edge input graph in the baseline measurement (input allocation is not Tarjan overhead). Then assert `detectCycles` adds < 16 MiB RSS delta vs that baseline. Intent per AD-W5-001 is that the iterative impl doesn't balloon via recursion; input-size-linear allocation is expected.

**ACs touched:** AC-2, AC-25.

**Deps:** none (pure module).

**Verify:** `rtk bun test packages/core/src/__tests__/cycle-detection.test.ts packages/core/src/__tests__/cycle-detection.property.test.ts` incl. 500k-edge RSS guard (< 16 MiB over baseline, mirroring Wave 3 MLTS-022 stress pattern).

---

### W5-T03 — Wire `cycles` aspect + `aspects` opt-in

**Files:**
- `packages/core/src/services/symbol/architecture.ts` (extend `computeArchitectureMap`)
- `packages/core/src/__tests__/architecture.test.ts` (extend)

**Behavior:** `ArchitectureOptions.aspects?: string[]`. When `aspects` includes `"cycles"`, calls `detectCycles(input.callEdges, budget)`. Unknown aspect → throw teaching error listing valid values (Wave 4 N6 parity). Output adds `cycles?: { id, nodes, edgeCount }[]` and `cycles_truncated?: boolean`.

**ACs touched:** AC-1, AC-4 (teaching error path).

**Deps:** T01, T02.

**Verify:** `rtk bun test packages/core/src/__tests__/architecture.test.ts`.

---

### W5-T04 — `get_architecture` tool + REST route + mcp-client def

**Files:**
- `packages/core/src/tools/get_architecture.ts` (NEW)
- `packages/core/src/controllers/architecture-controller.ts` (NEW)
- `apps/tools-api/src/routes/architecture.ts` (NEW) — `GET /api/v1/project/:id/architecture`
- `apps/tools-api/src/index.ts` (wire route)
- `apps/mcp-client/src/tool-definitions.ts` (+def)

**Behavior:** Tool wraps `symbol-graph.service.computeArchitectureMapSafe`. Input: `{projectId, projectPath, aspects?, centralityLimit?, format?, fields?}`. Output serialized via `serializeToolResponse`.

**ACs touched:** AC-1, AC-4.

**Deps:** T03.

**Verify:** `rtk bun test packages/core/src/__tests__/get-architecture.test.ts` + `apps/tools-api/src/__tests__/architecture-route.test.ts`.

---

## Phase 2 — Graph: impact rollup + drift + BFS CTE

### W5-T05 — `impacted_modules` quotient rollup

**Files:**
- `packages/core/src/services/symbol/impact-analysis.ts` (extend)
- `packages/core/src/__tests__/impact-analysis.test.ts` (extend)

**Behavior:** After BFS, group impacted files by 2-segment prefix (`path/to/file.ts` → `path/to`). Cap 20 prefixes; overflow into `(other)`. Output adds `impacted_modules: { prefix, count }[]`. Same emitter as `impacted_total/shown/omitted`.

**ACs touched:** AC-3.

**Deps:** none (orthogonal to T01-T04).

**Verify:** `rtk bun test packages/core/src/__tests__/impact-analysis.test.ts`.

---

### W5-T06 — mcp-client impact_analysis enum drift + cbm alignment

**Files:**
- `apps/mcp-client/src/tool-definitions.ts` (impact_analysis schema: add `"all"` to scope enum)
- `apps/mcp-client/src/__tests__/tool-definitions.test.ts` (extend)

**Behavior:** Schema enum matches core tool. Field name audit: confirm `impacted_total/shown/omitted/modules/truncated` are exposed (they are after T05).

**ACs touched:** AC-4.

**Deps:** T05 (for modules field).

**Verify:** `rtk bun test apps/mcp-client/src/__tests__/tool-definitions.test.ts`.

---

### W5-T07 — Multi-source BFS recursive CTE (repository method)

**Files:**
- `packages/core/src/services/symbol/symbol-repository-pg.ts` (+`runBfsCteImpact`)
- `packages/core/src/__tests__/impact-bfs-cte.test.ts` (NEW)

**Behavior:** New repo method. Single recursive CTE: temp-table anchor, `NOT IN` seed exclusion with `WHERE file_id IS NOT NULL` guard (AD-W5-018), `MIN(hop)`, `(hop, file_id)` order, `LIMIT :max`. Returns `impacted[]` with file_id + hop (FQN resolution happens in service).

**Plan-critic revision (FR-24):** NULL guard on seed; CTE handles cyclic imports correctly (`MIN(hop)` collapses cycles).

**ACs touched:** AC-5 (partial), AC-26 (partial).

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/impact-bfs-cte.test.ts` (PG integration).

---

### W5-T08 — Wire BFS CTE behind flag + parity test

**Files:**
- `packages/shared/src/config/index.ts` (+`MASSA_AI_IMPACT_BFS_CTE` env, default false)
- `packages/shared/src/config/massa-ai-config.ts` (+config block)
- `packages/core/src/services/symbol/impact-analysis.ts` (branch on flag)
- `packages/core/src/__tests__/impact-bfs-parity.test.ts` (NEW — characterization)

**Behavior:** When flag on, calls `repo.runBfsCteImpact`. TS path retained as fallback + parity oracle. Characterization fixture pins current TS output; parity test runs both paths.

**Plan-critic revision (FR-24 / AD-W5-018):** Parity scoped to "same `impacted` FQN set; depths may differ ≤1 hop on cyclic graphs." Characterization fixture includes a cyclic-import case (≥2 files importing each other).

**ACs touched:** AC-5, AC-26.

**Deps:** T07.

**Verify:** `rtk bun test packages/core/src/__tests__/impact-bfs-parity.test.ts` with flag on and off, including cyclic-import fixture.

---

## Phase 3 — Grouped tree format

### W5-T09 — `groupRowsByPrefix` helper + `format:"tree"`

**Files:**
- `packages/core/src/tools/serialize.ts` (extend `SerializeOpts.format`, add helper)
- `packages/core/src/tools/serialize-interfaces.ts` (NEW — exported TS interfaces per AD-W5-020)
- `packages/core/src/__tests__/serialize.test.ts` (extend)

**Behavior:** `groupRowsByPrefix(rows, opts)` returns `{ total, omitted, groups: [{ qnPrefix, file, rows }] }`. Cap rows per group (50), cap groups (20), `(other)` overflow, exact totals. `format:"tree"` emits text-indented; `format:"json"` (when grouped mode selected via separate opt or row-shape detection) emits the same grouped model. **One shared helper for both.**

**Plan-critic revision (FR-26 / AD-W5-020):** Export explicit `GroupRowsByPrefixOptions` and `GroupedResult` TypeScript interfaces from `serialize-interfaces.ts`. B2/B3 import verbatim.

**ACs touched:** AC-6, AC-28 (partial).

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/serialize.test.ts` incl. mutation test asserting both formats change together.

---

### W5-T10 — Apply grouped format to consumer tools

**Files:**
- `apps/mcp-client/src/tool-definitions.ts` (+`format:"tree"` enum on search, trace_path, impact_analysis, get_references, get_architecture)
- `packages/core/src/tools/search_project.ts` (pass-through, no behavior change)
- `packages/core/src/tools/trace_path.ts` (pass-through)
- `packages/core/src/tools/impact_analysis.ts` (pass-through)
- `packages/core/src/tools/get_references.ts` (pass-through)
- per-tool tests (extend)

**Behavior:** mcp-client schema enum gains `"tree"`. Tools pass format through serialize. Existing `format:"json"` unchanged (only when caller selects tree does grouping kick in).

**ACs touched:** AC-6.

**Deps:** T09.

**Verify:** per-tool tests + `apps/mcp-client/src/__tests__/tool-definitions.test.ts`.

---

## Phase 4 — Indexing robustness

### W5-T11 — M-W5-01 `managed_runs` migration + Prisma model

**Files:**
- `packages/core/prisma/migrations/20260722120000_add_managed_runs/migration.sql` (NEW)
- `packages/core/prisma/schema.prisma` (+`ManagedRun` model)

**Behavior:** Per design AD-W5-001/AD-W5-004. Unique partial index on active runs; event_id uniqueness; CHECK on lease columns.

**ACs touched:** AC-7 (partial), AC-8 (partial).

**Deps:** none.

**Verify:** `rtk bun run db:reset && rtk bun run db:migrate` (PG); `rtk bun run typecheck`.

---

### W5-T12 — `ManagedRunRepository` (CAS lease)

**Files:**
- `packages/core/src/data/managed-runs/managed-run-contract.ts` (NEW — interface + types, including pinned `getActive` filter per AD-W5-014)
- `packages/core/src/data/managed-runs/managed-run-repository-pg.ts` (NEW — CAS impl with inline reaper per AD-W5-013)
- `packages/core/src/__tests__/managed-run-repository.test.ts` (NEW)
- `packages/core/src/__tests__/managed-run-concurrent-race.test.ts` (NEW — AC-22 concurrent-begin race)

**Behavior:** Mirrors `graph-generation-repository-pg.ts` patterns. Methods: `begin(projectId, runKind, eventId, contentHash) → {acquired, busy, stale}` (runs reaper first), `heartbeat(token) → {renewed, lease_lost}`, `complete(token, fileCursor?)`, `abort(token)`, `getActive(projectId, runKind)` (pinned filter).

**Plan-critic revisions (FR-20 / AD-W5-013, AD-W5-014):**
- `begin()` first UPDATEs expired `active` rows to `aborted` (reaper).
- `getActive` filter pinned: `status='active' AND lease_expires_at > clock_timestamp() ORDER BY lease_expires_at DESC LIMIT 1`.
- Concurrent-begin race test (AC-22): two parallel `begin()` calls, exactly one acquires, the other sees `busy`, no 500.
- Export `ManagedRunRepository` interface from `managed-run-contract.ts` for B2/B3 consumption (FR-26).

**ACs touched:** AC-7 (partial), AC-22, AC-28 (partial).

**Deps:** T11.

**Verify:** `rtk bun test packages/core/src/__tests__/managed-run-repository.test.ts packages/core/src/__tests__/managed-run-concurrent-race.test.ts` (PG).

---

### W5-T13 — Wire lease into IndexProjectTool + auto-reindex

**Files:**
- `packages/core/src/tools/index_project.ts` (acquire/release lease around `EtlPipeline.run`)
- `packages/core/src/services/search/rlm-indexing.ts` (lease for auto-reindex path)
- `packages/core/src/services/etl/pipeline.ts` (heartbeat spawn, AbortController on lease_lost)
- `packages/core/src/__tests__/etl-pipeline-lease.test.ts` (NEW)

**Behavior:** Concurrent `index` on same project: first acquires (202 + runId), second gets 409 busy with active runId. Stopped mid-run: lease expires after 90s; next call acquires.

**ACs touched:** AC-7.

**Deps:** T12.

**Verify:** `rtk bun test packages/core/src/__tests__/etl-pipeline-lease.test.ts` (PG integration, two concurrent tasks).

---

### W5-T14 — event_id idempotency + FileCursor resume

**Files:**
- `packages/core/src/services/etl/pipeline.ts` (event_id computation + dedup insert, same-transaction coupling per AD-W5-016)
- `packages/core/src/services/etl/stages/discover.ts` (read/update file_cursor)
- `packages/core/src/__tests__/etl-idempotent.test.ts` (NEW)
- `packages/core/src/__tests__/etl-kill-mid-load.test.ts` (NEW — AC-24)

**Behavior:** Each file-batch event has `event_id = SHA-256(source_record || content_hash)`. `UNIQUE(project_id, event_id)` prevents duplicate application. `file_cursor JSONB` updated each batch. Kill/restart resumes from cursor; replay produces no duplicate rows.

**Plan-critic revision (FR-22 / AD-W5-016):** Vector load + `event_id` insert in same DB transaction. Marker claim uncommitted until vectors land. Kill-mid-load test asserts file N re-processed (vectors present post-restart).

**ACs touched:** AC-8, AC-24.

**Deps:** T11, T12, T13.

**Verify:** `rtk bun test packages/core/src/__tests__/etl-idempotent.test.ts packages/core/src/__tests__/etl-kill-mid-load.test.ts` (PG integration, kill/restart simulation).

---

### W5-T15 — Capture-policy pure module

**Files:**
- `packages/core/src/services/search/capture-policy.ts` (NEW — pure)
- `packages/core/src/services/search/capture-policy-interfaces.ts` (NEW — exported `Policy`, `Disposition`, `ApplyPolicyFn` interfaces per AD-W5-020)
- `packages/core/src/__tests__/capture-policy.test.ts` (NEW)
- `packages/core/src/__tests__/ignore-patterns.characterization.test.ts` (NEW — pins current DEFAULT_IGNORES outcomes + `.gitignore` negation cases per AD-W5-015)

**Behavior:** `Keep | Drop | MetadataOnly` dispositions. `MAX_MATCH_WORK=100_000`, `MAX_IGNORE_PATTERNS=1024`. `denyUnknownFields`. `applyPolicy(path, policy)`. Default policy migrated from `DEFAULT_IGNORES`.

**Plan-critic revision (FR-21 / AD-W5-015):** Characterization fixture includes 5+ paths exercising a real `.gitignore` with negation rules (`!keep/me.js`) to pin pre-Wave-5 outcomes. Export interfaces for B2/B3 (FR-26).

**ACs touched:** AC-9, AC-23 (partial), AC-28 (partial).

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/capture-policy.test.ts packages/core/src/__tests__/ignore-patterns.characterization.test.ts` (incl. .gitignore negation paths).

---

### W5-T16 — Wire capture-policy + server-side revalidation

**Files:**
- `packages/core/src/services/search/ignore-patterns.ts` (becomes thin wrapper over capture-policy; `.gitignore` merge via `Ignore` library runs *before* `applyPolicy` per AD-W5-015)
- `packages/shared/src/config/massa-ai-config.ts` (+`capturePolicy` config block)
- `packages/shared/src/config/index.ts` (load + validate policy)

**Behavior:** `loadProjectIgnore` continues to merge `.gitignore` rules with `DEFAULT_IGNORES` via `Ignore` library, then delegates the merged rule list to `applyPolicy`. Config load validates bounds + denyUnknownFields. Existing consumers (rlm-indexing, discover, index-manager) unchanged (still call `loadProjectIgnore`).

**Plan-critic revision (FR-21):** `.gitignore` merge ordering documented in source comment + verified by characterization test in T15.

**ACs touched:** AC-9, AC-23.

**Deps:** T15.

**Verify:** `rtk bun test packages/core/src/__tests__/ignore-patterns.test.ts packages/core/src/__tests__/ignore-patterns.characterization.test.ts`; characterization test still passes.

---

## Phase 5 — read_file containment + filter revalidation

### W5-T17 — `read_file` path containment

**Files:**
- `packages/core/src/tools/read_file.ts` (import sanitizer, enforce roots)
- `packages/shared/src/config/index.ts` (+`MASSA_AI_READ_FILE_ROOTS` env)
- `packages/core/src/__tests__/read-file-containment.test.ts` (NEW)

**Behavior:** Absolute paths must resolve under project root (`projectPath` arg), `cwd`, or env allowlist. Outside → teaching error listing valid roots. Does not regress 500-line cap.

**ACs touched:** AC-10.

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/read-file-containment.test.ts`.

---

### W5-T18 — Filter revalidation + downgrade

**Files:**
- `packages/core/src/services/search/filter-validation.ts` (NEW)
- `packages/core/src/controllers/search-controller.ts` (wire in)
- `packages/shared/src/config/index.ts` (+`MAX_FILTER_PATTERNS` env, default 32)
- `packages/core/src/__tests__/filter-validation.test.ts` (NEW)

**Behavior:** Cap patterns (default 32). Validate glob syntax (`minimatch.makeRe` try/catch). On contradiction (pattern in both include and exclude), drop exclude + emit `filter_downgrades: [{pattern, reason}]`.

**ACs touched:** AC-15.

**Deps:** none (orthogonal to capture-policy).

**Verify:** `rtk bun test packages/core/src/__tests__/filter-validation.test.ts`.

---

## Phase 6 — Persisted scheduler

### W5-T19 — M-W5-02 `last_success_at` migration + Prisma model

**Files:**
- `packages/core/prisma/migrations/20260722130000_add_scheduler_last_success/migration.sql` (NEW)
- `packages/core/prisma/schema.prisma` (+columns on `ScheduledJob`)

**Behavior:** Additive nullable columns: `last_success_at`, `last_failure_at`, `consecutive_failures INT NOT NULL DEFAULT 0`, `last_error`.

**ACs touched:** AC-11 (partial).

**Deps:** none.

**Verify:** `rtk bun run db:reset && rtk bun run db:migrate`; tsc.

---

### W5-T20 — Scheduler success/failure split + catch-up

**Files:**
- `packages/core/src/services/scheduler/scheduler.ts` (finally block split)
- `packages/core/src/services/scheduler/scheduler-store-pg.ts` (write new columns)
- `packages/core/src/services/scheduler/scheduler-types.ts` (interface update)
- `apps/tools-api/src/index.ts` (boot catch-up tick)
- `packages/core/src/__tests__/scheduler-catchup.test.ts` (NEW)

**Behavior:** Success → update `last_success_at`, reset `consecutive_failures=0`. Failure → update `last_failure_at`, increment `consecutive_failures`, capture `last_error` (truncated). Boot: jobs with `next_run_at < now()` AND `enabled=true` trigger one catch-up tick (non-overlapping per kind).

**ACs touched:** AC-11.

**Deps:** T19.

**Verify:** `rtk bun test packages/core/src/__tests__/scheduler-catchup.test.ts` (PG integration).

---

## Phase 7 — Synapse UX + SSE

### W5-T21 — `TaskEnvelopeService.begin` + REST + MCP tool

**Files:**
- `packages/core/src/services/synapse/task-envelope.ts` (NEW)
- `apps/tools-api/src/routes/synapse.ts` (+`POST /task/begin`)
- `apps/mcp-client/src/tool-definitions.ts` (+`synapse_task_begin` def)
- `packages/core/src/__tests__/synapse-task-envelope.test.ts` (NEW)

**Behavior:** 5-move envelope: create session → prime (if entries) → search → prefetch first hit → record access. Returns `{ sessionId, search, primed, partial, errors }`. Partial failure: session always returned; `partial=true` + `errors` lists failed sub-steps (AD-W5-019).

**Plan-critic revision (FR-25 / AD-W5-019):** Response gains `partial: boolean` and `errors: string[]`. Sub-step failures surfaced, not hidden. `search` may be `null` when search sub-step failed.

**ACs touched:** AC-12 (partial), AC-27.

**Deps:** none.

**Verify:** `rtk bun test packages/core/src/__tests__/synapse-task-envelope.test.ts` incl. partial-failure fixture.

---

### W5-T22 — `synapse_task_end` (DELETE + summary)

**Files:**
- `packages/core/src/services/synapse/task-envelope.ts` (extend `end()`)
- `apps/tools-api/src/routes/synapse.ts` (+`POST /task/:id/end`)
- `apps/mcp-client/src/tool-definitions.ts` (+`synapse_task_end` def)
- `packages/core/src/__tests__/synapse-task-envelope.test.ts` (extend)

**Behavior:** Compute summary (accessCount, topFiles from access history), DELETE session, return `{ sessionId, durationMs, accessCount, topFiles }`. Follow-up GET returns 404.

**ACs touched:** AC-12.

**Deps:** T21.

**Verify:** `rtk bun test packages/core/src/__tests__/synapse-task-envelope.test.ts`.

---

### W5-T23 — `?jobId=` filter on `/api/v1/events`

**Files:**
- `apps/tools-api/src/routes/events.ts` (parse `?jobId=`, apply filter)
- `packages/core/src/__tests__/events-job-filter.test.ts` (NEW — likely in apps/tools-api/__tests__)

**Behavior:** Filter applies to events whose payload carries `jobId`. Existing `?projectId=` unchanged. Both filters compose (AND).

**ACs touched:** AC-13 (partial).

**Deps:** none.

**Verify:** `rtk bun test apps/tools-api/src/__tests__/events-job-filter.test.ts`.

---

### W5-T24 — `IndexJobTracker` publishes to eventBus

**Files:**
- `packages/core/src/services/jobs/index-job-tracker.ts` (publish on state change)
- `packages/core/src/__tests__/index-job-tracker-events.test.ts` (NEW — extend)

**Behavior:** Tracker emits `indexing:started|progress|completed|failed` to eventBus on state changes. SSE subscribers with `?jobId=` receive them (verified end-to-end in test).

**ACs touched:** AC-13.

**Deps:** T23.

**Verify:** `rtk bun test packages/core/src/__tests__/index-job-tracker-events.test.ts` + integration test with SSE client.

---

## Phase 8 — Defense + closure

### W5-T25 — Moonshot flavor transport wrapper

**Files:**
- `apps/mcp-client/src/moonshot-flavor.ts` (NEW — pure schema-strip helper)
- `apps/mcp-client/src/index.ts` (parse `_meta.flavor` or query in ListTools)
- `apps/mcp-client/src/__tests__/moonshot-flavor.test.ts` (NEW)

**Behavior:** When `flavor=moonshot`, strip root-level `allOf`/`anyOf`/`oneOf` from tool schemas. Today's schema has none, so wrapper is no-op until needed. Test injects sample `anyOf` and asserts strip.

**ACs touched:** AC-14.

**Deps:** none.

**Verify:** `rtk bun test apps/mcp-client/src/__tests__/moonshot-flavor.test.ts`.

---

### W5-T26 — N45 confirmation log

**Files:**
- `.specs/HANDOFF.md` (one-line dated entry)

**Behavior:** Static entry: "N45 hook attribution verified complete at `92b7fb4`; registry entry stays `complete`." No code change.

**ACs touched:** AC-16.

**Deps:** none.

**Verify:** static grep on HANDOFF.md.

---

## Phase 9 — Independent validation

### W5-T27 — Independent verifier

**Files:**
- `.specs/features/wave-5-cross-pollination/validation.md` (NEW — written by verifier)

**Behavior:** Independent agent (author ≠ verifier). Per `references/spec-driven/validate.md`:
1. Spec-anchored outcome check (every AC mapped to deterministic test evidence).
2. Discrimination sensor (inject behavior-level faults in scratch; confirm tests kill them; surviving mutants become fix tasks).
3. Write `validation.md` with PASS/FAIL, per-AC evidence, sensor result, diff range.
4. Return ranked gap list.

**Deps:** T01–T26 all complete.

---

## Subagent batch plan

Per `references/spec-driven/sub-agents.md`, present the offer before Execute. Proposed batch plan (4 worker batches, whole phases):

| Batch | Worker scope | Tasks | Approx. effort |
|---|---|---|---|
| B1 | P1 + P2 (graph features) | T01–T08 | high (8 tasks, new aspect + tool + CTE) |
| B2 | P3 + P4 (grouped format + indexing) | T09–T16 | high (8 tasks, migration + ETL changes) |
| B3 | P5 + P6 + P7 (search/scheduler/synapse) | T17–T24 | high (8 tasks, multi-domain) |
| B4 | P8 + P9 (defense + validation) | T25–T27 | medium (3 tasks, includes verifier) |

Sequential execution (B1 → B2 → B3 → B4) because:
- B2's grouped format applies to tools from B1.
- B3's filter revalidation depends on B2's capture-policy.
- B4's validation needs everything.

Within-batch: each worker executes all its tasks in order (implement → gate → atomic commit), then reports compact summary (tasks done, commit hashes, test counts, deviations). Workers never spawn further sub-agents.

Alternative: single main-agent execution (no subagents) for tighter control but slower wall-clock.

## Open task-level questions (none blocking)

None. All task-level decisions (file placement, naming, test layer) follow existing conventions per design.md.
