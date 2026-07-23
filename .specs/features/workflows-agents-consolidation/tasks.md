# Workflows + Agents Consolidation Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-th0th` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/workflows-agents-consolidation/design.md`
**Spec**: `.specs/features/workflows-agents-consolidation/spec.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

Guidelines found: `AGENTS.md` (cwd) — Tech Stack: `bun test` (Bun-native), `bun run type-check` (6 tsc projects), `bun run build` (turbo, 5 packages). Test runner = `bun:test`.

Relevant existing tests: `scripts/__tests__/subagent-parity.test.ts` — drift gate (generator `--check`), exact 12 per host, model/effort pins, permission boundaries, TOML round-trip, name collision. This test is the primary deterministic sensor for this feature.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md` (Tech Stack: bun test, type-check, build).

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Generator TS (path change) | unit (existing parity test) | Drift gate green; 48 files match; model/effort/permission pins intact | `scripts/__tests__/subagent-parity.test.ts` | `bun test scripts/__tests__/subagent-parity.test.ts` |
| Workflow markdown (dispatch blocks) | structural (grep + diff) | All 14 audit/fix workflows have `Dispatch:` blocks; zero old role names | `skills/massa-th0th/workflows/**/*.md` | `rg 'Dispatch:' skills/massa-th0th/workflows/` + `rg 'implementer\|verifier\|domain-mapper\|coupling-auditor\|deepening-architect' skills/massa-th0th/workflows/` |
| Registry markdown (charter column) | structural (grep) | Charter column points at `skills/agents/<name>/SKILL.md` | `skills/AGENTS.md` | `rg 'skills/agents/' skills/AGENTS.md` |
| Type integrity | build | type-check 6/6 passes | `turbo run type-check` | `bun run type-check` |

## Gate Check Commands

> Generated from codebase + Plan Challenge revisions — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After generator path change + registry update | `bun test scripts/__tests__/subagent-parity.test.ts` |
| Quick (copy) | After workflow skill move (T4-T5) | `diff -rq "<source>/skills/massa-th0th/references/" skills/massa-th0th/references/ && find skills/massa-th0th -name '*.pyc' -o -name '__pycache__' \| wc -l` (0) && `python3 skills/massa-th0th/scripts/lessons.py --root . list --status confirmed` |
| Full | After all rewrites | `bun test scripts/__tests__/subagent-parity.test.ts && rg 'Dispatch:' skills/massa-th0th/workflows/ && rg 'implementer\|domain-mapper\|coupling-auditor\|deepening-architect' skills/massa-th0th/workflows/ \|\| echo "zero old roles" && rg -A 12 'Dispatch: architecture-specialist' skills/massa-th0th/workflows/ \| rg 'lens:'` |
| Build | After all tasks | `bun run type-check` |

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Move Agents + Update Generator/Registry

T1 → T2 → T3

### Phase 2: Move Workflow Skill

T4 → T5

### Phase 3: Rewrite Workflows (by family)

T6 → T7 → T8 → T9 → T10 → T11 → T12 → T13 → T14

### Phase 4: Role Map + Final Validation

T15 → T16 → T17

---

## Task Breakdown

### T1: Move 12 agent charters to skills/agents/

**What**: Move the 12 specialist charter directories from `skills/<name>/` to `skills/agents/<name>/`. Leave `massa-th0th-memory` and `synapse-usage` at `skills/` top level.
**Where**: `skills/agents/` (new), removing `skills/investigator/` ... `skills/mobile-specialist/`
**Depends on**: None
**Reuses**: None (pure move)
**Requirement**: WAC-01

**Tools**:
- MCP: filesystem
- Skill: NONE

**Done when**:
- [ ] `skills/agents/<name>/SKILL.md` exists for all 12 specialists
- [ ] `skills/<name>/` no longer exists for the 12 specialists (only `massa-th0th-memory`, `synapse-usage`, `agents`, `AGENTS.md` remain at top level)
- [ ] No charter content changed (byte-identical move)

**Tests**: none (structural move; generator gate covers in T2)
**Gate**: none (T2 gate covers this)

---

### T2: Update generator path + registry, regenerate, verify drift gate

**What**: Update `loadCharter` in `scripts/generate-subagent-artifacts.ts` to read `skills/agents/<name>/SKILL.md`. Update `skills/AGENTS.md` Charter column to `skills/agents/<name>/SKILL.md`. Regenerate the 48 shipped files and confirm the drift gate is green.
**Where**: `scripts/generate-subagent-artifacts.ts:205`, `skills/AGENTS.md` (Charter column rows)
**Depends on**: T1
**Reuses**: Existing generator + parity test
**Requirement**: WAC-01, WAC-03, WAC-04, WAC-05

**Tools**:
- MCP: filesystem
- Skill: NONE

**Done when**:
- [ ] `loadCharter` reads `path.join(SKILLS_DIR, "agents", name, "SKILL.md")`
- [ ] `skills/AGENTS.md` Charter column points at `skills/agents/<name>/SKILL.md` for all 12
- [ ] `bun run scripts/generate-subagent-artifacts.ts` emits 48 files
- [ ] `bun run scripts/generate-subagent-artifacts.ts --check` exits 0 ("No drift")
- [ ] `bun test scripts/__tests__/subagent-parity.test.ts` — all describes pass

**Tests**: unit (existing parity test)
**Gate**: quick (`bun test scripts/__tests__/subagent-parity.test.ts`)

**Commit**: `refactor(skills): move 12 agent charters to skills/agents/ and update generator path`

---

### T3: Verify type-check passes after Phase 1

**What**: Run the full type-check to confirm the generator path change didn't break TS compilation.
**Where**: repo root
**Depends on**: T2
**Reuses**: Existing `bun run type-check`
**Requirement**: WAC-03

**Tools**: NONE
**Done when**:
- [ ] `bun run type-check` exits 0 (6/6 tsc projects)

**Tests**: none
**Gate**: build (`bun run type-check`)

---

### T4: Copy massa-th0th workflow skill into product repo

**What**: Copy the entire `skills/massa-th0th/` tree (SKILL.md router + workflows/ + references/ + scripts/lessons.py) from Useful-Agent-Skills into the product repo at `skills/massa-th0th/`. Exclude `__pycache__/` and `*.pyc` (stale bytecode) per the Plan Challenge finding E. The source tree has 124 files; the product copy must have exactly 123 (124 minus 1 `__pycache__/lessons.cpython-314.pyc`).
**Where**: `skills/massa-th0th/` (new in product repo)
**Depends on**: T2 (Phase 1 green first)
**Reuses**: Full tree from Useful-Agent-Skills `skills/massa-th0th/`
**Requirement**: WAC-02

**Tools**:
- MCP: filesystem
- Skill: NONE

**Done when**:
- [ ] `skills/massa-th0th/SKILL.md` exists (router)
- [ ] `skills/massa-th0th/workflows/` contains all 39 workflow files
- [ ] `skills/massa-th0th/references/` contains all reference files (exact count: `diff -rq <source>/skills/massa-th0th/references/ skills/massa-th0th/references/` returns empty, ignoring `__pycache__`)
- [ ] `skills/massa-th0th/scripts/lessons.py` exists
- [ ] Post-copy purge gate: `find skills/massa-th0th -name '*.pyc' -o -name '__pycache__' -o -name 'lessons.json' -o -name 'STATE.md'` returns 0 lines (no stale state files copied in)
- [ ] Reference-equality check: `diff -rq "/Users/luizmassa/Personal Projects/Useful-Agent-Skills/skills/massa-th0th/references/" skills/massa-th0th/references/` is empty (Plan Challenge finding C)
- [ ] File count: `find skills/massa-th0th -type f | wc -l` == 123 (source 124 minus the excluded `__pycache__` pyc)

**Tests**: structural (diff + purge gate)
**Gate**: quick

---

### T5: Verify workflow skill internal paths resolve + lessons.py smoke

**What**: Confirm internal reference paths in the copied skill resolve correctly, and confirm `lessons.py` runs without path errors (Plan Challenge finding A — falsified: lessons.py uses `--root .` not `__file__`-relative, but a smoke test confirms this empirically).
**Where**: `skills/massa-th0th/`
**Depends on**: T4
**Reuses**: None
**Requirement**: WAC-02

**Tools**: NONE
**Done when**:
- [ ] `rg 'references/agent-orchestration' skills/massa-th0th/workflows/` returns hits (paths resolve)
- [ ] `rg 'references/spec-driven' skills/massa-th0th/workflows/spec-driven.md` returns hits
- [ ] `ls skills/massa-th0th/references/agent-orchestration.md` exists
- [ ] Referenced-path-resolves: every `references/...` path in workflows points to an existing file (spot-check 5 random references)
- [ ] `python3 skills/massa-th0th/scripts/lessons.py --root . list --status confirmed` runs without error (lessons.py path smoke — finding A falsified, empirically confirmed)

**Tests**: structural
**Gate**: quick (grep checks + lessons.py smoke)

---

### T6: Rewrite architecture-audit + architecture-fix

**What**: Replace the duplicated scope-resolution block + "Use subagents only when useful" block with named dispatch blocks. Map `domain-mapper`/`coupling-auditor`/`deepening-architect` → `architecture-specialist` (name lens in inputs); `implementer` → `builder`; `verifier` → `verification-agent`.
**Where**: `skills/massa-th0th/workflows/architecture/architecture-audit.md`, `architecture-fix.md`
**Depends on**: T5
**Reuses**: Capability packet format from `agent-orchestration.md:74-87`
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] architecture-audit.md: investigation/scope section dispatches `investigator` (or `audit-specialist` lens=architecture) via dispatch block
- [ ] architecture-audit.md: "Use agent orchestration" block replaced with dispatch blocks for `architecture-specialist` + `verification-agent`
- [ ] architecture-fix.md: "Use subagents" block replaced with dispatch blocks for `builder` + `verification-agent`
- [ ] Zero old role names (`domain-mapper`, `coupling-auditor`, `deepening-architect`, `implementer`, `verifier`) in either file
- [ ] Finding-ID prefix `ARCH-`, severity rules, Evidence Gate step, routing header unchanged in meaning

**Tests**: structural (grep)
**Gate**: quick (`rg 'Dispatch:' ... && rg 'domain-mapper|coupling-auditor|deepening-architect|implementer|verifier' ...`)

---

### T7: Rewrite security-audit + security-fix

**What**: Same pattern as T6 for security family. Map roles; replace inline blocks with dispatch blocks.
**Where**: `skills/massa-th0th/workflows/security/security-audit.md`, `security-fix.md`
**Depends on**: T6
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] security-audit.md dispatches `investigator`/`audit-specialist` lens=security + `verification-agent`
- [ ] security-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `SEC-` prefix, severity rules, Evidence Gate unchanged in meaning

**Tests**: structural
**Gate**: quick

---

### T8: Rewrite requirements-audit + requirements-fix

**What**: Same pattern. Map `requirements-analyst` for requirement-specific scope resolution.
**Where**: `skills/massa-th0th/workflows/requirements/requirements-audit.md`, `requirements-fix.md`
**Depends on**: T7
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] requirements-audit.md dispatches `requirements-analyst` + `investigator`/`audit-specialist` lens=requirements + `verification-agent`
- [ ] requirements-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `REQ-` prefix, severity rules, Evidence Gate unchanged

**Tests**: structural
**Gate**: quick

---

### T9: Rewrite tests-audit + tests-fix

**What**: Same pattern. Map `test-engineer` for test-specific scope analysis.
**Where**: `skills/massa-th0th/workflows/tests/tests-audit.md`, `tests-fix.md`
**Depends on**: T8
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] tests-audit.md dispatches `test-engineer` + `investigator`/`audit-specialist` lens=performance + `verification-agent`
- [ ] tests-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `TST-` prefix, severity rules, Evidence Gate unchanged

**Tests**: structural
**Gate**: quick

---

### T10: Rewrite bugs-audit + bugs-fix

**What**: Same pattern.
**Where**: `skills/massa-th0th/workflows/bugs/bugs-audit.md`, `bugs-fix.md`
**Depends on**: T9
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] bugs-audit.md dispatches `investigator`/`audit-specialist` lens=bugs + `verification-agent`
- [ ] bugs-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `BUG-` prefix, severity rules, Evidence Gate unchanged

**Tests**: structural
**Gate**: quick

---

### T11: Rewrite code-quality-audit + code-quality-fix

**What**: Same pattern.
**Where**: `skills/massa-th0th/workflows/code-quality/code-quality-audit.md`, `code-quality-fix.md`
**Depends on**: T10
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] code-quality-audit.md dispatches `investigator`/`audit-specialist` lens=code-quality + `verification-agent`
- [ ] code-quality-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `CQ-` prefix, severity rules, Evidence Gate unchanged

**Tests**: structural
**Gate**: quick

---

### T12: Rewrite implementation-audit + implementation-fix

**What**: Same pattern. The implementation-audit is the parent that fans out child lenses — its dispatch blocks call `audit-specialist` with each lens name.
**Where**: `skills/massa-th0th/workflows/implementation/implementation-audit.md`, `implementation-fix.md`
**Depends on**: T11
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] implementation-audit.md dispatches `audit-specialist` per-lens via dispatch blocks
- [ ] implementation-fix.md dispatches `builder` + `verification-agent`
- [ ] Zero old role names; `IMPL-` prefix, severity rules, Evidence Gate unchanged

**Tests**: structural
**Gate**: quick

---

### T13: Rewrite spec-driven.md verifier contract + exploration.md investigation

**What**: Replace the inline verifier contract (spec-driven.md:96-98) with a `verification-agent` dispatch block. Replace the exploration.md BRIEFING→PLAN→EXECUTE→DEBRIEF investigation steps with an `investigator` dispatch block.
**Where**: `skills/massa-th0th/workflows/spec-driven.md`, `skills/massa-th0th/workflows/exploration.md`
**Depends on**: T12
**Reuses**: Same dispatch block format
**Requirement**: WAC-06, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] spec-driven.md verifier contract replaced by `verification-agent` dispatch block (author ≠ verifier independence preserved)
- [ ] exploration.md investigation steps reference `investigator` dispatch block
- [ ] Zero old role names (`verifier`, `implementer`); routing, memory tags, Evidence Gate unchanged in meaning

**Tests**: structural
**Gate**: quick

---

### T14: Rewrite remaining workflows with dispatch references (the-fool, furps-refinement, agent-handoff, debug, refactor, feature, general, tdd, adr, rfc, ticket, commit, design, restart-save, restart-load, long-session, onboarding, maestro*, mobile-figma*)

**What**: For workflows that reference role-based dispatches (`plan-critic`, `furps-analyst`, `handoff-writer`), keep them as role-based dispatch blocks (no charter). For workflows with no duplicated inline dispatch prose (onboarding, long-session), copy as-is. For debug/refactor/feature/general, replace any inline "use investigator/verifier" prose with dispatch blocks.
**Where**: All remaining workflow files under `skills/massa-th0th/workflows/`
**Depends on**: T13
**Reuses**: Same dispatch block format
**Requirement**: WAC-08, WAC-10

**Tools**: NONE
**Done when**:
- [ ] the-fool.md uses `plan-critic` role-based dispatch block (no charter ref)
- [ ] furps-refinement.md uses `furps-analyst` + `plan-critic` role-based dispatch blocks
- [ ] agent-handoff.md uses `handoff-writer` role-based dispatch block
- [ ] debug.md, refactor.md, feature.md, general.md replace inline dispatch prose with dispatch blocks where present
- [ ] Zero old role names across ALL workflow files
- [ ] Workflows with no dispatch prose (onboarding, long-session, etc.) unchanged

**Tests**: structural
**Gate**: quick

---

### T15: Full old-role-name sweep + dispatch-block field-completeness check + isolation checkpoint

**What**: Run a repo-wide grep to confirm zero old role names remain in any workflow, confirm dispatch blocks are present in all 14 audit/fix workflows, AND confirm every dispatch block has all 9 required fields (Plan Challenge finding B), AND confirm every `architecture-specialist` dispatch includes `lens:` (finding B/R6). This task also serves as the isolation checkpoint: run the parity test here to confirm the move (Phase 1-2) didn't break generator emission before the rewrite signal is trusted.
**Where**: `skills/massa-th0th/workflows/`
**Depends on**: T14
**Reuses**: None
**Requirement**: WAC-06, WAC-07, WAC-08, WAC-09

**Tools**: NONE
**Done when**:
- [ ] `rg 'implementer|domain-mapper|coupling-auditor|deepening-architect' skills/massa-th0th/workflows/` returns 0 hits
- [ ] `rg -c 'Dispatch:' skills/massa-th0th/workflows/` returns ≥14 (7 audit + 7 fix)
- [ ] **Field-completeness (finding B)**: every `Dispatch:` block contains all 8 listed fields. Check: for each dispatch block, `trigger:`, `scope:`, `permissions:`, `inputs:`, `sensors:`, `output:`, `firewall:`, `memory:` all present. Grep: `rg -A 12 'Dispatch:' skills/massa-th0th/workflows/ | rg -c 'trigger:|scope:|permissions:|inputs:|sensors:|output:|firewall:|memory:'` ≥ 8× the dispatch count.
- [ ] **architecture-specialist lens check (finding B/R6)**: `rg -A 12 'Dispatch: architecture-specialist' skills/massa-th0th/workflows/` — every hit block contains `lens:` in the inputs field.
- [ ] `rg 'verifier' skills/massa-th0th/workflows/` returns 0 hits (bare `verifier` role replaced by `verification-agent`)
- [ ] **Isolation checkpoint**: `bun test scripts/__tests__/subagent-parity.test.ts` passes (confirms Phase 1-2 move didn't break generator emission; if red here, the move is blamed, not the rewrite)

**Tests**: structural
**Gate**: full

---

### T16: Update agent-orchestration.md role table with charter paths

**What**: Update the Roles table in `skills/massa-th0th/references/agent-orchestration.md` to add a "Charter" column pointing mapped roles to `skills/agents/<name>/SKILL.md`, and mark `plan-critic`/`furps-analyst`/`handoff-writer` as "role-based (no charter)". Make the old→new mapping explicit.
**Where**: `skills/massa-th0th/references/agent-orchestration.md` (Roles table, ~line 62)
**Depends on**: T15
**Reuses**: Mapping from `skills/AGENTS.md:71-88`
**Requirement**: WAC-11, WAC-12

**Tools**: NONE
**Done when**:
- [ ] Roles table has a "Charter" column with `skills/agents/<name>/SKILL.md` for the 5 mapped agents
- [ ] `plan-critic`, `furps-analyst`, `handoff-writer` marked "role-based (no charter)"
- [ ] Mapping (`investigator`→`investigator`, `implementer`→`builder`, `verifier`→`verification-agent`, `domain-mapper`+`coupling-auditor`+`deepening-architect`→`architecture-specialist`) explicit in the table

**Tests**: structural
**Gate**: quick

---

### T17: Final build gate + feature-level validation

**What**: Run the full gate matrix (type-check, parity test, structural greps) and dispatch the independent Verifier for feature-level validation (behavior preservation + discrimination sensor).
**Where**: repo root + `.specs/features/workflows-agents-consolidation/validation.md`
**Depends on**: T16
**Reuses**: `references/spec-driven/validate.md`
**Requirement**: WAC-04, WAC-13, WAC-14, WAC-15

**Tools**:
- MCP: NONE
- Skill: `massa-th0th` (Verifier role)

**Done when**:
- [ ] `bun run type-check` exits 0 (6/6)
- [ ] `bun test scripts/__tests__/subagent-parity.test.ts` all describes pass
- [ ] `bun run scripts/generate-subagent-artifacts.ts --check` exits 0
- [ ] `rg 'implementer|domain-mapper|coupling-auditor|deepening-architect' skills/massa-th0th/workflows/` returns 0 hits
- [ ] Verifier writes `.specs/features/workflows-agents-consolidation/validation.md` with PASS verdict
- [ ] **Discrimination sensor 1 (old-role revert)**: revert one audit workflow to an old role name (`implementer`); confirm the grep test detects it (kills mutant).
- [ ] **Discrimination sensor 2 (missing lens — finding B)**: inject a `Dispatch: architecture-specialist` block missing the `lens:` field in inputs; confirm the field-completeness check from T15 detects it (kills mutant).

**Tests**: full + feature-level validation
**Gate**: build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4

Phase 1:  T1 ──→ T2 ──→ T3
Phase 2:  T4 ──→ T5
Phase 3:  T6 ──→ T7 ──→ T8 ──→ T9 ──→ T10 ──→ T11 ──→ T12 ──→ T13 ──→ T14
Phase 4:  T15 ──→ T16 ──→ T17
```

Execution is strictly sequential — there is no intra-phase parallelism. Total = 17 tasks across 4 phases.

**Packing:** 17 tasks > ~8 threshold → sub-agent offer applies. However, Phase 3 (T6-T14, 9 tasks) is a tight dependency chain of workflow rewrites where each builds on the pattern established in the prior; splitting across workers risks dispatch-block format drift. Recommend single-worker inline execution for Phase 3, batch only if the user explicitly requests parallelism.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: Move 12 charters | 12 dir moves (one cohesive op) | ✅ Granular (single structural op) |
| T2: Update generator + registry + regenerate | 1 TS path + 1 md column + regenerate | ✅ Granular (single integration point) |
| T3: Type-check | 1 command | ✅ Granular |
| T4: Copy workflow skill | 1 tree copy | ✅ Granular (single op) |
| T5: Verify paths | grep checks | ✅ Granular |
| T6-T12: One audit+fix pair each | 2 files per task | ✅ Granular (cohesive pair) |
| T13: spec-driven + exploration | 2 files (distinct families) | ✅ Granular |
| T14: Remaining workflows (batch) | ~17 files | ⚠️ Larger but cohesive (no-dispatch-prose files skip; role-based files are pattern-uniform) |
| T15: Sweep | grep check | ✅ Granular |
| T16: Role map update | 1 file | ✅ Granular |
| T17: Final validation | gate matrix + verifier | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | start | ✅ Match |
| T2 | T1 | T1→T2 | ✅ Match |
| T3 | T2 | T2→T3 | ✅ Match |
| T4 | T2 | T3→T4 (Phase 1→2) | ✅ Match |
| T5 | T4 | T4→T5 | ✅ Match |
| T6 | T5 | T5→T6 | ✅ Match |
| T7 | T6 | T6→T7 | ✅ Match |
| T8 | T7 | T7→T8 | ✅ Match |
| T9 | T8 | T8→T9 | ✅ Match |
| T10 | T9 | T9→T10 | ✅ Match |
| T11 | T10 | T10→T11 | ✅ Match |
| T12 | T11 | T11→T12 | ✅ Match |
| T13 | T12 | T12→T13 | ✅ Match |
| T14 | T13 | T13→T14 | ✅ Match |
| T15 | T14 | T14→T15 | ✅ Match |
| T16 | T15 | T15→T16 | ✅ Match |
| T17 | T16 | T16→T17 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | Agent charters (move) | none (structural) | none | ✅ OK |
| T2 | Generator TS + registry md | unit (parity test) | unit (parity) | ✅ OK |
| T3 | None (type-check only) | build | none (gate) | ✅ OK |
| T4 | Workflow skill md (copy) | structural | none (T5 covers) | ✅ OK |
| T5 | None (verify) | structural | structural | ✅ OK |
| T6-T12 | Workflow md (rewrite) | structural (grep) | structural | ✅ OK |
| T13 | Workflow md (rewrite) | structural | structural | ✅ OK |
| T14 | Workflow md (rewrite) | structural | structural | ✅ OK |
| T15 | None (sweep) | structural | structural | ✅ OK |
| T16 | Reference md (role map) | structural | structural | ✅ OK |
| T17 | Validation report | full + feature | full + feature | ✅ OK |

---

## MCP and Skill Question

For each task, which tools should I use?

- **MCP**: filesystem (for T1/T4 file moves) — otherwise NONE.
- **Skill**: `massa-th0th` (for T17 Verifier dispatch) — otherwise NONE.

No available MCP or skill materially changes implementation or verification correctness for T2-T16 (they are markdown edits + structural greps). The existing parity test + type-check are the deterministic sensors.

---

## Artifact-Store Evidence

After each task write, record the active artifact key, version, and checksum. `tasks.md` is the active artifact; checksum computed after this file is written.