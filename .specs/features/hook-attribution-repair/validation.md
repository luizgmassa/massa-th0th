# Hook Attribution Repair — Validation

**Feature**: `hook-attribution-repair` (Wave 3 M45+M47)
**projectId**: `massa-ai` · **workflowSessionId**: `spec-wave-3` · **branch**: `wave-3`
**Verdict**: PASS (T1–T8 complete; gates green; independent verifier PASS)
**Runtime**: Bun `1.3.11` (pinned, AD-004/005), Node `25.9.0` build helper.

## Task → Commit Map

| Task | Commit | Summary |
| --- | --- | --- |
| Specify | `21bb272` + `89217f4` | spec/design/tasks + activate |
| T1 | `b015508` | additive cols `agent_id` + `attribution_source` |
| T2 | `0b78e32` | `AttributionResolver` + `SessionPinStore` (29 DB-free tests) |
| T3 | `34fa019` | resolver wired pre-enqueue at all seams + compact-snapshot cwd closure |
| T4 | `fc8b81b` | PG persist provenance + canonical mirror + acceptance suite + turbo `passThroughEnv` |
| Checkpoints | `7a553f6`, `f77a295` | bookkeeping |
| **T5** | **`de78480`** | Claude `_pin.sh` per-session pinning (stdin-safe) |
| **T6** | **`4e8f1a9`** | OpenCode plugin `SessionProjectPin` + `agentId` population |
| **T7** | **`397f4f9`** | idempotent repair migration + extended acceptance (HAR-08) |
| **T8** | (this commit) | validation.md |

## Requirements → Acceptance Criteria → Evidence

### HAR-01 / AC-1,2,3 — Resolution order (explicit > sticky > containment > verbatim)
- **Evidence**: `attribution-resolver.test.ts` (T2) order matrix; `hook-attribution-acceptance.test.ts` T4 "HAR-01 verbatim fail-open" + "HAR-05/06 containment" (T4); resolver `attribution-resolver.ts`.
- **Gate**: `bun test packages/core/src/__tests__/attribution-resolver.test.ts` — green inside full regression.

### HAR-02 / AC-2 — Containment: longest match, path-dedup, ambiguous→verbatim
- **Evidence**: resolver unit matrix (nested/ambiguous/broad); repair migration path-deduped containment (`HAVING n=1`, `starts_with`, `rn=1 AND tie=1`); T7 "shared-path ambiguous untouched" + "nested longest match".
- **Gate**: `hook-attribution-acceptance.test.ts` T7 cases.

### HAR-03 / AC-3 — Broad-root exclusion (`/`, `$HOME`)
- **Evidence**: resolver excludes `os.homedir()` + FS root; migration excludes `project_path='/'`.
- **Gate**: resolver unit tests; migration seeds would not match `/`.

### HAR-04 / AC-4,5 — Session stickiness (server pin + emitter pin)
- **Evidence**: `session-pin-store.ts` (server, T2); `apps/claude-plugin/hooks/_pin.sh` (T5) — pin file `${TMPDIR:-/tmp}/massa-ai-hooks/<sanitized-session>`; `apps/opencode-plugin/src/session-project-pin.ts` (T6).
- **Gates**: `hook-scripts.test.ts` (15 tests, T5: first-event pin, pin-beats-env, no-git fallback, pre-compact, sanitize, degenerate-ids, missing-helper fallback, exit-0-on-API-fail, empty-stdin no-op); `session-project-pin.test.ts` (12 tests, T6: precedence, memo reuse, distinct sessions, no-session bypass, bound eviction, git safe-fail, agentIdOf).
- **AC-5 (stdin single-read, plan-critic C3)**: T5 "first event from a subdirectory pins; POST body intact" asserts `payload == {session_id, marker:"intact"}` — the pin logic ran AFTER stdin capture.

### HAR-05 / AC-5 — Additive columns + provenance persistence
- **Evidence**: migration `20260720120000_add_observation_attribution`; `Observation` contract; `observation-repository-pg.ts` persists `agent_id`+`attribution_source`; T4 acceptance "HAR-05/06 durable row".
- **Gate**: `hook-attribution-acceptance.test.ts` T4.

### HAR-06 / AC-5 — `agent_id` populated honestly
- **Evidence**: server-side agentId pass-through; OpenCode `agentIdOf(host-context)` (T6); Claude honestly NULL (no agent concept — plan-critic C5).
- **Gate**: T4 "absent agentId persists as NULL"; T6 `agentIdOf` tests.

### HAR-07 / AC-7 — Mirror keyed by canonical id
- **Evidence**: `observation-repository-pg.ts` canonical-keyed mirror (T4 fix); T4 "HAR-07 mirror keyed by canonical id after alias rename".
- **Gate**: T4 acceptance.

### HAR-08 / AC-8 — Idempotent repair migration
- **Evidence**: migration `20260720210000_repair_hook_attribution` (T7) — NULL-safe `NOT EXISTS`, path-deduped containment, broad `/` excluded, `_pre_repair_project_id` preserved in `payload_json`/`metadata` (memories use `COALESCE(to_jsonb(...),'null'::jsonb)` for NULL old id), self-verifying `DO $$`, idempotent (candidate filter excludes `attribution_source='repaired'`).
- **Gate**: `hook-attribution-acceptance.test.ts` T7 — 8 tests: unambiguous repair+stamp+preserve; orphan non-live repair; shared-path ambiguous untouched; no-cwd never candidate; nested longest match; memory unambiguous-vs-ambiguous session; idempotent re-run (obs AND mem, pre-repair id byte-identical); `DO $$` raises on non-live repaired invariant.

### HAR-09 / AC-9 — Sanitized fail-open
- **Evidence**: resolver try/catch → verbatim + sanitized warn (error name only; no SQL/paths/caller ids); `attribution-resolver.test.ts` sanitized-failure probe; T4 verbatim acceptance.
- **Gate**: resolver unit tests; acceptance.

### HAR-10 / AC-10 — Feature-owned gates
- **Evidence**: `hook-attribution-acceptance.test.ts` (env-gated, skips cleanly without `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL`); `turbo.json` `passThroughEnv` includes the var (T4).
- **Gates**: owned PG `massa_ai_hook_attribution` @ 127.0.0.1:5432; focused unit suites; full regression; type-check 6/6; build 5/5.

## Gate Results (this session, Bun 1.3.11)

| Gate | Command | Result |
| --- | --- | --- |
| Focused: hook-scripts | `bun test packages/core/src/__tests__/hook-scripts.test.ts` | 15 pass / 0 fail (70 assertions) |
| Focused: plugin | `bun test apps/opencode-plugin/src/__tests__/` | 30 pass / 0 fail (94 assertions) |
| Focused: resolver+service | `bun test attribution-resolver.test.ts hook-service.test.ts` | 58 pass / 0 fail |
| Acceptance (T4+T7) | `HOOK_ATTRIBUTION_ACCEPTANCE_DATABASE_URL=… bun test hook-attribution-acceptance.test.ts` | 12 pass / 0 fail (36 assertions) |
| Full regression | `bun run test` | only the 6 pre-existing failure groups (scheduler-store-pg, etl-pipeline-queue, etl-cache-invalidation, auto-improve-job, qwen-e2e-fixture, trace-path) — all shared-DB/isolation, NONE task-owned; hook-attribution suites green inside |
| Type-check | `bun run type-check` | 6/6 |
| Build | `bun run build --force` | 5/5 |

## Pre-existing Failure Classification (NOT task-owned — never chase)

| Suite | Cause | Evidence |
| --- | --- | --- |
| scheduler-store-pg | shared-DB persist race | reproduces at clean baseline `1e21f9a` |
| etl-pipeline-queue (3–4) | shared-DB `graph_generation_workspace_missing` | same family at baseline; 4th passes solo |
| etl-cache-invalidation (1) | module-mock isolation | 1=1 at baseline |
| auto-improve-job (2) | flaky 5s timeouts | baseline also fails (+2 more) |
| qwen-e2e-fixture (2) | shared-DB fixture | 2=2 at baseline |
| trace-path (2–8) | shared-DB fixture race | subset of baseline 8 |

No new failure introduced by T5/T6/T7/T8.

## Plan-Critic (Pre-mortem) Outcomes — all incorporated

| Finding | Incorp. at |
| --- | --- |
| C1 — path-dedup + self-match preference (resolver + migration) | T2 + T7 (`HAVING n=1`, explicit-tier self-match) |
| C2 — NULL-safe `NOT EXISTS`; `_pre_repair_project_id` preservation; grooming runbook (docs-only) | T7 (never `NOT IN`); design runbook; `e2e-ai-shared` preserved per ops decision |
| C3 — `_pin.sh` runs AFTER stdin capture | T5 (pin call after `$(cat)`; AC-5 body-intact test) |
| C4 — compact-snapshot optional `cwd` + resolver routing + route test | T3 |
| C5 — OpenCode populates `agentId`; Claude honestly NULL | T6 (`agentIdOf`); T4 NULL-acceptance |

## Independent Verifier

Dispatched against the spec AC map + discrimination sensors. Result: **PASS**.

- All 10 ACs exercised by deterministic tests (cited map below).
- All claimed gates reproduced exactly (15 / 30 / 58 / 12 pass; type-check 6/6; build 5/5).
- No test weakened or deleted (git diff on test files: additive only).
- Sanitization honest (resolver warn payload `{ name }` only — no cwd/SQL/caller ids; spy-tested).
- Idempotency proven for BOTH observations and memories (counts + preserved ids byte-identical across second run).

**Discrimination sensors (mutation testing)**:

| Mutant | Target | Killed? |
| --- | --- | --- |
| M1 — `_pin.sh` removes "existing pin wins" early-return (always recomputes) | T5 "later event reuses pin (pin beats env)" + "env override on fresh session" | YES |
| M2 — `computePluginProjectId` drops the git toplevel tier | T6 "git toplevel basename beats directory basename" | YES |
| M4 — migration omits `_pre_repair_project_id` jsonb_set on observations | T7 "unambiguous cwd…preserves pre-repair id" + DO $$ Invariant 2 raise | YES |
| M3 — migration `HAVING pc.n = 1` → `HAVING pc.n >= 1` | T7 "shared-path ambiguous untouched" | **equivalent mutant** (see note) |

≥2 killed (3 of 4). M3 is a documented **equivalent mutant**: the shared-path disambiguation is double-guarded — `HAVING pc.n = 1` excludes shared paths from `deduped`, AND the downstream `rn = 1 AND tie = 1` independently excludes any same-length tie. Verified: removing `tie = 1` alone (M5) also leaves the test green because `pc.n = 1` covers it, and removing `pc.n = 1` (M3) leaves it green because `rn/tie` covers it. Each guard is redundant for the shared-path contract; the contract is correctly enforced and pinned at the observable level (AC-2: shared-path row stays untouched, `_pre_repair_project_id` absent, `attribution_source` NULL). Equivalent mutants are a known mutation-testing limitation, not a correctness gap.

### AC → Test map (verifier-confirmed)

| AC | Test |
| --- | --- |
| AC-1 | `hook-attribution-acceptance.test.ts` "HAR-05/06 durable row"; `attribution-resolver.test.ts` containment |
| AC-2 | `attribution-resolver.test.ts` nested-longest/self-match/ambiguous; `hook-attribution-acceptance.test.ts` shared-path + nested + HAR-01 verbatim |
| AC-3 | `attribution-resolver.test.ts` fs-root/home-dir/trailing-sep exclusion |
| AC-4 | `attribution-resolver.test.ts` explicit>pin, sticky>containment; `hook-service.test.ts` sticky-source-flows; `session-project-pin.test.ts` memo reuse |
| AC-5 | `hook-scripts.test.ts` first-event pin + POST body intact (stdin single-read C3); `compact-snapshot-attribution.test.ts` cwd-routed |
| AC-6 | `hook-attribution-acceptance.test.ts` agent_id present + NULL honest; `session-project-pin.test.ts` agentIdOf |
| AC-7 | `hook-attribution-acceptance.test.ts` "HAR-07 mirror keyed by canonical id after alias rename" |
| AC-8 | `hook-attribution-acceptance.test.ts` T7 (8 cases incl. DO $$ invariant + idempotency) |
| AC-9 | `attribution-resolver.test.ts` fail-open verbatim + sanitized-warn spy |
| AC-10 | `hook-attribution-acceptance.test.ts` env-gated (skips cleanly); `turbo.json` passThroughEnv |

<!-- VERIFIER RESULT: PASS -->

## Residual Risk

- **Repair migration residue**: rows with no payload `cwd`, ambiguous shared-path cwd, or multi-id sessions are contract-legal `verbatim` and remain unrepaired (counted via `DO $$` NOTICE). Acceptable per design (unambiguous-only).
- **Shared dev DB grooming**: runbook in `design.md` is documentation only; execution requires explicit user approval. `e2e-ai-shared` intentionally preserved.
- **In-memory pin store**: process-local, bounded 1000, 24h TTL; loss degrades to containment/verbatim (contract-legal). Repair migration backfills history.
- **`metadata`/`payload_json` are TEXT**: migration casts `::jsonb` on read and `::text` on write; safe because producers (`HookService`, `ObservationEmitter`) always write valid JSON.
