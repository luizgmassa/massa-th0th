# Wave 6 — Architecture & Medium Features Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/wave-6-architecture-features/design.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

**Sources inspected:** `AGENTS.md` (root), `bunfig.toml`, `turbo.json`, `package.json` scripts, `packages/core/package.json`, `packages/core/scripts/run-tests-isolated.ts`, existing test files in `packages/core/src/__tests__/`.

**Findings:**
- Test runner: **Bun test** (`bun test`) — `bunfig.toml` `[test]` block, `testMatch=["**/*.test.ts","**/*.spec.ts"]`, `timeout=5000`.
- Test isolation: `packages/core/scripts/run-tests-isolated.ts` — classifies tests into groups (mock.module, database/integration, process-global state) and runs each in a child process.
- Turbo: `turbo.json` `test` task has `cache: false` (live DB), `dependsOn: ["build"]`, 14 `passThroughEnv` vars.
- Root test command: `turbo run test`.
- Core test commands: `packages/core/package.json` — `test`, `test:unit`, `test:e2e`, `test:integration`, `test:watch`.
- DB-free pattern: `DATABASE_URL=""` forces SQLite-free mode (Wave 4 lesson).
- Type-check: `turbo run type-check` (6 packages).
- Build: `turbo run build` (5 packages).
- Characterization test precedent: M14 `contextual-search-rlm.characterization.test.ts` pattern (pin behavior before split, never delete/weaken).
- No `CONTRIBUTING.md`, no coverage threshold config, no `_DETERMINISTIC_ONLY` env.
- Co-located tests: `packages/core/src/__tests/*.test.ts` for core; `apps/*/src/__tests__/` for app-level.

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec. Guidelines found: `AGENTS.md`, `bunfig.toml`, `turbo.json`, `packages/core/scripts/run-tests-isolated.ts`.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Service / domain logic (decomposed modules) | unit | All branches; 1:1 to spec ACs; every listed edge case | `packages/core/src/__tests__/*.test.ts` | `cd packages/core && bun test src/__tests__/<file>` |
| Characterization (decomposition pins) | unit | Pin observable behavior before+after split; never weakened | `packages/core/src/__tests__/*.characterization.test.ts` | `cd packages/core && bun test src/__tests__/<file>` |
| MCP client / embedded mode | unit | Parity: same tool call → same result in HTTP vs embedded | `apps/mcp-client/src/__tests__/*.test.ts` | `cd apps/mcp-client && bun test` |
| Hook binary | unit | Same stdin → same POST body → same exit code; typed payload validation | `apps/claude-plugin/hooks/__tests__/*.test.ts` | `bun test apps/claude-plugin/hooks/__tests__/` |
| Parallel test runner | unit | ZERO-LOSS guard: crash a suite → fail; list = execute | `scripts/__tests__/*.test.ts` | `bun test scripts/__tests__/` |
| Test-seam fixtures | unit | Real response fixtures → consumer parsers; drift detection | `packages/core/src/__tests__/test-seam/*.test.ts` | `cd packages/core && bun test src/__tests__/test-seam/` |
| Dashboard routes | integration | New routes return expected data; UI renders sections | `apps/tools-api/src/__tests__/*.test.ts` | `cd apps/tools-api && bun test` |
| Scheduler preset | unit | Preset enables consolidation+decay only; individual envs override | `packages/core/src/__tests__/*.test.ts` | `cd packages/core && bun test src/__tests__/<file>` |
| Config / types / docs | none | Build gate only | — | `turbo run type-check && turbo run build` |

---

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only (DB-free) | `cd packages/core && DATABASE_URL="" bun test src/__tests__/<file>` or `cd apps/<app> && bun test` |
| Full | After tasks with integration tests | `cd packages/core && DATABASE_URL="" bun scripts/run-tests-isolated.ts --unit` |
| Build | After phase completion or config/entity-only tasks | `turbo run type-check && turbo run build` |
| Type-only | Quick type check after module moves | `turbo run type-check` |

---

## Execution Plan

Phases are ordered and run sequentially. Tasks within a phase execute in order.

### Phase 1: N31 Characterization Tests (before any split)

T01 → T02 → T03 → T04 → T05

### Phase 2: N31 SymbolRepositoryPg Decomposition

T06 → T07 → T08 → T09 → T10

### Phase 3: N31 ToolDefinitions + AutoImproveJob + SmartChunker Decomposition

T11 → T12 → T13 → T14 → T15 → T16 → T17

### Phase 4: N32 Embedded MCP + N30 Hook Binary

T18 → T19 → T20 → T21 → T22

### Phase 5: N20 Parallel Runner + N21 Test-Seam

T23 → T24 → T25 → T26

### Phase 6: N28 Dashboard + N29 Scheduler Preset

T27 → T28 → T29 → T30

### Phase 7: N17/N18 Process + N19/N42/M25/M26/M62 Carryovers

T31 → T32 → T33 → T34 → T35 → T36 → T37

### Phase 8: Validation

T38 (independent verifier)

---

## Task Breakdown

### T1: SymbolRepositoryPg characterization test

**What**: Write characterization tests pinning key SymbolRepositoryPg query results before any split.
**Where**: `packages/core/src/__tests__/symbol-repository-pg.characterization.test.ts`
**Depends on**: None
**Reuses**: M14 characterization pattern (`contextual-search-rlm.characterization.test.ts`)
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tests pin: getProjectMapSnapshot shape, searchDefinitions results, batchUpsertDefinitions, findEdges, runBfsCteImpact, resolveDefinitionFqn
- [ ] Tests are DB-free (mock.module pattern, `DATABASE_URL=""`)
- [ ] Quick gate passes: `cd packages/core && DATABASE_URL="" bun test src/__tests__/symbol-repository-pg.characterization.test.ts`
- [ ] Test count: ≥10 tests pass

**Tests**: unit (characterization)
**Gate**: quick

---

### T2: ToolDefinitions characterization test

**What**: Pin exact TOOL_DEFINITIONS roster (52 tools, order, names, schema presence) before split.
**Where**: `apps/mcp-client/src/__tests__/tool-definitions.characterization.test.ts`
**Depends on**: None
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tests assert: array length = 52, all tool names present in expected order, each has `name`/`description`/`inputSchema`/`apiMethod`/`apiEndpoint`
- [ ] `getToolDefinition` returns correct def for each name, null for unknown
- [ ] Quick gate passes: `cd apps/mcp-client && bun test src/__tests__/tool-definitions.characterization.test.ts`
- [ ] Test count: ≥5 tests pass

**Tests**: unit (characterization)
**Gate**: quick

---

### T3: AutoImproveJob characterization test

**What**: Pin detectPatterns output + approve/reject state transitions before split.
**Where**: `packages/core/src/__tests__/auto-improve-job.characterization.test.ts`
**Depends on**: None
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tests pin: detectPatterns output for fixed input, approve flow (proposal→applied), reject flow (proposal→rejected), validateCreatePayload, buildUpdatePatch
- [ ] Tests are DB-free (mock deps)
- [ ] Quick gate passes: `cd packages/core && DATABASE_URL="" bun test src/__tests__/auto-improve-job.characterization.test.ts`
- [ ] Test count: ≥8 tests pass

**Tests**: unit (characterization)
**Gate**: quick

---

### T4: SmartChunker characterization test

**What**: Pin byte-identical Chunk[] output per format (markdown/json/yaml/code/fixed) before split.
**Where**: `packages/core/src/__tests__/smart-chunker.characterization.test.ts`
**Depends on**: None
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tests pin: smartChunk output for sample .md, .json, .yaml, .ts, .py, .go, unknown-ext (fixed) inputs — exact chunk count, content, lineStart/lineEnd
- [ ] Tests are pure (no DB, no I/O)
- [ ] Quick gate passes: `cd packages/core && DATABASE_URL="" bun test src/__tests__/smart-chunker.characterization.test.ts`
- [ ] Test count: ≥6 tests pass (one per format)

**Tests**: unit (characterization)
**Gate**: quick

---

### T5: Commit characterization tests

**What**: Atomic commit of all 4 characterization test files.
**Where**: All 4 characterization test files from T1-T4
**Depends on**: T1, T2, T3, T4
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All 4 characterization test files committed atomically
- [ ] Build gate passes: `turbo run type-check && turbo run build`
- [ ] All characterization tests green

**Tests**: none (commit only)
**Gate**: build

---

### T6: Extract symbol-repo-types.ts (types + interfaces)

**What**: Move all type/interface definitions (L19-219) from symbol-repository-pg.ts to symbol-repo-types.ts; re-export from original file.
**Where**: `packages/core/src/data/symbol/symbol-repo-types.ts` (new), `packages/core/src/data/symbol/symbol-repository-pg.ts` (modify imports)
**Depends on**: T5
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] **Line ranges re-verified against actual file at execution time** (no blind extraction from design doc numbers — ranges drift)
- [ ] All types/interfaces moved to symbol-repo-types.ts
- [ ] symbol-repository-pg.ts imports from symbol-repo-types.ts
- [ ] Characterization tests (T1) still green
- [ ] Type gate passes: `turbo run type-check`
- [ ] symbol-repo-types.ts ≤ 250 LOC

**Tests**: unit (characterization tests verify)
**Gate**: quick + type

---

### T7: Extract symbol-repo-mappers.ts (Raw interfaces + map functions) + symbol-repo-identity.ts (SQL helpers)

**What**: Move Raw interfaces (WsRaw/FileRaw/DefRaw/RefRaw/ImpRaw) + map functions (mapDef/mapRef/mapImp/mapWs) to symbol-repo-mappers.ts. Move SQL identity helpers (TransactionClient type, definitionIdentityColumns, generationDefinitionIdentityColumns, referenceSourceSpan) to symbol-repo-identity.ts — these are NOT mappers, they are SQL value-extraction helpers used by queries.
**Where**: `packages/core/src/data/symbol/symbol-repo-mappers.ts` (new), `packages/core/src/data/symbol/symbol-repo-identity.ts` (new)
**Depends on**: T6
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] **Line ranges re-verified against actual file at execution time** (no blind extraction from design doc numbers — ranges drift)
- [ ] Mappers + Raw interfaces (L312+) moved to symbol-repo-mappers.ts
- [ ] SQL identity helpers (TransactionClient + definitionIdentityColumns + generationDefinitionIdentityColumns + referenceSourceSpan, L221-310) moved to symbol-repo-identity.ts (NOT mappers — used by queries)
- [ ] Characterization tests green
- [ ] Type gate passes
- [ ] symbol-repo-mappers.ts ≤ 200 LOC, symbol-repo-identity.ts ≤ 120 LOC

**Tests**: unit
**Gate**: quick + type

---

### T8: Extract symbol-repo-queries.ts (CRUD methods)

**What**: Move workspace/file/definition/reference/import CRUD method bodies (workspace ops, file ops, definition ops, reference ops, import ops) to module functions; class methods become 1-line delegates.
**Where**: `packages/core/src/data/symbol/symbol-repo-queries.ts` (new)
**Depends on**: T7
**Reuses**: M14 delegate pattern (relax private→public on moved-relevant fields)
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] CRUD methods delegated to symbol-repo-queries.ts
- [ ] Characterization tests green
- [ ] Type gate passes
- [ ] symbol-repo-queries.ts ≤ 500 LOC

**Tests**: unit
**Gate**: quick + type

---

### T9: Extract symbol-repo-generation.ts + symbol-repo-graph.ts

**What**: Move generation-scoped writes (copyFileGeneration, writeFileGeneration, deleteFileGeneration, markFileStaleGeneration, writeFileSymbols) to symbol-repo-generation.ts; move graph query methods (getProjectMapSnapshot, getProjectMapAggregates, findEdges, runBfsCteImpact, countEdgesByKind) to symbol-repo-graph.ts.
**Where**: `packages/core/src/data/symbol/symbol-repo-generation.ts` (new), `packages/core/src/data/symbol/symbol-repo-graph.ts` (new)
**Depends on**: T8
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Generation + graph methods delegated
- [ ] symbol-repository-pg.ts is now ≤150 LOC (facade: singleton + delegates + barrel)
- [ ] Characterization tests green
- [ ] Build gate passes: `turbo run type-check && turbo run build`
- [ ] No module > 600 LOC

**Tests**: unit
**Gate**: build

---

### T10: Commit SymbolRepositoryPg decomposition

**What**: Atomic commit of all symbol-repo split files (T6-T9).
**Depends on**: T9
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All split files committed
- [ ] Build gate green
- [ ] Characterization tests green

**Tests**: none (commit)
**Gate**: build

---

### T11: Extract tool-defs-search.ts + tool-defs-memory.ts

**What**: Move search/symbol-graph tool definitions (search, search_definitions, get_references, go_to_definition, trace_path, impact_analysis, symbol_snippet) to tool-defs-search.ts; move memory/checkpoint tool definitions (remember, recall, memory_*, list/create/restore_checkpoint, compress, optimized_context, analytics) to tool-defs-memory.ts.
**Where**: `apps/mcp-client/src/tool-defs/tool-defs-search.ts` (new), `apps/mcp-client/src/tool-defs/tool-defs-memory.ts` (new)
**Depends on**: T5
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tool definitions moved to domain modules
- [ ] tool-definitions.ts imports and concatenates them
- [ ] Characterization test (T2) green (52 tools, same order)
- [ ] Type gate passes
- [ ] Each module ≤ 600 LOC

**Tests**: unit (characterization)
**Gate**: quick + type

---

### T12: Extract tool-defs-synapse.ts + tool-defs-project.ts + tool-defs-hooks-exec.ts

**What**: Move remaining tool definitions: synapse_* (9 tools + task_begin/end) to tool-defs-synapse.ts; project/index tools to tool-defs-project.ts; hook/handoff/proposal/executor tools to tool-defs-hooks-exec.ts.
**Where**: `apps/mcp-client/src/tool-defs/tool-defs-synapse.ts` (new), `apps/mcp-client/src/tool-defs/tool-defs-project.ts` (new), `apps/mcp-client/src/tool-defs/tool-defs-hooks-exec.ts` (new)
**Depends on**: T11
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All 52 tool definitions in domain modules
- [ ] tool-definitions.ts is ≤50 LOC (import + concatenate + getToolDefinition)
- [ ] Characterization test green
- [ ] Build gate passes
- [ ] No module > 600 LOC

**Tests**: unit
**Gate**: build

---

### T13: Extract auto-improve-patterns.ts + auto-improve-llm.ts

**What**: Move detectPatterns + extract helpers (extractQuery, extractFilePath, extractFixSignature, pathBucket, STOPWORDS, normalizeSignature) to auto-improve-patterns.ts; move enrichWithLlm + buildEnrichmentPrompt + ProposalEnrichmentSchema to auto-improve-llm.ts.
**Where**: `packages/core/src/services/jobs/auto-improve-patterns.ts` (new), `packages/core/src/services/jobs/auto-improve-llm.ts` (new)
**Depends on**: T5
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Pattern + LLM functions moved to modules
- [ ] auto-improve-job.ts delegates to them
- [ ] Characterization test (T3) green
- [ ] Type gate passes
- [ ] Each module ≤ 300 LOC

**Tests**: unit
**Gate**: quick + type

---

### T14: Extract auto-improve-apply.ts + auto-improve-config.ts

**What**: Move applyProposal + readTargetForApply + validateCreatePayload + buildUpdatePatch + ApplyRejection to auto-improve-apply.ts; move DEFAULT_THRESHOLDS + FALLBACK_AUTO_IMPROVE + readAutoImproveConfig + VALID_MEMORY_TYPES to auto-improve-config.ts.
**Where**: `packages/core/src/services/jobs/auto-improve-apply.ts` (new), `packages/core/src/services/jobs/auto-improve-config.ts` (new)
**Depends on**: T13
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Apply + config functions moved
- [ ] auto-improve-job.ts is ≤300 LOC (facade: class + delegates)
- [ ] Characterization test green
- [ ] Build gate passes
- [ ] No module > 600 LOC

**Tests**: unit
**Gate**: build

---

### T15: Extract chunker-types.ts + chunker-markdown.ts + chunker-json-yaml.ts

**What**: Move Chunk/ChunkerConfig/DEFAULT_CONFIG to chunker-types.ts; chunkMarkdown + chunkMarkdownByHeadings to chunker-markdown.ts; chunkJSON + chunkYAML to chunker-json-yaml.ts. NOTE: smart-chunker.ts has NO class — uses extract-functions pattern (Approach C), NOT M14 delegate-class (Approach A). Reconcile T4 characterization with existing `smart-chunker.test.ts` (extend or supersede with note).
**Where**: `packages/core/src/services/search/chunker/chunker-types.ts` (new), `chunker-markdown.ts` (new), `chunker-json-yaml.ts` (new)
**Depends on**: T5
**Reuses**: Extract-functions pattern (not delegate-class — smart-chunker has no class)
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] **Line ranges re-verified against actual file at execution time**
- [ ] T4 characterization test reconciled with existing `smart-chunker.test.ts` (extend existing or supersede with documented note)
- [ ] Types + markdown + json/yaml moved as free functions (not class methods — no `this`)
- [ ] smart-chunker.ts imports them
- [ ] Characterization test (T4) green
- [ ] Type gate passes
- [ ] Each module ≤ 300 LOC

**Tests**: unit
**Gate**: quick + type

---

### T16: Extract chunker-code.ts + chunker-post.ts

**What**: Move chunkCode + findCodeBoundaries + CodeBoundary + RESERVED_KEYWORDS + regex consts + netBraceDelta + extractFileImports + CODE_EXTENSIONS + isCodeFile to chunker-code.ts; move postProcess + splitOversizedChunk + splitLineByChars + chunkFixed to chunker-post.ts.
**Where**: `packages/core/src/services/search/chunker/chunker-code.ts` (new), `chunker-post.ts` (new)
**Depends on**: T15
**Reuses**: M14 delegate pattern
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Code + post-processing moved
- [ ] smart-chunker.ts is ≤100 LOC (dispatcher + re-exports)
- [ ] Characterization test green
- [ ] Build gate passes
- [ ] No module > 600 LOC

**Tests**: unit
**Gate**: build

---

### T17: Commit all N31 decompositions (ToolDefs + AutoImprove + SmartChunker)

**What**: Atomic commit of T11-T16 decomposition files.
**Depends on**: T16
**Reuses**: None
**Requirement**: W6-01

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All decomposition files committed
- [ ] Build gate green
- [ ] All characterization tests green

**Tests**: none (commit)
**Gate**: build

---

### T18: EmbeddedApiClient implementation

**What**: Implement `EmbeddedApiClient` class implementing `ToolProxyApiClient` interface, routing get/post/patch/delete to core service/controller calls directly (no HTTP).
**Where**: `apps/mcp-client/src/embedded-api-client.ts` (new)
**Depends on**: T17
**Reuses**: `ToolProxyApiClient` interface (`call-tool-proxy.ts:6`), core controllers (SearchController, MemoryController, etc.)
**Requirement**: W6-02

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] EmbeddedApiClient implements get/post/patch/delete
- [ ] Maps tool endpoints to core service calls (endpoint → controller method)
- [ ] Error shape matches `ApiHttpError` (same `success: false, error` structure)
- [ ] Type gate passes

**Tests**: unit
**Gate**: quick + type

---

### T19: MCP server embedded mode wiring + handleIndexTool refactor

**What**: Wire `MASSA_AI_EMBEDDED=true` to use `EmbeddedApiClient` instead of `ApiClient`; health check reports `mode: "embedded"`. CRITICAL: `McpProxyServer.apiClient` is typed as `ApiClient` (concrete) and calls `uploadAndIndex` + `healthCheck` which are NOT on `ToolProxyApiClient` interface. Must refactor `handleIndexTool` to work in embedded mode with same path-safety validation as HTTP route (`project.ts:351-356`).
**Where**: `apps/mcp-client/src/index.ts` (modify McpProxyServer constructor + handleIndexTool), `apps/mcp-client/src/embedded-api-client.ts` (add uploadAndIndex + healthCheck)
**Depends on**: T18
**Reuses**: `proxyCallTool` (unchanged for non-index tools), path-safety validation from `project.ts:351-356`
**Requirement**: W6-02

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] `MASSA_AI_EMBEDDED=true` → `this.apiClient = new EmbeddedApiClient()`
- [ ] `MASSA_AI_EMBEDDED` not set → `this.apiClient = new ApiClient()` (HTTP, unchanged)
- [ ] Health check includes `mode` field (`"embedded"` or `"http"`)
- [ ] `handleIndexTool` in embedded mode exercises same path-safety validation as HTTP route (`project.ts:351-356` traversal guard)
- [ ] `EmbeddedApiClient.uploadAndIndex` does in-process file indexing (not HTTP multipart) with path safety
- [ ] Parity test: same tool call in both modes → same result shape — **including `index` tool**, not just proxy tools
- [ ] Quick gate passes

**Tests**: unit
**Gate**: quick

---

### T20: Hook binary — core implementation

**What**: Implement `massa-ai-hook` Bun binary: typed stdin JSON parsing, project-id pinning (port _pin.sh logic to TS), POST to `/api/v1/hook` with 2s timeout, exit 0 always. CRITICAL: `pre-compact` subcommand is a special case — it does TWO POSTs: (1) observation to `/api/v1/hook` with 3s timeout, (2) snapshot to `/api/v1/hook/compact-snapshot` with 5s timeout and DIFFERENT body shape (`{sessionId, projectId, persist, cwd}` vs `{event, projectId, sessionId, cwd, payload}`). All other subcommands are uniform single-POST.
**Where**: `apps/claude-plugin/hooks/massa-ai-hook.ts` (new)
**Depends on**: T17
**Reuses**: `_pin.sh` resolution logic, `_post.sh` POST semantics, `pre-compact.sh` dual-POST logic, `AttributionResolver` concepts
**Requirement**: W6-03

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Binary reads JSON from stdin (Bun-native, no jq)
- [ ] Subcommands: session-start, user-prompt-submit, post-tool-use, pre-compact (SPECIAL: 2 POSTs), stop
- [ ] `pre-compact` POSTs to BOTH `/api/v1/hook` (3s, observation body) AND `/api/v1/hook/compact-snapshot` (5s, snapshot body `{sessionId, projectId, persist, cwd}`)
- [ ] All other subcommands: single POST to `/api/v1/hook` (2s, observation body)
- [ ] Project-id pinning: existing pin → env → git toplevel → cwd basename (same as _pin.sh)
- [ ] POST with AbortSignal timeout, exit 0 always
- [ ] Terminal stdin (no pipe) → exit 0, no POST
- [ ] Type gate passes

**Tests**: unit
**Gate**: quick + type

---

### T21: Hook binary — tests + install wiring

**What**: Write hook binary tests (same stdin → same POST body → exit 0) and update `.claude/settings.json` template to reference binary. CRITICAL: `pre-compact` test must verify BOTH POSTs (observation + snapshot) with correct body shapes and timeouts.
**Where**: `apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts` (new), `apps/claude-plugin/settings.json.template` (modify)
**Depends on**: T20
**Reuses**: Shell hook test pattern from `hook-scripts.test.ts`
**Requirement**: W6-03

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Tests: malformed JSON → exit 0 no POST; valid JSON → POST correct; terminal stdin → exit 0; pin resolution order correct
- [ ] **`pre-compact` test verifies BOTH POSTs**: (1) observation to `/api/v1/hook` (3s, observation body shape), (2) snapshot to `/api/v1/hook/compact-snapshot` (5s, snapshot body shape)
- [ ] settings.json.template references `massa-ai-hook` binary
- [ ] Build gate passes
- [ ] Test count: ≥8 tests pass (6 standard + 2 pre-compact dual-POST)

**Tests**: unit
**Gate**: build

---

### T22: Commit N32 + N30 (embedded + hook binary)

**What**: Atomic commit of embedded mode + hook binary.
**Depends on**: T21
**Reuses**: None
**Requirement**: W6-02, W6-03

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All files committed
- [ ] Build gate green

**Tests**: none (commit)
**Gate**: build

---

### T23: Parallel test runner — macro table + --list-suites

**What**: Implement `SUITE_TABLE` macro array + `--list-suites` flag in `scripts/run-tests-parallel.ts`. Table derived from `run-tests-isolated.ts` classifier.
**Where**: `scripts/run-tests-parallel.ts` (new)
**Depends on**: T22
**Reuses**: `run-tests-isolated.ts` classifier (L88-127)
**Requirement**: W6-04

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] SUITE_TABLE enumerates all test suites with id, description, testFiles, isolationReason, deadlineSensitive
- [ ] `--list-suites` prints the table
- [ ] Type gate passes

**Tests**: unit
**Gate**: quick + type

---

### T24: Parallel test runner — execution + ZERO-LOSS guard

**What**: Implement parallel execution (child processes per non-deadline-sensitive suite) + serial tail for deadline-sensitive + UNION GUARD (result-set ≠ list → fail).
**Where**: `scripts/run-tests-parallel.ts` (modify)
**Depends on**: T23
**Reuses**: Child process spawning from `run-tests-isolated.ts`
**Requirement**: W6-04

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Parallel execution of independent suites
- [ ] Serial tail for deadline-sensitive suites
- [ ] UNION GUARD: crashed suite = failed (not dropped); result-set ≠ list → exit 1
- [ ] Per-suite pass/fail/skip counts + total summary
- [ ] Test: deliberately crash a suite → UNION GUARD fails

**Tests**: unit
**Gate**: quick

---

### T25: Test-seam fixtures — capture + freeze

**What**: Capture real tool responses (search, read_file, impact_analysis), freeze as deterministic JSON fixtures (no timestamps, no random IDs).
**Where**: `packages/core/src/__tests__/test-seam/fixtures/search-response.json`, `read-file-response.json`, `impact-analysis-response.json` (new)
**Depends on**: T22
**Reuses**: Existing tool responses
**Requirement**: W6-05

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] 3+ fixtures captured and frozen (deterministic)
- [ ] Fixtures are valid JSON
- [ ] Fixtures committed

**Tests**: none (fixtures)
**Gate**: build

---

### T26: Test-seam consumer tests

**What**: Write tests feeding frozen fixtures to consumer parsers (observation-extractor, Synapse layer); mutate fixture shape → test fails (drift detection).
**Where**: `packages/core/src/__tests__/test-seam/observation-extractor-seam.test.ts`, `synapse-consumer-seam.test.ts` (new)
**Depends on**: T25
**Reuses**: `observation-extractor.ts` (unchanged)
**Requirement**: W6-05

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] observation-extractor-seam test: feed frozen search response → assert classification correct; mutate shape → test fails
- [ ] synapse-consumer-seam test: feed frozen search response → assert consumption correct; mutate shape → test fails
- [ ] Quick gate passes
- [ ] Test count: ≥4 tests pass

**Tests**: unit
**Gate**: quick

---

### T27: Dashboard — new API routes

**What**: Add `GET /api/v1/scheduler/status` (wraps `scheduler.status()`) and `GET /api/v1/hooks/queue-status` (wraps `WriterQueue.pendingCount`).
**Where**: `apps/tools-api/src/routes/dashboard.ts` (new), `apps/tools-api/src/index.ts` (wire route)
**Depends on**: T22
**Reuses**: `scheduler.status()`, `WriterQueue.pendingCount`
**Requirement**: W6-06

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] `GET /api/v1/scheduler/status` returns SchedulerStatusResponse (running, tickIntervalMs, jobs[])
- [ ] `GET /api/v1/hooks/queue-status` returns HookQueueStatus (pendingCount, maxPending, saturated)
- [ ] Both routes behind API-key gate (same as existing routes)
- [ ] Integration tests pass
- [ ] Build gate passes

**Tests**: integration
**Gate**: full

---

### T28: Dashboard — UI route + rendering

**What**: Add `#/dashboard` hash route in web UI; dashboard.js fetches scheduler status, hook queue, Synapse sessions, system metrics and renders sections.
**Where**: `apps/web-ui/src/static/index.html` (add nav + route), `apps/web-ui/src/static/dashboard.js` (new), `apps/web-ui/src/static/app.js` (add dashboard section)
**Depends on**: T27
**Reuses**: Existing `api.request` wrapper, web UI styling
**Requirement**: W6-06

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] `#/dashboard` route renders scheduler jobs, hook queue depth, Synapse sessions
- [ ] Scheduler disabled → shows "scheduler disabled" not crash
- [ ] Endpoint unavailable → shows "unavailable" not crash
- [ ] Read-only (no write operations)
- [ ] Build gate passes

**Tests**: integration
**Gate**: build

---

### T29: Scheduler safe-defaults preset

**What**: Add `MASSA_AI_SCHEDULER_SAFE_DEFAULTS=true` logic in `scheduler-defaults.ts`: enables consolidation + decay at conservative intervals; auto-improve stays opt-in; individual envs override preset; master switch still required. CRITICAL: `applySafeDefaults` must be wired INSIDE `registerDefaultJobs` before the `envBool` loop reads `defaultEnabled` — NOT as a separate export (silent no-op if caller forgets).
**Where**: `packages/core/src/services/scheduler/scheduler-defaults.ts` (modify `registerDefaultJobs` at L157)
**Depends on**: T22
**Reuses**: Existing `envBool` helper
**Requirement**: W6-07

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] **Preset applied inside `registerDefaultJobs` before `envBool` reads `defaultEnabled`** (not a separate export)
- [ ] Preset enables consolidation + decay `defaultEnabled=true` when `MASSA_AI_SCHEDULER_SAFE_DEFAULTS=true`
- [ ] Auto-improve NOT enabled by preset
- [ ] Individual envs (`MASSA_AI_SCHEDULER_CONSOLIDATION_ENABLED` etc.) override preset
- [ ] Master switch (`MASSA_AI_SCHEDULER_ENABLED`) still required
- [ ] Preset not set → behavior unchanged
- [ ] Tests: preset without master → no jobs; preset + master → consolidation+decay only; preset + master + auto-improve env → all three; **preset + master + no per-kind env → consolidation enabled** (proves wiring, not just function logic)
- [ ] Quick gate passes

**Tests**: unit
**Gate**: quick

---

### T30: Commit N28 + N29 (dashboard + scheduler preset)

**What**: Atomic commit of dashboard + scheduler preset.
**Depends on**: T28, T29
**Reuses**: None
**Requirement**: W6-06, W6-07

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All files committed
- [ ] Build gate green

**Tests**: none (commit)
**Gate**: build

---

### T31: N17 Harness contribution protocol doc

**What**: Write `CONTRIBUTING.md` with 7-step managed-harness contribution protocol (contract → register → preserve argv → read-only export → deliver-before-ack → invariants → tests).
**Where**: `CONTRIBUTING.md` (new, repo root)
**Depends on**: T30
**Reuses**: Plan N17 spec
**Requirement**: W6-08

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] 7 steps documented with concrete acceptance gates
- [ ] Build gate passes (docs only)

**Tests**: none (docs)
**Gate**: build

---

### T32: N18 Deterministic acceptance script

**What**: Implement `scripts/run-deterministic.ts` with `_DETERMINISTIC_ONLY=1` skipping DB/network/grammar suites; reports skipped suites.
**Where**: `scripts/run-deterministic.ts` (new)
**Depends on**: T30
**Reuses**: `run-tests-isolated.ts` classifier
**Requirement**: W6-09

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] `_DETERMINISTIC_ONLY=1` skips all suites requiring live DB, network, or grammar
- [ ] Reports which suites skipped + why
- [ ] Completes without external dependencies
- [ ] Type gate passes

**Tests**: unit
**Gate**: quick + type

---

### T33: N19 Admin access preservation

**What**: Implement four-rung auth ladder: no users → admin open until first user. Minimal preservation logic, not full auth.
**Where**: `apps/tools-api/src/middleware/admin-preservation.ts` (new), `apps/tools-api/src/index.ts` (wire)
**Depends on**: T30
**Reuses**: None
**Requirement**: W6-10

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] 0 users → admin endpoints open (no auth)
- [ ] First user created → admin endpoints require auth
- [ ] No full auth system implemented (preservation logic only)
- [ ] Tests: fresh install → admin open; create user → admin locked
- [ ] Quick gate passes

**Tests**: unit
**Gate**: quick

---

### T34: N42 Path recovery documentation + --recover flag

**What**: Document rename scenario in docs; add `--recover <projectId> --path <newPath>` flag to project CLI re-associating index via alias-chain (M16/M17).
**Where**: `docs/path-recovery.md` (new), project CLI (modify)
**Depends on**: T30
**Reuses**: M16/M17 alias-chain
**Requirement**: W6-11

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Docs cover rename → index breaks → `--recover` restores
- [ ] `--recover <projectId> --path <newPath>` re-associates index
- [ ] Non-existent projectId → error with not-found
- [ ] Build gate passes

**Tests**: unit
**Gate**: build

---

### T35: M25 + M26 (name resolution + JSON extraction)

**What**: M25: project resolution by unique name tail (unique → return; ambiguous → error with candidates; none → not-found). M26: composite/escaped JSON property extraction in serializeToolResponse (unescape escaped, return nested structures, clear error on failure).
**Where**: ProjectService (modify for M25), `packages/shared/src/tools/serialize.ts` or equivalent (modify for M26)
**Depends on**: T30
**Reuses**: Existing project resolution, existing serialize logic
**Requirement**: W6-12, W6-13

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] M25: name-tail resolution (unique/ambiguous/not-found)
- [ ] M26: escaped JSON unescaped correctly; composite JSON returned as nested; failure → clear error
- [ ] Tests: unique name → resolve; ambiguous → error; none → not-found; escaped JSON → unescaped value
- [ ] Quick gate passes

**Tests**: unit
**Gate**: quick

---

### T36: M62 GLR stack-merge depth verification

**What**: Read-only probe of Node tree-sitter binding GLR stack-merge depth cap; document findings or fix if defect found.
**Where**: `scripts/verify-glr-stack-depth.ts` (new), `docs/glr-verification.md` (new)
**Depends on**: T30
**Reuses**: tree-sitter native binding
**Requirement**: W6-14

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] Probe runs ambiguous grammar input
- [ ] Documents current cap (if any) and whether it affects massa-ai's grammars
- [ ] If defect found → report with fix proposal (not silently fixed)
- [ ] If no defect → documented
- [ ] Build gate passes

**Tests**: none (probe/docs)
**Gate**: build

---

### T37: Commit Phase 7 (process + carryovers)

**What**: Atomic commit of T31-T36.
**Depends on**: T36
**Reuses**: None
**Requirement**: W6-08..W6-14

**Tools**: MCP: NONE. Skill: NONE.

**Done when**:
- [ ] All files committed
- [ ] Build gate green

**Tests**: none (commit)
**Gate**: build

---

### T38: Independent verifier (validation)

**What**: Run independent verifier (author ≠ verifier) — spec-anchored outcome check + discrimination sensor + write validation.md.
**Where**: `.specs/features/wave-6-architecture-features/validation.md` (new)
**Depends on**: T37
**Reuses**: Spec-driven validate.md protocol
**Requirement**: All

**Tools**: MCP: NONE. Skill: `massa-ai` (validate flow).

**Done when**:
- [ ] Spec-anchored outcome check: each AC confirmed with file:line + assertion
- [ ] Discrimination sensor: inject behavior-level faults, confirm tests kill them, discard mutations
- [ ] validation.md written (PASS/FAIL, per-AC evidence, sensor result, diff range)
- [ ] Fix → re-verify loop capped at 3 iterations before escalating to Blocked

**Tests**: all
**Gate**: full + build

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3 → Phase 4 → Phase 5 → Phase 6 → Phase 7 → Phase 8

Phase 1:  T01 ──→ T02 ──→ T03 ──→ T04 ──→ T05
Phase 2:  T06 ──→ T07 ──→ T08 ──→ T09 ──→ T10
Phase 3:  T11 ──→ T12 ──→ T13 ──→ T14 ──→ T15 ──→ T16 ──→ T17
Phase 4:  T18 ──→ T19 ──→ T20 ──→ T21 ──→ T22
Phase 5:  T23 ──→ T24 ──→ T25 ──→ T26
Phase 6:  T27 ──→ T28 ──→ T29 ──→ T30
Phase 7:  T31 ──→ T32 ──→ T33 ──→ T34 ──→ T35 ──→ T36 ──→ T37
Phase 8:  T38
```

Execution is strictly sequential — no intra-phase parallelism. Batch sub-agents packed at phase boundaries (~7 tasks per worker).

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T01: SymbolRepo characterization | 1 test file | ✅ Granular |
| T02: ToolDefs characterization | 1 test file | ✅ Granular |
| T03: AutoImprove characterization | 1 test file | ✅ Granular |
| T04: SmartChunker characterization | 1 test file | ✅ Granular |
| T05: Commit characterization | commit only | ✅ Granular |
| T06: symbol-repo-types | 1 module | ✅ Granular |
| T07: symbol-repo-mappers | 1 module | ✅ Granular |
| T08: symbol-repo-queries | 1 module | ✅ Granular |
| T09: symbol-repo-generation + graph | 2 modules | ✅ Granular (cohesive) |
| T10: Commit SymbolRepo split | commit only | ✅ Granular |
| T11: tool-defs-search + memory | 2 modules | ✅ Granular (cohesive) |
| T12: tool-defs-synapse + project + hooks-exec | 3 modules | ✅ Granular (cohesive) |
| T13: auto-improve-patterns + llm | 2 modules | ✅ Granular |
| T14: auto-improve-apply + config | 2 modules | ✅ Granular |
| T15: chunker-types + markdown + json-yaml | 3 modules | ✅ Granular (cohesive) |
| T16: chunker-code + post | 2 modules | ✅ Granular |
| T17: Commit N31 decompositions | commit only | ✅ Granular |
| T18: EmbeddedApiClient | 1 module | ✅ Granular |
| T19: MCP embedded wiring | 1 file modify | ✅ Granular |
| T20: Hook binary core | 1 module | ✅ Granular |
| T21: Hook binary tests + wiring | tests + config | ✅ Granular |
| T22: Commit N32+N30 | commit only | ✅ Granular |
| T23: Parallel runner macro table | 1 script | ✅ Granular |
| T24: Parallel runner execution | 1 script modify | ✅ Granular |
| T25: Test-seam fixtures | fixtures | ✅ Granular |
| T26: Test-seam consumer tests | 2 test files | ✅ Granular |
| T27: Dashboard API routes | 1 route file | ✅ Granular |
| T28: Dashboard UI | UI files | ✅ Granular |
| T29: Scheduler preset | 1 file modify | ✅ Granular |
| T30: Commit N28+N29 | commit only | ✅ Granular |
| T31: Harness protocol doc | 1 doc | ✅ Granular |
| T32: Deterministic script | 1 script | ✅ Granular |
| T33: Admin preservation | 1 module | ✅ Granular |
| T34: Path recovery | 1 doc + CLI | ✅ Granular |
| T35: M25+M26 | 2 features | ✅ Granular (cohesive) |
| T36: M62 GLR probe | 1 probe + doc | ✅ Granular |
| T37: Commit Phase 7 | commit only | ✅ Granular |
| T38: Verifier | validation | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (body) | Diagram Shows | Status |
| ---- | ----------------- | ------------- | ------ |
| T01-T04 | None | No arrows in | ✅ Match |
| T05 | T01,T02,T03,T04 | Arrows from T01-T04 | ✅ Match |
| T06 | T05 | Arrow from T05 | ✅ Match |
| T07 | T06 | Arrow from T06 | ✅ Match |
| T08 | T07 | Arrow from T07 | ✅ Match |
| T09 | T08 | Arrow from T08 | ✅ Match |
| T10 | T09 | Arrow from T09 | ✅ Match |
| T11 | T05 | Arrow from T05 | ✅ Match |
| T12 | T11 | Arrow from T11 | ✅ Match |
| T13 | T05 | Arrow from T05 | ✅ Match |
| T14 | T13 | Arrow from T13 | ✅ Match |
| T15 | T05 | Arrow from T05 | ✅ Match |
| T16 | T15 | Arrow from T15 | ✅ Match |
| T17 | T16 | Arrow from T16 | ✅ Match |
| T18 | T17 | Arrow from T17 | ✅ Match |
| T19 | T18 | Arrow from T18 | ✅ Match |
| T20 | T17 | Arrow from T17 | ✅ Match |
| T21 | T20 | Arrow from T20 | ✅ Match |
| T22 | T21 | Arrow from T21 | ✅ Match |
| T23 | T22 | Arrow from T22 | ✅ Match |
| T24 | T23 | Arrow from T23 | ✅ Match |
| T25 | T22 | Arrow from T22 | ✅ Match |
| T26 | T25 | Arrow from T25 | ✅ Match |
| T27 | T22 | Arrow from T22 | ✅ Match |
| T28 | T27 | Arrow from T27 | ✅ Match |
| T29 | T22 | Arrow from T22 | ✅ Match |
| T30 | T28,T29 | Arrows from T28,T29 | ✅ Match |
| T31 | T30 | Arrow from T30 | ✅ Match |
| T32 | T30 | Arrow from T30 | ✅ Match |
| T33 | T30 | Arrow from T30 | ✅ Match |
| T34 | T30 | Arrow from T30 | ✅ Match |
| T35 | T30 | Arrow from T30 | ✅ Match |
| T36 | T30 | Arrow from T30 | ✅ Match |
| T37 | T36 | Arrow from T36 | ✅ Match |
| T38 | T37 | Arrow from T37 | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T01 | Characterization test | unit | unit (characterization) | ✅ OK |
| T02 | Characterization test | unit | unit (characterization) | ✅ OK |
| T03 | Characterization test | unit | unit (characterization) | ✅ OK |
| T04 | Characterization test | unit | unit (characterization) | ✅ OK |
| T05 | commit only | none | none | ✅ OK |
| T06 | Service module | unit | unit | ✅ OK |
| T07 | Service module | unit | unit | ✅ OK |
| T08 | Service module | unit | unit | ✅ OK |
| T09 | Service modules | unit | unit | ✅ OK |
| T10 | commit only | none | none | ✅ OK |
| T11 | Config/defs module | unit | unit (characterization) | ✅ OK |
| T12 | Config/defs modules | unit | unit | ✅ OK |
| T13 | Service modules | unit | unit | ✅ OK |
| T14 | Service modules | unit | unit | ✅ OK |
| T15 | Service modules | unit | unit | ✅ OK |
| T16 | Service modules | unit | unit | ✅ OK |
| T17 | commit only | none | none | ✅ OK |
| T18 | MCP client module | unit | unit | ✅ OK |
| T19 | MCP client wiring | unit | unit | ✅ OK |
| T20 | Hook binary | unit | unit | ✅ OK |
| T21 | Hook binary tests + config | unit | unit | ✅ OK |
| T22 | commit only | none | none | ✅ OK |
| T23 | Script | unit | unit | ✅ OK |
| T24 | Script | unit | unit | ✅ OK |
| T25 | Fixtures | none | none | ✅ OK |
| T26 | Test-seam tests | unit | unit | ✅ OK |
| T27 | API routes | integration | integration | ✅ OK |
| T28 | UI | integration | integration | ✅ OK |
| T29 | Scheduler config | unit | unit | ✅ OK |
| T30 | commit only | none | none | ✅ OK |
| T31 | Docs | none | none | ✅ OK |
| T32 | Script | unit | unit | ✅ OK |
| T33 | Middleware | unit | unit | ✅ OK |
| T34 | Docs + CLI | unit | unit | ✅ OK |
| T35 | Service + serialize | unit | unit | ✅ OK |
| T36 | Probe + docs | none | none | ✅ OK |
| T37 | commit only | none | none | ✅ OK |
| T38 | Validation | all | all | ✅ OK |