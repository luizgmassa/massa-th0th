# Phase 7 — Retrieval + compression polish: Specification

Slug: `phase-7-retrieval-polish`. Plan reference:
`i-want-to-understand-virtual-lantern.md` § "Phase 7" (items 7a–7f) +
cross-cutting §1–5. Workflow: `spec-driven` (TLC v3). Branch: `main`.
projectId: `massa-ai`; workflowSessionId: `spec-virtual-lantern-plan`.

## Goal

Polish the retrieval + compression stack that earlier phases wired but did not
harden: characterize + cover the load-bearing untested ETL/search/compression
code, add an LLM-judge reranker on top of RRF + centrality, score memory
salience automatically on `remember`, surface graph neighbors as a third fusion
stream, route code compression through the LLM when enabled, and remove the dead
ChromaDB stub that two production imports still point at.

## Scope

In scope: items 7a–7f (the plan's strict order is **7e first → 7a, 7b, 7c, 7d →
7f last**; 7f is gated on 7e). Cross-cutting decisions §1–5 (shared LLM client,
SQLite first-class / no `isPostgresEnabled()` short-circuit, EventBus as the
integration bus, additive migrations) are honored verbatim.

Out of scope:
- Replacing RRF with a learned ranker; reranking is an LLM-judge re-score of a
  fixed top-K window only.
- Adding the Cohere cross-encoder dependency (7a uses the LLM-judge path via
  `llm-client`; Cohere only if `@ai-sdk/cohere` is already present — it is not).
- Embedding the FTS-only memories (bootstrap/handoff/auto-improve seeds);
  7b scores salience on insert without requiring an embedding.
- A new persistence table; all 7a–7e changes are additive config + code + tests.
- Soft-delete / pinned work (landed in Phase 1).

## Verified integration points (source-first, this phase)

- `ContextualSearchRLM.search` builds `resultSets: SearchResult[][]` then calls
  `this.fuseResults(...)` (not `HybridSearch.rerank`). The 7c graph stream plugs
  into `resultSets`. Centrality boost lives inside `fuseResults`
  (`contextual-search-rlm.ts:901-908`), not in `search-controller`.
- `SearchController.applyBoost` is the file-centrality boost
  (`search-controller.ts:325`, applied at `:151-152`); the 7a rerank injection
  point is immediately after `applyBoost` returns `boostedResults`.
- `EventMap."search:reranked"` already exists (`event-bus.ts:87`) with shape
  `{ query, projectId, streamCount, resultCount }`. 7a reuses it (adds an
  optional `source` discriminator kept backward-compatible).
- `HybridSearch.rerank(SearchResult[][])` exists (`data/vector/hybrid-search.ts:85`)
  but `ContextualSearchRLM` does not use it — it has its own `fuseResults`. 7c
  extends the in-class `resultSets`; `HybridSearch` is left intact (its
  `rerank` is already 3rd-stream-ready per Phase 2).
- `MemoryController.store` (`controllers/memory-controller.ts:108`) is the
  `remember` insert path; `importance` defaults to `0.5` at `:116`. This
  is the 7b injection point (when `input.importance === undefined`).
- `GraphStore` exposes `createEdge`, `getOutgoingEdges`, `getIncomingEdges`
  (`graph-store.ts:103/209/216`) but **no BFS/traversal** — 7c adds a focused
  `bfsNeighbors(seedIds, depth)` method.
- `code-compressor.ts:32` `compress()` has no LLM branch; 7d adds one gated on
  `config.get("llm").enabled`, keeping the regex fallback.
- `data/chromadb/vector-store.ts` is a stub `VectorStore` (dead) that ALSO
  exports the LIVE `EmbeddingService`. Two production imports read this file:
  `hybrid-search.ts:10` (dead `VectorStore`) and `sqlite-vector-store.ts:19`
  + `memory-service.ts:10` + `relation-extractor.ts:104` (live
  `EmbeddingService`). 7f must relocate `EmbeddingService` THEN delete the
  chromadb file.
- `postgres-vector-store.ts:681` `getCollection` already throws a clear
  `Error('getCollection not implemented for PostgresVectorStore')` — satisfies
  the plan's "implement or clearly-error". 7f documents this; no code change.

## Requirements + Acceptance Criteria

### 7e — Characterization tests for load-bearing untested code (DO FIRST)

**R7E-01** `__tests__/etl-pipeline.test.ts` asserts the 4-stage
discover→parse→resolve→load flow over a temp project (fixture files), including:
`EtlResult` shape (`filesDiscovered`, `filesIndexed`, `filesSkipped`,
`chunksIndexed`, `symbolsIndexed`, `errors`, `durationMs`, `stageTimings` with
all 4 keys), `indexing:started`/`indexing:completed` EventBus events, and the
SHA-256 skip-if-unchanged path (second run with no file changes indexes 0 new
files / reports `filesSkipped` ≥ 1). Characterization: assert ACTUAL behavior.

**R7E-02** `__tests__/smart-chunker.test.ts` asserts: markdown heading-split
(including preamble + heading-chain label), JSON top-level-key split with the
<5-key single-chunk fast path, YAML `---` document split, code brace-depth
boundaries (class + method labels like `Foo.bar`), fixed fallback for unknown
exts, `maxChunkChars` enforcement, tiny-chunk merge, and the file-context
prefix + label-repeat header.

**R7E-03** `__tests__/code-compressor.test.ts` asserts (covers 7d too):
`compressStructure` preserves imports/interfaces/classes/functions/exports,
language detection (TS/JS/Python/Rust/Go/unknown), `estimateCompression`,
`identity` fallback on throw, and BOTH the regex path (LLM off) and the LLM
path (LLM on, mock `llmComplete`) once 7d lands. (This test is extended in the
7d commit to cover the new branch; 7e lands the regex-path characterization.)

**R7E-04** `__tests__/contextual-search-rlm.e2e.test.ts` asserts an end-to-end
search over an isolated temp DB: index a small fixture project, search returns
`SearchResult[]` with `filePath`/`lineStart`/`lineEnd` metadata + highlights,
`minScore` threshold filters, and the cache hit path returns the same results.
Uses an explicit temp `dbPath` (avoids the closed-singleton landmine). This is
the 7f gate.

### 7a — Cross-encoder / LLM-judge reranking

**R7A-01** `services/search/reranker.ts` exports `LLMJudgeReranker` with a
`rerank(query, results, window?)` method that, when `search.rerank.enabled` AND
`isLlmEnabled()`, takes the top-K (`rerankWindow`, default 50) results after the
centrality boost and re-scores them via `llmObject` (zod schema:
`{ rankedIds: string[] }`). Returns the re-ordered top-K spliced back into the
full list.

**R7A-02** Degrade contract: when LLM off OR `llmObject` returns `{ok:false}`
OR throws, return the input order verbatim (no throw, no re-order). Logged at
warn.

**R7A-03** Wire: `SearchController` applies `applyBoost` then, if
`search.rerank.enabled`, calls `LLMJudgeReranker.rerank(query, boostedResults)`
BEFORE formatting. Emits `search:reranked` via `eventBus` with
`source: "llm-judge"` (optional field; backward-compatible with the Phase-2
shape). The `streamCount` field reuses the RRF stream count.

**R7A-04** Config: add `search.rerank: { enabled (envBool
SEARCH_RERANK_ENABLED, false); rerankWindow (envNum SEARCH_RERANK_WINDOW, 50) }`
to `ServerConfig.search` + `defaultConfig` + `mergeConfig` (shallow-merge nested,
mirrors `queryUnderstanding`).

### 7b — Auto importance/salience on remember

**R7B-01** `services/memory/salience-judge.ts` exports `scoreSalience(content,
type, opts?)` → `Promise<number>` (∈ [0,1]). When `memory.autoImportance.enabled`
AND `isLlmEnabled()`, scores via `llmObject` (zod: `{ importance: number }`
clamped 0–1). Used as the `salience` input to Phase-1 `decayScore`.

**R7B-02** Wire: `MemoryController.store` — when `input.importance ===
undefined`, call `scoreSalience(content, type)`; on LLM off / `{ok:false}` /
throw, fall back to the neutral default `0.5` (no throw). When `input.importance`
is explicitly provided, use it verbatim (caller wins). Auto-improved seed
memories (embedding:[]) are scored identically — salience does not require an
embedding.

**R7B-03** Config: add `memory.autoImportance: { enabled (envBool
AUTO_IMPORTANCE_ENABLED, false) }` to `ServerConfig.memory` + `defaultConfig` +
`mergeConfig`.

**R7B-04** Event: emit `memory:salience-scored: { memoryId, projectId?,
salience, source: "llm" | "default" }` on the EventBus (add to `EventMap`).

### 7c — Graph-neighbor as 3rd RRF stream

**R7C-01** `GraphStore.bfsNeighbors(seedIds: string[], depth: number): string[]`
— returns the set of memory ids reachable within `depth` edges from any seed
(following outgoing edges; dedup; excludes seeds themselves unless reached via
a cycle). Built on `getOutgoingEdges`.

**R7C-02** `ContextualSearchRLM.search` — after computing the vector + keyword
(± query-understanding) streams, fetch the top-N vector-hit ids, call
`bfsNeighbors(ids, 2)`, resolve them to `SearchResult`s (repo lookup, score =
mild fixed e.g. 0.5 so RRF ranks them below direct hits), and append as an extra
stream in `resultSets`. Silent-omit when the neighbor set is empty OR graph
unavailable (no throw, logged at debug).

**R7C-03** Degradation: graph stream omission does not change the result count
vs the 2-stream path; the `search:reranked` (Phase-2) / `search:query-rewritten`
event `streamCount` reflects the actual stream count (2 or 3).

### 7d — Wire LLM compression

**R7D-01** `code-compressor.ts:compress` branches on
`config.get("llm").enabled`: when on, structure-detect (`extractStructure`) for
the language hint, then call `llmComplete(prompt, { timeoutMs })` with a prompt
that targets `config.compression.targetCompressionRatio`. Keep the regex
fallback (`compressStructure`) for LLM-off / `{ok:false}` / throw. The chosen
path is recorded in `CompressedContent.metadata`.

**R7D-02** The 7e `code-compressor.test.ts` is extended to cover the LLM branch
(mock `llmComplete` via the existing test seam pattern; assert the LLM output is
used when on, the regex output when off).

### 7f — Remove dead code (DO LAST, gated on 7e green)

**R7F-01** Relocate the LIVE `EmbeddingService` from
`data/chromadb/vector-store.ts` to a new `services/embeddings/embedding-service.ts`
(or co-locate with the existing `services/embeddings/index.ts`). Redirect ALL
live importers (`sqlite-vector-store.ts:19`, `memory-service.ts:10`,
`relation-extractor.ts:104`) to the new location.

**R7F-02** Redirect `data/vector/hybrid-search.ts:10` import of the dead
`VectorStore` to the real `SQLiteVectorStore` / `getVectorStore` factory.

**R7F-03** Delete `data/chromadb/vector-store.ts` + `data/chromadb/index.ts`
(the barrel only re-exported the dead `VectorStore` + the relocated
`EmbeddingService`).

**R7F-04** Confirm `postgres-vector-store.ts:681 getCollection` clearly errors
(it already does: `throw new Error('getCollection not implemented ...')`).
Document in design.md; no code change.

**R7F-05** GATE: the 7e tests (especially `contextual-search-rlm.e2e.test.ts`)
must stay green after the redirect. If the redirect breaks tests and cannot be
fixed in ≤3 iterations, STOP — leave chromadb in place and report (do NOT
delete dead code with a broken import).

## Edge cases (must be covered)

- 7a: empty result list (rerank no-op); window > result count (rerank all);
  LLM returns a rankedIds list missing some ids (append the missing in original
  order); LLM returns duplicate ids (dedup, keep first).
- 7b: `importance` explicitly 0 (caller wins, do not auto-score); empty content
  (score default); very long content (truncate to LLM context budget before
  scoring).
- 7c: seed id with no outgoing edges (empty contribution); cyclic graph (visited
  set prevents infinite loop); graph store throws (omit stream).
- 7d: LLM returns content longer than original (fall back to regex — target
  ratio not met); LLM returns empty (fall back).
- 7f: any live importer still pointing at the old chromadb path after relocation
  → type-check catches it (the gate).

## Discrimination sensor (mandatory, per phase)

Each implementation item (7a, 7b, 7c, 7d) ships a deliberate mutant that the
AC test must kill (e.g. 7a: remove the degrade-to-input-order branch → LLM-off
test fails; 7c: hardcode neighbor stream to empty → graph-stream test fails).
The mutant is reverted before commit; the killing test stays.

## Gate (non-negotiable)

- `bun run --filter @massa-ai/core test` passes with **no regression vs 822
  pass / 0 fail / 46 skip** (the pre-Phase-7 baseline). New tests add to the
  pass count; none weakened/skipped/deleted.
- `bun run type-check` clean (5/5).
- One atomic commit per task (7e, 7a, 7b, 7c, 7d, 7f) — Conventional Commits.
  Never batch. Never `git push`.
