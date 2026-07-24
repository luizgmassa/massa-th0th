# massa-ai

massa-ai is a local-first MCP server that indexes your codebase — semantic search, keyword search, and a symbol graph ranked by dependency centrality — and keeps a persistent, cross-session memory of decisions, patterns, and critical facts.

Instead of loading whole files into context, your assistant retrieves just the relevant symbols, references, and memories, so it reads less, forgets nothing between sessions, and costs less to run. It runs on Ollama (free, offline), with optional LLM consolidation, rerank, and query understanding, and plugs into Claude Code, Codex, Cursor, and OpenCode via MCP plus passive-capture hooks.

> **[FEATURES.md](./FEATURES.md)** contains a complete reference for every feature — what it does, why it exists, and how to use it. This README covers installation, integration, and quick-start; FEATURES.md has the depth.

---

## Quick Start

### One-line install (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-ai/main/install.sh | bash
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
MASSA_AI_MODE=docker MASSA_AI_API_PORT=4000 MASSA_AI_NO_START=1 \
  curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-ai/main/install.sh | bash
```

### Manual setup (from source)

```bash
# 1. Clone and install
git clone https://github.com/luizgmassa/massa-ai.git
cd massa-ai
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
#   DATABASE_URL=postgresql://massa_ai:massa_ai_password@localhost:5432/massa_ai
```

Linux/WSL: install `postgresql` + `postgresql-*-pgvector` from your distro, create the role/db/extension, then set `DATABASE_URL`. Or use Docker (option 3, ~5GB RAM).

> **Tip:** Run `bun run diagnose` at any time to validate Ollama connectivity,
> database access, embedding generation, and migration status.

---

## Integration

### OpenCode (recommended)

The OpenCode plugin is an npm package (`@massa-ai/opencode-plugin`). Its
hooks are in-process (no `hooks.json` to merge): the plugin registers
lifecycle handlers (`session.created`, `tool.execute.after`,
`experimental.session.compacting`, `shell.env`, `event`, `dispose`) directly,
so observations are captured the moment the plugin loads.

**Install the package:**

```bash
npm install @massa-ai/opencode-plugin
# or from source:
bun add @massa-ai/opencode-plugin
```

**Configure** `~/.config/opencode/opencode.json`:

File: `~/.config/opencode/opencode.json`

**Via MCP package:**

```json
{
  "mcp": {
    "massa-ai": {
      "type": "local",
      "command": [
        "bunx",
        "@massa-ai/mcp-client"
      ],
      "environment": {
        "MASSA_AI_API_URL": "http://localhost:3333"
      },
      "enabled": true
    }
  }
}
```

**Via Plugin:**

```json
{
  "plugin": ["@massa-ai/opencode-plugin"]
}
```

**From source (development):**

```json
{
  "mcpServers": {
    "massa-ai": {
      "type": "local",
      "command": ["bun", "run", "/path/to/massa-ai/apps/mcp-client/src/index.ts"],
      "enabled": true
    }
  }
}
```

**Events wired (in-process, 6 lifecycle handlers):** `session.created`,
`tool.execute.after`, `experimental.session.compacting`, `shell.env`, `event`,
`dispose` — all registered in-process by the plugin (no external hooks file).

### Plugin Bundles (4-Tool Parity)

All four major AI coding tools have native plugin bundles that install skills
(slash commands), MCP server config, and passive-capture hooks in one command.
Hooks are **auto-written** (not just printed) using array-append merge with
backup + `_massaAiOwned` marker — user hooks are always preserved.

| Tool | Install command | Events | Bundles | Trust step? |
|------|----------------|--------|---------|-------------|
| **Claude Code** | `bash apps/claude-plugin/install.sh --user` | 5 | 6 slash commands + navigator subagent + 12 subagent specialists + hooks into `settings.json` | No |
| **Codex** | `bash apps/codex-plugin/install.sh --user` | 6 | 6 skills + 12 subagent specialists (TOML to `~/.codex/agents/`) + hooks into `hooks.json` + `.mcp.json` | Yes — run `/hooks` in Codex |
| **Cursor** | `bash apps/cursor-plugin/install.sh --user` | 7 | 6 skills + hooks into `hooks.json` + `mcp.json` + navigator agent + 12 subagent specialists | No |
| **OpenCode** | `npm install @massa-ai/opencode-plugin` then `massa-ai-config agents install --user` | 6 (in-process) | 14 in-process tools + lifecycle handlers + 12 subagent specialists (`.md` to `~/.config/opencode/agents/`) | No |

All installers support `--user` (default, e.g. `~/.claude`), `--project` (e.g.
`./.claude`), and `--uninstall` (removes only massa-ai-owned entries).
OpenCode is an npm package — add `"plugin": ["@massa-ai/opencode-plugin"]`
to `~/.config/opencode/opencode.json`.

Or pick the `p` option from the root `bash install.sh` post-install menu, which
offers all four plugin choices plus an "All four" shortcut.

**Shared binary:** Claude Code, Codex, and Cursor all use the same
`massa-ai-hook.ts` Bun binary from `apps/claude-plugin/hooks/`. Codex and
Cursor symlink to it. OpenCode uses in-process handlers (no external hooks file).

**MCP deconfliction:** if you install a plugin, the MCP server is already
registered via the plugin's `.mcp.json`/`mcp.json`. Skip the
`install-agents.ts` MCP step for that tool to avoid double-registration.

**12 subagent specialists:** all four plugins ship the 12 massa-ai
sub-agent specialists (investigator, planner, builder, reviewer,
context-curator, verification-agent, requirements-analyst,
architecture-specialist, test-engineer, documentation-agent,
audit-specialist, mobile-specialist) as host-native subagent definitions.
Model + effort are pinned per host: Claude `effort: high` + aliases
(haiku/sonnet/opus); Codex `model_reasoning_effort = "high"` + IDs
(gpt-5.4-mini/gpt-5.6-terra/gpt-5.6-sol); Cursor/OpenCode
`reasoningEffort: max` + charter model hints (DeepSeek V4 Pro / GLM-5.2 /
MiniMax M3). See [FEATURES.md → Subagent Skills (12 Specialists)](./FEATURES.md#subagent-skills-12-specialists)
for the full per-agent model/effort/permission tables, file locations, and
the generator + parity-test contract.

**Cursor advanced (extension authors):** register the plugin directory
programmatically via
`vscode.cursor.plugins.registerPath("/abs/path/to/apps/cursor-plugin")`.

See [§Passive Capture (Hooks)](#passive-capture-hooks) for the full event
tables and [FEATURES.md](./FEATURES.md#plugins-4-tool-parity) for details.

---

## Skills & Install System

The repo ships a set of repo-local skills plus a unified installer that symlinks them into each tool's config directory. The per-plugin installers (above) handle hooks + MCP + subagent specialists; this installer handles skills and the bootstrap contract.

### Included skills

| Skill | Location | Purpose |
|-------|----------|---------|
| `massa-ai` | `skills/massa-ai/` | Workflow router (spec-driven, debug, feature, refactor, audits, ADR/RFC/TDD, etc.) |
| `massa-ai-memory` | `skills/massa-ai-memory/` | Rules for using massa-ai semantic search, compression, memory, and symbol graph tools |
| `synapse-usage` | `skills/synapse-usage/` | Synapse cognitive modulation layer for focused multi-step retrieval |
| `persona-router` | `skills/persona-router/` | Automatic persona selection from catalog (`skills/massa-ai/personas/`) |

### Unified skills installer

Symlinks all `skills/*/SKILL.md` into each detected tool's config dir and writes the bootstrap contract block into the tool's `AGENTS.md`. Symlink-based — updates to the repo are immediately reflected without re-running.

```bash
# Install skills for all detected tools
bun scripts/install-skills.ts --apply --platform all --yes

# Install for one platform
bun scripts/install-skills.ts --apply --platform claude --yes

# Preview changes (write nothing)
bun scripts/install-skills.ts --dry-run --platform all

# Check for drift (exit 1 if symlinks missing or pointing wrong)
bun scripts/install-skills.ts --check --platform all

# Uninstall (remove only massa-ai-owned symlinks + bootstrap block)
bun scripts/install-skills.ts --uninstall --platform all --yes
```

**State:** `~/.config/massa-ai/install-state.json` (v2 format; v1 auto-migrates).

**Safety:** aborts on non-symlink conflict (won't overwrite user files); `--dry-run` writes nothing; requires `--yes` for real `$HOME`.

See [FEATURES.md → Skills & Install System](./FEATURES.md#skills--install-system) for the full reference.

### Workflow guides

Migrated documentation for massa-ai workflows lives in `docs/`:

| Guide | File |
|-------|------|
| Spec-Driven | `docs/massa-ai-spec-driven.md` |
| TDD | `docs/massa-ai-tdd.md` |
| RFC | `docs/massa-ai-rfc.md` |
| Commit | `docs/massa-ai-commit.md` |
| Ticket | `docs/massa-ai-ticket.md` |
| Maestro | `docs/massa-ai-maestro.md` |
| Mobile Figma | `docs/massa-ai-mobile-figma.md` |
| Context Slices | `docs/context-slices.md` |

```json
{
  "mcpServers": {
    "massa-ai": {
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

Install hooks for your tool (see [§Passive Capture (Hooks)](#passive-capture-hooks))
so observations are streamed to `/api/v1/hook`. All four tools (Claude Code,
Codex, Cursor, OpenCode) have plugin installers that auto-write hooks. Non-hook
hosts use `hook_ingest` or `POST /api/v1/hook/batch`.

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
[FEATURES.md](./FEATURES.md#query-understanding-rewrite--hyde) and
[FEATURES.md](./FEATURES.md#rerank-llm-judge).

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

52 tools total, grouped by category: Indexing & Search, Symbol Graph, Code
Execution (Sandbox), Memory & Lifecycle, Synapse (Cognitive Layer), Passive
Capture, Project Bootstrap, Cross-session Handoffs, Auto-improvement
(Proposals), and Checkpoints.

The current roster fits in one MCP `tools/list` page (pagination via
`nextCursor` activates over 100 tools).

**See [FEATURES.md](./FEATURES.md#mcp-server-52-tools) for the complete tool
roster** with required/optional params for every tool.

### Workflow integration

The massa-ai workflow skill (`skills/massa-ai/`) references all 52 tools
by their canonical un-prefixed names. Each workflow adopts the tools that
materially benefit its flow — e.g. `spec-driven` and `long-session` use
checkpoints for task save/resume; `debug` uses `trace_path` for call-path
tracing and `execute_file` for large-file analysis; `architecture-audit` uses
`impact_analysis` and `get_architecture`; `agent-handoff` uses the handoff
tools; `onboarding` uses `bootstrap`. See
[FEATURES.md → Workflow Tools (52-Tool Adoption)](./FEATURES.md#workflow-tools-52-tool-adoption)
for the full tool-to-workflow adoption map.

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
> (see `massa-ai-config.ts`). `qwen3-embedding:8b` (4096d) gives stronger recall
> than `nomic-embed-text` or `bge-m3` but is slower — bulk indexing a large corpus
> takes minutes. Override via `OLLAMA_EMBEDDING_MODEL` or config `embedding.model`.
> Switch to `bge-m3` (1024d) for speed if its recall quality is sufficient.

---

## Passive Capture (Hooks)

Passive capture streams agent lifecycle events into massa-ai as Observations,
so the agent's behaviour is recorded without any change to how you prompt.

- **Fire-and-forget:** each hook POSTs to the endpoint with a **2s timeout** and
  always `exit 0`. The agent is never blocked, even if the API is down.
- **No stdout:** scripts produce no output.
- **Empty stdin is a no-op:** if a hook fires with no payload, the script exits
  without posting (the API requires a non-empty payload object).

### Install hooks for your tool

All four tools have plugin installers that **auto-write** the hooks config (not
just print it) using array-append merge with backup + `_massaAiOwned` marker,
so user hooks are always preserved:

```bash
bash apps/claude-plugin/install.sh --user   # 5 events → ~/.claude/settings.json
bash apps/codex-plugin/install.sh --user    # 6 events → ~/.codex/hooks.json
bash apps/cursor-plugin/install.sh --user   # 7 events → ~/.cursor/hooks.json
```

OpenCode is an npm plugin with **in-process hooks** — no installer script
needed:

```bash
npm install @massa-ai/opencode-plugin
```

Or pick the `p` option from the root `bash install.sh` post-install menu, which
offers all four plugin choices plus an "All four" shortcut. See
[§Integration](#integration) for per-plugin details.

### What each hook captures

Six lifecycle event kinds are recognised: `session-start`, `user-prompt`,
`pre-tool-use`, `post-tool-use`, `pre-compact`, `session-end`. The `pre-compact`
hook does a dual-POST (observation + snapshot to `/api/v1/hook/compact-snapshot`)
to build a bounded, reference-based table-of-contents of the session's
observations — zero loss across `/compact`.

### Events wired per tool

**Claude Code (5 events)** — wired by `apps/claude-plugin/install.sh` into
`settings.json` (nested matcher-group + `hooks[]` form):

| Claude event | Binary subcommand | Observation `source` |
|--------------|--------------------|----------------------|
| `SessionStart` | `session-start` | `session-start` |
| `UserPromptSubmit` | `user-prompt-submit` | `user-prompt` |
| `PostToolUse` | `post-tool-use` | `post-tool-use` |
| `PreCompact` | `pre-compact` | `pre-compact` |
| `Stop` | `stop` | `session-end` |

**Codex (6 events)** — wired by `apps/codex-plugin/install.sh` into
`~/.codex/hooks.json`:

| Codex event | Binary subcommand | Observation `source` |
|-------------|--------------------|----------------------|
| `SessionStart` | `session-start` | `session-start` |
| `UserPromptSubmit` | `user-prompt-submit` | `user-prompt` |
| `PreToolUse` | `pre-tool-use` | `pre-tool-use` |
| `PostToolUse` | `post-tool-use` | `post-tool-use` |
| `PreCompact` | `pre-compact` | `pre-compact` |
| `Stop` | `stop` | `session-end` |

> **Trust step (Codex only):** after install, run `/hooks` in Codex to trust
> massa-ai hooks — Codex skips non-managed plugin hooks until trusted.

**Cursor (7 events)** — wired by `apps/cursor-plugin/install.sh` into
`~/.cursor/hooks.json`:

| Cursor event | Binary subcommand | Observation `source` |
|--------------|-------------------|----------------------|
| `sessionStart` | `session-start` | `session-start` |
| `sessionEnd` | `stop` | `session-end` |
| `beforeSubmitPrompt` | `user-prompt-submit` | `user-prompt` |
| `preToolUse` | `pre-tool-use` | `pre-tool-use` |
| `postToolUse` | `post-tool-use` | `post-tool-use` |
| `preCompact` | `pre-compact` | `pre-compact` |
| `stop` | `stop` | `session-end` |

**OpenCode (in-process, 6 lifecycle handlers)** — registered by the
`@massa-ai/opencode-plugin` npm package, no external hooks file:
`session.created`, `tool.execute.after`, `experimental.session.compacting`,
`shell.env`, `event`, `dispose`.

### Env

| Variable | Default | Notes |
|----------|---------|-------|
| `MASSA_AI_API_BASE` | `http://localhost:3333` | Tools API base URL |
| `MASSA_AI_API_KEY` | _(none)_ | Optional auth key |
| `MASSA_AI_PROJECT_ID` | cwd basename | Project the observations attach to |

### Non-Claude hosts

Use the MCP tool `hook_ingest`, or POST directly to
`/api/v1/hook/batch` with `{ events: [...] }` — useful for Docker deployments
where the repo (and hook scripts) aren't on the host filesystem.

### For a complete feature reference

See [FEATURES.md](./FEATURES.md) for every feature, what it does, why it exists,
and how to use it.

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

> The `dev:ui` script was removed — `@massa-ai/ui-client` (its target) did not
> exist. The web UI is served exclusively via `dev:api` at `/ui`.

---

## Search Quality Tuning

Environment variables for fine-tuning retrieval (all optional). LLM-gated
knobs (`SEARCH_QUERY_UNDERSTANDING_*`, `SEARCH_RERANK_*`) default **OFF** and
require `RLM_LLM_ENABLED=true`.

**See [FEATURES.md](./FEATURES.md#search-quality-tuning) for the full table**
of search quality variables and defaults.

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

Config file: `~/.config/massa-ai/config.json` (auto-created on first run).
The canonical annotated reference for every environment variable is
[`.env.example`](./.env.example) — mirror it into `.env` and edit there.

**See [FEATURES.md](./FEATURES.md#configuration) for the complete environment
variable table, search quality tuning, operational knobs, embedding providers,
and config CLI commands.**

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
| `bun run bench:fixture` | Run the massa-ai retrieval fixture benchmark |

> **`dev:ui` was removed.** Its target (`@massa-ai/ui-client`) did not exist.
> The Web UI is served by the Tools API at `http://localhost:3333/ui` — run it
> with `bun run dev:api`.

---

## Architecture

massa-ai/
├── apps/
│   ├── mcp-client/           # MCP Server (stdio) — 52 tools
│   ├── tools-api/            # REST API (port 3333) + Web UI at /ui
│   ├── web-ui/               # Read-only memory/search/handoff/checkpoint browser
│   ├── claude-plugin/        # Claude Code plugin (slash commands + subagent + hooks)
│   ├── codex-plugin/         # Codex plugin (skills + hooks + MCP)
│   ├── cursor-plugin/        # Cursor plugin (skills + hooks + MCP + agent)
│   └── opencode-plugin/      # OpenCode plugin (npm package, in-process hooks)
├── packages/
│   ├── core/                 # Business logic, search, embeddings, compression
│   └── shared/               # Shared types, config loader, utilities
└── scripts/

| Component | Description |
|-----------|-------------|
| **Semantic Search** | Hybrid vector + keyword with RRF ranking, `enriched` response mode |
| **Synapse** | Post-retrieval cognitive modulation: task alignment, agent affinity, working-memory buffer |
| **Symbol Graph** | PageRank-based centrality, definitions, references, go-to-definition |
| **Embeddings** | Ollama (local) or Mistral/OpenAI API |
| **Compression** | Rule-based code structure extraction (target 70% reduction) |
| **Memory** | Persistent PostgreSQL/pgvector storage across sessions |
| **Cache** | Multi-level L1/L2 with TTL |
| **Passive Capture** | Fire-and-forget hooks (Claude Code, Codex, Cursor, OpenCode) → Observations → LLM bridge → memories |
| **Bootstrap** | Repo scan (git log/README/docs/centrality) → idempotent seed memories |
| **Handoffs** | Cross-session structured records (summary/next-steps/files), dual-written as searchable memories |
| **Auto-improvement** | Rule-based pattern detection → proposals (auto-approve or review-gated) |
| **Web UI** | Read-only browser served by the Tools API at `/ui` |

---

## Structural indexing (polyglot native Tree-sitter)

massa-ai indexes code with **pinned native Tree-sitter grammars** across all
33 canonical source extensions, producing a versioned symbol/edge graph ranked by
dependency centrality. The native runtime is correct and verified; no WASM or
runtime/post-install download is used.

**Native target:** macOS arm64 and Linux glibc x64. Application runtime is
**Bun `1.3.14`**; **Node `25.9.0`** (npm `11.14.1`) is a build-only `node-gyp`
helper.

**Performance status:** Correct and verified. The perf contract (MLTS-022) was
reframed (spec-owner approved, 2026-07-17): the hard gate is the 16 MiB
disposal-stress native-retention test (PASS); throughput/RSS are an absolute
self-baseline, not a regex-relative threshold.

**See [FEATURES.md](./FEATURES.md#structural-indexing-polyglot-native-tree-sitter)**
for supported languages, capability tiers, graph schema, FQN identities,
embedded parsing, verification commands, and performance details.

---

## Credits

massa-ai builds on ideas and inspiration from these open-source projects:

- **[th0th](https://github.com/S1LV4/th0th)** — the semantic code-search and memory platform this project is built on
- **[ai-memory](https://github.com/akitaonrails/ai-memory)** — persistent agent memory concepts
- **[codebase-context-mcp](https://github.com/DeusData/codebase-memory-mcp)** — MCP-based codebase context indexing
- **[context-memory](https://github.com/mksglu/context-memory)** — cross-session context and memory persistence
- **[code-context-engine](https://github.com/elara-labs/code-context-engine)** — index codebase, agents search instead of reading files

## License

MIT
