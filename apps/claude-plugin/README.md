# massa-ai — Claude Code plugin

Slash commands and a specialized subagent that make massa-ai feel native in Claude Code.

## What you get

Slash commands (installed as `/massa-ai-*`):

| Command | What it does |
|---------|--------------|
| `/massa-ai-map` | Project map: stats, top central files, symbols by kind, languages, recent indexes |
| `/massa-ai-index [projectId]` | Index the cwd (polls status, reports ETA) |
| `/massa-ai-find <query>` | Semantic code search |
| `/massa-ai-def <symbol>` | Go-to-definition (exact then fuzzy fallback) |
| `/massa-ai-graph <symbol>` | Reference graph (who calls / imports / extends) |
| `/massa-ai-status` | Workspaces health + search analytics |

Subagent:

- **`massa-ai-navigator`** — exploration specialist that prefers semantic queries over blind file reads. Protects the parent agent's context during large investigations.

## Install

```bash
# user scope (~/.claude), default
apps/claude-plugin/install.sh

# or project scope (./.claude)
apps/claude-plugin/install.sh --project
```

Restart Claude Code to pick up the new commands.

## Prerequisites

The massa-ai MCP server must be registered for Claude Code. See `apps/mcp-client/README.md`.

A quick check after install:

```
/massa-ai-status
```

If nothing shows up, the MCP server probably isn't running — start it with the dev-server command from the massa-ai repo.
