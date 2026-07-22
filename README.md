# massa-th0th

massa-th0th is a local-first MCP server that indexes your codebase — semantic search, keyword search, and a symbol graph ranked by dependency centrality — and keeps a persistent, cross-session memory of decisions, patterns, and critical facts.

Instead of loading whole files into context, your assistant retrieves just the relevant symbols, references, and memories, so it reads less, forgets nothing between sessions, and costs less to run. It runs on Ollama (free, offline), with optional LLM consolidation, rerank, and query understanding, and plugs into Claude Code, Codex, and Cursor via MCP plus passive-capture hooks.

---

## Quick Start

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-th0th/main/install.sh | bash
```

Installs interactively. Three modes:

| Mode | Requires | Best for |
|------|----------|----------|
| **Docker** (default) | Docker | Production, quick start (PostgreSQL via Docker/colima, ~5GB RAM) |
| **Docker build** | Docker + Git | Custom builds, local changes (PostgreSQL via Docker/colima, ~5GB RAM) |
| **Source** | Git + Bun | Development (Native PostgreSQL ~100MB or Docker PostgreSQL) |

> ⚠️ **Docker modes run PostgreSQL through Docker/colima and reserve ~5GB RAM.**
> For native PostgreSQL (~100MB, no Docker), use **Source mode** (`./scripts/setup-local-first.sh`)
> and pick **Native PostgreSQL** at the database prompt.

Non-interactive (CI/scripted):

```bash
# Docker mode, custom port, skip start
MASSA_TH0TH_MODE=docker MASSA_TH0TH_API_PORT=4000 MASSA_TH0TH_NO_START=1 \
  curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-th0th/main/install.sh | bash
```

### Manual setup (from source)

```bash
# 1. Clone and install
git clone https://github.com/luizgmassa/massa-th0th.git
cd massa-th0th
bun install

# 2. Setup (100% offline with Ollama)
./scripts/setup-local-first.sh
# - Installs/starts Ollama
# - Pulls qwen3-embedding:8b (embeddings, 4096 dims), qwen2.5:7b-instruct (default LLM),
#   and qwen2.5-coder:7b (code-oriented LLM sites)
# - Creates .env with defaults
# - Runs bun run diagnose to validate the stack

# 3. Build and start
bun run build
bun run start:api
```

Verify: `curl http://localhost:3333/health`

#### Native PostgreSQL (macOS, recommended over Docker)

Instead of Docker (~5GB RAM), run PostgreSQL natively (~100MB):

```bash
# setup-local-first.sh option 1 does this automatically, or run standalone:
./scripts/setup-native-postgres.sh      # brew install postgresql@17 + pgvector, create role/db, migrate

# .env then contains:
#   DATABASE_URL=postgresql://massa_th0th:massa_th0th_password@localhost:5432/massa_th0th
```

Linux/WSL: install `postgresql` + `postgresql-*-pgvector` from your distro, create the role/db/extension, then set `DATABASE_URL`. Or use Docker (option 3, ~5GB RAM).

> **Tip:** Run `bun run diagnose` at any time to validate Ollama connectivity,
> database access, embedding generation, and migration status.

---

## Integration

### OpenCode (recommended)

File: `~/.config/opencode/opencode.json`

**Via MCP package:**

```json
{
  "mcp": {
    "massa-th0th": {
      "type": "local",
      "command": [
        "bunx",
        "@massa-th0th/mcp-client"
      ],
      "environment": {
        "MASSA_TH0TH_API_URL": "http://localhost:3333"
      },
      "enabled": true
    }
  }
}
```

**Via Plugin:**

```json
{
  "plugin": ["@massa-th0th/opencode-plugin"]
}
```

**From source (development):**

```json
{
  "mcpServers": {
    "massa-th0th": {
      "type": "local",
      "command": ["bun", "run", "/path/to/massa-th0th/apps/mcp-client/src/index.ts"],
      "enabled": true
    }
  }
}
```

### VSCode / Antigravity

Create `.vscode/mcp.json` in your workspace:

```json
{
  "servers": {
    "massa-th0th": {
      "command": "bunx",
        "args": ["@massa-th0th/mcp-client"],
      "env": {
        "MASSA_TH0TH_API_URL": "http://localhost:3333"
      }
    }
  }
}
```

Or run `./scripts/setup-vscode.sh` for automatic configuration.

### Claude Code (passive-capture hooks)

Wire Claude Code lifecycle hooks into massa-th0th so every session/prompt/tool-use is
captured as an Observation and later consolidated into memories. See
[§Passive Capture (Claude Code hooks)](#passive-capture-claude-code-hooks) for
the install block and env vars.

### Docker

```json
{
  "mcpServers": {
    "massa-th0th": {
      "type": "local",
      "command": ["docker", "compose", "run", "--rm", "-i", "mcp"],
      "enabled": true
    }
  }
}
```

---

## Step-by-step: the memory lifecycle

```
bootstrap → capture → recall/search → handoff → proposals → checkpoint
```

### 1. Bootstrap a project

Seed initial context (git log, README, docs, top central files) so an agent
starts with usable memories instead of a cold start. Idempotent — re-running is
a no-op unless `force: true`. Degrades silently to rule-based seeds when the LLM
is off.

```bash
# MCP
bootstrap { projectId: "my-app", projectPath: "/abs/path" }
# REST
curl -X POST http://localhost:3333/api/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"projectId":"my-app","projectPath":"/abs/path"}'
```

### 2. Enable passive capture

Install the Claude Code hooks (see
[§Passive Capture](#passive-capture-claude-code-hooks)) so observations are
streamed to `/api/v1/hook`. Non-Claude hosts use `hook_ingest` or
`POST /api/v1/hook/batch`.

```bash
# Observations persist in PostgreSQL and are consolidated into memories only
# when RLM_LLM_ENABLED=true (else stored raw, bridge skips silently).
```

### 3. Work — recall and search

```bash
# Semantic memory search
recall { query: "how does auth work", projectId: "my-app" }
# Code search (enriched = full content + imports + parent symbol in one call)
search { query: "token validation", projectId: "my-app", responseMode: "enriched" }
```

Quality knobs (default **OFF**, opt-in via env): `queryUnderstanding`
(LLM rewrite + HyDE) and `rerank` (LLM-judge). See
[§Search Quality Tuning](#search-quality-tuning).

### 4. Hand off to the next session

Session A leaves a structured record; session B discovers and accepts it.

```bash
# Session A — leave the handoff
handoff_begin {
  projectId: "my-app",
  summary: "Auth refactor in progress; token rotation unfinished",
  nextSteps: ["finish rotateToken in auth.ts", "add tests"],
  files: ["src/auth.ts", "src/token.ts"]
}
# Session B — discover and accept
handoff_list_pending { projectId: "my-app" }
handoff_accept { id: "<handoff-id>" }
```

### 5. Review auto-improvement proposals

The auto-improve loop detects recurring patterns (repeated queries, hot files,
common fixes) and generates memory-edit proposals. With
`AUTO_IMPROVE_REVIEW_GATE=false` (the default) proposals are auto-approved; set
it `true` to surface them for review.

```bash
list_proposals   { projectId: "my-app" }
approve_proposal { id: "<proposal-id>" }
reject_proposal  { id: "<proposal-id>", reason: "stale" }
```

### 6. Snapshot and restore

Save task progress (status, steps, file changes, decisions, next action) and
resume later — across a restart, a context compaction, or a new agent.

```bash
create_checkpoint {
  taskId: "auth-refactor",
  description: "Token rotation mid-flight",
  progressPercent: 60,
  nextAction: "finish rotateToken in src/auth.ts"
}
list_checkpoints   { taskId: "auth-refactor" }
restore_checkpoint { checkpointId: "<cp-id>" }
```

---

## Available Tools

47 tools total. Grouped below; each row lists **Req:** required and
**Opt:** optional params.

The current roster fits in one MCP `tools/list` page. Future registries over
100 tools require clients to follow `nextCursor` until it is absent.

### Indexing & Search

| Tool | Description |
|------|-------------|
| `index` | Index a project directory with semantic embeddings |
| `index_status` | Poll background indexing job progress |
| `search` | Hybrid semantic + keyword search with RRF ranking. Supports `responseMode=enriched` for full content + imports + parentSymbol in one call |
| `reindex` | Force full reindex after a large refactor |
| `reset_project` | Delete all indexed data for a project (vectors, symbols, memories) |
| `list_projects` | List all indexed projects with status and file counts |
| `project_map` | One-shot architecture summary: stats, top files by PageRank, symbol distribution, packages, entry points, routes, hotspots, and Louvain file-import communities |
| `fetch_and_index` | Fetch URL(s) → HTML→markdown / JSON key-path → index (SSRF-guarded, TTL-cached). **Req:** `url` (or `requests`[]). **Opt:** `source`, `concurrency`, `force`, `ttl` |

### Symbol Graph

| Tool | Description |
|------|-------------|
| `search_definitions` | Find function/class/type definitions by name |
| `get_references` | Find all usages of a symbol across the project |
| `go_to_definition` | Jump to definition with file + line context |
| `symbol_snippet` | Get raw code snippet by file + line range |
| `read_file` | Read a file with symbol metadata and imports. A relative `filePath` requires a `projectId` (resolves vs the workspace) or an absolute path |
| `trace_path` | Trace a call / data-flow / cross-service path from a symbol over typed edges (BFS, depth-capped, cycle-guarded). **Req:** `function_name` (or `qualifiedName`), `project`. **Opt:** `direction`∈{outbound,inbound,both}, `mode`∈{calls,data_flow,cross_service,all}, `depth`, `include_tests`, `edge_types`[] |
| `impact_analysis` | Git-diff → impacted symbols via reverse import/reference traversal, ranked by centrality risk. **Req:** `project`. **Opt:** `scope`∈{unstaged,staged,committed}, `base_branch`, `since`, `depth`, `paths`[] |

### Code Execution (Sandbox)

Polyglot sandbox for "think in code" — run analysis in a detected runtime instead of loading raw data into context.

> **Trust model: local-dev only.** `execute`/`execute_file`/`batch_execute` run user-supplied code on the host as the current user. Containment is best-effort (timeout + process-group kill, env-denylist, project-boundary + deny-glob + symlink-realpath guard). This is **not** OS-level isolation — do not expose the Tools API to untrusted/multi-tenant clients without an outer container/VM.

| Tool | Description |
|------|-------------|
| `execute` | Run code in a detected runtime (node/bun/deno/python/ruby/go/rust/php/perl/r/shell). **Req:** `language`, `code`. **Opt:** `timeout`, `background`, `cwd`, `intent` (large output auto-indexes + returns only matching sections) |
| `execute_file` | Read a file into a sandboxed var and run code over it (project-boundary + deny-glob + symlink guarded). **Req:** `path`, `language`, `code`. **Opt:** `timeout`, `intent` |
| `batch_execute` | Run N shell commands in parallel (order-preserved, concurrency-capped at 256). **Req:** `commands`[]. **Opt:** `queries`, `timeout`, `concurrency`, `cwd`, `query_scope` |

### Memory & Lifecycle

| Tool | Purpose |
|------|---------|
| `remember` | Store information in persistent memory. **Req:** `content`. **Opt:** `type`, `importance`(0-1), `projectId`, `sessionId`, `agentId`, `tags`[], `format` |
| `recall` | Semantic search over stored memories. **Req:** `query`. **Opt:** `userId`, `projectId`, `sessionId`, `agentId`, `types`[], `limit`, `minImportance`, `format` |
| `memory_list` | Browse memories by type/importance (audit mode). **Opt:** `projectId`, `type`, `minImportance`, `limit`, `offset`, `format` |
| `memory_update` | Update a memory by id; re-embeds on content change. **Req:** `id`. **Opt:** `content`, `importance`(0-1), `tags`[], `mergeTags`(bool, default false), `format` |
| `memory_delete` | Hard-delete a memory by id; severs its graph edges. **Req:** `id`. **Opt:** `format` |
| `optimized_context` | Search + compress in one call (max token efficiency) |
| `analytics` | Usage patterns, cache performance, metrics |
| `compress` | Compress context (keeps structure, removes detail) |
| `compact_snapshot` | Build a bounded (<2KB) reference-based session compaction snapshot — a table of contents of lifecycle events with runnable `recall`/`search` calls (zero-loss across `/compact`). **Req:** `sessionId`. **Opt:** `projectId`, `persist` |

### Synapse (Cognitive Layer)

Synapse is an optional post-retrieval modulation layer that improves result quality over a session by tracking task context, agent affinity, and working-memory. Enable by creating a session and passing `sessionId` to `search`.

| Tool | Description |
|------|-------------|
| `synapse_session` | Create a cognitive session scoped to a task |
| `synapse_get` | Inspect session state |
| `synapse_update` | Replace session task context |
| `synapse_end` | End a session |
| `synapse_prime` | Seed working-memory buffer with recalled memories |
| `synapse_access` | Record file access to boost that file in future searches |
| `synapse_prefetch` | Plan prefetch and optionally prime matching entries |
| `synapse_list` | List the active session count |

### Passive Capture

| Tool | Purpose |
|------|---------|
| `hook_ingest` | Passively ingest a batch of lifecycle events as Observations (fire-and-forget; consolidated later by the LLM bridge). **Req:** `events`[]. Each event **Req:** `event`∈{`session-start`,`user-prompt`,`pre-tool-use`,`post-tool-use`,`pre-compact`,`session-end`}, `projectId`, `payload`. **Opt:** `sessionId`, `importance`(0-1), `agentId`, `ts` |

### Project Bootstrap

| Tool | Purpose |
|------|---------|
| `bootstrap` | Scan a project (git log, README, docs, top central files) and create seed memories. Idempotent; LLM-off degrades silently to rule-based. **Req:** `projectId`. **Opt:** `projectPath`, `force`(default false) |

### Cross-session Handoffs

| Tool | Purpose |
|------|---------|
| `handoff_begin` | Begin a cross-session handoff (summary, open questions, next steps, files). Dual-written as a searchable memory. **Req:** `projectId`. **Opt:** `sourceSessionId`, `targetAgent`, `summary`(max 1024), `openQuestions`[], `nextSteps`[], `files`[] |
| `handoff_accept` | Accept an open handoff by id (open→accepted). **Req:** `id`. **Opt:** `projectId` |
| `handoff_cancel` | Cancel (expire) an open handoff by id (open→expired). **Req:** `id`. **Opt:** `projectId` |
| `handoff_list_pending` | List open handoffs for a project, oldest-first. **Req:** `projectId`. **Opt:** `targetAgent` |

### Auto-improvement (Proposals)

| Tool | Purpose |
|------|---------|
| `list_proposals` | List pending auto-improvement proposals, newest-first. **Req:** `projectId` |
| `approve_proposal` | Approve a proposal by id; applies the memory edit. **Req:** `id`. **Opt:** `projectId`, `source`∈{`llm`,`rule-based`} |
| `reject_proposal` | Reject a proposal by id (no edit applied). **Req:** `id`. **Opt:** `projectId`, `reason` |

### Checkpoints

| Tool | Purpose |
|------|---------|
| `create_checkpoint` | Save task progress for later resumption. **Req:** `taskId`, `description`. **Opt:** `status`∈{`pending`,`in_progress`,`completed`,`failed`,`paused`}, `currentStep`, `progressPercent`, `totalSteps`, `completedSteps`, `checkpointType`∈{`manual`,`milestone`}, `agentId`, `projectId`, `memoryIds`[], `fileChanges`[], `decisions`[], `learnings`[], `nextAction`, `pendingValidations`[], `format` |
| `list_checkpoints` | List saved checkpoints. **Opt:** `taskId`, `projectId`, `checkpointType`∈{`auto`,`manual`,`milestone`}, `includeExpired`(default false), `limit`(default 10), `format` |
| `restore_checkpoint` | Restore a checkpoint and return its state + integrity checks. **Opt:** `checkpointId`, `taskId`(restore latest for task), `format` |

---

## Local-first LLM (Ollama)

All LLM-driven features run against a local Ollama instance and **default OFF**,
degrading silently to rule-based behavior when disabled. Everything still works
without an LLM — you just lose consolidation, polish, rerank, and query rewrite.

### Prerequisites

```bash
# Install Ollama (if missing)
curl -fsSL https://ollama.com/install.sh | sh

# Start the daemon
ollama serve

# Pull models
ollama pull qwen3-embedding:8b    # embeddings (4096 dims)
ollama pull qwen2.5:7b-instruct   # default LLM (consolidation, salience, handoff, query rewrite, HyDE)
ollama pull qwen2.5-coder:7b      # code-oriented LLM sites (bootstrap seed, reranker, code compression)
```

### Validate the stack

`bun run diagnose` (also auto-runs as `predev` / `predev:api` / `predev:mcp`)
checks Ollama connectivity, database access, embedding generation, and migration
status.

### Turn the LLM features on

```bash
# .env  — all LLM-gated features default OFF; flip one switch to enable them all
RLM_LLM_ENABLED=true
RLM_LLM_BASE_URL=http://localhost:11434/v1
RLM_LLM_API_KEY=ollama
RLM_LLM_MODEL=qwen2.5:7b-instruct        # default instruct model (NL-judgment sites)
RLM_LLM_CODE_MODEL=qwen2.5-coder:7b      # code-oriented sites (bootstrap seed, reranker, compress)
# RLM_LLM_DISABLE_THINK=true             # best-effort thinking-disable (default true; safety net)
```

With `RLM_LLM_ENABLED=true` you get: hook→memory consolidation, handoff-summary
polish, query understanding (rewrite + HyDE), LLM-judge rerank, and auto
importance scoring. Set it `false` (the default) and every one of those silently
falls back to its rule-based path.

> **Per-task model routing (new 2026-07-09):** the 11 LLM call sites split by
> task shape. The 8 NL-judgment sites (salience judge, consolidator,
> observation/auto-improve jobs, handoff summary, query rewrite, HyDE) use
> `RLM_LLM_MODEL`; the 3 code-oriented sites (bootstrap `SeedMemoriesSchema`,
> reranker, `code-compressor`) use `RLM_LLM_CODE_MODEL`. Routing is per-call via
> a `modelRole` option in `packages/core/src/services/memory/llm-client.ts`.
> Both default to **non-thinking instruct** models so structured-output calls
> return fast (~5 s) and reliably, instead of burning a 90 s wall-clock timeout
> on a thinking model (the prior default routed answers into the
> reasoning channel and silently degraded). Override either with the env vars
> above.

> **Embeddings note:** The config default embedding model is `nomic-embed-text:latest`
> (see `massa-th0th-config.ts`). `qwen3-embedding:8b` (4096d) gives stronger recall
> than `nomic-embed-text` or `bge-m3` but is slower — bulk indexing a large corpus
> takes minutes. Override via `OLLAMA_EMBEDDING_MODEL` or config `embedding.model`.
> Switch to `bge-m3` (1024d) for speed if its recall quality is sufficient.

---

## Passive Capture (Claude Code hooks)

Passive capture streams agent lifecycle events into massa-th0th as Observations,
so the agent's behaviour is recorded without any change to how you prompt.

- **Fire-and-forget:** each hook `curl`s the endpoint with a **2s timeout** and
  always `exit 0`. The agent is never blocked, even if the API is down or
  `curl` is missing.
- **No stdout:** scripts produce no output.
- **Empty stdin is a no-op:** if a hook fires with no payload, the script exits
  without posting (the API requires a non-empty payload object).

### What each of the 5 hooks captures

| Script | Lifecycle event | Observation `source` | What it records |
|--------|-----------------|----------------------|-----------------|
| `session-start.sh` | `SessionStart` | `session-start` | Session bootstrap (cwd, source, etc.) |
| `user-prompt-submit.sh` | `UserPromptSubmit` | `user-prompt` | Each submitted prompt |
| `post-tool-use.sh` | `PostToolUse` | `post-tool-use` | Every tool call + result |
| `stop.sh` | `Stop` | `session-end` | Session termination |
| `pre-compact.sh` | `PreCompact` | `pre-compact` | Pre-compaction snapshot — also triggers `POST /api/v1/hook/compact-snapshot` to build a bounded, reference-based table-of-contents of the session's observations (raw events stay in the store; zero loss) |

### Install

1. `chmod +x` the scripts under `apps/claude-plugin/hooks/` (already executable
   in this repo).
2. Add them to your project or user `.claude/settings.json` `hooks` block. The
   canonical, ready-to-merge template is
   [`apps/claude-plugin/settings.json.template`](apps/claude-plugin/settings.json.template)
   — it wires all 5 events. Replace `${CLAUDE_PLUGIN_ROOT}` with the absolute
   path to `apps/claude-plugin`, or use absolute paths to the scripts. The shape
   is the nested matcher-group + `hooks[]` form Claude Code expects:

```jsonc
{
  "hooks": {
    "SessionStart":     [{ "hooks": [{ "type": "command", "command": "\"/abs/path/to/apps/claude-plugin/hooks/session-start.sh\"" }] }],
    "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": "\"/abs/path/to/apps/claude-plugin/hooks/user-prompt-submit.sh\"" }] }],
    "PostToolUse":      [{ "hooks": [{ "type": "command", "command": "\"/abs/path/to/apps/claude-plugin/hooks/post-tool-use.sh\"" }] }],
    "Stop":             [{ "hooks": [{ "type": "command", "command": "\"/abs/path/to/apps/claude-plugin/hooks/stop.sh\"" }] }],
    "PreCompact":       [{ "hooks": [{ "type": "command", "command": "\"/abs/path/to/apps/claude-plugin/hooks/pre-compact.sh\"" }] }]
  }
}
```

3. Start the API: `bun run dev:api` (defaults to `http://localhost:3333`).
4. Run a Claude Code session — Observation rows appear in
   PostgreSQL and are consolidated into memories only when
   `RLM_LLM_ENABLED=true`; otherwise they're stored raw and the bridge silently
   skips.

### Other CLIs (Codex, Cursor)

Run `bash install.sh` and read the printed **Passive-capture hooks** guide — it
emits per-CLI config blocks (Codex `~/.codex/hooks.json`, Cursor
`~/.cursor/hooks.json`) with the same absolute script paths. Codex supports the
same 5 events as Claude Code (nested form). **Cursor limitations:** Cursor's
beta hooks schema only maps 3 events — `beforeSubmitPrompt`→`user-prompt-submit`,
`afterFileEdit`→`post-tool-use`, `stop`→`stop`; there is **no SessionStart and no
PreCompact equivalent** in Cursor.

### Env

| Variable | Default | Notes |
|----------|---------|-------|
| `MASSA_TH0TH_API_BASE` | `http://localhost:3333` | Tools API base URL |
| `MASSA_TH0TH_API_KEY` | _(none)_ | Optional auth key |
| `MASSA_TH0TH_PROJECT_ID` | cwd basename | Project the observations attach to |

### Non-Claude hosts

Use the MCP tool `hook_ingest`, or POST directly to
`/api/v1/hook/batch` with `{ events: [...] }` — useful for Docker deployments
where the repo (and hook scripts) aren't on the host filesystem.

---

## Web UI

Read-only browser for memories, search, handoffs, and checkpoints, served by
the Tools API.

- **URL:** `http://localhost:3333/ui`
- **Run:** `bun run dev:api` (the UI is served by the API — there is no separate
  UI dev script). See [§Scripts](#scripts).
- **Disable:** set `WEB_UI_ENABLED=false` (the `/ui` prefix then returns 404).

```bash
bun run dev:api
# then open http://localhost:3333/ui
```

> The `dev:ui` script was removed — `@massa-th0th/ui-client` (its target) did not
> exist. The web UI is served exclusively via `dev:api` at `/ui`.

---

## Search Quality Tuning

Environment variables for fine-tuning retrieval (all optional). LLM-gated
knobs (`SEARCH_QUERY_UNDERSTANDING_*`, `SEARCH_RERANK_*`) default **OFF** and
require `RLM_LLM_ENABLED=true`.

| Variable | Default | Description |
|----------|---------|-------------|
| `SEARCH_DISABLE_KEYWORD` | `false` | Pure vector-only mode (+44% MRR on NL→code) |
| `RRF_KEYWORD_BOOST` | `2.5` | Keyword weight multiplier for code queries |
| `RRF_VECTOR_WEIGHT` | `0.3` | Vector similarity weight in final score blend |
| `RRF_MAX_CHUNKS_PER_FILE` | `2` | Diversity cap — prevents one file monopolising results |
| `SEARCH_MIN_SCORE` | `0.3` | Score threshold below which results are dropped |
| `OLLAMA_EMBED_DELAY_MS` | `0` | Delay between Ollama embed calls (set >0 for CPU) |
| `SEARCH_QUERY_UNDERSTANDING_ENABLED` | `false` | LLM query rewrite + HyDE (**OFF** by default) |
| `SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED` | `true` | Gate the extra HyDE LLM call (only when understanding is on) |
| `SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS` | `300000` | Per-(query, projectId) rewrite cache TTL |
| `SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE` | `256` | Rewrite cache entry cap |
| `SEARCH_RERANK_ENABLED` | `false` | LLM-judge rerank of the top-K (**OFF** by default) |
| `SEARCH_RERANK_WINDOW` | `50` | Top-K re-scored by the LLM judge after centrality boost |
| `AUTOREINDEX_MAX_FILES` | `200` | Max files a latency-sensitive auto-reindex will sync before deferring |

---

## REST API

```bash
# Development
bun run dev:api

# Production
bun run start:api
```

Swagger docs: `http://localhost:3333/swagger` · Web UI: `http://localhost:3333/ui`

### Endpoints

```bash
# Index a project
curl -X POST http://localhost:3333/api/v1/project/index \
  -H "Content-Type: application/json" \
  -d '{"projectPath": "/home/user/my-project", "projectId": "my-project"}'

# Search
curl -X POST http://localhost:3333/api/v1/search/project \
  -H "Content-Type: application/json" \
  -d '{"query": "authentication", "projectId": "my-project"}'

# Store memory
curl -X POST http://localhost:3333/api/v1/memory/store \
  -H "Content-Type: application/json" \
  -d '{"content": "Important decision...", "type": "decision"}'

# Update a memory (re-embeds on content change)
curl -X POST http://localhost:3333/api/v1/memory/update \
  -H "Content-Type: application/json" \
  -d '{"id": "<memory-id>", "content": "Updated...", "mergeTags": true}'

# List memories — level filter: 1=Project, 2=User, 3=Session
curl -X POST http://localhost:3333/api/v1/memory/list \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project", "level": 1}'

# Compress context
curl -X POST http://localhost:3333/api/v1/context/compress \
  -H "Content-Type: application/json" \
  -d '{"content": "...", "strategy": "code_structure"}'

# Bootstrap a project (seed memories)
curl -X POST http://localhost:3333/api/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project", "projectPath": "/abs/path"}'

# Passive capture — batch lifecycle events
curl -X POST http://localhost:3333/api/v1/hook/batch \
  -H "Content-Type: application/json" \
  -d '{"events": [{"event": "user-prompt", "projectId": "my-project", "payload": {"prompt": "..."}}]}'

# Begin a cross-session handoff
curl -X POST http://localhost:3333/api/v1/handoff/begin \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project", "summary": "WIP", "nextSteps": ["..."]}'

# Create a checkpoint
curl -X POST http://localhost:3333/api/v1/checkpoints/create \
  -H "Content-Type: application/json" \
  -d '{"taskId": "auth-refactor", "description": "mid-flight"}'

# List auto-improvement proposals
curl -X POST http://localhost:3333/api/v1/proposal/list \
  -H "Content-Type: application/json" \
  -d '{"projectId": "my-project"}'
```

---

## Configuration

Config file: `~/.config/massa-th0th/config.json` (auto-created on first run).
The canonical annotated reference for every environment variable is
[`.env.example`](./.env.example) — mirror it into `.env` and edit there.

### Environment variables

Defaults below are verbatim from `packages/shared/src/config/index.ts`. LLM-gated
rows default **OFF** and degrade silently when disabled.

| Key | Env var | Default | State |
|-----|---------|---------|-------|
| `database.url` | `DATABASE_URL` | _(required)_ | PostgreSQL connection string (native or Docker) |
| `database.postgresPassword` | `POSTGRES_PASSWORD` | `massa_th0th_password` | Docker postgres container |
| `database.port` | `MASSA_TH0TH_POSTGRES_PORT` | `5432` | host port (Docker) |
| `database.backend` | `MASSA_TH0TH_DB_BACKEND` | _(interactive)_ | installer provisioning: `native`/`docker` |
| `llm.enabled` | `RLM_LLM_ENABLED` | `false` | **OFF** |
| `llm.baseUrl` | `RLM_LLM_BASE_URL` | `http://localhost:11434/v1` | — |
| `llm.apiKey` | `RLM_LLM_API_KEY` | `ollama` | — |
| `llm.model` | `RLM_LLM_MODEL` | `qwen2.5:7b-instruct` | default instruct model (NL-judgment sites) |
| `llm.codeModel` | `RLM_LLM_CODE_MODEL` | `qwen2.5-coder:7b` | code-oriented sites (bootstrap seed, reranker, compress) |
| `llm.disableThink` | `RLM_LLM_DISABLE_THINK` | `true` | best-effort thinking-disable (safety net for thinking models) |
| `llm.temperature` | `RLM_LLM_TEMPERATURE` | `0.2` | — |
| `llm.maxOutputTokens` | `RLM_LLM_MAX_OUTPUT_TOKENS` | `8000` | — |
| `llm.timeoutMs` | `RLM_LLM_TIMEOUT_MS` | `90000` | — |
| `memory.bootstrap.enabled` | `BOOTSTRAP_ENABLED` | `true` | on (rule-based) |
| `memory.bootstrap.maxSeedMemories` | `BOOTSTRAP_MAX_SEED_MEMORIES` | `8` | — |
| `memory.bootstrap.centralityLimit` | `BOOTSTRAP_CENTRALITY_LIMIT` | `10` | — |
| `memory.bootstrap.gitLogLimit` | `BOOTSTRAP_GIT_LOG_LIMIT` | `20` | — |
| `memory.bootstrap.refreshEnabled` | `BOOTSTRAP_REFRESH_ENABLED` | `true` | — |
| `memory.autoImprove.enabled` | `AUTO_IMPROVE_ENABLED` | `true` | on (rule-based) |
| `memory.autoImprove.reviewGate` | `AUTO_IMPROVE_REVIEW_GATE` | `false` | auto-approve |
| `memory.autoImprove.minObservations` | `AUTO_IMPROVE_MIN_OBS` | `8` | — |
| `memory.autoImprove.minIntervalMs` | `AUTO_IMPROVE_MIN_INTERVAL_MS` | `300000` | — |
| `memory.autoImprove.maxWindow` | `AUTO_IMPROVE_MAX_WINDOW` | `16` | — |
| `memory.autoImprove.minQueryHits` | `AUTO_IMPROVE_MIN_QUERY_HITS` | `3` | — |
| `memory.autoImprove.minFileHits` | `AUTO_IMPROVE_MIN_FILE_HITS` | `3` | — |
| `memory.autoImprove.minFixHits` | `AUTO_IMPROVE_MIN_FIX_HITS` | `2` | — |
| `memory.autoImportance.enabled` | `AUTO_IMPORTANCE_ENABLED` | `false` | **OFF** |
| `hooks.enabled` | `HOOKS_ENABLED` | `true` | on |
| `hooks.maxPayloadBytes` | `HOOKS_MAX_PAYLOAD_BYTES` | `65536` | — |
| `hooks.queue.maxPending` | `HOOKS_QUEUE_MAX_PENDING` | `256` | — |
| `hooks.bridge.enabled` | `HOOKS_BRIDGE_ENABLED` | `true` | on (LLM-gated) |
| `hooks.bridge.minObservations` | `HOOKS_BRIDGE_MIN_OBS` | `8` | — |
| `hooks.bridge.minIntervalMs` | `HOOKS_BRIDGE_MIN_INTERVAL_MS` | `300000` | — |
| `hooks.bridge.maxWindow` | `HOOKS_BRIDGE_MAX_WINDOW` | `8` | — |
| `handoffs.enabled` | `HANDOFFS_ENABLED` | `true` | on |
| `search.queryUnderstanding.enabled` | `SEARCH_QUERY_UNDERSTANDING_ENABLED` | `false` | **OFF** |
| `search.queryUnderstanding.hydeEnabled` | `SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED` | `true` | — |
| `search.queryUnderstanding.cacheTtlMs` | `SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS` | `300000` | — |
| `search.queryUnderstanding.cacheMaxSize` | `SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE` | `256` | — |
| `search.rerank.enabled` | `SEARCH_RERANK_ENABLED` | `false` | **OFF** |
| `search.rerank.rerankWindow` | `SEARCH_RERANK_WINDOW` | `50` | — |
| `search.autoReindexMaxFiles` | `AUTOREINDEX_MAX_FILES` | `200` | — |
| — | `WEB_UI_ENABLED` | `true` | on |

> **Note:** `compression.llm` was removed in commit `da4c60f`. LLM connection
> fields now live exclusively in the top-level `llm` config block.

### Operational knobs

These are not part of the typed config object — they are read directly from the
process environment at boot, so they do not appear in `~/.config/massa-th0th/config.json`.
They are documented here (not in `.env.example`) because they are operational
guards for dedicated/verify stacks and the in-process background workers, not
user-tunable settings for a normal shared-stack deployment. Set them in the
shell environment or the dedicated stack's `.env`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `MASSA_TH0TH_DEDICATED` | _(unset)_ | When `1`, the dedicated-stack DB guard (`packages/shared/src/config/db-guard.ts`) refuses to bind the shared `massa_th0th` database — a process that expects an isolated, disposable DB fails fast at startup instead of silently corrupting the shared stack. No-op when unset. |
| `MASSA_TH0TH_JOB_STALE_MS` | `300000` (5 min) | A background index job whose heartbeat hasn't been refreshed within this window is flipped to `failed` by the in-process reaper. Healthy indexes emit progress far more often than this. `0`/negative/garbage are floored to the default (a 0 ms window would fail everything instantly). |
| `MASSA_TH0TH_JOB_REAPER_INTERVAL_MS` | `60000` (60 s) | How often the stale-job reaper sweeps. Floored to the default on `0`/negative/garbage (a 0 ms interval would be a tight loop). |
| `MASSA_TH0TH_PROXY_TIMEOUT_MS` | `120000` (120 s) | Per-call timeout for the MCP client proxying a tool call to the Tools API. Covers long-running tools (e.g. `bootstrap`'s ~90 s LLM-seed path). `0` disables the timeout (infinite wait). |
| `MASSA_TH0TH_SCHEDULER_ENABLED` | `false` | Master switch for the in-process cron-like scheduler (`packages/core/src/services/scheduler`). When `false` the scheduler never starts and no periodic jobs (consolidation, decay-sweep, auto-improve, observation-bridge) fire. Set `true` to opt in; individual job kinds still need their own enable flags. |

### Quick Config Commands

```bash
# Show current configuration
npx @massa-th0th/mcp-client --config-show

# Show config file path
npx @massa-th0th/mcp-client --config-path

# Show config directory
npx @massa-th0th/mcp-client --config-dir

# Initialize configuration
npx @massa-th0th/mcp-client --config-init

# Show help
npx @massa-th0th/mcp-client --help
```

### Embedding Providers

| Provider | Model | Cost | Quality |
|----------|-------|------|---------|
| **Ollama** (default) | qwen3-embedding:8b (also bge-m3) | Free | Good-Excellent |
| **Mistral** | mistral-embed, codestral-embed | $$ | Great |
| **OpenAI** | text-embedding-3-small | $$ | Great |

### Advanced Configuration

For detailed configuration management, use the config CLI:

```bash
# Initialize with specific provider
npx @massa-th0th/mcp-client --config-init                          # Ollama (default)
npx @massa-th0th/mcp-client --config-init --mistral your-api-key   # Mistral
npx @massa-th0th/mcp-client --config-init --openai your-api-key    # OpenAI

# Switch provider
npx @massa-th0th/mcp-client --config-init --mistral your-api-key
npx @massa-th0th/mcp-client --config-init --ollama-model qwen3-embedding

# Set specific configuration values
npx @massa-th0th/mcp-client --config-set embedding.dimensions 4096
```

---

## Scripts

| Command | Description |
|---------|-------------|
| `bun run build` | Build all packages |
| `bun run dev` | Development (all apps) |
| `bun run dev:api` | REST API with hot reload (also serves the Web UI at `/ui`) |
| `bun run dev:mcp` | MCP server with watch |
| `bun run start:api` | Start REST API |
| `bun run start:mcp` | Start MCP server |
| `bun run test` | Run tests |
| `bun run lint` | Lint code |
| `bun run type-check` | Type checking |
| `bun run diagnose` | Validate full stack (Ollama, database, embeddings) |
| `bun run bench:fixture` | Run the massa-th0th retrieval fixture benchmark |

> **`dev:ui` was removed.** Its target (`@massa-th0th/ui-client`) did not exist.
> The Web UI is served by the Tools API at `http://localhost:3333/ui` — run it
> with `bun run dev:api`.

---

## Architecture

```
massa-th0th/
├── apps/
│   ├── mcp-client/           # MCP Server (stdio) — 47 tools
│   ├── tools-api/            # REST API (port 3333) + Web UI at /ui
│   ├── web-ui/               # Read-only memory/search/handoff/checkpoint browser
│   ├── claude-plugin/        # Passive-capture hook scripts + install guide
│   └── opencode-plugin/      # OpenCode plugin
├── packages/
│   ├── core/                 # Business logic, search, embeddings, compression
│   └── shared/               # Shared types, config loader, utilities
└── scripts/
```

| Component | Description |
|-----------|-------------|
| **Semantic Search** | Hybrid vector + keyword with RRF ranking, `enriched` response mode |
| **Synapse** | Post-retrieval cognitive modulation: task alignment, agent affinity, working-memory buffer |
| **Symbol Graph** | PageRank-based centrality, definitions, references, go-to-definition |
| **Embeddings** | Ollama (local) or Mistral/OpenAI API |
| **Compression** | Rule-based code structure extraction (70-98% reduction) |
| **Memory** | Persistent PostgreSQL/pgvector storage across sessions |
| **Cache** | Multi-level L1/L2 with TTL |
| **Passive Capture** | Fire-and-forget Claude Code hooks → Observations → LLM bridge → memories |
| **Bootstrap** | Repo scan (git log/README/docs/centrality) → idempotent seed memories |
| **Handoffs** | Cross-session structured records (summary/next-steps/files), dual-written as searchable memories |
| **Auto-improvement** | Rule-based pattern detection → proposals (auto-approve or review-gated) |
| **Web UI** | Read-only browser served by the Tools API at `/ui` |

---

## Structural indexing (polyglot native Tree-sitter)

massa-th0th indexes code with **pinned native Tree-sitter grammars** across all
33 canonical source extensions, producing a versioned symbol/edge graph ranked by
dependency centrality. This supersedes the earlier best-effort typed-edge pass.
The native runtime is correct and verified; no WASM or runtime/post-install
download is used.

**Native target:** macOS arm64 and Linux glibc x64. Application runtime is **Bun `1.3.14`**;
**Node `25.9.0`** (npm `11.14.1`) is a build-only `node-gyp` helper, not the
application runtime. `tree-sitter@0.25.0` carries a repository patch
(SHA-256 `e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d`:
C++20 `binding.gyp` + install-guard) for deterministic lifetime/disposal safety
and clean consumer installs. On macOS arm64 the addon is a Mach-O arm64 bundle
linked to system `libc++`/`libSystem`; on Linux glibc x64 it is an ELF x86-64
shared object linked to system glibc/libstdc++ (verified via `readelf -d`
NEEDED entries). There is no musl, Alpine, Windows, or other non-darwin-arm64 /
non-linux-x64 native target; those code paths are intentionally untouched.

### Supported languages and capability tiers

The frozen manifest (`packages/core/src/services/structural/language-manifest.ts`,
mirroring `DEFAULT_ALLOWED_EXTENSIONS`) declares 33 extensions across TS/JS, web
host (Vue/HTML), data (JSON/YAML/Markdown), systems (C/C++/Go/Rust/Zig),
scripting (Python/Ruby/PHP/Lua), managed/mobile (Java/Kotlin/Scala/C#/Swift/Dart),
and functional/BEAM (Elixir/Erlang/Clojure/OCaml/Haskell). Each language declares
capability tiers — declarations/documentation, imports/modules, type relations,
calls, data flow, HTTP, and events — and a pack emits only its declared tiers
(no invented placeholders for unsupported capabilities). See
`.specs/features/multi-language-tree-sitter-breadth/capability-matrix.md` for the
per-extension tier matrix and exact grammar artifacts.

### Readiness vs. liveness

Parser **readiness** is separate from process **liveness**. `/health` reports the
API alive regardless of parser state. On startup, `validateAllGrammars` loads all
33 manifest entries in one cached flight; indexing is rejected (before any job is
created) until readiness reaches `ready`. A missing or ABI-incompatible grammar
leaves liveness up but keeps readiness `failed`, so a broken native install can
never silently produce an empty/partial graph.

### Graph schema v2 and rebuild visibility

Symbol, reference, import, centrality, and diagnostic rows are scoped by
**generation**. A pending generation is built beside the active one under a DB
lease, with an immutable snapshot and expected-active CAS; a terminal job always
names an activated generation. A required-file failure is a hard failure that
blocks activation; an incremental hard failure retains the last-known-good active
generation and surfaces stale diagnostics. Pending data is invisible to graph
reads until activation, so an in-flight rebuild never corrupts the visible graph.

### Diagnostics

Exact recovered and hard/stale diagnostic **totals** are preserved separately
from bounded detail: at most **10** detail spans per file are exposed, while the
exact counts survive persistence. Durable per-job and per-project summaries come
from the activated generation.

### Versioned symbol identities (FQNs)

Every symbol gets a **modern full-SHA-256 identity** plus a stable **legacy
alias**, with explicit **ambiguity payloads** where multiple symbols share a
legacy name (one codec owns all three):

- Legacy alias: `path/to/file.ts#myFunction`
- Modern identity: `path/to/file.ts#MyClass.myMethod~method~<sha256>`
- Ambiguity: when the legacy alias is non-unique, resolution returns the ordered
  candidate list instead of first-match.

There are 18 canonical symbol kinds and 9 edge kinds. No graph consumer uses
verbatim or first-match FQN behavior.

### Embedded parsing

Vue and Markdown host two-level embedded child parsing: a Vue SFC is parsed via
its HTML host grammar with TS/JS child grammars for `<script>`/`<template>`
blocks; Markdown headings/fences and JSON/YAML qualified keys are extracted with
stable scope FQNs, host-byte remapping, and dedupe.

### Examples

The structural runtime exposes a stable, generation-scoped API. Approximate
shapes (see `packages/core/src/services/structural/` for the full contract):

```ts
// Readiness must pass before indexing; status ∈ pending|validating|ready|failed
interface ParserReadinessSnapshot {
  status: "pending" | "validating" | "ready" | "failed";
  requiredExtensions: number;   // 33
  validatedExtensions: number;
  errors: readonly { code: string; message: string }[];
}

// One bounded lease per parse; cursors deleted before trees even on failure
class StructuralRuntime {
  async parse(request: {
    extension: string;           // e.g. ".ts"
    source: Buffer;
    headerEvidence?: HeaderLanguageEvidence;
  }): Promise<StructuralParseOutcome>;
}

// Modern identity carries the legacy alias; ambiguous legacy names resolve to a list
interface StructuralIdentity {
  fqn: string;          // modern:  file#qualifiedName~kind~<sha256>
  legacyFqn: string;    // legacy:  file#name
  aliases: readonly string[];
  kind: string;
  signatureHash: string;
}
```

### Verification (macOS arm64 + Linux glibc x64)

The native toolchain is gated by deterministic verifiers, not hand-checked claims:

| Command | Checks |
|---------|--------|
| `bun run verify:tree-sitter-native` | Source + dist + packed-package: 33+33 parses, 27 native modules, 10 lifetime sensors, RSS < 16 MiB median delta, Mach-O arm64 (macOS) / ELF x86-64 (Linux) linkage, missing/ABI-incompatible negative sensors |
| `bun run verify:tree-sitter-source-dist` | Source/dist grammar load + parse |
| `bun run verify:tree-sitter-package` | Packed `npm` tarball bundles the nested patched runtime + generated addon (arm64 on macOS, x86-64 on Linux) |
| `bun run type-check` / `bun run build` | Workspace type-check (6/6) and build (5/5) |
| `bun run bench:parser -- --baseline 5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03` | Frozen parser benchmark vs. the regex baseline |
| `.github/workflows/ci.yml` (structural-native) | macOS arm64 CI: Bun `1.3.14`, Node `22` LTS build helper, frozen install, build, native-structural unit tests |
| `.github/workflows/ci.yml` (structural-native-linux) | Linux glibc x64 CI: Bun `1.3.14`, Node `25.9.0` build helper, frozen install, build, `verify:tree-sitter-native`, native-structural unit tests, provenance upload |

### Performance status (honest)

Native structural indexing is **correct and verified**, but the frozen parser
benchmark (TASK-025) has not yet reached parity with the regex baseline. A 2.2×
indexer optimization is committed (`490f302`), and the 16 MiB explicit-disposal
native-retention stress passes — but the MLTS-014 throughput (≤25%) and RSS
(≤50%) thresholds vs. the `5d43a96` regex baseline are **not yet met**. This is a
known, tracked limitation (TASK-025 BLOCKED ON PERF): a full-AST structural
indexer produces per-symbol rich extraction (signatures, spans, FQNs) that the
regex baseline does not, so like-for-like throughput parity is assessed as
unlikely. Do not assume native parity with the legacy regex pass.

---

## License

MIT
