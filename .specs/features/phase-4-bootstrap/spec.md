# Phase 4 — Bootstrap from Repo (Seed Memories): Specification

Slug: `phase-4-bootstrap`. Workflow: `spec-driven` (TLC v3). Plan ref:
`i-want-to-understand-virtual-lantern.md` §"Phase 4 — Bootstrap from repo
[G6]" + cross-cutting decisions §1 (shared LLM), §2 (SQLite first-class),
§3 (EventBus), §5 (additive migrations).

## Problem

A fresh project in massa-th0th starts with an **empty memory store**. An
agent working on it has no pre-loaded context — no understanding of the
repo's architecture, conventions, key entrypoints, or recent direction.
Today every useful memory must be created manually via `remember`.
The feature borrowed from `ai-memory` is **repo bootstrap**: scan a
project root for cheap, high-signal signals (recent git history, README,
docs, package manifests, top-central files from the existing PageRank
ETL) and turn them into **seed memories** (types `pattern`/`code`/
`decision`) so the agent begins with usable context. The LLM summarizes
the gathered signals; when the LLM is off, the system degrades to
rule-based minimal seed memories (or skips seeding) — never throws.

This phase delivers the bootstrap pipeline end-to-end (SQLite-canonical,
local-first, LLM-default-off with silent degradation), an idempotency
contract so re-running is safe, and the `bootstrap:completed` EventBus
event.

## Scope

IN:
- `BootstrapService` (`packages/core/src/services/bootstrap/`) that
  scans a project root for: `git log --oneline` (recent history),
  `README.md`, `docs/`, package manifests (`package.json`, etc.), and
  **top central files** consumed from the existing `project_map`
  PageRank output via `SymbolGraphService.getTopCentralFiles` — no
  centrality reimplementation.
- LLM-driven summarization of the gathered signals into **seed
  memories** (types `pattern`/`code`/`decision`) via the Phase-1
  `llm-client` (`llmObject` + zod schema). Stored through the existing
  memory repository (`MemoryRepository.insert`) so they are searchable
  by the existing recall/fullTextSearch path.
- **Idempotency:** skip if the project is already bootstrapped, detected
  via a stored seed-memory marker (a tag `bootstrap:<projectId>`). A
  `force` flag allows an explicit refresh.
- `bootstrap:completed` EventBus event (added to `EventMap`).
- Silent degradation: when LLM is off, store **rule-based minimal seed
  memories** (derived from README/git log without LLM summarization) OR
  skip seeding with a logged reason — never throws.
- MCP tool `bootstrap` (wired into `tool-definitions.ts`) + a thin
  API route under `apps/tools-api/src/routes/bootstrap.ts` mirroring
  `routes/hooks.ts` / `routes/memory.ts`.
- New `memory.bootstrap` config block (default-off LLM summarization
  gate + sensible defaults; off-switch available).

OUT OF SCOPE (deferred):
- Re-scanning on a schedule. Bootstrap is **on-demand** (triggered by
  the MCP tool / route), consistent with the rest of the codebase which
  has no OS-level job runner. A future periodic refresh can be added.
- Web UI bootstrap trigger (Phase 8).
- Indexing the project as part of bootstrap. Bootstrap CONSUMES
  existing centrality data; if the project is not indexed, centrality
  signals are empty and bootstrap proceeds with the other signals (git,
  README, docs, manifests).
- A second content store. Seed memories are normal memory rows in the
  SQLite-canonical `memories` table — no markdown export, no git
  versioning (cross-cutting: SQLite-canonical chosen).
- Generating Claude Code hook scripts (that was Phase 3).

## Requirements

### R1 — Project scan (signal gathering)
The service MUST gather these signals from a project root (all
best-effort; a missing signal is skipped, never fatal):

| Signal | Source | Cap |
| --- | --- | --- |
| recent git history | `git log --oneline` (run in project root) | last **20** commits |
| README | `README.md` / `README` at root | first **4 KiB** |
| docs | files under `docs/` (shallow glob, `.md`) | top **5** files, **2 KiB** each |
| manifests | `package.json`, `Cargo.toml`, `pyproject.toml`, `go.mod` | parsed name/description/deps summary; **2 KiB** each |
| top central files | `SymbolGraphService.getTopCentralFiles(projectId, limit)` | top **10** (or whatever centrality data exists) |

Unknown/missing files MUST be skipped silently. The gathered bundle is
passed to the LLM summarizer (R2) or the rule-based fallback (R5).

### R2 — LLM-driven seed-memory summarization
When the LLM is enabled, the service MUST call `llmObject(prompt,
SeedMemoriesSchema)` (Phase-1 `llm-client`) to turn the gathered signals
into a bounded list of seed memories. The zod schema MUST enforce:
- `memories`: array (max **8**) of `{ summary, type, level, importance,
  rationale }`;
- `type` ∈ `{ pattern, code, decision }`;
- `level` ∈ `{ 0, 1, 2 }` (MemoryLevel PROJECT/USER/SESSION — seed
  memories default to level 1 = USER so they persist);
- `importance` ∈ `[0,1]`;
- non-empty `summary` (capped at **512** chars on store).

Each produced memory MUST be stored via `MemoryRepository.insert` with
`projectId`, tag `bootstrap:<projectId>`, and metadata
`{ source: "bootstrap", bootstrapId, rationale, signals }`. Stored
memories are normal rows — subject to the existing `deleted_at IS NULL`
+ SUPERSEDES read filters.

### R3 — Idempotency
- On `bootstrap(projectId, { force? })`, the service MUST first check
  whether a seed memory tagged `bootstrap:<projectId>` already exists.
  If yes AND `force` is false → return a **no-op** result
  (`{ bootstrapped: false, reason: "already-bootstrapped",
  skipped: true }`) without storing anything. No throw.
- If `force` is true → proceed (a documented **refresh** behavior:
  stores a fresh batch; does NOT delete prior seed memories — they may
  be superseded later by the consolidation job).
- The marker check MUST go through an injectable seam (default queries
  the DB) so tests stay deterministic and dodge the closed-singleton
  landmine.

### R4 — `bootstrap:completed` EventBus event
On a successful bootstrap (≥1 seed memory stored), the service MUST
publish `bootstrap:completed` on the EventBus with
`{ projectId, bootstrapId, seedMemoryIds[], source: "llm"|"rule-based",
signalCount, memoryCount }`. The event MUST be added to `EventMap`
(Phase-1/2/3 precedent).

### R5 — Silent degradation (LLM off)
- When `isLlmEnabled()` is false, OR the LLM call returns `{ok:false}`,
  OR it throws/timeouts, the service MUST fall back to a **rule-based
  minimal seeder**: derive 1–3 short seed memories directly from the
  README first paragraph + the most recent git-log subjects (no LLM
  call), tagged the same way. If even the rule-based path has no usable
  signal (empty README + no git), it MUST **skip seeding** with a
  logged reason and return `{ bootstrapped: false, reason }` — never
  throw.
- This is the same contract as Phase-2 query understanding and Phase-3
  consolidation bridge: `{ok:false}` = fall-through, never blocks,
  never throws to the caller.

### R6 — MCP tool + API route
- MCP tool `bootstrap` MUST be added to `TOOL_DEFINITIONS`
  (`apps/mcp-client/src/tool-definitions.ts`) with
  `apiEndpoint: "/api/v1/bootstrap"`, `apiMethod: "POST"`, input
  schema `{ projectId: string, projectPath?: string, force?: boolean }`
  (`projectId` required).
- API route `POST /api/v1/bootstrap` (Elysia, `routes/bootstrap.ts`)
  MUST accept the same body, call `BootstrapService.bootstrap(...)`, and
  return `{ success, data: result }` (200 on success / no-op, 500 on
  unexpected error). Wired into `apps/tools-api/src/index.ts` via
  `.use(bootstrapRoutes)`.

### NF1 — Local-first / default-off posture
- The LLM summarization (R2) is **default-off** (inherits `llm.enabled`,
  default false, env `RLM_LLM_ENABLED=true`).
- The bootstrap service itself (scan + rule-based seed + idempotency +
  event) is **functional with the LLM off** (R5 rule-based path). No
  new external dependency. Reuses installed `ai` + `@ai-sdk/openai` via
  the existing `llm-client`.
- A `memory.bootstrap` config block gates behavior with sensible
  defaults (see design.md): `{ enabled(true); maxSeedMemories(8);
  centralityLimit(10); gitLogLimit(20); refreshEnabled(true) }`. The
  `enabled` flag is an off-switch (returns 423 from the route).

### NF2 — No regressions / additive / migration-free
- `bun run test` MUST stay green vs the Phase-3 baseline (**738 pass /
  0 fail / 46 skip**). New tests are additive.
- `bun run type-check` MUST be clean (5/5).
- **Migration: none.** Seed memories are rows in the existing
  `memories` table. No schema change.

## Acceptance Criteria

| AC ID | Statement |
| --- | --- |
| P4-SCAN-01 | `bootstrap` gathers ≥1 signal from a fixture repo (git log / README / manifest) and the injected centrality seam; the gathered bundle is passed to the summarizer. |
| P4-SEED-01 | With the LLM on (fake surface returns valid seed memories), `bootstrap` stores ≥1 seed memory of type `pattern`/`code`/`decision` via `MemoryRepository.insert`, tagged `bootstrap:<projectId>`. |
| P4-SEARCH-01 | A stored seed memory is **searchable** via the existing `MemoryRepository.fullTextSearch` (FTS5) by a distinctive token from its content. |
| P4-IDEMPOTENT-01 | A second `bootstrap` (same projectId, `force=false`) is a **no-op**: no new inserts, returns `skipped:true`, emits no event. |
| P4-IDEMPOTENT-02 | A second `bootstrap` with `force=true` proceeds (refresh): stores a fresh batch. |
| P4-DEGRADE-01 | With the LLM off (`isEnabled()` false), `bootstrap` does NOT throw; it stores rule-based seed memories (when a signal exists) OR skips with a logged reason; no LLM call is made. |
| P4-DEGRADE-02 | With the LLM on but the call returning `{ok:false}`, `bootstrap` falls back to the rule-based path (same as P4-DEGRADE-01); no throw. |
| P4-EVENT-01 | `bootstrap:completed` is in `EventMap` and is published on a successful bootstrap with the correct payload shape. |
| P4-DEGRADE-03 | When `bootstrap.enabled=false`, the route returns **423** and the service is not invoked. |
| P4-TOOL-01 | `bootstrap` is present in `TOOL_DEFINITIONS` with the correct endpoint/method/schema; the route is registered in `apps/tools-api/src/index.ts`. |

## Edge cases

| Edge case | Expected |
| --- | --- |
| Project root is not a git repo | `git log` fails → skip the git signal silently; proceed with README/manifests/centrality. |
| No README / no docs / no manifests | skip each silently; proceed with whatever signals exist. |
| Project not indexed (centrality empty) | centrality signal is empty; proceed with git/README/manifests. |
| Empty signal bundle (no git, no README, nothing) | rule-based path skips seeding; returns `{ bootstrapped:false, reason:"no-signals" }`; no throw, no event. |
| LLM returns malformed object (schema-invalid) | `llmObject` returns `{ok:false}` → rule-based fallback. |
| `projectId` empty/whitespace | route returns 400. |
| `force=true` on already-bootstrapped project | refresh: stores a fresh batch (does NOT delete prior seeds). |
| Seed memory content exceeds 512 chars | truncated to 512 chars on store. |
| Injected `memoryRepo.insert` throws | caught, logged, returns `{ bootstrapped:false, reason:"insert-failed" }`; no event. |

## Out of scope (explicit)

See "OUT OF SCOPE" in Scope above.

## Dependencies

- Phase 1: `llm-client` (`llmObject`/`isLlmEnabled`/`llm`/`LlmResult`),
  `MemoryRepository` (`insert` + `fullTextSearch`), EventBus.
- Phase 1/0c: `MemoryRepository.insert` shape (id, content, type, level,
  projectId, importance, tags, embedding, metadata).
- Existing ETL centrality: `SymbolGraphService.getTopCentralFiles` (no
  reimplementation).
- Phase 3: the ctor-seam pattern for test isolation
  (`ObservationConsolidationJob` lazy `memoryRepo` + injected `LlmSurface`).

## Verification summary (gate)

- `bun run test` — no regressions vs 738/0/46; new tests additive.
- `bun run type-check` — 5/5 clean.
- Idempotency test (P4-IDEMPOTENT-01) passes.
- LLM-off degradation test (P4-DEGRADE-01) passes.
- Searchability test (P4-SEARCH-01) passes.
- Discrimination sensor kills its mutant.
