# massa-th0th — Claude Code plugin

Slash commands and a specialized subagent that make massa-th0th feel native in Claude Code.

## What you get

Slash commands (installed as `/massa-th0th-*`):

| Command | What it does |
|---------|--------------|
| `/massa-th0th-map` | Project map: stats, top central files, symbols by kind, languages, recent indexes |
| `/massa-th0th-index [projectId]` | Index the cwd (polls status, reports ETA) |
| `/massa-th0th-find <query>` | Semantic code search |
| `/massa-th0th-def <symbol>` | Go-to-definition (exact then fuzzy fallback) |
| `/massa-th0th-graph <symbol>` | Reference graph (who calls / imports / extends) |
| `/massa-th0th-status` | Workspaces health + search analytics |

Subagent:

- **`massa-th0th-navigator`** — exploration specialist that prefers semantic queries over blind file reads. Protects the parent agent's context during large investigations.

## Install

```bash
# user scope (~/.claude), default
apps/claude-plugin/install.sh

# or project scope (./.claude)
apps/claude-plugin/install.sh --project
```

Restart Claude Code to pick up the new commands.

## Prerequisites

The massa-th0th MCP server must be registered for Claude Code. See `apps/mcp-client/README.md`.

A quick check after install:

```
/massa-th0th-status
```

If nothing shows up, the MCP server probably isn't running — start it with the dev-server command from the massa-th0th repo.
