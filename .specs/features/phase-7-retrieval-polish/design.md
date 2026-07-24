# Phase 7 — Retrieval + compression polish: Design

Companion to `spec.md`. Records the design decisions, degradation paths, and the
dead-code redirect plan. Verified against source this phase (file:line in spec).

## 1. Rerank window + LLM-judge path (7a)

**Where:** `SearchController` after `applyBoost` (`search-controller.ts:151`).
`applyBoost` returns `boostedResults`; we insert `rerankedResults =
LLMJudgeReranker.rerank(query, boostedResults, window)` between boost and the
`.map` formatting at `:155`.

**Window:** top-K where K = `config.get("search").rerank.rerankWindow` (default
50). Re-scoring more than 50 candidates through a local LLM is latency-hostile;
the bottom of the list (rank >50) is already low-signal after RRF + centrality.
Only the top-K is re-ordered; the tail stays in RRF order and is spliced back.

**LLM contract:** single `llmObject(prompt, RerankVerdictSchema)` where
`RerankVerdictSchema = z.object({ rankedIds: z.array(z.string()) })`. The prompt
carries the query + the top-K `{id, content (truncated to ~500 chars), score}`
pairs and asks for a strict re-order. The returned `rankedIds` is a permutation
guide:
- ids present in both → placed in LLM order.
- ids missing from the verdict → appended in their original order.
- duplicate ids in the verdict → first occurrence wins, rest dropped.

The re-ordered top-K is `slice(0, window)` then the remaining tail
(`boostedResults.slice(window)`) is concatenated unchanged. Final list length
== input length (rerank never drops results).

**Degradation (R7A-02):** any of `!search.rerank.enabled`, `!isLlmEnabled()`,
`llmObject → {ok:false}`, or throw → return input verbatim. Single try/catch
around the whole rerank; logged at warn. Never throws to `SearchController`.

**Event:** reuse `search:reranked` (`event-bus.ts:87`). The existing shape is
`{ query, projectId, streamCount, resultCount }`. We add an OPTIONAL
`source?: "rrf" | "llm-judge"` field — additive, backward-compatible (Phase-2
publisher omits it; 7a publisher sets `source: "llm-judge"`). `streamCount`
reuses the RRF stream count (2 or 3 after 7c).

**Why not Cohere:** `@ai-sdk/cohere` is not a dependency and the plan allows
the LLM-judge path. Adding a heavy SDK for an optional ranker violates the
minimal-deps posture. The LLM-judge path reuses the Phase-1 local-first
`llm-client` (Ollama default), so it inherits silent-degrade + timeout for free.

## 2. Salience scoring (7b)

**Where:** `MemoryController.store` (`memory-controller.ts:108`). Today:
`importance = 0.5` default. New: if `input.importance === undefined` AND
`memory.autoImportance.enabled` AND `isLlmEnabled()` → `importance =
await scoreSalience(content, type)`. Else `0.5`.

**Caller-wins rule:** explicit `importance` (including `0`) is NEVER overridden.
Only an omitted importance triggers auto-scoring. This preserves every existing
caller (bootstrap seeds 0.6, handoff seeds 0.7, etc.).

**SalienceJudge.scoreSalience:** `llmObject(prompt, z.object({ importance:
z.number().min(0).max(1) }))`. Prompt: content (truncated to ~2000 chars) + type
+ a rubric (decision-impact, reusability, rarity). Returns the clamped score.

**Neutral default:** LLM off / `{ok:false}` / throw → `0.5` (the pre-Phase-7
default). No throw escapes `store()`.

**Embedding-independence:** salience is content-based, not vector-based. The
Phase-5/4/6 seed memories (FTS-only, `embedding:[]`) are scored identically —
the judge never reads the embedding. This satisfies the Phase-5 note.

**Decay feed-forward:** the scored `importance` IS the `salience` field of
Phase-1 `decayScore(mem, params)` (`decay.ts:73` reads `mem.importance`). No
schema change — the column already exists.

**Event:** new `memory:salience-scored: { memoryId, projectId?, salience,
source: "llm" | "default" }`. Published after `repo.insert` succeeds (so the
memoryId exists). Not published on neutral-default / throw.

## 3. Graph-neighbor BFS stream (7c)

**Method:** `GraphStore.bfsNeighbors(seedIds: string[], depth: number): string[]`.
Implementation: BFS over `getOutgoingEdges` (`graph-store.ts:209`), visited set,
queue of `{id, depth}`. Collect ids at 1..depth hops. Exclude the seeds from the
output unless re-reached via a cycle (so a self-loop still surfaces the seed).
Dedup. Depth capped at `depth` (caller passes 2). Total bounded by
`seedIds.length * branching^depth` — for depth 2 and typical graph density this
is <100 ids.

**Stream construction (ContextualSearchRLM.search):** after the
vector+keyword+(QU) streams are computed, take the top-N (N =
`Math.min(maxResults, 20)`) vector-hit ids, call `bfsNeighbors(ids, 2)`, filter
out ids already in the result set (avoid double-counting in RRF), resolve the
remainder to `SearchResult` via a repo `getByIds` lookup. Score = fixed 0.45
(below a typical direct vector hit, above the `minScore` 0.3 floor, so RRF
surfaces them mid-list). Append as `resultSets.push(graphResults)`.

**Degradation (R7C-03):** if `bfsNeighbors` returns [] OR throws OR the repo
lookup returns [] → do not push the stream. `resultSets` stays at 2 (or 3 if QU
on). `search:reranked`/`search:query-rewritten` `streamCount` reflects reality.
No throw.

**Why a fixed score, not a learned one:** the neighbor stream is a recall
expander (graph-adjacent context the vector/keyword streams missed), not a
precision ranker. RRF + the subsequent 7a LLM-judge rerank handle final
ordering. A fixed sub-hit score keeps neighbors from drowning out direct hits.

**Why outgoing-only:** SUPERSEDES/RELATED edges are directional (Phase-1
read-side seam). Incoming edges (X is superseded BY Y) would surface stale
memories. Outgoing (Y supersedes X, X related-to Z) surfaces the fresh/related
one.

## 4. LLM compression branch (7d)

**Where:** `code-compressor.ts:compress` (`:32`). Today: pure regex
`compressStructure`. New: if `config.get("llm").enabled` → LLM path; else regex
path (unchanged).

**LLM path:**
1. `extractStructure(content)` (existing) — gives the language hint + signature
   list for the prompt.
2. Build a prompt: original content (truncated to the LLM context budget) +
   the detected language + the target ratio (`config.compression.targetCompressionRatio`,
   default 0.7) + the extracted signatures as "must preserve".
3. `llmComplete(prompt, { timeoutMs: config.llm.timeoutMs })`.
4. If `{ok:true}` AND result.length <= content.length AND result is non-empty →
   use it; else fall back to `compressStructure` output. Record
   `metadata.compressionSource = "llm"`.
5. Regex path records `metadata.compressionSource = "regex"`.

**Fallback triggers (R7D-02):** LLM off; `{ok:false}`; throw; result longer
than original (target ratio violated); empty result. The regex output is always
computed first (cheap) so the fallback is instant.

**`preservedElements`:** the LLM path still returns the regex-extracted
signatures as `preservedElements` (so downstream `CompressedContent` shape is
stable). Only `compressed` text changes source.

**Test coverage:** the 7e `code-compressor.test.ts` is extended in the 7d commit
to assert: LLM-on path uses the mock `llmComplete` output (assert the mock
string is in `compressed`); LLM-off path uses the regex output; LLM-returns-empty
→ regex fallback; LLM-throws → regex fallback.

## 5. Dead-code redirect plan (7f) — the load-bearing part

**The trap:** `data/chromadb/vector-store.ts` exports BOTH:
- `VectorStore` (the dead ChromaDB stub — only `hybrid-search.ts:10` imports
  it, and `hybrid-search.ts` is itself not on the `ContextualSearchRLM` hot
  path).
- `EmbeddingService` (LIVE — imported by `sqlite-vector-store.ts:19` as
  `ChromaEmbeddingService`, `memory-service.ts:10`, `relation-extractor.ts:104`).

Naively deleting the file breaks 3 live importers + type-check.

**Step-by-step (order matters):**
1. Create `packages/core/src/services/embeddings/embedding-service.ts`
   containing the relocated `EmbeddingService` class (verbatim move — same
   imports of `createEmbeddingProvider`/`EmbeddingProvider` from
   `services/embeddings/index.js`).
2. Re-export it from `services/embeddings/index.ts` (the existing barrel).
3. Redirect the 3 live importers:
   - `sqlite-vector-store.ts:19` → `import { EmbeddingService } from
     "../../services/embeddings/index.js"` (drop the `ChromaEmbeddingService`
     alias).
   - `memory-service.ts:10` → same.
   - `relation-extractor.ts:104` → same.
4. Redirect `hybrid-search.ts:10` (the dead `VectorStore` importer) →
   `import { SQLiteVectorStore } from "../vector/sqlite-vector-store.js"` (or
   `getVectorStore` — but `HybridSearch` ctor instantiates it directly, so the
   class is cleaner; verify the ctor signature matches).
5. Delete `data/chromadb/vector-store.ts` AND `data/chromadb/index.ts` (barrel
   only re-exported the two symbols; both now live elsewhere).
6. Run type-check (the gate — any missed importer fails here).
7. Run the 7e tests (the e2e search test exercises `ContextualSearchRLM` →
   `getVectorStore` → `SQLiteVectorStore` → the relocated `EmbeddingService`;
   green = the rewiring is correct).

**`getCollection` (R7F-04):** `postgres-vector-store.ts:681` already throws
`Error('getCollection not implemented for PostgresVectorStore')`. The plan's
"implement or clearly-error" is satisfied. No code change; documented here.

**Abort condition (R7F-05):** if step 6 or 7 fails and cannot be fixed in ≤3
iterations, revert steps 1–5 (restore the chromadb file), leave 7e/7a–7d
commits intact, and report 7f as Blocked. Never delete dead code with a broken
import.

## 6. Degradation matrix (all paths)

| Item | LLM off | LLM `{ok:false}`/throw | Data unavailable |
|---|---|---|---|
| 7a rerank | input order verbatim | input order verbatim | n/a (in-memory) |
| 7b salience | 0.5 default | 0.5 default | n/a |
| 7c graph stream | stream omitted | n/a (no LLM) | `bfsNeighbors` []/throw → omit |
| 7d compression | regex output | regex output | n/a |
| 7f redirect | n/a | n/a | type-check + e2e gate |

Every path is default-off (config gate) + silent-degrade. No new feature throws
to its caller. This matches the Phase-1–6 contract.

## 7. Test-isolation (extends Phase-1..6 rule)

- 7e/7a/7b/7c/7d tests do NOT `mock.module("@massa-ai/shared")`. They inject
  fakes via ctor seams (`LLMJudgeReranker`, `SalienceJudge`, the existing
  `_setLlmEnabledForTesting` seam) and use explicit temp `dbPath`s for any DB
  touch.
- The `contextual-search-rlm.e2e.test.ts` uses an isolated temp dataDir (mirrors
  the P4/P6 SEARCH-01 pattern), restored in `afterEach`.
- No real `MemoryRepository` singleton is closed by these tests (the
  closed-singleton landmine from `memory-crud.test.ts`).

## 8. Same-author caveat

Sole agent for Phase 7. No independent second agent. Mitigations: every AC is
file:line-anchored in `validation.md`, each implementation item ships a
discrimination-sensor mutant that its AC test kills, and the gate is the
objective `bun run test` + `bun run type-check`.
