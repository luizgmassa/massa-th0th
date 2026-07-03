---
description: Find symbol definitions (functions, classes, types) in an indexed project
argument-hint: "<symbolName> [kind]"
allowed-tools: ["mcp__massa-th0th__search_definitions", "mcp__massa-th0th__go_to_definition", "mcp__massa-th0th__list_projects"]
---

Find symbol definitions via massa-th0th.

Arguments: `$ARGUMENTS` (first token is symbolName, optional second is a kind filter like `class` or `function`).

Strategy:
1. If the user gave only a name, call `mcp__massa-th0th__go_to_definition` first — it's cheaper and usually exact.
2. If 0 results, fall back to `mcp__massa-th0th__search_definitions` with `search=<name>` and optional `kind=<kind>`.
3. Render a table: `name | kind | file:lineStart-lineEnd | exported | centralityScore`.
4. If the user asked a follow-up like "show me", offer to run `mcp__massa-th0th__search` for code snippets or `get_references` for callers.

Resolve projectId from the cwd unless user specifies.
