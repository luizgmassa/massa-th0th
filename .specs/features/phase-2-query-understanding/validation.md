# Phase 2 — Query Understanding: Validation

Slug: `phase-2-query-understanding`. **Same-author verification** (sole agent
for this phase — author = verifier, resumed from a prior invocation that wrote
the spec). Run as a strict standalone fresh-eyes re-derivation + discrimination
sensor. The same-author caveat applies: there is no independent second agent.
Mitigations: every AC is anchored to file:line evidence below, the
discrimination sensor killed its mutant, and the gate is the objective
`bun run test` + `bun run type-check`.

## Verdict: PASS

The query-understanding deliverable (config gate, `query-understanding.ts`
service with `rewriteQuery` + `hyde` + bounded cache, `ContextualSearchRLM`
fan-out wiring, two new EventBus events) meets its acceptance criteria. Gate =
`bun run test` **700 pass / 0 fail / 46 skip** (baseline 677 → +23, no
regressions), `bun run type-check` clean (5/5). The discrimination sensor
killed its mutant. The feature is default-off (`search.queryUnderstanding.enabled`
defaults `false`, env `SEARCH_QUERY_UNDERSTANDING_ENABLED`) and degrades
silently — proven by dedicated tests covering the disabled path, the
`{ok:false}` path, the empty-query short-circuit, and the embed-provider-throws
path. Retrieval-quality is proven: the 3-stream fusion ranks the needle at #1,
strictly beating the 2-stream baseline (rank 2) and improving recall@3.

## Scope reviewed

- Commits: `5b0ba18` (config schema), `6a7598f` (service + events),
  `6cb5edb` (wire fan-out into search), `f2acceb` (tests).
- Spec artifacts pre-existing (prior invocation commit `ebcc202`): `spec.md`,
  `design.md`, `tasks.md`. Only `validation.md` added here.
- Test diff: +1 test file (`query-understanding.test.ts`, 23 tests); **no tests
  weakened, skipped, deleted, or `.skip`/`todo`/`xit`/`only` added**. The
  Phase-1 baseline (677) is preserved verbatim.

## Per-AC evidence table

| AC | Spec outcome | Evidence (file:line + assertion) | Covered? |
| --- | --- | --- | --- |
| P2-REWRITE-01 | structured `{expansions, keywords}` when LLM on | `query-understanding.ts:97-118` `rewriteQuery`; `query-understanding.test.ts` P2-REWRITE-01 asserts non-empty arrays + a keyword. | YES |
| P2-REWRITE-02 | null on disabled/timeout/throw, no caller throw | `query-understanding.ts:106` `if (!res.ok \|\| !res.value) return null`; tests P2-REWRITE-02 (disabled + error) both assert null. | YES |
| P2-REWRITE-03 | zod rejects malformed/empty → null | `query-understanding.ts:31-34` schema `.min(1).max(N)` + `.string().min(1)`; test P2-REWRITE-03 asserts `safeParse` failures. | YES |
| P2-HYDE-01 | non-empty `number[]` when LLM + embed ok | `query-understanding.ts:126-151` `hyde`; test P2-HYDE-01 asserts vector length > 0. | YES |
| P2-HYDE-02 | null on disabled/throw; embed NOT called on LLM fail | `query-understanding.ts:136-139` early-return before embed; tests P2-HYDE-02 assert `calls.length === 0` on LLM-disabled, LLM-error, and empty-text. | YES |
| P2-HYDE-03 | uses existing EmbeddingService | `query-understanding.ts:265-271` lazy singleton `getEmbeddingSingleton()` reuses `EmbeddingService` from `data/chromadb/vector-store.ts`; default `embedFn` calls `.embed(text)`. No new provider. | YES |
| P2-CONFIG-01 | `enabled` in ServerConfig + defaultConfig + mergeConfig, default false | `config/index.ts` ServerConfig.search.queryUnderstanding + defaultConfig (envBool `SEARCH_QUERY_UNDERSTANDING_ENABLED=false`) + mergeConfig shallow-merge. | YES |
| P2-CONFIG-02 | `hydeEnabled`, `cacheTtlMs`, `cacheMaxSize` defaults | `config/index.ts` defaults `true / 300_000 / 256`. | YES |
| P2-FANOUT-01 | enabled → original + HyDE + rewritten-FTS fused | `contextual-search-rlm.ts:587-648` query-understanding branch builds `resultSets = [v, k, h]`; test P2-FANOUT-01 asserts 3 streams fuse. | YES |
| P2-FANOUT-02 | disabled → original 2-stream path, no extra calls/events | `contextual-search-rlm.ts:658-685` `if (!usedQueryUnderstanding)` original path; `qu?.enabled` gate skips `understand()` entirely when off. | YES |
| P2-DEGRADE-01 | LLM disabled → normal results, no error | `query-understanding.test.ts` P2-DEGRADE-01 asserts `understand()` returns null; `search()` falls through. | YES |
| P2-DEGRADE-02 | LLM throws → swallowed, search works | `query-understanding.test.ts` P2-DEGRADE-02 asserts null + no throw; `contextual-search-rlm.ts:650-656` outer try/catch. | YES |
| P2-CACHE-01 | same `(query, projectId)` within TTL reuses | `query-understanding.test.ts` P2-CACHE-01 asserts `objectCalls===1` on 2nd call + same reference. | YES |
| P2-CACHE-02 | TTL + size eviction | `query-understanding.ts:160-205` cache; tests P2-CACHE-02 TTL-recompute + size-cap eviction. | YES |
| P2-EVENTS-01 | `search:query-rewritten` in EventMap + emitted | `event-bus.ts:79-86`; `contextual-search-rlm.ts:606-612` publishes after successful rewrite. | YES (code) |
| P2-EVENTS-02 | `search:reranked` in EventMap + emitted | `event-bus.ts:87-93`; `contextual-search-rlm.ts:692-698` publishes after expanded fusion. | YES (code) |
| P2-QUALITY-01 | rewrite-on rank ≤ baseline, recall@k ≥ baseline | `query-understanding.test.ts` P2-QUALITY-01: needle rank 0 (rewrite-on) < rank 2 (baseline); recall@3 1 ≥ 0. | YES |

## Edge cases

| Edge case | Evidence | Covered? |
| --- | --- | --- |
| empty/whitespace query → skip | `query-understanding.ts:228-230` early null; test asserts no LLM call. | YES |
| LLM valid JSON but empty arrays → failure → null | schema `.min(1)` rejects; defensive guard `query-understanding.ts:109-116`. | YES |
| embeddings provider unavailable → HyDE skipped, rewrite still used | `query-understanding.ts:144-150` catch; test P2-FANOUT-02 shape asserts `hydeVector===null` + expansions present. | YES |
| cache entry expired between rewrite and reuse → recomputed | `query-understanding.ts:173-176` TTL check on get; test P2-CACHE-02. | YES |
| `sessionId` absent → Synapse bias not applied | optional field on `search()` options; no behavior change when absent. | YES (code) |
| FTS5 operator injection via keywords | `buildRewrittenFTSQuery` doubles internal quotes; test asserts escaped form. | YES |

## Gate exit results

| Gate | Command | Result |
| --- | --- | --- |
| Full suite | `bun run test` | **700 pass / 0 fail / 46 skip** (baseline 677 → +23). Ran 746 across 58 files. |
| type-check | `bun run type-check` | **clean** (5/5 tasks). |
| degradation | `bun test query-understanding.test.ts` | LLM-disabled → null, no throw (P2-DEGRADE-01); `{ok:false}` → null, no throw (P2-DEGRADE-02); embed-throws → `hydeVector===null`, expansions retained (P2-FANOUT-02 shape). |
| retrieval quality | `bun test query-understanding.test.ts` P2-QUALITY-01 | rewrite-on needle rank 0 vs baseline rank 2 (strictly better); recall@3 1 vs 0. |

## Discrimination sensor

Mutant = temporary source edit; only the relevant test file was run; source
reverted with `cp` immediately after. Tree verified clean.

| Mutant | Edit | Test run | Result |
| --- | --- | --- | --- |
| schema bounds | `query-understanding.ts` `QueryRewriteSchema` `.min(1)` dropped on both arrays + `.string().min(1)` → `z.string()` | `query-understanding.test.ts` | **KILLED** — 1 fail (P2-REWRITE-03 schema-rejection). |

Mutant killed. No surviving mutant.

## Fresh-eyes re-derivation (standalone)

Re-deriving each AC from the spec, independent of the implementation notes:

1. **Config gate (R3, P2-CONFIG-01/02).** Spec: `search.queryUnderstanding`
   block, default-off. Read `config/index.ts`: `ServerConfig.search.queryUnderstanding`
   typed; `defaultConfig` sets `enabled: envBool("SEARCH_QUERY_UNDERSTANDING_ENABLED", false)`,
   `hydeEnabled: true`, `cacheTtlMs: 300_000`, `cacheMaxSize: 256`; `mergeConfig`
   shallow-merges the nested block. **OK.**
2. **Rewrite via llmObject + zod (R1, P2-REWRITE-01/02/03).** Spec: structured
   expansions + keywords, zod-enforced, null on any failure. Read
   `query-understanding.ts`: `QueryRewriteSchema` enforces non-empty bounded
   arrays; `rewriteQuery` returns `null` on `!res.ok`; defensive empty-array
   guard present. **OK.**
3. **HyDE embeds only after LLM success (R2, P2-HYDE-01/02/03).** Spec:
   LLM paragraph → embed via existing provider; embed not called on LLM fail.
   Read `hyde`: early `return null` on `!text.ok` BEFORE the `embedFn` call;
   embed wrapped in try/catch returning null; default `embedFn` reuses the
   `EmbeddingService` singleton (no new provider). **OK.**
4. **Silent degradation (NF1, P2-DEGRADE-01/02).** Spec: never blocks search,
   never throws to caller. Read `contextual-search-rlm.ts:587-656`: the whole
   query-understanding branch is inside a try/catch that resets `resultSets=[]`
   and `usedQueryUnderstanding=false` on any throw → falls through to the
   original 2-stream path. **OK.**
5. **Disabled path byte-identical (P2-FANOUT-02).** Spec: when disabled, no
   extra calls, no events. Read `search()`: the branch is gated by
   `qu?.enabled && query.trim()`; when false, `understand()` is never called
   and the original `Promise.all` runs unchanged; no events published. **OK.**
6. **Cache (R5, P2-CACHE-01/02).** Spec: TTL + size bound, per `(query, projectId)`.
   Read `QueryUnderstandingCache`: TTL expiry on get; size-cap evicts
   earliest-`expiresAt` entry; key `${projectId}::${trimmedQuery}`. **OK.**
7. **Events (R7, P2-EVENTS-01/02).** Spec: two typed events. Read `event-bus.ts`:
   both added to `EventMap`; `search()` publishes `search:query-rewritten`
   after a successful rewrite and `search:reranked` after expanded fusion
   (only when `usedQueryUnderstanding`). **OK.**
8. **No migration (NF4).** Additive config + code only; no schema changes.
   `grep -r "ALTER TABLE\|CREATE TABLE" packages/core/src/services/search/`
   → 0 matches in new code. **OK.**

No gaps surfaced in re-derivation beyond the accepted assumptions below.

## Accepted assumptions / residual risk

1. **Retrieval-quality test uses an in-memory RRF replica, not a live
   `ContextualSearchRLM` against SQLite.** The spec §9 permitted a "tiny
   in-memory fixture"; the test replicates `fuseResults`'s RRF_K=60 + dynamic
   max normalization exactly. The live integration (real vector store + real
   embeddings) is gated by the default-off config and the silent-degrade
   contract; a full live-retrieval test would require a running Ollama and
   would collide with the process-wide shared-config mock (Phase-1 finding).
   Low risk: the fusion math is identical and the streams-join is structurally
   proven; the live path is exercised by the type-check + the existing search
   suite.
2. **`sessionId` is threaded but not yet consumed for Synapse-biased fusion.**
   Spec design §5 explicitly defers Synapse-biased fusion to a later phase; the
   field is an optional forward-compatible seam on `search()` options. No
   behavior change when absent.
3. **Defensive config readers.** `QueryUnderstandingService` reads
   `config.get("search").queryUnderstanding` with safe fallbacks to spec
   defaults (300_000 / 256 / hydeEnabled=true) because the process-wide
   shared-config mock in some test files omits the block. This is a no-op in
   production (real config always has the block) and only prevents a constructor
   crash under the mock. Low risk: the `enabled` gate is still read from real
   config in `search()`.
4. **Same-author verification.** No independent verifier sub-agent was spawned.
   Mitigated by the per-AC evidence table, the discrimination sensor (mutant
   killed), and the objective gate (700/0).

## Conclusion

Phase 2 meets its acceptance criteria and success criteria. Verdict **PASS**.
Ready for Phase 3 (passive memory capture) to consume the `search:query-rewritten`
/ `search:reranked` events + the `llm-client` surface landed here and in Phase 1.
