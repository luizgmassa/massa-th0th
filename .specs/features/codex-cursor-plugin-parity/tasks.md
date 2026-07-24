# Codex + Cursor Plugin Parity Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/codex-cursor-plugin-parity/design.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

**Sources scanned:**
- `AGENTS.md` (repo root) — test runner `bun test`, type-check `bun run type-check` (6 tsc projects), build `bun run build` (turbo, 5 packages)
- `CONTRIBUTING.md` — 7-step harness protocol; `_DETERMINISTIC_ONLY=1` for deterministic-only runs
- `package.json` — scripts: `test` (turbo), `type-check`, `build`, `lint`, `diagnose`
- `scripts/__tests__/install-agents.test.ts` — existing installer test convention: `bun:test`, temp dir via `fs.mkdtemp`, plan/apply/idempotent/uninstall assertions, `MASSA_AI_OWNED_KEY` checks
- `apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts` — binary test convention: child process + mock HTTP server
- `apps/opencode-plugin/src/__tests__/observation-emitter.test.ts` — plugin unit test convention

**Conventions:** `bun:test` with `describe`/`test`/`expect`; temp dirs in `beforeEach`/`afterEach`; co-located `__tests__/` directories; no mocks of `@massa-ai/shared` (use DI); `_DETERMINISTIC_ONLY=1` to skip env-dependent tests.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md`, `CONTRIBUTING.md`, `package.json`, existing `install-agents.test.ts` + `massa-ai-hook.test.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Binary `EVENT_MAP` (1-line `pre-tool-use` add) | unit | All branches; every new subcommand produces a POST; exit-0 on unknown | `apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts` (extend) | `bun test apps/claude-plugin/hooks/__tests__/` |
| Codex plugin installer (`install.sh`) | integration | Idempotent install; user/project scope; uninstall removes only owned; array-append merge preserves user hooks; trust warning printed | `apps/codex-plugin/__tests__/install.test.ts` | `bun test apps/codex-plugin/__tests__/` |
| Codex plugin manifest + skills + hooks.json | unit (shape) | Manifest valid; 6 events mapped; skills content matches claude-plugin; MCP entry present | `apps/codex-plugin/__tests__/manifest.test.ts` | `bun test apps/codex-plugin/__tests__/` |
| Cursor plugin installer (`install.sh`) | integration | Idempotent install; user/project scope; uninstall removes only owned; array-append merge; `sessionStart` + `preCompact` wired | `apps/cursor-plugin/__tests__/install.test.ts` | `bun test apps/cursor-plugin/__tests__/` |
| Cursor plugin manifest + skills + hooks.json | unit (shape) | 7 events mapped incl. `sessionStart` + `preCompact`; skills + agents present; MCP entry present | `apps/cursor-plugin/__tests__/manifest.test.ts` | `bun test apps/cursor-plugin/__tests__/` |
| Root `install.sh` menu | integration | Menu offers Codex/Cursor plugin choice; invokes per-plugin installer with scope | `scripts/__tests__/root-install-menu.test.ts` (new) | `bun test scripts/__tests__/root-install-menu.test.ts` |
| `install-agents.ts` hint | unit | Codex/Cursor apply prints deconfliction hint when plugin may be installed | `scripts/__tests__/install-agents.test.ts` (extend) | `bun test scripts/__tests__/install-agents.test.ts` |
| README + `.env.example` docs | none | — (build gate + grep assertions in a test) | — | build gate only |
| Claude Code plugin installer (hooks auto-write) | integration | Idempotent install; user/project scope; uninstall removes only owned hooks; array-append merge preserves user hooks; 5 events wired | `apps/claude-plugin/__tests__/install.test.ts` | `bun test apps/claude-plugin/__tests__/install.test.ts` |
| Root `install.sh` 4-plugin menu | integration | Menu offers all 4 plugin choices + "all four"; invokes respective installers | `scripts/__tests__/root-install-menu.test.ts` (extend) | `bun test scripts/__tests__/root-install-menu.test.ts` |
| `install-agents.ts` Claude/OpenCode hints | unit | Claude/OpenCode apply prints deconfliction hint | `scripts/__tests__/install-agents.test.ts` (extend) | `bun test scripts/__tests__/install-agents.test.ts` |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit/integration tests only | `bun test apps/claude-plugin/hooks/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/` |
| Full | After tasks touching `install-agents.ts` or root `install.sh` | `bun test apps/claude-plugin/hooks/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/ apps/claude-plugin/__tests__/ scripts/__tests__/install-agents.test.ts scripts/__tests__/root-install-menu.test.ts` |
| Build | After phase completion or config/entity-only tasks | `bun run type-check && bun run build` |

---

## Execution Plan

Phases are ordered and run sequentially. Tasks within a phase execute in order.

### Phase 1: Binary + Codex Plugin (CPX-01..08)

T1 → T2 → T3 → T4 → T5 → T6

### Phase 2: Cursor Plugin (CRS-01..08)

T7 → T8 → T9 → T10 → T11

### Phase 3: Installer Integration + Docs (INS-01..05)

T12 → T13 → T14 → T15

### Phase 4: Four-Plugin Installer Parity (INS-06..12)

T16 → T17 → T18 → T19 → T20

---

## Task Breakdown

### T1: Add `pre-tool-use` to binary EVENT_MAP

**What**: Add one entry `"pre-tool-use": "pre-tool-use"` to the `EVENT_MAP` in the shared `massa-ai-hook.ts` binary so Codex `PreToolUse` and Cursor `preToolUse` events produce a POST instead of a silent exit-0.
**Where**: `apps/claude-plugin/hooks/massa-ai-hook.ts:36-42` (modify)
**Depends on**: None
**Reuses**: Existing binary; `pre-tool-use` is already a valid `LIFECYCLE_EVENTS` kind in `hook-service.ts:94-102`
**Requirement**: CPX-05 (partial), CRS-03 (partial)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `EVENT_MAP` includes `"pre-tool-use": "pre-tool-use"`
- [ ] Existing 5 subcommands still produce a POST
- [ ] `pre-tool-use` subcommand produces a POST (new test in `massa-ai-hook.test.ts`)
- [ ] Unknown subcommand still exits 0 with no POST
- [ ] Gate: `bun test apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts` passes

**Tests**: unit
**Gate**: quick

---

### T2: Create apps/codex-plugin/ manifest + skills + MCP + hooks.json

**What**: Create the Codex plugin directory structure: `.codex-plugin/plugin.json`, `skills/*.md` (6 files adapted from `apps/claude-plugin/commands/*.md`), `hooks/hooks.json` (6 Codex events → binary subcommands), `.mcp.json`, and a symlink `hooks/massa-ai-hook` → `../../claude-plugin/hooks/massa-ai-hook.ts`.
**Where**: `apps/codex-plugin/` (new directory)
**Depends on**: T1 (binary has `pre-tool-use` entry)
**Reuses**: `apps/claude-plugin/commands/*.md` content (adapt frontmatter to Codex SKILL.md format), `apps/claude-plugin/hooks/massa-ai-hook.ts` (symlink)
**Requirement**: CPX-01, CPX-03, CPX-04, CPX-05, CPX-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `.codex-plugin/plugin.json` exists with `name`, `version`, `description`, `skills`, `mcp`, `hooks` fields
- [ ] 6 `skills/*.md` files exist with adapted content (map, index, find, def, graph, status)
- [ ] `hooks/hooks.json` contains 6 Codex events (`SessionStart`, `UserPromptSubmit`, `PreToolUse`, `PostToolUse`, `PreCompact`, `Stop`) each pointing at the binary with `_massaAiOwned: true`
- [ ] `.mcp.json` declares `npx @massa-ai/mcp-client` with `MASSA_AI_API_URL` env
- [ ] `hooks/massa-ai-hook` symlink resolves to the claude-plugin binary
- [ ] Gate: `bun test apps/codex-plugin/__tests__/manifest.test.ts` passes (new)

**Tests**: unit (shape)
**Gate**: quick

---

### T3: Create apps/codex-plugin/install.sh

**What**: Create the Codex plugin installer script with `--user`/`--project`/`--uninstall` flags. Copies the plugin dir to `~/.codex/plugins/massa-ai/` (user) or `./.codex/plugins/massa-ai/` (project). Auto-writes `~/.codex/hooks.json` (or project) with array-append merge (backup + `_massaAiOwned` marker). Prints the blocking trust warning: "Run `/hooks` in Codex to trust massa-ai hooks." Prints the MCP deconfliction hint.
**Where**: `apps/codex-plugin/install.sh` (new)
**Depends on**: T2 (plugin files exist to install)
**Reuses**: `scripts/install-agents.ts` backup + ownership-marker + `assertHomeWriteConsent` conventions (reimplemented in bash); `apps/claude-plugin/install.sh` script-copy pattern
**Requirement**: CPX-01, CPX-02, CPX-04, CPX-07, CPX-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` copies plugin dir to `~/.codex/plugins/massa-ai/` and merges `~/.codex/hooks.json`
- [ ] `install.sh --project` copies to `./.codex/plugins/massa-ai/` and merges `./.codex/hooks.json`
- [ ] Array-append merge: pre-existing user hooks survive (backup created first)
- [ ] `install.sh --uninstall` removes only ownership-marked entries + plugin dir
- [ ] Idempotent: re-running `--user` is a no-op when owned entries already present
- [ ] Trust warning printed to stdout after install
- [ ] MCP deconfliction hint printed
- [ ] Gate: `bun test apps/codex-plugin/__tests__/install.test.ts` passes (new)

**Tests**: integration
**Gate**: quick

---

### T4: Create apps/codex-plugin/README.md

**What**: Create the README documenting what the plugin bundles, how to install (`install.sh --user`/`--project`), the trust step (`/hooks`), the events wired, prerequisites (tools-api running), and the `vscode.cursor.plugins.registerPath`-equivalent for Codex (local plugin dir discovery).
**Where**: `apps/codex-plugin/README.md` (new)
**Depends on**: T3 (installer exists to document)
**Reuses**: `apps/claude-plugin/README.md` structure
**Requirement**: CPX-01 (docs)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] README exists with install commands, trust step, events table, prerequisites
- [ ] Gate: build gate (file exists, no test)

**Tests**: none
**Gate**: build

---

### T5: Write apps/codex-plugin/ tests

**What**: Create `apps/codex-plugin/__tests__/manifest.test.ts` (manifest shape + 6 events + skills content) and `apps/codex-plugin/__tests__/install.test.ts` (install/uninstall/idempotent/array-merge in a temp HOME).
**Where**: `apps/codex-plugin/__tests__/` (new)
**Depends on**: T2, T3
**Reuses**: `scripts/__tests__/install-agents.test.ts` temp-dir + plan/apply/uninstall convention; `apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts` child-process convention
**Requirement**: CPX-01..08 verification

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `manifest.test.ts` asserts plugin.json fields, 6 events in hooks.json, 6 skills exist, `.mcp.json` shape, symlink resolves
- [ ] `install.test.ts` asserts user/project install, uninstall removes only owned, array-append preserves user hooks, idempotent re-run, trust warning in output
- [ ] Gate: `bun test apps/codex-plugin/__tests__/` passes

**Tests**: integration
**Gate**: quick

---

### T6: Phase 1 gate — binary + Codex plugin

**What**: Run the full quick gate for Phase 1 and verify no regressions in the existing binary tests.
**Where**: — (verification only)
**Depends on**: T1, T2, T3, T4, T5
**Reuses**: —
**Requirement**: Phase 1 completion

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `bun test apps/claude-plugin/hooks/__tests__/ apps/codex-plugin/__tests__/` all pass
- [ ] No existing test count dropped (no silent deletions)
- [ ] `bun run type-check` 6/6 (binary change type-checks)

**Tests**: none (gate task)
**Gate**: build

---

### T7: Create apps/cursor-plugin/ manifest + skills + MCP + hooks.json + agents

**What**: Create the Cursor plugin directory: `skills/<name>/SKILL.md` (6 skills adapted from claude-plugin commands), `hooks/hooks.json` (7 Cursor events incl. `sessionStart` + `preCompact`), `mcp.json`, `agents/massa-ai-navigator.md` (copied from claude-plugin), `.cursor-plugin/plugin.json` (optional manifest), and `hooks/massa-ai-hook` symlink.
**Where**: `apps/cursor-plugin/` (new directory)
**Depends on**: T1 (binary has `pre-tool-use` entry)
**Reuses**: `apps/claude-plugin/commands/*.md` → `skills/` (adapt to Cursor `SKILL.md` format per `cursor.com/docs/skills.md`), `apps/claude-plugin/agents/massa-ai-navigator.md` (copy), `apps/claude-plugin/hooks/massa-ai-hook.ts` (symlink)
**Requirement**: CRS-01, CRS-03, CRS-04, CRS-05, CRS-06, CRS-08

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] 6 `skills/<name>/SKILL.md` files exist with adapted content
- [ ] `hooks/hooks.json` contains 7 events: `sessionStart`, `sessionEnd`, `beforeSubmitPrompt`, `preToolUse`, `postToolUse`, `preCompact`, `stop` — each pointing at the binary with `_massaAiOwned: true`
- [ ] `mcp.json` declares the MCP server
- [ ] `agents/massa-ai-navigator.md` copied
- [ ] `.cursor-plugin/plugin.json` optional manifest present
- [ ] `hooks/massa-ai-hook` symlink resolves
- [ ] Directory layout matches `vscode.cursor.plugins.registerPath` auto-discovery (`skills/`, `hooks/hooks.json`, `mcp.json`, `agents/`)
- [ ] Gate: `bun test apps/cursor-plugin/__tests__/manifest.test.ts` passes (new)

**Tests**: unit (shape)
**Gate**: quick

---

### T8: Create apps/cursor-plugin/install.sh

**What**: Create the Cursor plugin installer with `--user`/`--project`/`--uninstall`. Copies to `~/.cursor/plugins/massa-ai/` or `./.cursor/plugins/massa-ai/`. Auto-writes `~/.cursor/hooks.json` with array-append merge (backup + marker). Prints MCP deconfliction hint.
**Where**: `apps/cursor-plugin/install.sh` (new)
**Depends on**: T7 (plugin files exist)
**Reuses**: Same conventions as T3 (Codex installer); `scripts/install-agents.ts` patterns
**Requirement**: CRS-01, CRS-02, CRS-04, CRS-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` copies to `~/.cursor/plugins/massa-ai/` + merges `~/.cursor/hooks.json`
- [ ] `install.sh --project` copies to `./.cursor/plugins/massa-ai/` + merges `./.cursor/hooks.json`
- [ ] Array-append merge preserves user hooks (backup first)
- [ ] `install.sh --uninstall` removes only owned entries + plugin dir
- [ ] Idempotent re-run
- [ ] MCP deconfliction hint printed
- [ ] Gate: `bun test apps/cursor-plugin/__tests__/install.test.ts` passes (new)

**Tests**: integration
**Gate**: quick

---

### T9: Create apps/cursor-plugin/README.md

**What**: Create the README documenting install, the events wired (emphasize `sessionStart` + `preCompact` fix the historical gap), the `vscode.cursor.plugins.registerPath` advanced path for extension authors, prerequisites.
**Where**: `apps/cursor-plugin/README.md` (new)
**Depends on**: T8
**Reuses**: `apps/claude-plugin/README.md` structure
**Requirement**: CRS-01 (docs)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] README exists with install commands, events table, `registerPath` advanced path, prerequisites
- [ ] Gate: build gate

**Tests**: none
**Gate**: build

---

### T10: Write apps/cursor-plugin/ tests

**What**: Create `apps/cursor-plugin/__tests__/manifest.test.ts` (manifest + 7 events incl. `sessionStart`/`preCompact` + skills + agents + MCP) and `apps/cursor-plugin/__tests__/install.test.ts` (install/uninstall/idempotent/array-merge in temp HOME).
**Where**: `apps/cursor-plugin/__tests__/` (new)
**Depends on**: T7, T8
**Reuses**: Same conventions as T5 (Codex tests)
**Requirement**: CRS-01..08 verification

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `manifest.test.ts` asserts 7 events (especially `sessionStart` + `preCompact`), 6 skills, agents present, mcp.json shape, symlink resolves, directory layout matches auto-discovery
- [ ] `install.test.ts` asserts user/project install, uninstall removes only owned, array-append preserves user hooks, idempotent
- [ ] Gate: `bun test apps/cursor-plugin/__tests__/` passes

**Tests**: integration
**Gate**: quick

---

### T11: Phase 2 gate — Cursor plugin

**What**: Run the quick gate for Phase 2.
**Where**: — (verification only)
**Depends on**: T7, T8, T9, T10
**Reuses**: —
**Requirement**: Phase 2 completion

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `bun test apps/cursor-plugin/__tests__/ apps/claude-plugin/hooks/__tests__/` all pass
- [ ] No test count dropped
- [ ] `bun run type-check` 6/6

**Tests**: none (gate task)
**Gate**: build

---

### T12: Integrate into root install.sh menu + install-agents.ts hint

**What**: Add menu choices to the root `install.sh` post-install menu for installing Codex/Cursor plugins (invoking the per-plugin `install.sh` with the same scope). Add a deconfliction hint print to `scripts/install-agents.ts` Codex/Cursor writers: "If you installed the massa-ai plugin, MCP is already registered — skip this."
**Where**: root `install.sh` (~`:620` menu section), `scripts/install-agents.ts` (`CodexWriter.apply` `:424-444` + `CursorWriter.apply`)
**Depends on**: T6, T11 (both plugins exist)
**Reuses**: Existing root `install.sh` menu infrastructure; `install-agents.ts` writer pattern
**Requirement**: INS-01, INS-02, INS-03

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Root `install.sh` menu offers Codex plugin install + Cursor plugin install choices
- [ ] Menu invokes `apps/codex-plugin/install.sh` / `apps/cursor-plugin/install.sh` with the selected scope
- [ ] `install-agents.ts` Codex/Cursor apply prints the deconfliction hint
- [ ] Existing `scripts/__tests__/install-agents.test.ts` extended to assert the hint text
- [ ] Gate: `bun test scripts/__tests__/install-agents.test.ts` + new `scripts/__tests__/root-install-menu.test.ts` pass

**Tests**: integration
**Gate**: full

---

### T13: Update README integration section

**What**: Add Codex and Cursor plugin documentation to the README integration section: what each bundles, install commands, events wired, trust step (Codex), `registerPath` (Cursor), prerequisites.
**Where**: `README.md` (integration section ~`:79-166`, passive capture section ~`:442-516`)
**Depends on**: T12 (plugins wired into installer)
**Reuses**: Existing README structure
**Requirement**: INS-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] README integration section documents both new plugin packages
- [ ] Events table updated (Codex 6 events, Cursor 7 events incl. sessionStart + preCompact)
- [ ] Gate: build gate + grep assertions in a test (optional)

**Tests**: none
**Gate**: build

---

### T14: Update .env.example + remove stale Cursor note

**What**: Remove the stale "Cursor has NO SessionStart and NO PreCompact" note from root `install.sh:print_hooks_guide` (since the plugin now wires them). Update `.env.example` hook section if it references the old 3-event Cursor limit.
**Where**: root `install.sh:553-567` (Cursor block in `print_hooks_guide`), `.env.example:199-216`
**Depends on**: T12
**Reuses**: —
**Requirement**: INS-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `print_hooks_guide` Cursor block updated to reflect the 7-event wiring (or points to the plugin installer as the canonical path)
- [ ] `.env.example` has no stale 3-event reference
- [ ] Gate: `bun run type-check && bun run build` + grep for stale text returns nothing

**Tests**: none
**Gate**: build

---

### T15: Phase 3 gate + full build

**What**: Run the full gate (all new + existing tests) + type-check + build.
**Where**: — (verification only)
**Depends on**: T12, T13, T14
**Reuses**: —
**Requirement**: All INS requirements + feature completion

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `bun run type-check` 6/6
- [ ] `bun run build` 5/5
- [ ] `bun test apps/claude-plugin/hooks/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/ scripts/__tests__/install-agents.test.ts` all pass
- [ ] No existing test count dropped
- [ ] Ready for independent verifier (T-validate)

**Tests**: none (gate task)
**Gate**: build

---

### T16: Extend apps/claude-plugin/install.sh with hooks auto-write

**What**: Extend the existing `apps/claude-plugin/install.sh` to auto-write the Claude Code hooks block into `~/.claude/settings.json` (user) or `./.claude/settings.json` (project), using array-append merge + `_massaAiOwned` marker + backup. The hooks block uses Claude's nested matcher-group + `hooks[]` form with 5 events (SessionStart, UserPromptSubmit, PostToolUse, PreCompact, Stop), each pointing at the shared `massa-ai-hook.ts` binary. Also add `--uninstall` flag to remove only owned hooks entries. Keep the existing command/agent copy behavior.
**Where**: `apps/claude-plugin/install.sh` (modify), `apps/claude-plugin/__tests__/install.test.ts` (new)
**Depends on**: T15 (Phase 3 complete, binary has all 6 EVENT_MAP entries)
**Reuses**: Codex/Cursor installer array-append merge pattern; `settings.json.template` content as the hooks block source; `_massaAiOwned` marker from `install-agents.ts`
**Requirement**: INS-08, INS-09 (Claude hooks auto-write + idempotency)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` copies commands/agents to `~/.claude/` AND merges hooks into `~/.claude/settings.json` with 5 events
- [ ] `install.sh --project` copies to `./.claude/` AND merges hooks into `./.claude/settings.json`
- [ ] Array-append merge: pre-existing user hooks in settings.json survive (backup created first)
- [ ] `install.sh --uninstall` removes only owned hooks entries + commands/agents, preserves user keys
- [ ] Idempotent: re-running `--user` is a no-op when owned hooks already present
- [ ] Gate: `bun test apps/claude-plugin/__tests__/install.test.ts` passes (new)

**Tests**: integration
**Gate**: quick

---

### T17: Extend root install.sh plugin menu to all four tools

**What**: Extend the `install_plugins_menu()` function in root `install.sh` (added in T12) from 3 options (Codex/Cursor/Both) to 5 options: 1) Claude Code, 2) Codex, 3) Cursor, 4) OpenCode, 5) All four. The Claude option invokes `apps/claude-plugin/install.sh`. The OpenCode option prints the `npm install @massa-ai/opencode-plugin` command and the `opencode.json` config snippet (or source-build instructions if from source). "All four" invokes all installers in sequence.
**Where**: root `install.sh` `install_plugins_menu()` (modify), `scripts/__tests__/root-install-menu.test.ts` (extend)
**Depends on**: T16 (Claude installer has hooks auto-write)
**Reuses**: Existing `install_plugins_menu()` infrastructure from T12
**Requirement**: INS-06, INS-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install_plugins_menu()` offers 5 choices: Claude, Codex, Cursor, OpenCode, All four
- [ ] Claude option invokes `apps/claude-plugin/install.sh --user`
- [ ] OpenCode option prints npm install command + opencode.json config snippet
- [ ] "All four" invokes Claude, Codex, Cursor installers + prints OpenCode instructions
- [ ] `scripts/__tests__/root-install-menu.test.ts` extended to assert all 4 plugin names + "all" option present in install.sh
- [ ] Gate: `bun test scripts/__tests__/root-install-menu.test.ts` passes

**Tests**: integration
**Gate**: quick

---

### T18: Add install-agents.ts deconfliction hints for Claude + OpenCode

**What**: Add deconfliction hints to `ClaudeCodeWriter.apply()` and `OpenCodeWriter.apply()` in `scripts/install-agents.ts`, matching the pattern from T12 (Codex/Cursor hints). After a successful write, print: "If you installed the massa-ai Claude plugin (apps/claude-plugin/install.sh), hooks are already wired — skip this." / "If you installed the massa-ai OpenCode plugin (@massa-ai/opencode-plugin), hooks are already wired — skip this."
**Where**: `scripts/install-agents.ts` (modify), `scripts/__tests__/install-agents.test.ts` (extend)
**Depends on**: T16
**Reuses**: T12 hint pattern (Codex/Cursor)
**Requirement**: INS-10, INS-11

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `ClaudeCodeWriter.apply()` prints deconfliction hint when `written === true`
- [ ] `OpenCodeWriter.apply()` prints deconfliction hint when `written === true`
- [ ] `scripts/__tests__/install-agents.test.ts` extended with tests asserting hint text for claude-code and opencode
- [ ] Gate: `bun test scripts/__tests__/install-agents.test.ts` passes

**Tests**: integration
**Gate**: full

---

### T19: Update README for four-plugin parity

**What**: Update the README integration section to document all four plugin packages (Claude Code, Codex, Cursor, OpenCode) with install commands, what each bundles, events wired, and the unified root `install.sh` plugin menu. Update the "Other CLIs" subsection to note all four tools now have full plugin + hooks parity.
**Where**: `README.md` (modify)
**Depends on**: T17 (menu is wired)
**Reuses**: Existing README structure
**Requirement**: INS-12

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] README integration section documents all 4 plugin packages
- [ ] Events table updated (Claude 5 events, Codex 6 events, Cursor 7 events, OpenCode in-process)
- [ ] Root `install.sh` plugin menu documented as the unified install path
- [ ] Gate: build gate + grep assertions

**Tests**: none
**Gate**: build

---

### T20: Phase 4 gate + full build

**What**: Run the full gate (all new + existing tests) + type-check + build.
**Where**: — (verification only)
**Depends on**: T16, T17, T18, T19
**Reuses**: —
**Requirement**: All INS-06..12 requirements + feature completion

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `bun run type-check` 6/6
- [ ] `bun run build` 5/5
- [ ] `bun test apps/claude-plugin/hooks/__tests__/ apps/claude-plugin/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/ scripts/__tests__/install-agents.test.ts scripts/__tests__/root-install-menu.test.ts` all pass
- [ ] No existing test count dropped
- [ ] Ready for independent verifier

**Tests**: none (gate task)
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ──→ T2 ──→ T3 ──→ T4 ──→ T5 ──→ T6
Phase 2:  T7 ──→ T8 ──→ T9 ──→ T10 ──→ T11
Phase 3:  T12 ──→ T13 ──→ T14 ──→ T15
Phase 4:  T16 ──→ T17 ──→ T18 ──→ T19 ──→ T20
```

Execution is strictly sequential. 20 tasks total across 4 phases.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Add `pre-tool-use` to EVENT_MAP | 1 line in 1 file | ✅ Granular |
| T2: Codex plugin dir (manifest + skills + hooks + mcp) | 1 directory, ~10 files (cohesive: all the plugin's static content) | ✅ Granular (cohesive bundle) |
| T3: Codex install.sh | 1 file | ✅ Granular |
| T4: Codex README | 1 file | ✅ Granular |
| T5: Codex tests | 2 test files | ✅ Granular |
| T6: Phase 1 gate | verification only | ✅ Granular |
| T7: Cursor plugin dir | 1 directory, ~10 files (cohesive) | ✅ Granular |
| T8: Cursor install.sh | 1 file | ✅ Granular |
| T9: Cursor README | 1 file | ✅ Granular |
| T10: Cursor tests | 2 test files | ✅ Granular |
| T11: Phase 2 gate | verification only | ✅ Granular |
| T12: Root menu + install-agents hint | 2 files (root install.sh + install-agents.ts) | ✅ Granular (cohesive: both are installer integration) |
| T13: README integration | 1 file | ✅ Granular |
| T14: .env.example + stale note | 2 files (cohesive: both are stale-text cleanup) | ✅ Granular |
| T15: Phase 3 gate + full build | verification only | ✅ Granular |
| T16: Claude install.sh hooks auto-write | 1 file (extend) + 1 test file | ✅ Granular |
| T17: Root menu 4-plugin extension | 1 file (root install.sh) + 1 test extend | ✅ Granular |
| T18: install-agents.ts Claude/OpenCode hints | 1 file + 1 test extend | ✅ Granular |
| T19: README 4-plugin parity | 1 file | ✅ Granular |
| T20: Phase 4 gate + full build | verification only | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | (no arrow, start of Phase 1) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T3 | T3 → T4 | ✅ Match |
| T5 | T2, T3 | T4 → T5 (T2/T3 preconditions already satisfied) | ✅ Match |
| T6 | T1-T5 | T5 → T6 | ✅ Match |
| T7 | T1 | (Phase 2 starts; T1 is the binary dependency) | ✅ Match (T1 is binary, shared) |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T7, T8 | T9 → T10 | ✅ Match |
| T11 | T7-T10 | T10 → T11 | ✅ Match |
| T12 | T6, T11 | T11 → T12 (Phase 2 → Phase 3) | ✅ Match |
| T13 | T12 | T12 → T13 | ✅ Match |
| T14 | T12 | T13 → T14 | ✅ Match (T12 precondition satisfied) |
| T15 | T12-T14 | T14 → T15 | ✅ Match |
| T16 | T15 | T15 → T16 (Phase 3 → Phase 4) | ✅ Match |
| T17 | T16 | T16 → T17 | ✅ Match |
| T18 | T16 | T17 → T18 | ✅ Match (T16 precondition satisfied) |
| T19 | T17 | T18 → T19 | ✅ Match |
| T20 | T16-T19 | T19 → T20 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Binary `EVENT_MAP` | unit | unit | ✅ OK |
| T2 | Codex manifest + skills + hooks.json | unit (shape) | unit (shape) | ✅ OK |
| T3 | Codex install.sh | integration | integration | ✅ OK |
| T4 | Codex README | none | none | ✅ OK |
| T5 | Codex tests | integration | integration | ✅ OK |
| T6 | (gate only) | none | none | ✅ OK |
| T7 | Cursor manifest + skills + hooks.json + agents | unit (shape) | unit (shape) | ✅ OK |
| T8 | Cursor install.sh | integration | integration | ✅ OK |
| T9 | Cursor README | none | none | ✅ OK |
| T10 | Cursor tests | integration | integration | ✅ OK |
| T11 | (gate only) | none | none | ✅ OK |
| T12 | Root install.sh + install-agents.ts | integration | integration | ✅ OK |
| T13 | README | none | none | ✅ OK |
| T14 | .env.example + print_hooks_guide | none | none | ✅ OK |
| T15 | (gate only) | none | none | ✅ OK |
| T16 | Claude install.sh hooks auto-write | integration | integration | ✅ OK |
| T17 | Root install.sh menu extension | integration | integration | ✅ OK |
| T18 | install-agents.ts hints | integration | integration | ✅ OK |
| T19 | README | none | none | ✅ OK |
| T20 | (gate only) | none | none | ✅ OK |

All validations pass. No ❌ violations.

---

## MCP and Skill Question

For all tasks: no MCP or skill materially changes implementation or verification. The work is bash scripts, JSON manifests, markdown skills, and bun:test tests — all within the existing toolchain. The `massa-ai` skill (Execute flow) is the only skill activated, per the Execution Protocol.

---

## Artifact-Store Evidence

- Active artifact: `.specs/features/codex-cursor-plugin-parity/tasks.md`
- Version: 1
- Checksum: computed on write (git-tracked)