---
description: Index the current working directory with massa-th0th
argument-hint: "[projectId]"
allowed-tools: ["mcp__massa-th0th__index_project", "mcp__massa-th0th__index_status", "Bash(pwd)"]
---

Kick off a massa-th0th indexing job for the current directory.

Steps:
1. Run `pwd` to get the absolute path of the current working directory.
2. Determine `projectId`:
   - If the user passed `$1`, use it as projectId.
   - Otherwise use the basename of the directory (last path segment).
3. Call `mcp__massa-th0th__index_project` with `projectPath=<pwd>`, `projectId=<chosen>`, and `forceReindex=true` only if the user explicitly asked to force.
4. Get the `jobId` back and poll `mcp__massa-th0th__index_status` with that jobId every ~10 seconds until status is `indexed` or `error`.
5. Report progress succinctly: percentage, ETA, fileProcessed counters when available. Do not spam.
6. On completion, show a one-line summary: `Indexed <projectId>: <files> files / <chunks> chunks / <duration>`.

Never re-trigger indexing if there's already an in-flight job for the same projectId (check via `list_projects` first).
