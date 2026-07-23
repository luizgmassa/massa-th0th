# massa-th0th — Cursor plugin

A native Cursor plugin bundle that makes massa-th0th feel native in Cursor: semantic code search skills, the massa-th0th MCP server, a subagent, and passive lifecycle capture via 7 hook events.

## What you get

Skills (auto-loaded from `skills/<name>/SKILL.md`):

| Skill | What it does |
|-------|--------------|
| `map` | Project map: stats, top central files, symbols by kind, languages, recent indexes |
| `index` | Index the cwd (polls status, reports ETA) |
| `find` | Semantic code search |
| `def` | Go-to-definition (exact then fuzzy fallback) |
| `graph` | Reference graph (who calls / imports / extends) |
| `status` | Workspaces health + search analytics |

MCP server: `massa-th0th` (`npx @massa-th0th/mcp-client` with `MASSA_TH0TH_API_URL`) — auto-discovered from the bundled `mcp.json`, no separate `install-agents.ts` run needed for the plugin's scope.

Subagent: `massa-th0th-navigator` — a code exploration specialist that queries the massa-th0th semantic index before falling back to file reads.

Hooks: 7 Cursor lifecycle events wired to the shared `massa-th0th-hook` binary (fire-and-forget POSTs to the tools-api):

| Cursor event | Binary subcommand | Lifecycle kind |
|-------------|-------------------|----------------|
| `sessionStart` | `session-start` | `session-start` |
| `sessionEnd` | `stop` | `session-end` |
| `beforeSubmitPrompt` | `user-prompt-submit` | `user-prompt` |
| `preToolUse` | `pre-tool-use` | `pre-tool-use` |
| `postToolUse` | `post-tool-use` | `post-tool-use` |
| `preCompact` | `pre-compact` | `pre-compact` (dual-POST: observation + snapshot) |
| `stop` | `stop` | `session-end` |

## The historical gap is closed

The massa-th0th codebase previously documented that "Cursor only has 3 hook events (beforeSubmitPrompt, afterFileEdit, stop) — no SessionStart, no PreCompact." Web research (2026-07-23, `cursor.com/docs/hooks`) confirmed this is **out of date**: Cursor now documents 18+ events including `sessionStart` and `preCompact`. This plugin wires the 7 events that map cleanly to the massa-th0th lifecycle kinds, closing the historical gap:

- **`sessionStart`** — every Cursor session now produces a `session-start` observation (previously lost).
- **`preCompact`** — the binary's dual-POST (3s observation + 5s snapshot to `/api/v1/hook/compact-snapshot`) now fires on Cursor compaction (previously lost).

## Install

```bash
# user scope (~/.cursor), default
apps/cursor-plugin/install.sh

# or project scope (./.cursor)
apps/cursor-plugin/install.sh --project

# uninstall (removes only massa-th0th-owned entries; user hooks preserved)
apps/cursor-plugin/install.sh --uninstall
```

The installer copies the plugin bundle to `~/.cursor/plugins/massa-th0th/` (user) or `./.cursor/plugins/massa-th0th/` (project), creates the `massa-th0th-hook` symlink to the repo's shared binary, and merges the 7 hook events into `~/.cursor/hooks.json` (or `./.cursor/hooks.json`) using an array-append merge that preserves any existing user hooks (a timestamped backup is written before the first write). Re-running is a no-op when massa-th0th-owned entries already exist.

## Advanced: `vscode.cursor.plugins.registerPath` (for extension authors)

If you are building a VS Code extension for Cursor, you can register the plugin directory programmatically instead of copying it:

```typescript
// In your extension's activate()
vscode.cursor.plugins.registerPath("/abs/path/to/apps/cursor-plugin");
```

Cursor auto-discovers `skills/`, `hooks/hooks.json`, `mcp.json`, and `agents/` inside the registered directory. The `.cursor-plugin/plugin.json` manifest is optional — Cursor discovers the subdirectories without it, but including one aids marketplace submission later.

Use `unregisterPath` to remove:

```typescript
vscode.cursor.plugins.unregisterPath("/abs/path/to/apps/cursor-plugin");
```

See `cursor.com/docs/extension-api` and `cursor.com/docs/reference/plugins` for the full API.

## Prerequisites

- The massa-th0th tools-api running (`bun run dev:api` from the massa-th0th repo) so hook POSTs land at `http://localhost:3333`.
- [Bun](https://bun.sh) installed (the `massa-th0th-hook` binary is a Bun script).
- The `massa-th0th-hook` symlink points at `apps/claude-plugin/hooks/massa-th0th-hook.ts` in this repo — keep the repo checkout present, or replace the symlink with a copy of the binary if you relocate.

## MCP deconfliction

If you also run `scripts/install-agents.ts --agent cursor` (which writes MCP config to `~/.cursor/mcp.json`), skip the MCP step or you may double-register the `massa-th0th` server. The plugin's bundled `mcp.json` is the canonical MCP source when the plugin is installed.