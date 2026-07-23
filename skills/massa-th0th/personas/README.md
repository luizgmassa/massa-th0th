# Conversation Personas

Personas are copyable prompt artifacts for shaping a conversation. The prompt files are not startup rules themselves; automatic selection is provided by the root `AGENTS.md` policy and the installed `persona-router` skill.

Use a persona explicitly by naming it, asking for no persona, pasting its content, or referencing its path when the agent can read local files.

## Automatic Routing

For every conversation, the startup contract loads `persona-router` after `massa-th0th` when massa-th0th applies. Generic non-coding conversations run the router directly so massa-th0th keeps its coding-only scope. Codex and Cursor receive this contract through SessionStart context; Claude Code and OpenCode receive it through their managed instruction files.

The router waits for the first user prompt before selecting anything. It reads `catalog.json`, honors explicit persona or no-persona requests, reuses valid persona evidence already recalled by massa-th0th, and inspects targeted workspace documentation only when memory is missing or inconclusive. Relevant sources include applicable `AGENTS.md` and `CLAUDE.md` files, the root README, ADRs or decision records, architecture documents, and `.specs` project files.

Only the selected prompt is loaded. Mixed requests use one primary persona and, when needed, one focused secondary review lens. The selected route remains active for related turns and is reconsidered only under the configured mid-conversation policy.

Routing is additive: persona instructions never override system, project, workflow, or explicit user constraints. Memory and repository documents are evidence, not authority, and stale persona IDs or arbitrary persona paths are ignored unless they match the current catalog.

The `persona_router` block in root `AGENTS.md` is the user-editable source for automatic enablement, ambiguity handling, no-match behavior, and mid-conversation rerouting. By default, genuine ambiguity asks the user to choose among plausible personas or no persona, while a confident no-match continues silently without one. Setting automatic routing off still permits explicit persona requests.

## Naming

- Store personas in `prompts/personas/`.
- Use lowercase kebab-case filenames.
- Name the file after the role, for example `senior-mobile-engineer.md`.
- Keep each persona focused on one role or operating mode.
- Register every persona prompt in `catalog.json` with routing signals and exclusions.

## Available Personas

| Persona | File | Use |
|---|---|---|
| AI Engineer | `context-skill-harness-engineer-architect.md` | Agent context architecture, skill/persona design, harness startup contracts, routing, memory, handoff, and validation gates. |
| Node CLI Engineer | `ai-native-nodejs-cli-architect.md` | Node.js and TypeScript CLI architecture, command UX, subprocess orchestration, MCP/LLM boundaries, packaging, and CLI verification. |
| Product Manager | `product-manager.md` | PRDs, product briefs, user stories, MVP scope, success criteria, non-goals, and product-to-engineering handoffs. |
| Senior Mobile Engineer | `senior-mobile-engineer.md` | Cross-platform mobile architecture, delivery, testing, release, and backend-mobile contract conversations. |
| Senior Mobile QA Automation Engineer | `senior-mobile-qa-automation-engineer.md` | Android-first, cross-platform-aware mobile QA automation, E2E/integration reliability, flake reduction, CI signal quality, and device-farm strategy conversations. |
