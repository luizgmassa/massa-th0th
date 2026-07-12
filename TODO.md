# TODO — massa-th0th

Living task list. Severity: `high` = data loss / core path broken,
`med` = feature silently wrong, `low` = cosmetic / hardening, `note` = info.

Companion docs: [`COVERAGE.md`](./packages/core/src/__tests__/e2e/COVERAGE.md)
(e2e per-item ledger) and [`SESSION-STATE.md`](./packages/core/src/services/SESSION-STATE.md)
(checkpoint vs compaction-snapshot split).

Last updated: 2026-07-12.

---

## Status snapshot

- **Build:** clean `bun run build` → 5/5 packages green.
- **Unit suite:** `cd packages/core && bun test` → **1289 pass / 0 fail / 284 skip**
  (stable across 8+ consecutive runs). Skip breakdown below.
- **Tools:** 42 MCP tools (was 35).

---

## Completed (2026-07-12) — context only, do NOT redo

A multi-wave sub-agent rollout landed Phase 4 (deep graph) + structural gaps +
security hardening + test-isolation fixes, all on `main`, all verified GREEN.

### Phase 4 — deep code graph
- **D1 typed edges** — ETL now emits `CALLS` / `DATA_FLOWS` / `HTTP_CALLS` /
  `EMITS` / `LISTENS` / `IMPORTS` (extended `symbol_references.ref_kind` + a
  `meta` JSON column, SQLite + PG parity).
- **D2 `trace_path`** — BFS/DFS traversal over typed edges
  (`calls`/`data_flow`/`cross_service`, in/out/both, depth-capped, cycle-guarded).
- **D3 `impact_analysis`** — git-diff → reverse import/reference traversal →
  impacted symbols ranked by centrality risk.
- **D4 architecture map** — `project_map` enriched with packages, entry points,
  routes, hotspots, layers, and **Louvain community detection** over the
  file-import graph (caps + label-propagation fallback).
- D5 (Cypher subset) — **deferred** (large, optional).

### Structural gaps closed
- **Graph-store unification** — shared `IGraphStore` (async), both stores conform,
  `MemoryGraphService` routes through `getGraphStore()` → **graph works on PG
  now** (was SQLite-only); also fixed the long-standing A3 batch flakiness.
- **PG parity** — `PgObservationStore`, `PgCheckpointStore` (+ Prisma model),
  `PgSynapseSessionStore` (with working-memory buffer reconstruction on load +
  awaited hydration).
- **`@huggingface/transformers` v3** — offline embedding provider migrated off
  the deprecated `@xenova/transformers`.
- **Observation-consolidation bridge wired** into `getHookService` (was NoopBridge).
- **opencode-plugin** now emits lifecycle observations (6 event kinds → hook_ingest).
- **Security** — SSRF guard pins DNS (literal-IP + Host, no connect-time DNS,
  closing the DNS-rebinding TOCTOU); `execute_file` resolves symlinks via
  realpath before the boundary/deny-glob check.

### Hardening (MEDIUM + LOW + test isolation)
- **MEDIUMs fixed:** Rust temp-dir leak (`finally` cleanup), `batch_execute` cap
  (256), dim-agnostic metadata embedding (was hardcoded 4096), `ensureHydrated`
  retry-storm rate-limit (3 PG stores), `/symbol/trace` depth validation,
  `/symbol/impact` `projectPath` boundary check, `impact_analysis` def-cache +
  query cap, `trace_path` `buildChains` walk-budget.
- **LOWs fixed:** WebController LRU cap (512), `clampTimeout(NaN)` finite-guard,
  TTL cache-hit sentinel (`-1`→`0`), deny-glob basename anchoring (fewer false
  positives), `proc.on("error")` double-fire guard, `__drain` snapshot-once,
  BFS visited-on-enqueue, GraphQL regex capture, shared `snapshotWorkingMemoryBuffer`,
  dead-code removal in `classifyLayers`, route cross-source dedup,
  observation-consolidation no-op `Math.min/max` simplified.
- **Real correctness bug fixed:** scheduler `registerOrResumeJob` now preserves
  the persisted `nextRunAt` on resume (was comparing the passed-in `0`).
- **Test isolation fixed:** removed the `disconnectPrisma()` pool-kill from 6
  test files (was cascading "Cannot use a pool after end" across the batch);
  pinned `DATABASE_URL=""` for SQLite-canonical suites that Bun's `.env`
  auto-load was routing to PG. Batch went 1259→1289 pass / 0 fail.

Commits (`0acfc05..75b7394`): 15 atomic commits. See `git log` for detail.

---

## Skipped unit tests (284) — why they skip and how to run them

The unit batch reports **284 skip / 0 fail**. Skips are intentional gates, not
broken tests. Breakdown by reason:

| Reason | Gate | Count (approx) | How to run |
|--------|------|----------------|------------|
| **E2E live-stack** | `describe.skipIf(!READY)`, `READY = RUN_E2E==="1" && API_UP (:3333) && Ollama up` | ~250 (14 e2e suites) | `RUN_E2E=1 bun test src/__tests__/e2e/` from `packages/core`, with the tools-api + PG + Ollama running |
| **E2E destructive** | `describe.skipIf(process.env.RUN_E2E_DESTRUCTIVE !== "1")` | ~15 (`16.destructive.test.ts`) | `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts` (saturates/toggles global singletons — dedicated only) |
| **PG-integration** | `describe.skipIf(!DB_AVAILABLE)`, `DB_AVAILABLE = DATABASE_URL` starts with `postgres` | ~10 (PgJobStore / PgObservationStore / PgSynapseSessionStore / PostgresVectorStore / PG-resume) | Run with `DATABASE_URL=postgresql://...` set (they pass, not skip, when PG is configured — as in the dev `.env`) |
| **Phase-4 env sentinels** | `[D1/D2/D3/D4:SKIP]` — guard when the shared DB pool is dead or the live API is down | ~6 | Run the Phase-4 suite in isolation with `DATABASE_URL` set + API up; **these guards are now largely redundant** after the `disconnectPrisma` fix — candidate for removal (see OPEN) |
| **LLM code-model routing** | `test.skipIf(!LLM_CFG_AVAILABLE)` | 2 | Run with `RLM_LLM_CODE_MODEL` configured (a code model distinct from the instruct default) |
| **Named shared-infra destructive** | `test.skip("…: shared-infra destructive")` | 2 (`F87` saturate→429, `F88` disabled-hooks→423) | Covered by the dedicated destructive suite above |
| **Internal / not-observable** | `test.skip("…: internal — not observable")` | 1 (`E20` matchThreshold/hitBoost buffer effect) | N/A — asserts internal state with no public surface; keep as documentation |

**Net:** the ~250 e2e + ~15 destructive skips are by design (they need the live
stack and are run separately in CI). The ~6 Phase-4 `Dx:SKIP` guards and the
PG-integration skips are the only ones worth revisiting for the unit batch.

---

## OPEN findings (bug fixes)

### [med] D1 typed-edge extraction is TS/JS + same-file only
- **Where:** `packages/core/src/services/etl/typed-edges.ts`; resolve stage.
- **What:** CALL edges are extracted for **same-file** calls only — cross-file
  callee resolution is incomplete, so inbound `trace_path` across files is
  sparse. No typed edges are emitted from `.test.ts` files. Multi-language
  breadth is out of scope (TS/JS only).
- **Fix:** complete cross-file callee resolution in the resolve stage; index
  edges from test files behind the `include_tests` toggle. Multi-language
  tree-sitter is a larger separate effort.

### [med] `read_file` `fileCache` unbounded growth
- **Where:** `packages/core/src/tools/read_file.ts:121` (`fileCache: Map`).
- **What:** no size cap / eviction — only TTL freshness. Each distinct
  `{filePath, includeSymbols, includeImports, projectId, relativePath}` combo
  is its own entry; an adversarial caller cycling keys grows the map for the
  process lifetime.
- **Fix:** LRU / max-size bound (mirror the WebController 512-cap pattern).

### [med] `countExistingMemoryIds` no-op under PG
- **Where:** `packages/core/src/services/checkpoint/checkpoint-store-pg.ts:341`.
- **What:** PG restore memory-integrity check returns the input unchanged
  (`missingMemoryIds` always empty); SQLite runs the real
  `SELECT id FROM memories WHERE id IN (...)`. The sync `restoreCheckpoint`
  contract can't await an async PG query.
- **Fix:** needs the restore path to become async (MCP tool contract change) OR
  a PG-backed in-memory mirror of memory ids. Documented in code for now.

### [med] Benchmark the qwen2.5 swap on LLM-judge paths
- **What:** the model swap (`qwen3.5:9b` → `qwen2.5:7b-instruct` + coder) is live
  but LLM-judge quality (consolidator / salience / reranker) is unmeasured —
  `14.needles` is deterministic and does not exercise the judge.
- **Fix:** fixture of known-dup + known-distinct memory batches; score merge
  precision/recall head-to-head vs the old model.

### [low] `adsads/` junk path indexed in `e2e-th0th-shared`
- **Where:** shared index `e2e-th0th-shared`; surfaces as needle N11 top hit
  `adsads/packages/core/src/services/etl/stage-context.ts`.
- **Fix:** audit the indexed file list / `projectPath`; drop the `adsads/`
  entries; re-index clean. Do NOT delete `e2e-th0th-shared` itself.

### [low] PG symbol repo lacks `findImporters` (reverse-import query)
- **Where:** `packages/core/src/data/sqlite/symbol-repository-pg.ts:746` has only
  forward `findDependencies`; SQLite has `findImporters`.
- **What:** `impact_analysis` works around it by reversing `allImportEdges`
  client-side, but PG consumers of "who imports file X?" have no direct query.
- **Fix:** add PG `findImporters` parity.

### [low] `findEdges` filters `fromSymbol` by file, not caller FQN
- **Where:** `symbol-repository.ts:453` / `symbol-repository-pg.ts:814`.
- **What:** `getEdges(fromSymbol)` returns file-level results; `trace_path`
  works around it with client-side `meta.callerFqn` filtering.
- **Fix:** push the caller-FQN filter into the query.

### [low] Phase-4 `Dx:SKIP` env guards now largely redundant
- **Where:** `D1/D2/D3/D4:SKIP` sentinels in the Phase-4 integration tests.
- **What:** these guarded against the shared PG pool being killed mid-batch by
  `disconnectPrisma()` — that debt is now fixed (commit `3cdd636`).
- **Fix:** audit and remove the now-redundant guards so the Phase-4 integration
  tests run in the default batch (raises the green count further).

### [low] Dep / type skew
- `@types/node`: mcp-client `^22.10.5` vs core `^25.2.2` (shared has none).
- `dotenv`: shared `^17.2.3` (dep) vs core `^17.2.4` (devDep).
- **Fix:** align in a dedicated dependency pass.

### [note] `e2e-th0th-shared` vectors empty on a cold live DB
- **What:** workspace claims `indexed` (251 files) but `vector_documents` is 0
  rows on a cold/dedicated stack; vectors re-seed on demand (~95 s).
- **Fix:** none required; re-index to warm. Worth a one-line e2e README note.

### [note] observation same-id concurrent insert ordering
- **Where:** `observation-repository-pg.ts:158` (fire-and-forget async IIFE).
- **What:** two concurrent same-id upserts can commit out of order;
  `__drain()` is a 10 ms settle, not a flush. Low impact (best-effort
  telemetry); nondeterministic only for same-id concurrent writes.

---

## Deferred / out of scope

- **D5 Cypher subset** — declarative graph query engine. Large; revisit only if
  D1–D4 graph depth justifies it.
- **Multi-language tree-sitter breadth** — massa-th0th is TS/JS-centric; 158-lang
  breadth (à la codebase-memory-mcp) is a separate effort.
- **OS-level sandbox for `execute`/`execute_file`/`batch_execute`** — current
  containment is best-effort (timeout, env-denylist, boundary + symlink guard),
  NOT isolation. Needs container/VM infra to safely expose to untrusted clients.
- **Native `format: json_schema` constrained decoding** — Ollama supports it;
  could tighten schema adherence on all LLM sites. Optional.

---

## Tech-debt / docs (lower priority)

- **Config-interface drift** — the typed `MassaTh0thConfig` TS interface doesn't
  declare `llm`/`hooks`/`memory`/`search`/`synapse`/`scheduler` even though the
  runtime loader reads them. Loader works; interface is stale.
- **`compression.llm` deprecated alias** still mirrored in
  `packages/shared/src/config/index.ts`. Schedule removal after one release.
- **E2E ops knobs undocumented in README** — `MASSA_TH0TH_DEDICATED`,
  `MASSA_TH0TH_JOB_STALE_MS` / `_JOB_REAPER_INTERVAL_MS`,
  `MASSA_TH0TH_PROXY_TIMEOUT_MS`, `MASSA_TH0TH_SCHEDULER_ENABLED`. All in
  `.env.example`; add a short "Operational knobs" README subsection.
- **Dead `||` fallback in `read_file`** (`read_file.ts:385`) — never fires;
  cosmetic.

---

## E2E suite quick-reference

- Dir: `packages/core/src/__tests__/e2e/`. Run: `RUN_E2E=1 bun test src/__tests__/e2e/`
  (from `packages/core`). Override API: `MASSA_TH0TH_API_URL`.
- **PostgreSQL backend required** (not SQLite) for the full suite.
- **Shared index `e2e-th0th-shared`** is built once and reused (OOM workaround)
  — do NOT delete between runs.
- Full-repo index never completes; concurrent indexes OOM — rely on the shared
  index strategy in `_helpers.ts`.
- `.env` footgun: `bun` auto-loads repo-root `.env`. Dedicated/verify stacks
  MUST set `DATABASE_URL` explicitly (and `MASSA_TH0TH_DEDICATED=1` for the
  db-guard). SQLite-canonical **unit** suites pin `DATABASE_URL=""`.
