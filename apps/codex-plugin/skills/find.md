---
description: Semantic search in an indexed project (massa-ai)
argument-hint: "<query>"
allowed-tools: ["mcp__massa-ai__search", "mcp__massa-ai__list_projects"]
---

Run a semantic code search with massa-ai.

Query: `$ARGUMENTS`

Steps:
1. Resolve the active project:
   - Prefer the projectId of the cwd if it's already indexed (call `list_projects` and match by path basename).
   - If ambiguous, ask the user.
2. Call `mcp__massa-ai__search` with `query="$ARGUMENTS"`, `projectId=<resolved>`, `limit=10`.
3. Return a ranked list of hits: `filePath:lineStart-lineEnd — score — label`. For the top 3 results, include 3-5 lines of the matched snippet.
4. If 0 results, check whether vector store has orphaned chunks (look at previous `/map` output or prompt the user to `/index` with `forceReindex=true`).

Keep the output scannable — no walls of text.