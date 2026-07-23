# Validation: Skills & Install Migration

**Status:** PASS
**Date:** 2026-07-23
**Validator:** Independent (fresh-eyes standalone — author ≠ verifier)
**Spec:** `.specs/features/skills-install-migration/spec.md`
**Design:** `.specs/features/skills-install-migration/design.md`

## Per-AC Evidence

### P1: Unified Symlink Installer (MIG-01..10)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-01 (symlink create) | `install-skills.ts:applyPlatform()` — `fs.symlink(source, target, "dir")`. Test: `install-skills.test.ts` "creates symlinks and writes bootstrap" — PASS | PASS |
| MIG-02 (idempotent) | `applyPlatform()` checks `fs.readlink` → compares to source → returns null if correct. Test: "idempotent — second apply is no-op" — PASS | PASS |
| MIG-03 (uninstall) | `uninstallPlatform()` removes symlinks pointing into repo root + removes bootstrap block. Test: "removes managed symlinks and bootstrap" — PASS | PASS |
| MIG-04 (skip uninstalled) | `detectInstalledTools()` uses `command -v`; main loop filters `activePlatforms`. Dry-run output: "Cursor skipped — tool not on PATH" | PASS |
| MIG-05 (dry-run) | `--dry-run` sets `dryRun=true`; `createSymlink` returns "would-change" without writing. Test: "dry-run writes nothing" — PASS | PASS |
| MIG-06 (conflict abort) | `createSymlink()` checks `existing.isSymbolicLink()` — if not symlink, returns error status. Test: "aborts on non-symlink conflict" — PASS | PASS |
| MIG-07 (bootstrap markers) | `BOOTSTRAP_START/END` constants; `replaceBlock()` replaces between markers. Test: "replaces existing bootstrap block" — PASS | PASS |
| MIG-08 (state persist) | `saveState()` writes to `~/.config/massa-th0th/install-state.json`. Test: "saveState writes state file" — PASS | PASS |
| MIG-09 (v1→v2 migration) | `loadState()` detects v1, migrates to v2. Test: "migrates v1 state to v2" — PASS | PASS |
| MIG-10 (check drift) | `checkPlatform()` compares symlinks vs expected, reports drift. Test: "clean — no drift after apply", "detects missing symlink as drift", "detects wrong symlink target as drift" — PASS | PASS |

### P2: Bootstrap Merge (MIG-11..14)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-11 (bootstrap section present) | `skills/AGENTS.md` lines 1-276: bootstrap contract with activation order, dedupe guardrails, skill summary, RTK rules, policies, indexing hygiene | PASS |
| MIG-12 (sub-agent registry preserved) | `skills/AGENTS.md` lines 278+: 12 agents, capability packet, output contract, mapping table unchanged | PASS |
| MIG-13 (markers correct) | `rg -n "massa-th0th:bootstrap:(start\|end)"` → line 1 (start), line 276 (end) | PASS |
| MIG-14 (no old refs) | `rg "useful-agent-skills\|UAS_" skills/AGENTS.md` → 0 matches | PASS |

### P3: Docs Migration (MIG-15..17)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-15 (docs exist) | 8 files in `docs/`: context-slices.md, massa-th0th-commit.md, massa-th0th-maestro.md, massa-th0th-mobile-figma.md, massa-th0th-rfc.md, massa-th0th-spec-driven.md, massa-th0th-tdd.md, massa-th0th-ticket.md | PASS |
| MIG-16 (paths adapted) | Docs reference `skills/massa-th0th/workflows/` (valid new repo path) | PASS |
| MIG-17 (no old refs) | `rg "useful-agent-skills\|Useful-Agent-Skills" docs/` → 0 matches | PASS |

### P4: Persona Migration (MIG-18..22)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-18 (persona-router SKILL.md) | `skills/persona-router/SKILL.md` exists with frontmatter | PASS |
| MIG-19 (catalog.json) | `skills/massa-th0th/personas/catalog.json` parses, schema_version=1 | PASS |
| MIG-20 (5 persona files) | All 5 .md files present in `skills/massa-th0th/personas/` | PASS |
| MIG-21 (prompt_path resolves) | All `prompt_path` values (filename-only) resolve to existing files. Test: "all prompt_path values resolve" — PASS | PASS |
| MIG-22 (router references catalog) | `skills/persona-router/SKILL.md` contains "massa-th0th/personas/catalog.json" | PASS |

### P5: Test Porting (MIG-23..27)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-23 (validate-repository) | 72 tests in `validate-repository.test.ts` covering skill structure, workflow existence, references, router contract, personas, harness state, gitignore, no old refs — all PASS | PASS |
| MIG-24 (install-skills) | 39 tests in `install-skills.test.ts` covering apply, idempotency, uninstall, dry-run, conflict, state migration, drift, partial uninstall — all PASS | PASS |
| MIG-25 (hook gating) | Hook gating scenarios in `install-skills.test.ts`: malformed state aborts, conflict aborts, partial uninstall preserves other platforms, v1 uninstall without migration — PASS | PASS |
| MIG-26 (skip reasons) | Obsolete test scenarios (figma-implement, create-rfc, Python hooks) excluded; skip documented in test comments | PASS |
| MIG-27 (all pass) | `bun test scripts/__tests__/validate-repository.test.ts scripts/__tests__/install-skills.test.ts` → 111 pass, 0 fail | PASS |

### P6: README + FEATURES (MIG-28..31)

| AC | Evidence | Status |
|----|----------|--------|
| MIG-28 (README skills section) | README.md has "Skills & Install System" section with included skills table, installer commands, workflow guides table | PASS |
| MIG-29 (FEATURES depth) | FEATURES.md has "Skills & Install System" section with bootstrap contract, included skills, installer commands/flags/targets/state/safety, persona router, workflow guides, tests | PASS |
| MIG-30 (installer command) | README and FEATURES reference `bun scripts/install-skills.ts` | PASS |
| MIG-31 (personas path) | README and FEATURES reference `skills/massa-th0th/personas/` | PASS |

## Discrimination Sensor

| Sensor | Mutation | Expected | Actual | Status |
|--------|----------|----------|--------|--------|
| 1 | Inject wrong symlink target (`/wrong/target`) | `--check` detects drift, exit 1 | Detected: "massa-th0th symlink points to /wrong/target, expected ..." exit 1 | KILLED |
| 2 | Malformed state JSON (`{malformed json`) | Apply aborts with IntegrationError, exit 2 | "ERROR: Malformed JSON in installer state" exit 2 | KILLED |

## Gate Check Commands

| Command | Result |
|---------|--------|
| `bun run type-check` | 6/6 tsc projects PASS |
| `bun test scripts/__tests__/validate-repository.test.ts` | 72/72 PASS |
| `bun test scripts/__tests__/install-skills.test.ts` | 39/39 PASS |
| `rg "useful-agent-skills\|UAS_" skills/ docs/ scripts/install-skills.ts --ignore-case` | 0 matches |
| `bun scripts/install-skills.ts --dry-run --platform all --target /tmp/test --yes` | exit 0 |

## Changed Artifacts

| File | Change |
|------|--------|
| `skills/AGENTS.md` | Merged bootstrap contract (top) + sub-agent registry (bottom) |
| `docs/context-slices.md` | Migrated from old repo |
| `docs/massa-th0th-commit.md` | Migrated from old repo |
| `docs/massa-th0th-maestro.md` | Migrated from old repo |
| `docs/massa-th0th-mobile-figma.md` | Migrated from old repo |
| `docs/massa-th0th-rfc.md` | Migrated from old repo |
| `docs/massa-th0th-spec-driven.md` | Migrated from old repo |
| `docs/massa-th0th-tdd.md` | Migrated from old repo |
| `docs/massa-th0th-ticket.md` | Migrated from old repo |
| `skills/persona-router/SKILL.md` | Migrated + adapted catalog path |
| `skills/massa-th0th/personas/catalog.json` | Migrated + adapted prompt_path to filename-only |
| `skills/massa-th0th/personas/*.md` | 5 persona prompt files + README migrated |
| `skills/massa-th0th/scripts/lessons.py` | Fixed UAS_ → MASSA_TH0TH_ env vars |
| `skills/massa-th0th/workflows/long-session.md` | Fixed projectId reference |
| `skills/massa-th0th/references/memory-policy.md` | Fixed projectId reference |
| `skills/massa-th0th/references/hook-enforcement.md` | Fixed UAS_ → MASSA_TH0TH_ env vars |
| `scripts/install-skills.ts` | NEW — unified TS symlink installer |
| `scripts/__tests__/validate-repository.test.ts` | NEW — 72 structural validation tests |
| `scripts/__tests__/install-skills.test.ts` | NEW — 39 installer + hook gating tests |
| `package.json` | Added install:skills / uninstall:scripts scripts |
| `README.md` | Added "Skills & Install System" section |
| `FEATURES.md` | Added "Skills & Install System" section + TOC entry |

## Residual Risk

None found. All 31 ACs verified, 2/2 discrimination mutations killed, type-check 6/6, 111/111 tests pass.