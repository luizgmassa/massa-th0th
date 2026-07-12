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

### Graph query layer parity (2026-07-12, T1)
- **PG `findImporters`** added (`symbol-repository-pg.ts`) — reverse-import query
  parity with SQLite; PG consumers of "who imports file X?" now have a direct
  query (was forward `findDependencies` only).
- **`findEdges` caller-FQN pushdown (SF5)** on both backends — `fromSymbol`
  with a `#Name` segment now narrows by `meta.callerFqn` in SQL (SQLite
  `json_extract`, PG `->>'callerFqn'`); file-only fallback unchanged.
  `trace_path` client-side filter reduced to a defensive assert.

### D1 cross-file callee resolution + include_tests (2026-07-12, T2)
- **Cross-file callee resolution** — the resolve-stage symbol index now SEEDS
  from the repo (`listAllDefinitions`, all persisted defs incl. fingerprint-
  skipped unchanged files) then OVERLAYS in-batch symbols unconditionally
  (in-batch is strictly fresher). A CALL edge in a newly-parsed file now
  resolves to a callee defined in a fingerprint-skipped file. Closes the
  batch-only symbol-index gap that made inbound `trace_path` sparse across
  files.
- **SF1 `listAllDefinitions`** — added on both backends (no default LIMIT; 200k
  safety cap). The capped `listDefinitions` (SQLite LIMIT 50 / PG LIMIT 100)
  is left for paged callers; the resolve read can no longer be silently
  truncated.
- **`include_tests` toggle** — `PipelineInput.include_tests` (default false)
  threads through `index_project` → pipeline → `DiscoverStage`, which builds a
  discover-local `Ignore` that omits test/benchmark globs when true. `loadProjectIgnore`
  itself is unchanged so query-time callers (index-manager,
  contextual-search-rlm) still exclude tests and keep search recall clean.
- **Import tier broadened** — namespace/default bindings (`*`, `default`) are
  now recorded so `ns.method()` callees can resolve via the project-wide index.
- **Deferred:** multi-language tree-sitter extraction (TS/JS regex extractor
  remains; other languages are a separate effort).

---

## Skipped unit tests (284) — why they skip and how to run them

The unit batch reports **284 skip / 0 fail**. Skips are intentional gates, not
broken tests. Breakdown by reason:

| Reason | Gate | Count (approx) | How to run |
|--------|------|----------------|------------|
| **E2E live-stack** | `describe.skipIf(!READY)`, `READY = RUN_E2E==="1" && API_UP (:3333) && Ollama up` | ~250 (14 e2e suites) | `RUN_E2E=1 bun test src/__tests__/e2e/` from `packages/core`, with the tools-api + PG + Ollama running |
| **E2E destructive** | `describe.skipIf(process.env.RUN_E2E_DESTRUCTIVE !== "1")` | ~15 (`16.destructive.test.ts`) | `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts` (saturates/toggles global singletons — dedicated only) |
| **PG-integration** | `describe.skipIf(!DB_AVAILABLE)`, `DB_AVAILABLE = DATABASE_URL` starts with `postgres` | ~10 (PgJobStore / PgObservationStore / PgSynapseSessionStore / PostgresVectorStore / PG-resume) | Run with `DATABASE_URL=postgresql://...` set (they pass, not skip, when PG is configured — as in the dev `.env`). **2026-07-12:** PostgresVectorStore gate aligned — all PG-integration suites now use one `DB_AVAILABLE` gate and run uniformly when `DATABASE_URL=postgres…` is set. |
| **Phase-4 env sentinels** | `[D1/D2/D3/D4:SKIP]` — guard when the shared DB pool is dead or the live API is down | ~6 → 0 | **2026-07-12:** removed — `ENV_BROKEN`/`skipIfBroken` scaffolding stripped from all 4 Phase-4 suites; tests now run un-skipped in the default `DATABASE_URL=""` batch (60 pass / 0 fail / 0 skip). D3 keeps its own `DATABASE_URL=""` pin (FK-violation guard, separate concern). |
| **LLM code-model routing** | `test.skipIf(!LLM_CFG_AVAILABLE)` | 2 | Run with `RLM_LLM_CODE_MODEL` configured (a code model distinct from the instruct default) |
| **Named shared-infra destructive** | `test.skip("…: shared-infra destructive")` | 2 (`F87` saturate→429, `F88` disabled-hooks→423) | Covered by the dedicated destructive suite above |
| **Internal / not-observable** | `test.skip("…: internal — not observable")` | 1 (`E20` matchThreshold/hitBoost buffer effect) | N/A — asserts internal state with no public surface; keep as documentation |

**Net:** the ~250 e2e + ~15 destructive skips are by design (they need the live
stack and are run separately in CI). The Phase-4 `Dx:SKIP` guards were removed
(2026-07-12); the PG-integration skips are the only remaining unit-batch skips
worth revisiting.

---

## OPEN findings (bug fixes)

### [med] `read_file` `fileCache` unbounded growth
- **Where:** `packages/core/src/tools/read_file.ts:121` (`fileCache: Map`).
- **What:** no size cap / eviction — only TTL freshness. Each distinct
  `{filePath, includeSymbols, includeImports, projectId, relativePath}` combo
  is its own entry; an adversarial caller cycling keys grows the map for the
  process lifetime.
- **Fix:** LRU / max-size bound (mirror the WebController 512-cap pattern).
- **Done (2026-07-12):** both `fileCache` and `projectRootCache` are now
  512-cap LRU (`FILE_CACHE_MAX_ENTRIES`, `evictOldest`), with delete+set
  promotion on GET. Moved to Completed.
- **Side-finding (2026-07-12):** sibling unbounded map
  `SymbolGraphService.projectRootCache` (`symbol-graph.service.ts`) capped with
  the same 512 LRU pattern (`PROJECT_ROOT_CACHE_MAX_ENTRIES`,
  `evictOldestProjectRoot`, GET promotion + SET eviction). T3 side-finding.

### [med] `countExistingMemoryIds` no-op under PG — DONE (2026-07-12)
- **Where:** `packages/core/src/services/checkpoint/checkpoint-store-pg.ts`.
- **What:** PG restore memory-integrity check returned the input unchanged
  (`missingMemoryIds` always empty); SQLite ran the real
  `SELECT id FROM memories WHERE id IN (...)`. The sync `restoreCheckpoint`
  contract couldn't await an async PG query.
- **Fix (landed):** made the restore path async end-to-end —
  `ICheckpointStore.countExistingMemoryIds` + `CheckpointManager.restoreCheckpoint`
  are now `Promise`-returning; the PG store runs a real chunked
  `SELECT id FROM memories WHERE id IN (...)` via prisma (`Prisma.join`, 1000/batch,
  try/catch → best-effort fallback). Pre-mortem (SF4) confirmed exactly one
  production caller (`restore_checkpoint.ts` tool handler, already async; the
  tools-api route + MCP contract are already Promise-based), so the async
  reversal was contained. SF2 falsifier added (`checkpoint-pg.test.ts`): inserts
  a real memory row + a fabricated missing id, asserts the fabricated id lands
  in `missingMemoryIds` and the real id in `validMemoryIds`. SQLite + PG suites
  green; `tsc` clean.

### [done] Benchmark the qwen2.5 swap on LLM-judge paths (2026-07-12, T9)
- **What:** the model swap (`qwen3.5:9b` → `qwen2.5:7b-instruct` + coder) was live
  but LLM-judge quality (consolidator / salience / reranker) was unmeasured —
  `14.needles` is deterministic and does not exercise the judge.
- **Resolution:** added `benchmarks/llm-judge/` (fixtures of known-dup groups +
  known-distinct pairs, a `run.ts` harness that drives the REAL qwen2.5 LLM
  through the three judge paths, and a pure `scorer.ts` computing
  precision/recall/F1 + salience consistency + rerank hit@1). Added a gated
  test `packages/core/src/__tests__/llm-judge.benchmark.test.ts`
  (`describe.skipIf(!OLLAMA_UP)`) that asserts non-regression floors and skips
  cleanly when Ollama is down (verified: 3 skip / 1 pass / 0 fail in 63 ms).
- **Recorded baseline** (qwen2.5:7b-instruct + qwen2.5-coder:7b, 2026-07-12):
  consolidator merge precision 1.000, recall 0.500, F1 0.667, accuracy 0.800;
  salience consistency 0.500 (meanSpread 0.375); rerank hit@1 0.667. Committed
  floors sit below the baseline (precision ≥ 0.6, recall ≥ 0.4, rerank hit@1 ≥
  0.5, salience consistency ≥ 0.4) to tolerate sampling noise.

### [low] `adsads/` junk path indexed in `e2e-th0th-shared`
- **Where:** shared index `e2e-th0th-shared`; surfaces as needle N11 top hit
  `adsads/packages/core/src/services/etl/stage-context.ts`.
- **Fix:** audit the indexed file list / `projectPath`; drop the `adsads/`
  entries; re-index clean. Do NOT delete `e2e-th0th-shared` itself.

### [done] Phase-4 `Dx:SKIP` env guards now largely redundant (2026-07-12)
- **Where:** `D1/D2/D3/D4:SKIP` sentinels in the Phase-4 integration tests.
- **What:** these guarded against the shared PG pool being killed mid-batch by
  `disconnectPrisma()` — that debt is now fixed (commit `3cdd636`).
- **Resolution:** guards removed (`ENV_BROKEN`/`ENV_REASON`/`skipIfBroken`
  machinery and all `if (skipIfBroken(...)) return;` early-returns stripped from
  typed-edges / trace-path / impact-analysis / architecture-map). The Phase-4
  integration tests now run un-skipped in the default `DATABASE_URL=""` batch
  (60 pass / 0 fail / 0 skip). The D3 `DATABASE_URL=""` beforeAll/afterAll pin
  is retained — it prevents PG FK violations on the throwaway fixture projectId,
  a separate concern from the removed guards. D1/D2/D4 need no pin (verified
  they pass even when a PG `.env` leaks).

### [done] Dep / type skew (2026-07-12)
- `@types/node`: mcp-client `^22.10.5` → `^25.2.2` (aligned with core/tools-api).
- `dotenv`: shared `^17.2.3` → `^17.2.4` (dep; aligned with core/tools-api).
- Build 5/5 green; `tsc --noEmit` clean on mcp-client (no 22→25 type regressions).

### [note] `e2e-th0th-shared` vectors empty on a cold live DB — [documented] (2026-07-12)
- **What:** workspace claims `indexed` (251 files) but `vector_documents` is 0
  rows on a cold/dedicated stack; vectors re-seed on demand (~95 s).
- **Fix:** none required; re-index to warm.
- **Documented (2026-07-12):** cold-DB caveat added as a header note on
  `ensureSharedIndex` in `packages/core/src/__tests__/e2e/_helpers.ts`
  (the strong-probe gate already forces the re-index, so callers block until
  the store is richly searchable).

### [note] observation same-id concurrent insert ordering — [documented] (2026-07-12)
- **Where:** `observation-repository-pg.ts:158` (fire-and-forget async IIFE).
- **What:** two concurrent same-id upserts can commit out of order;
  `__drain()` is a 10 ms settle, not a flush. Low impact (best-effort
  telemetry); nondeterministic only for same-id concurrent writes.
- **Documented (2026-07-12):** ordering caveat added as a code comment at the
  fire-and-forget IIFE in `packages/core/src/data/memory/observation-repository-pg.ts`.
  No behavior change — comment only.

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

- **Config-interface drift** — DONE (2026-07-12): `MassaTh0thConfig` now
  declares `llm`/`hooks`/`memory`/`search`/`synapse` matching the runtime
  `ServerConfig` shape; `compression` + `synapse` reconciled to the runtime
  canonical shape; `config-loader.ts` deep-merges the newly-declared keys;
  `scheduler` left env-driven (one-line comment added). Moved to Completed.
- **`compression.llm` deprecated alias** — DONE (2026-07-12): the mirror block,
  its deprecation comment, and the `mergeConfig` alias line are removed from
  `packages/shared/src/config/index.ts`. The only compression-specific field
  (`prompt`, env `RLM_LLM_PROMPT`) is preserved under `compression.prompt`;
  the only runtime reader (`code-compressor.ts`) already read `config.get("llm")`
  + `config.get("compression").targetCompressionRatio`, so no reader migration
  was needed. Moved to Completed.
- **E2E ops knobs undocumented in README** — DONE (2026-07-12): added an
  "Operational knobs" subsection to `README.md` documenting
  `MASSA_TH0TH_DEDICATED`, `MASSA_TH0TH_JOB_STALE_MS`,
  `MASSA_TH0TH_JOB_REAPER_INTERVAL_MS`, `MASSA_TH0TH_PROXY_TIMEOUT_MS`, and
  `MASSA_TH0TH_SCHEDULER_ENABLED` (defaults + purpose, sourced from the code).
  These knobs are NOT in `.env.example` (they are operational guards for
  dedicated/verify stacks, not user-tunable config); the README subsection
  notes this explicitly. Moved to Completed.
- **Dead `||` fallback in `read_file`** (`read_file.ts:385`) — never fires;
  cosmetic.
  - **Done (2026-07-12):** reframed — the `||` DID fire for legacy/edge
    cache entries with undefined metadata, re-extracting on every hit without
    persisting. Fixed by writing the extracted metadata back into the cache
    entry on first hit; the `||` RHS is now removed (metadata always defined
    post-writeback). Moved to Completed.

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
