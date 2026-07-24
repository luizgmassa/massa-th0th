# Wave 4 — Correctness, Hygiene, and Spec Reconciliation Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/wave-4-correctness-hygiene/design.md` (sha256 `5fc3ae93...`)
**Spec**: `.specs/features/wave-4-correctness-hygiene/spec.md` (sha256 `109f4313...`)
**Status**: Draft
**Baseline commit**: `f3d802098215c0dd9cbfcd8374605484f9a8a5b2` on `main`

---

## Project Testing Guidelines Scan

Scanned: `package.json`, `turbo.json`, `packages/core/package.json`, `packages/shared/package.json`, `apps/*/package.json`, `.github/workflows/ci.yml`, existing tests at `packages/core/src/__tests__/`.

Findings:
- **Monorepo**: `turbo run build`, `turbo run test`, `turbo run lint`, `turbo run type-check` (root `package.json`).
- **Packages**: `packages/core` uses `bun scripts/run-tests-isolated.ts` (test runner wrapper that isolates suites to avoid shared-state flakiness); `packages/shared` uses `bun test`; apps use `bun test` (mcp-client/opencode-plugin) or `bun scripts/run-tests-isolated.ts` (tools-api).
- **Type-check**: `turbo run type-check` runs `tsc --noEmit` across workspaces.
- **Build**: `packages/core` builds with `tsc && cp -r src/generated dist/`; `packages/shared` with `tsc`.
- **No coverage threshold config found.** No `jest.config.*`, `vitest.config.*`, `.nycrc`, or coverage gate in CI. Apply the strong default (cover every spec AC + listed edge cases; 1:1 for domain logic; happy + edge + error for routes).
- **CI** (`.github/workflows/ci.yml`): `build` job runs `bun run type-check` → `bun run build` → `bun run test`; `structural-native-linux` job runs `verify:tree-sitter-native`.
- **Test file convention**: `packages/core/src/__tests__/*.test.ts` (co-located, `bun:test`). Integration tests at `packages/core/src/__tests__/integration/`; e2e at `packages/core/src/__tests__/e2e/`.
- **Discrimination-sensor precedent**: Wave 3 `native-runtime-rebaseline` validation.md used a 4/4 mutation kill pattern; M14 god-files-refactor used 3 mutations. Wave 4 follows the same shape (per-AC mutation, revert, re-test).

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `package.json` scripts, `turbo.json`, `.github/workflows/ci.yml`. No coverage threshold config — strong defaults applied.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| --- | --- | --- | --- | --- |
| Tool handler (domain logic) | unit | 1:1 to spec ACs; every listed edge case; every enum param has an invalid-value test asserting `ToolError` + valid-values list | `packages/core/src/__tests__/wave-4-*.test.ts` | `bun test packages/core/src/__tests__/wave-4-correctness.test.ts` |
| Service (`ImpactAnalysisService`, `TracePathService`, `SymbolGraphService`, `ContextualSearchRLM`) | unit | 1:1 to spec ACs for clamp totals, untracked merge, secrets denylist, read_file cap exclusion, generation staleness | `packages/core/src/__tests__/wave-4-*.test.ts` | `bun test packages/core/src/__tests__/wave-4-*.test.ts` |
| Repository (`symbol-repository-pg.ts` `searchDefinitions` total path) | integration | SQL `LIMIT` + total count coexist; sentinel path for >100k | `packages/core/src/__tests__/wave-4-correctness.test.ts` (uses `DATABASE_URL=""` to force skip-if-no-DB OR mocks the repo) | `DATABASE_URL="" bun test packages/core/src/__tests__/wave-4-correctness.test.ts` |
| HTTP route (`apps/tools-api/src/routes/workspace.ts`) | e2e/integration | Each modified route mirrors the tool-handler response fields; happy + edge + error | `apps/tools-api/src/__tests__/wave-4-transport.test.ts` (NEW) | `bun test apps/tools-api/src/__tests__/wave-4-transport.test.ts` |
| Shared config (`xdg.ts`, `config-loader.ts`, `massa-ai-config.ts`) | unit | XDG paths resolve correctly; zero circular imports; existing config tests pass | `packages/shared/src/config/__tests__/xdg.test.ts` (NEW) + existing config tests | `bun test packages/shared/src/config/__tests__/xdg.test.ts` |
| CI workflow (`.github/workflows/ci.yml`) | none (artifact check) | Path-filter step exists; `verify:tree-sitter-native` runs on structural/`bun.lock`/`package.json` touch | `grep -n "verify:tree-sitter-native" .github/workflows/ci.yml` + `grep -n "paths-filter\|dorny" .github/workflows/ci.yml` | artifact check only |
| Spec docs (`.specs/features/phase-*/validation.md`, `FEATURES.json`) | none (artifact check) | "PG parity deferred" returns zero; `sqlite-removal` status `complete`; `sqlite-removal-followup` exists | `grep -n "PG parity deferred" .specs/features/phase-*/validation.md` | artifact check only |
| Test fixture (scheduler-store-pg seam) | integration | `storeB.listAll()` assertion passes against shared DB; follow-up `listAll()` after restore returns full set | `packages/core/src/__tests__/scheduler-store-pg.test.ts` (modify) | `DATABASE_URL=postgresql://... bun test packages/core/src/__tests__/scheduler-store-pg.test.ts` |
| SQL bounds regression (N10) | unit | Phase 2 rerank ≤200; ref_kind enum ≤9; vocabulary VALUES chunked at 5000; zero `snprintf`/`sprintf` | `packages/core/src/__tests__/wave-4-sql-bounds.test.ts` (NEW) | `bun test packages/core/src/__tests__/wave-4-sql-bounds.test.ts` |
| Dead code (N33) | unit (regression) | `normalizeRRFScore` zero callers; `metrics.ts` zero `console.error`; `session-registry.ts` zero bare `catch {}` | `grep -n "normalizeRRFScore\b" packages/core/src/data/vector/hybrid-search.ts` + `grep -n "console.error" packages/core/src/services/monitoring/metrics.ts` + `grep -n "} catch {" packages/core/src/services/synapse/session/session-registry.ts` | artifact check + existing tests pass |

---

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| --- | --- | --- |
| Quick (core focused) | After a task touching `packages/core` only, with unit tests | `cd packages/core && bun test src/__tests__/wave-4-*.test.ts` (focused) |
| Quick (shared focused) | After a task touching `packages/shared` only | `cd packages/shared && bun test` |
| Quick (tools-api focused) | After a task touching `apps/tools-api` only | `cd apps/tools-api && bun test` |
| Full type-check | After any TS change | `bun run type-check` (root, runs `turbo run type-check`) |
| Full build | After any TS change that affects emit | `bun run build` (root, runs `turbo run build`) |
| Full test suite | After a task touching cross-cutting code | `bun run test` (root, runs `turbo run test`) |
| N34 artifact check | After the CI workflow edit | `grep -n "verify:tree-sitter-native" .github/workflows/ci.yml` + `grep -n "paths-filter\|dorny\|changed-files" .github/workflows/ci.yml` |
| N25/N29/M29 artifact check | After spec doc edits | `grep -rn "PG parity deferred" .specs/features/phase-*/validation.md` (zero); `python3 -c "import json; d=json.load(open('.specs/project/FEATURES.json')); print([f['slug'] for f in d['features'] if f['slug'] in ('sqlite-removal','sqlite-removal-followup') and f['status']=='complete'])"` |
| N33 artifact check | After dead code sweep | `rg -n "normalizeRRFScore\b" packages/core/src/data/vector/hybrid-search.ts` (zero singular); `rg -n "console.error" packages/core/src/services/monitoring/metrics.ts` (zero); `rg -n "catch \{" packages/core/src/services/synapse/session/session-registry.ts` (zero) |
| M35 integration | After the scheduler seam | `DATABASE_URL=postgresql://... bun test packages/core/src/__tests__/scheduler-store-pg.test.ts` (requires shared DB; skip locally if no DB) |
| Native sanity | After N34 CI edit (local) | `bun run verify:tree-sitter-native` (optional; heavy) |

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: Shared helpers (no public contract change)

Foundation tasks that other phases depend on. No public response field changes.

T1 → T2 → T3 → T4

### Phase 2: Correctness bundle (public contract change)

The core N4/N6/N7/N8/N9 changes that touch tool handlers + services + HTTP routes.

T5 → T6 → T7 → T8 → T9 → T10

### Phase 3: Generation staleness (N1) + scheduler fixture (M35)

N1 builds on the helpers from Phase 1. M35 is independent.

T11 → T12 (N1) ; T13 (M35, parallel-safe but sequenced)

### Phase 4: Hygiene + spec reconciliation (no public contract change)

Doc/CI/dead-code/spec reconciliation. All independent.

T14 → T15 → T16 → T17 → T18 → T19 → T20

### Phase 5: N10 regression test + final validation

T21 (N10 regression test) → T22 (final full gate run before independent verifier)

---

## Task Breakdown

### T1: `ToolError` + `validateEnum` helper (N6)

**What**: Create the shared `ToolError` class and `validateEnum` function used by every tool handler that has an enum/finite-set param.
**Where**: `packages/core/src/tools/enum-validation.ts` (NEW)
**Depends on**: None
**Reuses**: `packages/core/src/tools/get_analytics.ts:109-114` pattern (extended with valid-values list)
**Requirement**: WAVE4-N6

**Tools**:
- MCP: none
- Skill: none (inline TS)

**Done when**:
- [ ] `packages/core/src/tools/enum-validation.ts` exists
- [ ] Exports `class ToolError extends Error` with `statusCode` field (default 400)
- [ ] Exports `function validateEnum<T extends string>(paramName: string, value: unknown, validValues: readonly T[]): T`
- [ ] `validateEnum` throws `ToolError("Invalid <param> value: <v>. Valid values: <list>.")` on non-string or non-member value
- [ ] Returns the validated value on success
- [ ] Unit tests in `packages/core/src/__tests__/wave-4-enum-validation.test.ts`: valid value passes; invalid value throws with valid-values list; empty string throws; `undefined`/`null` throws
- [ ] `bun run type-check` passes
- [ ] Test count: 5+ tests pass

**Tests**: unit
**Gate**: quick (core focused) + full type-check

**Commit**: `feat(tools): add ToolError + validateEnum helper for teaching-error parity`

---

### T2: `validateGitRef` helper (N8)

**What**: Create the shell-arg validation function for git refs (`base_branch`/`since`).
**Where**: `packages/core/src/services/symbol/git-ref-validation.ts` (NEW) OR co-located in `impact-analysis.ts` — decide in task: prefer a new file for reuse clarity.
**Depends on**: T1 (reuses `ToolError`)
**Reuses**: `ToolError` from T1
**Requirement**: WAVE4-N8

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `validateGitRef(paramName, value)` exists and throws `ToolError("Invalid <param> value: <v>. Valid pattern: alphanumeric, -, /, ., _, +.")` on `--` prefix or non-`/^[A-Za-z0-9._\/+-]+$/` match
- [ ] Returns void on success
- [ ] Unit tests: valid refs pass (`main`, `feature/foo-bar`, `v1.0.0`, `abc123`); invalid refs throw (`--upload-pack=evil`, `main;rm -rf /`, `$(whoami)`, `--exec=...`, empty, newline)
- [ ] `bun run type-check` passes
- [ ] Test count: 8+ tests pass

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `feat(impact-analysis): add validateGitRef shell-arg guard (N8)`

---

### T3: `getActiveGeneration` + `assertGenerationNotStale` helpers (N1)

**What**: Create the generation-staleness helper that wraps `symbolRepository.getActiveGenerationScope(projectId)` and the `ifNoneMatch` precondition check.
**Where**: `packages/core/src/services/symbol/active-generation.ts` (NEW)
**Depends on**: T1 (reuses `ToolError` for 412 errors)
**Reuses**: `packages/core/src/data/symbol/symbol-repository-pg.ts:1635-1642` `getActiveGenerationScope`; `ToolError` from T1
**Requirement**: WAVE4-N1

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `getActiveGeneration(projectId: string): Promise<string | null>` exists and returns the current `active_graph_generation_id` or `null`
- [ ] `assertGenerationNotStale(ifNoneMatch: string | undefined, current: string | null): void` exists
- [ ] When `ifNoneMatch` is `undefined`/empty → no throw (opt-in)
- [ ] When `ifNoneMatch` set and `current === null` → throws `ToolError("No active generation: index the project before querying.", 412)`
- [ ] When `ifNoneMatch` set, `current` set, mismatch → throws `ToolError("Stale generation: client held <ifNoneMatch>, current is <current>. Re-read the project map before retrying.", 412)`
- [ ] When `ifNoneMatch` matches `current` → no throw
- [ ] Unit tests: all 4 branches + the empty-string-ifNoneMatch edge case
- [ ] `bun run type-check` passes
- [ ] Test count: 6+ tests pass

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `feat(symbol): add getActiveGeneration + assertGenerationNotStale helpers (N1)`

---

### T4: `xdg.ts` extraction (N36)

**What**: Create the pure `xdg.ts` module that both config files import, killing the duplicated-XDP circular-dep workaround.
**Where**: `packages/shared/src/config/xdg.ts` (NEW); modify `packages/shared/src/config/config-loader.ts:6-11` and `packages/shared/src/config/massa-ai-config.ts:4-11, 209`
**Depends on**: None (independent of T1-T3; can run in parallel with Phase 1 but sequenced for clear commits)
**Reuses**: `config-loader.ts:6-9` and `massa-ai-config.ts:8-11` XDG logic (consolidated)
**Requirement**: WAVE4-N36

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `packages/shared/src/config/xdg.ts` exists
- [ ] Exports `xdgConfigHome()`, `xdgDataHome()`, `xdgCacheHome()`, `xdgRuntimeDir()`, `xdgStateHome()`, `configDir(app)`, `dataDir(app)`, `cacheDir(app)`
- [ ] Zero project-module imports (Node builtins `path`, `os` allowed; the circular-dep source `config-loader`/`massa-ai-config` is NOT imported)
- [ ] `config-loader.ts` imports `configDir` from `./xdg.js` and uses `configDir("massa-ai")` instead of the inlined `XDG_CONFIG_HOME`
- [ ] `massa-ai-config.ts` imports `xdgConfigHome`/`dataDir` from `./xdg.js`; the circular-dep comment at lines 4-7 is removed; `dataDir` at line 209 uses `dataDir("massa-ai")`
- [ ] Unit tests in `packages/shared/src/config/__tests__/xdg.test.ts`: each function returns the env override when set, the default when unset, the app-suffixed dir for `configDir`/`dataDir`/`cacheDir`
- [ ] `grep -n "XDG_CONFIG_HOME" packages/shared/src/config/` returns matches only in `xdg.ts`
- [ ] `grep -n "circular dependency" packages/shared/src/config/` returns zero
- [ ] `bun run type-check` passes; `bun run build` passes; existing `packages/shared` tests pass
- [ ] Test count: 8+ tests pass

**Tests**: unit
**Gate**: quick (shared focused) + full type-check + full build

**Commit**: `refactor(config): extract xdg.ts to kill duplicated-XDP circular-dep workaround (N36)`

---

### T5: Wire `validateEnum` into all tool handlers (N6)

**What**: Replace silent-fallback enum handling with `validateEnum` calls in every tool handler that has an enum/finite-set param.
**Where**: `packages/core/src/tools/impact_analysis.ts`, `trace_path.ts`, `get_analytics.ts`, `list_projects.ts`, `search_definitions.ts`, `create_checkpoint.ts`, `compress_context.ts`; `packages/core/src/controllers/executor-controller.ts` (`language` cast)
**Depends on**: T1
**Reuses**: `validateEnum` from T1
**Requirement**: WAVE4-N6

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `impact_analysis.ts:103` validates `scope` ∈ unstaged|staged|committed|all
- [ ] `trace_path.ts:113` validates `direction` ∈ outbound|inbound|both and `mode` ∈ calls|data_flow|cross_service|all
- [ ] `get_analytics.ts:52` migrates the `default:` to `validateEnum(type, ["summary","project","query","cache","recent"])`
- [ ] `list_projects.ts:33` validates `status` ∈ pending|indexing|indexed|error|all
- [ ] `search_definitions.ts:63` validates `kind` ∈ `STRUCTURAL_SYMBOL_KINDS` (18)
- [ ] `create_checkpoint.ts:181` validates `status` ∈ pending|in_progress|completed|failed|paused; `:208` validates `checkpointType` ∈ manual|milestone (replaces silent coerce)
- [ ] `compress_context.ts:67` validates `strategy` ∈ code_structure|conversation_summary|semantic_dedup|hierarchical
- [ ] `executor-controller.ts:87` validates `language` ∈ the 10 languages (replaces `as Language` cast)
- [ ] `format` and `responseMode` enum params validated (json|toon; summary|full|enriched) — validation only, no behavior change
- [ ] Unit tests in `packages/core/src/__tests__/wave-4-enum-validation.test.ts` (extend): each tool call with an invalid enum throws `ToolError` with the valid-values list in the message
- [ ] `bun run type-check` passes
- [ ] Existing tool tests pass (no regression — valid values still work)
- [ ] Test count: 15+ tests pass

**Tests**: unit
**Gate**: quick + full type-check + `bun test packages/core/src/__tests__/wave-4-enum-validation.test.ts`

**Commit**: `feat(tools): wire validateEnum into all tool handlers for teaching-error parity (N6)`

---

### T6: Three-source diff + secrets denylist in `defaultDiffRunner` (N7)

**What**: Extend `defaultDiffRunner` to merge untracked new files (`git ls-files --others --exclude-standard`) into unstaged/staged/all scopes; filter secret-like untracked paths; return `{ paths: string[]; untrackedFiltered: number }`.
**Where**: `packages/core/src/services/symbol/impact-analysis.ts:447-509`; the single caller at `:168` updated to destructure the new return shape; `ImpactAnalysisResult` (line 347) adds `untrackedFiltered: number`; `GraphController.analyzeImpact` and `ImpactAnalysisTool.handle` propagate it.
**Depends on**: T2 (`validateGitRef` is called first)
**Reuses**: `execFileSync` safe-argv pattern; `ToolError` from T1
**Requirement**: WAVE4-N7

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `defaultDiffRunner` returns `{ paths: string[]; untrackedFiltered: number }` (BREAKING internal shape — one caller updated)
- [ ] `scope=unstaged` (default) now includes untracked new files via `git ls-files --others --exclude-standard`, deduped via `Set<string>`
- [ ] `scope=staged` includes untracked new files, deduped
- [ ] `scope=all` merges committed + unstaged + untracked, deduped
- [ ] `scope=committed` stays single-source (no untracked)
- [ ] Secret-like untracked paths (`*.env*`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `secrets.*`, `*.keystore`, `id_rsa*`, `*.asc`) are excluded; `untrackedFiltered` increments per exclusion
- [ ] `ImpactAnalysisResult.untrackedFiltered` field added; `ImpactAnalysisTool.handle` and `GraphController.analyzeImpact` return it
- [ ] HTTP route `apps/tools-api/src/routes/workspace.ts:501-511` propagates `untrackedFiltered`
- [ ] Unit tests in `packages/core/src/__tests__/wave-4-correctness.test.ts` (NEW): create a temp git repo with an untracked `.env` + an untracked normal file → `scope=unstaged` includes the normal, excludes `.env`, `untrackedFiltered=1`; `scope=committed` excludes both untracked; `scope=all` merges all 3 sources
- [ ] `bun run type-check` passes
- [ ] Existing `impact-analysis.test.ts` and `impact-analysis-diff.test.ts` pass (update if they assert the old return shape)
- [ ] Test count: 5+ new tests pass

**Tests**: unit + integration (temp git repo)
**Gate**: quick + full type-check

**Commit**: `feat(impact-analysis): merge untracked files + secrets denylist in defaultDiffRunner (N7)`

---

### T7: `read_file` cap + `source_clipped` (N9)

**What**: Cap user-facing `read_file` and `symbol_snippet` HTTP endpoint at `MASSA_AI_READ_FILE_MAX_LINES` (default 500); emit `source_clipped: true` + true total. Internal `SymbolGraphService.readSnippet`/`readContext` NOT capped.
**Where**: `packages/core/src/tools/read_file.ts` (cap + flag + env read), `apps/tools-api/src/routes/workspace.ts:619-678` (symbol_snippet — replace `start+10_000` with the env cap), `packages/core/src/services/symbol/symbol-graph.service.ts:619-654` (EXCLUDED — add a comment noting the exclusion)
**Depends on**: None (independent of T1-T6; can run in parallel with Phase 2 but sequenced for clear commits)
**Reuses**: `boundedInt` pattern (`apps/tools-api/src/routes/workspace.ts:40-53`); `FILE_CACHE_MAX_ENTRIES` env-read pattern (`read_file.ts:140`)
**Requirement**: WAVE4-N9

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `read_file.ts` reads `MASSA_AI_READ_FILE_MAX_LINES` at module load (default 500, invalid/negative → 500)
- [ ] `ReadFileTool.handle` caps `selectedContent` at `MAX_LINES` when the adjusted range exceeds it; sets `source_clipped: true` in the response
- [ ] Response includes `lineRange.actual.total` (true total line count) so `omitted = total - shown` is derivable
- [ ] When the range is within the cap, `source_clipped: false` and the full range is returned
- [ ] `symbol_snippet` HTTP endpoint (`workspace.ts:619-678`) caps `end` at `start + MAX_LINES` instead of `start + 10_000`; emits `source_clipped: true` when clamped
- [ ] `SymbolGraphService.readSnippet`/`readContext` (`symbol-graph.service.ts:619-654`) are NOT capped — a comment at both functions states: "Internal enrichment path — read_file cap does NOT apply (no MCP propagation path for source_clipped). See Wave 4 N9 AC 15."
- [ ] Unit tests in `packages/core/src/__tests__/wave-4-correctness.test.ts`: 1000-line file, no range → 500 lines + `source_clipped: true` + `total: 1000`; `MASSA_AI_READ_FILE_MAX_LINES=1000` env → 1000 lines + `source_clipped: false`; 200-line file, no range → 200 lines + `source_clipped: false`; `go_to_definition` on a 1000-line symbol → `readContext` returns full 1000-line context (NOT capped)
- [ ] `bun run type-check` passes
- [ ] Existing `read-file.test.ts` passes (update if it asserts the old uncapped behavior for large files)
- [ ] Test count: 4+ new tests pass

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `feat(read-file): cap at MASSA_AI_READ_FILE_MAX_LINES (default 500) + source_clipped flag (N9)`

---

### T8: `*_total`/`*_shown`/`*_omitted` on `impact_analysis` + `trace_path` (N4)

**What**: Add pre-clamp total + post-clamp shown + omitted fields to `ImpactAnalysisResult` and `TracePathResult`; propagate to tool handlers + HTTP routes.
**Where**: `packages/core/src/services/symbol/impact-analysis.ts:236-250, 334-356`; `packages/core/src/services/symbol/trace-path.ts:241-248, 280-311`; `packages/core/src/tools/impact_analysis.ts:146-170`; `packages/core/src/tools/trace_path.ts:150-173`; `packages/core/src/controllers/graph-controller.ts:152-172, 180-219`; `apps/tools-api/src/routes/workspace.ts:357-447, 501-511`
**Depends on**: T6 (N7 adds `untrackedFiltered` to the same response; bundle the response-shape changes together)
**Reuses**: `get_references`/`memory_list` total/shown pattern
**Requirement**: WAVE4-N4

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `impact-analysis.ts` `addImpact` tracks pre-clamp `impactedTotal` (increment even when over `MAX_IMPACTED`, or count before the final `slice`); `ImpactAnalysisResult` adds `impacted_total: number`, `impacted_shown: number`, `impacted_omitted: number`
- [ ] `trace-path.ts` `addNode` tracks pre-clamp `nodesTotal`; `TracePathResult` adds `nodes_total`, `nodes_shown`, `nodes_omitted`
- [ ] `ImpactAnalysisTool.handle` and `TracePathTool.handle` propagate the new fields
- [ ] `GraphController.analyzeImpact` and `GraphController.tracePath` propagate the new fields
- [ ] HTTP routes `/symbol/impact` and `/symbol/trace` propagate the new fields
- [ ] Unit tests in `wave-4-correctness.test.ts`: feed 150 impacted symbols → `impacted_total=150, impacted_shown=100, impacted_omitted=50`; feed 2500 trace nodes → `nodes_total=2500, nodes_shown=2000, nodes_omitted=500`
- [ ] `bun run type-check` passes
- [ ] Existing `impact-analysis.test.ts` and `trace-path.test.ts` pass (update if they assert the old shape)
- [ ] Test count: 2+ new tests pass

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `feat(impact-analysis,trace-path): emit impacted_total/shown/omitted + nodes_total/shown/omitted (N4)`

---

### T9: `*_total`/`*_shown`/`*_omitted` on `search_code` + `search_definitions` + `get_references` (N4)

**What**: Add pre-clamp total + post-clamp shown + omitted fields to the remaining 3 clamped tools. `search_definitions` uses `COUNT(*) OVER()` or a separate `SELECT COUNT(*)` or a sentinel for >100k. `get_references` adds `omitted` to the existing `total`/`shown`.
**Where**: `packages/core/src/data/symbol/symbol-repository-pg.ts:860-884` (`searchDefinitions` SQL); `packages/core/src/tools/search_definitions.ts:63-107`; `packages/core/src/tools/search_code.ts:49-76`; `packages/core/src/controllers/search-controller.ts:276-301`; `packages/core/src/tools/get_references.ts:48-96`; `apps/tools-api/src/routes/workspace.ts:211-251, 254-314, 48-126`
**Depends on**: T8 (same N4 invariant, sequenced to keep commits cohesive)
**Reuses**: `get_references` existing `total`/`shown`; `memory_list` total/offset pattern
**Requirement**: WAVE4-N4

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `searchDefinitions` SQL adds a total count (either `COUNT(*) OVER()` OR a separate `SELECT COUNT(*)` OR a sentinel `">=10000"` with `definitions_total_exact: false` when the match set exceeds 100k — pick the cheaper path in task: default to `COUNT(*) OVER()` for ≤10k, sentinel above)
- [ ] `SearchDefinitionsTool.handle` emits `definitions_total`, `definitions_shown`, `definitions_omitted` (+ `definitions_total_exact` if sentinel used)
- [ ] `SearchCodeTool.handle` / `SearchProjectTool.handle` / `SearchController.searchProject` emit `results_total` (pre-pattern-filter, pre-slice count of the reachable set), `results_shown`, `results_omitted`
- [ ] `GetReferencesTool.handle` adds `omitted: total - shown` alongside existing `total`/`shown`
- [ ] HTTP routes `/symbol/definitions`, `/symbol/references`, `/search/project`, `/search/code` propagate the new fields
- [ ] Unit tests in `wave-4-correctness.test.ts`: search_definitions with 600 matches, limit 20 → `definitions_total=600, definitions_shown=20, definitions_omitted=580`; search_code with 50 results, maxResults 10 → `results_total=50, results_shown=10, results_omitted=40`; get_references with 100 refs, limit 50 → `total=100, shown=50, omitted=50`
- [ ] `bun run type-check` passes
- [ ] Existing `search_definitions`/`search_code`/`get_references` tests pass (update if they assert the old shape)
- [ ] Test count: 3+ new tests pass

**Tests**: unit + integration (search_definitions SQL may need `DATABASE_URL=""` to skip-if-no-DB OR a mocked repo)
**Gate**: quick + full type-check

**Commit**: `feat(search,references): emit total/shown/omitted on clamped lists (N4)`

---

### T10: `search_definitions` `COUNT(*)` perf guard + sentinel (N4 perf)

**What**: Add the sentinel path for `search_definitions` when the match set exceeds 100k (per AC 4 + pre-mortem finding 5).
**Where**: `packages/core/src/data/symbol/symbol-repository-pg.ts:860-884`
**Depends on**: T9
**Reuses**: —
**Requirement**: WAVE4-N4 (perf)

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `searchDefinitions` checks the count (via `COUNT(*) OVER()` or a cheap `SELECT COUNT(*)` first); if > 100k, emits `definitions_total: ">=10000"` (or a numeric cap like `10000`) with `definitions_total_exact: false` instead of scanning the full match set
- [ ] The sentinel path is documented in a comment at the SQL builder
- [ ] Unit test in `wave-4-correctness.test.ts`: mock a repo returning 150k matches → `definitions_total_exact: false` + `definitions_total` is the sentinel
- [ ] `bun run type-check` passes
- [ ] Test count: 1+ new test passes

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `perf(search-definitions): sentinel total for >100k match sets (N4 perf)`

---

### T11: Surface `activatedGraphGenerationId` + `ifNoneMatch` on graph-reader tools (N1)

**What**: Wire `getActiveGeneration` + `assertGenerationNotStale` into `impact_analysis`, `trace_path`, `get_references`, `search_definitions` tool handlers. Add optional `ifNoneMatch` param to the 4 tool MCP definitions. `search_code` is EXCLUDED.
**Where**: `packages/core/src/tools/impact_analysis.ts`, `trace_path.ts`, `get_references.ts`, `search_definitions.ts`; `apps/mcp-client/src/tool-definitions.ts` (4 tool defs get `ifNoneMatch` param); HTTP routes `apps/tools-api/src/routes/workspace.ts` (4 routes accept `ifNoneMatch` header/query)
**Depends on**: T3, T8, T9 (response-shape changes must land first so `activatedGraphGenerationId` rides alongside)
**Reuses**: `getActiveGeneration`/`assertGenerationNotStale` from T3; `activatedGraphGenerationId` precedent from `symbol-graph.service.ts:455`
**Requirement**: WAVE4-N1

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] Each of the 4 graph-reader tool handlers calls `getActiveGeneration(projectId)` at the top; calls `assertGenerationNotStale(params.ifNoneMatch, currentGen)`; returns `activatedGraphGenerationId: currentGen` in the response
- [ ] `search_code` does NOT call `getActiveGeneration`; does NOT accept `ifNoneMatch`; does NOT return `activatedGraphGenerationId`
- [ ] MCP tool definitions for `impact_analysis`, `trace_path`, `get_references`, `search_definitions` add optional `ifNoneMatch: string` param with description "Optional precondition: the client's last-known `activatedGraphGenerationId`. If it mismatches the current active generation, the tool returns a 412 teaching error."
- [ ] `search_code` MCP definition does NOT add `ifNoneMatch`
- [ ] HTTP routes accept `ifNoneMatch` as a query param or header and pass to the tool handler
- [ ] Unit tests in `wave-4-generation-staleness.test.ts` (NEW): mutate `active_graph_generation_id` → `ifNoneMatch` throws 412 with "Stale generation..." message; omit `ifNoneMatch` → no throw; `ifNoneMatch` matches → no throw; `search_code` response has no `activatedGraphGenerationId`; vector-only workspace (no active generation) → `impact_analysis` returns `activatedGraphGenerationId: null` when `ifNoneMatch` omitted, throws "No active generation..." when `ifNoneMatch` present
- [ ] `bun run type-check` passes
- [ ] Test count: 7+ new tests pass

**Tests**: unit + integration
**Gate**: quick + full type-check

**Commit**: `feat(graph-tools): surface activatedGraphGenerationId + ifNoneMatch precondition (N1)`

---

### T12: N1 HTTP transport tests (N1 transport parity)

**What**: Add HTTP-route tests asserting `activatedGraphGenerationId` + `ifNoneMatch` propagate through the `/api/v1/symbol/*` routes.
**Where**: `apps/tools-api/src/__tests__/wave-4-transport.test.ts` (NEW)
**Depends on**: T11
**Reuses**: existing transport-test fixture pattern (`apps/tools-api/src/__tests__/structural-transport.test.ts`)
**Requirement**: WAVE4-N1 (transport parity)

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `wave-4-transport.test.ts` asserts: POST `/api/v1/symbol/impact` with `ifNoneMatch: stale` returns 412 + the teaching-error body
- [ ] GET `/api/v1/symbol/trace` with `ifNoneMatch: stale` returns 412
- [ ] GET `/api/v1/symbol/references` with `ifNoneMatch: stale` returns 412
- [ ] GET `/api/v1/symbol/definitions` with `ifNoneMatch: stale` returns 412
- [ ] POST `/api/v1/search/code` does NOT accept `ifNoneMatch` and does NOT return `activatedGraphGenerationId`
- [ ] `bun run type-check` passes
- [ ] Test count: 5+ tests pass

**Tests**: e2e/integration
**Gate**: quick (tools-api focused) + full type-check

**Commit**: `test(transport): assert activatedGraphGenerationId + ifNoneMatch parity (N1)`

---

### T13: `scheduler-store-pg` test seam (M35)

**What**: Add an instance-scoped `storeB.listAll` override filtering `scheduled-*` rows for the duration of the `storeB.listAll()` assertion test; restore in `afterEach`; add a follow-up assertion proving restoration.
**Where**: `packages/core/src/__tests__/scheduler-store-pg.test.ts`
**Depends on**: None (independent of T1-T12)
**Reuses**: the 3 already-fixed test groups' instance-scoped seam pattern
**Requirement**: WAVE4-M35

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `scheduler-store-pg.test.ts` adds an instance-scoped override: `const originalListAll = storeB.listAll.bind(storeB); storeB.listAll = function () { return originalListAll().filter((e) => !e.id.startsWith("scheduled-")); };`
- [ ] `afterEach` restores: `storeB.listAll = originalListAll;`
- [ ] The existing assertion at `:101` (`storeB.listAll().map(e => e.id)toEqual([cronId, intervalId])`) passes against a shared DB with `scheduled-*` rows
- [ ] A new follow-up test asserts: after `afterEach` runs, a fresh `storeB.listAll()` call returns the full unfiltered set (including `scheduled-*`)
- [ ] The seam does NOT modify the `PgScheduledJobStore` class or global SQL
- [ ] `describe.skipIf(!DB_AVAILABLE)` gate preserved
- [ ] `bun run type-check` passes
- [ ] Test count: existing + 1 new test pass

**Tests**: integration (requires `DATABASE_URL`)
**Gate**: M35 integration (`DATABASE_URL=postgresql://... bun test packages/core/src/__tests__/scheduler-store-pg.test.ts`) + full type-check

**Commit**: `test(scheduler-store-pg): instance-scoped seam filters scheduled-* rows (M35)`

---

### T14: Dead code sweep (N33)

**What**: Remove deprecated `normalizeRRFScore` singular; replace `console.error` in `metrics.ts` with `logger.error`; replace two bare `catch {}` in `session-registry.ts` with `logger.warn`.
**Where**: `packages/core/src/data/vector/hybrid-search.ts:152-158`; `packages/core/src/services/monitoring/metrics.ts:443`; `packages/core/src/services/synapse/session/session-registry.ts:76, 92-94`
**Depends on**: None
**Reuses**: `logger` (`packages/shared/src/utils/logger.ts`)
**Requirement**: WAVE4-N33

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `rg -n "normalizeRRFScore\b" packages/core/src/data/vector/hybrid-search.ts` returns only the batch `normalizeRRFScores` (plural) — singular removed
- [ ] `rg -n "console.error" packages/core/src/services/monitoring/metrics.ts` returns zero — replaced with `logger.error("[Metrics] Failed to save:", error);` (add `import { logger } from "@massa-ai/shared"` or the existing logger import path if different)
- [ ] `rg -n "catch \{" packages/core/src/services/synapse/session/session-registry.ts` returns zero — both sites at `:76` and `:92-94` replaced with `catch (error) { logger.warn("[SessionRegistry] store <op> failed:", error); }` (where `<op>` is `save`/`ensureReady`)
- [ ] `relation-extractor.ts:44` `"deprecated"` literal is UNCHANGED (audit confirmed functional keyword data)
- [ ] `bun run type-check` passes; `bun run build` passes
- [ ] Existing tests pass (no regression)
- [ ] Artifact checks above pass

**Tests**: unit (regression — existing tests must pass)
**Gate**: quick + full type-check + full build + artifact checks

**Commit**: `chore(dead-code): remove deprecated normalizeRRFScore, route metrics/session-registry through logger (N33)`

---

### T15: Spec reconciliation — Phase-1/5/6 `validation.md` (N25)

**What**: Update the 3 `validation.md` files' "PG parity deferred" accepted-assumption rows to reflect that PG schema parity is delivered.
**Where**: `.specs/features/phase-1-memory-foundation/validation.md:63, 67, 136-141`; `.specs/features/phase-5-auto-improve/validation.md:60, 162-165`; `.specs/features/phase-6-handoffs/validation.md:52, 143-147`
**Depends on**: None
**Reuses**: —
**Requirement**: WAVE4-N25

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `phase-1-memory-foundation/validation.md` "Accepted assumption #1" at lines 136-141 updated to: "PG schema parity delivered via migration `20260710120000_add_synapse_sessions_pg`; runtime `PgSessionStore` may still be deferred but schema is done. SQLite runtime removed (M29 closed)."
- [ ] `phase-5-auto-improve/validation.md:162-165` updated similarly for `20260713090000_add_handoffs_proposals_pg` + `Proposal` model
- [ ] `phase-6-handoffs/validation.md:143-147` updated similarly for `Handoff` model
- [ ] The inline `PARTIAL` markers at `phase-1-memory-foundation/validation.md:63, 67` updated to reflect PG schema parity done
- [ ] `grep -rn "PG parity deferred" .specs/features/phase-*/validation.md` returns zero
- [ ] Artifact check passes

**Tests**: none (artifact check)
**Gate**: N25 artifact check

**Commit**: `docs(specs): reconcile Phase-1/5/6 PG parity claims with delivered migrations (N25)`

---

### T16: `sqlite-removal` close + `sqlite-removal-followup` split (M29)

**What**: Flip `sqlite-removal` status to `complete` in `FEATURES.json`; add a new `sqlite-removal-followup` feature with status `in_progress` carrying the 3 non-gating fixture/e2e follow-ups.
**Where**: `.specs/project/FEATURES.json`; `.specs/features/sqlite-removal-followup/` (NEW — `spec.md` + `tasks.md`)
**Depends on**: None
**Reuses**: —
**Requirement**: WAVE4-M29

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `FEATURES.json` `sqlite-removal` status → `complete`
- [ ] New `sqlite-removal-followup` feature entry added to `FEATURES.json` with status `in_progress`, priority `P2`, phases `{specify: true, design: false, tasks: true, execute: true}`
- [ ] `.specs/features/sqlite-removal-followup/spec.md` created, listing the 3 follow-ups from `.specs/features/sqlite-removal/validation.md:37-39`:
  1. Rerun the standalone legacy Prisma migration probe after the `tags` fixture update
  2. Rebuild the frozen qwen fixture manifest before rerunning its fixture-specific E2E
  3. Capture a concise final aggregate for `bun run test` with required external LLM/PostgreSQL services
- [ ] `.specs/features/sqlite-removal-followup/tasks.md` created with 3 tasks (one per follow-up)
- [ ] `python3 -c "import json; d=json.load(open('.specs/project/FEATURES.json')); print([f['slug'] for f in d['features'] if f['slug'] in ('sqlite-removal','sqlite-removal-followup') and f['status']=='complete'])"` returns `['sqlite-removal']`
- [ ] Artifact check passes

**Tests**: none (artifact check)
**Gate**: M29 artifact check

**Commit**: `chore(specs): close sqlite-removal, split follow-ups into sqlite-removal-followup (M29)`

---

### T17: Grammar integrity verifier in CI (N34)

**What**: Add a path-filtered `verify:tree-sitter-native` step to the main `build` job in `ci.yml`, triggered only on PRs touching `packages/core/src/services/structural/**`, `bun.lock`, or `package.json`. Keep the existing `structural-native-linux` job unchanged.
**Where**: `.github/workflows/ci.yml` (main `build` job at `:9-65`)
**Depends on**: None
**Reuses**: `verify:tree-sitter-native` script (`package.json:35`); `dorny/paths-filter@v3` (or shell fallback)
**Requirement**: WAVE4-N34

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `ci.yml` `build` job adds a `grammar-integrity` step (or a new job dependent on `build`) that:
  - Uses `dorny/paths-filter@v3` (or `tj-actions/changed-files` or a shell `git diff --name-only origin/main...HEAD -- packages/core/src/services/structural bun.lock package.json`) to detect changes
  - If matched, runs `bun run verify:tree-sitter-native`
  - If unmatched, skips with `if: steps.filter.outputs.grammar == 'true'` (or equivalent)
- [ ] The existing `structural-native-linux` job at `:192-239` is UNCHANGED (still runs `verify:tree-sitter-native` on every PR — no regression)
- [ ] `grep -n "verify:tree-sitter-native" .github/workflows/ci.yml` returns 2+ matches (one in `build`/`grammar-integrity` step, one in `structural-native-linux`)
- [ ] `grep -n "paths-filter\|dorny\|changed-files" .github/workflows/ci.yml` returns 1+ matches
- [ ] Artifact check passes

**Tests**: none (artifact check — a live PR run is the integration test)
**Gate**: N34 artifact check

**Commit**: `ci(grammar): path-filtered verify:tree-sitter-native on structural/bun.lock/package.json touches (N34)`

---

### T18: N10 SQL bounds regression test

**What**: Add a regression test asserting the 3 bounded SQL placeholder builders stay bounded.
**Where**: `packages/core/src/__tests__/wave-4-sql-bounds.test.ts` (NEW)
**Depends on**: None
**Reuses**: `postgres-vector-store.searchTwoPhase` Phase 1 `LIMIT 200`; `symbol-repository-pg.findEdges` ref_kind enum ≤9; `keyword-search-pg.populateVocabulary` `INSERT_BATCH_SIZE = 5000`
**Requirement**: WAVE4-N10

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `wave-4-sql-bounds.test.ts` exists
- [ ] Test 1: feed >200 candidate ids to `searchTwoPhase` Phase 2 → assert the Phase 1 SQL `LIMIT` clamps to 200 (mock or inspect the generated SQL)
- [ ] Test 2: feed >9 ref kinds to `findEdges` → assert only the valid enum values are used (bounded by enum size)
- [ ] Test 3: feed >5000 vocabulary words to `populateVocabulary` → assert the INSERT is chunked at 5000 per batch (inspect batch count)
- [ ] Test 4: `rg -n "snprintf\|sprintf" packages/` returns zero (TS has no C fixed buffers) — run via `Bun.spawnSync("rg", [...])`
- [ ] `bun run type-check` passes
- [ ] Test count: 4 tests pass

**Tests**: unit
**Gate**: quick + full type-check

**Commit**: `test(sql-bounds): regression test for bounded placeholder builders (N10)`

---

### T19: Wave 4 docs (HANDOFF.md break-change note)

**What**: Document the breaking changes (N7 `scope=unstaged` default now includes untracked; N6 throws on invalid enums; N9 default 500-line cap) in `.specs/HANDOFF.md` at feature close.
**Where**: `.specs/HANDOFF.md`
**Depends on**: T5, T6, T7 (the breaking changes must land first)
**Reuses**: —
**Requirement**: WAVE4-N7 (breaking-default documentation), WAVE4-N6, WAVE4-N9

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `.specs/HANDOFF.md` has a "Wave 4 Breaking Changes" section listing:
  - N7: `scope=unstaged` (default) now includes untracked new files; `scope=committed` preserves the old single-source behavior
  - N6: invalid enum params now throw `ToolError` with valid-values list instead of silent fallback
  - N9: `read_file` default cap 500 lines; `MASSA_AI_READ_FILE_MAX_LINES` env override
- [ ] Artifact check passes

**Tests**: none (artifact)
**Gate**: artifact check

**Commit**: `docs(handoff): document Wave 4 breaking changes (N7/N6/N9)`

---

### T20: Update `STATE.md` with Wave 4 progress

**What**: Update `.specs/project/STATE.md` to add a "Wave 4 — Active" section tracking the feature; flip the `sqlite-removal` invariant line per M29.
**Where**: `.specs/project/STATE.md`
**Depends on**: T16 (the M29 status flip)
**Reuses**: —
**Requirement**: WAVE4-M29 (invariant flip)

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `STATE.md` adds a "Wave 4 — Active" section: projectId `massa-ai`, workflowSessionId `spec-wave-4-correctness-hygiene`, workflow `spec-driven`, feature `wave-4-correctness-hygiene`, status `in progress`, branch `main`, baseline `f3d8020`
- [ ] The `sqlite-removal stays in_progress` invariant line at `:13` is updated to `sqlite-removal complete; sqlite-removal-followup in_progress (M29)`
- [ ] Artifact check passes

**Tests**: none (artifact)
**Gate**: artifact check

**Commit**: `docs(state): add Wave 4 active section, flip sqlite-removal invariant (M29)`

---

### T21: N10 is T18 — merged. Skip. (Placeholder; T18 covers N10)

**What**: N/A — merged into T18.
**Where**: N/A
**Depends on**: N/A
**Reuses**: N/A
**Requirement**: N/A

> This slot is intentionally empty. T18 covers N10. (Keeping T21 as a placeholder would waste a task ID; instead, T21 is removed and T22 follows T20.)

---

### T22: Final full gate run before independent verifier

**What**: Run the full gate matrix locally to confirm all Wave 4 tasks are green before the independent verifier runs.
**Where**: N/A (verification command)
**Depends on**: T1-T20 all complete
**Reuses**: —
**Requirement**: All WAVE4-* (final pre-validation gate)

**Tools**:
- MCP: none
- Skill: none

**Done when**:
- [ ] `bun run type-check` passes
- [ ] `bun run build` passes
- [ ] `bun run test` passes (full suite — accept pre-existing documented skips; no NEW failures)
- [ ] `bun test packages/core/src/__tests__/wave-4-*.test.ts` all pass
- [ ] `bun test packages/core/src/__tests__/scheduler-store-pg.test.ts` passes (requires `DATABASE_URL`; skip locally if no DB, note in validation.md)
- [ ] `bun test apps/tools-api/src/__tests__/wave-4-transport.test.ts` passes
- [ ] `bun test packages/shared/src/config/__tests__/xdg.test.ts` passes
- [ ] All artifact checks pass (N25, N33, M29, N34)
- [ ] `git log --oneline f3d8020..HEAD` shows one commit per task T1-T20

**Tests**: all
**Gate**: full

**Commit**: none (verification step; no commit)

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5

Phase 1 (Shared helpers):  T1 ──→ T2 ──→ T3 ──→ T4
Phase 2 (Correctness bundle): T5 ──→ T6 ──→ T7 ──→ T8 ──→ T9 ──→ T10
Phase 3 (N1 + M35):          T11 ──→ T12 ──→ T13
Phase 4 (Hygiene + specs):   T14 ──→ T15 ──→ T16 ──→ T17 ──→ T18 ──→ T19 ──→ T20
Phase 5 (Final gate):        T22
```

Execution is strictly sequential — no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**Batch packing**: 21 actionable tasks (T21 is a no-op placeholder, removed). 3 batches at ~7 tasks each:
- Batch 1: Phase 1 (T1-T4) + Phase 2 start (T5-T7) = 7 tasks
- Batch 2: Phase 2 end (T8-T10) + Phase 3 (T11-T13) = 6 tasks
- Batch 3: Phase 4 (T14-T20) + Phase 5 (T22) = 8 tasks

The sub-agent offer fires before Execute if the user wants to dispatch batch workers. Offer-then-confirm — never auto-spawn.

---

## Task Granularity Check

| Task | Scope | Status |
| --- | --- | --- |
| T1: ToolError + validateEnum helper | 1 new file, 1 function + 1 class | ✅ Granular |
| T2: validateGitRef helper | 1 new file, 1 function | ✅ Granular |
| T3: getActiveGeneration + assertGenerationNotStale | 1 new file, 2 functions | ✅ Granular |
| T4: xdg.ts extraction | 1 new file + 2 file edits | ✅ Granular (cohesive config refactor) |
| T5: Wire validateEnum into tool handlers | 8 tool-handler edits, 1 helper | ⚠️ 8 files but 1 cohesive change (same helper, same pattern); acceptable per "2-3 related things" leeway. Splitting by tool would fragment the N6 contract. |
| T6: Three-source diff + secrets denylist | 1 service file + 1 caller + 1 HTTP route | ✅ Granular (cohesive N7 change) |
| T7: read_file cap + source_clipped | 2 file edits + 1 comment-only edit | ✅ Granular |
| T8: impact/trace total/omitted | 2 services + 2 tools + 2 routes | ⚠️ 6 files but 1 cohesive N4 change for 2 tools; splitting impact vs trace would fragment the invariant. |
| T9: search/refs total/omitted | 3 tools + 1 repo + 4 routes | ⚠️ 8 files but 1 cohesive N4 change for 3 tools; same rationale as T8. |
| T10: search_definitions perf sentinel | 1 repo file edit | ✅ Granular |
| T11: N1 wire into 4 tools | 4 tools + 1 MCP def file + 4 routes | ⚠️ 9 files but 1 cohesive N1 change; splitting per tool would fragment the precondition. |
| T12: N1 HTTP transport tests | 1 new test file | ✅ Granular |
| T13: scheduler-store-pg seam | 1 test file edit | ✅ Granular |
| T14: Dead code sweep | 3 file edits | ✅ Granular (cohesive N33 sweep) |
| T15: Phase-1/5/6 validation.md | 3 doc edits | ✅ Granular (cohesive N25 reconciliation) |
| T16: sqlite-removal close + followup | 2 .specs edits + 2 new .specs files | ✅ Granular (cohesive M29) |
| T17: CI grammar gate | 1 workflow file edit | ✅ Granular |
| T18: N10 regression test | 1 new test file | ✅ Granular |
| T19: HANDOFF.md break-change note | 1 doc edit | ✅ Granular |
| T20: STATE.md update | 1 doc edit | ✅ Granular |
| T22: Final gate run | 0 file edits (verification) | ✅ Granular |

All tasks are atomic or cohesive within a single requirement. The 4 ⚠️ tasks are cohesive multi-file edits for a single contract change; splitting them would fragment the requirement across tasks, violating the "one task = one deliverable" rule by producing partial deliverables. Accepted.

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| --- | --- | --- | --- |
| T1 | None | (Phase 1 start) | ✅ Match |
| T2 | T1 | T1 → T2 | ✅ Match |
| T3 | T1 | T1 → T3 (via T2 in diagram; T3 depends on T1, not T2 — diagram shows Phase 1 sequence, T3's real dep is T1) | ⚠️ Diagram shows T1→T2→T3 sequence; T3 body says "depends on T1". The diagram is a phase-sequence rendering, not a dep graph. T3 can run after T1 (T2 is not a hard dep). Accepted — the diagram is the execution order, T3's dep is satisfied by T1. |
| T4 | None | T3 → T4 | ⚠️ T4 has no hard dep on T1-T3 (independent config refactor); diagram sequences it last in Phase 1 for clear commits. Accepted. |
| T5 | T1 | T4 → T5 (Phase 1→2 boundary) | ✅ Match (T5's dep T1 is in Phase 1) |
| T6 | T2 | T5 → T6 | ✅ Match |
| T7 | None | T6 → T7 | ✅ Match (T7 independent; sequenced) |
| T8 | T6 | T7 → T8 | ✅ Match |
| T9 | T8 | T8 → T9 | ✅ Match |
| T10 | T9 | T9 → T10 | ✅ Match |
| T11 | T3, T8, T9 | T10 → T11 | ✅ Match (T3 in Phase 1, T8/T9 in Phase 2 — all before T11) |
| T12 | T11 | T11 → T12 | ✅ Match |
| T13 | None | T12 → T13 | ✅ Match (T13 independent; sequenced) |
| T14 | None | T13 → T14 | ✅ Match |
| T15 | None | T14 → T15 | ✅ Match |
| T16 | None | T15 → T16 | ✅ Match |
| T17 | None | T16 → T17 | ✅ Match |
| T18 | None | T17 → T18 | ✅ Match |
| T19 | T5, T6, T7 | T18 → T19 | ✅ Match (T5/T6/T7 in Phase 2 — all before T19) |
| T20 | T16 | T19 → T20 | ✅ Match |
| T22 | T1-T20 | T20 → T22 | ✅ Match |

All dependencies point backward or within the same phase. No task depends on a later-phase task. Two ⚠️ notes (T3, T4) are phase-sequence-vs-hard-dep nuances, both accepted.

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| --- | --- | --- | --- | --- |
| T1: ToolError + validateEnum | Tool handler (shared helper) | unit | unit (`wave-4-enum-validation.test.ts`) | ✅ OK |
| T2: validateGitRef | Service (impact-analysis helper) | unit | unit (`wave-4-enum-validation.test.ts` extended) | ✅ OK |
| T3: getActiveGeneration + assertGenerationNotStale | Service (symbol helper) | unit | unit (`wave-4-enum-validation.test.ts` extended OR new file) | ✅ OK |
| T4: xdg.ts | Shared config | unit | unit (`packages/shared/src/config/__tests__/xdg.test.ts`) | ✅ OK |
| T5: Wire validateEnum into tool handlers | Tool handler | unit | unit (`wave-4-enum-validation.test.ts` extended) | ✅ OK |
| T6: Three-source diff + secrets denylist | Service + tool + HTTP route | unit + integration | unit + integration (`wave-4-correctness.test.ts`) | ✅ OK |
| T7: read_file cap + source_clipped | Tool + HTTP route | unit | unit (`wave-4-correctness.test.ts`) | ✅ OK |
| T8: impact/trace total/omitted | Service + tool + HTTP route | unit | unit (`wave-4-correctness.test.ts`) | ✅ OK |
| T9: search/refs total/omitted | Tool + repo + HTTP route | unit + integration | unit + integration (`wave-4-correctness.test.ts`) | ✅ OK |
| T10: search_definitions perf sentinel | Repository | integration | unit (mocked repo) | ✅ OK |
| T11: N1 wire into 4 tools | Tool + MCP def + HTTP route | unit + integration | unit + integration (`wave-4-generation-staleness.test.ts`) | ✅ OK |
| T12: N1 HTTP transport tests | HTTP route | e2e/integration | e2e/integration (`wave-4-transport.test.ts`) | ✅ OK |
| T13: scheduler-store-pg seam | Test fixture | integration | integration (`scheduler-store-pg.test.ts`) | ✅ OK |
| T14: Dead code sweep | Service + data/vector | unit (regression) | unit (existing tests) + artifact checks | ✅ OK |
| T15: Phase-1/5/6 validation.md | Spec docs | none (artifact) | none (artifact check) | ✅ OK |
| T16: sqlite-removal close + followup | Spec docs | none (artifact) | none (artifact check) | ✅ OK |
| T17: CI grammar gate | CI workflow | none (artifact) | none (artifact check) | ✅ OK |
| T18: N10 regression test | Test file | unit | unit (`wave-4-sql-bounds.test.ts`) | ✅ OK |
| T19: HANDOFF.md break-change note | Spec docs | none (artifact) | none (artifact check) | ✅ OK |
| T20: STATE.md update | Spec docs | none (artifact) | none (artifact check) | ✅ OK |
| T22: Final gate run | N/A | all | full gate | ✅ OK |

All tasks satisfy the Test Coverage Matrix. No test deferral. No "tested in another task" justification for `Tests: none` — the `none` rows are spec-doc/CI-workflow artifact checks where the matrix says "none".

---

## MCP / Skill Question

For each task, the available MCPs and skills:
- **MCPs**: `massa-ai` (massa-ai — for code search if needed during implementation), `context7` (if a library API needs verification — not anticipated for Wave 4's surgical edits).
- **Skills**: `massa-ai` (the active workflow skill), `caveman` (communication compression, already active).

No task requires an external MCP or skill beyond the active `massa-ai` workflow. All Wave 4 tasks are surgical TS/CI/doc edits against known files with confirmed signatures. The massa-ai code search may be used during Execute if a task reveals an unexpected caller, but is not required by the task plan.

---

## Artifact Store Evidence

- **Active artifact key:** `.specs/features/wave-4-correctness-hygiene/tasks.md`
- **Version:** 1 (initial write)
- **Checksum:** to be computed after write (sha256)
- **Spec reference:** `spec.md` sha256 `109f4313...`
- **Design reference:** `design.md` sha256 `5fc3ae93...`