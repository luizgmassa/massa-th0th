# Wave 6 — Architecture & Medium Features Specification

## Problem Statement

massa-th0th accumulated structural debt across three axes: god-file modules exceeding 900–2100 LOC, operational coupling between MCP client and REST server (forcing two processes for single-user local-first), and shell-based hook scripts with no typed payload or testable attribution. Additionally, test execution is sequential with turbo caching disabled (live DB), the web UI lacks observability surfaces, the scheduler has no safe-defaults preset, and there is no formal harness contribution protocol or deterministic acceptance script separate from CI. Several carryover items from the cbm/ai improvement plan (N42 path recovery, M25 name resolution, M26 JSON extraction, M62 tree-sitter GLR verification) remain open.

## Goals

- [ ] Decompose 4 god-files behind byte-identical facades with characterization tests first (M14 precedent)
- [ ] Add embedded MCP mode so single-user local-first runs one process instead of two
- [ ] Replace 7 shell hook scripts with one typed `massa-th0th-hook` Bun binary
- [ ] Add parallel test runner with ZERO-LOSS union guard
- [ ] Add test-seam coupling to live response shape for consumer parsers
- [ ] Add `/dashboard` observability route with scheduler health, job history, hook lag, Synapse count
- [ ] Add scheduler safe-defaults preset (`MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true`)
- [ ] Add managed-harness contribution protocol template (7-step acceptance gates)
- [ ] Add deterministic acceptance script (`_DETERMINISTIC_ONLY=1`) separate from CI
- [ ] Fresh-install admin access preservation (four-rung auth ladder) if auth grows
- [ ] Document + offer `--recover` for absolute-path fragility on checkout rename (N42)
- [ ] Project-name resolution by unique name tail (M25)
- [ ] Composite/escaped JSON property extraction (M26)
- [ ] Verify Node tree-sitter binding re: GLR stack-merge depth cap (M62)

## Out of Scope

| Feature | Reason |
| ----------- | ------ |
| M58 Windows wide-path canonicalization | Conditional — Windows support not in scope per plan caveats |
| Full auth system implementation | N19 is preservation logic only (four-rung ladder), not a full auth system |
| Rewriting M14-decomposed modules (rlm/query-pack) | Already decomposed on main (`c92e481`); N31 targets different files |
| Changing semantic search/embedding/ranking behavior | Decomposition is behavior-preserving |
| New database migrations beyond scheduler/UI additions | All schema changes additive and reversible |
| Performance optimization of decomposed modules | Characterization tests pin behavior, not performance |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --------------------- | --------------- | --------- | ---------- |
| Branch strategy | `wave-6` off `main` (post-Wave-5 merge `389461b`) | User confirmed Wave 5 merged, checkout main, branch off | y |
| N19 auth scope | Four-rung ladder: no users → admin open until first user. Logic only, no full auth. | Plan says "if massa-th0th grows auth" — implement preservation logic, not auth system | y |
| N42 path recovery | Document + offer `--recover` via explicit `projectId` (alias-chain from M16/M17 already exists) | Plan says "document + offer" — not a full fix | y |
| M62 GLR verification | Read-only verification probe, not a production change | Plan says "Verify" — audit, then fix only if defect found | y |
| N31 split target LOC | No module > ~600 LOC (M14 precedent REQ-GF-3) | Consistent with prior decomposition | y |
| N32 embedded mode | In-process ApiClient calling core directly, so single-user doesn't need MCP+REST processes | Plan: "ApiClient abstraction already exists" — route calls directly to core services | y |
| N30 hook binary | Typed payloads, testable attribution in TS; replaces jq/sed/mktemp shell patterns | Plan explicit | y |
| N20 parallel runner | `--list-suites` from macro table; UNION GUARD fails if result-set ≠ list; serial tail for deadline-sensitive | Plan explicit | y |
| N21 test-seam | Feed real tool responses to consumer parsers (Synapse, hook layer) so format drift breaks locally | Plan explicit | y |
| N28 dashboard | `/dashboard` route, read-only, sources from existing `/api/v1/system/metrics` + `/api/v1/synapse/sessions` + new scheduler route | Plan explicit | y |
| N29 preset | `MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true` enables consolidation+decay at conservative intervals; auto-improve stays opt-in | Plan explicit | y |
| N17 protocol | Template for adding new MCP clients/indexing backends with 7 acceptance gates | Plan explicit | y |
| N18 deterministic script | `_DETERMINISTIC_ONLY=1` separate from CI; real-grammar phase opt-in | Plan explicit | y |
| M25 name resolution | Resolve project by unique name tail (not just projectId/path) | Plan: cbm carryover | y |
| M26 JSON extraction | Composite/escaped JSON property extraction in tool responses | Plan: cbm carryover | y |

**Open questions:** none — all resolved or logged above (required before the spec is confirmed).

---

## User Stories

### P1: N31 God-File Decomposition ⭐ MVP

**User Story**: As a maintainer, I want symbol-repository-pg.ts, tool-definitions.ts, auto-improve-job.ts, and smart-chunker.ts split into per-domain modules behind byte-identical facades so that each module is under ~600 LOC and the codebase is navigable.

**Why P1**: Structural debt flagged repeatedly in self-report; 2119/1688/969/945 LOC files block maintainability.

**Acceptance Criteria**:

1. WHEN `symbol-repository-pg.ts` is split THEN each resulting module SHALL be ≤600 LOC and the barrel `data/symbol/index.ts` SHALL re-export the same `SymbolRepositoryPg` class with identical method signatures
2. WHEN `tool-definitions.ts` is split THEN `TOOL_DEFINITIONS` array SHALL be byte-identical (same 52 entries, same order, same schemas) and `getToolDefinition` SHALL return the same result for any tool name
3. WHEN `auto-improve-job.ts` is split THEN `AutoImproveJob` class public API SHALL be unchanged and `detectPatterns`/`enrichWithLlm` SHALL produce identical outputs for identical inputs
4. WHEN `smart-chunker.ts` is split THEN `smartChunk` SHALL produce byte-identical `Chunk[]` output for identical inputs across all format dispatchers (markdown/json/yaml/code/fixed)
5. WHEN characterization tests run THEN they SHALL pass before AND after every split commit (tests written first, never deleted or weakened)
6. WHEN any decomposed module exceeds 600 LOC THEN a documented safety valve SHALL split further or record the exception reason

**Independent Test**: Run characterization tests before split → split one module → tests still pass → repeat.

---

### P1: N32 Embedded MCP Mode ⭐ MVP

**User Story**: As a single-user local-first operator, I want to run massa-th0th as one process (embedded MCP) instead of two (MCP client + REST server) so that resource overhead is reduced and setup is simpler.

**Why P1**: Plan says "M32 decision → implement"; ApiClient abstraction already exists; reduces process overhead for local-first.

**Acceptance Criteria**:

1. WHEN `MASSA_TH0TH_EMBEDDED=true` THEN the MCP server SHALL route tool calls directly to core services (no HTTP hop) and SHALL NOT require the REST tools-api server to be running
2. WHEN embedded mode is active THEN `proxyCallTool` SHALL use an in-process dispatcher instead of `ApiClient` HTTP calls
3. WHEN embedded mode is active THEN health check SHALL report `mode: "embedded"` and the REST server SHALL be optional (start only if `MASSA_TH0TH_API_PORT` is set)
4. WHEN a tool call fails in embedded mode THEN the error SHALL be identical to the HTTP-mode error shape (same `ToolError` structure)
5. WHEN embedded and HTTP modes are both available THEN a single config flag SHALL switch between them with no code changes

**Independent Test**: Start MCP server with `MASSA_TH0TH_EMBEDDED=true` (no REST server running) → call `search` tool → get results.

---

### P1: N30 Hook Scripts → Single Bun Binary ⭐ MVP

**User Story**: As a hook consumer, I want one typed `massa-th0th-hook` Bun binary replacing 7 shell scripts so that payloads are typed, attribution is testable, and jq/sed/mktemp dependencies are eliminated.

**Why P1**: Plan explicit; shell scripts are fragile (jq-optional, sed fallback, mktemp patterns); typed payloads enable testing.

**Acceptance Criteria**:

1. WHEN `massa-th0th-hook` is invoked with an event type and stdin payload THEN it SHALL POST to `/api/v1/hook` with the same fire-and-forget semantics (2s timeout, exit 0 always)
2. WHEN the binary is installed THEN it SHALL replace all 7 shell scripts (`_pin.sh`, `_post.sh`, `pre-compact.sh`, `post-tool-use.sh`, `session-start.sh`, `stop.sh`, `user-prompt-submit.sh`) and `.claude/settings.json` SHALL reference the binary
3. WHEN project-id pinning runs THEN it SHALL use the same resolution order (existing pin → `MASSA_TH0TH_PROJECT_ID` env → git toplevel basename → cwd basename) and the same silent-degrade behavior
4. WHEN stdin is a terminal (no pipe) THEN it SHALL exit 0 with no POST (same as shell behavior)
5. WHEN `jq` is absent THEN the binary SHALL still parse JSON (TS-native, no jq dependency)
6. WHEN attribution is resolved THEN it SHALL match the existing `AttributionResolver` behavior (explicit→sticky→containment→verbatim, fail-open)

**Independent Test**: Run `massa-th0th-hook session-start < payload.json` → verify POST received by hook endpoint → verify exit 0.

---

### P1: N20 Parallel Test Runner with ZERO-LOSS Union Guard ⭐ MVP

**User Story**: As a CI operator, I want a parallel test runner that splits suites from a macro table and fails if any suite result is missing so that wall-clock is reduced without losing coverage.

**Why P1**: Plan: "turbo test caching is disabled (live DB) — this cuts wall-clock"; ZERO-LOSS guard prevents silent suite drops.

**Acceptance Criteria**:

1. WHEN `--list-suites` is invoked THEN it SHALL enumerate all test suites from the same macro table that executes them
2. WHEN suites are run in parallel THEN the runner SHALL execute independent suites concurrently and apply a serial tail for deadline-sensitive suites
3. WHEN all suites complete THEN the UNION GUARD SHALL fail if the result-set ≠ the list (any missing suite = failure)
4. WHEN a suite crashes or times out THEN it SHALL be counted as failed (not silently dropped)
5. WHEN the runner completes THEN it SHALL report per-suite pass/fail/skip counts and a total summary

**Independent Test**: `run-tests-parallel --list-suites` → run → compare result-set to list → assert no missing.

---

### P1: N21 Test-Seam Coupling to Live Response Shape ⭐ MVP

**User Story**: As a maintainer, I want consumer parsers (Synapse, hook layer, observation-extractor) fed real tool responses in tests so that format drift breaks a local test, not only CI.

**Why P1**: Plan: "so format drift breaks a local test, not only CI"; prevents silent consumer breakage.

**Acceptance Criteria**:

1. WHEN a tool response shape changes THEN at least one consumer parser test SHALL fail (detection before production)
2. WHEN `observation-extractor.ts` classifies a tool call THEN it SHALL be tested against captured real tool-response payloads (not hand-built inputs only)
3. WHEN the Synapse layer consumes search results THEN it SHALL be tested against captured real search-response payloads
4. WHEN a fixture is captured THEN it SHALL be deterministic (no timestamps, no random IDs) or explicitly frozen
5. WHEN the test-seam runs THEN it SHALL not require a live server (fixtures are replayed, not live-called)

**Independent Test**: Capture a real `search` response → freeze as fixture → feed to `observation-extractor` → assert classification correct → mutate response shape → assert test fails.

---

### P1: N28 Observability Dashboard ⭐ MVP

**User Story**: As an operator, I want a `/dashboard` route with scheduler health, job history, hook-ingestion lag, and Synapse session count so that I can monitor system health without curling individual endpoints.

**Why P1**: Plan: "web UI is currently read-only over memories/search only"; observability gap.

**Acceptance Criteria**:

1. WHEN `/dashboard` is loaded THEN it SHALL display scheduler status (running, tick interval, registered jobs with next-run/last-run/due/currently-running)
2. WHEN job history is viewed THEN it SHALL show per-job last success/failure, consecutive failures, and next run
3. WHEN hook-ingestion lag is displayed THEN it SHALL show writer-queue pending count and saturation status
4. WHEN Synapse session count is displayed THEN it SHALL show active sessions from `/api/v1/synapse/sessions`
5. WHEN the dashboard is loaded THEN it SHALL be read-only (no write operations) and consistent with existing web UI styling

**Independent Test**: Start server → navigate to `/dashboard` → verify scheduler jobs, hook queue depth, Synapse sessions all rendered.

---

### P1: N29 Scheduler Safe-Defaults Preset ⭐ MVP

**User Story**: As an operator, I want `MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true` to enable consolidation + decay at conservative intervals with auto-improve staying opt-in so that safe maintenance is one env var away.

**Why P1**: Plan: "Enables safe consolidation/decay sweeps (currently default-disabled)"; reduces friction for safe operation.

**Acceptance Criteria**:

1. WHEN `MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true` THEN consolidation SHALL be enabled at a conservative interval (≥30 min) and decay SHALL be enabled at a conservative interval (≥60 min)
2. WHEN the preset is active THEN auto-improve SHALL remain opt-in (NOT enabled by the preset)
3. WHEN the preset is active THEN the master switch `MASSA_TH0TH_SCHEDULER_ENABLED` SHALL still be required (preset does not override master switch)
4. WHEN individual job envs conflict with the preset THEN individual envs SHALL take precedence (explicit override)
5. WHEN the preset is not set THEN behavior SHALL be unchanged (all jobs default-disabled as today)

**Independent Test**: Set `MASSA_TH0TH_SCHEDULER_SAFE_DEFAULTS=true` + `MASSA_TH0TH_SCHEDULER_ENABLED=true` → verify consolidation+decay enabled, auto-improve NOT enabled → set `MASSA_TH0TH_SCHEDULER_AUTO_IMPROVE_ENABLED=true` → verify auto-improve now enabled.

---

### P2: N17 Managed-Harness Contribution Protocol

**User Story**: As a contributor, I want a 7-step template for adding new MCP clients/indexing backends with explicit acceptance gates so that integrations are consistent and verified.

**Why P2**: Plan: "template for adding new MCP clients / indexing backends"; process improvement, not blocking.

**Acceptance Criteria**:

1. WHEN the protocol is documented THEN it SHALL define 7 steps: contract → register → preserve argv → read-only export → deliver-before-ack → invariants → tests
2. WHEN a new backend is added THEN it SHALL follow the protocol and pass all 7 gates
3. WHEN the protocol is published THEN it SHALL live in the repo root as `CONTRIBUTING.md` or `docs/harness-protocol.md`

**Independent Test**: Read the protocol doc → verify 7 steps present → verify each step has a concrete acceptance gate.

---

### P2: N18 Deterministic Acceptance Script

**User Story**: As a CI operator, I want `_DETERMINISTIC_ONLY=1` to run only deterministic tests (no live DB, no network, no grammar) separate from CI so that fast feedback is available without environment dependencies.

**Why P2**: Plan: "separate from CI; real-grammar phase opt-in"; useful but not blocking.

**Acceptance Criteria**:

1. WHEN `_DETERMINISTIC_ONLY=1` is set THEN the test runner SHALL skip all suites requiring live DB, network, or real grammar parsing
2. WHEN deterministic-only mode runs THEN it SHALL complete without external dependencies (no PG, no Ollama, no tree-sitter native)
3. WHEN the script completes THEN it SHALL report which suites were skipped and why

**Independent Test**: `_DETERMINISTIC_ONLY=1 bun test` → verify no DB/network/grammar suites run → verify pure-unit suites pass.

---

### P2: N19 Fresh-Install Admin Access Preservation

**User Story**: As a fresh installer, I want admin access open until the first user is created so that initial setup is not locked out.

**Why P2**: Plan: "if massa-th0th grows auth" — preservation logic only.

**Acceptance Criteria**:

1. WHEN no users exist THEN admin endpoints SHALL be open (no auth required)
2. WHEN the first user is created THEN admin endpoints SHALL require auth
3. WHEN this preservation logic is added THEN it SHALL NOT implement a full auth system (four-rung ladder only)

**Independent Test**: Fresh install (0 users) → call admin endpoint → success → create first user → call admin endpoint → require auth.

---

### P2: N42 Absolute-Path Fragility — Document + Recover

**User Story**: As a developer who renamed a checkout, I want documentation and a `--recover` flag so that the broken index can be recovered via explicit `projectId`.

**Why P2**: Plan: "Document + offer `--recover` via explicit `projectId` (alias-chain already exists from M16/M17)".

**Acceptance Criteria**:

1. WHEN a checkout is renamed THEN the documentation SHALL explain that `projectPath`-based index breaks and `--recover` with explicit `projectId` restores it
2. WHEN `--recover <projectId> --path <newPath>` is invoked THEN the system SHALL re-associate the index with the new path via the existing alias-chain (M16/M17)
3. WHEN the documentation is published THEN it SHALL cover the rename scenario in README or docs/

**Independent Test**: Rename checkout → run `--recover <projectId> --path <newPath>` → verify index accessible at new path.

---

### P3: M25 Project-Name Resolution by Unique Name Tail

**User Story**: As a user, I want to resolve a project by its unique name tail (not just projectId/path) so that I can reference projects by human-readable names.

**Why P3**: cbm carryover; convenience, not blocking.

**Acceptance Criteria**:

1. WHEN a project name tail is unique THEN resolution SHALL return the project
2. WHEN a project name tail is ambiguous (multiple matches) THEN resolution SHALL error with candidates listed
3. WHEN no match THEN resolution SHALL return not-found

**Independent Test**: Index project `foo/bar/my-project` → resolve by `my-project` → if unique, return; if ambiguous, error with candidates.

---

### P3: M26 Composite/Escaped JSON Property Extraction

**User Story**: As a tool consumer, I want composite/escaped JSON properties extracted correctly so that nested or escaped JSON in tool responses is parseable.

**Why P3**: cbm carryover; correctness edge case.

**Acceptance Criteria**:

1. WHEN a JSON property contains escaped characters THEN extraction SHALL unescape and return the correct value
2. WHEN a JSON property is composite (nested object/array) THEN extraction SHALL return the full nested structure
3. WHEN extraction fails THEN it SHALL return a clear error (not silent garbage)

**Independent Test**: Feed response with escaped JSON property → extract → verify unescaped value correct.

---

### P3: M62 Verify Node Tree-Sitter Binding GLR Stack-Merge Depth Cap

**User Story**: As a maintainer, I want to verify the Node tree-sitter binding's GLR stack-merge depth cap so that ambiguity-handling limits are documented or fixed.

**Why P3**: Plan: "Verify" — audit, then fix only if defect found.

**Acceptance Criteria**:

1. WHEN the GLR stack-merge depth is probed THEN the verifier SHALL document the current cap (if any) and whether it affects massa-th0th's grammars
2. WHEN a defect is found THEN it SHALL be reported with a fix proposal (not silently fixed)
3. WHEN no defect is found THEN the verification SHALL be documented in `docs/` or `.specs/`

**Independent Test**: Run a probe with ambiguous grammar input → document GLR behavior → report cap or absence.

---

## Edge Cases

- WHEN a decomposed module is imported by a path that no longer exists THEN the barrel re-export SHALL maintain backward compatibility (no broken imports)
- WHEN embedded MCP mode is used with a tool that requires file I/O (e.g., `index`) THEN it SHALL work without HTTP multipart (direct filesystem access)
- WHEN the hook binary receives malformed JSON THEN it SHALL exit 0 with no POST (same as shell `jq` failure → no POST)
- WHEN the parallel runner has zero suites THEN UNION GUARD SHALL pass (empty list = empty result-set)
- WHEN the dashboard loads with scheduler disabled THEN it SHALL show "scheduler disabled" not crash
- WHEN the preset is set but master switch is off THEN no jobs SHALL run (preset does not bypass master)
- WHEN `--recover` is invoked with a non-existent `projectId` THEN it SHALL error with not-found
- WHEN name-tail resolution matches the caller's own project THEN it SHALL NOT exclude self (explicit is better)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| -------------- | ----- | ----- | ------ |
| W6-01 | P1: N31 God-File Decomposition | Design | Pending |
| W6-02 | P1: N32 Embedded MCP Mode | Design | Pending |
| W6-03 | P1: N30 Hook Binary | Design | Pending |
| W6-04 | P1: N20 Parallel Test Runner | Design | Pending |
| W6-05 | P1: N21 Test-Seam Coupling | Design | Pending |
| W6-06 | P1: N28 Dashboard | Design | Pending |
| W6-07 | P1: N29 Scheduler Preset | Design | Pending |
| W6-08 | P2: N17 Harness Protocol | Execute | Pending |
| W6-09 | P2: N18 Deterministic Script | Execute | Pending |
| W6-10 | P2: N19 Admin Preservation | Execute | Pending |
| W6-11 | P2: N42 Path Recovery | Execute | Pending |
| W6-12 | P3: M25 Name Resolution | Execute | Pending |
| W6-13 | P3: M26 JSON Extraction | Execute | Pending |
| W6-14 | P3: M62 GLR Verification | Execute | Pending |

**Coverage:** 14 total, 14 mapped to tasks, 0 unmapped.

---

## Implicit-Requirement Sweep (Large/Complex — full)

| Dimension | Resolution |
| --------- | ---------- |
| Input validation & bounds | Hook binary validates stdin JSON; parallel runner validates suite list ≠ empty before run; `--recover` validates projectId format; name-tail resolution validates non-empty input |
| Failure / partial-failure states | Hook binary: exit 0 always (fire-and-forget); embedded mode: ToolError shape identical to HTTP; parallel runner: crashed suite = failed not dropped; dashboard: scheduler-disabled shows message not crash |
| Idempotency / retry / duplicate handling | Hook binary: idempotent POST (same payload → same observation); `--recover`: idempotent re-association; scheduler preset: does not re-enable already-enabled jobs |
| Auth boundaries & rate limits | N19: four-rung ladder (no users → admin open → first user → auth required); no full auth system; N19 is preservation logic only |
| Concurrency / ordering | Parallel runner: independent suites concurrent, serial tail for deadline-sensitive; UNION GUARD prevents silent drops; embedded mode: no HTTP concurrency concerns (in-process) |
| Data lifecycle / expiry | No new persisted data (decomposition is behavior-preserving); dashboard reads existing data; scheduler preset modifies runtime config only; hook binary has no persistence |
| Observability | Dashboard IS observability (N28); hook lag surfaced from WriterQueue.pendingCount; scheduler health from scheduler.status(); Synapse count from /api/v1/synapse/sessions |
| External-dependency failure | Embedded mode: no external REST dependency; hook binary: POST failure → exit 0 (same as shell); dashboard: missing endpoint → show "unavailable" not crash |
| State-transition integrity | Scheduler preset: master switch + per-job + preset precedence (individual env > preset > default); N19: no-users → first-user transition is one-way (admin open → auth required) |

---

## Success Criteria

- [ ] All 4 god-files decomposed, no module > 600 LOC, characterization tests green
- [ ] Embedded MCP mode works with one process (no REST server required)
- [ ] Single `massa-th0th-hook` binary replaces 7 shell scripts, typed payloads, exit 0 always
- [ ] Parallel test runner with ZERO-LOSS union guard reduces wall-clock
- [ ] Test-seam catches format drift locally before CI
- [ ] `/dashboard` shows scheduler, hook lag, Synapse sessions
- [ ] Scheduler safe-defaults preset enables consolidation+decay in one env var
- [ ] Harness protocol + deterministic script documented
- [ ] Admin preservation logic + path recovery + name resolution + JSON extraction + GLR verification done
- [ ] All acceptance criteria pass with independent verifier; no tests weakened