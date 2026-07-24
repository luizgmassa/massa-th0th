# Wave 7 — Hygiene, UI, Process, Decisions Specification

## Problem Statement

massa-ai Waves 1–6 shipped core indexing, cross-pollination features, and architecture refactors. Wave 7 closes the remaining hygiene, UI, process, and decision items from the v3 improvement plan: repo-root AGENTS.md, runtime version pinning, LLM/embedding default alignment, CHANGELOG merge gate, D5 Cypher deferral removal, web UI write mode, stale doc cleanup, OS-level sandbox for the executor, json_schema constrained decoding, spec archive, and branch/state reconciliation. These items remove accumulated tech debt, harden the executor security boundary, and make the repo self-documenting for the agent startup contract.

## Goals

- [ ] Repo root `AGENTS.md` so the global startup contract resolves runtime routing
- [ ] Runtime version pinning at repo level (`.tool-versions` + `mise.toml`)
- [ ] LLM/embedding model defaults aligned across config, health-checker, and docs
- [ ] `CHANGELOG.md` with `[Unreleased]` section enforced as a merge gate
- [ ] D5 Cypher subset deferral formally removed via ADR
- [ ] Web UI full write mode (memory edit/delete, proposal approve/reject) + SSE real-time + markdown tables/highlight
- [ ] Stale `compression.llm` doc references removed
- [ ] Abandoned features (multi-tenant, subagents, ADRs from commit 5547afc) documented as removed; `docs/` kept
- [ ] `format: json_schema` constrained decoding for Ollama structured LLM calls
- [ ] OS-level sandbox (Docker on Linux, seatbelt on macOS) for execute/execute_file/batch_execute
- [ ] `.specs/HANDOFF.md` + `.specs/PHASE-INTEGRATION.md` archived to `.specs/archive/`
- [ ] Wave-2 branch pushed / STATE.md staleness reconciled
- [ ] Hook deadline breadcrumb-on-fire observability

## Out of Scope

| Feature | Reason |
| --- | --- |
| N37 search `format` param | Already shipped in Wave 5 (FR-06). Verified: `tool-defs-search.ts:79` has `format: { enum: ["json","toon","tree"] }`. |
| N38 NotebookLM integration | User building parallel `massa-vault` system (personal OSS NotebookLM with local agent + Obsidian). Will integrate with that instead. |
| M60 originality-check manifest | No LSP-tier logic planned. Conditional — not triggered. |
| M61 watcher FNV-1a dirty-state signature | No file watcher planned. Conditional — not triggered. |
| M64 squash empty "Initial plan" commits | History rewrite risk to downstream clones/forks. User chose skip. |
| Multi-tenant / subagents / ADR resurrection | Commit 5547afc intentionally removed these. User confirmed removal. |

---

## Assumptions & Open Questions

| Assumption / decision | Chosen default | Rationale | Confirmed? |
| --- | --- | --- | --- |
| M30 D5 Cypher | Remove deferral + ADR | Structural graph traversal (trace_path, impact_analysis, architecture) covers use cases. D1–D4 equivalent (native tree-sitter) complete. User confirmed. | y |
| M57 abandoned features | Document as removed + keep docs/ | User confirmed. docs/ retains glr-verification.md + path-recovery.md + new additions. | y |
| M64 empty commits | Skip — not worth risk | History rewrite breaks downstream clones. User confirmed. | y |
| N38 NotebookLM | Skip — massa-vault parallel | User building massa-vault (personal OSS NotebookLM). Will integrate there. | y |
| N40 sandbox | Docker (Linux) + seatbelt (macOS) | User chose full OS-level sandbox over doc-only. | y |
| M31 web UI | Full write mode + SSE + markdown | User chose all three. N27 SSE push + N28 dashboard shipped Wave 6; remaining = write mode + markdown rendering. | y |
| M60/M61 | Skip — not planned | No LSP or watcher planned. User confirmed. | y |
| N39 json_schema | Implement in Wave 7 | User confirmed. Improves generateObject reliability for qwen2.5. | y |
| `compression.llm` removal | Code already clean (dropped in `da4c60f`); only stale doc refs remain | Grep confirmed zero `compression.llm` in `packages/shared/src/config/*.ts` active code. | y |
| Wave-2 branch | Push to origin + reconcile STATE.md | `wave-2` exists on origin only (not local). STATE.md still references it. | y |

**Open questions:** none — all resolved or logged above.

---

## User Stories

### P1: AGENTS.md at repo root ⭐ MVP

**User Story**: As an agent using the massa-ai startup contract, I want an `AGENTS.md` at the repo root so that the global CLAUDE.md startup contract resolves runtime routing.

**Why P1**: The global CLAUDE.md references `AGENTS.md` at the repo root for runtime workflow routing. Its absence blocks the startup contract.

**Acceptance Criteria**:

1. WHEN an agent starts in the massa-ai repo THEN the repo root SHALL contain `AGENTS.md` with project-specific routing guidance (projectId resolution, workflow selection hints, indexing exclusions, plan-challenge policy, conversation-feedback policy)
2. WHEN `AGENTS.md` is read THEN it SHALL reference `.specs/project/STATE.md`, `.specs/project/FEATURES.json`, and the skill paths that actually exist (`massa-ai-memory/`, `synapse-usage/`)
3. WHEN `AGENTS.md` is read THEN it SHALL NOT reference paths that do not exist in this repo (e.g., `skills/massa-ai/SKILL.md`, `skills/persona-router/SKILL.md` — those are global, not repo-local)

**Independent Test**: `ls AGENTS.md && head -20 AGENTS.md` shows project routing.

---

### P1: Runtime version pinning ⭐ MVP

**User Story**: As a developer cloning massa-ai, I want `.tool-versions` and `mise.toml` pinning Bun 1.3.14 + Node 25.9 so that my local runtime matches CI and Dockerfile.

**Why P1**: Dockerfile pins versions but repo-level does not. Version drift causes native addon ABI mismatches.

**Acceptance Criteria**:

1. WHEN `.tool-versions` is read THEN it SHALL contain `bun 1.3.14` and `nodejs 25.9.0`
2. WHEN `mise.toml` is read THEN it SHALL contain `[tools]` with `bun = "1.3.14"` and `node = "25.9.0"`
3. WHEN a developer runs `mise install` THEN the installed Bun and Node versions SHALL match the Dockerfile pins

**Independent Test**: `cat .tool-versions mise.toml` shows matching versions.

---

### P1: LLM/embedding defaults alignment ⭐ MVP

**User Story**: As a user configuring massa-ai, I want consistent LLM/embedding model defaults across config, health-checker, and docs so that I don't get conflicting guidance.

**Why P1**: Config says `qwen2.5:7b-instruct`, health-checker says `nomic-embed-text:latest`, embedding config defaults to `qwen3-embedding:8b`. Users get confused.

**Acceptance Criteria**:

1. WHEN `local-health-checker.ts` checks Ollama embedding model availability THEN it SHALL use the same default as `config.embedding.model` (not a hardcoded `nomic-embed-text:latest`)
2. WHEN the README documents default models THEN it SHALL list the exact same defaults as `config/index.ts` `DEFAULT_LLM_MODEL`, `DEFAULT_LLM_CODE_MODEL`, and `massa-ai-config.ts` `embedding.model`
3. WHEN `config.embedding.model` is read THEN it SHALL be consistent with the health-checker's expected model (both derive from the same source)

**Independent Test**: `grep -r "nomic-embed-text" packages/core/src/services/health/` returns no hardcoded default that conflicts with config.

---

### P1: CHANGELOG merge gate ⭐ MVP

**User Story**: As a maintainer, I want a `CHANGELOG.md` with an `[Unreleased]` section enforced as a merge gate so that every PR documents user-facing changes.

**Why P1**: No CHANGELOG exists. Releases have no structured history.

**Acceptance Criteria**:

1. WHEN `CHANGELOG.md` is read THEN it SHALL have an `[Unreleased]` section at the top
2. WHEN a PR is opened THEN CI SHALL check that `CHANGELOG.md` was modified (or the PR is labeled `no-changelog`)
3. WHEN `CHANGELOG.md` is read THEN it SHALL follow Keep a Changelog format (## [Unreleased], ## [version] - date, ### Added/Changed/Deprecated/Removed/Fixed/Security)

**Independent Test**: `head -10 CHANGELOG.md` shows `[Unreleased]` + Keep a Changelog format.

---

### P1: D5 Cypher deferral removal ⭐ MVP

**User Story**: As a maintainer, I want the D5 Cypher subset deferral formally removed via ADR so that the roadmap no longer carries an open deferred item.

**Why P1**: The deferral has been open since native-ts-platform-expansion. Native tree-sitter structural indexing (the D1–D4 equivalent) is complete. Structural graph tools cover the use cases.

**Acceptance Criteria**:

1. WHEN `.specs/features/native-ts-platform-expansion/design.md` is read THEN the D5 Cypher deferral SHALL be marked as closed/superseded by ADR
2. WHEN the ADR is read THEN it SHALL record the decision to remove the Cypher subset, the rationale (structural graph traversal covers use cases), and the date
3. WHEN `TODO.md` is read (if it exists) THEN it SHALL NOT list D5 Cypher as deferred

**Independent Test**: ADR file exists in `docs/adr/` or `.specs/` with D5 closure rationale.

---

### P2: Web UI write mode + SSE + markdown

**User Story**: As a web UI user, I want to edit/delete memories, approve/reject proposals, see real-time updates via SSE, and read markdown tables/highlight so that the web UI is a full management surface.

**Why P2**: Web UI is currently read-only over memories/search. Wave 6 added dashboard + SSE push for index_status. Remaining: write operations + markdown rendering.

**Acceptance Criteria**:

1. WHEN a user opens the web UI THEN it SHALL show a memory list with edit/delete buttons (gated by `MASSA_AI_WEB_WRITE_MODE=true`, default off)
2. WHEN a user edits a memory via the web UI THEN the change SHALL persist via `PUT /api/v1/memory/:id` and the list SHALL update in-place
3. WHEN a user deletes a memory via the web UI THEN the deletion SHALL persist via `DELETE /api/v1/memory/:id` with a confirmation dialog
4. WHEN a user views proposals THEN the web UI SHALL show approve/reject buttons that call the proposal API
5. WHEN an index_status job updates THEN the dashboard SHALL receive a real-time SSE push (already shipped Wave 6 N27 — verify still works)
6. WHEN the web UI renders markdown content THEN it SHALL render tables, code blocks with syntax highlighting, and inline code

**Independent Test**: Open web UI, edit a memory, verify it persists; render a markdown table.

---

### P2: json_schema constrained decoding

**User Story**: As a developer using structured LLM calls, I want `format: json_schema` constrained decoding for Ollama so that `generateObject` responses are reliably valid JSON.

**Why P2**: Current reasoning-channel fallback works but is fragile. Ollama supports `format: json_schema` natively for constrained decoding.

**Acceptance Criteria**:

1. WHEN `llm-client.ts` calls Ollama `generateObject` THEN it SHALL pass the Zod schema as `format: { type: "object", json_schema: <compiled> }` when the Ollama version supports it
2. WHEN Ollama returns a response THEN `llm-client.ts` SHALL validate it against the Zod schema before returning
3. WHEN Ollama does not support `json_schema` format THEN `llm-client.ts` SHALL fall back to the current reasoning-channel behavior (graceful degradation)
4. WHEN the `json_schema` path is used THEN the response SHALL be valid JSON matching the schema (no reasoning-channel fallback needed)

**Independent Test**: Unit test mocks Ollama with `json_schema` support, asserts the format param is passed; integration test (gated on Ollama up) asserts valid structured output.

---

### P2: OS-level sandbox for executor

**User Story**: As a user running `execute`/`execute_file`/`batch_execute`, I want OS-level sandboxing (Docker on Linux, seatbelt on macOS) so that user-supplied code cannot escape the process boundary.

**Why P2**: Current executor has best-effort containment (timeout + env denylist + boundary check). No OS-level isolation. User chose full sandbox.

**Acceptance Criteria**:

1. WHEN `execute` runs on macOS THEN the child process SHALL be wrapped in `sandbox-exec` with a seatbelt profile that restricts file writes to the sandbox tmpdir + read-only project root
2. WHEN `execute` runs on Linux THEN the child process SHALL be wrapped in a Docker container with read-only project root mount + tmpfs sandbox dir + no network
3. WHEN `MASSA_AI_EXECUTOR_SANDBOX=none` is set THEN the executor SHALL fall back to current best-effort containment (opt-out for dev/CI)
4. WHEN the sandbox fails to start (Docker not available, seatbelt profile missing) THEN the executor SHALL error with a teaching message, NOT fall back silently
5. WHEN `execute_file` runs THEN the file read SHALL be confined to the project boundary + deny-glob (existing checks preserved, sandbox added on top)
6. WHEN the sandbox is active THEN env denylist + timeout + cwd restrictions SHALL still apply (defense-in-depth)

**Independent Test**: Unit test mocks sandbox spawn, asserts profile/container args; integration test (gated on Docker/macOS) runs `execute` with a file-write attempt outside tmpdir, asserts it's blocked.

---

### P3: Stale compression.llm doc cleanup

**User Story**: As a reader of massa-ai docs, I want no stale `compression.llm` references so that I don't try to use a removed config path.

**Why P3**: Code already dropped `compression.llm` in `da4c60f`. Only stale refs in `.specs/PHASE-INTEGRATION.md`, README, and old design docs remain.

**Acceptance Criteria**:

1. WHEN `grep -r "compression.llm" README.md packages/ apps/` is run THEN zero active code references SHALL remain (only `.specs/` historical artifacts may reference it as completed history)
2. WHEN README.md is read THEN the `compression.llm` note SHALL be replaced with a "removed in X commit" note or deleted entirely

**Independent Test**: `grep "compression.llm" README.md` returns no active config documentation.

---

### P3: Abandoned features documentation

**User Story**: As a new contributor, I want documented context that multi-tenant, subagents, and ADRs were intentionally removed so that I don't try to resurrect them.

**Why P3**: Commit 5547afc deleted ~6000 lines. No documentation explains why.

**Acceptance Criteria**:

1. WHEN `docs/removed-features.md` is read THEN it SHALL document that multi-tenant, subagents, and ADR docs were removed in commit 5547afc with rationale (scope narrowing to local-first single-user)
2. WHEN `docs/removed-features.md` is read THEN it SHALL list the removed docs (01-overview through 15-multi-tenant-examples + MULTI-PROVIDER-EMBEDDINGS)
3. WHEN `docs/` is listed THEN it SHALL contain `removed-features.md` alongside existing `glr-verification.md` and `path-recovery.md`

**Independent Test**: `cat docs/removed-features.md` lists removed features + rationale.

---

### P3: Spec archive

**User Story**: As a maintainer, I want `.specs/HANDOFF.md` (27 KB) and `.specs/PHASE-INTEGRATION.md` (50 KB) archived so that the `.specs/` root stays navigable.

**Why P3**: These files are stacked history, 5+ "Previous" sections. They slow down `.specs/` navigation.

**Acceptance Criteria**:

1. WHEN `.specs/archive/` is listed THEN it SHALL contain `HANDOFF.md` and `PHASE-INTEGRATION.md` moved from `.specs/`
2. WHEN `.specs/HANDOFF.md` is checked THEN it SHALL be a fresh file with only the current Wave 7 context (not stacked history)
3. WHEN the archive is read THEN git history SHALL preserve the prior content (move, not delete)

**Independent Test**: `ls .specs/archive/` shows moved files; `git mv` in commit history.

---

### P3: Wave-2 branch push / STATE.md reconciliation

**User Story**: As a maintainer, I want the Wave-2 branch pushed to origin and STATE.md reconciled so that the branch inventory and state docs are accurate.

**Why P3**: `wave-2` is remote-only (not local). STATE.md still references it as active. Stale state confuses new sessions.

**Acceptance Criteria**:

1. WHEN `git branch -a` is run THEN `wave-2` SHALL exist both locally and on origin
2. WHEN STATE.md is read THEN the Wave 2 section SHALL be marked as complete (not active) with merge status documented
3. WHEN STATE.md is read THEN the "Current" section SHALL reflect Wave 7 as the active feature

**Independent Test**: `git branch --list wave-2` shows local branch; STATE.md "Current" section shows Wave 7.

---

### P3: Hook deadline breadcrumb-on-fire

**User Story**: As an operator, I want hook deadline breadcrumbs when the hook fires near its timeout so that I can diagnose slow hooks.

**Why P3**: Hook scripts are fire-and-forget. No observability when they approach the deadline.

**Acceptance Criteria**:

1. WHEN a hook POST takes > 80% of its deadline THEN the hook script SHALL log a breadcrumb (timestamp, elapsed ms, hook type) to stderr
2. WHEN a hook POST times out THEN the hook script SHALL log a "deadline-on-fire" breadcrumb with the elapsed time and AbortSignal reason
3. WHEN the breadcrumb is logged THEN it SHALL be parseable (JSON line or structured key=value)

**Independent Test**: Unit test mocks a slow endpoint, asserts breadcrumb is logged.

---

## Edge Cases

- WHEN `MASSA_AI_WEB_WRITE_MODE` is unset THEN web UI write buttons SHALL be hidden (default off)
- WHEN Docker is not installed on Linux THEN executor sandbox SHALL error with "Docker not found; set MASSA_AI_EXECUTOR_SANDBOX=none to disable" (not silent fallback)
- WHEN `mise.toml` and `.tool-versions` conflict THEN `.tool-versions` SHALL take precedence (mise reads it first)
- WHEN Ollama version < 0.5.0 (no json_schema support) THEN llm-client SHALL use reasoning-channel fallback (graceful degradation)
- WHEN `CHANGELOG.md` has no `[Unreleased]` section THEN CI SHALL fail with "Add [Unreleased] section to CHANGELOG.md"
- WHEN AGENTS.md references a skill path that doesn't exist THEN startup SHALL warn but not crash (graceful)

---

## Requirement Traceability

| Requirement ID | Story | Phase | Status |
| --- | --- | --- | --- |
| W7-01 | P1: AGENTS.md | Design | Pending |
| W7-02 | P1: Version pinning | Design | Pending |
| W7-03 | P1: LLM/embedding alignment | Design | Pending |
| W7-04 | P1: CHANGELOG merge gate | Design | Pending |
| W7-05 | P1: D5 Cypher removal | Design | Pending |
| W7-06 | P2: Web UI write mode | Design | Pending |
| W7-07 | P2: json_schema decoding | Design | Pending |
| W7-08 | P2: OS-level sandbox | Design | Pending |
| W7-09 | P3: compression.llm cleanup | Execute | Pending |
| W7-10 | P3: Abandoned features doc | Execute | Pending |
| W7-11 | P3: Spec archive | Execute | Pending |
| W7-12 | P3: Wave-2 push/reconcile | Execute | Pending |
| W7-13 | P3: Hook deadline breadcrumb | Execute | Pending |

**Coverage:** 13 total, 13 mapped to stories, 0 unmapped.

---

## Success Criteria

- [ ] Repo root `AGENTS.md` exists and resolves the startup contract
- [ ] `.tool-versions` + `mise.toml` pin Bun 1.3.14 + Node 25.9.0
- [ ] LLM/embedding defaults consistent across config + health-checker + docs
- [ ] `CHANGELOG.md` with `[Unreleased]` + CI merge gate
- [ ] D5 Cypher ADR closes the deferral
- [ ] Web UI write mode + markdown rendering works
- [ ] `format: json_schema` passed to Ollama when supported
- [ ] OS-level sandbox wraps executor (Docker Linux / seatbelt macOS)
- [ ] Stale `compression.llm` docs cleaned
- [ ] `docs/removed-features.md` documents 5547afc removal
- [ ] `.specs/HANDOFF.md` + `PHASE-INTEGRATION.md` archived
- [ ] Wave-2 branch local + STATE.md reconciled
- [ ] Hook deadline breadcrumb-on-fire observability
- [ ] All gates green (type-check 6/6, build 5/5, focused tests pass)