# massa-th0th — Feature Reference

Every feature in massa-th0th, what it does, why it exists, and how to use it.

> For install/setup, see the [README](./README.md). For architecture decisions,
> see [`docs/adr/`](./docs/adr/). For feature specs and validation evidence, see
> [`.specs/features/`](./.specs/features/).

---

## Table of Contents

- [Semantic + Keyword Search](#semantic--keyword-search)
- [Structural Indexing (Polyglot Native Tree-sitter)](#structural-indexing-polyglot-native-tree-sitter)
- [Symbol Graph](#symbol-graph)
- [Persistent Memory](#persistent-memory)
- [Passive Capture (Hooks)](#passive-capture-hooks)
- [Plugins (4-Tool Parity)](#plugins-4-tool-parity)
- [Workflow Tools (52-Tool Adoption)](#workflow-tools-52-tool-adoption)
- [Bootstrap](#bootstrap)
- [Cross-session Handoffs](#cross-session-handoffs)
- [Auto-improvement (Proposals)](#auto-improvement-proposals)
- [Checkpoints](#checkpoints)
- [Synapse (Cognitive Layer)](#synapse-cognitive-layer)
- [Context Compression](#context-compression)
- [Compact Snapshot](#compact-snapshot)
- [Web UI & Dashboard](#web-ui--dashboard)
- [Scheduler](#scheduler)
- [Code Execution (Sandbox)](#code-execution-sandbox)
- [L1/L2 Cache](#l1l2-cache)
- [Local-first LLM (Ollama)](#local-first-llm-ollama)
- [Query Understanding (Rewrite + HyDE)](#query-understanding-rewrite--hyde)
- [Rerank (LLM-judge)](#rerank-llm-judge)
- [Fetch and Index](#fetch-and-index)
- [MCP Server (52 Tools)](#mcp-server-52-tools)
- [REST API](#rest-api)
- [Configuration](#configuration)
- [Skills & Install System](#skills--install-system)

---

## Semantic + Keyword Search

**What:** Hybrid vector + keyword search with Reciprocal Rank Fusion (RRF) ranking. Vector search uses pgvector embeddings; keyword search uses PostgreSQL full-text search with bounded fuzzy matching and proximity-aware ranking. Results are diversity-capped (`RRF_MAX_CHUNKS_PER_FILE`) so one file can't monopolize results.

**Why:** Loading whole files into an agent's context is expensive and noisy. Semantic search finds conceptually relevant code; keyword search catches exact identifier matches. RRF blends both so you get the right chunk without reading entire files.

**How to use:**

```bash
# MCP
search { query: "token validation", projectId: "my-app" }
search { query: "token validation", projectId: "my-app", responseMode: "enriched" }
# enriched = full content + file imports + parent symbol in one call

# REST
curl -X POST http://localhost:3333/api/v1/search/project \
  -H "Content-Type: application/json" \
  -d '{"query":"authentication","projectId":"my-project"}'
```

**Key knobs:** `SEARCH_DISABLE_KEYWORD` (vector-only), `RRF_KEYWORD_BOOST`,
`RRF_VECTOR_WEIGHT`, `SEARCH_MIN_SCORE`. See [README §Search Quality Tuning](./README.md#search-quality-tuning).

**Spec:** `.specs/features/phase-7-retrieval-polish/`

---

## Structural Indexing (Polyglot Native Tree-sitter)

**What:** massa-th0th indexes code with **pinned native Tree-sitter grammars** across all 33 canonical source extensions (TS/JS, Python, Ruby, PHP, Lua, C/C++, Go, Rust, Zig, Java, Kotlin, Scala, C#, Swift, Dart, Elixir, Erlang, Clojure, OCaml, Haskell, Vue, Markdown, JSON, YAML, HTML). Produces a versioned symbol/edge graph with 18 canonical symbol kinds and 9 edge kinds. Each symbol gets a modern full-SHA-256 FQN plus a stable legacy alias, with explicit ambiguity payloads where multiple symbols share a legacy name.

**Why:** Regex-based extraction misses structured relationships (calls, imports, inheritance, data flow). Native Tree-sitter gives a real AST, enabling accurate symbol definitions, references, typed edges, and dependency centrality. The native runtime is pinned and patched for deterministic lifetime safety (no WASM, no runtime downloads).

**How to use:**

```bash
# Index a project
index { projectPath: "/abs/path/to/project", projectId: "my-app" }
# Poll status
index_status { projectId: "my-app" }
# Force full reindex after a large refactor
reindex { projectId: "my-app" }
```

**Native target:** macOS arm64 and Linux glibc x64. Application runtime is **Bun `1.3.14`**; **Node `25.9.0`** (npm `11.14.1`) is a build-only `node-gyp` helper. `tree-sitter@0.25.0` carries a repository patch (SHA-256 `e79aec7b...`: C++20 `binding.gyp` + install-guard) for deterministic lifetime/disposal safety.

**Architecture:** Graph schema v2 uses generation-scoped builds — a pending generation is built beside the active one under a DB lease, with an immutable snapshot and CAS activation. Pending data is invisible to graph reads until activation, so an in-flight rebuild never corrupts the visible graph.

**Supported languages:** 33 extensions across TS/JS, web host (Vue/HTML), data (JSON/YAML/Markdown), systems (C/C++/Go/Rust/Zig), scripting (Python/Ruby/PHP/Lua), managed/mobile (Java/Kotlin/Scala/C#/Swift/Dart), and functional/BEAM (Elixir/Erlang/Clojure/OCaml/Haskell). Each language declares capability tiers — declarations/documentation, imports/modules, type relations, calls, data flow, HTTP, and events. See `.specs/features/multi-language-tree-sitter-breadth/capability-matrix.md`.

**Readiness vs. liveness:** Parser readiness is separate from process liveness. `/health` reports the API alive regardless of parser state. On startup, `validateAllGrammars` loads all 33 manifest entries; indexing is rejected until readiness reaches `ready`. A broken native install can never silently produce an empty/partial graph.

**Versioned symbol identities (FQNs):**
- Legacy alias: `path/to/file.ts#myFunction`
- Modern identity: `path/to/file.ts#MyClass.myMethod~method~<sha256>`
- Ambiguity: when the legacy alias is non-unique, resolution returns the ordered candidate list instead of first-match

**Embedded parsing:** Vue SFCs parsed via HTML host grammar with TS/JS child grammars for `<script>`/`<template>`; Markdown headings/fences and JSON/YAML qualified keys extracted with stable scope FQNs.

**Verification:**

| Command | Checks |
|---------|--------|
| `bun run verify:tree-sitter-native` | Source + dist + packed-package: 33+33 parses, 27 native modules, 10 lifetime sensors, RSS < 16 MiB median delta |
| `bun run verify:tree-sitter-source-dist` | Source/dist grammar load + parse |
| `bun run verify:tree-sitter-package` | Packed npm tarball bundles the nested patched runtime + generated addon |
| `bun run type-check` / `bun run build` | Workspace type-check (6/6) and build (5/5) |
| `bun run bench:parser -- --baseline 5d43a96...` | Frozen parser benchmark vs. the regex baseline |

**Performance status:** Native structural indexing is correct and verified. The perf contract (MLTS-022) was reframed (spec-owner approved, 2026-07-17): the hard gate is the 16 MiB disposal-stress native-retention test (PASS); candidate throughput/RSS are an absolute self-baseline, not a regex-relative threshold. A 2.2× indexer optimization is committed (`490f302`). A full-AST indexer produces per-symbol rich extraction that the regex baseline does not, so like-for-like throughput parity is assessed as unlikely.

**Spec:** `.specs/features/multi-language-tree-sitter-breadth/`

---

## Symbol Graph

**What:** A dependency-centric symbol graph with PageRank-based centrality scoring. Supports definitions, references, go-to-definition, call/data-flow/cross-service path tracing, git-diff impact analysis, architecture maps, and Louvain file-import community detection.

**Why:** Understanding "who calls this function" or "what does this change impact" requires a graph, not just text search. Centrality ranking surfaces the most architecturally important files first.

**How to use:**

```bash
# Find definitions by name
search_definitions { search: "authenticate", projectId: "my-app" }
# Find all usages
get_references { symbolName: "validateToken", projectId: "my-app" }
# Go to definition
go_to_definition { symbolName: "validateToken", projectId: "my-app" }
# Trace a call path (BFS over typed edges)
trace_path { function_name: "handleLogin", projectId: "my-app", direction: "outbound", mode: "calls", depth: 3 }
# Git-diff impact analysis
impact_analysis { project: "my-app", scope: "unstaged" }
# One-shot architecture summary
project_map { id: "my-app" }
```

**Spec:** `.specs/features/e2e-hardening-and-graph-parity/`, `.specs/features/wave-5-cross-pollination/`

---

## Persistent Memory

**What:** Cross-session memory stored in PostgreSQL/pgvector. Five memory types: `critical`, `decision`, `pattern`, `code`, `conversation`. Each memory has an importance score (0-1), tags, project/session/agent associations, and a hierarchical level (Project, User, Session). Memories are semantically searchable via embedding vectors.

**Why:** Agents forget between sessions. Persistent memory ensures decisions, patterns, and critical facts survive — the agent starts each session with accumulated knowledge instead of a cold start.

**How to use:**

```bash
# Store
remember { content: "Auth uses JWT with refresh token rotation", type: "decision", importance: 0.9, projectId: "my-app" }
# Semantic recall
recall { query: "how does auth work", projectId: "my-app" }
# Browse by type
memory_list { projectId: "my-app", type: "decision", minImportance: 0.7 }
# Update (re-embeds on content change)
memory_update { id: "<id>", content: "Updated decision", mergeTags: true }
# Delete
memory_delete { id: "<id>" }
```

**Spec:** `.specs/features/phase-1-memory-foundation/`

---

## Passive Capture (Hooks)

**What:** Streams agent lifecycle events into massa-th0th as Observations — without any change to how you prompt. Six lifecycle event kinds: `session-start`, `user-prompt`, `pre-tool-use`, `post-tool-use`, `pre-compact`, `session-end`. Observations are stored raw in PostgreSQL and optionally consolidated into structured memories by an LLM bridge (when `RLM_LLM_ENABLED=true`).

**Why:** Manually telling your agent to "remember this" is tedious and lossy. Passive capture records what the agent did automatically — every prompt, every tool call, every session — so the memory builds itself.

**How it works:**
1. Host lifecycle event fires (e.g., Claude Code `PostToolUse`)
2. Hook script/binary POSTs to `/api/v1/hook` (2s timeout, always exit 0, never blocks)
3. `HookService` validates + enqueues on a single-writer queue (saturation → 429 + `Retry-After`)
4. `ObservationStore.insert` (WAL)
5. Debounce-triggered `ObservationConsolidationJob` summarizes observations into memories (LLM-gated; silent-skip when LLM off)

**Server-side gates:** `HOOKS_ENABLED=false` → 423 Locked. Queue saturation (`HOOKS_QUEUE_MAX_PENDING=256`) → 429. Payload cap (`HOOKS_MAX_PAYLOAD_BYTES=65536`) → 413.

**Pre-compact dual-POST:** the `pre-compact` subcommand does TWO POSTs: (1) observation to `/api/v1/hook` (3s timeout), (2) snapshot to `/api/v1/hook/compact-snapshot` (5s timeout). This builds a bounded, reference-based table-of-contents of the session's observations — zero loss across `/compact`.

**Non-Claude hosts:** use the MCP tool `hook_ingest` or POST directly to `/api/v1/hook/batch`.

**Spec:** `.specs/features/phase-3-hook-capture/`, `.specs/features/hook-attribution-repair/`

---

## Plugins (4-Tool Parity)

**What:** massa-th0th ships native plugin bundles for all four major AI coding tools: Claude Code, Codex, Cursor, and OpenCode. Each plugin bundles skills (slash commands), the MCP server config, and passive-capture hooks — installed in one command.

**Why:** Without a plugin, you'd need to manually register the MCP server, manually wire hooks, and have no slash commands. The plugins make massa-th0th feel native in each tool — install once, get everything.

**The three layers (not the same thing):**
- **Agent** = MCP server registration (`scripts/install-agents.ts` — wires 5 targets: claude-code, claude-desktop, codex, cursor, opencode)
- **Hook** = lifecycle capture → `POST /api/v1/hook[/batch]` (6 event kinds)
- **Plugin** = host-native integration bundle (skills + hooks + MCP + agents)

### Claude Code plugin (`apps/claude-plugin/`)

**What it bundles:** 6 slash commands (`/massa-th0th-map`, `/massa-th0th-index`, `/massa-th0th-find`, `/massa-th0th-def`, `/massa-th0th-graph`, `/massa-th0th-status`), the `massa-th0th-navigator` subagent, and 5 hook events auto-written into `~/.claude/settings.json`.

**Hook events (5):** `SessionStart`, `UserPromptSubmit`, `PostToolUse`, `PreCompact`, `Stop`.

**Install:**

```bash
bash apps/claude-plugin/install.sh --user      # ~/.claude
bash apps/claude-plugin/install.sh --project   # ./.claude
bash apps/claude-plugin/install.sh --uninstall # removes only massa-th0th-owned entries
```

The installer auto-writes hooks into `settings.json` using array-append merge with backup + `_massaTh0thOwned` marker. No manual `settings.json` merge required.

### Codex plugin (`apps/codex-plugin/`)

**What it bundles:** 6 skills (`map`, `index`, `find`, `def`, `graph`, `status`), 6 hook events, `.mcp.json` (MCP server auto-discovered).

**Hook events (6):** `SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `Stop`.

**Install:**

```bash
bash apps/codex-plugin/install.sh --user       # ~/.codex
bash apps/codex-plugin/install.sh --project    # ./.codex
bash apps/codex-plugin/install.sh --uninstall
```

**Trust step (required):** after install, run `/hooks` in Codex to trust massa-th0th hooks — Codex skips non-managed plugin hooks until trusted.

### Cursor plugin (`apps/cursor-plugin/`)

**What it bundles:** 6 skills, 7 hook events, `mcp.json`, and the `massa-th0th-navigator` agent.

**Hook events (7):** `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `preCompact`, `stop`. This closes the historical gap where Cursor was documented as having only 3 events — Cursor now supports 18+ events including `sessionStart` and `preCompact`.

**Install:**

```bash
bash apps/cursor-plugin/install.sh --user      # ~/.cursor
bash apps/cursor-plugin/install.sh --project   # ./.cursor
bash apps/cursor-plugin/install.sh --uninstall
```

**Advanced (extension authors):** register the plugin directory programmatically via `vscode.cursor.plugins.registerPath("/abs/path/to/apps/cursor-plugin")`.

### OpenCode plugin (`apps/opencode-plugin/`)

**What it bundles:** 14 in-process tools (search, remember, recall, index, compress, optimized_context, read, index_status, analytics, list_projects, search_definitions, get_references, go_to_definition) + 6 in-process lifecycle handlers. This is an npm package (`@massa-th0th/opencode-plugin@1.1.0`), not a script-copy bundle.

**Hook events (in-process, 6 lifecycle handlers):** `session.created`, `tool.execute.after`, `experimental.session.compacting`, `shell.env`, `event`, `dispose` — all registered in-process by the plugin. No external hooks file needed.

**Install:**

```bash
npm install @massa-th0th/opencode-plugin
```

Add to `~/.config/opencode/opencode.json`:

```json
{
  "plugin": ["@massa-th0th/opencode-plugin"],
  "mcp": {
    "massa-th0th": {
      "type": "local",
      "command": ["bunx", "@massa-th0th/mcp-client"],
      "environment": { "MASSA_TH0TH_API_URL": "http://localhost:3333" },
      "enabled": true
    }
  }
}
```

### Root installer menu

All four plugins can be installed from the root `install.sh` post-install menu (option `p`):

```
1) Claude Code plugin (skills + commands + hooks auto-write)
2) Codex plugin (6 skills, 6 hook events, MCP)
3) Cursor plugin (6 skills, 7 hook events, MCP, agents)
4) OpenCode plugin (npm install + config snippet)
5) All four (Claude, Codex, Cursor, OpenCode)
```

**Shared binary:** all shell-script-based plugins (Claude Code, Codex, Cursor) use the same `massa-th0th-hook.ts` Bun binary from `apps/claude-plugin/hooks/`. Codex and Cursor symlink to it. The binary resolves the project ID via: existing pin → `MASSA_TH0TH_PROJECT_ID` env → git toplevel basename → cwd basename.

**MCP deconfliction:** if you install a plugin, the MCP server is already registered via the plugin's `.mcp.json`/`mcp.json`. Skip the `install-agents.ts` MCP step for that tool to avoid double-registration.

**Spec:** `.specs/features/codex-cursor-plugin-parity/`

---

## Subagent Skills (12 Specialists)

**What:** massa-th0th defines 12 reusable sub-agent specialists in `skills/*/SKILL.md` (charter files). These ship as host-native subagent definitions across all four plugins so the massa-th0th workflow router's delegation model works inside Claude Code, Codex, Cursor, and OpenCode. The 12 specialists are additive to the existing `massa-th0th-navigator` (Claude/Cursor), which is a distinct index-first agent.

**The 12 specialists:** investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist.

**Single source of truth:** `scripts/generate-subagent-artifacts.ts` reads `skills/*/SKILL.md` and emits per-host agent files into `apps/{claude,codex,cursor,opencode}-plugin/agents/`. Outputs are checked into git. A parity test (`scripts/__tests__/subagent-parity.test.ts`) re-runs the generator in `--check` mode and asserts byte-identity — drift fails CI.

### File locations + formats (per host)

| Host | Location | Format | Ownership marker |
| --- | --- | --- | --- |
| Claude Code | `apps/claude-plugin/agents/massa-th0th-*.md` → installed to `~/.claude/agents/` | `.md` (YAML frontmatter: `name`, `description`, `tools`, `model`, `effort`) | Name prefix `massa-th0th-` (uninstall excludes `massa-th0th-navigator.md` by name — R1) |
| Codex | `apps/codex-plugin/agents/massa-th0th-*.toml` → installed to `~/.codex/agents/` (OUTSIDE plugin dir) | `.toml` (`name`, `description`, `model`, `model_reasoning_effort`, `sandbox_mode`, `developer_instructions`) | `# massa-th0th-owned` top comment |
| Cursor | `apps/cursor-plugin/agents/massa-th0th-*.md` → bundled in plugin `agents/` dir | `.md` (same shape as Claude) | Name prefix `massa-th0th-` (removed with plugin dir) |
| OpenCode | `apps/opencode-plugin/agents/massa-th0th-*.md` → installed to `~/.config/opencode/agents/` (OUTSIDE npm package) | `.md` (`description`, `mode: subagent`, `model`, `reasoningEffort`, `permission`, `metadata`) | `metadata: { massa-th0th-owned: true }` frontmatter |

> Codex and OpenCode agents live OUTSIDE the plugin dir / npm package because their host discovery loads agents from a shared config-root directory, not from the plugin bundle. The in-file ownership marker enables scoped uninstall that preserves user agents (R3).

### Model pinning (PINNED per agent per host, NOT advisory)

The `model` frontmatter field is PINNED per agent per host. The generator emits these exact values; a parity test asserts them.

#### Claude Code (model aliases + `effort: high`)

Every Claude Code agent sets `effort: high` in addition to its pinned `model`.

| Agent | Model | Why |
| --- | --- | --- |
| investigator | haiku | Fast repository exploration, symbol lookup, dependency tracing, file discovery. |
| context-curator | haiku | Reading many files, summarizing, filtering, building Context Packets. |
| documentation-agent | haiku | README, KDoc, changelogs, ADR formatting don't need frontier reasoning. |
| requirements-analyst | sonnet | Needs to detect ambiguity and infer missing requirements. |
| planner | opus | One of the highest-leverage places to spend tokens. |
| builder | sonnet | "Everyday coding" workload Sonnet is intended for. |
| reviewer | sonnet | Strong balance of code understanding and cost. |
| verification-agent | sonnet | Systematic reasoning without Opus-level cost. |
| test-engineer | sonnet | Excellent for generating tests and edge cases. |
| audit-specialist | sonnet | Most audits don't justify Opus unless architectural. |
| mobile-specialist | sonnet | Android/iOS implementation is primarily coding work. |
| architecture-specialist | opus | Large-scale design, trade-offs, migrations, RFC guidance. |

#### Codex (model IDs + `model_reasoning_effort = "high"`)

Every Codex agent TOML sets `model_reasoning_effort = "high"` in addition to its pinned `model`.

| Agent | Model | Why |
| --- | --- | --- |
| investigator | gpt-5.4-mini | Fast repository exploration, symbol lookup, dependency tracing, file discovery. |
| context-curator | gpt-5.4-mini | Reading many files, summarizing, filtering, building Context Packets. |
| documentation-agent | gpt-5.4-mini | README, KDoc, changelogs, ADR formatting don't need frontier reasoning. |
| requirements-analyst | gpt-5.6-terra | Needs to detect ambiguity and infer missing requirements. |
| planner | gpt-5.6-sol | One of the highest-leverage places to spend tokens. |
| builder | gpt-5.6-terra | "Everyday coding" workload GPT-5.6 Terra is intended for. |
| reviewer | gpt-5.6-terra | Strong balance of code understanding and cost. |
| verification-agent | gpt-5.6-terra | Systematic reasoning without Opus-level cost. |
| test-engineer | gpt-5.6-terra | Excellent for generating tests and edge cases. |
| audit-specialist | gpt-5.6-terra | Most audits don't justify Opus unless architectural. |
| mobile-specialist | gpt-5.6-terra | Android/iOS implementation is primarily coding work. |
| architecture-specialist | gpt-5.6-sol | Large-scale design, trade-offs, migrations, RFC guidance. |

#### Cursor (charter `metadata.model_hint` verbatim + `reasoningEffort: max`)

Every Cursor agent sets `reasoningEffort: max` in frontmatter (pass-through; field-name unverified — Cursor subagent docs returned 404; harmless if ignored). Cursor resolves the model by name; if unavailable, the host falls back.

| Agent | Model (verbatim from charter) | Charter hint |
| --- | --- | --- |
| investigator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| context-curator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| documentation-agent | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| requirements-analyst | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| planner | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| builder | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| reviewer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| verification-agent | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| test-engineer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| audit-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| mobile-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| architecture-specialist | MiniMax M3 | `metadata.model_hint: MiniMax M3` |

#### OpenCode (charter `metadata.model_hint` verbatim + `reasoningEffort: max`)

Every OpenCode agent sets `reasoningEffort: max` in frontmatter (pass-through to the provider; honoring is provider-dependent for DeepSeek/GLM/MiniMax). OpenCode `model` accepts `provider/model-id`; if the pinned model is unavailable, OpenCode gracefully falls back to the invoking primary agent's model.

| Agent | Model (verbatim from charter) | Charter hint |
| --- | --- | --- |
| investigator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| context-curator | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| documentation-agent | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| requirements-analyst | DeepSeek V4 Pro | `metadata.model_hint: DeepSeek V4 Pro` |
| planner | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| builder | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| reviewer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| verification-agent | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| test-engineer | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| audit-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| mobile-specialist | GLM-5.2 | `metadata.model_hint: GLM-5.2` |
| architecture-specialist | MiniMax M3 | `metadata.model_hint: MiniMax M3` |

### Effort pinning (per host)

| Host | Effort field | Value |
| --- | --- | --- |
| Claude Code | `effort` | `high` |
| Codex | `model_reasoning_effort` | `"high"` |
| Cursor | `reasoningEffort` | `max` (pass-through) |
| OpenCode | `reasoningEffort` | `max` (pass-through; provider-honoring is host behavior) |

### Permission mapping (read-only vs write)

Write-permitted agents: `builder`, `test-engineer`, `documentation-agent`. All others are read-only.

| Host | Read-only | Write |
| --- | --- | --- |
| Claude Code | `tools: ["Read","Grep","Glob","Bash"]` (no Write/Edit) | `tools: ["Read","Grep","Glob","Bash","Write","Edit"]` |
| Codex | `sandbox_mode = "read-only"` | `sandbox_mode = "workspace-write"` |
| Cursor | Same `tools` as Claude | Same `tools` as Claude |
| OpenCode | `permission: { edit: deny, bash: deny }` (strict) or `{ edit: deny, bash: { "*": "ask" } }` (planner — inspection-capable) | `permission: { edit: allow, bash: allow }` |

### Generator + parity contract

- **Generator:** `scripts/generate-subagent-artifacts.ts` reads `skills/*/SKILL.md` (12 charters), emits 48 files (12 × 4 hosts) into `apps/*/agents/`. Run via `bun run scripts/generate-subagent-artifacts.ts`. Outputs checked into git.
- **Drift gate:** `bun run scripts/generate-subagent-artifacts.ts --check` emits to a temp dir and diffs against checked-in files. Exit non-zero on drift.
- **Parity test:** `scripts/__tests__/subagent-parity.test.ts` runs the drift gate + asserts model/effort/permission pinning, name-collision-free, exact 12 per host, Codex TOML round-trip + owned marker, and FEATURES.md ↔ spec table byte-parity (DOC-06).

**Spec:** `.specs/features/subagent-skills-plugin-parity/`

---

## Workflow Tools (52-Tool Adoption)

**What:** The massa-th0th workflow skill (`skills/massa-th0th/`) references the full 52-tool surface from `apps/mcp-client/src/tool-definitions.ts` CANONICAL_ORDER. Every tool name uses the canonical un-prefixed form (e.g. `recall`, not `th0th_recall`), matching what the MCP server and OpenCode plugin actually expose. The tool-contract reference (`references/th0th-tools.md`) contains a complete MCP Capability Matrix for all 52 tools grouped by category, and each workflow adopts the tools that materially benefit its flow.

**Why:** The workflows previously referenced only ~11 of 52+ shipped tools and used stale `th0th_*`-prefixed names that diverged from the actual MCP tool declarations. Powerful shipped features — checkpoints, cross-session handoffs, bootstrap, compact_snapshot, trace_path, impact_analysis, code execution, the full Synapse lifecycle, read_file, symbol_snippet, memory_update/delete, analytics, fetch_and_index — were unguided by the workflow router. Agents following massa-th0th workflows missed deterministic, first-class tool support for long-running task save/resume, cross-session continuity, code-path tracing, impact analysis, and code execution for analysis.

**How to use:** Workflows reference tools inline in their ordered steps. No separate invocation is needed — when you follow a massa-th0th workflow, the tool calls are part of the flow. Key adoption map:

| Tool(s) | Workflow | Where in the flow |
| --- | --- | --- |
| `bootstrap` | `onboarding` | After indexing, before manual `remember` |
| `create_checkpoint` / `list_checkpoints` / `restore_checkpoint` | `spec-driven`, `long-session`, `restart-save` | Task boundaries; resume after interruption; milestone before restart |
| `handoff_begin` / `handoff_accept` / `handoff_list_pending` / `handoff_cancel` | `agent-handoff`, `restart-load` | Persist + resume cross-session handoffs |
| `compact_snapshot` | `long-session` | Before compaction fires (zero-loss /compact recovery) |
| `trace_path` | `debug` | Root-cause call/data-flow path tracing |
| `impact_analysis` | `architecture-audit`, `refactor` | Git-diff centrality-ranked blast radius |
| `get_architecture` | `architecture-audit` | Architecture-specific deep map (packages, routes, hotspots, communities, cycles) |
| `execute_file` / `execute` / `batch_execute` | `debug`, `general` | Run analysis code over files instead of loading into context |
| `synapse_task_begin` / `synapse_task_end` / `synapse_prefetch` | `spec-driven`, `feature`, `debug` | Task envelopes + buffer warming for multi-search investigations |
| `read_file` / `symbol_snippet` | `general` (and all workflows that read files) | File reads with symbol metadata; raw code snippets by line range |
| `memory_update` / `memory_delete` | `general`, `debug`, `long-session` | Correct stale memories; remove obsolete ones |
| `analytics` | `general`, `long-session` | Usage/cache insights |
| `fetch_and_index` | `exploration` | Pull web docs/API refs into searchable index |

**Graph-tool freshness gate:** `trace_path`, `impact_analysis`, and `get_architecture` only count as evidence when the index is fresh for the current repository path and commit/worktree state. When the index is stale, incomplete, or missing, workflows fall back to `search`/`get_references` and record reduced retrieval confidence.

**`get_architecture` vs `project_map`:** `project_map` is the general overview (PageRank backbone, symbol counts, extension distribution, recent files). `get_architecture` is the architecture-specific deep map (packages, entry points, routes, hotspots, Louvain communities, layers, and opt-in Tarjan SCC call cycles via `aspects:["cycles"]`).

**`compact_snapshot` session-id:** `compact_snapshot` takes the lifecycle `sessionId` (from hooks/sessions), NOT the `workflowSessionId`. The two-session-id rule from `references/synapse-policy.md` applies.

**Graceful degradation:** Every new tool reference keeps the existing "if unavailable, continue with fallback" pattern. `create_checkpoint` unavailable → `.specs/` state. `handoff_begin` unavailable (`HANDOFFS_ENABLED=false`) → `remember` + `.specs/`. `bootstrap` unavailable → manual `remember`. `compact_snapshot` unavailable → `compress` + `remember`. Code execution unavailable → load file into context. Graph tools on stale index → `search`/`get_references`.

**Canonical naming:** All tool references in `skills/massa-th0th/` (workflows, references, SKILL.md) use un-prefixed canonical names matching `tool-definitions.ts` CANONICAL_ORDER. No `th0th_*`-prefixed tool names remain.

**Spec:** `.specs/features/workflow-tools-adaptation/`

---

## Bootstrap

**What:** Scans a project root (recent git log, README, docs/, package manifests, top central files via PageRank centrality) and turns those signals into seed memories (types `pattern`/`code`/`decision`). Idempotent — re-running is a no-op unless `force: true`. Detected via a stored seed-memory marker tag `bootstrap:<projectId>`.

**Why:** An agent starting on a new project has an empty memory store. Bootstrap gives it immediate usable context — the project's architecture, key files, and recent history — without manually feeding it information.

**How to use:**

```bash
# MCP
bootstrap { projectId: "my-app", projectPath: "/abs/path" }
# Force refresh
bootstrap { projectId: "my-app", projectPath: "/abs/path", force: true }

# REST
curl -X POST http://localhost:3333/api/v1/bootstrap \
  -H "Content-Type: application/json" \
  -d '{"projectId":"my-app","projectPath":"/abs/path"}'
```

With LLM off: degrades to rule-based minimal seeds (README first paragraph + git-log subjects). With LLM on: `llmObject` + zod schema generates up to 8 structured seed memories. Never throws.

**Spec:** `.specs/features/phase-4-bootstrap/`

---

## Cross-session Handoffs

**What:** Session A leaves a structured "pass this forward" record (summary, open questions, next steps, files, target agent) that a later Session B discovers and accepts. State machine: `open → accepted` (via accept) or `open → expired` (via cancel). On `begin`, the service dual-writes a searchable `conversation`-type memory (FTS5, level=PROJECT, importance 0.7) so the handoff is discoverable by `recall`/`search` independently of the handoff table.

**Why:** When work spans multiple sessions or agents, context is lost at the boundary. Handoffs provide a structured way to pass forward exactly what the next session needs — not the entire conversation, but the distilled state.

**How to use:**

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
handoff_cancel  { id: "<handoff-id>" }  # if expired/no longer needed
```

**Env:** `HANDOFFS_ENABLED=false` → route returns 423.

**Spec:** `.specs/features/phase-6-handoffs/`

---

## Auto-improvement (Proposals)

**What:** A scheduled/debounced review of recent observations detects recurring patterns (repeated queries ≥3, frequently-referenced files ≥3, common fixes ≥2) and generates memory-edit proposals. `kind ∈ {memory.create, memory.update, memory.tag}`. With `AUTO_IMPROVE_REVIEW_GATE=false` (the default), proposals are auto-approved. Set `true` for human-in-the-loop review.

**Why:** Over time, patterns emerge in how you use the agent — the same files, the same queries, the same fixes. Auto-improvement captures these patterns as memory edits automatically, so the memory store gets smarter without manual curation.

**How to use:**

```bash
list_proposals   { projectId: "my-app" }
approve_proposal { id: "<proposal-id>", projectId: "my-app" }
reject_proposal  { id: "<proposal-id>", projectId: "my-app", reason: "stale" }
```

To see proposals appear: enable `AUTO_IMPROVE_ENABLED=true` + emit ≥8 observations (or wait ≥5 min debounce), then `list_proposals`. Enable `AUTO_IMPROVE_REVIEW_GATE=true` to surface them for review instead of auto-approving.

Pattern detection is rule-based (no LLM). LLM enrichment is optional (default-off, silent-degrade). Never throws to caller.

**Spec:** `.specs/features/phase-5-auto-improve/`

---

## Checkpoints

**What:** A full serialized snapshot of a task's execution state at a point in time (progress %, current step, decisions made, files modified, pending validations, next action, referenced memory IDs, agent state). Gzip-compressed, stored as an opaque blob in the `task_checkpoints` table (PostgreSQL-only). TTL: 7 days manual, 14 days milestone, 3 days auto.

**Why:** Long-running tasks — refactors, migrations, multi-step debugging — need save points. Checkpoints let you roll back to a known-good state, resume across sessions/restarts/context compactions, or mark a milestone before a risky step.

**How to use:**

```bash
create_checkpoint {
  taskId: "auth-refactor",
  description: "Token rotation mid-flight",
  progressPercent: 60,
  currentStep: "rotateToken",
  nextAction: "finish rotateToken in src/auth.ts",
  fileChanges: ["src/auth.ts"],
  decisions: ["rotate on every login"],
  checkpointType: "manual"
}

list_checkpoints   { taskId: "auth-refactor", projectId: "my-app" }
restore_checkpoint { checkpointId: "<cp-id>" }
# Or restore latest for a task:
restore_checkpoint { taskId: "auth-refactor" }
```

**Spec:** `.specs/features/phase-0-quick-wins/` (0d checkpoint MCP)

---

## Synapse (Cognitive Layer)

**What:** An optional post-retrieval modulation layer that improves result quality over a session by tracking task context, agent affinity, and a working-memory buffer. Sessions are in-memory (not persisted across API restart). Create a session, pass `sessionId` to `search`, and results get task-aligned, affinity-boosted, and working-memory-modulated.

**Why:** A single search query doesn't capture what you're trying to do across a session. Synapse tracks the evolving task context and adjusts result ranking so later searches benefit from earlier ones — without the overhead of re-explaining your goal.

**How to use:**

```bash
# Create a session
synapse_session { agentId: "implementer", workspaceId: "my-app", taskContext: "fix auth bug", enableBuffer: true }

# Pass sessionId to search for modulated results
search { query: "token validation", projectId: "my-app", sessionId: "<session-id>" }

# Seed working memory with recalled memories
synapse_prime { id: "<session-id>", entries: [...] }

# Record file access to boost that file in future searches
synapse_access { id: "<session-id>", memoryId: "<chunk-id>" }

# Inspect, update, end
synapse_get { id: "<session-id>" }
synapse_update { id: "<session-id>", taskContext: "now debugging token refresh" }
synapse_end { id: "<session-id>" }
synapse_list { }

# Task envelopes (track task progression within a session)
synapse_task_begin { id: "<session-id>", taskContext: "implement token rotation" }
synapse_task_end { id: "<session-id>" }
```

Registry default TTL: 3,600,000 ms (1h). Buffer default max size: 20.

**Spec:** `.specs/features/synapse-mcp-parity-discovery-pagination/`

---

## Context Compression

**What:** Reduces context size by keeping structure and removing detail. Strategy `code_structure` extracts code structure (target 70% reduction via `targetRatio=0.7`). LLM-based compression is also available (code-oriented model).

**Why:** Large files or long conversations eat context window. Compression preserves the essential structure — function signatures, class outlines, key logic — while stripping verbose implementations, so the agent gets the shape of the code without the bulk.

**How to use:**

```bash
# MCP
compress { content: "...", strategy: "code_structure" }
optimized_context { query: "auth flow", projectId: "my-app" }  # search + compress in one call

# REST
curl -X POST http://localhost:3333/api/v1/context/compress \
  -H "Content-Type: application/json" \
  -d '{"content":"...","strategy":"code_structure"}'
```

---

## Compact Snapshot

**What:** Builds a bounded (<2KB) reference-based session compaction snapshot — a table of contents of lifecycle events with runnable `recall`/`search` calls. Zero-loss across `/compact`: raw events stay in the observation store; the snapshot is just a navigable index.

**Why:** When an agent's context is compacted, detail is lost. The compact snapshot gives the post-compact agent a pointer-based table of contents so it can `recall` or `search` for the specific details it needs, rather than losing them entirely.

**How to use:**

```bash
compact_snapshot { sessionId: "s1", projectId: "my-app" }
# Optionally persist: compact_snapshot { sessionId: "s1", persist: true }
```

The `pre-compact` hook subcommand automatically triggers this via a dual-POST (observation + snapshot).

---

## Web UI & Dashboard

**What:** Two read-only surfaces served by the Tools API at `http://localhost:3333/ui`:

- **Web UI** (Phase 8): read-only HTML/CSS/JS browser over memories, FTS5 search, handoffs, checkpoints, and indexed projects. Markdown rendering (`marked` + `DOMPurify` with XSS prevention) + dark-mode toggle. Optional write-mode (`MASSA_TH0TH_WEB_WRITE_MODE=true`) gates edit/delete/approve/reject buttons.
- **Dashboard** (Wave 6 N28): `#/dashboard` hash route rendering scheduler status, hook queue depth, Synapse sessions, and system metrics. Read-only, degrades gracefully.

**Why:** Not every interaction needs to go through an agent. The Web UI lets you browse memories, search code, and inspect handoffs/checkpoints directly. The Dashboard gives you operational visibility into the scheduler and hook queue.

**How to use:**

```bash
bun run dev:api
# Web UI:     http://localhost:3333/ui
# Dashboard:  http://localhost:3333/ui/#/dashboard
# Swagger:    http://localhost:3333/swagger
```

Disable with `WEB_UI_ENABLED=false`.

**Read-only guarantee:** static scan of the JS bundle verifies no mutating endpoint is called. Optional write-mode gates UI buttons but does not enable backend writes.

**Spec:** `.specs/features/phase-8-web-ui/`, `.specs/features/wave-6-architecture-features/` (N28)

---

## Scheduler

**What:** An in-process cron-like scheduler that triggers existing job implementations (memory-consolidation, decay-sweep, auto-improve, observation-bridge) on a clock instead of only the debounce trigger. Default-DISABLED. Persisted (`scheduler-store-pg.ts` — `nextRunAt`/`lastRunAt` survive restart when schedule is unchanged).

**Why:** Debounce-triggered jobs only fire when there's activity. The scheduler ensures periodic maintenance (consolidation, decay) happens on a regular cadence even if no hooks are firing, keeping memories fresh and pruning stale ones.

**How to use:**

```bash
# Master switch
MASSA_TH0TH_SCHEDULER_ENABLED=true

# Safe-defaults preset (enables consolidation + decay, NOT auto-improve)
MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true

# Per-kind enable
MASSA_TH0TH_SCHEDULER_CONSOLIDATION_ENABLED=true
MASSA_TH0TH_SCHEDULER_DECAY_ENABLED=true
MASSA_TH0TH_SCHEDULER_AUTO_IMPROVE_ENABLED=true

# Dashboard status
GET /api/v1/scheduler/status → { running, tickIntervalMs, jobs[] }
```

The scheduler must NEVER trigger indexing jobs (OOM risk) — only memory/decay/consolidation/auto-improve/observation. Concurrent-execution guard (same `jobKind` not run twice concurrently). Catch-up policy fires ONE tick per missed job, not full backfill.

---

## Code Execution (Sandbox)

**What:** A polyglot sandbox for "think in code" — run analysis in a detected runtime (node/bun/deno/python/ruby/go/rust/php/perl/r/shell) instead of loading raw data into context. Three tools: `execute` (inline code), `execute_file` (read file into sandboxed var + run code over it), `batch_execute` (N shell commands in parallel).

**Why:** Sometimes the best way to answer a question about code is to run code. Instead of loading a 500-line file into context and asking the LLM to analyze it, `execute_file` lets the agent run a script over it and return only the relevant output.

**How to use:**

```bash
execute { language: "python", code: "print(sum(range(100)))" }
execute_file { path: "src/auth.ts", language: "typescript", code: "console.log(data.length)" }
batch_execute { commands: ["rg 'function' src/", "wc -l src/*.ts"] }
```

> **Trust model: local-dev only.** Execution runs user-supplied code on the host. Containment is best-effort (timeout + process-group kill, env-denylist, project-boundary + deny-glob + symlink-realpath guard). This is NOT OS-level isolation — do not expose the Tools API to untrusted clients without an outer container/VM. OS-level sandbox wrapper available (macOS seatbelt + Linux Docker, default `auto`).

---

## L1/L2 Cache

**What:** A two-tier search cache inside `SearchCachePg`:
- **L1** = in-process `Map<string, CacheEntry>` (cap 100, TTL 300s) — avoids a PostgreSQL round-trip for hot queries
- **L2** = PostgreSQL `search_cache` table (cap 10000, TTL 3600s) — durable, shared across processes

**Why:** L2 alone adds a DB query to every cached lookup. L1 alone loses the cache on restart and isn't shared across `tools-api` + `mcp-client` processes. The combination gives durability (L2) + low latency for hot paths (L1). The persistence-ordering contract enforces: L1 must never hold a result L2 hasn't durably committed.

**Other per-subsystem in-process caches:** web-fetch (LRU 512), read-file (LRU 512), file-filter (50, 1h TTL), query-understanding rewrite (256), session (200, 4h TTL). The embedding cache is intentionally L2-only (PostgreSQL) — it protects against expensive LLM re-embedding calls.

**Note:** A separate standalone `L1MemoryCache` class exists in the codebase but is dead code — exported but never constructed, deliberately excluded from production wiring. The live two-tier L1/L2 is the in-process Map + PG table inside `SearchCachePg`.

---

## Local-first LLM (Ollama)

**What:** All LLM-driven features run against a local Ollama instance and default OFF, degrading silently to rule-based behavior when disabled. Everything still works without an LLM — you just lose consolidation, polish, rerank, and query rewrite.

**Why:** Privacy and cost. Your code and memories never leave your machine. Ollama is free and runs offline. No API keys, no per-token billing.

**How to enable:**

```bash
# .env
RLM_LLM_ENABLED=true
RLM_LLM_BASE_URL=http://localhost:11434/v1
RLM_LLM_API_KEY=ollama
RLM_LLM_MODEL=qwen2.5:7b-instruct         # NL-judgment sites
RLM_LLM_CODE_MODEL=qwen2.5-coder:7b       # code-oriented sites (bootstrap seed, reranker, compress)
```

With `RLM_LLM_ENABLED=true` you get: hook→memory consolidation, handoff-summary polish, query understanding (rewrite + HyDE), LLM-judge rerank, and auto importance scoring.

**Per-task model routing:** the 11 LLM call sites split by task shape. 8 NL-judgment sites use `RLM_LLM_MODEL`; 3 code-oriented sites use `RLM_LLM_CODE_MODEL`.

---

## Query Understanding (Rewrite + HyDE)

**What:** LLM-powered query rewrite + Hypothetical Document Embeddings (HyDE). The LLM rewrites the user's query for better retrieval and generates a hypothetical answer document whose embedding is used as an additional search vector.

**Why:** Users often describe what they want in natural language, but code is written in technical language. Query rewrite bridges that gap. HyDE generates a "what the answer might look like" document, which often matches better than the original query.

**How to enable:**

```bash
SEARCH_QUERY_UNDERSTANDING_ENABLED=true   # OFF by default
SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED=true  # extra HyDE LLM call (only when understanding is on)
```

Per-(query, projectId) rewrite cache: `SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS=300000`, `SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE=256`.

---

## Rerank (LLM-judge)

**What:** An LLM-judge reranks the top-K search results after centrality boosting. The LLM scores each result's relevance to the query, producing a final quality-ordered list.

**Why:** Vector + keyword + centrality ranking is good but not perfect. An LLM judge can assess semantic relevance that keyword overlap and vector similarity miss — especially for cross-language or conceptual queries.

**How to enable:**

```bash
SEARCH_RERANK_ENABLED=true    # OFF by default
SEARCH_RERANK_WINDOW=50       # top-K re-scored by the LLM judge
```

Uses the code-oriented model (`RLM_LLM_CODE_MODEL`).

---

## Fetch and Index

**What:** Fetch URL(s) → convert HTML→markdown or extract JSON key-paths → index the result into the semantic search store. SSRF-guarded (pins resolved addresses through connect time) and TTL-cached.

**Why:** Sometimes the answer to a code question is in documentation, an API reference, or a GitHub issue. Fetch-and-index lets the agent pull web content into the searchable index so it can be retrieved later via `search`.

**How to use:**

```bash
fetch_and_index { url: "https://api.example.com/docs" }
# Or batch with custom concurrency
fetch_and_index { requests: [{ url: "https://..." }, { url: "https://..." }], concurrency: 3, ttl: 3600 }
```

---

## MCP Server (52 Tools)

**What:** A stdio MCP server (`@massa-th0th/mcp-client`) exposing 52 tools across indexing, search, symbol graph, memory, lifecycle, Synapse, passive capture, handoffs, auto-improvement, checkpoints, and code execution. Connects to the Tools API via HTTP. The current roster fits in one MCP `tools/list` page (pagination via `nextCursor` activates over 100 tools).

**Why:** MCP is the standard protocol for connecting AI tools to external services. The MCP server makes massa-th0th's full capability set available to any MCP-compatible client (Claude Code, Codex, Cursor, OpenCode).

**How to connect:**

```json
{
  "mcpServers": {
    "massa-th0th": {
      "type": "local",
      "command": ["npx", "@massa-th0th/mcp-client"],
      "env": { "MASSA_TH0TH_API_URL": "http://localhost:3333" },
      "enabled": true
    }
  }
}
```

Or via the per-tool plugin installers (which auto-register MCP). See [Plugins](#plugins-4-tool-parity).

### Tool Roster

Each row lists **Req:** required and **Opt:** optional params.

#### Indexing & Search

| Tool | Description |
|------|-------------|
| `index` | Index a project directory with semantic embeddings |
| `index_status` | Poll background indexing job progress |
| `search` | Hybrid semantic + keyword search with RRF ranking. Supports `responseMode=enriched` for full content + imports + parentSymbol in one call |
| `reindex` | Force full reindex after a large refactor |
| `reset_project` | Delete all indexed data for a project (vectors, symbols, memories) |
| `list_projects` | List all indexed projects with status and file counts |
| `project_map` | One-shot architecture summary: stats, top files by PageRank, symbol distribution, packages, entry points, routes, hotspots, and Louvain communities |
| `fetch_and_index` | Fetch URL(s) → HTML→markdown / JSON key-path → index (SSRF-guarded, TTL-cached). **Req:** `url` (or `requests`[]). **Opt:** `source`, `concurrency`, `force`, `ttl` |

#### Symbol Graph

| Tool | Description |
|------|-------------|
| `search_definitions` | Find function/class/type definitions by name |
| `get_references` | Find all usages of a symbol across the project |
| `go_to_definition` | Jump to definition with file + line context |
| `symbol_snippet` | Get raw code snippet by file + line range |
| `read_file` | Read a file with symbol metadata and imports. A relative `filePath` requires a `projectId` or an absolute path |
| `trace_path` | Trace a call / data-flow / cross-service path over typed edges (BFS, depth-capped, cycle-guarded). **Req:** `function_name` (or `qualifiedName`), `project`. **Opt:** `direction`∈{outbound,inbound,both}, `mode`∈{calls,data_flow,cross_service,all}, `depth`, `include_tests`, `edge_types`[] |
| `impact_analysis` | Git-diff → impacted symbols via reverse import/reference traversal, ranked by centrality risk. **Req:** `project`, `projectPath`. **Opt:** `scope`∈{unstaged,staged,committed,all}, `base_branch`, `since`, `depth`, `paths`[] |

#### Code Execution (Sandbox)

> **Trust model: local-dev only.** Runs user-supplied code on the host. Containment is best-effort (timeout + process-group kill, env-denylist, project-boundary + deny-glob + symlink-realpath guard). Not OS-level isolation — do not expose to untrusted clients without an outer container/VM.

| Tool | Description |
|------|-------------|
| `execute` | Run code in a detected runtime (node/bun/deno/python/ruby/go/rust/php/perl/r/shell). **Req:** `language`, `code`. **Opt:** `timeout`, `background`, `cwd`, `intent` |
| `execute_file` | Read a file into a sandboxed var and run code over it. **Req:** `path`, `language`, `code`. **Opt:** `timeout`, `intent` |
| `batch_execute` | Run N shell commands in parallel (concurrency-capped at 256). **Req:** `commands`[]. **Opt:** `queries`, `timeout`, `concurrency`, `cwd`, `query_scope` |

#### Memory & Lifecycle

| Tool | Purpose |
|------|---------|
| `remember` | Store information in persistent memory. **Req:** `content`. **Opt:** `type`, `importance`(0-1), `projectId`, `sessionId`, `agentId`, `tags`[], `format` |
| `recall` | Semantic search over stored memories. **Req:** `query`. **Opt:** `userId`, `projectId`, `sessionId`, `agentId`, `types`[], `limit`, `minImportance`, `format` |
| `memory_list` | Browse memories by type/importance (audit mode). **Opt:** `projectId`, `type`, `minImportance`, `limit`, `offset`, `format` |
| `memory_update` | Update a memory by id; re-embeds on content change. **Req:** `id`. **Opt:** `content`, `importance`(0-1), `tags`[], `mergeTags`(bool), `format` |
| `memory_delete` | Hard-delete a memory by id; severs its graph edges. **Req:** `id`. **Opt:** `format` |
| `optimized_context` | Search + compress in one call (max token efficiency) |
| `analytics` | Usage patterns, cache performance, metrics |
| `compress` | Compress context (keeps structure, removes detail) |
| `compact_snapshot` | Build a bounded (<2KB) reference-based session compaction snapshot. **Req:** `sessionId`. **Opt:** `projectId`, `persist` |

#### Synapse (Cognitive Layer)

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
| `synapse_task_begin` | Begin a task envelope within a session |
| `synapse_task_end` | End a task envelope within a session |

#### Passive Capture

| Tool | Purpose |
|------|---------|
| `hook_ingest` | Passively ingest a batch of lifecycle events as Observations. **Req:** `events`[]. Each event **Req:** `event`∈{`session-start`,`user-prompt`,`pre-tool-use`,`post-tool-use`,`pre-compact`,`session-end`}, `projectId`, `payload`. **Opt:** `sessionId`, `importance`(0-1), `agentId`, `ts` |

#### Project Bootstrap

| Tool | Purpose |
|------|---------|
| `bootstrap` | Scan a project and create seed memories. Idempotent; LLM-off degrades silently to rule-based. **Req:** `projectId`. **Opt:** `projectPath`, `force`(default false) |

#### Cross-session Handoffs

| Tool | Purpose |
|------|---------|
| `handoff_begin` | Begin a cross-session handoff. Dual-written as a searchable memory. **Req:** `projectId`. **Opt:** `sourceSessionId`, `targetAgent`, `summary`(max 1024), `openQuestions`[], `nextSteps`[], `files`[] |
| `handoff_accept` | Accept an open handoff by id (open→accepted). **Req:** `id`. **Opt:** `projectId` |
| `handoff_cancel` | Cancel (expire) an open handoff by id. **Req:** `id`. **Opt:** `projectId` |
| `handoff_list_pending` | List open handoffs for a project, oldest-first. **Req:** `projectId`. **Opt:** `targetAgent` |

#### Auto-improvement (Proposals)

| Tool | Purpose |
|------|---------|
| `list_proposals` | List pending auto-improvement proposals, newest-first. **Req:** `projectId` |
| `approve_proposal` | Approve a proposal by id; applies the memory edit. **Req:** `id`. **Opt:** `projectId`, `source`∈{`llm`,`rule-based`} |
| `reject_proposal` | Reject a proposal by id (no edit applied). **Req:** `id`. **Opt:** `projectId`, `reason` |

#### Checkpoints

| Tool | Purpose |
|------|---------|
| `create_checkpoint` | Save task progress for later resumption. **Req:** `taskId`, `description`. **Opt:** `status`∈{pending,in_progress,completed,failed,paused}, `currentStep`, `progressPercent`, `totalSteps`, `completedSteps`, `checkpointType`∈{manual,milestone}, `agentId`, `projectId`, `memoryIds`[], `fileChanges`[], `decisions`[], `learnings`[], `nextAction`, `pendingValidations`[], `format` |
| `list_checkpoints` | List saved checkpoints. **Opt:** `taskId`, `projectId`, `checkpointType`∈{auto,manual,milestone}, `includeExpired`(default false), `limit`(default 10), `format` |
| `restore_checkpoint` | Restore a checkpoint and return its state + integrity checks. **Opt:** `checkpointId`, `taskId`(restore latest for task), `format` |

#### Project Lifecycle (Admin)

| Tool | Purpose |
|------|---------|
| `rename_project` | Rename a project identity transactionally. **Req:** `sourceProjectId`, `targetProjectId`. **Opt:** `dryRun`(default true), `operationId`, `expectedPlanHash` (apply with `dryRun=false` + `operationId` + `expectedPlanHash`). Administrative, not workflow-recurring. |
| `merge_projects` | Merge one project identity into another. **Req:** `sourceProjectId`, `targetProjectId`. Same dryRun/planHash contract as `rename_project`. Administrative, not workflow-recurring. |

**Config CLI:**

```bash
npx @massa-th0th/mcp-client --config-show
npx @massa-th0th/mcp-client --config-init
npx @massa-th0th/mcp-client --help
```

---

## REST API

**What:** A REST API (Elysia, port 3333 by default) serving all massa-th0th functionality — indexing, search, memory CRUD, hooks, handoffs, checkpoints, proposals, bootstrap, Synapse, compression, dashboard, and the Web UI.

**Why:** Not every client speaks MCP. The REST API enables custom integrations, scripting, and the Web UI. Swagger docs are auto-generated.

**How to use:**

```bash
bun run dev:api    # development (hot reload)
bun run start:api  # production
```

Swagger: `http://localhost:3333/swagger` · Web UI: `http://localhost:3333/ui` · Health: `http://localhost:3333/health`

See [README §REST API](./README.md#rest-api) for endpoint examples.

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

### Search Quality Tuning

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

### Operational knobs

These are not part of the typed config object — they are read directly from the
process environment at boot, so they do not appear in `~/.config/massa-th0th/config.json`.

| Variable | Default | Purpose |
|----------|---------|---------|
| `MASSA_TH0TH_DEDICATED` | _(unset)_ | When `1`, the dedicated-stack DB guard refuses to bind the shared `massa_th0th` database — a process that expects an isolated, disposable DB fails fast at startup instead of silently corrupting the shared stack. No-op when unset. |
| `MASSA_TH0TH_JOB_STALE_MS` | `300000` (5 min) | A background index job whose heartbeat hasn't been refreshed within this window is flipped to `failed` by the in-process reaper. |
| `MASSA_TH0TH_JOB_REAPER_INTERVAL_MS` | `60000` (60 s) | How often the stale-job reaper sweeps. |
| `MASSA_TH0TH_PROXY_TIMEOUT_MS` | `120000` (120 s) | Per-call timeout for the MCP client proxying a tool call to the Tools API. `0` disables the timeout (infinite wait). |
| `MASSA_TH0TH_SCHEDULER_ENABLED` | `false` | Master switch for the in-process cron-like scheduler. When `false` no periodic jobs fire. Set `true` to opt in; individual job kinds still need their own enable flags. |

### Embedding Providers

| Provider | Model | Cost | Quality |
|----------|-------|------|---------|
| **Ollama** (default) | qwen3-embedding:8b (also bge-m3) | Free | Good-Excellent |
| **Mistral** | mistral-embed, codestral-embed | $$ | Great |
| **OpenAI** | text-embedding-3-small | $$ | Great |

### Config CLI

```bash
# Show current configuration
npx @massa-th0th/mcp-client --config-show

# Show config file path
npx @massa-th0th/mcp-client --config-path

# Initialize configuration
npx @massa-th0th/mcp-client --config-init

# Initialize with specific provider
npx @massa-th0th/mcp-client --config-init --mistral your-api-key   # Mistral
npx @massa-th0th/mcp-client --config-init --openai your-api-key    # OpenAI

# Switch provider
npx @massa-th0th/mcp-client --config-init --ollama-model qwen3-embedding

# Set specific configuration values
npx @massa-th0th/mcp-client --config-set embedding.dimensions 4096
```

---

## Skills & Install System

The repo ships repo-local skills plus a unified TypeScript installer that symlinks them into each supported coding agent's config directory. This is separate from the per-plugin installers (`apps/*/install.sh`) which handle hooks, MCP config, and subagent specialists.

### Bootstrap Contract

`skills/AGENTS.md` contains two sections:

1. **Bootstrap contract** (top, between `<!-- massa-th0th:bootstrap:start -->` and `<!-- massa-th0th:bootstrap:end -->` markers): the coding session startup contract that activates the skill stack — `caveman full` → `coding-guidelines` → `massa-th0th` → `persona-router`. Includes the persona router policy, plan challenge policy, conversation feedback policy, RTK rules, indexing/context hygiene, and dedupe/lazy-load guardrails.

2. **Sub-agent registry** (bottom): the 12 reusable sub-agent specialist registry (investigator, planner, builder, reviewer, context-curator, verification-agent, requirements-analyst, architecture-specialist, test-engineer, documentation-agent, audit-specialist, mobile-specialist) with capability packet and output contract definitions.

The installer writes the bootstrap block into each tool's `AGENTS.md` using the same markers, replacing any existing block. The sub-agent registry is not written — it is consumed by workflows that dispatch agents.

### Included Skills

| Skill | Location | Description |
|-------|----------|-------------|
| `massa-th0th` | `skills/massa-th0th/` | Default memory-backed workflow router for every coding session. 30+ workflows (spec-driven, debug, feature, refactor, audits, ADR/RFC/TDD, commit, ticket, etc.) and 30+ references (evidence gate, context firewall, verification ladder, agent orchestration, etc.). |
| `massa-th0th-memory` | `skills/massa-th0th-memory/` | Mandatory rules for using massa-th0th semantic search, compression, memory, and symbol graph tools. Prioritizes th0th tools over native Glob/Grep/Read. |
| `synapse-usage` | `skills/synapse-usage/` | Synapse cognitive modulation layer for focused, low-noise retrieval during multi-step coding tasks. Open sessions, prime buffers, pass session IDs. |
| `persona-router` | `skills/persona-router/` | Automatic persona selection from catalog. Reads `skills/massa-th0th/personas/catalog.json`, routes based on primary deliverable ownership, supports explicit selection, ambiguity policy, and mid-conversation rerouting. |

### Unified Skills Installer (`scripts/install-skills.ts`)

A TypeScript port of the old repo's Python `agent_integrations.py`, adapted for the Bun/TS stack. Symlink-based — skills are symlinked from the repo into each tool's config directory so updates are immediately reflected.

**Commands:**

```bash
bun scripts/install-skills.ts --apply --platform all --yes      # install
bun scripts/install-skills.ts --uninstall --platform all --yes   # remove
bun scripts/install-skills.ts --dry-run --platform all          # preview
bun scripts/install-skills.ts --check --platform all            # drift check (exit 1 if drift)
```

**Flags:**

| Flag | Description |
|------|-------------|
| `--apply` | Install skills (symlinks + bootstrap block) — default action |
| `--uninstall` | Remove massa-th0th-owned symlinks + bootstrap block |
| `--dry-run` | Preview changes, write nothing |
| `--check` | Report drift (missing/wrong symlinks), exit 1 if found |
| `--platform <name>` | `claude`, `codex`, `cursor`, `opencode`, or `all` (default: all) |
| `--target <dir>` | Override home directory (for tests) |
| `--repo-root <dir>` | Override repo root detection |
| `--yes, -y` | Consent to writing real `$HOME` |
| `--json` | Machine-readable JSON output |

**Platform targets:**

| Platform | Skills dir | Bootstrap target |
|----------|-----------|-----------------|
| Claude Code | `~/.claude/skills/<name>` | `~/.claude/AGENTS.md` |
| Codex | `~/.codex/skills/<name>` | `~/.codex/AGENTS.md` |
| Cursor | `~/.cursor/skills/<name>` | `~/.cursor/AGENTS.md` |
| OpenCode | `~/.config/opencode/skills/<name>` | `~/.config/opencode/AGENTS.md` |

**State management:** `~/.config/massa-th0th/install-state.json` (v2 format). Records installed platforms, roots, and skill names. v1 state (legacy) auto-migrates to v2. State is used by `--uninstall` to know what to remove and by `--check` to detect stale symlinks.

**Safety:**
- Aborts on non-symlink conflict at a target path (won't overwrite user files).
- `--dry-run` writes nothing.
- Requires `--yes` for real `$HOME` (not test target).
- Idempotent: re-running `--apply` is a no-op when symlinks already point to the correct targets.
- Uninstall removes only symlinks pointing into the massa-th0th repo root.

**Repo root resolution:** uses `import.meta.url` (script file location), not CWD — so it works regardless of where the command is invoked from. Override with `--repo-root`.

**npm scripts:**

```json
{
  "install:skills": "bun scripts/install-skills.ts",
  "uninstall:skills": "bun scripts/install-skills.ts --uninstall"
}
```

### Persona Router & Catalog

Personas are cataloged prompt artifacts for shaping conversation perspective. The router selects one persona based on the primary deliverable, with optional secondary review lens.

**Catalog:** `skills/massa-th0th/personas/catalog.json` (schema_version 1, 5 personas). Each entry has `id`, `display_name`, `prompt_path` (filename-only, relative to the catalog directory), `summary`, `aliases`, `primary_signals`, `negative_signals`, and `secondary_lens_signals`.

**Persona prompt files:** `skills/massa-th0th/personas/`

| Persona | File | Use |
|---------|------|-----|
| AI Engineer | `context-skill-harness-engineer-architect.md` | Agent context architecture, skill/persona design, harness startup contracts |
| Node CLI Engineer | `ai-native-nodejs-cli-architect.md` | Node.js/TypeScript CLI architecture, command UX, MCP/LLM boundaries |
| Product Manager | `product-manager.md` | PRDs, product briefs, user stories, MVP scope |
| Senior Mobile Engineer | `senior-mobile-engineer.md` | Cross-platform mobile architecture, delivery, testing, release |
| Senior Mobile QA Automation Engineer | `senior-mobile-qa-automation-engineer.md` | Mobile QA automation, E2E reliability, flake reduction, CI signal |

**Router policy** (in `skills/AGENTS.md`): `enabled: auto`, `ambiguity: ask`, `no_match: no_persona`, `mid_conversation: task_change`. Explicit persona or no-persona requests override automatic inference.

### Workflow Guides

Documentation for massa-th0th workflows lives in `docs/`:

| Guide | File | Covers |
|-------|------|--------|
| Spec-Driven | `docs/massa-th0th-spec-driven.md` | TLC v3 Specify → (Design) → (Tasks) → Execute flow |
| TDD | `docs/massa-th0th-tdd.md` | Technical design / implementation plan workflow |
| RFC | `docs/massa-th0th-rfc.md` | Propose a significant change |
| Commit | `docs/massa-th0th-commit.md` | Safe Conventional Commits with Jira branch prefixes |
| Ticket | `docs/massa-th0th-ticket.md` | Draft and create Jira Epics/issues through Atlassian MCP |
| Maestro | `docs/massa-th0th-maestro.md` | Mobile E2E flow implementation |
| Mobile Figma | `docs/massa-th0th-mobile-figma.md` | Compare mobile UI implementation with Figma design |
| Context Slices | `docs/context-slices.md` | Context slicing patterns |

### Tests

Ported from the old repo's Python test suite to TypeScript/bun test:

| Test file | Scenarios | Covers |
|-----------|-----------|--------|
| `scripts/__tests__/validate-repository.test.ts` | 185 | Skill structure, workflow/reference existence, bootstrap contract, persona catalog (deep: schema/fields/duplicates/path-escape/mirror-drift), hooks enforcement contract, lessons dual-write contract, harness state path migration, gitignore, context slices, agents harness routing, RFC/TDD/ticket/commit workflow contracts, deterministic router precedence, verification ladder, spec-driven phase gates, audit-report-IO, evidence gate, context firewall, synapse policy, th0th-tools matrix, canonical tool naming (no `th0th_*` prefixes), docs guides |
| `scripts/__tests__/install-skills.test.ts` | 39 | Apply/uninstall idempotency, dry-run, conflict abort, state v1→v2 migration, drift detection, partial uninstall, hook gating scenarios (bad stdin, malformed state) |
| `scripts/__tests__/install-agents.test.ts` | 56 | JSON writer plan/apply/idempotent/uninstall (claude-code, claude-desktop, cursor), OpenCode writer (`mcp` key + `bunx` + `environment` shape), Codex TOML writer, Claude settings.json plugin-hooks coordination, orchestration, consent gate, deconfliction hints |
| `scripts/__tests__/subagent-parity.test.ts` | 16 | Drift gate, exact-12-per-host, name-collision, model+effort pinning (Claude/Codex/Cursor/OpenCode), permission boundary, Codex TOML round-trip+marker, OpenCode permission+marker, FEATURES.md table parity |

Run: `bun test scripts/__tests__/validate-repository.test.ts scripts/__tests__/install-skills.test.ts scripts/__tests__/install-agents.test.ts scripts/__tests__/subagent-parity.test.ts`

---

## Credits

massa-th0th builds on ideas and inspiration from these open-source projects:

- **[th0th](https://github.com/S1LV4/th0th)** — the semantic code-search and memory platform this project is built on
- **[ai-memory](https://github.com/akitaonrails/ai-memory)** — persistent agent memory concepts
- **[codebase-context-mcp](https://github.com/DeusData/codebase-memory-mcp)** — MCP-based codebase context indexing
- **[context-memory](https://github.com/mksglu/context-memory)** — cross-session context and memory persistence
- **[code-context-engine](https://github.com/elara-labs/code-context-engine)** — index codebase, agents search instead of reading files
