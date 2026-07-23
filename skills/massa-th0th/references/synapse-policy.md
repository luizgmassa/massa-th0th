# Synapse Policy

Load this reference when a task is expected to issue more than one
`th0th_search`, when parallel agents need isolated retrieval context, or when
Synapse compatibility/fallback behavior matters.

## Two Session IDs

- `workflowSessionId`: stable, durable task identity used by recall, remember,
  tags, reports, handoffs, and continuation packages.
- `synapseSessionId`: ephemeral ID returned by `th0th_synapse_session`; pass it
  only as `th0th_search.sessionId`.

Never persist `synapseSessionId` as the task's durable session identity. A
resumed handoff reuses `workflowSessionId` and opens a fresh Synapse session.

## Activation

- One-shot lookup: skip Synapse.
- Planned related `th0th_search` calls >= 2: create a Synapse session before the first search.
- Parallel subagents: each agent gets its own Synapse session while retaining
  the parent/child `workflowSessionId` tags.
- Major focus shift: update task context through REST when available; otherwise
  create a fresh Synapse session and let the prior session expire.

Default search budget inside a Synapse session:

- Summary discovery: `responseMode="summary"`, `maxResults=10`.
- Targeted deep reads: `responseMode="enriched"`, `maxResults=3`.
- Expanded deep reads: `maxResults=5` only when 4-5 exact files, symbols, or report finding IDs are already named.
- Do not use Synapse for a single recall, project map, exact file read, or one symbol lookup.

## MCP-First Lifecycle

1. Call `th0th_synapse_session` with explicit `agentId`, `workspaceId`,
   one-sentence `taskContext`, and `ttlMs`. Omit `sessionId` so the server
   generates a collision-free ID.
2. Call `th0th_recall` using `workflowSessionId` and project/entity context.
3. Prime the buffer when the adapter supports it.
4. Pass the returned `synapseSessionId` as `sessionId` on every related
   `th0th_search` call.
5. After consuming a result, record its `memoryId` through the verified access
   route when available.

Verified v2.0.2 adapter warnings:

- MCP prime exposes `{ id, results }`, but the installed adapter forwarded that
  body unchanged to REST, which requires `{ entries }`, and returned HTTP 422.
- MCP access returned `Session not found or expired` for a live session that
  REST could inspect and update; direct REST access with the same `memoryId`
  succeeded.

Treat MCP prime and access as compatibility-sensitive. Do not retry the same
failing call; use REST or skip the optional step. Always use `memoryId` for
access recording. File-path-only access is unsupported until a runtime probe
proves adapter translation.

## REST Lifecycle Fallback

Use REST only when `TH0TH_API_URL` is available and the operation is absent or
broken in MCP. Default local URL is `http://localhost:3333`.

If `TH0TH_API_KEY` is configured, send it as `x-api-key`. Never print, persist,
or place the key in memory, reports, status updates, command transcripts, or
committed files.

REST-only lifecycle operations:

| Operation | Route | Use |
|---|---|---|
| Inspect | `GET /api/v1/synapse/session/:id` | Confirm state or diagnose expiry. |
| Update focus | `PATCH /api/v1/synapse/session/:id` | Replace task context after a major focus shift. |
| Prime | `POST /api/v1/synapse/session/:id/prime` | Send `{ "entries": [...] }` when MCP priming fails. |
| Prefetch | `POST /api/v1/synapse/session/:id/prefetch` | Warm context for a file that will be investigated. |
| Close | `DELETE /api/v1/synapse/session/:id` | Free resources after completion when practical. |

REST prime entries require `id` and `content`; `score` and `metadata` are
optional. REST prefetch requires `filePath` and may include `symbols`, `chains`,
`maxResults`, `minImportance`, or `entries`.

## Failure Policy

- Session creation fails: continue with stateless th0th search.
- Priming or access fails: use verified REST exactly once after recording the MCP failure mode; if REST fails or is unavailable, continue without priming/access.
- Search rejects `sessionId`: retry once without it and report the divergence.
- REST unavailable or unauthorized: stay MCP-only and let TTL expire.
- Session expires or disappears after server restart: create a new session; do
  not reuse the old ID. Synapse state is ephemeral and process-local.
- Never reset or reindex a project to repair a Synapse-only failure.

## Completion

Close the REST session when the endpoint is available and cleanup is cheap.
Otherwise rely on the explicit TTL. Report Synapse failures only when they
changed retrieval confidence, skipped expected behavior, or exposed a contract
regression.
