# Subagent Skills Plugin Parity Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/subagent-skills-plugin-parity/design.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

**Step 0 — guidelines found:**

- `AGENTS.md:130-132` — Tech stack pins test runner (`bun test`), type-check (`bun run type-check`, 6 tsc projects), build (`bun run build`, turbo, 5 packages).
- `package.json:15,21,22,28` — `build`/`type-check`/`test`/`lint` all run through `turbo run <task>`.
- `turbo.json:24-26` — `test` depends on `build`.
- Test directories: `apps/*/__tests__/`, `apps/*/src/__tests__/`, `scripts/__tests__/` — co-located `__tests__` convention (Bun-native `bun:test`).
- Sample tests: `apps/claude-plugin/__tests__/install.test.ts` (spawnSync install.sh + temp HOME), `apps/codex-plugin/__tests__/manifest.test.ts` (static manifest structure), `apps/cursor-plugin/__tests__/manifest.test.ts` (manifest + directory layout), `apps/opencode-plugin/src/__tests__/` (unit). Framework: `bun:test` (`describe`/`test`/`expect`).

**Conformance:** All new tests use `bun:test`, live in co-located `__tests__/` dirs, follow the spawnSync + temp HOME pattern for installers. No coverage threshold config found — strong default applies (cover every spec AC + listed edge cases).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md:130-132`, `package.json:15-28`, `turbo.json:24-26`. Strong defaults applied (no coverage threshold config).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Generator (`scripts/generate-subagent-artifacts.ts`) | unit | All 4 emitters; model/effort/permission pinning per host; TOML escaping; drift `--check` mode | `scripts/__tests__/subagent-parity.test.ts` | `bun test scripts/__tests__/subagent-parity.test.ts` |
| Claude plugin installer (agents copy + uninstall scoping) | integration | 12 agents installed; navigator preserved on uninstall; idempotent | `apps/claude-plugin/__tests__/install.test.ts` (extend) | `bun test apps/claude-plugin/__tests__/` |
| Codex plugin installer (agents write to `~/.codex/agents/` + owned-marker uninstall) | integration | 12 TOML installed outside plugin dir; user agents preserved on uninstall; TOML parses; owned marker present | `apps/codex-plugin/__tests__/install.test.ts` (extend) | `bun test apps/codex-plugin/__tests__/` |
| Cursor plugin manifest (12 agents + navigator in `agents/`) | integration | 13 `.md` in `agents/`; correct frontmatter; directory layout intact | `apps/cursor-plugin/__tests__/manifest.test.ts` (extend) | `bun test apps/cursor-plugin/__tests__/` |
| OpenCode agents CLI (`massa-ai-config agents install/uninstall`) | integration | 12 `.md` written to `~/.config/opencode/agents/`; owned-marker uninstall preserves user agents; idempotent | `apps/opencode-plugin/src/__tests__/agents-install.test.ts` (new) | `bun test apps/opencode-plugin/src/__tests__/agents-install.test.ts` |
| FEATURES.md ↔ spec table parity | unit | 4 model-pinning tables byte-match spec | `scripts/__tests__/subagent-parity.test.ts` | `bun test scripts/__tests__/subagent-parity.test.ts` |
| Static agent files (all hosts) | none | — (build gate only: parity test covers structure) | — | parity test gate |

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After generator + parity test tasks | `bun test scripts/__tests__/subagent-parity.test.ts` |
| Full | After per-host installer tasks | `bun test apps/claude-plugin/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/ apps/opencode-plugin/src/__tests__/agents-install.test.ts` |
| Build | After phase completion / config-only tasks | `bun run type-check && bun run build` |
| Drift | After any generator-emitted file change | `bun run scripts/generate-subagent-artifacts.ts --check` |

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Generator foundation

The single source of truth. No installer changes yet.

T1 → T2 → T3 → T4

### Phase 2: Installer extensions

Per-host installers consume the generated files.

T5 → T6 → T7 → T8

### Phase 3: Docs + parity gate

README/FEATURES/install-agents hints + final parity test.

T9 → T10 → T11 → T12

---

## Task Breakdown

### T1: Create the subagent-artifacts generator

**What**: Create `scripts/generate-subagent-artifacts.ts` that reads `skills/*/SKILL.md` (12 charters), parses frontmatter (`name`, `description`, `metadata.model_hint`, `metadata.permission`) + body, and emits per-host agent files into `apps/{claude,codex,cursor,opencode}-plugin/agents/massa-ai-<name>.{md,toml}`. Encode the 3 model-pinning tables (Claude/Codex/Cursor-OpenCode) + permission→tools mapping as constants. Idempotent (overwrites). `--check` mode emits to a temp dir and diffs against checked-in files (exit non-zero on drift).
**Where**: `scripts/generate-subagent-artifacts.ts`
**Depends on**: None
**Reuses**: `skills/*/SKILL.md` (input); spec model-pinning + permission tables (constants)
**Requirement**: CLA-01..10, CDX-01..10, CRS-01..08, OPC-01..10 (generator is the foundation for all)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Generator reads all 12 `skills/*/SKILL.md` charters
- [ ] Emits 48 files (12 × 4 hosts) into `apps/*/agents/`
- [ ] Claude emitter: array-form `tools`, `model` (haiku/sonnet/opus), `effort: high`, omits `hooks`/`mcpServers`/`permissionMode`
- [ ] Codex emitter: TOML with `# massa-ai-owned` top comment, `model`, `model_reasoning_effort = "high"`, `sandbox_mode` (read-only→`"read-only"`, write→`"workspace-write"`), `developer_instructions` triple-quoted with `"""` escaped as `\"\"\"`
- [ ] Cursor emitter: array-form `tools`, `model` = charter hint verbatim, `reasoningEffort: max`
- [ ] OpenCode emitter: `mode: subagent`, `model` = charter hint verbatim, `reasoningEffort: max`, `permission` (bash deny/ask/allow per mapping), `metadata: { massa-ai-owned: true }`
- [ ] `--check` mode exits non-zero on drift
- [ ] `bun run scripts/generate-subagent-artifacts.ts` runs clean; `bun run type-check` passes for the new file

**Tests**: unit (parity test in T4 covers generator output; T1 itself has no standalone tests — generator is verified via T4)
**Gate**: build (type-check)
**Commit**: `feat(scripts): add subagent-artifacts generator from skills charters`

---

### T2: Run generator + commit emitted agent files

**What**: Run `bun run scripts/generate-subagent-artifacts.ts` to emit the 48 agent files into `apps/*/agents/`. Verify the output looks correct (12 per host, frontmatter per spec). Commit the checked-in generated files.
**Where**: `apps/claude-plugin/agents/massa-ai-*.md` (12), `apps/codex-plugin/agents/massa-ai-*.toml` (12), `apps/cursor-plugin/agents/massa-ai-*.md` (12), `apps/opencode-plugin/agents/massa-ai-*.md` (12)
**Depends on**: T1
**Reuses**: T1 generator
**Requirement**: CLA-01, CDX-01, CRS-01, OPC-01 (file existence)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] 12 `massa-ai-*.md` in `apps/claude-plugin/agents/` (alongside existing navigator)
- [ ] 12 `massa-ai-*.toml` in `apps/codex-plugin/agents/`
- [ ] 12 `massa-ai-*.md` in `apps/cursor-plugin/agents/` (alongside navigator)
- [ ] 12 `massa-ai-*.md` in `apps/opencode-plugin/agents/`
- [ ] `bun run scripts/generate-subagent-artifacts.ts --check` exits 0 (no drift between just-generated and committed)

**Tests**: none (T4 parity test verifies)
**Gate**: drift (`bun run scripts/generate-subagent-artifacts.ts --check`)
**Commit**: `feat(plugins): emit 12 subagent specialists across 4 host plugins`

---

### T3: Extend Claude Code installer to copy the 12 agents

**What**: Extend `apps/claude-plugin/install.sh` to copy `agents/massa-ai-*.md` (the 12 specialists) into `~/.claude/agents/` (or `.claude/agents/`) alongside the existing navigator copy. Extend `--uninstall` to remove `massa-ai-*.md` EXCLUDING `massa-ai-navigator.md` (R1: name-prefix glob catches navigator — exclude by name). Print "+ 12 subagent specialists: ..." line.
**Where**: `apps/claude-plugin/install.sh` (modify)
**Depends on**: T2
**Reuses**: existing install.sh copy loop pattern at `:184-192`
**Requirement**: CLA-01, CLA-02, CLA-05, CLA-06, DOC-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` copies 12 `massa-ai-*.md` to `~/.claude/agents/`
- [ ] `install.sh --uninstall` removes the 12 specialists AND preserves `massa-ai-navigator.md` (R1 exclusion)
- [ ] Install prints "+ 12 subagent specialists: investigator, planner, ..."
- [ ] Idempotent (re-run overwrites identical content)
- [ ] Existing `apps/claude-plugin/__tests__/install.test.ts` still passes
- [ ] Gate: `bun test apps/claude-plugin/__tests__/`

**Tests**: integration (extend `apps/claude-plugin/__tests__/install.test.ts` — assert 12 agents installed, navigator survives uninstall)
**Gate**: full
**Commit**: `feat(claude-plugin): install 12 subagent specialists, preserve navigator on uninstall`

---

### T4: Create the subagent parity test

**What**: Create `scripts/__tests__/subagent-parity.test.ts` that (a) runs the generator `--check` and asserts exit 0 (drift gate), (b) parses every emitted agent file per host and asserts `model`/`effort`/`tools`/`sandbox_mode`/`permission` match the spec pinning tables, (c) asserts no shipped name collides with host built-ins, (d) asserts the exact 12 names per host, (e) asserts each Codex TOML parses + has `# massa-ai-owned` top comment, (f) asserts FEATURES.md 4 tables byte-match spec (after T10).
**Where**: `scripts/__tests__/subagent-parity.test.ts`
**Depends on**: T2 (T10 for FEATURES.md parity sub-check)
**Reuses**: `bun:test`; spec tables as fixtures
**Requirement**: CLA-07..10, CDX-07..10, CRS-06..08, OPC-07..10, DOC-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `--check` drift assertion passes (exit 0)
- [ ] Per-host `model`/`effort`/`permission` assertions pass for all 12 agents
- [ ] Name-collision assertion passes (no name ∈ host built-ins)
- [ ] Exact-12-names assertion passes per host
- [ ] Codex TOML parse + owned-marker assertions pass
- [ ] FEATURES.md table parity assertions pass (after T10 lands; gate this sub-check on FEATURES.md existence)
- [ ] Gate: `bun test scripts/__tests__/subagent-parity.test.ts`

**Tests**: unit (this IS the test)
**Gate**: quick
**Commit**: `test(scripts): subagent parity — drift, pinning, collision, exact-12`

---

### T5: Extend Codex installer to write 12 TOML agents outside the plugin dir

**What**: Extend `apps/codex-plugin/install.sh` to write the 12 `massa-ai-*.toml` files into `~/.codex/agents/` (or `.codex/agents/`) — OUTSIDE the plugin dir. Extend `--uninstall` to remove only files with the `# massa-ai-owned` top comment (grep + rm). Print "+ 12 subagent specialists" line.
**Where**: `apps/codex-plugin/install.sh` (modify)
**Depends on**: T2
**Reuses**: existing `CODEX_DIR` resolution at `:47-53`
**Requirement**: CDX-01, CDX-02, CDX-05, CDX-06, CDX-07, DOC-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` writes 12 `massa-ai-*.toml` to `~/.codex/agents/`
- [ ] `--uninstall` removes only files with `# massa-ai-owned` top comment; user TOML files preserved (R3)
- [ ] Each TOML has `# massa-ai-owned` top comment
- [ ] Install prints "+ 12 subagent specialists: ..."
- [ ] Idempotent
- [ ] Existing `apps/codex-plugin/__tests__/manifest.test.ts` still passes
- [ ] Gate: `bun test apps/codex-plugin/__tests__/`

**Tests**: integration (extend `apps/codex-plugin/__tests__/install.test.ts` or new `agents-install.test.ts` — assert 12 TOML installed outside plugin dir, owned-marker uninstall preserves user agents)
**Gate**: full
**Commit**: `feat(codex-plugin): write 12 subagent TOML agents to ~/.codex/agents/`

---

### T6: Extend Cursor installer to copy the 12 agents into the plugin dir

**What**: Extend `apps/cursor-plugin/install.sh` to copy `agents/massa-ai-*.md` (12 specialists) into the plugin's `agents/` dir alongside the existing navigator. The existing single navigator `cp` at `:204` becomes a loop over `agents/*.md`. Print "+ 12 subagent specialists" line.
**Where**: `apps/cursor-plugin/install.sh` (modify)
**Depends on**: T2
**Reuses**: existing agent copy at `:204`
**Requirement**: CRS-01, CRS-02, CRS-04, CRS-05, DOC-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `install.sh --user` copies 13 `.md` (12 specialists + navigator) into plugin `agents/`
- [ ] Install prints "+ 12 subagent specialists: ..."
- [ ] Uninstall (whole plugin dir removal) unchanged — removes all 13
- [ ] Existing `apps/cursor-plugin/__tests__/manifest.test.ts` still passes (extend for 13 files)
- [ ] Gate: `bun test apps/cursor-plugin/__tests__/`

**Tests**: integration (extend `apps/cursor-plugin/__tests__/manifest.test.ts` — assert 13 agents in dir, 12 specialists + navigator)
**Gate**: full
**Commit**: `feat(cursor-plugin): bundle 12 subagent specialists alongside navigator`

---

### T7: Add OpenCode `massa-ai-config agents` subcommand

**What**: Add an `agents` subcommand to `apps/opencode-plugin/src/config-cli.ts` (`agents install [--user|--project]` / `agents uninstall`) that writes the 12 generated `massa-ai-*.md` files to `~/.config/opencode/agents/` (or `.opencode/agents/`). Read source files from the package's `agents/` dir (resolved relative to the built CLI). Uninstall removes only files with `metadata: { massa-ai-owned: true }` (R3). Print "+ 12 subagent specialists" line.
**Where**: `apps/opencode-plugin/src/config-cli.ts` (modify)
**Depends on**: T2
**Reuses**: existing CLI structure at `:62-194`; `getConfigDir()` for scope
**Requirement**: OPC-01, OPC-02, OPC-05, OPC-06, OPC-07, DOC-01

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `massa-ai-config agents install --user` writes 12 `massa-ai-*.md` to `~/.config/opencode/agents/`
- [ ] `agents uninstall` removes only files with `metadata: { massa-ai-owned: true }`; user agents preserved (R3)
- [ ] Install prints "+ 12 subagent specialists: ..."
- [ ] Idempotent
- [ ] `bun run type-check` passes for the CLI extension
- [ ] Gate: `bun test apps/opencode-plugin/src/__tests__/agents-install.test.ts`

**Tests**: integration (new `apps/opencode-plugin/src/__tests__/agents-install.test.ts` — spawnSync CLI with temp HOME, assert 12 files + owned-marker uninstall)
**Gate**: full
**Commit**: `feat(opencode-plugin): add agents install/uninstall subcommand`

---

### T8: Ship OpenCode agents in the npm package (files array)

**What**: Update `apps/opencode-plugin/package.json` `files` array to include `"agents/*.md"` so the 12 generated agents ship in the npm tarball (R2 — currently `files: ["dist"]` excludes them). Ensure `bun run build` still passes and the tarball includes `agents/`.
**Where**: `apps/opencode-plugin/package.json` (modify)
**Depends on**: T7 (CLI reads from `agents/`)
**Reuses**: existing package.json
**Requirement**: OPC-01 (agents must be present at runtime for the CLI to install them)

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `files` array includes `"agents/*.md"` (or `"agents"`)
- [ ] `bun run build` passes (5/5)
- [ ] `npm pack --dry-run` (or equivalent) shows `agents/massa-ai-*.md` in the tarball
- [ ] Gate: `bun run build`

**Tests**: none (build gate; T7 install test exercises the files)
**Gate**: build
**Commit**: `fix(opencode-plugin): ship agents/*.md in npm package files array`

---

### T9: Add install-agents.ts subagent deconfliction hints

**What**: Extend `scripts/install-agents.ts` to print a subagent hint in `ClaudeCodeWriter.apply()` (`:306`), `OpenCodeWriter.apply()` (`:349`), and add hints to `CodexWriter.apply()` + `CursorWriter.apply()` pointing to the new subagent install for that tool (separate from the existing MCP deconfliction hint).
**Where**: `scripts/install-agents.ts` (modify)
**Depends on**: T3, T5, T6, T7 (installers exist)
**Reuses**: existing hint pattern at `:306,349`
**Requirement**: DOC-05

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Claude/Codex/Cursor/OpenCode writers each print a subagent hint line
- [ ] Hints are separate from the existing MCP deconfliction hints
- [ ] `bun run type-check` passes
- [ ] Gate: `bun run type-check`

**Tests**: none (hint is a print; verified by grep in validation)
**Gate**: build (type-check)
**Commit**: `feat(install-agents): add subagent install hints for 4 tools`

---

### T10: Write FEATURES.md subagent depth section

**What**: Add a "Subagent Skills (12 Specialists)" section to `FEATURES.md` under `## Plugins (4-Tool Parity)` documenting per host: the 12 names, file locations/formats, the 4 model-pinning tables (verbatim from spec), effort pins, permission mappings, ownership markers, generator+parity contract. Keep the existing per-plugin `### <name> plugin` subsections; the new section is adjacent/under the Plugins section.
**Where**: `FEATURES.md` (modify)
**Depends on**: T2 (tables must reflect actual emitted values)
**Reuses**: spec's 4 model-pinning tables
**Requirement**: DOC-03, DOC-06

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] "Subagent Skills (12 Specialists)" section exists under `## Plugins (4-Tool Parity)`
- [ ] Per-host: 12 names, file locations/formats, model-pinning tables, effort pins, permission mappings, ownership markers, generator contract all documented
- [ ] 4 model-pinning tables byte-match spec tables (T4 parity test will assert this)
- [ ] Gate: `bun test scripts/__tests__/subagent-parity.test.ts` (FEATURES parity sub-check)

**Tests**: unit (T4 parity test asserts FEATURES ↔ spec table byte-match)
**Gate**: quick
**Commit**: `docs(features): add Subagent Skills (12 Specialists) depth section`

---

### T11: Update README.md summary + link to FEATURES.md

**What**: Update `README.md` `### Plugin Bundles (4-Tool Parity)` section to (a) state the 12 specialists ship in all four plugins, (b) name them compactly, (c) state model+effort pinned per host (host-specific values in brief), (d) add a relative link to `FEATURES.md#subagent-skills-12-specialists`. Do NOT duplicate the full per-agent tables (those live in FEATURES.md). Extend the bundles column of the existing 4-tool table to mention "+ 12 subagent specialists".
**Where**: `README.md` (modify)
**Depends on**: T10 (link target exists)
**Reuses**: existing `### Plugin Bundles` section at `:149-184`
**Requirement**: DOC-02, DOC-07

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] `### Plugin Bundles` summary mentions 12 specialists + compact names
- [ ] Model+effort pinning stated briefly per host
- [ ] Relative link to `FEATURES.md#subagent-skills-12-specialists` present
- [ ] 4-tool table bundles column updated
- [ ] No full per-agent tables in README (depth stays in FEATURES)
- [ ] Gate: manual review + grep for link

**Tests**: none (doc; T4 parity test covers FEATURES, not README)
**Gate**: build (no test; doc review)
**Commit**: `docs(readme): summarize 12 subagent specialists, link to FEATURES.md`

---

### T12: Root install.sh menu output + final gate

**What**: Verify the root `install.sh` `install_plugins_menu()` per-tool install output mentions the 12 specialists (it delegates to the per-plugin installers which now print the line — T3/T5/T6/T7). If the menu wrapper suppresses child output, add an explicit echo. Then run the full gate matrix.
**Where**: `install.sh` (verify/minor edit)
**Depends on**: T3, T5, T6, T7
**Reuses**: existing `install_plugins_menu()` at `:665-735`
**Requirement**: DOC-04

**Tools**:
- MCP: NONE
- Skill: NONE

**Done when**:
- [ ] Root menu per-tool install output mentions 12 specialists (via child installer or explicit echo)
- [ ] Full gate: `bun run type-check` 6/6, `bun run build` 5/5
- [ ] Full gate: `bun test scripts/__tests__/subagent-parity.test.ts` passes
- [ ] Full gate: `bun test apps/claude-plugin/__tests__/ apps/codex-plugin/__tests__/ apps/cursor-plugin/__tests__/ apps/opencode-plugin/src/__tests__/agents-install.test.ts` passes
- [ ] `bun run scripts/generate-subagent-artifacts.ts --check` exits 0
- [ ] No existing tests broken

**Tests**: none (final gate run)
**Gate**: build (full matrix)
**Commit**: `chore(install): surface 12-subagent line in root plugin menu + final gate`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ──→ T2 ──→ T3 ──→ T4
Phase 2:  T5 ──→ T6 ──→ T7 ──→ T8
Phase 3:  T9 ──→ T10 ──→ T11 ──→ T12
```

Execution is strictly sequential — no intra-phase parallelism. 12 tasks total → fits a single batch (≤ ~8) is borderline; since it's 12, this packs into 2 batches of ~6 (Phase 1+2 partial / Phase 2+3) OR inline if the user prefers. The sub-agent offer fires at Execute if >1 batch.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: Generator | 1 file (scripts/generate-subagent-artifacts.ts) | ✅ Granular |
| T2: Run generator + commit | emitted files (mechanical) | ✅ Granular |
| T3: Claude installer | 1 file (install.sh) + tests | ✅ Granular |
| T4: Parity test | 1 file (subagent-parity.test.ts) | ✅ Granular |
| T5: Codex installer | 1 file (install.sh) + tests | ✅ Granular |
| T6: Cursor installer | 1 file (install.sh) + tests | ✅ Granular |
| T7: OpenCode CLI | 1 file (config-cli.ts) + tests | ✅ Granular |
| T8: npm files array | 1 file (package.json) | ✅ Granular |
| T9: install-agents hints | 1 file (install-agents.ts) | ✅ Granular |
| T10: FEATURES.md | 1 file | ✅ Granular |
| T11: README.md | 1 file | ✅ Granular |
| T12: Root menu + final gate | verify + gate run | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (no arrow — start) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T2 | T2 → T3 | ✅ Match |
| T4 | T2 (T10 for FEATURES sub-check) | T2 → T3 → T4 (T4 in Phase 1) | ✅ Match (T10 dep is a soft sub-check gate, not a blocking dep — T4 can land before T10; the FEATURES sub-check is gated on FEATURES.md existence) |
| T5 | T2 | T5 (Phase 2 start) — T2 enables | ✅ Match |
| T6 | T2 | T6 | ✅ Match |
| T7 | T2 | T7 | ✅ Match |
| T8 | T7 | T7 → T8 | ✅ Match |
| T9 | T3, T5, T6, T7 | Phase 3 start, depends on Phase 2 | ✅ Match |
| T10 | T2 | T10 | ✅ Match |
| T11 | T10 | T10 → T11 | ✅ Match |
| T12 | T3, T5, T6, T7 | T12 (Phase 3 end) | ✅ Match |

**Note on T4 ↔ T10**: T4's FEATURES.md parity sub-check requires T10 to have landed. To keep T4 atomic and in Phase 1, T4 asserts FEATURES parity only if `FEATURES.md` contains the subagent section (gated check); the full FEATURES parity assertion is satisfied once T10 lands. No task depends on a later phase — T4's body notes T10 as a soft sub-check gate, not a blocking dep.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: Generator | Generator (scripts) | unit | none (verified by T4) | ✅ OK — generator is a build tool; its test is the parity test (T4) which is co-located in `scripts/__tests__/`. T1 produces no runtime code layer requiring standalone tests. |
| T2: Run generator | Static files (none) | none | none | ✅ OK |
| T3: Claude installer | Installer (integration) | integration | integration (extend install.test.ts) | ✅ OK |
| T4: Parity test | Test file | unit | unit (this IS the test) | ✅ OK |
| T5: Codex installer | Installer (integration) | integration | integration | ✅ OK |
| T6: Cursor installer | Installer (integration) | integration | integration | ✅ OK |
| T7: OpenCode CLI | CLI (integration) | integration | integration (new agents-install.test.ts) | ✅ OK |
| T8: npm files array | Config (none) | none | none (build gate) | ✅ OK |
| T9: install-agents hints | Script (none — print only) | none | none | ✅ OK |
| T10: FEATURES.md | Docs (unit — parity) | unit | unit (T4 asserts parity) | ✅ OK |
| T11: README.md | Docs (none) | none | none | ✅ OK |
| T12: Root menu + gate | Config/verify (none) | none | none (gate run) | ✅ OK |

---

## MCP and Skill Question

**Per-task tool selection** — for all 12 tasks: no MCP or skill materially changes implementation or verification. The work is bash installer edits, a TS generator, TS CLI extension, and markdown docs — all within the repo's existing tooling (`bun`, `bash`, `node`). No external API, no library lookup beyond what's already confirmed in the spec/design (Codex TOML format, OpenCode agent format — both web-verified). **Selected answer: NONE for all tasks.** Skipped reason: no available MCP/skill changes correctness or verification of installer/bash/markdown work.

---

## Artifact-Store Evidence

- Active artifact key: `.specs/features/subagent-skills-plugin-parity/tasks.md`
- Version: 1 (initial Tasks)
- Checksum: `59c28dabc9e9d2574acd39ce1fa53a7a51a1744e730278d7d019cbc5f1998d2c`
- Pre-approval checks: Granularity ✅, Diagram-Definition ✅, Test Co-location ✅ — all pass.