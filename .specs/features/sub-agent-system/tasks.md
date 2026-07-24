# Sub-Agent System — Tasks

- feature: `sub-agent-system`
- workflowSessionId: `spec-sub-agent-system`

## Test Coverage Matrix

| AC | Sensor |
|---|---|
| AC-01 | File existence scan: `ls skills/<agent>/SKILL.md` for all 12 |
| AC-02 | Section scan: mission/responsibilities/restrictions present, <=6 responsibilities, >=2 restrictions |
| AC-03 | `## Inputs` and `## Outputs` present in each |
| AC-04 | `## Invocation` with Use/Do-not-use subsections in each |
| AC-05 | frontmatter `metadata.model_hint` present |
| AC-06 | `skills/AGENTS.md` table rows == 12, every charter path resolves |
| AC-07 | Mapping table present in `skills/AGENTS.md` |
| AC-08 | `skills/audit-specialist/SKILL.md` lists all 6 lenses |
| AC-09 | `skills/mobile-specialist/SKILL.md` declares detection + refusal |
| AC-10 | Root `AGENTS.md` lists 12 new agent skills |
| AC-11 | `git diff` shows no changes under symlinked skill workflows |
| AC-12 | `git diff` shows no changes under `packages/`, `apps/`, `benchmarks/` |
| AC-13 | Stale-reference scan: every `references/...md` named in a SKILL.md exists |
| AC-14 | Charter checklist from `references/subagent-design.md` holds per agent |
| AC-15 | All 13 new files non-empty |

## Gate Check Commands

```bash
# File existence (AC-01, AC-15)
for a in investigator planner builder reviewer context-curator verification-agent requirements-analyst architecture-specialist test-engineer documentation-agent audit-specialist mobile-specialist; do
  test -s "skills/$a/SKILL.md" && echo "OK $a" || echo "MISSING $a"
done
test -s skills/AGENTS.md && echo "OK registry" || echo "MISSING registry"

# Frontmatter model_hint (AC-05)
rg -l 'model_hint:' skills/*/SKILL.md | wc -l   # expect 12

# Sections (AC-02, AC-03, AC-04)
for a in investigator planner builder reviewer context-curator verification-agent requirements-analyst architecture-specialist test-engineer documentation-agent audit-specialist mobile-specialist; do
  f="skills/$a/SKILL.md"
  rg -q '## Mission' "$f" && rg -q '## Responsibilities' "$f" && rg -q '## Restrictions' "$f" && rg -q '## Inputs' "$f" && rg -q '## Outputs' "$f" && rg -q '## Invocation' "$f" && echo "OK sections $a" || echo "BAD sections $a"
done

# Registry rows (AC-06)
rg -c 'SKILL\.md' skills/AGENTS.md   # expect >=12

# Audit lenses (AC-08)
rg -q 'bugs' skills/audit-specialist/SKILL.md && rg -q 'architecture' skills/audit-specialist/SKILL.md && rg -q 'security' skills/audit-specialist/SKILL.md && rg -q 'requirements' skills/audit-specialist/SKILL.md && rg -q 'code-quality' skills/audit-specialist/SKILL.md && rg -q 'performance' skills/audit-specialist/SKILL.md && echo "OK lenses" || echo "BAD lenses"

# Mobile conditional (AC-09)
rg -q 'detection' skills/mobile-specialist/SKILL.md && rg -q 'refusal' skills/mobile-specialist/SKILL.md && echo "OK mobile" || echo "BAD mobile"

# Product AGENTS.md (AC-10)
rg -q 'investigator' AGENTS.md && rg -q 'mobile-specialist' AGENTS.md && echo "OK AGENTS.md" || echo "BAD AGENTS.md"

# No workflow/source changes (AC-11, AC-12)
git diff --name-only | rg -v '^(skills/|AGENTS\.md|\.specs/)' && echo "UNEXPECTED CHANGES" || echo "OK scope"

# Stale-reference scan (AC-13) — includes directory refs
SKILL_ROOT="/Users/luizmassa/Personal Projects/Useful-Agent-Skills/skills/massa-ai"
for ref in $(rg -o 'references/[a-zA-Z0-9./_-]+(\.md|/)' skills/*/SKILL.md | sort -u | cut -d: -f2); do
  base=$(echo "$ref" | sed 's:/$::')
  test -e "$SKILL_ROOT/$base" && echo "OK $ref" || echo "STALE $ref"
done
for ref in $(rg -o 'workflows/[a-zA-Z0-9./_-]+(\.md|/)' skills/*/SKILL.md | sort -u | cut -d: -f2); do
  base=$(echo "$ref" | sed 's:/$::')
  test -e "$SKILL_ROOT/$base" && echo "OK $ref" || echo "STALE $ref"
done
```

## Tasks

### Phase 1 — Registry and Template (T1)

- **T1.1** Create `skills/AGENTS.md` registry with: purpose, capability-packet spec, output contract, 12-row agent table (Name, Purpose, Permission, Model hint, Trigger, Charter), mapping table to existing roles, add-a-13th-agent instructions, future integration note.
  - Files: `skills/AGENTS.md`
  - Verify: file exists, 12 rows, mapping table present.
  - Commit: `feat(agents): add sub-agent registry and capability-packet contract`

### Phase 2 — Core Agents (T2-T5)

- **T2.1** Create `skills/investigator/SKILL.md` from template. Maps to existing role `investigator`. Read-only. DeepSeek V4 Pro. Own Synapse session.
  - Files: `skills/investigator/SKILL.md`
  - Verify: sections present, model_hint set, no modify-code restriction present.
  - Commit: `feat(agents): add investigator agent skill`

- **T3.1** Create `skills/context-curator/SKILL.md`. New. Read-only. DeepSeek V4 Pro. Own Synapse session. Output: Context Packet.
  - Files: `skills/context-curator/SKILL.md`
  - Verify: Context Packet output described, Synapse integration documented.
  - Commit: `feat(agents): add context-curator agent skill`

- **T4.1** Create `skills/planner/SKILL.md`. New. Read-only. GLM-5.2. Output: implementation plan.
  - Files: `skills/planner/SKILL.md`
  - Verify: never-implement restriction present.
  - Commit: `feat(agents): add planner agent skill`

- **T5.1** Create `skills/builder/SKILL.md`. Maps to existing role `implementer`. Write. GLM-5.2. Disjoint write set required.
  - Files: `skills/builder/SKILL.md`
  - Verify: write permission, disjoint-write-set constraint, never-review restriction.
  - Commit: `feat(agents): add builder agent skill`

### Phase 3 — Quality Agents (T6-T8)

- **T6.1** Create `skills/reviewer/SKILL.md`. New. Read-only. GLM-5.2. Diff review.
  - Files: `skills/reviewer/SKILL.md`
  - Verify: never-implement, never-rewrite restrictions.
  - Commit: `feat(agents): add reviewer agent skill`

- **T7.1** Create `skills/verification-agent/SKILL.md`. Maps to existing role `verifier`. Read-only. GLM-5.2. Centralizes Verification Ladder.
  - Files: `skills/verification-agent/SKILL.md`
  - Verify: verification level selection described, never-modify-implementation restriction.
  - Commit: `feat(agents): add verification-agent agent skill`

- **T8.1** Create `skills/requirements-analyst/SKILL.md`. New. Read-only. DeepSeek V4 Pro.
  - Files: `skills/requirements-analyst/SKILL.md`
  - Verify: ambiguity/gaps/contradictions/implicit responsibilities, never-implement restriction.
  - Commit: `feat(agents): add requirements-analyst agent skill`

### Phase 4 — Specialist Agents (T9-T11)

- **T9.1** Create `skills/architecture-specialist/SKILL.md`. Folds domain-mapper, coupling-auditor, deepening-architect. Read-only. MiniMax M3.
  - Files: `skills/architecture-specialist/SKILL.md`
  - Verify: 3 existing roles referenced as folded, never-implement restriction.
  - Commit: `feat(agents): add architecture-specialist agent skill`

- **T10.1** Create `skills/test-engineer/SKILL.md`. New. Read-only default (test files write when scoped). GLM-5.2.
  - Files: `skills/test-engineer/SKILL.md`
  - Verify: test-only focus restriction.
  - Commit: `feat(agents): add test-engineer agent skill`

- **T11.1** Create `skills/documentation-agent/SKILL.md`. New. Read-only default (doc files write when scoped). DeepSeek V4 Pro.
  - Files: `skills/documentation-agent/SKILL.md`
  - Verify: never-modify-implementation restriction, doc types listed.
  - Commit: `feat(agents): add documentation-agent agent skill`

### Phase 5 — Configurable and Conditional Agents (T12-T13)

- **T12.1** Create `skills/audit-specialist/SKILL.md`. New, configurable. Read-only. GLM-5.2. 6 lenses in one skill.
  - Files: `skills/audit-specialist/SKILL.md`
  - Verify: all 6 lenses documented, lens field flows from capability packet, per-lens checklist.
  - Commit: `feat(agents): add audit-specialist agent skill (6 lenses)`

- **T13.1** Create `skills/mobile-specialist/SKILL.md`. New, conditional. Read-only. GLM-5.2.
  - Files: `skills/mobile-specialist/SKILL.md`
  - Verify: detection signals, refusal condition for non-mobile, topics listed.
  - Commit: `feat(agents): add mobile-specialist agent skill (conditional)`

### Phase 6 — Product AGENTS.md Update (T14)

- **T14.1** Update root `AGENTS.md` "Available Skills (repo-local)" section to list all 12 new agent skills.
  - Files: `AGENTS.md`
  - Verify: `rg -q 'investigator' AGENTS.md && rg -q 'mobile-specialist' AGENTS.md`.
  - Commit: `docs(agents): list 12 sub-agent skills in product AGENTS.md`

### Phase 7 — Validation (T15)

- **T15.1** Run all Gate Check Commands. Fix any failures. Write `validation.md`.
  - Files: `.specs/features/sub-agent-system/validation.md`
  - Verify: all 15 ACs pass.
  - Commit: `test(agents): validate sub-agent system (15/15 ACs pass)`

## Execution Notes

- All tasks are docs/skill artifacts. No code compilation. No test runner. Sensors are file-existence, section, and stale-reference scans.
- One atomic commit per task.
- Sequential execution (each task is small and deterministic).
- No sub-agent dispatch needed (single-author docs work).

<!-- validator anchors: 15 tasks | 15 ACs | gate check commands | one commit per task -->