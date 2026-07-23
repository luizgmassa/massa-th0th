# Skills & Install Migration Specification

## Problem Statement

The massa-th0th project was migrated from the old `Useful-Agent-Skills` repo, but several core harness artifacts were left behind: the bootstrap contract (AGENTS.md), the unified symlink-based install logic for all four tools (OpenCode, Claude Code, Codex, Cursor), the skills documentation folder, the comprehensive test suite (validate_repository, agent_integrations, hooks), and the persona catalog/router. The new repo's `skills/AGENTS.md` currently holds only the sub-agent registry. The new repo has per-plugin copy-based bash installers but no unified symlink installer with uninstall support. Tests are TypeScript/bun-based but the old repo's 308 test scenarios (234 + 34 + 40) that validate structural integrity, install idempotency, and hook gating are absent.

## Goals

- [ ] Migrate and adapt the AGENTS.md bootstrap contract into `skills/AGENTS.md`, merged with the existing sub-agent registry.
- [ ] Implement a unified TypeScript symlink-based installer for all four tools with install + uninstall support.
- [ ] Migrate the `docs/skills/` documentation folder into the new repo's `docs/` structure.
- [ ] Port applicable test scenarios from the old repo to TypeScript/bun test.
- [ ] Migrate the persona-router skill and persona catalog into the new repo.
- [ ] Update README.md and FEATURES.md to reflect the migrated artifacts.

## Out of Scope

| Feature | Reason |
| ----------- | ---------- |
| Python hooks layer (hooks.json + scripts/hooks/*.py) | User chose to skip — new repo has per-plugin hook systems already. |
| Migrating old repo's init.sh | New repo has its own install.sh + bun-based verification. |
| Migrating old repo's contexts/ folder | Not requested; new repo doesn't use this pattern. |
| Migrating old repo's fixtures/ folder | Test fixtures are repo-specific. |
| Rewriting massa-th0th workflows to use agent invocations | Separate tracked feature (per skills/AGENTS.md "Future Integration"). |
| Migrating non-persona skills (caveman, coding-guidelines, etc.) | Those are global ~/.config skills, not repo-local. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | -------------- | --------- | ---------- |
| skills/AGENTS.md = bootstrap contract (top) + sub-agent registry (bottom), single file | Merge both sections | User chose "Merge both into skills/AGENTS.md" | y |
| Install logic = new unified TS installer (scripts/install-skills.ts) | TypeScript port | User chose "New unified TS installer"; fits Bun/TS stack | y |
| Tests = port to TypeScript/bun test | .test.ts under scripts/__tests__/ | User chose "Port to TypeScript/bun test"; consistent stack | y |
| Hooks migration = skip | Don't migrate hooks.json + Python hooks | User chose "Skip hooks migration"; new repo has per-plugin hooks | y |
| Personas live at skills/massa-th0th/personas/ (user-specified override) | skills/massa-th0th/personas/ | User typed custom answer overriding recommended skills/persona-router/references/personas/ | y |
| Bootstrap markers adapted from `useful-agent-skills:bootstrap` to `massa-th0th:bootstrap` | Rename markers | New repo identity; markers must match repo name | y |
| TS installer uses symlinks (not copies) for skills into each tool's config dir | Symlink-based | Old repo used symlinks; user explicitly requested symlinks | y |
| Per-plugin install.sh scripts remain unchanged for plugin-specific hooks/MCP | Don't modify existing plugin installers | New installer handles skills+bootstrap; plugin installers handle hooks+MCP | y |
| Ported tests cover scenarios that apply to new repo structure; skip obsolete ones | Selective porting | Some old tests reference removed skills (figma-implement, create-rfc, etc.) that no longer exist | y |
| docs/skills/ → docs/ in new repo (flat, not nested under docs/skills/) | Flatten into docs/ | New repo already has docs/adr/ and standalone docs files | y |
| STATE_DIR for install state = ~/.config/massa-th0th/install-state.json | Adapt from old ~/.config/useful-agent-skills/ | Match new repo identity | y |
| Installer writes bootstrap only into tool config dirs, NOT repo root AGENTS.md | Tool config dirs only | Repo root AGENTS.md is hand-maintained; avoids marker collision (F2) | y |
| New unified installer is for repo-local skills only; per-plugin install.sh handles full plugin (hooks+MCP+agents) | Separate scopes | Avoids copy/symlink conflict (F4); users run one or the other | y |
| catalog.json prompt_path values are filename-only (relative to skills/massa-th0th/personas/) | Filename-only paths | User chose skills/massa-th0th/personas/ location; paths must resolve from there (F5) | y |
| Repo root resolution in TS installer uses script file location, not CWD | __dirname-based | F1: CWD-based resolution breaks when invoked from different dirs | y |
| Ported test path constants adapted to new repo structure | Adapt all paths | F3: old paths like docs/skills/ don't exist in new repo | y |

**Open questions:** none — all resolved or logged above.

---

## Plan Challenge (The Fool — Pre-Mortem)

Ran The Fool in pre-mortem mode. 5 failure narratives identified; critical/high findings incorporated as assumptions above (F1-F5). Summary:

| # | Failure | Likelihood | Impact | Mitigation |
|---|---------|-----------|--------|-----------|
| F1 | Symlink target path resolution breaks across CWDs/platforms | High | High | Use `__dirname`/`import.meta.url`, add `--repo-root` flag, test with spaced paths |
| F2 | Bootstrap marker collision with root AGENTS.md | Medium | High | Installer writes only to tool config dirs, not repo root |
| F3 | Ported tests reference old repo structure, validate wrong things | Medium | Medium | Adapt ALL path constants; mark N/A for never-existed structures |
| F4 | Per-plugin copy + unified symlink installer conflict | Medium | High | Separate scopes; installer aborts on non-symlink conflict (MIG-06) |
| F5 | catalog.json prompt_path doesn't resolve after persona relocation | Medium | Medium | Filename-only prompt_path; update router library-root resolution |

---

## User Stories

### P1: Unified Symlink Installer ⭐ MVP

**User Story**: As a massa-th0th user, I want to install all repo-local skills into my coding agent's config directory via symlinks so that updates to the repo are immediately reflected without re-running installers.

**Why P1**: This is the core migration deliverable — without a working installer, the skills can't be consumed by any tool.

**Acceptance Criteria**:

1. WHEN `bun scripts/install-skills.ts --apply --platform all` is run THEN system SHALL create symlinks from each `skills/*/SKILL.md` into the detected tool's skill directory for all four platforms (claude, codex, cursor, opencode).
2. WHEN the installer is run a second time with `--apply` THEN system SHALL be idempotent (no changes, exit 0) when all symlinks already point to the correct targets.
3. WHEN `bun scripts/install-skills.ts --uninstall --platform all` is run THEN system SHALL remove only massa-th0th-owned symlinks and state, preserving user-installed skills and config.
4. WHEN a platform tool is not installed (e.g. `cursor` not on PATH) THEN system SHALL skip that platform with a warning and continue with the others.
5. WHEN `--dry-run` is passed THEN system SHALL print planned symlink creations/removals without writing anything to disk.
6. WHEN the installer detects a conflicting non-managed file at a symlink target THEN system SHALL abort with an error before any mutation (safety).
7. WHEN the bootstrap block is installed into a tool's AGENTS.md/CLAUDE.md THEN system SHALL use markers `<!-- massa-th0th:bootstrap:start -->` and `<!-- massa-th0th:bootstrap:end -->` and replace any existing block between those markers.
8. WHEN the installer runs THEN system SHALL persist install state to `~/.config/massa-th0th/install-state.json` recording platforms, roots, and skill names.
9. WHEN state file is v1 (legacy) THEN system SHALL migrate it to v2 format before proceeding.
10. WHEN `--check` is passed THEN system SHALL report drift (symlinks missing, pointing to wrong target, or extra managed symlinks) and exit 1 if drift found, 0 if clean.

**Independent Test**: Run installer against a temp HOME dir with a fake tool config dir, verify symlinks created; run again, verify idempotent; run --uninstall, verify cleaned.

---

### P2: Bootstrap Contract + Sub-Agent Registry Merge

**User Story**: As a developer working on massa-th0th, I want `skills/AGENTS.md` to contain both the coding session bootstrap contract and the sub-agent registry so that agents loading this file get the full startup stack.

**Why P2**: The bootstrap contract is what makes the skill stack activate; the registry documents the 12 agents. Both belong in the same file the user chose to merge.

**Acceptance Criteria**:

1. WHEN `skills/AGENTS.md` is read THEN it SHALL contain the bootstrap contract section (caveman + coding-guidelines + massa-th0th + persona-router activation order, dedupe guardrails, skill summary, RTK rules, contract ownership, persona router policy, plan challenge policy, conversation feedback policy, runtime contract pointer, indexing/context hygiene) adapted for the massa-th0th repo identity.
2. WHEN `skills/AGENTS.md` is read THEN it SHALL retain the existing sub-agent registry content (12 agents, capability packet, output contract, mapping table, how-to-add, concepts) unchanged in substance.
3. WHEN the bootstrap markers are checked THEN `skills/AGENTS.md` SHALL use `<!-- massa-th0th:bootstrap:start -->` and `<!-- massa-th0th:bootstrap:end -->` markers.
4. WHEN the old repo's `useful-agent-skills` references are adapted THEN all occurrences of `useful-agent-skills` in the bootstrap text SHALL be replaced with `massa-th0th` and `UAS_` env var prefixes SHALL become `MASSA_TH0TH_`.

**Independent Test**: Grep for both bootstrap section and agent table in skills/AGENTS.md; verify markers present; verify no `useful-agent-skills` or `UAS_` references remain.

---

### P3: Docs Migration

**User Story**: As a developer, I want the skills documentation from the old repo available in the new repo's docs/ directory so I can reference workflow guides.

**Why P3**: The docs/skills/ folder has 7 workflow guide files (452 lines) that document massa-th0th workflows.

**Acceptance Criteria**:

1. WHEN `docs/` is inspected THEN it SHALL contain the migrated workflow guide files (context-slices, massa-th0th-commit, massa-th0th-maestro, massa-th0th-mobile-figma, massa-th0th-rfc, massa-th0th-spec-driven, massa-th0th-tdd, massa-th0th-ticket) adapted for the new repo paths.
2. WHEN migrated docs reference skill paths THEN they SHALL use `skills/massa-th0th/workflows/...` (new repo structure), not `skills/massa-th0th/workflows/...` with old assumptions.
3. WHEN migrated docs reference the old repo name THEN no occurrence of `Useful-Agent-Skills` or `useful-agent-skills` SHALL remain in the migrated docs.

**Independent Test**: Compare file list between old docs/skills/ and new docs/; grep for old repo name in migrated files.

---

### P4: Persona Migration

**User Story**: As a massa-th0th user, I want the persona-router skill and persona catalog available so that conversations can be automatically routed to the right specialist perspective.

**Why P4**: Personas were left behind in the migration; the persona-router is part of the bootstrap stack.

**Acceptance Criteria**:

1. WHEN `skills/persona-router/SKILL.md` is inspected THEN it SHALL exist with the full persona-router skill content adapted for the new repo.
2. WHEN `skills/massa-th0th/personas/catalog.json` is inspected THEN it SHALL contain the catalog with schema_version 1 and all persona entries from the old repo.
3. WHEN `skills/massa-th0th/personas/` is inspected THEN it SHALL contain all 5 persona prompt files (ai-native-nodejs-cli-architect, context-skill-harness-engineer-architect, product-manager, senior-mobile-engineer, senior-mobile-qa-automation-engineer).
4. WHEN catalog.json `prompt_path` values are checked THEN they SHALL resolve relative to the new repo structure (skills/massa-th0th/personas/).
5. WHEN the persona-router SKILL.md references the persona library root THEN it SHALL resolve through the new repo's skills/persona-router/ directory.

**Independent Test**: Validate catalog.json parses, all prompt_path values resolve to existing files, SKILL.md exists.

---

### P5: Test Porting

**User Story**: As a maintainer, I want the old repo's structural validation, install integration, and hook gating tests ported to bun test so that CI catches regressions in the migrated artifacts.

**Why P5**: The old repo has 308 test scenarios that enforce repository invariants. Without them, drift goes undetected.

**Acceptance Criteria**:

1. WHEN `bun test scripts/__tests__/validate-repository.test.ts` is run THEN it SHALL cover applicable scenarios from the old `test_validate_repository.py`: skill file structure validation, workflow file existence, reference path validity, removed-skill absence checks, harness state path checks, gitignore contract, hook graph structure (adapted), massa-th0th router contract checks, retrieval contract, memory contract, observability contract, subagent packet contract.
2. WHEN `bun test scripts/__tests__/install-skills.test.ts` is run THEN it SHALL cover applicable scenarios from `test_agent_integrations.py`: apply idempotency, dry-run no-mutation, apply+uninstall preserve unrelated content, malformed state aborts before mutation, conflicting path aborts, v1→v2 state migration, partial platform uninstall, codex home resolution, symlink target correctness, bootstrap block replacement.
3. WHEN `bun test scripts/__tests__/install-skills.test.ts` is run with hook-gating scenarios THEN it SHALL cover applicable scenarios from `test_hooks.py` that are relevant to the new repo structure: bad stdin exits zero, disabled hook skips, profile-based hook selection, stop evidence gate workflow routing, config protection, context monitor. (Skip scenarios that test the unmigrated Python hooks layer.)
4. WHEN a ported test references a removed/obsolete scenario (e.g., figma-implement skill, create-rfc skill) THEN that test case SHALL be excluded with a documented skip reason, not silently dropped.
5. WHEN all ported tests are run via `bun test` THEN the full suite SHALL pass (exit 0).

**Independent Test**: Run `bun test scripts/__tests__/validate-repository.test.ts scripts/__tests__/install-skills.test.ts` and verify exit 0.

---

### P6: README + FEATURES Updates

**User Story**: As a new user evaluating massa-th0th, I want the README to summarize the skills/install system and FEATURES.md to document it in depth so I can understand what's available.

**Why P6**: Documentation must reflect the new artifacts.

**Acceptance Criteria**:

1. WHEN `README.md` is read THEN it SHALL contain a section summarizing the skills system (what skills are included, how to install them via the unified installer, symlink behavior, four-tool parity).
2. WHEN `FEATURES.md` is read THEN it SHALL contain a detailed "Skills & Install System" section covering: the bootstrap contract, the unified TS installer (commands, flags, symlink behavior, uninstall, state management), the persona-router, the docs/ workflow guides, and the sub-agent registry.
3. WHEN README and FEATURES reference the installer THEN the command SHALL be `bun scripts/install-skills.ts` (not the old Python script).
4. WHEN README and FEATURES reference personas THEN they SHALL point to `skills/massa-th0th/personas/` as the catalog location.

**Independent Test**: Grep README for skills section; grep FEATURES for "Skills & Install System"; verify installer command referenced.

---

## Edge Cases

- WHEN a symlink target already exists as a regular file (not a symlink) THEN system SHALL abort with IntegrationError, not overwrite.
- WHEN the state file is corrupted JSON THEN system SHALL raise IntegrationError, not silently reset.
- WHEN a skill directory has no SKILL.md THEN system SHALL skip it with a warning (not a valid skill).
- WHEN HOME directory is not writable THEN system SHALL abort with a clear error.
- WHEN running --uninstall without prior install THEN system SHALL report "nothing to uninstall" and exit 0.
- WHEN a platform config dir doesn't exist (e.g., ~/.codex/) THEN system SHALL create it before symlinking.
- WHEN --platform is specified for a tool not on PATH THEN system SHALL skip with warning, not fail.
- WHEN bootstrap block markers appear multiple times in a target file THEN system SHALL raise IntegrationError (exactly one pair expected).

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| MIG-01 | P1: Unified Installer | Design | Pending |
| MIG-02 | P1: Unified Installer | Design | Pending |
| MIG-03 | P1: Unified Installer | Design | Pending |
| MIG-04 | P1: Unified Installer | Design | Pending |
| MIG-05 | P1: Unified Installer | Design | Pending |
| MIG-06 | P1: Unified Installer | Design | Pending |
| MIG-07 | P1: Unified Installer | Design | Pending |
| MIG-08 | P1: Unified Installer | Design | Pending |
| MIG-09 | P1: Unified Installer | Design | Pending |
| MIG-10 | P1: Unified Installer | Design | Pending |
| MIG-11 | P2: Bootstrap Merge | Execute | Pending |
| MIG-12 | P2: Bootstrap Merge | Execute | Pending |
| MIG-13 | P2: Bootstrap Merge | Execute | Pending |
| MIG-14 | P2: Bootstrap Merge | Execute | Pending |
| MIG-15 | P3: Docs Migration | Execute | Pending |
| MIG-16 | P3: Docs Migration | Execute | Pending |
| MIG-17 | P3: Docs Migration | Execute | Pending |
| MIG-18 | P4: Persona Migration | Execute | Pending |
| MIG-19 | P4: Persona Migration | Execute | Pending |
| MIG-20 | P4: Persona Migration | Execute | Pending |
| MIG-21 | P4: Persona Migration | Execute | Pending |
| MIG-22 | P4: Persona Migration | Execute | Pending |
| MIG-23 | P5: Test Porting | Execute | Pending |
| MIG-24 | P5: Test Porting | Execute | Pending |
| MIG-25 | P5: Test Porting | Execute | Pending |
| MIG-26 | P5: Test Porting | Execute | Pending |
| MIG-27 | P5: Test Porting | Execute | Pending |
| MIG-28 | P6: README + FEATURES | Execute | Pending |
| MIG-29 | P6: README + FEATURES | Execute | Pending |
| MIG-30 | P6: README + FEATURES | Execute | Pending |
| MIG-31 | P6: README + FEATURES | Execute | Pending |

**ID format:** `MIG-[NUMBER]`

**Coverage:** 31 total, 31 mapped to tasks, 0 unmapped.

---

## Success Criteria

- [ ] `bun scripts/install-skills.ts --apply --platform all --dry-run` runs without error on a fresh HOME.
- [ ] `bun scripts/install-skills.ts --uninstall --platform all --dry-run` runs without error.
- [ ] `bun test scripts/__tests__/validate-repository.test.ts` passes.
- [ ] `bun test scripts/__tests__/install-skills.test.ts` passes.
- [ ] `skills/AGENTS.md` contains both bootstrap and sub-agent registry with correct markers.
- [ ] `skills/massa-th0th/personas/catalog.json` parses and all prompt_path resolve.
- [ ] `docs/` contains the migrated workflow guides.
- [ ] README.md and FEATURES.md reference the new installer and skills system.
- [ ] `bun run type-check` passes (6 tsc projects).
- [ ] No `useful-agent-skills` or `UAS_` references remain in migrated artifacts.

---

## Verification Approach

- **Gate commands:** `bun run type-check`, `bun test scripts/__tests__/`, `rg "useful-agent-skills|UAS_" skills/ docs/ scripts/ --ignore-case` (should return 0 matches).
- **Discrimination sensor:** inject a wrong symlink target in a test HOME, verify the drift test catches it; inject a malformed state file, verify abort.
- **Independent verifier:** fresh-eyes check that each AC has evidence in source files and the test suite passes.