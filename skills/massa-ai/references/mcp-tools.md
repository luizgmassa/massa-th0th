# massa-ai Tool Contracts (52 Tools)

Load this reference when exact MCP schemas, REST fallbacks, response modes, or
polling rules are needed. Prefer the active tool declaration over copied
examples. The canonical tool list and order is defined in
`apps/mcp-client/src/tool-definitions.ts` CANONICAL_ORDER.

## Contract Precedence

1. Active MCP schema for MCP calls.
2. Live `/swagger/json` schema for direct REST calls.
3. Release notes and README for intended behavior.
4. Non-destructive runtime probes when the surfaces disagree.

Swagger currently exposes empty response schemas and reports API version
`1.0.0`; use it for request contracts and routes, not as proof of response
shape or package version.

## MCP Capability Matrix — Indexing & Search

| Tool | Primary use | Important contract note |
|---|---|---|
| `index` | Start background project indexing | Requires `projectPath`; may return `jobId`. |
| `index_status` | Poll indexing progress | Poll after a real delay, never in a tight loop. |
| `reindex` | Force workspace reindex | Compatibility-sensitive; see Reindex And Reset below. |
| `reset_project` | Delete vectors/symbols/memories | Destructive; explicit user intent required. |
| `list_projects` | Resolve exact project IDs and index status | Use before indexing or project-map calls. |
| `project_map` | General architecture/stats/PageRank overview | Uses `id`, not `projectId`. Returns stats, top files by PageRank, symbol counts, extension distribution, recent files. |
| `get_architecture` | Architecture-specific deep map | Uses `id`. Returns packages, entry points, routes, hotspots, communities, layers, and opt-in cycles (Tarjan SCC). Pass `aspects:["cycles"]` for call cycles. Distinct from `project_map` (general overview vs architecture-specific). |
| `search` | Semantic + keyword code search | Supports `summary`, `full`, `enriched`, and optional Synapse `sessionId`. |
| `optimized_context` | Search plus compression | Has no `sessionId`; do not invent one. |
| `read_file` | Targeted file/range read with symbols/imports | Relative paths may resolve against the server checkout; see below. Prefer over native Read when symbol metadata is useful. |
| `symbol_snippet` | Read exact code lines by range | Requires `projectId` and relative `file` with `lineStart`/`lineEnd`. |
| `fetch_and_index` | Fetch URL(s) → HTML→markdown/JSON → index | SSRF-guarded, TTL-cached. Req: `url` or `requests`[]. Opt: `source`, `concurrency`, `force`, `ttl`. |

## MCP Capability Matrix — Symbol Graph

| Tool | Primary use | Important contract note |
|---|---|---|
| `search_definitions` | Find symbol definitions | Search field is `search`; installed v2.0.2 may ignore search/kind filters. |
| `get_references` | Find symbol usages | Use `fqn` when names are ambiguous. |
| `go_to_definition` | Resolve a symbol from caller context | Optional `fromFile` improves disambiguation. |
| `trace_path` | Trace call/data-flow/cross-service path (BFS) | Req: `function_name` or `qualifiedName`, `project`. Opt: `direction`, `mode`, `depth`, `include_tests`, `edge_types`[]. Only counts as evidence when index is fresh for current path/commit. |
| `impact_analysis` | Git-diff → impacted symbols (centrality-ranked) | Req: `project`, `projectPath`. Opt: `scope`, `base_branch`, `since`, `depth`, `paths`[]. Only counts as evidence when index is fresh. Empty diff → empty impact set (not an error). |

## MCP Capability Matrix — Memory & Lifecycle

| Tool | Primary use | Important contract note |
|---|---|---|
| `remember` | Persist durable knowledge | Supported types: critical, conversation, code, decision, pattern. |
| `recall` | Semantic memory retrieval | Use `projectId` for project-scoped decisions. |
| `memory_list` | Chronological memory audit | Treat as unscoped until runtime proves project filtering. |
| `memory_update` | Update a memory by id; re-embeds on content change | Req: `id`. Opt: `content`, `importance`, `tags`, `mergeTags`, `format`. |
| `memory_delete` | Hard-delete a memory by id; severs graph edges | Req: `id`. Opt: `format`. |
| `compress` | Compress large context | Use structured strategies; do not persist output automatically. |
| `analytics` | Inspect search/cache usage | Requires analytics `type` (summary, project, query, cache, recent). |
| `compact_snapshot` | Bounded (<2KB) session compaction snapshot | Req: `sessionId` (lifecycle session id, NOT workflowSessionId). Opt: `projectId`, `persist`. Zero-loss table-of-contents for /compact recovery. |

## MCP Capability Matrix — Synapse (Cognitive Layer)

| Tool | Primary use | Important contract note |
|---|---|---|
| `synapse_session` | Create an ephemeral cognitive session | Supply explicit agent/workspace/context/TTL. Omit `sessionId` for server-generated ID. |
| `synapse_get` | Inspect session state | Use to confirm state or diagnose expiry. |
| `synapse_update` | Replace session task context | Use after a major focus shift (investigate → fix). |
| `synapse_end` | End a session | Free resources after completion when practical. |
| `synapse_prime` | Prime Synapse buffer | Adapter is compatibility-sensitive; may fail with 422. REST fallback or skip. |
| `synapse_access` | Record a consumed hit for affinity | Verified adapter may fail path binding; REST fallback with `memoryId` works. |
| `synapse_prefetch` | Warm buffer for a file about to be investigated | Req: `id` (session), `filePath`. Opt: `symbols`, `chains`, `maxResults`, `minImportance`, `entries`. |
| `synapse_list` | List active session count | Debug aid. |
| `synapse_task_begin` | Begin a task envelope within a session | Req: `id` (session id from `synapse_session`). Opt: `taskContext`. Requires existing session. |
| `synapse_task_end` | End a task envelope within a session | Req: `id` (session id). Requires existing task envelope. |

## MCP Capability Matrix — Checkpoints

| Tool | Primary use | Important contract note |
|---|---|---|
| `create_checkpoint` | Save task progress for later resumption | Req: `taskId`, `description`. Opt: `status`, `currentStep`, `progressPercent`, `totalSteps`, `completedSteps`, `checkpointType` (manual/milestone), `agentId`, `projectId`, `memoryIds`, `fileChanges`, `decisions`, `learnings`, `nextAction`, `pendingValidations`, `format`. |
| `list_checkpoints` | List saved checkpoints | Opt: `taskId`, `projectId`, `checkpointType`, `includeExpired`, `limit`, `format`. |
| `restore_checkpoint` | Restore a checkpoint and return state + integrity | Opt: `checkpointId` or `taskId` (restore latest for task), `format`. |

## MCP Capability Matrix — Cross-session Handoffs

| Tool | Primary use | Important contract note |
|---|---|---|
| `handoff_begin` | Begin a cross-session handoff; dual-writes searchable memory | Req: `projectId`. Opt: `sourceSessionId`, `targetAgent`, `summary`, `openQuestions`, `nextSteps`, `files`. |
| `handoff_accept` | Accept an open handoff (open→accepted) | Req: `id`. Opt: `projectId`. |
| `handoff_cancel` | Cancel/expire an open handoff | Req: `id`. Opt: `projectId`. |
| `handoff_list_pending` | List open handoffs, oldest-first | Req: `projectId`. Opt: `targetAgent`. |

## MCP Capability Matrix — Auto-improvement (Proposals)

| Tool | Primary use | Important contract note |
|---|---|---|
| `list_proposals` | List pending auto-improvement proposals, newest-first | Req: `projectId`. |
| `approve_proposal` | Approve a proposal; applies the memory edit | Req: `id`. Opt: `projectId`, `source`. |
| `reject_proposal` | Reject a proposal (no edit applied) | Req: `id`. Opt: `projectId`, `reason`. |

## MCP Capability Matrix — Passive Capture

| Tool | Primary use | Important contract note |
|---|---|---|
| `hook_ingest` | Passively ingest lifecycle events as Observations | Req: `events`[]. Used by host hook scripts, not agent workflows directly. |

## MCP Capability Matrix — Project Bootstrap

| Tool | Primary use | Important contract note |
|---|---|---|
| `bootstrap` | Scan a project and create seed memories | Req: `projectId`. Opt: `projectPath`, `force`. Idempotent; LLM-off degrades to rule-based. |

## MCP Capability Matrix — Code Execution (Sandbox)

| Tool | Primary use | Important contract note |
|---|---|---|
| `execute` | Run code in a detected runtime | Req: `language`, `code`. Opt: `timeout`, `background`, `cwd`, `intent`. Local-dev only. |
| `execute_file` | Read a file into a sandboxed var and run code over it | Req: `path`, `language`, `code`. Opt: `timeout`, `intent`. Avoids loading full file into context. |
| `batch_execute` | Run N shell commands in parallel | Req: `commands`[]. Opt: `queries`, `timeout`, `concurrency`, `cwd`, `query_scope`. Concurrency-capped at 256. |

## MCP Capability Matrix — Project Lifecycle (Admin)

| Tool | Primary use | Important contract note |
|---|---|---|
| `rename_project` | Rename a project identity transactionally | Req: `sourceProjectId`, `targetProjectId`. Default `dryRun=true`; apply with `dryRun=false` + `operationId` + `expectedPlanHash`. Administrative, not workflow-recurring. |
| `merge_projects` | Merge one project identity into another | Req: `sourceProjectId`, `targetProjectId`. Same dryRun/planHash contract as `rename_project`. Administrative, not workflow-recurring. |

## Retrieval Order

1. `list_projects` or equivalent index metadata to verify project ID,
   path, status, and `lastIndexedAt` before treating indexed context as current.
2. `project_map` for general architecture orientation when the index is fresh for the current repository path and worktree state.
3. `get_architecture` for architecture-specific deep maps (packages, routes, hotspots, communities, cycles) when the index is fresh.
4. `search(responseMode="summary", maxResults=10)` for broad discovery.
5. `search(responseMode="enriched", maxResults=3)` for targeted deep reads with `fileImports`, `parentSymbol`, and chunk navigation metadata; raise to `maxResults=5` only when 4-5 exact files, symbols, or report finding IDs are already named.
6. Symbol tools (`search_definitions`, `get_references`, `go_to_definition`) and `read_file` for exact source evidence.
7. `symbol_snippet` for raw code snippets by file + line range.
8. `trace_path` for typed-edge BFS call/data-flow path tracing (fresh index only).
9. `impact_analysis` for git-diff centrality-ranked impact (fresh index only).
10. `optimized_context` for compact synthesized context when available.
11. Focused `rg`/file reads when massa-ai is unavailable, stale, incomplete, or misses obvious local truth.

Do not use `full` or `enriched` for broad whole-project sweeps. Attempt REST fallback exactly once after a documented MCP schema, adapter, or missing-operation failure; if REST also fails, continue with MCP/local fallback and record the skipped reason.

Graph tools (`trace_path`, `impact_analysis`, `get_architecture`) only count as
evidence when the index is fresh for the current repository path and
commit/worktree state. When the index is stale, incomplete, missing the target
path, or older than relevant local changes, fall back to `search`/`get_references`
and record the reduced retrieval confidence.

Project maps, search hits, and optimized context are discovery leads until
confirmed against source files read in the current session or returned with
freshness evidence for the current worktree. When index status is stale,
incomplete, missing the target path, or older than relevant local changes, use
focused source reads as proof and record the reduced retrieval confidence.

## Common MCP Calls

```js
search({
  query: "authentication middleware",
  projectId: "<projectId>",
  maxResults: 10,
  responseMode: "summary",
  autoReindex: false,
  sessionId: "<synapseSessionId>"
})
```

Omit `sessionId` for one-shot or stateless search.

```js
optimized_context({
  query: "session:<workflowSessionId> payment ownership",
  projectId: "<projectId>",
  maxTokens: 4000,
  maxResults: 5
})
```

```js
remember({
  content: "<durable fact or decision>",
  type: "decision",
  importance: 0.8,
  projectId: "<projectId>",
  sessionId: "<workflowSessionId>",
  tags: [
    "project:<projectId>",
    "session:<workflowSessionId>",
    "workflow:<type>",
    "entity:<name>",
    "memory:semantic"
  ],
  format: "toon"
})
```

```js
create_checkpoint({
  taskId: "auth-refactor",
  description: "Token rotation mid-flight",
  progressPercent: 60,
  currentStep: "rotateToken",
  nextAction: "finish rotateToken in src/auth.ts",
  fileChanges: ["src/auth.ts"],
  checkpointType: "manual"
})
```

```js
handoff_begin({
  projectId: "<projectId>",
  summary: "Auth refactor in progress; token rotation unfinished",
  nextSteps: ["finish rotateToken in auth.ts", "add tests"],
  files: ["src/auth.ts", "src/token.ts"]
})
```

## Verified MCP/REST Differences

| Area | MCP surface | REST/Swagger surface | Policy |
|---|---|---|---|
| Search session | `sessionId` | `sessionId` | Value is ephemeral `synapseSessionId`. |
| Search output | No `format` field in active MCP | REST supports `format` | Keep `format` out of MCP search calls. |
| Optimized context | No session field | No session field | Preserve workflow context in query text/tags. |
| Memory store | No `linkTo` in active MCP | REST exposes `linkTo` | REST-only until MCP adds it. |
| Memory recall | No `includeRelated` in active MCP | REST exposes `includeRelated` | REST-only until MCP adds it. |
| Memory list | MCP declares `projectId` | REST body has no `projectId` | Do not trust it for project scoping. |
| File read | MCP has line range/compress/symbol/import fields | REST also has offset/limit/targetRatio/format | Keep REST-only fields out of MCP. |
| Synapse create | MCP fields are broadly optional | REST requires `agentId` | Always provide explicit agent/workspace/context/TTL. |
| Synapse prime | MCP declares `{id, results}` | REST requires `{entries}` | Verified adapter may fail with 422; use REST fallback or skip. |
| Synapse access | MCP permits `memoryId` or `filePath` | REST requires `memoryId` | Verified MCP path binding failed; use REST fallback with `memoryId`. |
| Reindex | MCP declares `{id, forceReindex}` | REST requires path `id` plus body `projectPath` | Probe only on disposable workspace; otherwise use full index fallback. |
| File read path | MCP permits relative or absolute `filePath` | REST reads server filesystem | If relative resolution fails, combine registered workspace path with the indexed relative path. |
| Definition filters | MCP exposes `search`, `kind`, `file`, `exportedOnly` | REST documents query filters | If filters are ignored, client-filter results or use `go_to_definition`. |

## REST-Only Operations

Use `MASSA_AI_API_URL` and optional `x-api-key: $MASSA_AI_API_KEY`. Never expose the
key in output or persistence.

- System diagnostics: `/health`, `/api/v1/system/status`,
  `/api/v1/system/health/local`, `/api/v1/system/ollama`.
- Remote upload/index: `POST /api/v1/project/upload-and-index`.
- Index events: `GET /api/v1/events`.
- Workspace details/removal: `GET|DELETE /api/v1/workspace/:id`.
- File centrality: `GET /api/v1/symbol/centrality/:projectId`.
- Synapse inspect/update/delete/prefetch/list routes documented in
  `references/synapse-policy.md`.

Do not use API-only routes merely because they exist. Prefer MCP unless the
required operation is absent or its adapter is proven broken.

## Reindex And Reset

- Prefer `search(autoReindex=true)` for small stale-index refreshes.
- Use `reindex` only after verifying its installed adapter contract on a
  disposable workspace.
- Fallback for a known path: `index({ projectPath, projectId,
  forceReindex: true })` and poll its job.
- Never call `reset_project` as routine reindex preparation. It can delete
  memories by default and requires explicit destructive intent.

## Polling Discipline

Never call `index_status` in a tight turn-by-turn loop. Poll after a real
delay. Preferred shell pattern:

```bash
MASSA_AI_API_URL="${MASSA_AI_API_URL:-http://localhost:3333}"
for i in $(seq 1 40); do
  result=$(rtk curl -s "$MASSA_AI_API_URL/api/v1/project/index/status/JOB_ID")
  status=$(printf '%s' "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
  printf '[%s] status=%s\n' "$i" "$status"
  [ "$status" = "completed" ] || [ "$status" = "failed" ] && break
  sleep 15
done
```

When shell polling is inappropriate, call status once, wait for a natural turn
or scheduled wakeup, then poll again.