# Phase 7 — Retrieval + compression polish: Tasks

Strict order (non-negotiable): **7e → 7a, 7b, 7c, 7d → 7f**. 7f is gated on 7e
green. One atomic commit per task. Never batch, never `git push`.

## Task 7e — Characterization tests (DO FIRST)

- [ ] `__tests__/etl-pipeline.test.ts` — 4-stage E2E + SHA-256 skip. Fixture
      temp project. Assert `EtlResult` shape + `indexing:started/completed`
      events + second-run skip.
- [ ] `__tests__/smart-chunker.test.ts` — md/json/yaml/code/fixed paths +
      `maxChunkChars` + tiny-merge + context header.
- [ ] `__tests__/code-compressor.test.ts` — regex path characterization
      (imports/interfaces/classes/fns, lang detect, estimate, identity
      fallback). [Extended in 7d for the LLM branch.]
- [ ] `__tests__/contextual-search-rlm.e2e.test.ts` — isolated temp DB, index
      fixture, search returns metadata + highlights, minScore filter, cache hit.
      (This is the 7f gate.)
- [ ] **Commit** `test(phase-7): characterize etl/chunker/compressor/search-rlm`.

## Task 7a — LLM-judge reranker

- [ ] Config: `search.rerank: { enabled, rerankWindow }` in `ServerConfig` +
      `defaultConfig` + `mergeConfig` (env `SEARCH_RERANK_ENABLED`,
      `SEARCH_RERANK_WINDOW`).
- [ ] `services/search/reranker.ts` — `LLMJudgeReranker.rerank(query, results,
      window?)` via `llmObject` + `RerankVerdictSchema`. Degrade to input order.
- [ ] Wire `SearchController`: `applyBoost` → `LLMJudgeReranker.rerank` →
      format. Emit `search:reranked` with `source: "llm-judge"` (optional field).
- [ ] Test: LLM-on re-orders per verdict; LLM-off returns input order; missing/
      dup ids handled; empty list no-op. Discrimination mutant: remove degrade
      branch → LLM-off test fails.
- [ ] **Commit** `feat(search): add LLM-judge reranker (7a)`.

## Task 7b — Auto salience on remember

- [ ] Config: `memory.autoImportance: { enabled }` (env
      `AUTO_IMPORTANCE_ENABLED`, default false).
- [ ] `services/memory/salience-judge.ts` — `scoreSalience(content, type,
      opts?)` via `llmObject`. Clamp 0–1.
- [ ] Wire `MemoryController.store`: `importance === undefined` +
      `autoImportance.enabled` + `isLlmEnabled()` → `scoreSalience`; else 0.5.
      Caller-wins for explicit importance.
- [ ] EventMap: `memory:salience-scored: { memoryId, projectId?, salience,
      source }`. Emit after insert.
- [ ] Test: omitted importance + LLM on → scored; LLM off → 0.5; explicit 0 →
      stays 0; throw → 0.5. Mutant: skip the `undefined` guard → explicit-0
      test fails.
- [ ] **Commit** `feat(memory): auto importance/salience on remember (7b)`.

## Task 7c — Graph-neighbor 3rd stream

- [ ] `GraphStore.bfsNeighbors(seedIds, depth)` — BFS over
      `getOutgoingEdges`, visited set, dedup.
- [ ] `ContextualSearchRLM.search`: top-N vector ids → `bfsNeighbors(_, 2)` →
      repo `getByIds` → score 0.45 → `resultSets.push`. Silent-omit on empty/
      throw.
- [ ] Test: graph stream appears when neighbors exist; omitted when empty;
      cyclic graph bounded; streamCount reflects 2 vs 3. Mutant: hardcode empty
      → graph-stream test fails.
- [ ] **Commit** `feat(search): graph-neighbor 3rd RRF stream (7c)`.

## Task 7d — LLM compression branch

- [ ] `code-compressor.ts:compress` branch on `config.get("llm").enabled`:
      structure-detect → `llmComplete` toward target ratio; keep regex fallback.
      Record `metadata.compressionSource`.
- [ ] Extend `code-compressor.test.ts`: LLM-on uses mock output; LLM-off regex;
      empty/throw → regex.
- [ ] Mutant: remove the `llm.enabled` branch → LLM-on test fails.
- [ ] **Commit** `feat(compression): wire LLM branch in code-compressor (7d)`.

## Task 7f — Remove dead code (DO LAST, gated on 7e)

- [ ] Create `services/embeddings/embedding-service.ts` (relocated
      `EmbeddingService`, verbatim).
- [ ] Re-export from `services/embeddings/index.ts`.
- [ ] Redirect `sqlite-vector-store.ts:19`, `memory-service.ts:10`,
      `relation-extractor.ts:104` to the new location.
- [ ] Redirect `hybrid-search.ts:10` dead `VectorStore` import to
      `SQLiteVectorStore`.
- [ ] Delete `data/chromadb/vector-store.ts` + `data/chromadb/index.ts`.
- [ ] Document `postgres-vector-store.ts:681 getCollection` (already errors).
- [ ] GATE: type-check clean + 7e tests green. If break + unfixable in ≤3
      iterations → revert, leave chromadb, report Blocked.
- [ ] **Commit** `chore(vector): remove dead chromadb stub, rewire imports (7f)`.

## Task — Validation + ledger

- [ ] `bun run --filter @massa-th0th/core test` (no regression vs 822).
- [ ] `bun run type-check` (5/5 clean).
- [ ] Write `validation.md` (verdict, per-AC evidence table, discrimination
      sensor result, gate output, same-author caveat).
- [ ] Append Phase-7 delta to `.specs/PHASE-INTEGRATION.md` + commit-ledger.
- [ ] Update `.specs/project/STATE.md`, `FEATURES.json`, `HANDOFF.md`.
- [ ] **Commit** `docs(specs): phase-7 validation + integration ledger`.
