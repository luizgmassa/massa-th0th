# massa-ai — Codex plugin

A native Codex plugin bundle that makes massa-ai feel native in Codex CLI: semantic code search skills, the massa-ai MCP server, and passive lifecycle capture via 6 hook events.

## What you get

Skills (invocable via Codex `$` mentions):

| Skill | What it does |
|-------|--------------|
| `map` | Project map: stats, top central files, symbols by kind, languages, recent indexes |
| `index` | Index the cwd (polls status, reports ETA) |
| `find` | Semantic code search |
| `def` | Go-to-definition (exact then fuzzy fallback) |
| `graph` | Reference graph (who calls / imports / extends) |
| `status` | Workspaces health + search analytics |

MCP server: `massa-ai` (`npx @massa-ai/mcp-client` with `MASSA_AI_API_URL`) — auto-discovered from the bundled `.mcp.json`, no separate `install-agents.ts` run needed for the plugin's scope.

Hooks: 6 Codex lifecycle events wired to the shared `massa-ai-hook` binary (fire-and-forget POSTs to the tools-api):

| Codex event | Binary subcommand | Lifecycle kind |
|-------------|-------------------|----------------|
| `SessionStart` | `session-start` | `session-start` |
| `UserPromptSubmit` | `user-prompt-submit` | `user-prompt` |
| `PreToolUse` | `pre-tool-use` | `pre-tool-use` |
| `PostToolUse` | `post-tool-use` | `post-tool-use` |
| `PreCompact` | `pre-compact` | `pre-compact` (dual-POST: observation + snapshot) |
| `Stop` | `stop` | `session-end` |

## Install

```bash
# user scope (~/.codex), default
apps/codex-plugin/install.sh

# or project scope (./.codex)
apps/codex-plugin/install.sh --project

# uninstall (removes only massa-ai-owned entries; user hooks preserved)
apps/codex-plugin/install.sh --uninstall
```

The installer copies the plugin bundle to `~/.codex/plugins/massa-ai/` (user) or `./.codex/plugins/massa-ai/` (project), creates the `massa-ai-hook` symlink to the repo's shared binary, and merges the 6 hook events into `~/.codex/hooks.json` (or `./.codex/hooks.json`) using an array-append merge that preserves any existing user hooks (a timestamped backup is written before the first write). Re-running is a no-op when massa-ai-owned entries already exist.

## Trust step (required)

Codex skips non-managed plugin hooks until they are trusted. After install, run:

```
/hooks
```

in Codex and trust the massa-ai hooks. **Without this step, no observations will be captured.**

## Prerequisites

- The massa-ai tools-api running (`bun run dev:api` from the massa-ai repo) so hook POSTs land at `http://localhost:3333`.
- [Bun](https://bun.sh) installed (the `massa-ai-hook` binary is a Bun script).
- The `massa-ai-hook` symlink points at `apps/claude-plugin/hooks/massa-ai-hook.ts` in this repo — keep the repo checkout present, or replace the symlink with a copy of the binary if you relocate.

## Local plugin dir discovery

Codex discovers plugins from `~/.codex/plugins/` (user scope) or `./.codex/plugins/` (project scope). The installer places the bundle at `~/.codex/plugins/massa-ai/` (or the project equivalent). Codex reads `.codex-plugin/plugin.json` for the manifest (`skills`, `mcp`, `hooks` pointers), then auto-loads `skills/*.md`, `.mcp.json`, and `hooks/hooks.json`.

## MCP deconfliction

If you also run `scripts/install-agents.ts --agent codex` (which writes MCP config to `~/.codex/config.toml`), skip the MCP step or you may double-register the `massa-ai` server. The plugin's bundled `.mcp.json` is the canonical MCP source when the plugin is installed.