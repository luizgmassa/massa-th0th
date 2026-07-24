# Codex + Cursor Plugin Parity — Context

## Trigger

Gray areas: native plugin API existence for Codex and Cursor, whether `@codex-native/sdk` is official, whether Cursor's hook event set is still limited to 3, and whether hook configs should be auto-written. Resolved via web research (Knowledge Verification Chain Step 4) and user input (scope selection).

## Resolved Gray Areas

### 1. Cursor native extension/plugin API

**Verified accurate.** `cursor.com/docs/extension-api.md` documents:
- `vscode.cursor.mcp.registerServer(config)` / `unregisterServer(name)` — programmatic MCP registration (not just `mcp.json` config).
- `vscode.cursor.plugins.registerPath(path)` / `unregisterPath(path)` — points Cursor at a directory; Cursor auto-discovers `skills/`, `rules/`, `agents/`, `commands/`, `mcp.json`, `hooks/hooks.json`.
- A TypeScript `declare module "vscode"` block is published for type-checking.

**Cursor is a VS Code fork** using Open VSX. The `vscode.cursor.*` namespaces are Cursor-specific, layered on the VS Code extension host. VS Code's base `vscode.*` API does NOT expose AI agent-loop hooks or MCP registration.

### 2. Cursor hook event set (the historical gap)

**The codebase's "Cursor only has 3 events (beforeSubmitPrompt, afterFileEdit, stop — no SessionStart, no PreCompact" claim is OUT OF DATE.** `cursor.com/docs/hooks.md` documents 18+ events:
- `sessionStart`, `sessionEnd`, `preToolUse`, `postToolUse`, `postToolUseFailure`, `beforeSubmitPrompt`, `preCompact`, `stop`, `subagentStart`, `subagentStop`, `beforeShellExecution`, `afterShellExecution`, `beforeMCPExecution`, `afterMCPExecution`, `beforeReadFile`, `afterFileEdit`, `beforeTabFileRead`, `afterTabFileEdit`, `afterAgentResponse`, `afterAgentThought`, `workspaceOpen`.

Hooks are subprocess + JSON stdio (not in-process JS callbacks). This feature wires the mappable subset: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `preCompact`, `stop`. This closes the historical `sessionStart`/`preCompact` gap.

### 3. Codex native plugin API

**Verified accurate.** `developers.openai.com/codex/plugins` and `/codex/build-plugins` document:
- `/plugins` slash command opens a plugin browser in Codex CLI.
- A plugin is a directory with `.codex-plugin/plugin.json` manifest containing `skills/`, `.mcp.json`, `.app.json`, `hooks/`.
- Skills are `SKILL.md` files (markdown + YAML frontmatter) invoked via `$` mentions in Codex.
- Plugins bundle `.mcp.json` for MCP server config (so MCP registration can be part of the plugin, not just `install-agents.ts`).
- `codex plugin marketplace add <url>` adds a marketplace source.

### 4. `@codex-native/sdk` — NOT official

**The user's claim that "OpenAI provides the @codex-native/sdk" is INACCURATE.** npm research:
- `@codex-native/sdk` (v0.0.38, publisher `zackljackson`, 4 downloads/wk, 0 dependents) is a **third-party** community package. It is not in the `openai/codex` repo's `sdk/` directory and not mentioned in official docs.
- The **official** OpenAI SDK is `@openai/codex-sdk` (v0.145.0, publisher `openai-publisher` + 16 OpenAI collaborators, 1.59M downloads/wk, 312 dependents, Apache-2.0). It wraps the CLI via child process / JSONL, not Rust bindings.

**Decision: do NOT depend on `@codex-native/sdk`.** Use the manifest-based plugin system + shell/Bun hooks. This matches the claude-plugin pattern (no npm SDK).

### 5. Codex hook events

**Verified.** `developers.openai.com/codex/hooks` documents 10 events: `SessionStart`, `SubagentStart`, `PreToolUse`, `PermissionRequest`, `PostToolUse`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, `SubagentStop`, `Stop`. Sources: `~/.codex/hooks.json`, `~/.codex/config.toml` (inline `[hooks]`), repo `.codex/hooks.json`, plugin-bundled `hooks/hooks.json`, enterprise `requirements.toml`. All hooks are shell-command-based (`type: "command"`). `/hooks` slash command reviews/trusts hooks.

### 6. Hook config auto-write vs print

**User selected "Full parity" scope** → auto-write. The existing `install.sh:print_hooks_guide` prints (never writes) to avoid clobbering user config. This feature's per-plugin `install.sh` will auto-write with the same safety conventions as `install-agents.ts`: backup (`.massa-ai.bak-<ts>`), ownership marker (`_massaAiOwned`), and home-write consent gate.

## Existing Plugin Patterns (from codebase exploration)

### apps/claude-plugin (script-copy, NOT npm)

- No `package.json`/`tsconfig.json`. Versioned by repo/git.
- `install.sh --user` (→ `~/.claude`) or `--project` (→ `./.claude`). Copies `commands/*.md` (prefixed `massa-ai-`) + `agents/massa-ai-navigator.md`. Does NOT copy hooks (wired via `settings.json.template` merge).
- Hooks: 5 shell scripts + `massa-ai-hook.ts` binary (Wave 6 N30). `EVENT_MAP` maps subcommands → 5 lifecycle kinds. Pin resolution: existing pin → `MASSA_AI_PROJECT_ID` → git toplevel basename → cwd basename. pre-compact does dual-POST (3s observation + 5s snapshot). Always exit 0.
- `settings.json.template` is a ready-to-merge hooks block with `${CLAUDE_PLUGIN_ROOT}` placeholder.

### apps/opencode-plugin (npm package)

- `@massa-ai/opencode-plugin@1.1.0`, `main: dist/index.js`, deps `@opencode-ai/plugin` + `@opencode-ai/sdk`.
- Exports `MassaAiPlugin: Plugin` returning `{ tool: {13 tools}, session.created, tool.execute.after, experimental.session.compacting, shell.env, event, dispose }`.
- `ObservationEmitter` batches `HookEvent` objects → `POST /api/v1/hook/batch`.
- `SessionProjectPin` keeps a stable projectId per session.

### scripts/install-agents.ts (MCP installer, NOT hooks)

- `AgentName = "claude-code" | "claude-desktop" | "codex" | "cursor" | "opencode"`.
- Codex: writes `~/.codex/config.toml` `[mcp_servers.massa-ai]` (hand-rolled TOML, ownership marker).
- Cursor: writes `~/.cursor/mcp.json` `mcpServers.massa-ai` (JSON, same as claude-code).
- **Does NOT write hooks** — those are printed by the root `install.sh:print_hooks_guide` to `~/.codex/hooks.json` and `~/.cursor/hooks.json`.
- **Key divergence**: MCP config path ≠ hooks config path for both Codex and Cursor. The new plugins must not collide with `install-agents.ts`'s MCP files.

## Plan Challenge (Pre-Mortem) Results

Ran full The Fool in pre-mortem mode (escalated by lite gate: spec-driven + >5 files + HOME-write high-risk domain). 5 failure narratives. Critical finding F1 (Cursor API hallucinated) was **FALSIFIED** by direct webfetch of `cursor.com/docs/extension-api` and `cursor.com/docs/hooks` — the API and 18+ events are real and documented. Valid findings F2-F5 incorporated into the spec:

- **F2 (Codex trust gate)**: Plugin-bundled hooks are non-managed and skipped until trusted via `/hooks`. Added blocking warning to CPX-05.
- **F3 (unmappable events)**: API `LIFECYCLE_EVENTS` has 6 kinds; binary `EVENT_MAP` has 5 keys. Reduced Codex wiring from "10 events" to "6 cleanly-mappable events" to avoid silent no-ops or lossy misclassification.
- **F4 (MCP double-registration)**: Plugin `.mcp.json` + `install-agents.ts` config could duplicate the MCP server. Added deconfliction hint to CPX-04/CRS-04 and INS-03.
- **F5 (array merge clobber)**: `deepMerge` replaces arrays, which would clobber user hooks in `hooks.json`. Added hooks-specific append/remove merge to the assumptions table.

## Key Evidence

- Codex `/plugins` + plugin manifest: `developers.openai.com/codex/plugins`, `/codex/build-plugins`
- Codex hooks (10 events): `developers.openai.com/codex/hooks`
- `@codex-native/sdk` third-party: `npmjs.com/package/@codex-native/sdk` (publisher `zackljackson`, 4 dl/wk)
- `@openai/codex-sdk` official: `npmjs.com/package/@openai/codex-sdk` (publisher `openai-publisher`, 1.59M dl/wk)
- Cursor extension API: `cursor.com/docs/extension-api.md` (`vscode.cursor.mcp`, `vscode.cursor.plugins`)
- Cursor hooks (18+ events): `cursor.com/docs/hooks.md`
- Cursor skills: `cursor.com/docs/skills.md`, `cursor.com/docs/reference/plugins.md`
- Codebase: `apps/claude-plugin/install.sh:1-59`, `apps/claude-plugin/hooks/massa-ai-hook.ts:36-42,61-111,249-274`, `apps/opencode-plugin/package.json:1-47`, `apps/opencode-plugin/src/index.ts:118-770`, `scripts/install-agents.ts:45-50,296-324,391-465,482-488`, root `install.sh:484-577`

## Phase 4 Extension — Four-Plugin Installer Parity

### Trigger

User requested extending the feature to wire Claude Code and OpenCode into the root `install.sh` plugin menu alongside Codex/Cursor (Phases 1-3), and extend passive-capture hooks auto-write for all four tools.

### Resolved Gray Areas

#### 1. Claude Code hooks auto-write vs print-only

**The existing `apps/claude-plugin/install.sh` copies slash commands + agents but does NOT write hooks.** Hooks are delivered via `settings.json.template` — a print-only merge guide the user must manually merge into `~/.claude/settings.json`. Phase 4 upgrades this to auto-write using the same array-append + ownership-marker + backup conventions as Codex/Cursor.

**Claude Code `settings.json` shape**: the hooks block uses a nested matcher-group + `hooks[]` form (different from Codex's flat array and Cursor's `{version, hooks}` wrapper). The merge must:
1. Read existing `~/.claude/settings.json` (if exists)
2. Back up (`.massa-ai.bak-<timestamp>`)
3. Merge the `hooks` key: for each of the 5 Claude events (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop), append the massa-ai hook entry to the matcher-group array if no owned entry exists
4. Write back with `_massaAiOwned: true` marker on each owned entry

The command path uses `bun run "${CLAUDE_PLUGIN_ROOT}/hooks/massa-ai-hook.ts" <subcommand>` where `CLAUDE_PLUGIN_ROOT` is resolved to the installed plugin directory at install time.

**Decision**: Extend `apps/claude-plugin/install.sh` to auto-write hooks into `settings.json` (in addition to the existing command/agent copy). Keep the `settings.json.template` as documentation but the installer now writes directly.

#### 2. OpenCode plugin install path

**OpenCode is an npm plugin (`@massa-ai/opencode-plugin`), not a script-copy bundle.** It has no `install.sh`. The plugin is installed via `npm install @massa-ai/opencode-plugin` (or `bun add`) and configured in `~/.config/opencode/opencode.json` under the `plugin` array. From source, it's `bun run apps/opencode-plugin/src/index.ts` linked via the opencode config.

**OpenCode hooks are in-process** — the `MassaAiPlugin` function registers lifecycle handlers (`session.created`, `tool.execute.after`, `experimental.session.compacting`, `shell.env`, `event`, `dispose`) directly in the plugin's return object. There is NO external `hooks.json` file to auto-write. The hooks fire when the plugin is loaded by OpenCode.

**Decision**: The root menu OpenCode option invokes the npm install (or source build + config snippet print). No hooks.json auto-write is needed for OpenCode — the hooks are built into the plugin code itself. The menu prints the `opencode.json` config snippet the user needs to add.

#### 3. Menu structure

The existing `install_plugins_menu()` (from Phase 3, T12) offers: 1) Codex, 2) Cursor, 3) Both. Phase 4 extends this to: 1) Claude Code, 2) Codex, 3) Cursor, 4) OpenCode, 5) All four, s) Back. Each invokes the respective installer with `--user` (default) or `--project`.

### Key Evidence (Phase 4)

- Claude Code `settings.json` hooks shape: `apps/claude-plugin/settings.json.template:1-68` (nested matcher-group + `hooks[]` form)
- Claude Code install.sh (current, no hooks auto-write): `apps/claude-plugin/install.sh:1-59`
- OpenCode plugin entry point: `apps/opencode-plugin/src/index.ts:118-770` (in-process hooks via Plugin return object)
- OpenCode package.json: `apps/opencode-plugin/package.json:1-47` (`@massa-ai/opencode-plugin@1.1.0`)
- Root install.sh `install_plugins_menu()`: added in Phase 3 T12 (current menu has Codex/Cursor/Both)
- `install-agents.ts` ClaudeCodeWriter: `scripts/install-agents.ts:296-301` (JSON MCP writer, extends JsonMcpWriter)