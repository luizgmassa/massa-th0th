<img src="https://i.imgur.com/WP7ivBc.png" alt="th0th" style="visibility: visible; max-width: 60%; display: block; margin: 0 auto;" />

# th0th

**Ancient knowledge keeper for modern code**

Semantic search with 98% token reduction for AI assistants.

Como reduzi 98% do uso de contexto (e custos) de IA no meu workflow / How I reduced AI context usage (and costs) by 98% in my workflow
https://www.tabnews.com.br/S1LV4/como-reduzi-em-98-por-cento-o-uso-de-contexto-e-os-custos-de-ia-no-meu-workflow

---

## Quick Start

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/S1LV4/th0th/main/install.sh | bash
```

Installs interactively. Three modes:

| Mode | Requires | Best for |
|------|----------|----------|
| **Docker** (default) | Docker | Production, quick start |
| **Docker build** | Docker + Git | Custom builds, local changes |
| **Source** | Git + Bun | Development, contributors |

Non-interactive (CI/scripted):

```bash
# Docker mode, custom port, skip start
TH0TH_MODE=docker TH0TH_API_PORT=4000 TH0TH_NO_START=1 \
  curl -fsSL https://raw.githubusercontent.com/S1LV4/th0th/main/install.sh | bash
```

### Manual setup (from source)

```bash
# 1. Clone and install
git clone https://github.com/S1LV4/th0th.git
cd th0th
bun install

# 2. Setup (100% offline with Ollama)
./scripts/setup-local-first.sh
# - Installs/starts Ollama
# - Pulls bge-m3 embedding model (1024 dimensions)
# - Creates .env with defaults
# - Runs bun run diagnose to validate the stack

# 3. Build and start
bun run build
bun run start:api
```

Verify: `curl http://localhost:3333/health`

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
    "th0th": {
      "type": "local",
      "command": [
        "bunx",
        "@th0th-ai/mcp-client"
      ],
      "environment": {
        "TH0TH_API_URL": "http://localhost:3333"
      },
      "enabled": true
    }
  }
}
```

**Via Plugin:**

```json
{
  "plugin": ["@th0th-ai/opencode-plugin"]
}
```

**From source (development):**

```json
{
  "mcpServers": {
    "th0th": {
      "type": "local",
      "command": ["bun", "run", "/path/to/th0th/apps/mcp-client/src/index.ts"],
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
    "th0th": {
      "command": "bunx",
        "args": ["@th0th-ai/mcp-client"],
      "env": {
        "TH0TH_API_URL": "http://localhost:3333"
      }
    }
  }
}
```

Or run `./scripts/setup-vscode.sh` for automatic configuration.

### Claude Code (passive-capture hooks)

Wire Claude Code lifecycle hooks into th0th so every session/prompt/tool-use is
captured as an Observation and later consolidated into memories. See
[§Passive Capture (Claude Code hooks)](#passive-capture-claude-code-hooks) for
the install block and env vars.

### Docker

```json
{
  "mcpServers": {
    "th0th": {
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
th0th_bootstrap { projectId: "my-app", projectPath: "/abs/path" }
# REST
curl -X POST http://localhost:3333/api/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"projectId":"my-app","projectPath":"/abs/path"}'
```

### 2. Enable passive capture

Install the Claude Code hooks (see
[§Passive Capture](#passive-capture-claude-code-hooks)) so observations are
streamed to `/api/v1/hook`. Non-Claude hosts use `th0th_hook_ingest` or
`POST /api/v1/hook/batch`.

```bash
# Observations land in ~/.rlm/observations.db; consolidated to memories
# only when RLM_LLM_ENABLED=true (else stored raw, bridge skips silently).
```

### 3. Work — recall and search

```bash
# Semantic memory search
th0th_recall { query: "how does auth work", projectId: "my-app" }
# Code search (enriched = full content + imports + parent symbol in one call)
th0th_search { query: "token validation", projectId: "my-app", responseMode: "enriched" }
```

Quality knobs (default **OFF**, opt-in via env): `queryUnderstanding`
(LLM rewrite + HyDE) and `rerank` (LLM-judge). See
[§Search Quality Tuning](#search-quality-tuning).

### 4. Hand off to the next session

Session A leaves a structured record; session B discovers and accepts it.

```bash
# Session A — leave the handoff
th0th_handoff_begin {
  projectId: "my-app",
  summary: "Auth refactor in progress; token rotation unfinished",
  nextSteps: ["finish rotateToken in auth.ts", "add tests"],
  files: ["src/auth.ts", "src/token.ts"]
}
# Session B — discover and accept
th0th_handoff_list_pending { projectId: "my-app" }
th0th_handoff_accept { id: "<handoff-id>" }
```

### 5. Review auto-improvement proposals

The auto-improve loop detects recurring patterns (repeated queries, hot files,
common fixes) and generates memory-edit proposals. With
`AUTO_IMPROVE_REVIEW_GATE=false` (the default) proposals are auto-approved; set
it `true` to surface them for review.

```bash
th0th_list_proposals   { projectId: "my-app" }
th0th_approve_proposal { id: "<proposal-id>" }
th0th_reject_proposal  { id: "<proposal-id>", reason: "stale" }
```

### 6. Snapshot and restore

Save task progress (status, steps, file changes, decisions, next action) and
resume later — across a restart, a context compaction, or a new agent.

```bash
th0th_create_checkpoint {
  taskId: "auth-refactor",
  description: "Token rotation mid-flight",
  progressPercent: 60,
  nextAction: "finish rotateToken in src/auth.ts"
}
th0th_list_checkpoints   { taskId: "auth-refactor" }
th0th_restore_checkpoint { checkpointId: "<cp-id>" }
```

---

## Available Tools

35 tools total. Grouped below; each row lists **Req:** required and
**Opt:** optional params.

### Indexing & Search

| Tool | Description |
|------|-------------|
| `th0th_index` | Index a project directory with semantic embeddings |
| `th0th_index_status` | Poll background indexing job progress |
| `th0th_search` | Hybrid semantic + keyword search with RRF ranking. Supports `responseMode=enriched` for full content + imports + parentSymbol in one call |
| `th0th_reindex` | Force full reindex after a large refactor |
| `th0th_reset_project` | Delete all indexed data for a project (vectors, symbols, memories) |
| `th0th_list_projects` | List all indexed projects with status and file counts |
| `th0th_project_map` | One-shot project summary: stats, top files by PageRank, symbol distribution |

### Symbol Graph

| Tool | Description |
|------|-------------|
| `th0th_search_definitions` | Find function/class/type definitions by name |
| `th0th_get_references` | Find all usages of a symbol across the project |
| `th0th_go_to_definition` | Jump to definition with file + line context |
| `th0th_symbol_snippet` | Get raw code snippet by file + line range |
| `th0th_read_file` | Read a file with symbol metadata and imports |

### Memory & Lifecycle

| Tool | Purpose |
|------|---------|
| `th0th_remember` | Store information in persistent memory. **Req:** `content`. **Opt:** `type`, `importance`(0-1), `projectId`, `sessionId`, `agentId`, `tags`[], `format` |
| `th0th_recall` | Semantic search over stored memories. **Req:** `query`. **Opt:** `userId`, `projectId`, `sessionId`, `agentId`, `types`[], `limit`, `minImportance`, `format` |
| `th0th_memory_list` | Browse memories by type/importance (audit mode). **Opt:** `projectId`, `type`, `minImportance`, `limit`, `offset`, `format` |
| `th0th_memory_update` | Update a memory by id; re-embeds on content change. **Req:** `id`. **Opt:** `content`, `importance`(0-1), `tags`[], `mergeTags`(bool, default false), `format` |
| `th0th_memory_delete` | Hard-delete a memory by id; severs its graph edges. **Req:** `id`. **Opt:** `format` |
| `th0th_optimized_context` | Search + compress in one call (max token efficiency) |
| `th0th_analytics` | Usage patterns, cache performance, metrics |
| `th0th_compress` | Compress context (keeps structure, removes detail) |

### Synapse (Cognitive Layer)

Synapse is an optional post-retrieval modulation layer that improves result quality over a session by tracking task context, agent affinity, and working-memory. Enable by creating a session and passing `sessionId` to `th0th_search`.

| Tool | Description |
|------|-------------|
| `th0th_synapse_session` | Create/resume a cognitive session scoped to a task |
| `th0th_synapse_prime` | Seed working-memory buffer with recalled memories |
| `th0th_synapse_access` | Record file access to boost that file in future searches |

### Passive Capture

| Tool | Purpose |
|------|---------|
| `th0th_hook_ingest` | Passively ingest a batch of lifecycle events as Observations (fire-and-forget; consolidated later by the LLM bridge). **Req:** `events`[]. Each event **Req:** `event`∈{`session-start`,`user-prompt`,`pre-tool-use`,`post-tool-use`,`pre-compact`,`session-end`}, `projectId`, `payload`. **Opt:** `sessionId`, `importance`(0-1), `agentId`, `ts` |

### Project Bootstrap

| Tool | Purpose |
|------|---------|
| `th0th_bootstrap` | Scan a project (git log, README, docs, top central files) and create seed memories. Idempotent; LLM-off degrades silently to rule-based. **Req:** `projectId`. **Opt:** `projectPath`, `force`(default false) |

### Cross-session Handoffs

| Tool | Purpose |
|------|---------|
| `th0th_handoff_begin` | Begin a cross-session handoff (summary, open questions, next steps, files). Dual-written as a searchable memory. **Req:** `projectId`. **Opt:** `sourceSessionId`, `targetAgent`, `summary`(max 1024), `openQuestions`[], `nextSteps`[], `files`[] |
| `th0th_handoff_accept` | Accept an open handoff by id (open→accepted). **Req:** `id`. **Opt:** `projectId` |
| `th0th_handoff_cancel` | Cancel (expire) an open handoff by id (open→expired). **Req:** `id`. **Opt:** `projectId` |
| `th0th_handoff_list_pending` | List open handoffs for a project, oldest-first. **Req:** `projectId`. **Opt:** `targetAgent` |

### Auto-improvement (Proposals)

| Tool | Purpose |
|------|---------|
| `th0th_list_proposals` | List pending auto-improvement proposals, newest-first. **Req:** `projectId` |
| `th0th_approve_proposal` | Approve a proposal by id; applies the memory edit. **Req:** `id`. **Opt:** `projectId`, `source`∈{`llm`,`rule-based`} |
| `th0th_reject_proposal` | Reject a proposal by id (no edit applied). **Req:** `id`. **Opt:** `projectId`, `reason` |

### Checkpoints

| Tool | Purpose |
|------|---------|
| `th0th_create_checkpoint` | Save task progress for later resumption. **Req:** `taskId`, `description`. **Opt:** `status`∈{`pending`,`in_progress`,`completed`,`failed`,`paused`}, `currentStep`, `progressPercent`, `totalSteps`, `completedSteps`, `checkpointType`∈{`manual`,`milestone`}, `agentId`, `projectId`, `memoryIds`[], `fileChanges`[], `decisions`[], `learnings`[], `nextAction`, `pendingValidations`[], `format` |
| `th0th_list_checkpoints` | List saved checkpoints. **Opt:** `taskId`, `projectId`, `checkpointType`∈{`auto`,`manual`,`milestone`}, `includeExpired`(default false), `limit`(default 10), `format` |
| `th0th_restore_checkpoint` | Restore a checkpoint and return its state + integrity checks. **Opt:** `checkpointId`, `taskId`(restore latest for task), `format` |

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
ollama pull bge-m3              # embeddings (1024 dims)
ollama pull qwen2.5-coder:7b    # completion (consolidation, rerank, query rewrite)
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
RLM_LLM_MODEL=qwen2.5-coder:7b
```

With `RLM_LLM_ENABLED=true` you get: hook→memory consolidation, handoff-summary
polish, query understanding (rewrite + HyDE), LLM-judge rerank, and auto
importance scoring. Set it `false` (the default) and every one of those silently
falls back to its rule-based path.

> **Embeddings caveat:** `bge-m3` is batched at 8 — larger batches can crash on
> CPU. The server caps batches accordingly; just be aware if you drive the
> embedding endpoint directly with 50+ inputs.

---

## Passive Capture (Claude Code hooks)

Passive capture streams Claude Code lifecycle events into th0th as Observations,
so the agent's behaviour is recorded without any change to how you prompt.

- **Fire-and-forget:** each hook `curl`s the endpoint with a **2s timeout** and
  always `exit 0`. The agent is never blocked, even if the API is down or
  `curl` is missing.
- **No stdout:** scripts produce no output.

### Install

1. `chmod +x` the scripts under `apps/claude-plugin/hooks/` (already executable
   in this repo).
2. Add them to your project or user `.claude/settings.json` `hooks` block — use
   **absolute paths** to the scripts:

```jsonc
{
  "hooks": {
    "SessionStart":      [{ "command": "/abs/path/to/apps/claude-plugin/hooks/session-start.sh" }],
    "UserPromptSubmit":  [{ "command": "/abs/path/to/apps/claude-plugin/hooks/user-prompt-submit.sh" }],
    "PostToolUse":       [{ "command": "/abs/path/to/apps/claude-plugin/hooks/post-tool-use.sh" }],
    "Stop":              [{ "command": "/abs/path/to/apps/claude-plugin/hooks/stop.sh" }]
  }
}
```

3. Start the API: `bun run dev:api` (defaults to `http://localhost:3333`).
4. Run a Claude Code session — Observation rows appear in
   `~/.rlm/observations.db` and are consolidated into memories only when
   `RLM_LLM_ENABLED=true`; otherwise they're stored raw and the bridge silently
   skips.

### Env

| Variable | Default | Notes |
|----------|---------|-------|
| `TH0TH_API_BASE` | `http://localhost:3333` | Tools API base URL |
| `TH0TH_API_KEY` | _(none)_ | Optional auth key |
| `TH0TH_PROJECT_ID` | cwd basename | Project the observations attach to |

### Non-Claude hosts

Use the MCP tool `th0th_hook_ingest`, or POST directly to
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

> The `dev:ui` script was removed — `@th0th-ai/ui-client` (its target) did not
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

Config file: `~/.config/th0th/config.json` (auto-created on first run).
The canonical annotated reference for every environment variable is
[`.env.example`](./.env.example) — mirror it into `.env` and edit there.

### Environment variables

Defaults below are verbatim from `packages/shared/src/config/index.ts`. LLM-gated
rows default **OFF** and degrade silently when disabled.

| Key | Env var | Default | State |
|-----|---------|---------|-------|
| `llm.enabled` | `RLM_LLM_ENABLED` | `false` | **OFF** |
| `llm.baseUrl` | `RLM_LLM_BASE_URL` | `http://localhost:11434/v1` | — |
| `llm.apiKey` | `RLM_LLM_API_KEY` | `ollama` | — |
| `llm.model` | `RLM_LLM_MODEL` | `qwen2.5-coder:7b` | — |
| `llm.temperature` | `RLM_LLM_TEMPERATURE` | `0.2` | — |
| `llm.maxOutputTokens` | `RLM_LLM_MAX_OUTPUT_TOKENS` | `2000` | — |
| `llm.timeoutMs` | `RLM_LLM_TIMEOUT_MS` | `30000` | — |
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

> **Note:** `compression.llm` is a deprecated alias of top-level `llm` (same env
> vars). There is a known drift between the typed `Th0thConfig` interface and the
> runtime loader — the loader reads `llm`/`hooks`/`memory`/`search` from env
> correctly even though the TS interface doesn't yet declare them. Tracked as a
> separate code follow-up.

### Quick Config Commands

```bash
# Show current configuration
npx @th0th-ai/mcp-client --config-show

# Show config file path
npx @th0th-ai/mcp-client --config-path

# Show config directory
npx @th0th-ai/mcp-client --config-dir

# Initialize configuration
npx @th0th-ai/mcp-client --config-init

# Show help
npx @th0th-ai/mcp-client --help
```

### Embedding Providers

| Provider | Model | Cost | Quality |
|----------|-------|------|---------|
| **Ollama** (default) | qwen3-embedding, bge-m3, nomic-embed-text | Free | Good-Excellent |
| **Mistral** | mistral-embed, codestral-embed | $$ | Great |
| **OpenAI** | text-embedding-3-small | $$ | Great |

### Advanced Configuration

For detailed configuration management, use the config CLI:

```bash
# Initialize with specific provider
npx @th0th-ai/mcp-client --config-init                          # Ollama (default)
npx @th0th-ai/mcp-client --config-init --mistral your-api-key   # Mistral
npx @th0th-ai/mcp-client --config-init --openai your-api-key    # OpenAI

# Switch provider
npx @th0th-ai/mcp-client --config-init --mistral your-api-key
npx @th0th-ai/mcp-client --config-init --ollama-model qwen3-embedding

# Set specific configuration values
npx @th0th-ai/mcp-client --config-set embedding.dimensions 4096
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
| `bun run bench:fixture` | Run the th0th retrieval fixture benchmark |

> **`dev:ui` was removed.** Its target (`@th0th-ai/ui-client`) did not exist.
> The Web UI is served by the Tools API at `http://localhost:3333/ui` — run it
> with `bun run dev:api`.

---

## Architecture

```
th0th/
├── apps/
│   ├── mcp-client/           # MCP Server (stdio) — 35 tools
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
| **Memory** | Persistent SQLite/PostgreSQL storage across sessions |
| **Cache** | Multi-level L1/L2 with TTL |
| **Passive Capture** | Fire-and-forget Claude Code hooks → Observations → LLM bridge → memories |
| **Bootstrap** | Repo scan (git log/README/docs/centrality) → idempotent seed memories |
| **Handoffs** | Cross-session structured records (summary/next-steps/files), dual-written as searchable memories |
| **Auto-improvement** | Rule-based pattern detection → proposals (auto-approve or review-gated) |
| **Web UI** | Read-only browser served by the Tools API at `/ui` |

---

## License

MIT
