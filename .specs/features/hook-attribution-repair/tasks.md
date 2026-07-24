# Hook Attribution Repair — Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/hook-attribution-repair/design.md`
**Status**: Approved

---

## Project Testing Guidelines Scan

- Repo test location convention: `packages/core/src/__tests__/*.test.ts` (Bun test runner); script/plugin suites live beside them (`hook-scripts.test.ts`, `observation-emitter.test.ts`, `hook-service.test.ts`).
- Owned PG acceptance precedent: `project-identity-pg-acceptance.test.ts` gated by env var, skips cleanly when unset; migrations applied from scratch to an owned DB.
- Root scripts: `test` = `turbo run test` (per-package `bun scripts/run-tests-isolated.ts` for core); `type-check` = `turbo run type-check`; `build` = `turbo run build`.
- Guidelines files found: root `AGENTS.md` (session/verification policy), `.specs/wave-3-gate-manifest.md`. Coverage expectation: every spec AC has ≥1 deterministic test; domain logic (resolver) is 1:1 branch coverage.

## Test Coverage Matrix

> Generated from codebase sampling + spec. Confirmed with task approval.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Attribution resolver + pin store (domain) | unit (DB-free, fake provider) | All branches; 1:1 to AC-1..AC-4, AC-9; order matrix, nested/ambiguous roots, broad-root, TTL/eviction, sanitized failure | `packages/core/src/__tests__/attribution-resolver.test.ts` | `bun test packages/core/src/__tests__/attribution-resolver.test.ts` |
| HookService wiring (domain) | unit (DB-free) | AC-1/4/5/6 fields flow into Observation; all ingestion paths incl. compact-snapshot seam verified | `packages/core/src/__tests__/hook-service.test.ts` (extend) | `bun test packages/core/src/__tests__/hook-service.test.ts` |
| Observation PG repo + mirror | integration (owned PG) | AC-5/6/7 persist + canonical mirror reads after alias rename | `packages/core/src/__tests__/hook-attribution-acceptance.test.ts` | `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL=... bun test <suite>` |
| Repair migration | integration (owned PG) | AC-8 seed/repair/ambiguous-skip/self-verify/re-run no-op | same acceptance suite | same |
| Claude hook scripts | unit (shell harness, existing pattern) | AC-5 pin write/read, fallback without git, silent-degrade exit 0 | `packages/core/src/__tests__/hook-scripts.test.ts` (extend) | `bun test packages/core/src/__tests__/hook-scripts.test.ts` |
| OpenCode plugin pinning | unit | AC-4/5 session memo precedence + reuse | `packages/core/src/__tests__/observation-emitter.test.ts` (extend) or new plugin-adjacent suite per existing convention | `bun test <suite>` |
| Entity/config (contract type, turbo.json) | none | build/type gate only | — | `bun run type-check` |

## Gate Check Commands

> All commands run under pinned Bun 1.3.11: `export PATH="/var/folders/2s/y7r9gt5d15s48_z4nxkhyldr0000gn/T/opencode/bun-1.3.11/node_modules/.bin:$PATH"` (recreate via `npm i bun@1.3.11` into a temp dir if missing).

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick | After each unit-touching task | `bun test packages/core/src/__tests__/<changed-suite>.test.ts` |
| Acceptance | After T4/T7 and before validation | `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL=postgres://luizmassa@127.0.0.1:5432/massa_ai_hook_attribution bun test packages/core/src/__tests__/hook-attribution-acceptance.test.ts` (owned DB; suite skips without var) |
| Full | After T7 and at validation | `bun run test` (expect only pre-existing failure set from HANDOFF) |
| Build | Validation | `bun run type-check` (6/6) and `bun run build --force` (5/5) |

---

## Execution Plan

### Phase 1: Foundation

T1 → T2

### Phase 2: Server wiring

T3 → T4

### Phase 3: Emitters

T5 → T6

### Phase 4: Repair

T7

### Phase 5: Validation

T8

8 tasks total → single batch; inline execution in main window, independent review subagent before each commit.

---

## Task Breakdown

### T1 / TASK-001: Additive observation attribution columns + contract fields

**What**: Migration `…_add_observation_attribution` adding nullable `agent_id` + `attribution_source` to `observations`; `Observation` contract gains `agentId?`/`attributionSource?`.
**Where**: `packages/core/prisma/migrations/<ts>_add_observation_attribution/migration.sql`; `packages/core/src/services/hooks/observation-contract.ts` (exact file confirmed at execute).
**Depends on**: None
**Reuses**: migration style precedent `20260714233000_add_index_job_parser_diagnostics` (`ADD COLUMN IF NOT EXISTS`).
**Requirement**: HAR-05, HAR-06

**Tools**: MCP: NONE. Skill: NONE (question asked; no MCP/skill changes correctness).

**Done when**:
- [ ] Migration applies cleanly on owned DB (idempotent re-run no-op)
- [ ] Contract type compiles; no other type errors
- [ ] Gate: `bun run type-check` passes for core

**Tests**: none (entity/schema layer — build gate only)
**Gate**: build-scoped (`cd packages/core && bun run type-check`)

**Commit**: `feat(hooks): add observation attribution columns`

---

### T2 / TASK-002: AttributionResolver + SessionPinStore (DB-free)

**What**: `attribution-resolver.ts` (explicit→sticky→containment→verbatim; canonicalize; broad-root exclusion; sanitized fail-open catch) and `session-pin-store.ts` (bounded 1000, TTL 24h).
**Where**: `packages/core/src/services/hooks/attribution-resolver.ts`, `session-pin-store.ts`; tests `packages/core/src/__tests__/attribution-resolver.test.ts`.
**Depends on**: None
**Reuses**: alias-resolver cache/timeout pattern (`alias-resolver.ts:80-98`); `realpathSafe` semantics (`workspace.ts:85-91`).
**Requirement**: HAR-01, HAR-02, HAR-03, HAR-09 (resolver half)

**Done when**:
- [ ] Full order matrix: explicit (direct + alias-resolved) beats pin; pin beats containment; containment longest-match on path-deduped roots; shared-path self-match wins when caller id ∈ sharing set; shared-path non-member, tie, or zero match → verbatim; `/` and `$HOME` roots excluded from containment
- [ ] Internal provider/realpath failure → verbatim + sanitized warn (no paths/SQL in error)
- [ ] Pin store evicts at bound and expires at TTL
- [ ] Gate: `bun test packages/core/src/__tests__/attribution-resolver.test.ts` passes; test count recorded (no silent deletions)

**Tests**: unit (matrix: all branches, 1:1 AC-1..AC-4 resolver half, AC-9)
**Gate**: quick

**Commit**: `feat(hooks): add attribution resolver with containment and broad-root exclusion`

---

### T3 / TASK-003: HookService wiring at all ingestion seams + compact-snapshot closure

**What**: Run resolver pre-enqueue in `ingestOne`/`ingestBatch`; add optional `cwd` to the compact-snapshot wire body and route `CompactSnapshotTool`'s persist through the resolver (verified bypass at `compact_snapshot.ts:80`); populate `Observation.agentId` + `attributionSource`; resolved `projectId`.
**Where**: `packages/core/src/services/hooks/hook-service.ts`; `packages/core/src/tools/compact_snapshot.ts`; `apps/tools-api/src/routes/hooks.ts` (schema); `apps/claude-plugin/hooks/pre-compact.sh` (send `$PWD`); tests `packages/core/src/__tests__/hook-service.test.ts` (extend) + route-level compact-snapshot test.
**Depends on**: T2
**Reuses**: existing normalized agentId (`hook-service.ts:134-135`).
**Requirement**: HAR-01, HAR-04 (server half), HAR-05, HAR-06 (wiring half)

**Done when**:
- [ ] All ingestion entry points (single, batch, compact-snapshot) route through resolver — proven by a route-level compact-snapshot attribution test (not code inspection)
- [ ] Observation carries resolved id + provenance + agentId
- [ ] Session pinned on non-verbatim resolutions
- [ ] Gate: `bun test packages/core/src/__tests__/hook-service.test.ts` + compact-snapshot route test pass; counts recorded

**Tests**: unit (extend existing suite: sticky reuse, explicit-wins, fields populated)
**Gate**: quick

**Commit**: `feat(hooks): resolve attribution before enqueue at all ingestion seams`

---

### T4 / TASK-004: PG observation persistence + canonical mirror + acceptance suite

**What**: Persist `agent_id`/`attribution_source`; mirror keyed by canonical (alias-resolved) id; create `hook-attribution-acceptance.test.ts` (owned PG, env-gated); add `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL` to turbo `passThroughEnv`.
**Where**: `packages/core/src/data/memory/observation-repository-pg.ts`; `packages/core/src/__tests__/hook-attribution-acceptance.test.ts`; `turbo.json`.
**Depends on**: T1, T3
**Reuses**: identity acceptance pattern (`project-identity-pg-acceptance.test.ts`); alias seam at `:181`.
**Requirement**: HAR-05, HAR-06, HAR-07, HAR-10 (suite birth)

**Done when**:
- [ ] AC-5/6/7 pass against owned DB: columns persisted; insert via retired alias then `listRecent`/`countByProject` with canonical id returns row without restart
- [ ] Suite skips cleanly without env var; turbo forwards var (verified under `bun run test --filter` scoped run or documented turbo dry evidence)
- [ ] Gate: acceptance command passes; quick suites (`hook-service`, `attribution-resolver`) still green

**Tests**: integration (owned PG)
**Gate**: acceptance

**Commit**: `feat(hooks): persist attribution provenance and key observation mirror canonically`

---

### T5 / TASK-005: Claude hook session pinning (stdin-safe `_pin.sh`)

**What**: New sourced helper `apps/claude-plugin/hooks/_pin.sh` (pin file read/write, env > git toplevel > cwd basename); `_post.sh` + `pre-compact.sh` call it AFTER existing stdin capture (single-read constraint — plan-critic C3); any first event type pins the session.
**Where**: `apps/claude-plugin/hooks/_pin.sh`, `_post.sh`, `pre-compact.sh`; tests `packages/core/src/__tests__/hook-scripts.test.ts` (extend).
**Depends on**: None
**Reuses**: existing script harness pattern (`hook-scripts.test.ts:28-84`).
**Requirement**: HAR-04 (Claude emitter half)

**Done when**:
- [ ] Pin written on first event of a session; later scripts emit pinned id from a subdirectory (AC-5 harness)
- [ ] Session-start event POST body asserted intact (pin logic never consumes stdin early)
- [ ] No-git / no-pin fallbacks behave as today; scripts still exit 0 on API failure
- [ ] Gate: `bun test packages/core/src/__tests__/hook-scripts.test.ts` passes; count recorded

**Tests**: unit (shell harness)
**Gate**: quick

**Commit**: `feat(hooks): pin claude hook project id per session`

---

### T6 / TASK-006: OpenCode plugin session pinning + agentId population

**What**: Per-session memo of project id in plugin (`project?.id` > git toplevel basename > directory basename > `"default"`), reused by all emit paths; populate `agentId` from host context on emit paths (HAR-06 value half).
**Where**: `apps/opencode-plugin/src/index.ts` (and `observation-emitter.ts` if memo lives there); tests per existing plugin test convention.
**Depends on**: None
**Reuses**: current derivation at `index.ts:118`.
**Requirement**: HAR-04 (OpenCode emitter half), HAR-06 (emitter half)

**Done when**:
- [ ] First event computes id; later events of same session reuse memo even from subdirectory contexts
- [ ] Precedence and `"default"` fallback preserved
- [ ] Emitted events carry `agentId` when host context provides one
- [ ] Gate: focused plugin/emitter suite passes; count recorded

**Tests**: unit
**Gate**: quick

**Commit**: `feat(hooks): pin opencode plugin project id per session`

---

### T7 / TASK-007: Idempotent hook-attribution repair migration

**What**: Migration `…_repair_hook_attribution` per design: candidate re-derivation via payload-cwd containment (broad `/` excluded), unambiguous-only, `attribution_source='repaired'`; memories via unambiguous session linkage; explicit tx; `DO $$` self-verification with notices; re-run no-op.
**Where**: `packages/core/prisma/migrations/<ts>_repair_hook_attribution/migration.sql`; acceptance suite (extend).
**Depends on**: T1, T4
**Reuses**: template `20260714170000_add_graph_generations/migration.sql:128-205`.
**Requirement**: HAR-08

**Done when**:
- [ ] AC-8: seeded NULL/`'default'`/orphan rows with unambiguous cwd repaired + stamped + `_pre_repair_project_id` preserved; ambiguous (nested roots, multi-id shared path, no cwd, multi-match) untouched and counted; seeded junk nested workspace does not capture rows when the match is ambiguous; memories repaired only via unambiguous session linkage with pre-repair preservation
- [ ] Candidate predicates are NULL-safe (`NOT EXISTS`, no `NOT IN` over nullable sets)
- [ ] `DO $$` raises on violated invariants; second run changes zero rows
- [ ] Gate: acceptance command passes

**Tests**: integration (owned PG)
**Gate**: acceptance

**Commit**: `feat(hooks): repair historical hook misattribution idempotently`

---

### T8 / TASK-008: Full gates + validation.md + independent verifier

**What**: Run full regression (expect only HANDOFF pre-existing set), type-check 6/6, build 5/5 under Bun 1.3.11; write `validation.md`; dispatch independent verifier (spec-anchored + discrimination sensor ≥2 mutations); remediate ≤3 rounds.
**Where**: `.specs/features/hook-attribution-repair/validation.md`.
**Depends on**: T1–T7
**Requirement**: HAR-09, HAR-10 (final), all ACs re-checked

**Done when**:
- [ ] Full/type/build gates recorded in validation.md
- [ ] Verifier verdict PASS (or Blocked after 3 rounds with evidence)
- [ ] Per-AC evidence map + mutation results in validation.md

**Tests**: all (re-run)
**Gate**: full + build

**Commit**: `docs(specs): validate hook attribution repair`

---

## Phase Execution Map

```
Phase 1:  T1 ──→ T2
Phase 2:  T3 ──→ T4
Phase 3:  T5 ──→ T6
Phase 4:  T7
Phase 5:  T8
```

Sequential; T5/T6 independent of T3/T4 but run in listed order.

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1 | 1 migration + 1 contract type | ✅ Granular |
| T2 | 2 cohesive resolver files + 1 suite | ✅ Granular |
| T3 | 1 service wiring + suite | ✅ Granular |
| T4 | 1 repo + 1 suite + turbo line | ✅ Granular |
| T5 | 3 hook scripts (one mechanism) + suite | ✅ Granular |
| T6 | 1 plugin memo + suite | ✅ Granular |
| T7 | 1 migration + suite | ✅ Granular |
| T8 | validation only | ✅ Granular |

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | none | ✅ |
| T2 | None | none | ✅ |
| T3 | T2 | T2→T3 | ✅ |
| T4 | T1, T3 | T1→…→T4, T3→T4 | ✅ |
| T5 | None | none | ✅ |
| T6 | None | none | ✅ |
| T7 | T1, T4 | T1/T4→T7 (phase order) | ✅ |
| T8 | T1–T7 | all→T8 | ✅ |

## Test Co-location Validation

| Task | Layer | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1 | schema/entity | none (build gate) | none | ✅ OK |
| T2 | domain | unit | unit | ✅ OK |
| T3 | domain | unit | unit | ✅ OK |
| T4 | repository | integration | integration | ✅ OK |
| T5 | scripts | unit | unit | ✅ OK |
| T6 | plugin | unit | unit | ✅ OK |
| T7 | migration | integration | integration | ✅ OK |
| T8 | all | re-run | all | ✅ OK |

Requirement coverage: HAR-01..10 all mapped (T2/T3/T4/T5/T6/T7/T8). No unmapped requirements.
