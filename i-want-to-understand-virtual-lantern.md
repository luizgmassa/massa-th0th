# massa-th0th Improvement Plan

## Context

`massa-th0th` is a TypeScript MCP server (3-tier: MCP client → Tools API → `packages/core`) providing semantic code search, a code symbol graph (PageRank + refs + imports), and an agent memory system. Two comparative analyses were merged:

1. **A retrieval/reliability pass** (this author) — borrowing `ai-memory`'s *algorithms* (decay math, `ConsolidatedBatch`) and closing massa-th0th's own defects (data-loss, truncation, dead code, untested pipelines).
2. **A product-vision pass** (`peaceful-swan`) — borrowing `ai-memory`'s *product surface* (passive hook capture, repo bootstrap, auto-improvement, handoffs, CRUD, web UI).

The merged plan keeps massa-th0th **SQLite-canonical** (no markdown wiki / git second store) but adopts the passive-capture + lifecycle product features, making it a **hybrid code-context + agent-memory tool**. All LLM features are **local-first Ollama** and degrade gracefully when the LLM is unavailable.

### Verified findings (load-bearing claims checked against source)

| Claim | Source | Status |
|---|---|---|
| `compression.llm` config wired, default **off** | `packages/shared/src/config/index.ts:217-227` | ✅ |
| MCP upload gate = 8 exts; API supports 30+ | `apps/mcp-client/src/file-collector.ts:9` vs `config/index.ts:239-273` | ✅ silent truncation |
| Consolidation = decay+prune only, **Postgres-only** (no-op on SQLite) | `services/jobs/memory-consolidation-job.ts:36-45,83-92` | ✅ real defect |
| `HybridSearch.rerank()` takes `SearchResult[][]` (3rd-stream ready) | `data/vector/hybrid-search.ts:85` | ✅ |
| `hybrid-search.ts:10` imports the dead ChromaDB stub | `data/chromadb/vector-store.ts` + `hybrid-search.ts:10` | ✅ removal trap |
| `MemoryRelationType.SUPERSEDES` + `GraphStore.addEdge` exist | `packages/shared/src/types`, `services/graph/graph-store.ts:106` | ✅ |
| `memories` already has `access_count` + `last_accessed` (no `pinned`) | `data/memory/memory-repository.ts:118-152` | ✅ peaceful-swan's "add these" is partly redundant |
| `@ai-sdk/openai` + `ai` SDK present; only `embed*` used | `package.json` + `services/embeddings/provider.ts:15` | ✅ `generateText`/`generateObject` available |
| Default embeddings = local Ollama `bge-m3` | `services/embeddings/config.ts:104-238` | ✅ |
| **Checkpoint tools exist in core, NOT exposed via MCP** | `packages/core/src/tools/{list,create,restore}_checkpoints.ts` + `services/checkpoint/` | ✅ G8 confirmed |
| No handoff / bootstrap / memory-update-delete / `/hook` route | grep across `packages`+`apps` | ✅ all genuinely absent |

### Decisions (from user)

- **Source of truth:** **SQLite-canonical** (reject G4 markdown-wiki + git; reject G10 multi-user attribution).
- **Add (peaceful-swan):** G1 hook auto-capture · G6 repo bootstrap · G7 auto-improvement · G2 handoffs · G8 expose checkpoint tools · G9 memory CRUD · G5 web UI.
- **Keep (retrieval/reliability pass):** all 11 original items (upload-gate fix, reindex cap, decay fn, LLM consolidation, durable sessions/jobs, query rewrite+HyDE, rerank, salience, graph-neighbor stream, LLM compression, tests, dead-code removal).
- **LLM posture:** **local-first Ollama** (OpenAI-compatible; cloud opt-in).

---

## Cross-cutting architecture decisions (apply to all items)

1. **One shared LLM client, local-first.** Create `packages/core/src/services/memory/llm-client.ts` wrapping `generateText`/`generateObject` (already-installed `ai` + `@ai-sdk/openai`) over an OpenAI-compatible provider. **New top-level `llm` config block** in `packages/shared/src/config/index.ts`, Ollama defaults: `baseUrl http://localhost:11434/v1`, `model qwen2.5-coder:7b`, `apiKey "ollama"`. Migrate `compression.llm` → `llm` (keep deprecated alias one release). Expose `llmComplete(prompt, opts?)` + `llmObject(prompt, zodSchema)`. **Every call must (a) respect `timeoutMs`, (b) degrade silently to non-LLM path on failure, (c) be config-gated default-off.** Consumed by: consolidation, query rewrite, salience, compression, bootstrap, auto-improve, hook consolidation.
2. **SQLite is first-class.** No new feature may repeat the `isPostgresEnabled()` short-circuit (`memory-consolidation-job.ts:36-42`). New jobs route through backend-polymorphic dispatch mirroring factories (`vector-store-factory.ts:86`, `memory-repository-factory.ts:13`).
3. **EventBus is the integration bus** (`services/events/event-bus.ts`). New stages emit typed events (`memory:consolidated`, `search:query-rewritten`, `search:reranked`, `memory:salience-scored`, `observation:ingested`, `handoff:accepted`, `bootstrap:completed`). No new plugin system.
4. **SQLite write discipline** (borrow ai-memory writer-actor): enable **WAL mode**; serialize observation/hook ingestion writes through a single-writer queue; 429 on saturation. Prevents hook fire-hose from starving readers.
5. **Migrations additive-only**, both backends (`ALTER TABLE … ADD COLUMN` / `CREATE TABLE IF NOT EXISTS`, pattern at `memory-repository.ts:148-160`).

---

## Phase 0 — Quick wins (independent, small)

### 0a. Lift upload-gate truncation
- `apps/mcp-client/src/file-collector.ts:9` → replace hardcoded 8-ext `ALLOWED_EXTENSIONS` with shared `security.allowedExtensions` (export from `packages/shared/src/extensions.ts` to kill drift). Keep byte/file guards.
- **Risk S · Effort S.** Verify: `multi-language-upload.test.ts`.

### 0b. Raise autoReindex cap
- `packages/shared/src/config/index.ts` → add `search.autoReindexMaxFiles` (default **200**). `search-controller.ts:244` + `contextual-search-rlm.ts:290,345` → derive from config. Keep `allowFullReindex:false`.
- **Risk S · Effort S.** Verify: extend `search-controller.test.ts`.

### 0c. Memory CRUD [G9]
- **Gap:** only store/recall/list exist; no update/delete.
- Add MCP tools `memory_update` (content/importance/tags/tags merge) + `memory_delete` (soft then hard). Reuse `MemoryRepository`; delete should sever GraphStore edges. Add API routes under `apps/tools-api/src/routes/memory.ts`.
- Files: `apps/mcp-client/src/tool-definitions.ts`, `packages/core/src/tools/memory-update.ts` + `memory-delete.ts`, `data/memory/memory-repository.ts`.
- **Risk S · Effort S.** Verify: `memory-crud.test.ts`.

### 0d. Expose checkpoint tools via MCP [G8]
- **Gap:** `packages/core/src/tools/{list,create,restore}_checkpoints.ts` + `services/checkpoint/` exist but are unreachable from MCP.
- Wire 3 tools in `tool-definitions.ts`; add API routes mirroring existing tool handlers. No new logic.
- **Risk S · Effort S.** Verify: `checkpoint-mcp.test.ts`.

---

## Phase 1 — Memory-quality foundation

### 1. Tunable decay as a pure, tested fn  *(borrow ai-memory `decay.rs`)*
- **Create** `services/memory/decay.ts` — `score = salience·exp(-λΔt_days) + σ·log(1+access)·exp(-μ·days_since_access)`; `DecayParams { lambda=0.02; sigma=0.6; mu=0.04; coldThreshold=0.20 }`; export `decayScore(mem, params, now)`.
- **Create** `__tests__/decay.test.ts` — port ai-memory property tests (`decay.rs:68-121`): monotonic non-increase in Δt, sub-threshold pruned, recency boosts access term, bounded `[0,1]`.
- **Modify** `memory-service.ts:146-179` — delegate temporal curve to `decay.ts`.
- **Modify** config → add `memory.decay: DecayParams`. **Add `pinned` column** to `memories` (genuinely new); pinned memories exempt from decay.
- **Risk S · Effort S · Migration: add `pinned` column.**

### 2. LLM-driven memory consolidation  *(borrow ai-memory `ConsolidatedBatch`)*
- **Create** `services/memory/llm-client.ts` (cross-cutting #1).
- **Create** `services/memory/consolidator.ts` — `ConsolidatedBatch { id; sourceIds; summary; type; level; rationale }`; `consolidateWindow(memories, llm)` via `generateObject` + **zod schema enforcing type/level enums**. Rule-based prefilter: cluster by `project_id` + cosine ≥ 0.65, top-N bounded.
- **Modify** `memory-consolidation-job.ts` — **remove `isPostgresEnabled()` short-circuit (line 45)**; backend-polymorphic; port decay to `decay.ts` for both backends; add **merge** phase → insert new memory + `graphStore.addEdge(newId, sourceId, SUPERSEDES, {batchId})` per source. `ConsolidationStats += {merged, batchesCreated}`. Emit `memory:consolidated`.
- **Read-side:** `memory-query.service.ts` hide superseded (`WHERE id NOT IN (SELECT target FROM memory_edges WHERE type='SUPERSEDES')`).
- **Risk M · Effort M · Migration: additive PG `metadata` col on relations table if absent.**

### 3. Durable Synapse sessions + index jobs  *(borrow ai-memory writer/reader discipline)*
- **Create** `SessionStore` (`services/synapse/session/session-store.ts`): `MemorySessionStore` + `SqliteSessionStore`; persist `AgentSession` (buffer JSON snapshot, accessHistory LRU head, etc.) to `synapse_sessions` + `synapse_access_history`.
- **Modify** `session-registry.ts` — inject store; write-through; lazy-load; Map stays hot cache.
- **Create** `services/jobs/index-job-store.ts` (`SqliteJobStore`) for `index_jobs`; on startup mark stale `running` → `failed` (crash recovery). **Modify** `index-job-tracker.ts` write-through + lazy-load.
- **Risk M · Effort M · Migration: additive tables, both backends.**

---

## Phase 2 — Retrieval quality

### 4. Query understanding: LLM rewrite + HyDE  *(beyond both tools)*
- **Create** `services/search/query-understanding.ts` — `rewriteQuery` (`generateObject`+zod → expansions/keywords) + `hyde` (generate hypothetical impl paragraph, **embed it** as additional vector query). Config-gated `search.queryUnderstanding.enabled` (default off).
- **Modify** `contextual-search-rlm.ts` `search()` — fan out original+HyDE vector + rewritten FTS; feed `HybridSearch.rerank([...streams])` (`hybrid-search.ts:85`). Cache rewrite per `(query, projectId)`. Pass `sessionId` for Synapse bias.
- **Degradation:** on LLM throw/timeout, fall through silently. Never block search.
- **Risk M · Effort M · Migration none.**

---

## Phase 3 — Passive memory capture [G1]  *(largest new scope)*
- **Gap:** memory is manual (`remember`). ai-memory's killer feature is passive capture.
- **Create** `services/hooks/hook-service.ts` — lifecycle event ingestion: `session-start`, `user-prompt`, `pre-tool-use`, `post-tool-use`, `pre-compact`, `session-end`. Fire-and-forget (202), 429 on saturation (cross-cutting #4 writer queue).
- **Create** `data/memory/observation-repository.ts` + **Observation table** (SQLite-canonical): `id, project_id, session_id, source(event), payload_json, importance, created_at`.
- **Routes:** `apps/tools-api/src/routes/hooks.ts` — `POST /api/v1/hook` + `POST /api/v1/hook/batch`.
- **Consolidation bridge:** periodic job (extend `memory-consolidation-job.ts` or new `observation-consolidation-job.ts`) summarizes raw observations → structured memories via `llm-client` + `consolidator`. Emit `observation:ingested`.
- **Integration:** generate Claude Code hook scripts (`SessionStart`, `UserPromptSubmit`, `PostToolUse`, `Stop`) under `apps/claude-plugin` or `skills/` that `curl` the endpoint. Optional MCP tool `hook_ingest` for non-Claude hosts.
- **Dependencies:** Phase 1 (llm-client, consolidation). **Risk M · Effort L · Migration: new Observations table.**

---

## Phase 4 — Bootstrap from repo [G6]
- **Create** MCP tool `bootstrap` + `services/bootstrap/bootstrap-service.ts`.
- Scan `git log --oneline`, `README.md`, `docs/`, package manifests, top central files (reuse `project_map` PageRank output) → LLM-summarized **seed memories** (types `pattern`/`code`/`decision`). Idempotent (skip if project already bootstrapped). Emit `bootstrap:completed`.
- Reuses `llm-client` + ETL centrality data.
- **Risk M · Effort M · Migration none.** Verify: run on this repo, assert seed memories created + searchable.

---

## Phase 5 — Auto-improvement loop [G7]
- **Create** `services/jobs/auto-improve-job.ts` — scheduled review of completed Synapse sessions / recent observations; detect patterns (repeated queries, common fixes, frequently-referenced files); propose memory edits as `pending` proposals with audit trail. Optional review gate (`memory.autoImprove.reviewGate`); default auto-approve with logging.
- Surfaces proposed edits via a new tool/route `list_proposals` + `approve_proposal` (or auto-apply). Emit `memory:auto-improved`.
- **Dependencies:** Phase 3 (observations) or session data. **Risk M · Effort M · Migration: proposals table (pending/approved/rejected).**

---

## Phase 6 — Cross-session handoffs [G2]
- **Create** `services/handoff/handoff-service.ts` + **Handoff table** (SQLite-canonical): `id, source_session_id, target_agent, summary, open_questions_json, next_steps_json, files_json, status(open/accepted/expired), created_at, accepted_at`.
- MCP tools `handoff_begin` / `handoff_accept` / `handoff_cancel`. Route `apps/tools-api/src/routes/handoff.ts`.
- Auto-inject pending handoff into context on session start (consumes Phase 3 SessionStart hook or a check in `recall`).
- **Dual-write** handoff as a `conversation`/`decision` memory for searchability. Emit `handoff:accepted`.
- **Risk S-M · Effort S-M · Migration: new Handoff table.**

---

## Phase 7 — Retrieval + compression polish (original nice-to-have)

### 7a. Cross-encoder / LLM-judge reranking
- `services/search/reranker.ts` (`LLMJudgeReranker` via `llm-client.llmObject`; optional Cohere via `@ai-sdk/cohere`). After centrality boost (`search-controller.ts:324`), re-score top-K (`rerankWindow=50`) if `search.rerank.enabled`. Degrade to RRF order. Emit `search:reranked`. **Risk M · Effort M.**

### 7b. Auto importance/salience on `remember`
- `services/memory/salience-judge.ts`; `memory-service.ts store()` — when `importance` omitted, score 0–1 via `llm-client` (also dedup signal). Gate `memory.autoImportance.enabled`. Feeds `decay.ts` as `salience`. **Risk M · Effort S-M.**

### 7c. Graph-neighbor as 3rd RRF stream
- `ContextualSearchRLM.search` assemble `[vector, fts, graphNeighbors]`; neighbors via `GraphStore.bfs` depth 2 of top vector hits. **Risk S · Effort S-M.**

### 7d. Wire LLM compression
- `code-compressor.ts:32` — branch on `config.llm.enabled`: structure-detect then `llm-client.llmComplete` toward `targetCompressionRatio`; keep regex fallback. **Risk S · Effort S.**

### 7e. Test coverage for load-bearing untested code
- Create `etl-pipeline.test.ts` (4-stage e2e + SHA-256 skip), `smart-chunker.test.ts`, `code-compressor.test.ts` (covers 7d), `contextual-search-rlm.e2e.test.ts`. **Risk S · Effort M.**

### 7f. Remove dead code
- Delete `data/chromadb/vector-store.ts`; **first** redirect `hybrid-search.ts:10` import to real `SqliteVectorStore`/factory. Implement or clearly-error `postgres-vector-store.ts:681` `getCollection`. **Gated on 7e.** **Risk S-M · Effort S.**

---

## Phase 8 — Web UI [G5]
- **Create** `apps/web-ui/` — read-only HTML browser over SQLite memories + FTS5 search (no wiki needed). Views: project list, memory browser (filter by type/level/importance), search interface, handoff list, checkpoint list. Markdown render + syntax highlight + dark mode. Serve via tools-api or standalone static.
- Consumes existing search/recall APIs; no new core logic.
- **Risk S · Effort M · Migration none.**

---

## Explicitly rejected
- **G4 markdown wiki + git versioning** — SQLite-canonical chosen; avoids dual-source sync. (A future export-to-markdown can revisit.)
- **G10 multi-user attribution** — low value for single-user local-first use; userId column exists if needed later.
- Items from peaceful-swan that overlapped existing work (decay formula, `access_count`/`last_accessed` columns) — folded into Phase 1, not duplicated.

---

## Sequencing

```
Phase 0 (0a–0d): quick wins, independent, do first
Phase 1 (1→2→3): memory foundation; 2 creates llm-client; 3 parallel
Phase 2 (4):     query rewrite (needs llm-client)
Phase 3 (G1):    hook capture (needs Phase 1 llm-client + consolidation)
Phase 4 (G6):    bootstrap (needs llm-client); independent of G1
Phase 5 (G7):    auto-improve (needs Phase 3 observations/sessions)
Phase 6 (G2):    handoffs (independent; lighter after Phase 3)
Phase 7 (7e partial first, then 7a–7d, 7f last): polish
Phase 8 (G5):    web UI (consumes stable APIs, do late)
```

Recommended order: **0 → 1 → 2 → 3 → 4 → 6 → 5 → 7(e first) → 8.**

---

## Verification (end-to-end)

**Per-item unit/property tests** (Bun `bun:test`) per above; new modules get `*.test.ts` following `scoring-pipeline.test.ts`, `base-vector-store.test.ts:23` mock, `concurrent-indexing.test.ts`.

**Integration:**
- `bun test` (all existing + new, no regressions); `bun run type-check` + `bun run lint` clean.
- Index `packages/core` fixture; confirm SQLite consolidation creates SUPERSEDES edges + hides superseded rows on recall.

**End-to-end via MCP (local-first Ollama):**
1. `ollama serve` + `ollama pull bge-m3` + `ollama pull qwen2.5-coder:7b`.
2. `bun run dev:api` + `bun run dev:mcp`.
3. `index` multi-language fixture → all 30+ exts indexed (0a); SSE job survives API restart (Phase 3).
4. `search "auth middleware"` with `RLM_LLM_ENABLED=true` → rewrite fires (`search:query-rewritten`), HyDE vector joins fusion, beats rewrite-off baseline.
5. `remember` w/o `importance` → auto-salience (7b); wait consolidation interval → SUPERSEDES edge appears.
6. **Hook e2e:** install Claude Code hook scripts, run a session → Observation rows appear → consolidated into memory.
7. **Bootstrap e2e:** `bootstrap` on this repo → seed memories created + searchable.
8. **Handoff e2e:** `handoff_begin` → new session → `recall` surfaces it → `handoff_accept`.
9. **Web UI:** serves + FTS search returns results + memory browser renders.
10. `RLM_LLM_ENABLED=false` → every LLM feature degrades silently, no errors.

**Bench (optional):** `bun run bench:fixture` (needle-in-haystack) to quantify retrieval-quality deltas (Phase 2, 7a, 7c).
