# Wave 7 — Hygiene, UI, Process, Decisions Tasks

## Execution Protocol (MANDATORY -- do not skip)

Implement these tasks with the `massa-ai` skill: **activate it by name and follow its Execute flow and Critical Rules.** Do not search for skill files by filesystem path. The skill is the source of truth for the full flow (per-task cycle, sub-agent delegation, adequacy review, Verifier, discrimination sensor).

**If the skill cannot be activated, STOP and tell the user — do not proceed without it.**

---

**Design**: `.specs/features/wave-7-hygiene-ui-process/design.md`
**Status**: Draft

---

## Project Testing Guidelines Scan

Scanned: `package.json` scripts, `.github/workflows/ci.yml`, existing test patterns.

- Test runner: `bun test` (Bun-native, no jest/vitest)
- Type-check: `bun run type-check` (6 tsc projects)
- Build: `bun run build` (turbo build, 5 packages)
- Test location: co-located `*.test.ts` alongside source, `__tests__/` dirs for suites
- CI gates: type-check + build + test on ubuntu-latest + macos-14 + linux structural
- Existing executor tests: `packages/core/src/__tests__/executor.test.ts`
- Existing hook tests: `apps/claude-plugin/hooks/__tests__/massa-ai-hook.test.ts`
- Existing web UI: no test files (static HTML/JS, served by tools-api)
- No coverage thresholds found; strong defaults applied per spec ACs

---

## Test Coverage Matrix

> Generated from codebase, project guidelines, and spec — confirm before Execute. Guidelines found: `package.json` scripts, `.github/workflows/ci.yml`, existing `*.test.ts` patterns.

| Code Layer | Required Test Type | Coverage Expectation | Location Pattern | Run Command |
| ---------- | ------------------ | -------------------- | ---------------- | ----------- |
| Executor sandbox wrapper | unit | All branches: sandbox available/unavailable, auto/on/none modes, Docker+seatbelt paths | `packages/core/src/__tests__/sandbox.test.ts` | `cd packages/core && bun test src/__tests__/sandbox.test.ts` |
| LLM client json_schema | unit | json_schema path + fallback path + version gate + observability log | `packages/core/src/__tests__/llm-client-json-schema.test.ts` | `cd packages/core && bun test src/__tests__/llm-client-json-schema.test.ts` |
| Health-checker config | unit | Asserts health-checker reads config embedding model, not hardcoded | `packages/core/src/__tests__/health-checker-config.test.ts` | `cd packages/core && bun test src/__tests__/health-checker-config.test.ts` |
| Hook breadcrumb | unit | >80% deadline breadcrumb + timeout breadcrumb + parseable format | `apps/claude-plugin/hooks/__tests__/hook-breadcrumb.test.ts` | `cd apps/claude-plugin && bun test hooks/__tests__/hook-breadcrumb.test.ts` |
| Web UI write mode | e2e | Edit memory, delete memory, approve proposal, reject proposal, write-mode-off hides buttons | `apps/web-ui/src/__tests__/write-mode.test.ts` | `cd apps/web-ui && bun test src/__tests__/write-mode.test.ts` |
| AGENTS.md / version pins / CHANGELOG / docs / archive / D5 ADR | none | — (artifact check only) | — | artifact check (file exists, content grep) |
| CI CHANGELOG gate | none | — (CI workflow artifact check) | — | artifact check (grep ci.yml) |

---

## Gate Check Commands

> Generated from codebase — confirm before Execute.

| Gate Level | When to Use | Command |
| ---------- | ----------- | ------- |
| Quick | After tasks with unit tests only | `cd packages/core && bun test src/__tests__/<test>.test.ts` |
| Full | After tasks with e2e/integration tests | `bun run type-check && bun run build && bun run test` |
| Build | After phase completion or config/entity-only tasks | `bun run type-check && bun run build` |
| Artifact | After doc/config/CI-only tasks | `grep -c <pattern> <file> && test -f <file>` |

---

## Execution Plan

Phases are ordered and run sequentially — each phase completes before the next begins, and tasks within a phase execute in order.

### Phase 1: P1 Hygiene (foundation)

T1 → T2 → T3 → T4 → T5 → T6 → T7

### Phase 2: P2 Features (web UI, LLM, sandbox)

T8 → T9 → T10 → T11 → T12

### Phase 3: P3 Cleanup (docs, archive, reconcile, hook)

T13 → T14 → T15 → T16 → T17 → T18

---

## Task Breakdown

### T1: Create AGENTS.md at repo root

**What**: Create `AGENTS.md` with project-specific routing guidance for the startup contract
**Where**: `AGENTS.md` (repo root)
**Depends on**: None
**Reuses**: Global CLAUDE.md structure, `.specs/project/STATE.md` paths, `massa-ai-memory/` + `synapse-usage/` skill dirs
**Requirement**: W7-01

**Tools**: NONE

**Done when**:
- [ ] `AGENTS.md` exists at repo root
- [ ] Contains projectId resolution section (derive from workspace root)
- [ ] Contains indexing exclusions (node_modules, .venv, __pycache__, etc.)
- [ ] References `.specs/project/STATE.md`, `.specs/project/FEATURES.json`
- [ ] References `massa-ai-memory/` + `synapse-usage/` (not non-existent `skills/massa-ai/SKILL.md`)
- [ ] Contains plan-challenge policy + conversation-feedback policy

**Tests**: none
**Gate**: artifact (`test -f AGENTS.md && grep -c "projectId" AGENTS.md`)

**Commit**: `docs(agents): add repo-root AGENTS.md for startup contract routing`

---

### T2: Add .tool-versions + mise.toml version pins

**What**: Create `.tool-versions` and `mise.toml` pinning Bun 1.3.14 + Node 25.9.0
**Where**: `.tool-versions`, `mise.toml` (repo root)
**Depends on**: None
**Reuses**: Dockerfile pins (`oven/bun:1.3.14-alpine`), ci.yml pins (`bun-version: 1.3.14`, `node-version-file: '.node-version'`)
**Requirement**: W7-02

**Tools**: NONE

**Done when**:
- [ ] `.tool-versions` contains `bun 1.3.14` and `nodejs 25.9.0`
- [ ] `mise.toml` contains `[tools]` with `bun = "1.3.14"` and `node = "25.9.0"`
- [ ] Versions match Dockerfile + ci.yml exactly

**Tests**: none
**Gate**: artifact (`grep "1.3.14" .tool-versions && grep "25.9.0" .tool-versions && grep "1.3.14" mise.toml`)

**Commit**: `chore(tooling): pin Bun 1.3.14 + Node 25.9.0 via .tool-versions and mise.toml`

---

### T3: Align LLM/embedding defaults in health-checker

**What**: Replace hardcoded `nomic-embed-text:latest` in `local-health-checker.ts:43` with `config.get("embedding").model`
**Where**: `packages/core/src/services/health/local-health-checker.ts:43-44`
**Depends on**: None
**Reuses**: `config` from `@massa-ai/shared`, existing `config.get("embedding")` pattern
**Requirement**: W7-03

**Tools**: NONE

**Done when**:
- [ ] `local-health-checker.ts` reads `config.get("embedding").model` instead of hardcoding `nomic-embed-text:latest`
- [ ] Unit test asserts health-checker uses config model (mock config, assert no hardcoded literal)
- [ ] `grep "nomic-embed-text" packages/core/src/services/health/` returns no hardcoded default
- [ ] Gate: quick (`cd packages/core && bun test src/__tests__/health-checker-config.test.ts`)

**Tests**: unit
**Gate**: quick

**Commit**: `fix(health): use config embedding model in local-health-checker, not hardcoded default`

---

### T4: Create CHANGELOG.md + CI merge gate

**What**: Create `CHANGELOG.md` with `[Unreleased]` section (Keep a Changelog format) + add CI gate checking CHANGELOG modified (or `no-changelog` label, or bot-authored PRs skip)
**Where**: `CHANGELOG.md` (repo root), `.github/workflows/ci.yml`
**Depends on**: None
**Reuses**: `dorny/paths-filter@v3` pattern from ci.yml:66
**Requirement**: W7-04

**Tools**: NONE

**Done when**:
- [ ] `CHANGELOG.md` exists with `[Unreleased]` section at top
- [ ] Follows Keep a Changelog format (## [Unreleased], ### Added/Changed/Deprecated/Removed/Fixed/Security)
- [ ] ci.yml has a `changelog` filter step checking `CHANGELOG.md` modified
- [ ] Gate fails if CHANGELOG not modified AND no `no-changelog` label AND PR author is not a bot
- [ ] Gate: artifact (`head -5 CHANGELOG.md && grep "changelog" .github/workflows/ci.yml`)

**Tests**: none
**Gate**: artifact

**Commit**: `docs(changelog): add CHANGELOG.md with [Unreleased] section + CI merge gate`

---

### T5: Remove D5 Cypher deferral via ADR

**What**: Create ADR in `docs/adr/0001-remove-d5-cypher-subset.md` documenting the decision to remove the Cypher subset deferral. Update `.specs/features/native-ts-platform-expansion/design.md` to mark D5 as closed.
**Where**: `docs/adr/0001-remove-d5-cypher-subset.md`, `.specs/features/native-ts-platform-expansion/design.md`
**Depends on**: None
**Reuses**: ADR format from `.specs/features/` patterns
**Requirement**: W7-05

**Tools**: NONE

**Done when**:
- [ ] `docs/adr/0001-remove-d5-cypher-subset.md` exists with decision, rationale, date
- [ ] Rationale: structural graph traversal (trace_path, impact_analysis, architecture) covers use cases; D1–D4 equivalent complete
- [ ] `.specs/features/native-ts-platform-expansion/design.md` D5 reference marked as closed/superseded by ADR
- [ ] Gate: artifact (`test -f docs/adr/0001-remove-d5-cypher-subset.md && grep -c "D5" docs/adr/0001-remove-d5-cypher-subset.md`)

**Tests**: none
**Gate**: artifact

**Commit**: `docs(adr): close D5 Cypher subset deferral — structural graph covers use cases`

---

### T6: Remove stale compression.llm doc references

**What**: Remove/update the `compression.llm` deprecated alias note in README.md:692-693 and any other active doc references
**Where**: `README.md:692-693`
**Depends on**: None
**Reuses**: Code already clean (dropped in `da4c60f`); only doc cleanup
**Requirement**: W7-09

**Tools**: NONE

**Done when**:
- [ ] `README.md` `compression.llm` note replaced with "removed in commit da4c60f" or deleted
- [ ] `grep "compression.llm" README.md` returns no active config documentation (only historical note if kept)
- [ ] `grep "compression.llm" packages/ apps/` returns zero active code references
- [ ] Gate: artifact (`grep -c "compression.llm" README.md` — expect 0 or historical-only)

**Tests**: none
**Gate**: artifact

**Commit**: `docs(config): remove stale compression.llm deprecated alias reference from README`

---

### T7: Document abandoned features in docs/removed-features.md

**What**: Create `docs/removed-features.md` documenting that multi-tenant, subagents, and ADRs were intentionally removed in commit 5547afc with rationale (scope narrowing to local-first single-user)
**Where**: `docs/removed-features.md`
**Depends on**: None
**Reuses**: Commit 5547afc stat (deleted docs/01-overview through 15-multi-tenant-examples + MULTI-PROVIDER-EMBEDDINGS)
**Requirement**: W7-10

**Tools**: NONE

**Done when**:
- [ ] `docs/removed-features.md` exists
- [ ] Lists removed docs (01-overview through 15-multi-tenant-examples + MULTI-PROVIDER-EMBEDDINGS)
- [ ] Documents rationale (scope narrowing to local-first single-user)
- [ ] References commit 5547afc
- [ ] Gate: artifact (`test -f docs/removed-features.md && grep -c "5547afc" docs/removed-features.md`)

**Tests**: none
**Gate**: artifact

**Commit**: `docs(history): document intentionally removed features (commit 5547afc)`

---

### T8: Web UI — add markdown rendering (marked + DOMPurify)

**What**: Add `marked` + `DOMPurify` to web UI for safe markdown table/code/highlight rendering. Load via CDN in index.html. Sanitize all rendered markdown.
**Where**: `apps/web-ui/src/static/index.html`, `apps/web-ui/src/static/app.js`
**Depends on**: None (independent of write mode)
**Reuses**: Existing web UI static asset pattern
**Requirement**: W7-06 (AC6: markdown rendering)

**Tools**: NONE

**Done when**:
- [ ] `index.html` loads `marked` + `DOMPurify` via CDN
- [ ] `app.js` renders memory content via `DOMPurify.sanitize(marked.parse(content))`
- [ ] Never uses raw `innerHTML` with unsanitized markdown (F4 mitigation)
- [ ] Markdown tables, code blocks, inline code render correctly
- [ ] XSS test: memory with `<script>alert('xss')</script>` does not execute
- [ ] Gate: quick (`cd apps/web-ui && bun test src/__tests__/write-mode.test.ts`)

**Tests**: unit (markdown sanitization)
**Gate**: quick

**Commit**: `feat(web-ui): add safe markdown rendering (marked + DOMPurify) with XSS prevention`

---

### T9: Web UI — add write mode (memory edit/delete + proposal approve/reject)

**What**: Add memory edit/delete buttons + proposal approve/reject buttons to web UI, gated by `MASSA_AI_WEB_WRITE_MODE=true` (default off). Wire to existing PUT/DELETE memory + POST proposal approve/reject routes.
**Where**: `apps/web-ui/src/static/app.js`, `apps/web-ui/src/static/index.html`
**Depends on**: T8 (markdown rendering for edit display)
**Reuses**: Existing `PUT /api/v1/memory/:id`, `DELETE /api/v1/memory/:id`, `POST /api/v1/proposal/approve`, `POST /api/v1/proposal/reject`
**Requirement**: W7-06 (AC1-4: write mode)

**Tools**: NONE

**Done when**:
- [ ] Memory list shows edit/delete buttons when `MASSA_AI_WEB_WRITE_MODE=true`
- [ ] Edit button opens inline editor, PUT persists change, list updates in-place
- [ ] Delete button shows confirmation dialog, DELETE persists, list updates
- [ ] Proposal list shows approve/reject buttons when write mode on
- [ ] Buttons hidden when `MASSA_AI_WEB_WRITE_MODE` unset/false
- [ ] E2E test: edit memory, verify persisted; delete with confirm; approve proposal
- [ ] Unit test: buttons hidden when write mode off
- [ ] Gate: full (`bun run type-check && bun run build && bun run test`)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(web-ui): add gated write mode (memory edit/delete + proposal approve/reject)`

---

### T10: Web UI — SSE real-time updates wiring

**What**: Wire web UI to existing SSE endpoint (`/api/v1/events`) for real-time index_status + dashboard updates. Verify Wave 6 N27 SSE still works.
**Where**: `apps/web-ui/src/static/app.js`, `apps/web-ui/src/static/dashboard.js`
**Depends on**: T8 (markdown), T9 (write mode)
**Reuses**: Existing `EventSource` API, existing `/api/v1/events` SSE endpoint
**Requirement**: W7-06 (AC5: SSE real-time)

**Tools**: NONE

**Done when**:
- [ ] Web UI subscribes to `/api/v1/events` via `EventSource`
- [ ] Index_status job updates trigger dashboard refresh
- [ ] Memory list refreshes on new observation events
- [ ] SSE connection handles reconnection gracefully
- [ ] Gate: full (`bun run type-check && bun run build && bun run test`)

**Tests**: e2e
**Gate**: full

**Commit**: `feat(web-ui): wire SSE real-time updates for dashboard + memory list`

---

### T11: Add json_schema constrained decoding to llm-client

**What**: Extend `llmObject` in `llm-client.ts` to pass Zod schema as `format: { type: "json_schema", jsonSchema: { name, schema } }` when Ollama supports it. Add version-gate + observability log + graceful fallback.
**Where**: `packages/core/src/services/memory/llm-client.ts:305-362`
**Depends on**: None
**Reuses**: Existing `generateObject` call, existing `providerOptions.openai.responseFormat` pattern, `zod-to-json-schema` for schema compilation
**Requirement**: W7-07

**Tools**: NONE

**Done when**:
- [ ] `llmObject` checks Ollama version support (cached at startup or per-call)
- [ ] When supported: passes `format: { type: "json_schema", jsonSchema: { name, schema: compiledSchema } }`
- [ ] Compiles Zod schema to JSON Schema via `zod-to-json-schema`
- [ ] When unsupported: falls back to `json_object` (current behavior)
- [ ] Logs when json_schema is used vs when fallback activates (F3 mitigation)
- [ ] Unit test: mock Ollama with json_schema support, assert format param passed
- [ ] Unit test: mock Ollama without support, assert fallback to json_object
- [ ] Unit test: assert graceful degradation on schema compilation error
- [ ] Gate: quick (`cd packages/core && bun test src/__tests__/llm-client-json-schema.test.ts`)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(llm): add json_schema constrained decoding for Ollama structured calls`

---

### T12: Add OS-level sandbox wrapper for executor

**What**: Create `packages/core/src/services/executor/sandbox.ts` wrapping the `#spawn` call with macOS seatbelt (`sandbox-exec`) and Linux Docker (`docker run --rm`). Default `auto` (use if available, fallback to best-effort). `MASSA_AI_EXECUTOR_SANDBOX=none` opts out.
**Where**: `packages/core/src/services/executor/sandbox.ts` (new), `packages/core/src/services/executor/executor.ts:441` (wire into `#spawn`)
**Depends on**: None
**Reuses**: Existing `buildSafeEnv`, `killTree`, `sandboxTmpDir`, `realpathSync` pattern from `executeFile`
**Requirement**: W7-08

**Tools**: NONE

**Done when**:
- [ ] `sandbox.ts` exports `wrapSpawn()`, `isSandboxAvailable()`, `getSandboxMode()`
- [ ] macOS: wraps spawn in `sandbox-exec -p <profile>` with seatbelt profile allowing reads on realpath(project root) + tmpdir, no network, no writes outside tmpdir (F2 mitigation: realpath)
- [ ] Linux: wraps spawn in `docker run --rm --read-only --tmpfs /tmp -v <project>:/project:ro --network none`
- [ ] Default mode `auto`: uses sandbox if available, falls back to best-effort if not (F1 mitigation)
- [ ] `MASSA_AI_EXECUTOR_SANDBOX=none` forces best-effort (current behavior)
- [ ] `MASSA_AI_EXECUTOR_SANDBOX=on` forces sandbox, errors if unavailable (teaching error, not silent fallback)
- [ ] Existing env denylist + timeout + cwd restrictions still apply (defense-in-depth)
- [ ] Unit test: mock sandbox spawn, assert profile/container args
- [ ] Unit test: auto mode falls back when Docker/seatbelt unavailable
- [ ] Unit test: on mode errors when sandbox unavailable
- [ ] Gate: quick (`cd packages/core && bun test src/__tests__/sandbox.test.ts`)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(executor): add OS-level sandbox wrapper (macOS seatbelt + Linux Docker) with auto default`

---

### T13: Archive .specs/HANDOFF.md + PHASE-INTEGRATION.md

**What**: `git mv .specs/HANDOFF.md .specs/archive/HANDOFF.md` + `git mv .specs/PHASE-INTEGRATION.md .specs/archive/PHASE-INTEGRATION.md`. Create fresh `.specs/HANDOFF.md` with only Wave 7 context.
**Where**: `.specs/archive/`, `.specs/HANDOFF.md`
**Depends on**: None
**Reuses**: git mv preserves history
**Requirement**: W7-11

**Tools**: NONE

**Done when**:
- [ ] `.specs/archive/` directory created
- [ ] `.specs/archive/HANDOFF.md` contains old stacked history
- [ ] `.specs/archive/PHASE-INTEGRATION.md` contains old 50KB integration doc
- [ ] `.specs/HANDOFF.md` is fresh with only Wave 7 context (not stacked)
- [ ] git mv in commit history (preserves prior content)
- [ ] Gate: artifact (`test -f .specs/archive/HANDOFF.md && test -f .specs/archive/PHASE-INTEGRATION.md && wc -l .specs/HANDOFF.md`)

**Tests**: none
**Gate**: artifact

**Commit**: `chore(specs): archive stacked HANDOFF.md + PHASE-INTEGRATION.md to .specs/archive/`

---

### T14: Push wave-2 branch + reconcile STATE.md

**What**: Create local `wave-2` branch tracking `origin/wave-2`. Update STATE.md: mark Wave 2 as complete, update "Current" section to Wave 7.
**Where**: `.specs/project/STATE.md`, git branches
**Depends on**: None
**Reuses**: `origin/wave-2` exists on remote
**Requirement**: W7-12

**Tools**: NONE

**Done when**:
- [ ] `git branch wave-2 origin/wave-2` creates local tracking branch
- [ ] STATE.md Wave 2 section marked as complete (not active)
- [ ] STATE.md "Current" section reflects Wave 7 as active feature
- [ ] Gate: artifact (`git branch --list wave-2 && grep "Wave 7" .specs/project/STATE.md`)

**Tests**: none
**Gate**: artifact

**Commit**: `chore(state): reconcile wave-2 branch + mark Wave 2 complete in STATE.md`

---

### T15: Add hook deadline breadcrumb-on-fire

**What**: Add timing measurement inside `postObservation` in `massa-ai-hook.ts`. Log breadcrumb to stderr when POST takes >80% of deadline or on timeout.
**Where**: `apps/claude-plugin/hooks/massa-ai-hook.ts:136-171`
**Depends on**: None
**Reuses**: Existing `fetch` + `AbortSignal.timeout` pattern
**Requirement**: W7-13

**Tools**: NONE

**Done when**:
- [ ] `postObservation` measures elapsed time from fetch start to completion/timeout
- [ ] When elapsed > 80% of `timeoutMs`: logs JSON-line breadcrumb to stderr `{type:"breadcrumb", hook:<subcommand>, elapsed:<ms>, deadline:<ms>, pct:<number>}`
- [ ] On timeout (AbortSignal fires): logs `{type:"deadline-on-fire", hook:<subcommand>, elapsed:<ms>, deadline:<ms>, reason:"timeout"}`
- [ ] Breadcrumb is parseable (JSON line)
- [ ] Unit test: mock slow endpoint (delay > 80% deadline), assert breadcrumb logged
- [ ] Unit test: mock timeout, assert deadline-on-fire breadcrumb
- [ ] Gate: quick (`cd apps/claude-plugin && bun test hooks/__tests__/hook-breadcrumb.test.ts`)

**Tests**: unit
**Gate**: quick

**Commit**: `feat(hooks): add deadline breadcrumb-on-fire observability to massa-ai-hook`

---

## Phase Execution Map

```
Phase 1 → Phase 2 → Phase 3

Phase 1:  T1 ──→ T2 ──→ T3 ──→ T4 ──→ T5 ──→ T6 ──→ T7
Phase 2:  T8 ──→ T9 ──→ T10 ──→ T11 ──→ T12
Phase 3:  T13 ──→ T14 ──→ T15
```

Execution is strictly sequential — there is no intra-phase parallelism. A single agent (or batch worker) works one task at a time, in order.

**Batch packing:** 15 tasks across 3 phases. Phase 1 = 7 tasks (1 batch), Phase 2 = 5 tasks (1 batch), Phase 3 = 3 tasks (1 batch). Total = 3 batches. Sub-agent offer will be presented before Execute.

---

## Task Granularity Check

| Task | Scope | Status |
| ---- | ----- | ------ |
| T1: AGENTS.md | 1 file (doc) | ✅ Granular |
| T2: .tool-versions + mise.toml | 2 files (config) | ✅ Granular |
| T3: health-checker config | 1 file edit + 1 test | ✅ Granular |
| T4: CHANGELOG + CI gate | 2 files (doc + CI) | ✅ Granular |
| T5: D5 Cypher ADR | 2 files (docs) | ✅ Granular |
| T6: compression.llm cleanup | 1 file edit (README) | ✅ Granular |
| T7: removed-features.md | 1 file (doc) | ✅ Granular |
| T8: markdown rendering | 2 files (HTML + JS) + test | ✅ Granular |
| T9: write mode | 2 files (HTML + JS) + test | ✅ Granular |
| T10: SSE wiring | 2 files (JS) | ✅ Granular |
| T11: json_schema | 1 file edit + 1 test | ✅ Granular |
| T12: sandbox | 1 new file + 1 edit + 1 test | ✅ Granular |
| T13: spec archive | git mv + 1 new file | ✅ Granular |
| T14: wave-2 + STATE.md | git branch + 1 file edit | ✅ Granular |
| T15: hook breadcrumb | 1 file edit + 1 test | ✅ Granular |

---

## Diagram-Definition Cross-Check

| Task | Depends On (task body) | Diagram Shows | Status |
| ---- | ---------------------- | ------------- | ------ |
| T1 | None | No incoming arrows | ✅ Match |
| T2 | None | No incoming arrows | ✅ Match |
| T3 | None | No incoming arrows | ✅ Match |
| T4 | None | No incoming arrows | ✅ Match |
| T5 | None | No incoming arrows | ✅ Match |
| T6 | None | No incoming arrows | ✅ Match |
| T7 | None | No incoming arrows | ✅ Match |
| T8 | None | No incoming arrows | ✅ Match |
| T9 | T8 | T8 → T9 arrow | ✅ Match |
| T10 | T8, T9 | T8 → T10, T9 → T10 arrows | ✅ Match |
| T11 | None | No incoming arrows | ✅ Match |
| T12 | None | No incoming arrows | ✅ Match |
| T13 | None | No incoming arrows | ✅ Match |
| T14 | None | No incoming arrows | ✅ Match |
| T15 | None | No incoming arrows | ✅ Match |

---

## Test Co-location Validation

| Task | Code Layer Created/Modified | Matrix Requires | Task Says | Status |
| ---- | --------------------------- | --------------- | --------- | ------ |
| T1 | AGENTS.md (doc) | none | none | ✅ OK |
| T2 | .tool-versions, mise.toml (config) | none | none | ✅ OK |
| T3 | health-checker (service) | unit | unit | ✅ OK |
| T4 | CHANGELOG.md + ci.yml (doc+CI) | none | none | ✅ OK |
| T5 | ADR + design.md (doc) | none | none | ✅ OK |
| T6 | README.md (doc) | none | none | ✅ OK |
| T7 | removed-features.md (doc) | none | none | ✅ OK |
| T8 | web UI app.js + index.html (UI) | unit (markdown sanitization) | unit | ✅ OK |
| T9 | web UI app.js (UI) | e2e | e2e | ✅ OK |
| T10 | web UI app.js + dashboard.js (UI) | e2e | e2e | ✅ OK |
| T11 | llm-client.ts (service) | unit | unit | ✅ OK |
| T12 | sandbox.ts + executor.ts (service) | unit | unit | ✅ OK |
| T13 | .specs/archive/ (artifact move) | none | none | ✅ OK |
| T14 | STATE.md + git branch (state) | none | none | ✅ OK |
| T15 | massa-ai-hook.ts (hook) | unit | unit | ✅ OK |

---

## MCP and Skill Question

No available MCP or skill materially changes implementation or verification for these tasks. All tasks use standard file editing, git operations, and Bun test runner. Context7 MCP could verify `marked`/`DOMPurify` CDN URLs but is not required (well-known stable libraries). Skipped reason: no material impact on correctness or verification.

---

## Artifact-Store Evidence

Active artifact: `.specs/features/wave-7-hygiene-ui-process/tasks.md`
Version: 1 (initial write)
Checksum: recorded via git history on commit