---
description: Show massa-ai health and indexed projects status
allowed-tools: ["mcp__massa-ai__list_projects", "mcp__massa-ai__analytics"]
---

Show a health snapshot of the massa-ai installation.

1. Call `mcp__massa-ai__list_projects` with `status=all`.
2. Call `mcp__massa-ai__analytics` with `type=summary`.
3. Render:
   - A table of workspaces: projectId | status | filesCount | chunksCount | lastIndexedAt
   - Totals: searches performed, unique queries, cache hit rate, top queries
   - Flag anything unusual: a workspace stuck in `indexing`, a workspace in `error`, or cache hit rate below 30%.

Keep it dense — one screen.