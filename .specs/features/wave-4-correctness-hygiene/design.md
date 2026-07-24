# Wave 4 — Correctness, Hygiene, and Spec Reconciliation Design

**Spec**: `.specs/features/wave-4-correctness-hygiene/spec.md` (sha256 `109f4313...`)
**Status**: Draft
**Baseline commit**: `f3d802098215c0dd9cbfcd8374605484f9a8a5b2` on `main`

---

## Active Decision Conformance (STATE.md `## Decisions`)

The active project decisions most relevant to this design are:

- **AD-001** (active): structural parsing uses pinned native Tree-sitter grammars; no
  runtime-download or WASM fallback. → N34 path-filtered CI gate must run
  `verify:tree-sitter-native`, not introduce new grammar sources.
- **AD-006** (active): process-global FIFO parser pool, capacity 4/max 32, timeout
  5s/max 60s. → N9 read_file cap does NOT touch the parser pool; it is a pure
  post-read line ceiling.
- **sqlite-removal invariant** (STATE.md:13): "sqlite-removal stays in_progress." →
  M29 flips this to `complete` and adds a new `sqlite-removal-followup` feature; this
  is the one STATE invariant this feature intentionally supersedes. The new
  `sqlite-removal-followup` feature inherits the 3 non-gating follow-ups.

No other `AD-NNN` is superseded by this design. N36's `xdg.ts` extraction removes a
circular-dep *workaround* but does not change any active decision; it is a pure
refactor behind a byte-identical facade.

---

## Architecture Overview

Wave 4 is a coordinated set of surgical edits across 9 components. There is no new
service or module-level abstraction — each item touches existing code at a known
location. The design's job is to fix the interfaces and reuse points so the tasks
can execute without inventing architecture.

```mermaid
graph TD
    Client[Agent / MCP Client]
    subgraph ToolLayer[Tool Handler Layer]
        RH[read_file.ts]
        IA[impact_analysis.ts]
        TP[trace_path.ts]
        GR[get_references.ts]
        SD[search_definitions.ts]
        SC[search_code.ts]
        AN[get_analytics.ts]
    end
    subgraph ServiceLayer[Service Layer]
        IAS[ImpactAnalysisService]
        TPS[TracePathService]
        SGS[SymbolGraphService]
        RLM[ContextualSearchRLM]
    end
    subgraph Shared[Shared Config]
        XDG[xdg.ts NEW]
        CL[config-loader.ts]
        MC[massa-ai-config.ts]
    end
    subgraph DataLayer[Data Layer]
        SR[symbol-repository-pg.ts]
        VSC[postgres-vector-store.ts]
        KS[keyword-search-pg.ts]
    end
    subgraph Tests[Tests + CI]
        W4T[wave-4-*.test.ts NEW]
        SSP[scheduler-store-pg.test.ts]
        CI[ci.yml]
    end

    Client --> ToolLayer
    ToolLayer --> ServiceLayer
    ToolLayer --> Shared: N6 enum validation
    ServiceLayer --> DataLayer
    ToolLayer --> W4T: N1/N4/N7/N8/N9 assertions
    Shared --> XDG: N36
    CI --> CI: N34 path-filter
```

The design decomposes into 7 components, one per spec section:

1. **Enum validation helper** (N6) — a shared `validateEnum()` used by every tool
   handler.
2. **Total/omitted invariant** (N4) — per-tool `*_total`/`*_shown`/`*_omitted` fields.
3. **Three-source diff + secrets denylist** (N7) — `defaultDiffRunner` extension.
4. **Shell-arg guard** (N8) — `validateGitRef()` before `execFileSync`.
5. **read_file cap + source_clipped** (N9) — env-driven line ceiling.
6. **Generation staleness precondition** (N1) — `activatedGraphGenerationId` +
   `ifNoneMatch` on graph-reader tools.
7. **Hygiene bundle** (M35, N10, M29, N25, N33, N34, N36) — test seam, regression
   test, doc reconciliation, dead code, CI gate, xdg.ts.

---

## Large/Complex Approach Tradeoffs

The spec-driven policy requires 2–3 viable approaches for Large/Complex work. The
overall shape of Wave 4 is fixed (surgical edits at known locations), but one
cross-cutting decision has plausible alternatives: **where to centralize the N4
total/omitted invariant and the N6 enum validation**.

### Approach A — Per-tool emission, shared helpers (RECOMMENDED)

- N4: each tool handler emits `*_total`/`*_shown`/`*_omitted` fields directly
  (matches the existing `get_references`/`memory_list` convention; the
  `serialize.ts:7-17` contract explicitly disclaims owning totals).
- N6: a shared `validateEnum(param, value, validValues)` helper in
  `packages/core/src/tools/enum-validation.ts` (new file, ~20 LOC) called at the
  top of each tool's `handle()`. Returns the validated value or throws `ToolError`
  with the valid-values list.
- N1: each graph-reader tool handler calls a shared `getActiveGeneration(projectId)`
  helper (in symbol-graph.service or workspace-manager) and surfaces it; the
  `ifNoneMatch` precondition check is a 5-line guard at the top of each handler.

**Pros**: Matches existing convention. No facade changes. Each tool owns its
contract. Reuse via small helpers, not a centralized response wrapper. Lowest
risk of regressing the byte-identical M14 god-files-refactor facades.
**Cons**: 6 tool handlers each get ~5 lines of boilerplate. Slight duplication of
the `ifNoneMatch` guard.

### Approach B — Centralized `serializeToolResponse` extension

- Extend `serializeToolResponse` to accept a `counts` option and auto-emit
  `*_total`/`*_shown`/`*_omitted`. Extend it to validate enum params from a schema.
- N1: add `activatedGraphGenerationId` + `ifNoneMatch` handling in the serializer.

**Pros**: Single choke point. Less per-tool boilerplate.
**Cons**: Violates the M36 contract documented at `serialize.ts:7-17` ("Defaults are
resolved by the CALLING tool and passed in as literals; this helper never picks a
default"). Centralizing enum validation in the serializer couples response shaping
to input validation. Higher risk of regressing the 12 existing tools that call
`serializeToolResponse`. Rejected.

### Approach C — Decorator/middleware layer

- A `@validateEnum` decorator or a middleware wrapping each tool handler.

**Cons**: TypeScript decorators on class methods add transpile config surface area
the repo does not use today. Middleware would require a tool-handler pipeline the
repo does not have. Both introduce a new architectural pattern for 6 call sites.
Rejected as over-engineering.

**Chosen: Approach A** — per-tool emission + shared helpers. User confirmation is
not required for an internal-architecture choice at this layer (no public
contract implication); the choice is recorded here per the design.md template.

---

## Code Reuse Analysis

### Existing components to leverage

| Component | Location | How to use |
| --- | --- | --- |
| `get_analytics` teaching-error precedent | `packages/core/src/tools/get_analytics.ts:109-114` | Extend the `default: return {success: false, error: ...}` pattern to throw `ToolError` with a valid-values list. N6. |
| `get_references` total/shown precedent | `packages/core/src/tools/get_references.ts:73-74`, `apps/tools-api/src/routes/workspace.ts:299-300` | Reuse the `total: refs.length` / `shown: limited.length` pattern; add `omitted: total - shown` on the same path. N4. |
| `memory_list` total/offset precedent | `apps/tools-api/src/routes/memory.ts:267-272` | Same-path `total`/`rows` pattern. N4. |
| `defaultDiffRunner` | `packages/core/src/services/symbol/impact-analysis.ts:447-509` | Extend with `git ls-files --others --exclude-standard` merge + secrets denylist. N7. |
| `boundedInt` | `apps/tools-api/src/routes/workspace.ts:40-53` | Reuse for `MASSA_AI_READ_FILE_MAX_LINES` env parse + bounds. N9. |
| `FILE_CACHE_MAX_ENTRIES` pattern | `packages/core/src/tools/read_file.ts:140` | Reuse the env-read + default pattern for `MASSA_AI_READ_FILE_MAX_LINES`. N9. |
| `activatedGraphGenerationId` emitter | `packages/core/src/services/symbol/symbol-graph.service.ts:455` | Extract the lookup into a reusable `getActiveGeneration(projectId)` helper; call from graph-reader tools. N1. |
| `ActiveGenerationScope` | `packages/core/src/data/symbol/symbol-repository-pg.ts:181-184, 1635-1642` | Already returns `{projectId, generationId}`. N1 helper wraps it. |
| `describe.skipIf(!DB_AVAILABLE)` gate | `packages/core/src/__tests__/scheduler-store-pg.test.ts:8,51` | Preserve. Add instance-scoped seam. M35. |
| `verify:tree-sitter-native` script | `package.json:35` | Already exists. N34 wires it into the main `build` job with a path filter. |
| `dorny/paths-filter@v3` | (GitHub Actions marketplace) | Standard path-filter action for conditional CI steps. N34. If unavailable, fall back to `git diff --name-only origin/main...HEAD` in a shell step. |
| `LANGUAGE_MANIFEST` + `StubParser` pattern | `packages/core/src/__tests__/etl-cache-invalidation.test.ts:23-38` | Already used by 3 test groups. M35 mirrors the instance-scoped seam pattern. |
| `logger` | `packages/shared/src/utils/logger.ts` | Replace `console.error` (N33) and bare `catch {}` (N33) with `logger.error`/`logger.warn`. |
| `normalizeRRFScores` (batch) | `packages/core/src/data/vector/hybrid-search.ts:140` | Already the live path; N33 removes the dead singular `normalizeRRFScore` at :152-158. |

### Integration points

| System | Integration method |
| --- | --- |
| MCP `tools/call` | Additive response fields (`*_total`, `activatedGraphGenerationId`, `source_clipped`, `untracked_filtered`) — existing clients tolerant. |
| HTTP `/api/v1/symbol/*` routes | Mirror the tool-handler response fields in `apps/tools-api/src/routes/workspace.ts`. |
| CI workflow `.github/workflows/ci.yml` | Add a path-filtered `verify:tree-sitter-native` step in the `build` job; keep `structural-native-linux` job unchanged. |
| `.specs/project/FEATURES.json` | M29 flips `sqlite-removal` to `complete`, adds `sqlite-removal-followup`. |
| `.specs/features/phase-*/validation.md` | N25 edits 3 accepted-assumption rows. |

---

## Components

### 1. Enum validation helper (N6)

- **Purpose**: Validate enum/finite-set tool params with a teaching error listing
  valid values, replacing silent fallbacks.
- **Location**: `packages/core/src/tools/enum-validation.ts` (NEW, ~25 LOC)
- **Interfaces**:
  ```typescript
  export class ToolError extends Error {
    constructor(message: string, readonly statusCode: number = 400) {}
  }
  export function validateEnum<T extends string>(
    paramName: string,
    value: unknown,
    validValues: readonly T[],
  ): T {
    if (typeof value !== "string" || !validValues.includes(value as T)) {
      throw new ToolError(
        `Invalid ${paramName} value: ${String(value)}. Valid values: ${validValues.join(", ")}.`,
      );
    }
    return value as T;
  }
  ```
- **Dependencies**: none.
- **Reuses**: extends `get_analytics.ts:109-114` pattern with a valid-values list.
- **Call sites** (added in each tool's `handle()`):
  - `impact_analysis.ts:103` — `scope` ∈ unstaged|staged|committed|all
  - `trace_path.ts:113` — `direction` ∈ outbound|inbound|both; `mode` ∈ calls|data_flow|cross_service|all
  - `get_analytics.ts:52` — `type` ∈ summary|project|query|cache|recent (migrate from `default:` to `validateEnum`)
  - `list_projects.ts:33` — `status` ∈ pending|indexing|indexed|error|all
  - `search_definitions.ts:63` — `kind` ∈ STRUCTURAL_SYMBOL_KINDS (18)
  - `create_checkpoint.ts:208` — `checkpointType` ∈ manual|milestone (replace silent coerce)
  - `create_checkpoint.ts:181` — `status` ∈ pending|in_progress|completed|failed|paused
  - `execute`/`execute_file` — `language` ∈ the 10 languages
  - `compress_context.ts:67` — `strategy` ∈ code_structure|conversation_summary|semantic_dedup|hierarchical
  - `responseMode` (search) — `summary|full|enriched`
  - `format` params — `json|toon` (validation only; no behavior change)

### 2. Total/omitted invariant (N4)

- **Purpose**: Every clamped tool list emits `*_total`, `*_shown`, `*_omitted` on
  the same code path as the displayed list.
- **Location**: per-tool handler + per-route handler.
- **Interfaces**: additive response fields. No new helper module (per Approach A).
- **Reuses**: `get_references` and `memory_list` patterns.
- **Changes per tool**:
  - `impact_analysis.ts:347-356` — track pre-clamp `impactedTotal` (increment in `addImpact` even when over the cap, OR count before the final `slice`); emit `impacted_total`/`impacted_shown`/`impacted_omitted`. Also surface `untracked_filtered` (N7 tie-in).
  - `trace-path.ts:287-311` — track pre-clamp `nodesTotal` (count before MAX_NODES cap); emit `nodes_total`/`nodes_shown`/`nodes_omitted`.
  - `search-code.ts` + `search-controller.ts:283-301` — add `results_total` (pre-pattern-filter, pre-slice count) + `results_shown` + `results_omitted`.
  - `search_definitions` SQL — add `COUNT(*) OVER()` OR a separate `SELECT COUNT(*)` OR a sentinel for >100k (per AC 4). Emit `definitions_total`/`definitions_shown`/`definitions_omitted` (+ `definitions_total_exact` if sentinel).
  - `get_references` — add `omitted: total - shown` alongside existing `total`/`shown`.
  - HTTP routes mirror each.

### 3. Three-source diff + secrets denylist (N7)

- **Purpose**: `defaultDiffRunner` merges committed + unstaged + untracked new files
  with dedup; excludes secret-like untracked paths.
- **Location**: `packages/core/src/services/symbol/impact-analysis.ts:447-509`.
- **Interfaces**: `defaultDiffRunner(projectPath, scope, baseBranch?, since?)` signature unchanged; returns `string[]` of deduped paths; additionally returns `untrackedFiltered: number` via an out-param object OR the function returns `{ paths: string[]; untrackedFiltered: number }` (BREAKING internal shape — but only one caller, `ImpactAnalysisService.analyze:168`).
- **Reuses**: existing `execFileSync("git", ...)` safe-argv pattern.
- **Logic**:
  ```typescript
  const SECRET_PATTERNS = [/\.env/i, /\.key$/i, /\.pem$/i, /\.p12$/i, /\.pfx$/i,
    /^secrets?\./i, /\.keystore$/i, /^id_rsa/i, /\.asc$/i];
  // 1. git diff --name-only --diff-filter=d (existing, per scope)
  // 2. if scope in [unstaged, staged, all]: git ls-files --others --exclude-standard
  //    if scope === committed: no untracked (committed is single-source)
  // 3. filter untracked paths against SECRET_PATTERNS; increment untrackedFiltered
  // 4. dedup via Set<string>
  ```
- **Breaking default change**: `scope=unstaged` (default) now includes untracked.
  Document in HANDOFF.md at feature close.

### 4. Shell-arg guard (N8)

- **Purpose**: Reject `base_branch`/`since` matching git arg-injection or shell
  metacharacters before running git.
- **Location**: `packages/core/src/services/symbol/impact-analysis.ts` — new
  `validateGitRef()` function called at the top of `defaultDiffRunner` before any
  `execFileSync`.
- **Interfaces**:
  ```typescript
  const GIT_REF_PATTERN = /^[A-Za-z0-9._\/+-]+$/;
  export function validateGitRef(paramName: string, value: string): void {
    if (value.startsWith("--") || !GIT_REF_PATTERN.test(value)) {
      throw new ToolError(
        `Invalid ${paramName} value: ${value}. Valid pattern: alphanumeric, -, /, ., _, +.`
      );
    }
  }
  ```
- **Reuses**: the `ToolError` class from component 1.
- **Call sites**: `baseBranch` (line 457) and `since` (line 462) before resolution.

### 5. read_file cap + source_clipped (N9)

- **Purpose**: Cap user-facing read_file/snippet at `MASSA_AI_READ_FILE_MAX_LINES`
  (default 500); emit `source_clipped` when hit. Internal enrichment excluded.
- **Location**: `packages/core/src/tools/read_file.ts` (cap + flag),
  `apps/tools-api/src/routes/workspace.ts:619-678` (symbol_snippet HTTP — replace
  `start+10_000` with the env cap), `packages/core/src/services/symbol/symbol-graph.service.ts:619-654`
  (readSnippet/readContext — EXCLUDED from cap per AC 15).
- **Interfaces**:
  ```typescript
  const MAX_LINES = (() => {
    const v = Number(process.env.MASSA_AI_READ_FILE_MAX_LINES);
    return Number.isFinite(v) && v > 0 ? Math.floor(v) : 500;
  })();
  // In ReadFileTool.handle, after adjustRange:
  // if (selectedLineCount > MAX_LINES) { selectedContent = slice(0, MAX_LINES); source_clipped = true; }
  // include totalLines in response so omitted is derivable
  ```
- **Reuses**: `boundedInt` pattern for the env parse.
- **Critical exclusion**: `SymbolGraphService.readSnippet`/`readContext` (internal
  enrichment for `go_to_definition`) MUST NOT apply the cap — these read small
  bounded windows (3-line context, top-3 definitions) and have no propagation path
  to the MCP response. Per AC 15.

### 6. Generation staleness precondition (N1)

- **Purpose**: Surface `activatedGraphGenerationId` on graph-reader tools + opt-in
  `ifNoneMatch` precondition that teaching-errors on stale generation.
- **Location**: new helper `packages/core/src/services/symbol/active-generation.ts`
  (NEW, ~30 LOC) wrapping `symbolRepository.getActiveGenerationScope(projectId)`
  (`symbol-repository-pg.ts:1635-1642`). Called from `impact_analysis.ts`,
  `trace_path.ts`, `get_references.ts`, `search_definitions.ts` tool handlers.
- **Interfaces**:
  ```typescript
  export async function getActiveGeneration(projectId: string): Promise<string | null> {
    const scope = await symbolRepository.getActiveGenerationScope(projectId);
    return scope?.generationId ?? null;
  }
  export function assertGenerationNotStale(
    ifNoneMatch: string | undefined,
    current: string | null,
  ): void {
    if (!ifNoneMatch) return;
    if (current === null) {
      throw new ToolError("No active generation: index the project before querying.", 412);
    }
    if (ifNoneMatch !== current) {
      throw new ToolError(
        `Stale generation: client held ${ifNoneMatch}, current is ${current}. Re-read the project map before retrying.`,
        412,
      );
    }
  }
  ```
- **Reuses**: existing `getActiveGenerationScope` + `activatedGraphGenerationId`
  already exposed in `project_map` (`symbol-graph.service.ts:455`).
- **Exclusion**: `search_code` does NOT call this (vector + keyword search is
  graph-independent). `search_definitions` DOES call it (it reads the symbol graph).
- **Tool changes**: each of the 4 graph-reader tool handlers adds:
  ```typescript
  const currentGen = await getActiveGeneration(projectId);
  assertGenerationNotStale(params.ifNoneMatch, currentGen);
  // ... existing work ...
  return { ...result, activatedGraphGenerationId: currentGen };
  ```
- **MCP schema**: add optional `ifNoneMatch: string` param to the 4 graph-reader
  tool definitions in `apps/mcp-client/src/tool-definitions.ts`. `search_code` does
  NOT get the param.

### 7. Hygiene bundle (M35, N10, M29, N25, N33, N34, N36)

#### 7a. M35 scheduler-store-pg test seam

- **Purpose**: Filter `scheduled-*` rows from `storeB.listAll()` for the duration
  of the test, instance-scoped, restored in `afterEach`.
- **Location**: `packages/core/src/__tests__/scheduler-store-pg.test.ts`.
- **Mechanism**: instance-scoped override of `storeB.listAll`:
  ```typescript
  const originalListAll = storeB.listAll.bind(storeB);
  storeB.listAll = function () {
    return originalListAll().filter((e) => !e.id.startsWith("scheduled-"));
  };
  // ... test body ...
  // afterEach: storeB.listAll = originalListAll; (or recreate storeB)
  ```
  This does NOT modify the `PgScheduledJobStore` class or the global SQL. The
  `scheduled-*` rows stay in the DB; the test's view of `storeB` is filtered. A
  follow-up `listAll()` call after restore returns the full set (AC 5).
- **Reuses**: the 3 already-fixed test groups' mock-seam pattern.

#### 7b. N10 SQL bounds regression test

- **Purpose**: Assert the 3 bounded placeholder builders stay bounded.
- **Location**: `packages/core/src/__tests__/wave-4-sql-bounds.test.ts` (NEW).
- **Tests**:
  - Phase 2 rerank: feed >200 candidate ids → assert SQL `LIMIT 200` clamps.
  - `findEdges` types: feed >9 ref kinds → assert only the valid enum values are used.
  - `populateVocabulary` VALUES: feed >5000 words → assert chunked at 5000.
  - `grep -r "snprintf\|sprintf" packages/` returns zero (TS has no C fixed buffers).

#### 7c. M29 sqlite-removal close + followup split

- **Purpose**: Flip `sqlite-removal` to `complete`; add `sqlite-removal-followup`
  feature carrying the 3 non-gating follow-ups.
- **Location**: `.specs/project/FEATURES.json` (status flip + new entry),
  `.specs/features/sqlite-removal-followup/` (NEW — `spec.md` + `tasks.md` listing
  the 3 follow-ups from `sqlite-removal/validation.md:37-39`).

#### 7d. N25 stale doc reconciliation

- **Purpose**: Update Phase-1/5/6 `validation.md` "PG parity deferred" rows.
- **Location**: `.specs/features/phase-1-memory-foundation/validation.md:63,67,136-141`,
  `.specs/features/phase-5-auto-improve/validation.md:60,162-165`,
  `.specs/features/phase-6-handoffs/validation.md:52,143-147`.
- **Change**: replace "PG parity deferred" with "PG schema parity delivered via
  migration `<name>`; runtime `<Pg*Store>` may still be deferred but schema is done."

#### 7e. N33 dead code sweep

- **Purpose**: Remove deprecated `normalizeRRFScore`, route `metrics.ts`
  `console.error` through logger, replace two bare `catch {}` in
  `session-registry.ts` with `logger.warn`.
- **Location**:
  - `packages/core/src/data/vector/hybrid-search.ts:152-158` (delete the singular
    `normalizeRRFScore`; confirm zero callers via grep before deletion).
  - `packages/core/src/services/monitoring/metrics.ts:443` — replace
    `console.error("[Metrics] Failed to save:", error)` with
    `logger.error("[Metrics] Failed to save:", error)` (add `logger` import if missing).
  - `packages/core/src/services/synapse/session/session-registry.ts:76` and `:92-94`
    — replace `catch { /* store swallows + warns */ }` with
    `catch (error) { logger.warn("[SessionRegistry] store <op> failed:", error); }`.
- **Keep**: `relation-extractor.ts:44` `"deprecated"` literal (functional keyword
  data, audit confirmed).

#### 7f. N34 grammar CI gate

- **Purpose**: Path-filtered `verify:tree-sitter-native` in the main `build` job.
- **Location**: `.github/workflows/ci.yml` — add a `grammar-integrity` job (or a
  step in `build`) using `dorny/paths-filter@v3` to detect changes to
  `packages/core/src/services/structural/**`, `bun.lock`, `package.json`. If
  matched, run `bun run verify:tree-sitter-native`. Gate the job on it.
- **Keep**: the existing `structural-native-linux` job (`ci.yml:192-239`) runs
  `verify:tree-sitter-native` on every PR — leave unchanged (no regression).

#### 7g. N36 xdg.ts extraction

- **Purpose**: Pure `xdg.ts` (zero imports) that both config files import.
- **Location**: `packages/shared/src/config/xdg.ts` (NEW).
- **Interfaces**:
  ```typescript
  // ZERO imports. Pure functions over process.env + os + path.
  export function xdgConfigHome(): string { /* XDG_CONFIG_HOME || ~/.config */ }
  export function xdgDataHome(): string { /* XDG_DATA_HOME || ~/.local/share */ }
  export function xdgCacheHome(): string { /* XDG_CACHE_HOME || ~/.cache */ }
  export function xdgRuntimeDir(): string { /* XDG_RUNTIME_HOME || /run/user/<uid> */ }
  export function xdgStateHome(): string { /* XDG_STATE_HOME || ~/.local/state */ }
  export function configDir(app: string): string { return path.join(xdgConfigHome(), app); }
  export function dataDir(app: string): string { return path.join(xdgDataHome(), app); }
  export function cacheDir(app: string): string { return path.join(xdgCacheHome(), app); }
  ```
- **Changes**:
  - `config-loader.ts:6-11` — replace inlined `XDG_CONFIG_HOME` with
    `import { configDir } from "./xdg.js"; const CONFIG_DIR = configDir("massa-ai");`.
  - `massa-ai-config.ts:4-11` — replace inlined `XDG_CONFIG_HOME` + circular-dep
    comment with `import { xdgConfigHome, dataDir } from "./xdg.js";`.
  - `massa-ai-config.ts:209` — `dataDir: dataDir("massa-ai")` instead of
    `path.join(XDG_CONFIG_HOME, "massa-ai", "data")`.
- **Zero-imports guarantee**: `xdg.ts` imports nothing (uses `process.env`, `os`,
  `path` — all Node builtins available without `import`? No — `os` and `path`
  require `import`). **Refinement**: "zero imports" in the M6 residual means "no
  imports from the project's own modules" (i.e. no circular-dep source). The module
  MAY import Node builtins (`path`, `os`). The circular-dep was
  `config-loader ↔ massa-ai-config`; `xdg.ts` imports neither, so the cycle is
  broken. Record this refinement in the N36 task.

---

## Data Models

No new persisted state. All N4/N1/N9 fields are computed at request time and
returned in the response. No migration. No schema change.

The only persisted-state change is M29's `FEATURES.json` status flip (a `.specs/`
artifact, not a DB migration).

---

## Error Handling Strategy

| Error scenario | Handling | User impact |
| --- | --- | --- |
| Invalid enum param (N6) | `throw new ToolError("Invalid <param> value: <v>. Valid values: <list>.")` at tool handler | HTTP 400; MCP `isError: true` with the teaching message. Client learns valid values. |
| Stale `ifNoneMatch` (N1) | `throw new ToolError("Stale generation...", 412)` | HTTP 412; client re-reads project_map, retries. |
| No active generation + `ifNoneMatch` (N1) | `throw new ToolError("No active generation: index the project before querying.", 412)` | HTTP 412; client indexes first. |
| Invalid git ref (N8) | `throw new ToolError("Invalid <param> value: <v>. Valid pattern: ...")` before `execFileSync` | HTTP 400; client corrects the ref. No git invocation. |
| `read_file` cap hit (N9) | Return `source_clipped: true` + true total | Client sees the flag, follows up with `lineStart`/`lineEnd` for the rest. NOT an error. |
| `git ls-files` fails (N7) | `defaultDiffRunner` throws → `ImpactAnalysisService.analyze` catches → tool returns `success: false` | Existing behavior; no change. |
| `xdg.ts` missing (N36) | N/A — it is a new file; if missing, `import` fails at build time | Build fails loudly. |
| Scheduler seam not restored (M35) | `afterEach` runs `storeB.listAll = originalListAll`; follow-up `listAll()` test proves restoration | If `afterEach` is skipped (test crash), the follow-up assertion catches it. |

---

## Risks & Concerns

| Concern | Location (file:line) | Impact | Mitigation |
| --- | --- | --- | --- |
| N7 breaking default change on `scope=unstaged` | `impact-analysis.ts:497` | Existing callers receive untracked files in the default scope | Documented in HANDOFF.md; AC 9a filters secrets; `scope=committed` stays single-source for callers that want the old behavior. |
| N9 cap too aggressive for large-file workflows | `read_file.ts:378` | Clients reading >500-line files get clipped | `MASSA_AI_READ_FILE_MAX_LINES` env override; default 500 matches cbm. |
| N1 `ifNoneMatch` adoption cost | (new param) | Existing clients do not send it; no effect (opt-in) | Opt-in by design; clients that want the precondition add the param. |
| N4 `COUNT(*) OVER()` perf on >100k workspaces | `symbol-repository-pg.ts:881` | Latency regression on `search_definitions` | AC 4 allows `SELECT COUNT(*)` or sentinel `">=10000"` with `definitions_total_exact: false`. Task picks the cheaper path per workspace size. |
| N6 throws on invalid enums — existing clients passing bad values break | (6 tool handlers) | Silent fallback → hard error | This is the intended behavior (teaching error). Document in HANDOFF.md. |
| M35 seam leak if test crashes before `afterEach` | `scheduler-store-pg.test.ts` | Other tests receive filtered `listAll()` | AC 5 follow-up `listAll()` assertion catches it; instance-scoped (not class/global). |
| N36 `xdg.ts` zero-imports interpretation | (new file) | If "zero imports" is read literally, Node builtins are forbidden — impossible | Record refinement: "zero imports from project modules; Node builtins allowed." Circular-dep was `config-loader ↔ massa-ai-config`; `xdg.ts` imports neither. |
| N34 path-filter action availability | `.github/workflows/ci.yml` | `dorny/paths-filter@v3` may be unavailable | Fallback: shell step `git diff --name-only origin/main...HEAD -- packages/core/src/services/structural bun.lock package.json` → `if [ -n "$changed" ]; then bun run verify:tree-sitter-native; fi`. |
| N10 regression test brittle to refactor | (new test) | A future refactor of `postgres-vector-store` could break the test | Test asserts the bounded contract (LIMIT 200), not the implementation. |
| N33 `normalizeRRFScore` removal if a dynamic caller exists | `hybrid-search.ts:152` | Removing a live method breaks the caller | Task greps for `normalizeRRFScore\b` (singular, word boundary) before deletion; audit already confirmed zero callers. |

---

## Tech Decisions

| Decision | Choice | Rationale |
| --- | --- | --- |
| N4/N6/N1 centralization | Per-tool emission + shared helpers (Approach A) | Matches existing convention; M36 contract on `serializeToolResponse` preserved; lowest regression risk. |
| N7 untracked inclusion | `scope=unstaged` (default) + `staged` + `all` include untracked; `committed` stays single-source | Matches cbm; `committed` preserves the old single-source escape hatch. |
| N7 secrets denylist | Fixed regex patterns (`*.env`, `*.key`, `*.pem`, `*.p12`, `*.pfx`, `secrets.*`, `*.keystore`, `id_rsa*`, `*.asc`) | Conservative; does NOT rely on `.gitignore` (user may forget). `untracked_filtered` count surfaces the filter. |
| N9 cap default | 500 (matches cbm); env override `MASSA_AI_READ_FILE_MAX_LINES` | Conservative default + escape hatch for power users. |
| N9 enrichment exclusion | `SymbolGraphService.readSnippet`/`readContext` NOT capped | Internal enrichment has no MCP propagation path; capping would silently clip. |
| N1 scope | `impact_analysis`, `trace_path`, `get_references`, `search_definitions` only; `search_code` excluded | Vector + keyword search is graph-independent; avoid coupling + a DB round trip on the hot search path. |
| N34 path filter | `dorny/paths-filter@v3` with shell fallback | Standard action; fallback avoids hard dep. |
| N36 `xdg.ts` imports | Node builtins (`path`, `os`) allowed; zero project-module imports | The circular-dep was intra-project; builtins are not in the cycle. |

> **Project-level decisions**: None of these set a new project-wide convention
> beyond Wave 4. The N1 `ifNoneMatch` pattern MAY be reused by future tools that
> read graph state; if so, the helper at `active-generation.ts` becomes the
> canonical source. No `AD-NNN` supersession is required for this feature.

---

## Verification Design

| High-risk requirement | How tests prove it |
| --- | --- |
| N1 stale generation | `wave-4-generation-staleness.test.ts`: mutate `active_graph_generation_id` → `ifNoneMatch` throws 412; omit → no throw; `search_code` never includes the field; vector-only workspace → `impact_analysis` returns `activatedGraphGenerationId: null`. |
| N4 total/omitted | `wave-4-correctness.test.ts`: clamp at MAX_IMPACTED=100, feed 150 symbols → `impacted_total=150, impacted_shown=100, impacted_omitted=50`. Same for trace_path nodes, search_code results, search_definitions (with COUNT(*) OVER() or sentinel), get_references. |
| N6 teaching errors | `wave-4-correctness.test.ts`: call each tool with an invalid enum → assert `ToolError` with valid-values list in the message. |
| N7 untracked merge + denylist | `wave-4-correctness.test.ts`: create an untracked file + an untracked `.env` → `scope=unstaged` includes the untracked non-secret, excludes `.env`, increments `untracked_filtered`. |
| N8 shell-arg guard | `wave-4-correctness.test.ts`: call `impact_analysis` with `base_branch="--upload-pack=..."` → `ToolError` thrown, no git invocation (assert via a mock `execFileSync`). |
| N9 read_file cap | `wave-4-correctness.test.ts`: 1000-line file, `read_file` with no range → returns 500 lines + `source_clipped: true` + total=1000. `MASSA_AI_READ_FILE_MAX_LINES=1000` → returns 1000. `go_to_definition` on a 1000-line symbol → `readContext` returns full context (NOT capped). |
| M35 scheduler seam | `scheduler-store-pg.test.ts`: existing `storeB.listAll()` assertion passes; new follow-up test asserts `listAll()` after `afterEach` returns the full set. |
| N34 CI gate | Open a PR touching `packages/core/src/services/structural/parse.ts` → `bun run verify:tree-sitter-native` runs. Open a PR touching only `README.md` → step skipped. (Verified via the workflow's `if:` condition, not a live PR run.) |
| N36 xdg.ts | `grep -n "XDG_CONFIG_HOME" packages/shared/src/config/` returns matches only in `xdg.ts`. `bun run typecheck && bun run build` pass. Existing config tests pass unchanged. |

**Discrimination sensor (run by the independent verifier)**: for each AC, the
verifier injects a behavior-level fault (removes the cap, drops the teaching error,
drops the untracked merge, removes the xdg.ts import, mutates the generation id) and
confirms the corresponding test fails. Mutations are reverted before the next test.

---

## Artifact Store Evidence

- **Active artifact key:** `.specs/features/wave-4-correctness-hygiene/design.md`
- **Version:** 1 (initial write)
- **Checksum:** to be computed after write (sha256)

---

## Done Criteria

Design is done when:
- All 7 components have a location, interface, and reuse plan.
- Approach A is chosen and recorded (Approaches B/C rejected with rationale).
- Every risk has a mitigation.
- Every high-risk requirement has a verification path.
- Active decisions (AD-001, AD-006, sqlite-removal invariant) are conformed to or
  explicitly superseded (M29).
- N36 "zero imports" interpretation is refined (Node builtins allowed, zero
  project-module imports).
- N9 internal-enrichment exclusion is explicit (AC 15).
- N1 `search_code` exclusion is explicit (AC 7).
- N7 breaking-default + secrets denylist is explicit (AC 7, AC 9a).
- M35 seam is instance-scoped + `afterEach` restored (AC 2, AC 5).
- N4 perf is addressed (AC 4 allows sentinel).