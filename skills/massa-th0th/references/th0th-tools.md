# Th0th v2.0.2 Tool Contracts

Load this reference when exact MCP schemas, REST fallbacks, response modes, or
polling rules are needed. Prefer the active tool declaration over copied
examples.

## Contract Precedence

1. Active MCP schema for MCP calls.
2. Live `/swagger/json` schema for direct REST calls.
3. Release notes and README for intended behavior.
4. Non-destructive runtime probes when the surfaces disagree.

Swagger currently exposes empty response schemas and reports API version
`1.0.0`; use it for request contracts and routes, not as proof of response
shape or package version.

## MCP Capability Matrix

| Tool | Primary use | Important contract note |
|---|---|---|
| `th0th_index` | Start background project indexing | Requires `projectPath`; may return `jobId`. |
| `th0th_index_status` | Poll indexing progress | Poll after a real delay, never in a tight loop. |
| `th0th_list_projects` | Resolve exact project IDs and index status | Use before indexing or project-map calls. |
| `th0th_project_map` | Architecture/stats/PageRank overview | Uses `id`, not `projectId`. |
| `th0th_search` | Semantic + keyword code search | Supports `summary`, `full`, `enriched`, and optional Synapse `sessionId`. |
| `th0th_optimized_context` | Search plus compression | Has no `sessionId`; do not invent one. |
| `th0th_search_definitions` | Find symbol definitions | Search field is `search`; installed v2.0.2 may ignore search/kind filters. |
| `th0th_get_references` | Find symbol usages | Use `fqn` when names are ambiguous. |
| `th0th_go_to_definition` | Resolve a symbol from caller context | Optional `fromFile` improves disambiguation. |
| `th0th_symbol_snippet` | Read exact code lines | Requires `projectId` and relative `file`. |
| `th0th_read_file` | Targeted file/range read with symbols/imports | Relative paths may resolve against the server checkout; see below. |
| `th0th_recall` | Semantic memory retrieval | Use `projectId` for project-scoped decisions. |
| `th0th_memory_list` | Chronological memory audit | Treat as unscoped until runtime proves project filtering. |
| `th0th_remember` | Persist durable knowledge | Supported types: critical, conversation, code, decision, pattern. |
| `th0th_compress` | Compress large context | Use structured strategies; do not persist output automatically. |
| `th0th_analytics` | Inspect search/cache usage | Requires analytics `type`. |
| `th0th_reindex` | Force workspace reindex | Compatibility-sensitive; see below. |
| `th0th_reset_project` | Delete vectors/symbols/memories | Destructive; explicit user intent required. |
| `th0th_synapse_session` | Create an ephemeral cognitive session | Supply explicit agent/workspace/context/TTL. |
| `th0th_synapse_prime` | Prime Synapse buffer | Adapter is compatibility-sensitive in verified v2.0.2 runtime. |
| `th0th_synapse_access` | Record a consumed hit | Verified adapter may fail path binding; REST fallback works. |

## Retrieval Order

1. `th0th_list_projects` or equivalent index metadata to verify project ID,
   path, status, and `lastIndexedAt` before treating indexed context as current.
2. `th0th_project_map` for architecture orientation when the index is fresh for the current repository path and worktree state.
3. `th0th_search(responseMode="summary", maxResults=10)` for broad discovery.
4. `th0th_search(responseMode="enriched", maxResults=3)` for targeted deep reads with `fileImports`, `parentSymbol`, and chunk navigation metadata; raise to `maxResults=5` only when 4-5 exact files, symbols, or report finding IDs are already named.
5. Symbol tools and `th0th_read_file` for exact source evidence.
6. `th0th_optimized_context` for compact synthesized context when available.
7. Focused `rg`/file reads when th0th is unavailable, stale, incomplete, or misses obvious
   local truth.

Do not use `full` or `enriched` for broad whole-project sweeps. Attempt REST fallback exactly once after a documented MCP schema, adapter, or missing-operation failure; if REST also fails, continue with MCP/local fallback and record the skipped reason.

Project maps, search hits, and optimized context are discovery leads until
confirmed against source files read in the current session or returned with
freshness evidence for the current worktree. When index status is stale,
incomplete, missing the target path, or older than relevant local changes, use
focused source reads as proof and record the reduced retrieval confidence.

## Common MCP Calls

```js
th0th_search({
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
th0th_optimized_context({
  query: "session:<workflowSessionId> payment ownership",
  projectId: "<projectId>",
  maxTokens: 4000,
  maxResults: 5
})
```

```js
th0th_remember({
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
| Definition filters | MCP exposes `search`, `kind`, `file`, `exportedOnly` | REST documents query filters | If filters are ignored, client-filter results or use `th0th_go_to_definition`. |

## REST-Only Operations

Use `TH0TH_API_URL` and optional `x-api-key: $TH0TH_API_KEY`. Never expose the
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

- Prefer `th0th_search(autoReindex=true)` for small stale-index refreshes.
- Use `th0th_reindex` only after verifying its installed adapter contract on a
  disposable workspace.
- Fallback for a known path: `th0th_index({ projectPath, projectId,
  forceReindex: true })` and poll its job.
- Never call `th0th_reset_project` as routine reindex preparation. It can delete
  memories by default and requires explicit destructive intent.

## Polling Discipline

Never call `th0th_index_status` in a tight turn-by-turn loop. Poll after a real
delay. Preferred shell pattern:

```bash
TH0TH_API_URL="${TH0TH_API_URL:-http://localhost:3333}"
for i in $(seq 1 40); do
  result=$(rtk curl -s "$TH0TH_API_URL/api/v1/project/index/status/JOB_ID")
  status=$(printf '%s' "$result" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['status'])")
  printf '[%s] status=%s\n' "$i" "$status"
  [ "$status" = "completed" ] || [ "$status" = "failed" ] && break
  sleep 15
done
```

When shell polling is inappropriate, call status once, wait for a natural turn
or scheduled wakeup, then poll again.
