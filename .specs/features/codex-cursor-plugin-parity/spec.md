# Codex + Cursor Plugin Parity Specification

## Problem Statement

massa-th0th ships first-class plugin packages for Claude Code (`apps/claude-plugin/`, script-copy bundle) and OpenCode (`apps/opencode-plugin/`, npm package), but has **no plugin packages for Codex or Cursor**. Both tools currently receive only MCP server registration via `scripts/install-agents.ts` and a printed (never auto-written) hooks config guide via the root `install.sh:print_hooks_guide`. Web research (2026-07-23) confirmed both tools now have real native plugin systems that massa-th0th is not using: Codex has a `/plugins` command + `.codex-plugin/plugin.json` manifest + `skills/` + `.mcp.json` + `hooks/`, and Cursor has `vscode.cursor.plugins.registerPath` + `vscode.cursor.mcp.registerServer` + a `hooks.json` event system covering 18+ events (including `sessionStart` and `preCompact`, which the codebase's "Cursor only has 3 events" claim marks as out of date).

## Goals

- [ ] Create `apps/codex-plugin/` as a native Codex plugin bundle (skills + hooks + MCP manifest + slash commands) that installs via `codex plugin` / marketplace or manual copy
- [ ] Create `apps/cursor-plugin/` as a native Cursor plugin bundle (skills + hooks + MCP + commands) that installs via `vscode.cursor.plugins.registerPath` or marketplace
- [ ] Auto-write hook configs (not just print guides) for Codex and Cursor, respecting the ownership-marker + backup + consent-gate conventions established by `scripts/install-agents.ts`
- [ ] Wire the full Codex hook event set (10 events) and the full Cursor hook event set (18+ events, including the previously-missing `sessionStart`, `sessionEnd`, `preCompact`)
- [ ] Keep the existing fire-and-forget, always-exit-0, pin-resolution, pre-compact-dual-POST contracts intact
- [ ] Update README, `.env.example`, and root `install.sh` to reflect the new packages
- [ ] **Phase 4:** Wire Claude Code and OpenCode plugins into the root `install.sh` plugin sub-menu alongside Codex and Cursor, and extend passive-capture hooks auto-write for all four tools (Codex, Claude, OpenCode, Cursor) so a single menu entry can install any or all plugins with hooks + skills + MCP

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| Native npm SDK plugin for Codex using `@codex-native/sdk` | `@codex-native/sdk` is a third-party package (publisher `zackljackson`, 4 downloads/wk), NOT official OpenAI. Official SDK is `@openai/codex-sdk` (child-process/JSONL, not Rust bindings). We will not depend on a third-party Rust-binding SDK. |
| Native npm VS Code extension for Cursor via `@cursor/sdk` | Out of scope: massa-th0th ships a hook-script + config bundle, not a compiled VS Code extension. `vscode.cursor.plugins.registerPath` auto-discovers a directory layout, so we ship a discoverable directory, not a compiled `.vsix`. |
| `apps/claude-desktop` plugin or hooks | Claude Desktop gets MCP registration only (macOS); no hook support documented. Not a gap this feature addresses. |
| Server-side changes to the hook ingestion contract | The 6 lifecycle event kinds (`session-start`, `user-prompt`, `pre-tool-use`, `post-tool-use`, `pre-compact`, `session-end`) and the `/api/v1/hook`, `/api/v1/hook/batch`, `/api/v1/hook/compact-snapshot` routes are unchanged. New Cursor/Codex events map onto existing kinds. |
| Embedding cache L1, re-indexing, search, or any non-plugin work | Not this feature. See the cache exploration report. |
| Programmatic JS hook callbacks in Cursor (`vscode.cursor.hooks.register*`) | No such API is documented; hooks are config-driven subprocess + JSON stdio. We ship `hooks.json` + scripts, not in-process functions. |
| Marketplace publication (Codex marketplace JSON, Cursor marketplace submission) | The plugin bundles are installable from the repo or via manual copy. Marketplace publication is a separate operational step the user may take later. We will produce a valid `marketplace.json` shape for Codex so publication is possible, but we will not publish. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| Codex plugin shape | Directory bundle with `.codex-plugin/plugin.json` manifest, `skills/`, `hooks/`, `.mcp.json`, and slash commands — NOT an npm package | Official Codex docs (`developers.openai.com/codex/build-plugins`) define this manifest-based bundle. No npm package needed because Codex discovers plugins via marketplace path or manual copy. Mirrors `apps/claude-plugin` (no package.json). | y (web research) |
| Cursor plugin shape | Directory bundle with `skills/`, `hooks/hooks.json`, `mcp.json`, `commands/`, `agents/` — discovered via `vscode.cursor.plugins.registerPath` or copied into `~/.cursor/` | Official Cursor docs (`cursor.com/docs/extension-api.md`, `/docs/reference/plugins.md`) confirm `registerPath` auto-discovers these subdirectories. No `.vsix` compilation needed. Mirrors `apps/claude-plugin`. | y (web research) |
| Codex hook events to wire | 6 of 10 documented events mapped to the 6 lifecycle kinds: `SessionStart`→`session-start`, `UserPromptSubmit`→`user-prompt`, `PreToolUse`→`pre-tool-use`, `PostToolUse`→`post-tool-use`, `PreCompact`→`pre-compact`, `Stop`→`session-end`. The other 4 (`PostCompact`, `PermissionRequest`, `SubagentStart`, `SubagentStop`) are documented but NOT wired because they have no clean lifecycle-kind mapping and mapping them lossy would pollute the data model. | Official Codex hooks docs (`developers.openai.com/codex/hooks`) list 10 events. The API's `LIFECYCLE_EVENTS` enum (`hook-service.ts:94-102`) accepts exactly 6 kinds. The binary's `EVENT_MAP` (`massa-th0th-hook.ts:36-42`) has 5 keys. F3 mitigation: wire only the 6 cleanly-mappable events. | y (web research + codebase) |
| Cursor hook events to wire | 7 mappable events: `sessionStart`→`session-start`, `sessionEnd`→`session-end`, `beforeSubmitPrompt`→`user-prompt`, `preToolUse`→`pre-tool-use`, `postToolUse`→`post-tool-use`, `preCompact`→`pre-compact` (dual-POST), `stop`→`session-end` | Official Cursor hooks docs (`cursor.com/docs/hooks`, verified live 2026-07-23). Confirms 18+ events including `sessionStart` and `preCompact`. The codebase's "Cursor only has 3 events" is OUT OF DATE. `preCompact` and `sessionStart` are now supported, fixing the historical gap. | y (web research, directly verified) |
| Codex hook trust gate | The installer SHALL print a BLOCKING warning (not just a hint) after install: "Run `/hooks` in Codex to trust massa-th0th hooks, or no observations will be captured." | Codex docs confirm plugin-bundled hooks are non-managed and skipped until trusted via `/hooks`. F2 mitigation. | y (web research) |
| MCP deconfliction | The plugin's `.mcp.json` (Codex) / `mcp.json` (Cursor) is the canonical MCP source when the plugin is installed. `install-agents.ts --agent codex/cursor` SHALL print a hint: "If you installed the massa-th0th plugin, MCP is already registered — skip this." The two installers target different files (plugin dir vs `~/.codex/config.toml` / `~/.cursor/mcp.json`), but both register the same server name, so dual install could duplicate. | F4 mitigation. Codex/Cursor may load MCP from both the plugin manifest and the user config, causing double-registration. | y (codebase + web research) |
| hooks.json array merge | The installer SHALL append the massa-th0th hook to each event's array (not replace the array). Uninstall removes by command-path match. Uses a hooks-specific merge (not `deepMerge` which replaces arrays). | hooks.json is `{ "version": 1, "hooks": { "<event>": [{ "command": "..." }] } }` — arrays per event. F5 mitigation: `deepMerge` replaces arrays, which would clobber user hooks. | y (codebase + web research) |
| Hook config auto-write | Yes — `apps/codex-plugin/install.sh` and `apps/cursor-plugin/install.sh` will auto-write the hooks config (with backup + ownership marker + consent gate), replacing the print-only guide for these tools | User selected "Full parity" scope. Matches `install-agents.ts` conventions (`_massaTh0thOwned`, `.massa-th0th.bak-<ts>`, `assertHomeWriteConsent`). | y (user) |
| Hook config paths | Codex: `~/.codex/hooks.json` (separate from `~/.codex/config.toml` which `install-agents.ts` owns for MCP). Cursor: `~/.cursor/hooks.json` (separate from `~/.cursor/mcp.json` which `install-agents.ts` owns for MCP). | Matches the existing `install.sh:print_hooks_guide` paths. Keeps MCP and hooks config in separate files so the two installers don't collide. | y (codebase) |
| Hook script reuse | Reuse the single `massa-th0th-hook.ts` Bun binary from `apps/claude-plugin/hooks/` (platform-neutral) as the shared emitter. Add Codex/Cursor-specific wrapper scripts or config that point at the binary. | Wave 6 N30 made the binary platform-neutral (`install.sh:486-488` "only the config wrapper differs"). Avoids duplicating 7 shell scripts. | y (codebase) |
| pre-compact dual-POST | Codex: yes (PreCompact event supported). Cursor: yes (preCompact event now supported, fixing the historical gap). | Both tools now support preCompact per web research. The binary's `pre-compact` subcommand already does the 3s observation + 5s snapshot dual-POST. | y (web research + codebase) |
| Skill content | Each plugin ships the same 6 slash commands as `apps/claude-plugin/commands/` (map, index, find, def, graph, status) as Codex `SKILL.md` files and Cursor `skills/SKILL.md` files. | Reuse existing command content; only the file format (Codex `SKILL.md` with YAML frontmatter vs Claude `.md` with frontmatter) differs. Cursor skills follow the `SKILL.md` standard (`cursor.com/docs/skills.md`). | y (codebase + web research) |
| Subagent | Codex: no native subagent concept in the plugin manifest; skip. Cursor: supports `agents/` in a registered plugin path; ship `massa-th0th-navigator.md` (reuse claude-plugin's). | Codex plugin manifest has no `agents/` field per docs. Cursor auto-discovers `agents/` per `registerPath` docs. | y (web research) |
| Installer idempotency | Both `install.sh` scripts are idempotent: re-running is a no-op unless `--force`. Hooks config writes use the ownership-marker so re-runs update only the owned block. | Matches `install-agents.ts` and `apps/claude-plugin/install.sh` conventions. | y (codebase) |
| `@codex-native/sdk` dependency | NOT used — it is a third-party package, not official OpenAI. We use only the manifest-based plugin system + shell/Bun hooks. | npm research: publisher `zackljackson`, 4 downloads/wk, 0 dependents, absent from `openai/codex` repo and official docs. | y (web research) |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Codex plugin bundle ⭐ MVP

**User Story**: As a Codex CLI user, I want a `massa-th0th` plugin I can install via `codex plugin` or manual copy, so that I get massa-th0th slash commands, MCP tools, and passive lifecycle capture inside Codex.

**Why P1**: Codex is one of the two tools the user explicitly named. It currently has no plugin package at all.

**Acceptance Criteria**:

1. WHEN a user runs `apps/codex-plugin/install.sh --user` THEN the system SHALL create `~/.codex/plugins/massa-th0th/` containing `.codex-plugin/plugin.json`, `skills/*.md`, `hooks/hooks.json`, `.mcp.json`, and the `massa-th0th-hook` binary (or a symlink to the repo copy), with an ownership marker on the plugin manifest
2. WHEN a user runs `apps/codex-plugin/install.sh --project` THEN the system SHALL create `./.codex/plugins/massa-th0th/` with the same structure under the current project
3. WHEN the Codex plugin is installed AND the user starts a Codex session THEN the `skills/` directory SHALL expose the 6 slash commands (map, index, find, def, graph, status) invocable via Codex's `$` mention
4. WHEN the Codex plugin is installed AND `.mcp.json` is present THEN Codex SHALL auto-discover the massa-th0th MCP server (command `npx @massa-th0th/mcp-client` with `MASSA_TH0TH_API_URL` env) without a separate `install-agents.ts` run for that scope. The installer SHALL print a hint: "If you also run `install-agents.ts --agent codex`, skip MCP — the plugin already registers it."
5. WHEN Codex hooks are trusted (via `/hooks`) AND a Codex lifecycle hook fires (any of the 6 wired events) THEN the `massa-th0th-hook` binary SHALL POST to `/api/v1/hook` (single) or `/api/v1/hook/batch` with a 2s timeout, always exit 0, and never block the agent. The installer SHALL print a blocking warning after install: "Run `/hooks` in Codex to trust massa-th0th hooks, or no observations will be captured."
6. WHEN the `PreCompact` event fires THEN the binary SHALL do the dual-POST (3s observation + 5s snapshot to `/api/v1/hook/compact-snapshot`) before exiting
7. WHEN a user runs `apps/codex-plugin/install.sh --uninstall` THEN the system SHALL remove only the ownership-marked plugin directory and the ownership-marked hooks block, preserving any user-added config
8. WHEN `HOOKS_ENABLED=false` on the API THEN hook POSTs SHALL receive HTTP 423 and the binary SHALL silently exit 0 (no retry, no stderr noise beyond the breadcrumb-on-fire log)

**Independent Test**: Install the plugin into a temp HOME, start the tools-api (`bun run dev:api`), run a Codex session or simulate a hook event via `echo '{}' | bun apps/claude-plugin/hooks/massa-th0th-hook.ts session-start`, and confirm an Observation row appears in PG.

---

### P2: Cursor plugin bundle

**User Story**: As a Cursor user, I want a `massa-th0th` plugin directory I can register via `vscode.cursor.plugins.registerPath` or copy into `~/.cursor/`, so that I get skills, MCP tools, and the full lifecycle hook coverage (including `sessionStart` and `preCompact`, which were previously missing).

**Why P2**: Cursor is the second tool the user named. The current codebase only wires 3 of its now-18+ hook events and only prints the config.

**Acceptance Criteria**:

1. WHEN a user runs `apps/cursor-plugin/install.sh --user` THEN the system SHALL create `~/.cursor/plugins/massa-th0th/` containing `skills/*.md`, `hooks/hooks.json`, `mcp.json`, `commands/*.md`, and `agents/massa-th0th-navigator.md`, with an ownership marker
2. WHEN a user runs `apps/cursor-plugin/install.sh --project` THEN the system SHALL create `./.cursor/plugins/massa-th0th/` under the current project
3. WHEN the Cursor plugin is installed THEN `hooks/hooks.json` SHALL wire the mappable lifecycle events: `sessionStart`→`session-start`, `sessionEnd`→`session-end`, `beforeSubmitPrompt`→`user-prompt`, `preToolUse`→`pre-tool-use`, `postToolUse`→`post-tool-use`, `preCompact`→`pre-compact` (dual-POST), `stop`→`session-end`
4. WHEN the Cursor plugin is installed AND `mcp.json` is present THEN Cursor SHALL auto-discover the massa-th0th MCP server without a separate `install-agents.ts` run for that scope. The installer SHALL print a hint: "If you also run `install-agents.ts --agent cursor`, skip MCP — the plugin already registers it."
5. WHEN the `preCompact` event fires THEN the binary SHALL do the dual-POST (3s observation + 5s snapshot) — fixing the historical gap where Cursor had no preCompact
6. WHEN the `sessionStart` event fires THEN the binary SHALL POST a `session-start` observation — fixing the historical gap where Cursor had no SessionStart
7. WHEN a user runs `apps/cursor-plugin/install.sh --uninstall` THEN the system SHALL remove only the ownership-marked plugin directory and hooks block
8. WHEN the plugin directory is registered via `vscode.cursor.plugins.registerPath("/abs/path")` THEN Cursor SHALL auto-discover `skills/`, `hooks/`, `mcp.json`, `agents/` inside it (verified by the directory layout matching the documented manifest)

**Independent Test**: Install the plugin into a temp HOME, confirm `hooks/hooks.json` contains the `sessionStart` and `preCompact` keys, simulate a `preCompact` hook, and confirm both the observation and snapshot POSTs hit the API.

---

### P3: Installer integration + docs

**User Story**: As a user setting up massa-th0th, I want the root `install.sh` and `install-agents.ts` to offer Codex/Cursor plugin installation, and the README to document it, so that I don't need to find the per-plugin installers manually.

**Why P3**: Discoverability. The plugin bundles exist but users won't find them without wiring into the root installer menu and docs.

**Acceptance Criteria**:

1. WHEN a user runs the root `install.sh` post-install menu THEN the menu SHALL offer a choice to install Codex and/or Cursor plugins (in addition to the existing MCP registration + hooks guide)
2. WHEN the root `install.sh` runs the Codex/Cursor plugin install THEN it SHALL invoke `apps/codex-plugin/install.sh` / `apps/cursor-plugin/install.sh` with the same scope flag
3. WHEN `install-agents.ts --agent codex` or `--agent cursor` runs THEN it SHALL print a hint pointing to the new plugin installer for hooks/skills (MCP config itself is unchanged)
4. WHEN the README integration section is read THEN it SHALL document the Codex and Cursor plugin packages with install commands, what they bundle, and the events wired
5. WHEN `.env.example` is read THEN the hook env vars section SHALL note that Codex/Cursor now support the full event set (remove the stale "Cursor has NO SessionStart and NO PreCompact" note)

**Independent Test**: Run the root `install.sh` and confirm the menu offers the Codex/Cursor plugin choice; grep README for the new package names.

---

## Edge Cases

- WHEN the tools-api is unreachable (connection refused) THEN hook POSTs SHALL fail silently within the timeout (2s/3s/5s) and the binary SHALL exit 0 — never block the agent
- WHEN `MASSA_TH0TH_PROJECT_ID` is unset AND no pin file exists AND `git rev-parse` fails (not a git repo) THEN the binary SHALL fall back to `cwd` basename and still POST
- WHEN the hook payload exceeds `HOOKS_MAX_PAYLOAD_BYTES` (65536) THEN the API SHALL return 413 and the binary SHALL exit 0 (no retry)
- WHEN the hook queue is saturated (pending > 256) THEN the API SHALL return 429 and the binary SHALL exit 0 (no retry; the breadcrumb-on-fire log fires if the deadline is exceeded)
- WHEN a user re-runs the installer with no changes THEN it SHALL be a no-op (ownership marker detects the existing block)
- WHEN a user has a manual `massa-th0th` block in `~/.codex/hooks.json` or `~/.cursor/hooks.json` (no ownership marker) THEN the installer SHALL back up the file (`.massa-th0th.bak-<ts>`) and merge without clobbering the user's keys
- WHEN Codex `/hooks` trust is required (non-managed hooks are skipped until trusted) THEN the installer SHALL print a hint to run `/hooks` in Codex
- WHEN stdin is a terminal (char device) THEN the binary SHALL NOT attempt to read stdin and SHALL exit 0 with no POST (matches `massa-th0th-hook.ts:115-125`)
- WHEN stdin JSON is malformed THEN the binary SHALL exit 0 with no POST (matches `:222-233`)

---

### P4: Four-plugin installer parity + passive-capture for all

**User Story**: As a user setting up massa-th0th, I want the root `install.sh` plugin menu to offer ALL four supported coding tools (Claude Code, Codex, Cursor, OpenCode) in one place, and I want passive-capture hooks auto-written for whichever I choose — not just Codex and Cursor — so that every tool I use gets the same skills + hooks + MCP bundle experience.

**Why P4**: Phases 1-3 created Codex and Cursor plugin bundles with auto-write hook configs, but Claude Code and OpenCode were left with the older print-only guide (Claude) or no installer-menu entry at all (OpenCode is npm-only). This phase closes the gap: all four tools get the same installer-menu parity and the same auto-write hooks treatment.

**Acceptance Criteria**:

1. WHEN a user runs the root `install.sh` post-install plugin menu THEN the menu SHALL offer ALL four choices: Claude Code plugin, Codex plugin, Cursor plugin, OpenCode plugin, and an "all four" option
2. WHEN the user selects Claude Code from the plugin menu THEN the system SHALL invoke `apps/claude-plugin/install.sh` with the selected scope, AND auto-write the Claude Code hooks block into `~/.claude/settings.json` (or project `.claude/settings.json`) using the array-append merge + ownership marker + backup conventions (replacing the current print-only template approach)
3. WHEN the user selects OpenCode from the plugin menu THEN the system SHALL either invoke the existing npm plugin install (`npm install @massa-th0th/opencode-plugin` + config snippet) OR, if from source, build and link `apps/opencode-plugin/`; AND print the OpenCode hook config (OpenCode hooks are in-process via the Plugin API, not subprocess hooks.json, so no external hooks file is auto-written)
4. WHEN Claude Code hooks are auto-written THEN the 5 Claude events (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop) SHALL be wired to the shared `massa-th0th-hook.ts` binary via `settings.json` merge (NOT the old `settings.json.template` print-only approach), using the same `_massaTh0thOwned` marker + backup pattern as Codex/Cursor
5. WHEN a user re-runs the Claude Code plugin installer THEN it SHALL be idempotent (ownership marker detects existing hooks block → no-op unless `--force`)
6. WHEN `install-agents.ts --agent claude-code` runs THEN it SHALL print a deconfliction hint: "If you installed the massa-th0th Claude plugin, hooks are already wired — skip this"
7. WHEN `install-agents.ts --agent opencode` runs THEN it SHALL print a hint pointing to the npm plugin or source build for the OpenCode plugin (MCP config itself is unchanged)

**Independent Test**: Run the root `install.sh` plugin menu, select "all four", and verify that `~/.claude/settings.json` has the hooks block, `~/.codex/hooks.json` has 6 events, `~/.cursor/hooks.json` has 7 events, and the OpenCode plugin is installed (npm or source). Simulate a `SessionStart` hook for Claude Code and confirm an Observation row appears.

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| CPX-01 | P1: Codex plugin bundle | Design | Pending |
| CPX-02 | P1: Codex plugin bundle | Design | Pending |
| CPX-03 | P1: Codex plugin bundle | Design | Pending |
| CPX-04 | P1: Codex plugin bundle | Design | Pending |
| CPX-05 | P1: Codex plugin bundle | Design | Pending |
| CPX-06 | P1: Codex plugin bundle | Design | Pending |
| CPX-07 | P1: Codex plugin bundle | Design | Pending |
| CPX-08 | P1: Codex plugin bundle | Design | Pending |
| CRS-01 | P2: Cursor plugin bundle | Design | Pending |
| CRS-02 | P2: Cursor plugin bundle | Design | Pending |
| CRS-03 | P2: Cursor plugin bundle | Design | Pending |
| CRS-04 | P2: Cursor plugin bundle | Design | Pending |
| CRS-05 | P2: Cursor plugin bundle | Design | Pending |
| CRS-06 | P2: Cursor plugin bundle | Design | Pending |
| CRS-07 | P2: Cursor plugin bundle | Design | Pending |
| CRS-08 | P2: Cursor plugin bundle | Design | Pending |
| INS-01 | P3: Installer integration + docs | - | Pending |
| INS-02 | P3: Installer integration + docs | - | Pending |
| INS-03 | P3: Installer integration + docs | - | Pending |
| INS-04 | P3: Installer integration + docs | - | Pending |
| INS-05 | P3: Installer integration + docs | - | Pending |
| INS-06 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-07 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-08 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-09 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-10 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-11 | P4: Four-plugin installer parity | Phase 4 | Pending |
| INS-12 | P4: Four-plugin installer parity | Phase 4 | Pending |

**ID format**: `CPX-NN` (Codex Plugin), `CRS-NN` (Cursor Plugin), `INS-NN` (Installer/Docs)

**Coverage:** 28 total, 28 mapped to stories, 0 unmapped

---

## Success Criteria

How we know the feature is successful:

- [ ] `apps/codex-plugin/` and `apps/cursor-plugin/` exist and install idempotently into user or project scope
- [ ] Codex plugin wires 6 of 10 documented hook events (the 6 that map cleanly to the lifecycle kinds); Cursor plugin wires 7 mappable events including `sessionStart` and `preCompact` (the historical gap is closed)
- [ ] Both plugins reuse the `massa-th0th-hook.ts` binary for fire-and-forget POSTs with pin resolution and pre-compact dual-POST
- [ ] Hook config is auto-written (not just printed) with backup + ownership marker + consent gate, matching `install-agents.ts` conventions
- [ ] Both plugins bundle the 6 slash commands as skills and the MCP manifest, so a single install gives commands + tools + hooks
- [ ] Root `install.sh` menu and README document the new packages
- [ ] All new tests pass; existing tests remain green; type-check 6/6 and build 5/5
- [ ] Independent verifier (author ≠ verifier) confirms spec-anchored outcomes + discrimination sensor
- [ ] **Phase 4:** Root `install.sh` plugin menu offers all four tools (Claude, Codex, Cursor, OpenCode); Claude Code hooks are auto-written (not just printed) into `settings.json`; OpenCode plugin is installable from the menu; all four tools have passive-capture hooks wired