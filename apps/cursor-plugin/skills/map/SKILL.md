---
description: Show the massa-ai project map for an indexed workspace
argument-hint: "[projectId]"
allowed-tools: ["mcp__massa-ai__project_map", "mcp__massa-ai__list_projects"]
---

Show a project map using massa-ai.

If the user provided `$1` as an argument, use it as the `id` (projectId) for `mcp__massa-ai__project_map`.

Otherwise:
1. Call `mcp__massa-ai__list_projects` to see indexed projects.
2. If exactly one project is indexed, use it automatically.
3. If multiple, ask the user which one.
4. If zero, tell the user to run `/index` first.

Then render the result as a compact summary:
- Total files / chunks / symbols and last indexed time
- Top 10 central files with their scores
- Symbols by kind (table)
- Files by language (inline list)
- 3 most recent files

Do not dump raw JSON. Format for human reading.
