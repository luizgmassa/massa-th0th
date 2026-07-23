# Tasks: Skills & Install Migration

## Task Breakdown

### Phase 1: Content Migration (T1-T6)

**T1: Merge bootstrap contract into skills/AGENTS.md**
- Read old repo root `AGENTS.md` bootstrap block (lines 1-294)
- Adapt: `useful-agent-skills` → `massa-th0th`, `UAS_` → `MASSA_TH0TH_`, marker names
- Remove "Repository Harness" section (hooks/init.sh references — not migrating)
- Prepend adapted bootstrap block to existing `skills/AGENTS.md` (sub-agent registry)
- Markers: `<!-- massa-th0th:bootstrap:start -->` / `<!-- massa-th0th:bootstrap:end -->`
- ACs: MIG-11, MIG-12, MIG-13, MIG-14
- Gate: `rg "useful-agent-skills|UAS_" skills/AGENTS.md --ignore-case` → 0 matches
- Commit: `feat: merge bootstrap contract into skills/AGENTS.md`

**T2: Migrate docs/skills/ → docs/**
- Copy 8 files from old `docs/skills/` to new `docs/`
- Replace `Useful-Agent-Skills` / `useful-agent-skills` references with `massa-th0th`
- Verify path references point to `skills/massa-th0th/workflows/` (unchanged path)
- ACs: MIG-15, MIG-16, MIG-17
- Gate: `rg "useful-agent-skills|Useful-Agent-Skills" docs/ --ignore-case` → 0 matches
- Commit: `docs: migrate workflow guides from old repo`

**T3: Migrate persona-router skill**
- Copy `skills/persona-router/SKILL.md` from old repo to new `skills/persona-router/SKILL.md`
- Copy `skills/persona-router/references/` if it has content beyond personas
- Adapt: update library-root resolution to find catalog at `../massa-th0th/personas/catalog.json`
- ACs: MIG-18, MIG-22
- Gate: `skills/persona-router/SKILL.md` exists and references new persona path
- Commit: `feat: migrate persona-router skill`

**T4: Migrate personas to skills/massa-th0th/personas/**
- Create `skills/massa-th0th/personas/` directory
- Copy 5 persona prompt .md files from old `prompts/personas/` (or `skills/persona-router/references/personas/`)
- Copy `catalog.json`, update `prompt_path` values to filename-only (remove `references/personas/` prefix)
- ACs: MIG-19, MIG-20, MIG-21
- Gate: catalog.json parses; all prompt_path resolve to existing files
- Commit: `feat: migrate persona catalog to skills/massa-th0th/personas/`

**T5: Create prompts/personas/README.md equivalent (optional)**
- Copy old `prompts/personas/README.md` to `skills/massa-th0th/personas/README.md`
- Adapt references to new location
- Commit: `docs: add personas README`

**T6: Verify no old-repo references remain in migrated content**
- Run `rg "useful-agent-skills|Useful-Agent-Skills|UAS_" skills/ docs/ --ignore-case`
- Fix any remaining references
- Gate: 0 matches
- Commit: (if fixes needed) `fix: remove residual old-repo references`

### Phase 2: Unified TS Installer (T7-T11)

**T7: Create scripts/install-skills.ts — core structure + types**
- Define types: `Platform`, `InstalledTool`, `OperationResult`, `Mutation`, `InstallerState`
- Define constants: PLATFORMS, PLATFORM_LABELS, PLATFORM_EXECUTABLES, BOOTSTRAP markers
- Implement repo root resolution via `import.meta.url` (F1 mitigation)
- Implement `discoverSkillSources()` — scan `skills/*/SKILL.md`
- Implement `extractBootstrap()` — extract marked block from `skills/AGENTS.md`
- Implement `detectInstalledTools()` — `command -v` per platform
- ACs: MIG-01 (partial), MIG-04 (partial), MIG-07, MIG-08 (partial)
- Gate: `bun run type-check` passes
- Commit: `feat: add install-skills.ts core structure and types`

**T8: Implement install/apply logic**
- `applyPlatform(platform, home, skills, bootstrap)` — create symlinks + write bootstrap
- Symlink: `fs.symlink(absoluteSkillDir, targetSkillDir, 'dir')` per skill
- Bootstrap: read tool AGENTS.md (or create), replace/insert marked block
- Abort on non-symlink conflict at target (MIG-06)
- Create platform config dir if missing
- Write state file: `~/.config/massa-th0th/install-state.json` (v2 format)
- ACs: MIG-01, MIG-02, MIG-06, MIG-07, MIG-08
- Gate: `bun run type-check` passes
- Commit: `feat: implement install-skills.ts apply logic`

**T9: Implement uninstall logic**
- `uninstallPlatform(platform, home, state)` — remove managed symlinks, remove bootstrap block
- Read state file to know what we installed
- Remove only symlinks pointing to our repo root
- Remove bootstrap block from tool AGENTS.md using markers
- Clean up empty skill dirs if we created them
- Handle "nothing to uninstall" gracefully (exit 0)
- ACs: MIG-03, MIG-10 (partial)
- Gate: `bun run type-check` passes
- Commit: `feat: implement install-skills.ts uninstall logic`

**T10: Implement dry-run, check, and state migration**
- `--dry-run`: print planned operations, write nothing
- `--check`: compare current symlinks vs expected, report drift, exit 1 if drift
- State v1→v2 migration: detect v1 format, migrate to v2 before proceeding
- CLI arg parsing: `--apply|--uninstall|--dry-run|--check`, `--platform`, `--target`, `--repo-root`, `--yes`, `--json`
- ACs: MIG-05, MIG-09, MIG-10
- Gate: `bun run type-check` passes; `bun scripts/install-skills.ts --dry-run --platform all` runs
- Commit: `feat: implement install-skills.ts dry-run, check, and state migration`

**T11: Wire install-skills.ts into package.json scripts**
- Add `"install:skills": "bun scripts/install-skills.ts"` to package.json scripts
- Add `"uninstall:skills": "bun scripts/install-skills.ts --uninstall"` 
- Gate: `bun run install:skills -- --dry-run --platform all` works
- Commit: `chore: wire install-skills into package.json`

### Phase 3: Tests (T12-T15)

**T12: Port validate-repository.test.ts**
- Create `scripts/__tests__/validate-repository.test.ts`
- Port applicable scenarios from `test_validate_repository.py`:
  - Skill file structure validation (SKILL.md frontmatter, required sections)
  - Workflow file existence (all workflows referenced in SKILL.md exist)
  - Reference path validity (referenced files exist)
  - massa-th0th router contract checks (retrieval, memory, observability, subagent packet)
  - Harness state path checks (adapted to new repo .specs/ paths)
  - Gitignore contract
  - Hook graph structure (adapted — hooks.json may not exist; skip if absent)
  - Removed-skill absence: skip tests for skills that never existed in new repo; keep tests for skills present in new repo
- Adapt ALL path constants to new repo structure (F3 mitigation)
- ACs: MIG-23, MIG-26
- Gate: `bun test scripts/__tests__/validate-repository.test.ts` passes
- Commit: `test: port validate-repository tests to bun test`

**T13: Port install-skills.test.ts**
- Create `scripts/__tests__/install-skills.test.ts`
- Port applicable scenarios from `test_agent_integrations.py`:
  - Apply idempotency (install twice = no changes)
  - Dry-run doesn't create files
  - Apply + uninstall preserve unrelated content
  - Malformed state JSON aborts before mutation
  - Conflicting non-symlink path aborts
  - v1→v2 state migration
  - Partial platform uninstall preserves other platforms
  - Symlink target correctness
  - Bootstrap block replacement (markers, idempotent replace)
  - Platform detection (mock `command -v`)
- Use temp dirs for fake HOME (follow `install-agents.test.ts` pattern)
- ACs: MIG-24, MIG-26
- Gate: `bun test scripts/__tests__/install-skills.test.ts` passes
- Commit: `test: port install-skills tests to bun test`

**T14: Port hook-gating scenarios into install-skills.test.ts**
- Add hook-gating scenarios from `test_hooks.py` that are applicable:
  - Bad stdin exits zero (test the installer handles malformed input gracefully)
  - Profile-based hook selection (test as data-structure validation of hooks.json if present)
  - Config protection path validation (test that protected config paths are detected)
- Skip Python hook execution tests (hooks layer not migrated)
- Document skip reasons for excluded scenarios (MIG-26)
- ACs: MIG-25, MIG-26
- Gate: `bun test scripts/__tests__/install-skills.test.ts` passes
- Commit: `test: port hook-gating scenarios to install-skills tests`

**T15: Run full test suite + fix failures**
- Run `bun test scripts/__tests__/` — all tests pass
- Run `bun run type-check` — passes
- Fix any failures
- ACs: MIG-27
- Gate: `bun test scripts/__tests__/ && bun run type-check` exit 0
- Commit: `test: fix ported test failures`

### Phase 4: Documentation (T16-T17)

**T16: Update README.md**
- Add "Skills & Install" section summarizing:
  - What skills are included (massa-th0th, massa-th0th-memory, synapse-usage, persona-router, 12 sub-agent specialists)
  - How to install: `bun scripts/install-skills.ts --apply --platform all`
  - Symlink behavior (skills symlinked from repo to tool config dir)
  - Four-tool parity (Claude, Codex, Cursor, OpenCode)
  - Uninstall: `bun scripts/install-skills.ts --uninstall`
- Keep it summary-level (depth goes in FEATURES.md)
- ACs: MIG-28, MIG-30
- Gate: README has skills section with installer command
- Commit: `docs: update README with skills & install section`

**T17: Update FEATURES.md**
- Add "Skills & Install System" section with depth:
  - Bootstrap contract (what it is, markers, activation order)
  - Unified TS installer (commands, flags, symlink behavior, state management, v1→v2 migration)
  - Persona-router (catalog, routing policy, persona list)
  - Docs workflow guides (list of migrated docs)
  - Sub-agent registry (reference to skills/AGENTS.md)
- ACs: MIG-29, MIG-31
- Gate: FEATURES has "Skills & Install System" section
- Commit: `docs: update FEATURES.md with skills & install system section`

### Phase 5: Final Gate (T18)

**T18: Full verification gate**
- Run `bun run type-check` (6 tsc projects)
- Run `bun test scripts/__tests__/`
- Run `rg "useful-agent-skills|UAS_" skills/ docs/ scripts/ --ignore-case` → 0
- Run `bun scripts/install-skills.ts --dry-run --platform all` → no error
- Update `.specs/project/STATE.md` and `FEATURES.json`
- Write `validation.md`
- ACs: All
- Gate: all green
- Commit: `chore: final gate — skills & install migration complete`

## Test Coverage Matrix

| Requirement | Test File | Test Scenarios |
|-------------|-----------|----------------|
| MIG-01 (symlink create) | install-skills.test.ts | apply creates symlinks for all platforms |
| MIG-02 (idempotent) | install-skills.test.ts | apply twice = no changes |
| MIG-03 (uninstall) | install-skills.test.ts | uninstall removes managed symlinks only |
| MIG-04 (skip uninstalled) | install-skills.test.ts | missing tool skipped with warning |
| MIG-05 (dry-run) | install-skills.test.ts | dry-run writes nothing |
| MIG-06 (conflict abort) | install-skills.test.ts | non-symlink at target aborts |
| MIG-07 (bootstrap markers) | install-skills.test.ts | markers correct, replace works |
| MIG-08 (state persist) | install-skills.test.ts | state file written correctly |
| MIG-09 (v1→v2 migration) | install-skills.test.ts | v1 state migrates |
| MIG-10 (check drift) | install-skills.test.ts | check reports drift, exit 1 |
| MIG-11-14 (AGENTS.md) | validate-repository.test.ts | bootstrap+registry present, markers correct |
| MIG-15-17 (docs) | validate-repository.test.ts | docs exist, no old refs |
| MIG-18-22 (personas) | validate-repository.test.ts | catalog parses, paths resolve |
| MIG-23-27 (tests) | self-evident | tests pass |
| MIG-28-31 (docs) | manual | README+FEATURES have sections |

## Gate Check Commands

```bash
bun run type-check
bun test scripts/__tests__/validate-repository.test.ts
bun test scripts/__tests__/install-skills.test.ts
rg "useful-agent-skills|UAS_" skills/ docs/ scripts/ --ignore-case
bun scripts/install-skills.ts --dry-run --platform all --target /tmp/test-home
```

## Dependency Order

```
T1 ─┬─ T6 (verify no old refs)
T2 ─┘
T3 ── T4 ── T5
T7 ── T8 ── T9 ── T10 ── T11
T1,T2,T3,T4,T7,T8,T9,T10 ── T12 ── T13 ── T14 ── T15
T15 ── T16 ── T17 ── T18
```