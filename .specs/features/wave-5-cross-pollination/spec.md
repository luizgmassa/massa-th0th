# Wave 5 — Cross-pollination Spec

- projectId: `massa-ai`
- workflowSessionId: `spec-wave-5`
- workflow: spec-driven (Large/Complex)
- branch: `wave-5` (off `main` post-`92b7fb4`)
- baseline: `92b7fb4` (Wave 4 head)
- source plan: `~/Downloads/massa-ai-improvement-plan-v3.md` Wave 5
- gray-area resolutions: see `context.md` "Gray areas needing resolution" — all closed

## Objective

Port the highest-impact cbm/ai-memory delta features onto massa-ai's existing
`architecture.ts` / `impact-analysis.ts` / `serialize.ts` / ETL pipeline / scheduler /
Synapse API / MCP surface, without regressing Wave 4 correctness or Wave 3 native runtime.

## In scope

Eight themes from the v3 plan: N2, N3, N5, N41 (graph features); N11, N12, N13 (indexing
robustness); N14 (persisted scheduler); N26 (Synapse UX); N27 (SSE push); N15, N16
(defense-in-depth); N45 (confirmation only).

## Out of scope

- god-file decomposition (N31, Wave 6)
- embedded MCP mode (N32, Wave 6)
- observability dashboard UI (N28, Wave 6)
- Windows wide-path canonicalization (M58)
- Moonshot schema rewrite beyond transport wrapper (deferred per gray-area #2)
- Full TS BFS removal (additive CTE behind flag per gray-area #3)

## Assumptions (closed gray areas)

| # | Assumption | Resolution |
|---|---|---|
| 1 | N45 needs no code; mark complete in registry | Confirm + drop |
| 2 | N15 is preemptive (no `filters.$and` exists today) | Transport wrapper only |
| 3 | N3 must not regress existing TS BFS tests | Additive behind flag |
| 4 | managed_runs unifies lease + idempotency | One table |
| 5 | synapse_task_begin collapses full lifecycle | 5-in-1 + DELETE |
| 6 | /api/v1/events already has the infra | Extend with `?jobId=` |
| 7 | Wave 5 = single branch | `wave-5` off main |
| 8 | Migration budget uncapped | Each feature ships what it needs |

## Requirements

### Graph features (Theme A)

**FR-01 — `get_architecture` MCP tool**
The MCP client exposes a new `get_architecture` tool that returns the existing
`ArchitectureMap` shape. Input: `projectId`, `aspects?` (string[]), `centralityLimit?`.
Required-by: FR-02.

**FR-02 — `cycles` aspect + Tarjan SCC**
`architecture.ts` exposes a `cycles` aspect: iterative (heap-stack) Tarjan SCC over
CALLS edges, SCCs with > 1 node only, opt-in via `aspects: ["cycles"]`, hard edge
budget (400k) with `cycles_truncated: bool` when hit. `ArchitectureInput` gains a
`callEdges` slot; `symbol-repository-pg.ts` `getProjectMapSnapshot` populates it from
`symbol_references WHERE ref_kind='call'`. Output: `{ cycles: { id, nodes: string[], edgeCount }[], cycles_truncated }`.

**FR-03 — `impacted_modules` quotient rollup**
`impact-analysis.ts` emits `impacted_modules: { prefix, count }[]` with 2-segment
prefix quotient and `(other)` overflow past a cap (default 20). Reuses the existing
`impacted_total/shown/omitted` code path; same emitter.

**FR-04 — cbm drift alignment**
- `impact_analysis` mcp-client enum includes `"all"` (today drifts from core tool).
- Field names match cbm delta: `impacted_total`, `impacted_shown`, `impacted_omitted`,
  `impacted_modules`, `truncated` (all already present except modules — covered by FR-03).
- `get_architecture` accepts the same `aspects` semantics as cbm (opt-in string list,
  unknown value → teaching error per Wave 4 N6 parity).

**FR-05 — Multi-source BFS recursive CTE (additive)**
New SQL path: temp-table anchor over changed files, recursive CTE over
`symbol_imports` with `NOT IN` seed exclusion, `MIN(hop)`, `(hop, file_id)` ordering,
`*truncated` ceiling at `MAX_IMPACTED`. Gated by `MASSA_AI_IMPACT_BFS_CTE=true`
(default off). TS reverse-import BFS retained as fallback + parity oracle. Parity
test asserts both paths produce identical `impacted` sets on a frozen fixture.

**FR-06 — `format: "tree"` mode + grouped helper**
`serialize.ts` adds `format: "tree"`. A shared `groupRowsByPrefix(rows, { qnPrefix, file })`
helper emits `{ total, omitted, groups: [{ qnPrefix, file, rows: [] }] }`. Both `format:"tree"`
(text-indented) and `format:"json"` (same grouped model, JSON-encoded) route through this
helper. Clamp behavior: cap rows per group (default 50) + cap groups (default 20), with
`(other)` overflow and exact `*_total`/`*_omitted` (Wave 4 N4 parity).

**FR-07 — Apply grouped format to consumer tools**
`search`, `trace_path`, `impact_analysis`, `get_references`, `get_architecture` accept
`format: "tree" | "json" | "toon"` and emit grouped rows when tree/json is selected.
mcp-client tool-definitions updated for each.

### Indexing robustness (Theme B)

**FR-08 — `managed_runs` table**
New migration creates `managed_runs`:
`(project_id, run_kind, lease_token?, lease_expires_at?, heartbeat_at?, event_id UNIQUE, content_hash, file_cursor JSONB, status, created_at, completed_at?)`.
Partial UNIQUE index: one active row per `(project_id, run_kind)` where `status='active'`
and `lease_expires_at > now()`. CHECK: `(lease_token IS NULL) = (lease_expires_at IS NULL)`.
Prisma model added. Repository mirrors `graph-generation-repository-pg.ts` patterns
(begin/heartbeat/complete with CAS).

**FR-09 — Lease-based single-writer for indexing**
`IndexProjectTool` + auto-reindex path acquire a `managed_runs` lease (`run_kind='indexing'`)
before ETL starts; 90s expiry + 30s heartbeat; release on terminal state. Concurrent
`index`/`reindex` on the same project gets `409 busy` with the active run id.

**FR-10 — Idempotent incremental import**
Each ETL file-batch event has `event_id = SHA-256(source_record || content_hash)`.
`UNIQUE(project_id, event_id)` prevents duplicate application across crashes/restarts.
Persisted `FileCursor{path, offset}` in `managed_runs.file_cursor` makes Discover
resumable. Lifts the 200-file `autoReindexMaxFiles` cap when `managed_runs` is active
(cap becomes advisory; full scan still bounded by `maxIndexSize`).

**FR-11 — Capture-policy bounded module**
New `packages/core/src/services/search/capture-policy.ts` (pure, no I/O):
- Dispositions: `Keep | Drop | MetadataOnly`
- Bounds: `MAX_MATCH_WORK=100_000`, `MAX_IGNORE_PATTERNS=1024`
- `denyUnknownFields: true` (reject unknown policy keys)
- `applyPolicy(filePath, policy): Disposition`
Existing `DEFAULT_IGNORES` migrates into a default policy. Loaded from config
(`capturePolicy` block in `massa-ai-config.ts`). `loadProjectIgnore` becomes a
thin wrapper over the policy module. Server-side re-validation on config load.

**FR-12 — Filesystem-side path containment for `read_file`**
`packages/core/src/tools/read_file.ts` imports `sanitizeFilePath` from
`packages/shared/src/utils/sanitizer.ts`. Absolute paths must resolve under one of:
the project root (`projectPath` arg), `cwd`, or an explicit allowlist env var
`MASSA_AI_READ_FILE_ROOTS` (colon-separated). Outside → teaching error with
valid roots. Does not regress the existing 500-line cap (Wave 4 N9).

### Persisted scheduler (Theme B extension)

**FR-13 — `last_success_at` + crash-safe catch-up**
`scheduled_jobs` gains `last_success_at BIGINT?`, `last_failure_at BIGINT?`,
`consecutive_failures INT DEFAULT 0`, `last_error TEXT?`. Migration is additive
(NULL-safe). `scheduler.ts` updates success/failure in the finally block (currently
writes `last_run_at` unconditionally). On boot, jobs with `next_run_at < now()` AND
`enabled=true` AND non-overlapping kind trigger catch-up (single tick per missed
job, not full backfill).

### Synapse UX (Theme C)

**FR-14 — `synapse_task_begin` MCP tool**
New tool collapses 5 moves: create session → prime with entries (optional) → first
search → prefetch first hit → record access. Input: `{ agentId, taskContext, query,
projectId, entries?, limit? }`. Returns `{ sessionId, search: SearchResult, primed: n }`.
Delegates to existing Synapse API endpoints in sequence; single transaction-style envelope.
Failures leave the session created (caller can retry or end).

**FR-15 — `synapse_task_end` MCP tool**
New tool: DELETE session + return summary `{ sessionId, durationMs, accessCount,
searchCount, topFiles: string[] }`. Delegates to existing DELETE + reads access history.

### SSE push (Theme C extension)

**FR-16 — `/api/v1/events?jobId=` filter + tracker publish**
`apps/tools-api/src/routes/events.ts` accepts `?jobId=` alongside `?projectId=`.
Filter applies to events whose payload carries that jobId. `IndexJobTracker` publishes
state transitions (`indexing:started|progress|completed|failed`) to the existing
`eventBus` (currently only ETL pipeline publishes). No new endpoint.

### Defense-in-depth (Theme D)

**FR-17 — `?flavor=moonshot` transport wrapper**
`apps/mcp-client/src/index.ts` `ListToolsRequest` handler accepts `_meta?flavor` or
query param `?flavor=moonshot`. When set, root-level JSON Schema combinators
(`allOf`/`anyOf`/`oneOf`/`$ref` to combinators) are stripped from the response.
No schema is rewritten in storage; the wrapper is transport-only. Today's schema has
no combinators, so the wrapper is a no-op until needed; verified by a unit test that
injects a sample combinator and asserts the strip.

**FR-18 — Server-side revalidation of client filter hints**
`search-controller.ts` `filterByPatterns`:
- Cap `include.length + exclude.length ≤ MAX_FILTER_PATTERNS` (default 32).
- Validate glob syntax (try/catch `minimatch.makeRe`); reject invalid → teaching error.
- On contradiction (e.g. identical pattern in both), downgrade by dropping the
  exclude entry and emitting a `filter_downgrades: [{ pattern, reason }]` field on
  the response. Does not silently drop both.

### Closure

**FR-19 — N45 confirmation log**
One-line entry in `.specs/HANDOFF.md` confirming hook-attribution-repair verified
complete against current source (post-Wave-4 head). No code change. Registry entry
stays `complete`.

### Plan-critic revisions (post pre-mortem gate)

**FR-20 — `managed_runs` reaper + `getActive` pin**
Every `begin()` first flips `status='active' AND lease_expires_at <= now()` rows to
`status='aborted'` (best-effort UPDATE, no row lock held). `getActive(projectId, runKind)`
filter is pinned: `WHERE project_id=? AND run_kind=? AND status='active' AND lease_expires_at > clock_timestamp() ORDER BY lease_expires_at DESC LIMIT 1`. Concurrent `begin()` calls
inside the same 90s window are tested explicitly (one acquires, the other sees `busy`,
no 500 / `could not serialize access`).

**FR-21 — Capture-policy `.gitignore` merge preservation**
`loadProjectIgnore` continues to merge project `.gitignore` rules with `DEFAULT_IGNORES`
via the `Ignore` library *before* delegating to `applyPolicy`. `applyPolicy` consumes the
merged rule list, not the raw policy. A fixture project with `.gitignore` containing a
negation rule (`!keep/me.js`) preserves the pre-Wave-5 ignore outcome exactly.

**FR-22 — `event_id` transactional coupling**
Vector load + `event_id` insert occur in the same DB transaction (PG-side vector tables)
or in a documented write-batch order (if vector store is separate): claim marker → load
vectors → commit marker. Kill mid-load leaves marker uncommitted; restart re-processes
file N. AC verifies file N vectors are present after restart, not skipped.

**FR-23 — Tarjan correctness property test**
`detectCycles` is validated against a brute-force reference SCC finder on 100 random
small graphs (property test). Specific cases: self-loop, two cycles sharing one node,
fully-connected 5-node subgraph, disconnected cycles, DAG.

**FR-24 — BFS CTE parity scope + NULL guard**
Parity claim scoped to: "same `impacted` FQN set on cyclic-import fixtures; depths may
differ by ≤1 hop on cyclic graphs." `NOT IN` seed guarded by `WHERE file_id IS NOT NULL`.
Characterization fixture includes ≥2 files importing each other.

**FR-25 — Synapse envelope partial-failure contract**
`synapse_task_begin` response gains `partial: boolean` and `errors: string[]` fields.
When any sub-step fails, `partial=true` and `errors` lists the failed step(s). `search`
may be `null` when the search sub-step failed; caller can retry or end.

**FR-26 — Subagent batch interface contracts**
B1 exports explicit TypeScript interfaces for `groupRowsByPrefix`, `ManagedRunRepository`
(including `getActive` filter signature), and `applyPolicy`. B2/B3 consume those interfaces
verbatim — no re-implementation. Interface drift blocks the batch (failing test).

## Acceptance criteria

### Functional

- **AC-1 (FR-01, FR-02)**: Calling `get_architecture` with `aspects: ["cycles"]` on a
  fixture project with a known CALL-cycle returns the cycle in `cycles[]` and sets
  `cycles_truncated=false` when under budget.
- **AC-2 (FR-02)**: Forcing a synthetic 500k-edge CALL graph sets `cycles_truncated=true`
  and returns ≤ budget edges. Iterative implementation does not overflow the JS stack
  (verified by completing the call without RangeError) and RSS growth stays
  input-linear: `< (edges/10_000)` MiB (~50 MiB ceiling at 500k edges, ~80 bytes/edge
  of adjacency+index+stack state). Intent per AD-W5-001 is that the iterative impl
  doesn't balloon via recursion or super-linear state; input-size-linear
  allocation for the adjacency list + Tarjan indices is expected and bounded.
- **AC-3 (FR-03)**: `impact_analysis` on a fixture with impacted files across ≥5 distinct
  2-segment prefixes emits `impacted_modules[]` with `(other)` overflow when prefix count
  > cap. `impacted_total` matches the unique pre-clamp count exactly.
- **AC-4 (FR-04)**: mcp-client `impact_analysis` schema enum includes `"all"`; calling
  with `scope:"all"` reaches the service unchanged; calling with an unknown aspect on
  `get_architecture` returns a Wave-4-N6 teaching error listing valid values.
- **AC-5 (FR-05)**: With `MASSA_AI_IMPACT_BFS_CTE=true`, `impact_analysis` produces
  an `impacted[]` set identical (same FQNs, same depths, modulo sort) to the TS path
  on the frozen characterization fixture. SQL path does not issue per-FQN follow-up
  queries (single CTE).
- **AC-6 (FR-06, FR-07)**: Selecting `format:"tree"` on `search` / `trace_path` /
  `impact_analysis` / `get_references` / `get_architecture` emits the grouped text-indented
  shape; `format:"json"` emits the same grouped model as JSON. Both go through one shared
  helper (asserted by a test that mutates the helper and observes both formats change).
- **AC-7 (FR-08, FR-09)**: Two concurrent `index` calls on the same `projectId`:
  the first acquires the lease (status 202 with run id); the second gets `409 busy`
  with the active run id. Stopping the first process mid-run lets the lease expire;
  the next call acquires after `lease_expires_at`.
- **AC-8 (FR-10)**: Killing the ETL process after N files and restarting resumes from
  the persisted `FileCursor` (no re-discover of already-applied files). Replaying the
  same source produces no duplicate vector rows (idempotency via `event_id` UNIQUE).
- **AC-9 (FR-11)**: A policy config with `MAX_IGNORE_PATTERNS=2` and 3 patterns is
  rejected at load with a teaching error. A policy with an unknown key is rejected
  when `denyUnknownFields:true`. `applyPolicy("node_modules/foo.js", defaultPolicy)`
  returns `Drop`; on a markdown docs file returns `Keep` (default policy migration).
- **AC-10 (FR-12)**: `read_file` on `/etc/passwd` (or equivalent host path outside
  project/allowlist) returns a teaching error listing valid roots; same call inside
  the project root succeeds.
- **AC-11 (FR-13)**: Stopping the API process with a job `next_run_at` in the past
  and restarting triggers exactly one catch-up tick per missed job; `last_success_at`
  updates only on success; `consecutive_failures` increments on failure.
- **AC-12 (FR-14, FR-15)**: A single `synapse_task_begin` call returns
  `{ sessionId, search, primed }` with a populated search result; a subsequent
  `synapse_task_end` returns `{ sessionId, durationMs, accessCount, topFiles }` and
  deletes the session (verified by a follow-up GET returning 404).
- **AC-13 (FR-16)**: Subscribing to `/api/v1/events?jobId=<active>` receives
  `indexing:started|progress|completed` events for that job and none for other jobs.
- **AC-14 (FR-17)**: Calling `tools/list?flavor=moonshot` on a fixture where the
  schema has been temporarily injected with a root-level `anyOf` returns a schema
  with that combinator stripped; calling without the flavor returns it unchanged.
- **AC-15 (FR-18)**: Search with 33+ patterns is rejected with a teaching error;
  search with an invalid glob is rejected with a teaching error; search with the
  same pattern in `include` and `exclude` returns results that include the pattern
  and adds a `filter_downgrades` entry.
- **AC-16 (FR-19)**: `.specs/HANDOFF.md` contains a dated entry confirming hook
  attribution verified complete at `92b7fb4`.
- **AC-22 (FR-20)**: Acquiring a `managed_runs` lease, SIGKILL-ing the process, waiting
  > 90s, then calling `begin()` again: the orphan row is flipped to `aborted` and the
  new `begin()` acquires successfully. Two concurrent `begin()` calls inside the same
  90s window: exactly one acquires, the other sees `busy` (no 500, no
  `could not serialize access`).
- **AC-23 (FR-21)**: A fixture project with `.gitignore` containing `!keep/me.js` and
  `DEFAULT_IGNORES` matching `keep/`: pre-Wave-5 `loadProjectIgnore` honors the negation;
  post-Wave-5 `loadProjectIgnore` (delegating to capture-policy) honors it identically
  (same outcome on 5+ sample paths).
- **AC-24 (FR-22)**: Kill the process during file N's vector load (after marker claim,
  before commit): on restart, file N's vectors are present in the vector store, not
  skipped. `event_id` for file N has exactly one committed row.
- **AC-25 (FR-23)**: Property test (100 random small graphs) confirms `detectCycles`
  output matches brute-force reference SCC partition. Specific fixtures pass: self-loop,
  shared-node cycles, K5, disconnected cycles, DAG.
- **AC-26 (FR-24)**: BFS CTE parity test on a cyclic-import fixture (≥2 files importing
  each other) confirms identical `impacted` FQN set between TS and CTE paths. NULL
  file_id in changed-seed returns empty impacted (no silent re-walk).
- **AC-27 (FR-25)**: `synapse_task_begin` with a failing search sub-step returns
  `{ sessionId, partial: true, errors: ["search"], search: null }`; session exists and
  is deletable via `synapse_task_end`.
- **AC-28 (FR-26)**: B1's exported interfaces are imported verbatim by B2/B3; a test
  in B2 asserts the interface signature matches B1's export.

### Non-functional

- **AC-17**: All Wave-4 N1/N4/N6/N9 behaviors remain green (regression suite unchanged).
- **AC-18**: Native tree-sitter runtime unaffected (`verify:tree-sitter-native` PASS
  on macOS arm64 — Codespace Linux not in this cycle's gate per Wave 3 residual).
- **AC-19**: TypeScript type-check (6/6) and build (5/5) green at every atomic commit.
- **AC-20**: No new dependency added to root `package.json` (sub-package additions OK
  if approved in Design).
- **AC-21**: Every new tool/endpoint has at least one focused test and one negative
  test (teaching-error path).
- **AC-29**: Every plan-critic revision (FR-20..FR-26) has a dedicated test.

## Test coverage matrix

| AC | Test fixture | Layer |
|---|---|---|
| AC-1, AC-2 | synthetic CALL-cycle project (TS fixture) | unit + integration |
| AC-3 | multi-prefix impact fixture | unit |
| AC-4 | mcp-client schema snapshot + service parity | unit + integration |
| AC-5 | frozen characterization fixture (TS vs CTE) | integration (PG) |
| AC-6 | search/trace/impact/ref/arch with grouped emit | unit |
| AC-7 | concurrent index race (two processes or two tasks) | integration (PG) |
| AC-8 | kill/restart ETL with FileCursor | integration (PG) |
| AC-9 | capture-policy module unit | unit |
| AC-10 | read_file path containment | unit |
| AC-11 | scheduler boot catch-up | integration (PG) |
| AC-12 | synapse_task_begin/end lifecycle | integration |
| AC-13 | SSE filter + tracker publish | integration |
| AC-14 | tools/list flavor wrapper | unit |
| AC-15 | filter revalidation | unit |
| AC-16 | HANDOFF.md grep | static |
| AC-17 | Wave-4 regression suite | integration |
| AC-18 | `verify:tree-sitter-native` | native |
| AC-19 | tsc + build per commit | workspace |
| AC-20 | package.json diff | static |
| AC-21 | per-feature negative tests | unit |

## Gate check commands

Per atomic task commit:

```bash
rtk bun run typecheck
rtk bun run build
rtk bun test packages/core/src/__tests__/<focused>.test.ts
```

Per phase boundary:

```bash
rtk bun run verify:tree-sitter-native   # AC-18
rtk bun test                             # full suite (allowing pre-existing shared-DB fixture failures)
```

Final validation:

```bash
rtk bun run typecheck && rtk bun run build && rtk bun test
```

Independent verifier runs the discrimination sensor per
`references/spec-driven/validate.md`.

## Risk register

| Risk | Likelihood | Mitigation |
|---|---|---|
| Tarjan SCC iterative overflow on huge graphs | Medium | heap-stack impl + 400k edge budget + Wave 3 RSS guard |
| BFS CTE behavior drift from TS path | Medium | characterization test gate + flag default off |
| managed_runs lease deadlock on crash | Medium | 90s expiry + graph-generation-repository-pg.ts proven CAS pattern |
| FileCursor backward-compat on existing indexes | Low | nullable column; existing runs unaffected |
| capture-policy breaks existing ignore behavior | Medium | characterization test pins current `DEFAULT_IGNORES` outcomes before refactor |
| read_file path containment breaks legitimate use | Low | env allowlist + project root always allowed |
| synapse_task_begin partial-failure leaks sessions | Medium | session always returned; caller retries or ends; ttl eviction unchanged |
| Grouped format breaks downstream consumers | Medium | format:"json" today is unchanged (only added grouped model when tree selected); M36 fields projection preserved |
| Moonshot wrapper accidentally strips needed schema | Low | wrapper is opt-in via flavor param; default unchanged |

## Out of acceptance (deferred)

- Linux Codespace re-verification of native runtime (Wave 3 residual).
- Pre-existing shared-DB fixture failures (owned by `sqlite-removal-followup` SQLRFU-002).
- `filters.$and` schema rewrite (N15 follow-up if a strict validator appears).
- TS BFS removal (FR-05 is additive; flip default to CTE in a later cycle after production parity).
- Web UI dashboard view (N28, Wave 6).
