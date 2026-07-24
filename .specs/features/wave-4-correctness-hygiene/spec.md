# Wave 4 — Correctness, Hygiene, and Spec Reconciliation

## Problem Statement

Wave 3 closed the native runtime re-baseline. The v3 improvement plan surfaced a
delta of correctness and hygiene issues carried over from cbm (codebase-memory-mcp)
and ai-memory sibling repos, plus self-reported gaps. These are "audit, then fix if
present" items: cbm's bugs were cbm-shaped, so each item requires a verify-then-fix
pass against current massa-ai source before scoping a fix. Five parallel read-only
investigations confirmed the actual shape of every item.

This feature closes Wave 4 by shipping the correctness bundle (N1, N4, N6–N10), the
shared-DB fixture gap (M35), the spec reconciliation (M29, N25), the dead code sweep
(N33), and the two residual architecture/process items (N34, N36). N24 (Linux native
unblock) is already done. N22 (skill/doc mismatch) is deferred until the user finishes
massa-ai implementation work and is explicitly out of scope here.

## Goals

- [ ] Every clamped tool list emits a true pre-clamp total and a derivable omitted count
      on the same code path as the displayed list (N4).
- [ ] Every enum/finite-set tool param rejects invalid values with a teaching error that
      lists the valid values (N6).
- [ ] `impact_analysis` default diff runner merges committed + unstaged + untracked new
      files with dedup (N7).
- [ ] `impact_analysis` validates `base_branch`/`since` against shell/git arg-injection
      before running git (N8).
- [ ] `read_file` caps returned lines at a configurable max (default 500) and emits
      `source_clipped` when the cap is hit (N9).
- [ ] Graph-dependent clamped tools surface `activatedGraphGenerationId` and accept an
      optional `ifNoneMatch` precondition that teaching-errors on stale generation (N1).
- [ ] `scheduler-store-pg.test.ts` no longer fails against a shared DB polluted with the 4
      real `scheduled-*` default rows (M35).
- [ ] `sqlite-removal` feature status reconciled with reality (M29).
- [ ] Phase-1/5/6 `validation.md` "PG parity deferred" claims reconciled with the
      migrations + Prisma models that now exist (N25).
- [ ] Dead code removed: `normalizeRRFScore`, `metrics.ts` `console.error`, two
      `session-registry.ts` silent swallows (N33).
- [ ] CI asserts grammar integrity pins on PRs touching `structural/` or `bun.lock` (N34).
- [ ] Shared `xdg.ts` (zero imports) extracted to kill the duplicated-XDP circular-dep
      workaround between `config-loader.ts` and `massa-ai-config.ts` (N36).
- [ ] Regression test added asserting that SQL `IN (...)` placeholder builders stay
      bounded (N10 no-op closure).

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
| --- | --- |
| N24 — Linux native runtime unblock | Already complete (native-runtime-rebaseline PASS). |
| N22 — Reconcile skill/doc mismatch (global CLAUDE.md vs `skills/massa-ai/SKILL.md`) | Deferred until user finishes massa-ai implementation work; user-explicit. |
| Full `nextCursor` pagination on `search_code`/`search_definitions`/`get_references`/`trace_path`/`impact_analysis` | cbm's bug was about pagination silently re-walking a rebuilt graph. massa-ai has no paginated graph reads today. Full pagination is Wave 5 N5 (grouped prefix-factored tree). N1 here only surfaces the generation token + opt-in precondition. |
| Dedicated test DB / `.env.example` test-DB provisioning | M35 root-cause fix is larger than this feature; accepted mock isolation as permanent for the 4 test groups (consistent with the 3 already fixed). |
| Converting the 3 bounded placeholder builders (`postgres-vector-store.ts:601`, `symbol-repository-pg.ts:1889`, `keyword-search-pg.ts:210`) to `= ANY($1::text[])` | N10 audit found no cbm-shaped bug; the 3 builders are bounded by construction. Conversion is defensive churn with no behavior change. |
| Cycle detection (N2), multi-source BFS CTE (N3), grouped tree (N5), lease/idempotent import (N11/N12/N13), persisted scheduler (N14), Synapse UX (N26), SSE push (N27), Moonshot flavor (N15), auth (N19) | Wave 5/6/7 features. |
| God-file decomposition (N31), embedded MCP (N32), parallel test runner (N20) | Wave 6 architecture. |
| Windows support (M58), watcher (M61), Cypher (M30), NotebookLM (N38) | Conditional / Wave 7. |

---

## Assumptions & Open Questions

Every ambiguity is resolved or recorded here — nothing is left silently unclear.

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| N1 scope | Surface `activatedGraphGenerationId` on clamped graph tools + opt-in `ifNoneMatch: <generationId>` param that teaching-errors on stale generation. | No paginated graph reads today → no silent re-walk risk. Cheapest, matches M54 cursor design (fingerprint, not gen token). User confirmed. | y |
| M35 approach | Test-only isolation fixture for `scheduler-store-pg.test.ts`: inject a filter that excludes `scheduled-*` rows from `listAll()` during the test. | Consistent with the 3 already-fixed test groups (stub grammar/graphGenerations/alias resolver + pre-create workspace). Zero infra change. User confirmed. | y |
| N9 cap | `MASSA_AI_READ_FILE_MAX_LINES` env override, default 500, emit `source_clipped: true` when cap is hit. Include true total line count so `omitted` is derivable. | Matches cbm contract; env override preserves large-file workflows. User confirmed. | y |
| N10 action | Close as no-op; add one regression test asserting the 3 bounded placeholder builders stay bounded (Phase 2 rerank ≤200, ref_kind enum ≤9, vocabulary VALUES chunked at 5000). | Audit found zero cbm-shaped bug. Test guards against regression. User confirmed. | y |
| N7 diff source selection | `scope=unstaged` (default) merges unstaged + untracked-new. `scope=staged` merges staged + untracked-new. `scope=committed` stays single-source (committed only). Add `scope=all` that merges committed + unstaged + untracked-new. | Matches cbm: untracked new files invisible to `git diff`. Preserves existing single-source semantics for committed; new `all` is the union. | y (derived from cbm evidence; no ambiguity) |
| N8 validation rule | Reject `base_branch`/`since` matching `/^--/` (git arg-injection) or `/[\r\n;|&$<>(){}\\]/` (shell metacharacters). Error lists valid pattern: alphanumeric, `-`, `/`, `.`, `_`, `+`. | cbm pattern. `execFileSync` already prevents shell injection; this prevents git arg-injection (`--upload-pack` etc.). | y (derived from cbm evidence) |
| N6 teaching error shape | `throw new ToolError("Invalid <param> value: <received>. Valid values: <list>.")` — same shape as `get_analytics.type` at `get_analytics.ts:109-114` extended with valid-values list. | `get_analytics` already half-implements this; we extend the pattern and add valid-values. | y (derived from existing partial pattern) |
| N4 fields | `<list>_total`, `<list>_shown`, `<list>_omitted` on every clamped list. Reuse existing `total`/`shown` where present (get_references, memory_list). Add `omitted` everywhere. | cbm invariant. `omitted = total - shown` is derivable but explicit is clearer. | y (derived from cbm evidence) |
| N1 precondition param name | `ifNoneMatch` (HTTP ETag convention). | Matches HTTP conditional-request semantics. Stale → 412-style teaching error with current generationId. | y (convention) |
| N34 CI gate | Add `verify:tree-sitter-native` step to the main `build` job in `ci.yml` ONLY when the PR touches `packages/core/src/services/structural/**` or `bun.lock` or `package.json`. Use `dorny/paths-filter@v3` or `tj-actions/changed-files` to detect. | Avoids running the heavy native gate on every PR; matches N34's "on PRs touching structural/ or bun.lock" wording. | y (matches plan wording) |
| N36 xdg.ts shape | Pure module, zero imports, exports `xdgConfigHome()`, `xdgDataHome()`, `xdgCacheHome()`, `xdgRuntimeDir()`, `xdgStateHome()`, `configDir(app)`, `dataDir(app)`, `cacheDir(app)`. Both `config-loader.ts` and `massa-ai-config.ts` import from it. | Matches M6 residual: "extract shared xdg.ts (no imports) to kill the duplicated-XDP circular-dep workaround." | y (matches plan wording) |
| N25 reconciliation depth | Update the 3 `validation.md` files' "Accepted assumption" rows to reflect that PG parity is no longer deferred — migrations + Prisma models exist. Add a note that runtime store classes may still be deferred but schema parity is done. | Minimal doc fix; no code change. | y (doc reconciliation) |
| M29 close | Flip `sqlite-removal` status to `complete` in `FEATURES.json` and add a `sqlite-removal-followup` feature for the 3 non-gating fixture/e2e follow-ups (legacy Prisma migration probe, qwen fixture rebuild, aggregate test capture). | Matches M29 wording: "Either flip to complete or split the 3 fixture follow-ups into sqlite-removal-followup." User chose split. | y (matches plan wording) |
| N33 `"deprecated"` literal in `relation-extractor.ts:44` | Keep. | Audit confirmed it is functional keyword data inside `CONTRADICTION_SIGNALS`, not a deprecation marker. | y (audit finding) |
| N9 cap applies to | `read_file` tool (MCP + HTTP), `symbol_snippet` HTTP endpoint (currently `start+10_000`), `SymbolGraphService.readSnippet`/`readContext` (used by `go_to_definition` enrichment). | All snippet/read paths. Cap is a per-read ceiling on returned lines. | y |
| N4 `serializeToolResponse` centralization | Each tool emits its own `*_total`/`*_shown`/`*_omitted` fields (not centralized in `serializeToolResponse`). | `serialize.ts:7-17` explicitly disclaims owning totals. Centralizing would violate the M36 contract. Per-tool is the existing convention. | y (matches existing contract) |
| N6 enum list scope | Validate at the tool handler layer (`*Tool.handle` in `packages/core/src/tools/`), not the service layer. | Tool layer is where user input enters; service layer trusts the tool. Matches `get_analytics` precedent. | y |
| Concurrency / ordering | N/A for this feature — no new concurrent state. N1 `ifNoneMatch` is a read-only precondition; N4 totals are computed atomically per request. | — | y |
| Auth boundaries | N/A — no auth changes. | — | y |
| Data lifecycle / expiry | N/A — no new persisted state. | y |
| External-dependency failure | N7 git failures already handled by `defaultDiffRunner` (throws → ImpactAnalysisService catches). N8 validation runs before git. | y |
| State-transition integrity | N/A — no new state machines. | y |
| Observability | N9 `source_clipped` and N4 `*_omitted` are themselves observability signals. No new metrics. | y |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: Correctness bundle — clamped lists, enum teaching errors, three-source diff, shell-arg guard, read_file cap ⭐ MVP

**User Story**: As an agent consuming massa-ai tool output, I want every clamped
list to report its true total and omitted count, every invalid enum to teach me the
valid values, the impact diff to include untracked new files, shell-args to be
validated, and read_file to cap at a known limit — so that I never silently lose data
or misread a stale result.

**Why P1**: This is the cbm correctness bundle (N4, N6, N7, N8, N9). Each item has a
deterministic test that fails today and passes after the fix. They are the highest
signal-to-cost items in Wave 4.

**Acceptance Criteria**:

1. WHEN `impact_analysis` clamps `impacted` at `MAX_IMPACTED=100` THEN the response
   SHALL include `impacted_total` (pre-clamp count), `impacted_shown` (post-clamp
   count), `impacted_omitted` (`total - shown`), and `truncated` (boolean). (N4)
2. WHEN `trace_path` clamps `nodes` at `MAX_NODES=2000` THEN the response SHALL include
   `nodes_total`, `nodes_shown`, `nodes_omitted`, and `truncated`. (N4)
3. WHEN `search_code` clamps `results` at `maxResults` THEN the response SHALL include
   `results_total` (pre-clamp reachable count), `results_shown`, `results_omitted`.
   (N4)
4. WHEN `search_definitions` clamps via SQL `LIMIT` THEN the response SHALL include
   `definitions_total` (true pre-LIMIT count), `definitions_shown`,
   `definitions_omitted`. (N4) The total MAY be computed via `COUNT(*) OVER()` OR a
   separate `SELECT COUNT(*)` (2 round trips) — implementation choice. For workspaces
   with > 100k matching definitions, the total MAY be capped at a sentinel (e.g.
   `definitions_total: ">=10000"` with `definitions_total_exact: false`) to avoid O(total
   match set) scans on every query. [Pre-mortem finding: mandated window function
   regresses latency on large workspaces.]
5. WHEN `get_references` clamps at `limit` THEN the response SHALL include `total`
   (existing), `shown` (existing), and `omitted` (new, `total - shown`). (N4)
6. WHEN any enum tool param (`direction`, `scope`, `mode`, `format`, `responseMode`,
   `kind`, `status`, `type`, `language`, `strategy`, `checkpointType`) receives an
   invalid value THEN the tool SHALL throw `ToolError("Invalid <param> value: <received>.
   Valid values: <comma-separated list>.")` instead of silent fallback. (N6)
7. WHEN `impact_analysis` is called with `scope=unstaged` (default) THEN the diff runner
   SHALL merge unstaged changes AND untracked new files (`git ls-files --others
   --exclude-standard`), deduplicated by path. (N7) **BREAKING default change** —
   previously `scope=unstaged` returned only unstaged tracked changes; now it includes
   untracked new files. Documented in HANDOFF.md at feature close.
8. WHEN `impact_analysis` is called with `scope=staged` THEN the diff runner SHALL merge
   staged changes AND untracked new files, deduplicated by path. (N7)
9. WHEN `impact_analysis` is called with `scope=all` THEN the diff runner SHALL merge
   committed (vs `base_branch`/`since`) + unstaged + untracked new files, deduplicated
   by path. (N7)
9a. WHEN any untracked file path matches a secret-like pattern (`*.env*`, `*.key`,
    `*.pem`, `*.p12`, `*.pfx`, `secrets.*`, `*.keystore`, `id_rsa*`, `*.asc`) THEN the
    diff runner SHALL exclude it from the impacted list and SHALL increment
    `untracked_filtered` count in the response. (N7) [Pre-mortem finding: untracked
    secrets not in `.gitignore` must not be disclosed to agent consumers.]
10. WHEN `impact_analysis` is called with `base_branch` or `since` starting with `--` or
    containing `\r`, `\n`, `;`, `|`, `&`, `$`, `<`, `>`, `(`, `)`, `{`, `}`, or `\` THEN
    the tool SHALL throw `ToolError("Invalid <param> value: <received>. Valid pattern:
    alphanumeric, -, /, ., _, +.")` before running git. (N8)
11. WHEN `read_file` is called with a range or whole-file read exceeding
    `MASSA_AI_READ_FILE_MAX_LINES` (default 500) THEN the response SHALL cap the
    returned lines at the limit, include `source_clipped: true`, and include the true
    total line count so `omitted` is derivable. (N9)
12. WHEN `read_file` is called with a range smaller than the cap THEN `source_clipped`
    SHALL be `false` and the full range SHALL be returned. (N9)
13. WHEN `MASSA_AI_READ_FILE_MAX_LINES` is unset or invalid THEN the cap SHALL default
    to `500`. (N9)
14. WHEN `symbol_snippet` HTTP endpoint is called with a range exceeding the cap THEN the
    response SHALL cap and emit `source_clipped`. (N9)
15. WHEN `SymbolGraphService.readSnippet`/`readContext` is invoked as an INTERNAL
    enrichment path (e.g. `go_to_definition` context) THEN the cap SHALL NOT be applied
    (internal enrichment reads small bounded context windows by design — 3-line context,
    top-3 definitions — and applying the cap would silently truncate without a
    propagation path to the MCP response). (N1) [Pre-mortem finding: the cap must not
    silently clip internal enrichment with no flag reaching the end consumer.]
16. WHEN `read_file` or `symbol_snippet` (user-facing paths) caps the returned lines
    THEN `source_clipped: true` SHALL be present in the SAME response as the capped
    content (not an internal-only signal). (N9)

**Independent Test**: Run `bun test src/__tests__/wave-4-correctness.test.ts` — each
AC maps to a test case. Discrimination: invert the cap → test fails; remove the
teaching error → test fails; drop untracked merge → test fails; apply cap to
`readContext` → `go_to_definition` test fails (enrichment must not be clipped).

---

### P1: Generation staleness signal (N1) ⭐ MVP

**User Story**: As an agent reading graph-dependent tool output, I want the active
graph generation id surfaced on every clamped graph-tool response and an opt-in
`ifNoneMatch` precondition that teaching-errors when my cached generation is stale —
so that I never silently act on a rebuilt graph.

**Why P1**: cbm's invariant: stale graph data must teach, never silently re-walk.
Even without pagination, a client holding a stale `activatedGraphGenerationId` and
calling a graph tool must learn the graph changed.

**Acceptance Criteria**:

1. WHEN `impact_analysis`, `trace_path`, `get_references`, or `search_definitions`
   succeeds against an active graph generation THEN the response SHALL include
   `activatedGraphGenerationId` (the current `active_graph_generation_id` for the
   workspace). (N1) NOTE: `search_code` is EXCLUDED — it reads pgvector + keyword
   stores, not the symbol graph, and must not incur a graph-generation lookup on the
   hot search path.
2. WHEN any of those tools is called with `ifNoneMatch: <generationId>` AND the
   workspace has NO active generation THEN the tool SHALL throw
   `ToolError("No active generation: index the project before querying.")`
   (HTTP 412 equivalent). (N1) [AC 5 takes precedence over AC 3 when no active
   generation exists.]
3. WHEN any of those tools is called with `ifNoneMatch: <generationId>` AND the current
   active generation differs (and one exists) THEN the tool SHALL throw
   `ToolError("Stale generation: client held <ifNoneMatch>, current is <current>. Re-read
   the project map before retrying.")` with HTTP 412 equivalent status. (N1)
4. WHEN `ifNoneMatch` matches the current generation THEN the tool SHALL return normally
   with the response. (N1)
5. WHEN `ifNoneMatch` is omitted THEN the tool SHALL return normally (precondition is
   opt-in). (N1)
6. WHEN the workspace has no active generation (never indexed) THEN the tools SHALL
   return `activatedGraphGenerationId: null` in the success path (when `ifNoneMatch` is
   omitted). (N1)
7. WHEN `search_code` is called THEN the response SHALL NOT include
   `activatedGraphGenerationId` and SHALL NOT accept `ifNoneMatch` (vector + keyword
   search is graph-independent). (N1)

**Independent Test**: Run `bun test src/__tests__/wave-4-generation-staleness.test.ts`.
Discrimination: mutate the generation id → `ifNoneMatch` errors; omit `ifNoneMatch` →
no error. Test the vector-only/graph-absent case: workspace with vectors indexed but
no symbol graph → `search_code` returns normally; `impact_analysis` returns
`activatedGraphGenerationId: null` when `ifNoneMatch` omitted, errors when
`ifNoneMatch` present.

---

### P1: Shared-DB fixture isolation for scheduler-store-pg (M35) ⭐ MVP

**User Story**: As a CI runner, I want `scheduler-store-pg.test.ts` to pass against a
shared Postgres DB that already has the 4 real `scheduled-*` default rows — so that
the test is not polluted by boot-time default jobs.

**Why P1**: This is the one still-failing test group from the Wave 3 six-suite
classification. The other 3 groups were fixed with mocks; this one was not.

**Acceptance Criteria**:

1. WHEN `scheduler-store-pg.test.ts:101` asserts `storeB.listAll().map(e => e.id)`
   equals exactly `[cronId, intervalId]` THEN the assertion SHALL pass against a shared
   DB containing the 4 `scheduled-*` default rows. (M35)
2. WHEN the test injects its isolation seam THEN the 4 `scheduled-*` rows SHALL be
   filtered out of `listAll()` for the duration of the test and restored afterward.
   (M35) The seam SHALL be INSTANCE-SCOPED to `storeB` (subclass or instance-method
   override, NOT a class-prototype or global SQL change) and SHALL be restored in
   `afterEach`. [Pre-mortem finding: a global/class-level seam leaks to other tests if
   the test crashes before restore.]
3. WHEN `DB_AVAILABLE` is false THEN the suite SHALL still skip via
   `describe.skipIf(!DB_AVAILABLE)`. (M35 — preserves existing gate)
4. WHEN the test completes THEN the shared DB SHALL be unchanged (no `scheduled-*` rows
   deleted or modified). (M35 — no pollution of other tests)
5. WHEN a follow-up `listAll()` call runs in the same suite AFTER the test THEN it SHALL
   return the full unfiltered set (proving the seam was restored). (M35)

**Independent Test**: Run
`DATABASE_URL=postgresql://... bun test src/__tests__/scheduler-store-pg.test.ts` against
a DB with `scheduled-*` rows present. Discrimination: remove the isolation seam →
test fails with 4 extra ids.

---

### P2: Spec reconciliation (M29, N25)

**User Story**: As a contributor reading `.specs/`, I want the feature registry and
validation docs to reflect reality — `sqlite-removal` closed with follow-ups split out,
and Phase-1/5/6 PG-parity claims updated to acknowledge the migrations + Prisma models
that exist.

**Why P2**: Stale docs mislead every future agent. Pure doc work, no code risk.

**Acceptance Criteria**:

1. WHEN `FEATURES.json` is read THEN `sqlite-removal` SHALL have status `complete` and a
   new `sqlite-removal-followup` feature SHALL exist with status `in_progress` carrying
   the 3 non-gating fixture/e2e follow-ups. (M29)
2. WHEN `.specs/features/phase-1-memory-foundation/validation.md` is read THEN the
   "PG parity deferred" accepted assumptions at lines 136-141 SHALL be updated to
   "PG schema parity delivered via migration 20260710120000_add_synapse_sessions_pg;
   runtime PgSessionStore may still be deferred but schema is done." (N25)
3. WHEN `.specs/features/phase-5-auto-improve/validation.md` is read THEN the accepted
   assumption at lines 162-165 SHALL be updated similarly for
   `20260713090000_add_handoffs_proposals_pg` + `Proposal` model. (N25)
4. WHEN `.specs/features/phase-6-handoffs/validation.md` is read THEN the accepted
   assumption at lines 143-147 SHALL be updated similarly for `Handoff` model. (N25)

**Independent Test**: `grep -n "PG parity deferred" .specs/features/phase-*/validation.md`
returns zero matches after the fix.

---

### P2: Dead code sweep (N33)

**User Story**: As a maintainer, I want deprecated `normalizeRRFScore`, the raw
`console.error` in `metrics.ts`, and the two silent swallows in `session-registry.ts`
removed or routed through the logger — so that the codebase has one error path.

**Why P2**: Each item is a 1-3 line surgical fix. The `"deprecated"` literal in
`relation-extractor.ts:44` is NOT dead code (audit confirmed it is functional keyword
data) and stays.

**Acceptance Criteria**:

1. WHEN `packages/core/src/data/vector/hybrid-search.ts` is read THEN the singular
   `normalizeRRFScore` (lines 152-158) SHALL be removed; the batch `normalizeRRFScores`
   (line 140) SHALL remain the only path. (N33)
2. WHEN `packages/core/src/services/monitoring/metrics.ts:443` is read THEN the
   `console.error` SHALL be replaced with `logger.error` (or the existing logger import
   SHALL be added). (N33)
3. WHEN `packages/core/src/services/synapse/session/session-registry.ts:76` and
   `:92-94` are read THEN the two bare `catch {}` blocks SHALL call
   `logger.warn("[SessionRegistry] store <op> failed:", error)` with the caught error
   bound. (N33)
4. WHEN `relation-extractor.ts:44` is read THEN the `"deprecated"` literal SHALL remain
   unchanged (functional keyword data). (N33 — audit confirmed)

**Independent Test**: `grep -n "normalizeRRFScore\b" packages/core/src/data/vector/hybrid-search.ts`
returns only the batch `normalizeRRFScores` definition + callers. `grep -n "console.error"
packages/core/src/services/monitoring/metrics.ts` returns zero. `grep -n "} catch {"
packages/core/src/services/synapse/session/session-registry.ts` returns zero.

---

### P2: Grammar integrity verifier in CI (N34)

**User Story**: As a CI pipeline, I want `verify:tree-sitter-native` to run on PRs
touching `packages/core/src/services/structural/**` or `bun.lock` or `package.json` —
so that grammar pin drift is caught before merge, not only at runtime.

**Why P2**: The runtime verifier exists (M11) but the main `build` job in `ci.yml`
does not assert it. The `structural-native-linux` job runs it but on every PR, not
path-filtered.

**Acceptance Criteria**:

1. WHEN a PR touches `packages/core/src/services/structural/**`, `bun.lock`, or
   `package.json` THEN the CI workflow SHALL run `bun run verify:tree-sitter-native` as
   a gating step. (N34)
2. WHEN a PR does NOT touch those paths THEN the grammar verification step SHALL be
   skipped to save CI time. (N34)
3. WHEN `verify:tree-sitter-native` fails THEN the PR SHALL be blocked. (N34)
4. WHEN the existing `structural-native-linux` job runs THEN it SHALL continue to run
   `verify:tree-sitter-native` (no regression). (N34)

**Independent Test**: Open a PR touching `packages/core/src/services/structural/parse.ts`
→ CI runs the grammar step. Open a PR touching only `README.md` → step is skipped.

---

### P2: Unify two config systems (N36)

**User Story**: As a contributor, I want a single `xdg.ts` module (zero imports) that
both `config-loader.ts` and `massa-ai-config.ts` import — so that the duplicated
XDG path logic and the circular-dep workaround comment are gone.

**Why P2**: M6 residual. The audit confirmed `xdg.ts` does NOT exist and the
`XDG_CONFIG_HOME` resolution is duplicated byte-for-byte at `config-loader.ts:6-9` and
`massa-ai-config.ts:8-11` with a circular-dep workaround comment at
`massa-ai-config.ts:4-7`.

**Acceptance Criteria**:

1. WHEN `packages/shared/src/config/xdg.ts` is read THEN it SHALL exist, export
   `xdgConfigHome()`, `xdgDataHome()`, `xdgCacheHome()`, `xdgRuntimeDir()`,
   `xdgStateHome()`, `configDir(app)`, `dataDir(app)`, `cacheDir(app)`, and have ZERO
   imports (pure, no `import` statements). (N36)
2. WHEN `config-loader.ts` is read THEN the `XDG_CONFIG_HOME` resolution (lines 6-9)
   SHALL be replaced with `import { xdgConfigHome, configDir } from "./xdg.js"` and a
   call to `configDir("massa-ai")`. (N36)
3. WHEN `massa-ai-config.ts` is read THEN the duplicated `XDG_CONFIG_HOME` (lines
   8-11) and the circular-dep workaround comment (lines 4-7) SHALL be replaced with
   the same import. (N36)
4. WHEN the workspace is type-checked and built THEN `bun run typecheck` and `bun run
   build` SHALL pass. (N36)
5. WHEN the existing config tests run THEN they SHALL pass unchanged. (N36)

**Independent Test**: `grep -n "XDG_CONFIG_HOME" packages/shared/src/config/` returns
matches only in `xdg.ts`. `grep -n "circular dependency" packages/shared/src/config/`
returns zero. `bun run typecheck && bun run build` pass.

---

### P2: N10 no-op closure with regression test

**User Story**: As a maintainer, I want a regression test asserting that the 3 bounded
SQL placeholder builders stay bounded — so that a future change cannot silently
introduce the cbm 4 KB overflow pattern.

**Why P2**: The audit found no bug, but the pattern is cheap to guard.

**Acceptance Criteria**:

1. WHEN `wave-4-sql-bounds.test.ts` feeds \u003e 200 candidate ids to
   `postgres-vector-store.searchTwoPhase` Phase 2 THEN the test SHALL assert the Phase 1
   `LIMIT` clamps to 200 (no overflow). (N10)
2. WHEN the test feeds \u003e 9 ref kinds to `findEdges` THEN the test SHALL assert only
   the valid enum values are used (bounded by enum size). (N10)
3. WHEN the test feeds \u003e 5000 vocabulary words to `populateVocabulary` THEN the test
   SHALL assert the INSERT is chunked at 5000 per batch. (N10)
4. WHEN the test greps the codebase for `snprintf` or `sprintf` THEN it SHALL return
   zero matches (TypeScript has no C fixed buffers). (N10)

**Independent Test**: `bun test src/__tests__/wave-4-sql-bounds.test.ts` passes.
Discrimination: remove the Phase 1 `LIMIT 200` → test 1 fails.

---

## Edge Cases

- WHEN `MASSA_AI_READ_FILE_MAX_LINES=0` or negative THEN the cap SHALL default to
  `500` (treat invalid as unset).
- WHEN `ifNoneMatch` is an empty string THEN the tool SHALL ignore it (treat as
  omitted).
- WHEN `base_branch` is an empty string THEN `defaultDiffRunner` SHALL fall back to
  `"main"` (existing behavior, no validation needed for empty).
- WHEN `scope=all` and `base_branch` is omitted THEN the committed source SHALL diff
  against `main` (existing default).
- WHEN `git ls-files --others` returns paths already in `git diff --name-only` THEN
  the dedup SHALL keep one copy (Set-based).
- WHEN `git ls-files --others` returns secret-like paths (`.env*`, `*.key`, `*.pem`,
  `secrets.*`, etc.) THEN the diff runner SHALL exclude them and increment
  `untracked_filtered` (pre-mortem: avoid disclosing untracked secrets to agents).
- WHEN the workspace has `pendingGraphGenerationId` but no `activeGraphGenerationId`
  THEN `activatedGraphGenerationId` SHALL be `null` (not the pending id).
- WHEN `search_code` is called THEN `activatedGraphGenerationId` SHALL NOT be surfaced
  (vector + keyword search is graph-independent; pre-mortem: avoid coupling + a DB
  round trip on the hot search path).
- WHEN `readContext`/`readSnippet` is called as internal enrichment (e.g.
  `go_to_definition` 3-line context) THEN the read_file cap SHALL NOT apply (pre-mortem:
  internal enrichment has no propagation path to the MCP response).
- WHEN `scheduler-store-pg.test.ts` isolation seam filters `scheduled-*` rows THEN the
  test's own `cronId`/`intervalId` (which start with `pg-scheduler-test-` per
  `TEST_PREFIX`) SHALL NOT be filtered.
- WHEN the scheduler-store-pg seam is restored in `afterEach` THEN a subsequent
  `listAll()` in the same suite SHALL return the full unfiltered set (proving
  restoration; pre-mortem: a class/global seam leaks if the test crashes).
- WHEN `xdg.ts` is imported by both config files at module-eval time THEN there SHALL
  be no circular import (xdg.ts has zero imports → acyclic).
- WHEN `search_definitions` runs against a workspace with > 100k matching definitions
  THEN the total MAY be a sentinel `">=10000"` with `definitions_total_exact: false`
  (pre-mortem: avoid O(total match set) scans on every query).

---

## Requirement Traceability

Each requirement gets a unique ID for tracking across design, tasks, and validation.

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| WAVE4-N1 | P1: Generation staleness signal | Design | Pending |
| WAVE4-N4 | P1: Correctness bundle (clamped lists) | Design | Pending |
| WAVE4-N6 | P1: Correctness bundle (enum teaching errors) | Design | Pending |
| WAVE4-N7 | P1: Correctness bundle (three-source diff) | Design | Pending |
| WAVE4-N8 | P1: Correctness bundle (shell-arg guard) | Design | Pending |
| WAVE4-N9 | P1: Correctness bundle (read_file cap) | Design | Pending |
| WAVE4-M35 | P1: scheduler-store-pg fixture isolation | Design | Pending |
| WAVE4-N10 | P2: N10 no-op + regression test | - | Pending |
| WAVE4-M29 | P2: Spec reconciliation (sqlite-removal close) | - | Pending |
| WAVE4-N25 | P2: Spec reconciliation (PG parity docs) | - | Pending |
| WAVE4-N33 | P2: Dead code sweep | - | Pending |
| WAVE4-N34 | P2: Grammar integrity verifier in CI | - | Pending |
| WAVE4-N36 | P2: Unify two config systems | Design | Pending |

**ID format:** `WAVE4-<PLAN_ITEM>` (e.g., `WAVE4-N1`, `WAVE4-M35`).

**Status values:** Pending → In Design → In Tasks → Implementing → Verified

**Coverage:** 13 total, 13 mapped to tasks, 0 unmapped.

---

## Success Criteria

How we know the feature is successful:

- [ ] All 15 P1 acceptance criteria pass (correctness bundle + generation staleness +
      scheduler fixture).
- [ ] All P2 acceptance criteria pass (spec reconciliation, dead code, grammar CI,
      xdg.ts, N10 regression test).
- [ ] Independent verifier (author ≠ verifier) confirms spec-anchored outcomes + runs
      discrimination sensors on every AC.
- [ ] `bun run typecheck && bun run build` pass.
- [ ] No existing test regresses (full suite green except pre-existing documented
      skips).
- [ ] `.specs/project/STATE.md`, `.specs/project/FEATURES.json`, `.specs/HANDOFF.md`
      updated; durable decisions persisted to massa-ai memory.

---

## Sizing

This is **Large/Complex** work: 13 requirement IDs across 9 components, touching > 10
files (tool handlers, services, shared config, CI workflow, test fixtures, spec docs),
with public-contract changes (new response fields, new error shape, new env var, new
CI step, a *default* behavior change on `scope=unstaged`, and a secrets-denylist
addition). Full pipeline: Specify (this file) → Design → Tasks → Execute → Validate.

## Plan Challenge Gate

Ran The Fool in **pre-mortem** mode (full gate; plan touches >5 files, public
contracts, and a security surface via N8/N7-untracked-secrets). The plan-critic
escalated to full with 5 critical/high findings. Per policy
`serious_findings: revise_plan`, all 5 were revised before finalizing:

1. **N9 internal enrichment clip** → AC 15 now excludes `readContext`/`readSnippet`
   internal enrichment from the cap (no propagation path to MCP response); cap
   applies only to user-facing `read_file`/`symbol_snippet`.
2. **N1 `search_code` graph coupling** → AC 1 now excludes `search_code` (vector +
   keyword search is graph-independent); new AC 7 forbids
   `activatedGraphGenerationId` on `search_code`; stale/no-generation precedence
   disambiguated (AC 2 takes precedence over AC 3).
3. **N7 breaking default + secrets disclosure** → AC 7 marked BREAKING; new AC 9a adds
   a secrets-denylist for untracked files (`*.env*`, `*.key`, etc.) with
   `untracked_filtered` count; HANDOFF.md close note added.
4. **M35 seam leak** → AC 2 now requires instance-scoped seam + `afterEach` restore;
   new AC 5 proves restoration with a follow-up `listAll()`.
5. **N4 `COUNT(*) OVER()` perf** → AC 4 now allows `COUNT(*) OVER()` OR separate
   `SELECT COUNT(*)` OR a sentinel `">=10000"` with `definitions_total_exact: false`
   for >100k workspaces.

Plan Challenge: ran The Fool in pre-mortem mode; revised N9 propagation, N1 graph
scope, N7 breaking-default + denylist, M35 seam mechanism, and N4 perf before
finalizing.

---

## Verification Approach

- **Unit tests:** each AC maps to a test in `packages/core/src/__tests__/wave-4-*.test.ts`.
- **Discrimination sensor:** the independent verifier injects behavior-level faults
  (removes the cap, drops the teaching error, drops the untracked merge, removes the
  xdg.ts import) and confirms the tests kill them.
- **Gate check commands:**
  - `bun run typecheck` (workspace)
  - `bun run build` (workspace)
  - `bun test src/__tests__/wave-4-*.test.ts` (focused)
  - `bun test src/__tests__/scheduler-store-pg.test.ts` (M35)
  - `bun test src/__tests__/read-file.test.ts` (N9 regression)
  - `bun test src/__tests__/impact-analysis*.test.ts` (N7/N8)
  - `bun test src/__tests__/trace-path.test.ts` (N4 regression)
  - `bun run verify:tree-sitter-native` (N34 sanity, local)
- **Spec doc checks:** `grep -n "PG parity deferred" .specs/features/phase-*/validation.md`
  returns zero; `FEATURES.json` `sqlite-removal` status `complete`.
- **Independent verifier:** author ≠ verifier, fresh-eyes spec-anchored outcome check +
  discrimination sensor, writes `validation.md`.

---

## Artifact Store Evidence

- **Active artifact key:** `.specs/features/wave-4-correctness-hygiene/spec.md`
- **Version:** 1 (initial write)
- **Checksum:** to be computed after write (sha256)
- **Baseline commit:** `f3d802098215c0dd9cbfcd8374605484f9a8a5b2` (main)