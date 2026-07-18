/**
 * rlm-search — search god-method + fusion + scoring + context delegates
 * for ContextualSearchRLM.
 *
 * Extracted (M14 Phase 3, T3.3) from contextual-search-rlm.ts. Behavior is
 * byte-preserved: bodies moved verbatim with `this` → `rlm`.
 */

import { SearchResult, logger, config } from "@massa-th0th/shared";
import { minimatch } from "minimatch";
import { buildRewrittenFTSQuery } from "./query-understanding.js";
import { applyProximityRerank } from "./lexical-search.js";
import { eventBus } from "../events/event-bus.js";
import type { ContextualSearchRLM } from "./contextual-search-rlm.js";

// ── search ───────────────────────────────────────────────────────────────────

export type SearchOptions = {
  maxResults?: number;
  minScore?: number;
  explainScores?: boolean;
  includeFilters?: string[];
  excludeFilters?: string[];
  /** Phase 2: Synapse session id forwarded for future Synapse-biased fusion. */
  sessionId?: string;
};

export async function searchImpl(
  rlm: ContextualSearchRLM,
  query: string,
  projectId: string,
  options: SearchOptions = {},
): Promise<SearchResult[]> {
  await rlm.ensureInitialized();
  const maxResults = options.maxResults ?? 10;
  const minScore = options.minScore ?? 0.3;
  const explainScores = options.explainScores || false;
  const includeFilters = options.includeFilters;
  const excludeFilters = options.excludeFilters;
  const hasFileFilters =
    (includeFilters?.length ?? 0) > 0 || (excludeFilters?.length ?? 0) > 0;
  const retrievalLimit = hasFileFilters
    ? Math.min(maxResults * 5, maxResults + 200)
    : maxResults * 2;

  // Honor an explicit maxResults:0 as "zero results" (previously `|| 10`
  // coerced 0 → 10). Short-circuit here, BEFORE the cache probe and vector/
  // keyword fan-out, so 0 doesn't do unnecessary work or hit a degenerate
  // `maxResults * 2 === 0` vector call. Returns the same empty shape the
  // function uses on a no-hit search / caught-error path.
  if (maxResults <= 0) {
    logger.debug("maxResults <= 0 — returning empty result set", {
      query,
      projectId,
      maxResults,
    });
    return [];
  }

  // Embedding providers such as Ollama reject an empty input. Treat a blank
  // query as the valid no-hit search the public API has historically
  // advertised, and avoid fan-out to vector/keyword dependencies entirely.
  if (!query.trim()) {
    logger.debug("Blank query — returning empty result set", {
      projectId,
    });
    return [];
  }

  const startTime = performance.now(); // Use performance.now() for sub-millisecond precision

  logger.debug("Starting contextual search", {
    query,
    projectId,
    maxResults,
    explainScores,
    includeFilters,
    excludeFilters,
    startTime, // Add startTime to logging
  });

  // Check cache first
  const cacheOptions = {
    maxResults,
    minScore,
    explainScores,
    includeFilters,
    excludeFilters,
    retrievalWindow: "bounded-v1",
  };
  const cachedResults = await rlm.searchCache.get(
    query,
    projectId,
    cacheOptions,
  );

  if (cachedResults) {
    const endTime = performance.now();
    const duration = Math.max(1, Math.round(endTime - startTime)); // Minimum 1ms to avoid 0ms for sub-ms operations

    // DEBUG: Log all timing values to diagnose the issue
    logger.debug("Cache hit timing details", {
      startTime,
      endTime,
      duration,
      calculatedDuration: endTime - startTime,
      preciseMs: (endTime - startTime).toFixed(3),
    });

    // Track cache hit
    rlm.analytics.trackSearch({
      timestamp: Date.now(),
      projectId,
      query,
      resultCount: cachedResults.length,
      duration,
      cacheHit: true,
      score: rlm.calculateAvgScore(cachedResults),
    });

    logger.info("Cache hit - returning cached results", {
      projectId,
      resultCount: cachedResults.length,
      duration,
      durationMs: `${duration}ms`,
      preciseMs: `${(endTime - startTime).toFixed(3)}ms`,
    });
    return rlm.applySynapseState(
      cachedResults,
      query,
      projectId,
      options.sessionId,
    );
  }

  try {
    const disableKeyword = process.env.SEARCH_DISABLE_KEYWORD === "true";

    // ── Phase 2: query understanding (default-off, silent degrade) ──
    // On any LLM throw/timeout/disabled, `understand()` returns null and we
    // fall through silently to the original 2-stream path. This branch is
    // also guarded by an outer try/catch so a defensive throw never escapes.
    let resultSets: SearchResult[][] = [];
    let usedQueryUnderstanding = false;
    try {
      const qu = config.get("search").queryUnderstanding;
      if (qu?.enabled && query.trim()) {
        const understood = await rlm.queryUnderstanding.understand(
          query,
          projectId,
        );
        if (understood) {
          eventBus.publish("search:query-rewritten", {
            query,
            projectId,
            expansions: understood.expansions,
            keywords: understood.keywords,
            hydeUsed: understood.hydeVector !== null,
          });
          const rewrittenFTS = buildRewrittenFTSQuery(
            query,
            understood.keywords,
          );
          const [v, k, h] = await Promise.all([
            rlm.vectorStore.search(query, retrievalLimit, projectId),
            disableKeyword
              ? Promise.resolve([] as SearchResult[])
              : rlm.keywordSearch
                  .searchWithFilter(rewrittenFTS, { projectId }, retrievalLimit)
                  .catch((err) => {
                    logger.warn(
                      "Keyword search (rewritten) failed — falling back to vector-only",
                      { err: (err as Error).message },
                    );
                    return [] as SearchResult[];
                  }),
            understood.hydeVector
              ? rlm.vectorStore.searchByEmbedding(
                  understood.hydeVector,
                  retrievalLimit,
                  projectId,
                )
              : Promise.resolve([]),
          ]);
          resultSets = understood.hydeVector ? [v, k, h] : [v, k];
          usedQueryUnderstanding = true;

          logger.debug("Query understanding fan-out", {
            vectorCount: v.length,
            keywordCount: k.length,
            hydeCount: h.length,
            hydeUsed: understood.hydeVector !== null,
          });
        }
      }
    } catch (e) {
      logger.warn("query understanding failed — falling back to original path", {
        err: (e as Error).message,
      });
      resultSets = [];
      usedQueryUnderstanding = false;
    }

    if (!usedQueryUnderstanding) {
      // ORIGINAL Phase-1 path, now with two additional lexical RRF streams:
      // trigram (identifier-substring recall) and fuzzy-corrected keyword
      // (Levenshtein correction over the per-store vocabulary). All four
      // streams fuse via RRF; empty streams contribute nothing.
      const fetchN = retrievalLimit;
      const [vectorResults, keywordResults, trigramResults] =
        await Promise.all([
          rlm.vectorStore.search(query, fetchN, projectId),
          disableKeyword
            ? Promise.resolve([] as SearchResult[])
            : rlm.keywordSearch
                .searchWithFilter(query, { projectId }, fetchN)
                .catch((err) => {
                  logger.warn(
                    "Keyword search failed — falling back to vector-only",
                    { err: (err as Error).message },
                  );
                  return [] as SearchResult[];
                }),
          // Trigram stream (best-effort; [] when tokenizer unavailable).
          disableKeyword || !rlm.keywordSearch.searchTrigram
            ? Promise.resolve([] as SearchResult[])
            : rlm.keywordSearch
                .searchTrigram!(query, { projectId }, fetchN)
                .catch((err) => {
                  logger.debug("Trigram search failed (non-fatal)", {
                    err: (err as Error).message,
                  });
                  return [] as SearchResult[];
                }),
        ]);

      logger.debug("Search results retrieved", {
        vectorCount: vectorResults.length,
        keywordCount: keywordResults.length,
        trigramCount: trigramResults.length,
      });
      resultSets = [vectorResults, keywordResults, trigramResults].filter(
        (s) => s.length > 0,
      );

      // Fuzzy correction stream: if any query word corrects to a different
      // vocabulary word, re-run keyword + trigram on the corrected query and
      // add both as RRF streams. This recovers typos like "useEffct" →
      // "useEffect" that porter/trigram miss. Best-effort; skipped when no
      // correction applies or fuzzyCorrect is unavailable.
      if (!disableKeyword && typeof rlm.keywordSearch.fuzzyCorrect === "function") {
        const corrected = await rlm.correctQuery(query);
        if (corrected && corrected !== query.toLowerCase().trim()) {
          try {
            const [fuzzyKeyword, fuzzyTrigram] = await Promise.all([
              rlm.keywordSearch
                .searchWithFilter(corrected, { projectId }, fetchN)
                .catch(() => [] as SearchResult[]),
              rlm.keywordSearch.searchTrigram
                ? rlm.keywordSearch
                    .searchTrigram!(corrected, { projectId }, fetchN)
                    .catch(() => [] as SearchResult[])
                : Promise.resolve([] as SearchResult[]),
            ]);
            if (fuzzyKeyword.length > 0) resultSets.push(fuzzyKeyword);
            if (fuzzyTrigram.length > 0) resultSets.push(fuzzyTrigram);
            logger.debug("Fuzzy correction stream added", {
              corrected,
              fuzzyKeywordCount: fuzzyKeyword.length,
              fuzzyTrigramCount: fuzzyTrigram.length,
            });
          } catch (err) {
            logger.debug("Fuzzy correction stream failed (non-fatal)", {
              err: (err as Error).message,
            });
          }
        }
      }
    }

    // Phase 7c: graph-neighbor as an extra RRF stream. BFS depth-2 over
    // outgoing memory-graph edges from the top-N vector-hit ids; resolved to
    // SearchResults via the memory repo at a fixed sub-hit score (0.45) so
    // RRF surfaces them mid-list. Silent-omit when empty/unavailable (the
    // resultSets length — and thus the search:reranked streamCount — reflects
    // the actual stream count). No graph-stream throw escapes this optional path.
    const graphStream = await rlm.buildGraphStream(resultSets, maxResults, projectId);
    if (graphStream.length > 0) {
      resultSets = [...resultSets, graphStream];
    }

    // Combine results using RRF (with score explanation if requested)
    const fusedResults = rlm.fuseResults(resultSets, query, explainScores);

    // A2: proximity + title re-ranking pass (post-RRF, pre-filter). Stable
    // re-rank on top of RRF: boosts results whose title contains query terms
    // and whose body positions the terms close together; code chunks get a
    // stronger title boost. Applied to a bounded candidate pool so the cost
    // stays low; equally-boosted results keep their RRF order.
    const rerankPool = Math.max(maxResults * 3, 20);
    const rerankInput = fusedResults.slice(0, rerankPool);
    const rerankedTop = applyProximityRerank(rerankInput, query);
    const fusedReranked = [
      ...rerankedTop,
      ...fusedResults.slice(rerankPool),
    ];

    if (usedQueryUnderstanding) {
      eventBus.publish("search:reranked", {
        query,
        projectId,
        streamCount: resultSets.length,
        resultCount: fusedResults.length,
      });
    }

    // Apply file pattern filters if provided
    // Note: For maximum efficiency, filters could be applied DURING vector/keyword search
    // by pre-computing valid files. For now, we apply post-search but cache the filter computation.
    let filteredByPattern = fusedReranked;
    if (includeFilters || excludeFilters) {
      const filterStartTime = performance.now();
      filteredByPattern = rlm.filterByPatterns(
        fusedReranked,
        includeFilters,
        excludeFilters,
      );
      const filterDuration = performance.now() - filterStartTime;

      logger.debug("Applied file pattern filters", {
        beforeFilter: fusedReranked.length,
        afterFilter: filteredByPattern.length,
        includePatterns: includeFilters,
        excludePatterns: excludeFilters,
        filterDurationMs: filterDuration.toFixed(2),
      });
    }

    // Filter by minimum score and limit results.
    //
    // minScore is applied to the RAW vector similarity (cosine distance from
    // the embedding model), not the normalized RRF score.  RRF normalization
    // divides by the max score, so the top result always gets ~1.0 regardless
    // of actual semantic relevance — making a score-based filter useless for
    // noise rejection.  The raw vectorScore is an absolute measure (0–1) that
    // is meaningful across queries.
    //
    // Keyword-only results (no vectorScore) fall back to the normalized score
    // so they are still subject to some threshold.
    const aboveThreshold = filteredByPattern
      .filter((result) => {
        const meta = result.metadata as Record<string, unknown>;
        const rawVs = meta?._rrfRawVectorScore as number | undefined;
        return rawVs !== undefined ? rawVs >= minScore : result.score >= minScore;
      })
      .map((result) => {
        const { _rrfRawVectorScore, ...cleanMeta } = result.metadata as Record<string, unknown>;
        return { ...result, metadata: cleanMeta };
      });

    const maxChunksPerFile = Number(process.env.RRF_MAX_CHUNKS_PER_FILE ?? "2");
    const fileChunkCount = new Map<string, number>();
    const filtered = maxChunksPerFile > 0
      ? aboveThreshold.filter((r) => {
          const fp = (r.metadata as Record<string, unknown>)?.filePath as string ?? r.id;
          const count = fileChunkCount.get(fp) ?? 0;
          if (count >= maxChunksPerFile) return false;
          fileChunkCount.set(fp, count + 1);
          return true;
        }).slice(0, maxResults)
      : aboveThreshold.slice(0, maxResults);

    // Add context to results
    const withContext = await rlm.addContextToResults(filtered, projectId);

    // Cache the results
    await rlm.searchCache.set(query, projectId, withContext, cacheOptions);

    const duration = Math.round(performance.now() - startTime); // Use performance.now() for consistency

    // Track cache miss
    rlm.analytics.trackSearch({
      timestamp: Date.now(),
      projectId,
      query,
      resultCount: withContext.length,
      duration,
      cacheHit: false,
      score: rlm.calculateAvgScore(withContext),
    });

    logger.info("Contextual search completed", {
      projectId,
      totalResults: withContext.length,
      avgScore: rlm.calculateAvgScore(withContext),
      duration,
    });

    return rlm.applySynapseState(
      withContext,
      query,
      projectId,
      options.sessionId,
    );
  } catch (error) {
    logger.error("Contextual search failed", error as Error, {
      query,
      projectId,
    });
    throw error;
  }
}

// fuseResultsImpl + generateScoreExplanationImpl live in ./rlm-fusion.js
// (split safety valve — kept rlm-search.ts under the ~600 LOC budget).
// Re-exported here so callers that import from rlm-search keep resolving.
export {
  fuseResultsImpl,
  generateScoreExplanationImpl,
} from "./rlm-fusion.js";

// ── addContextToResults ──────────────────────────────────────────────────────

export async function addContextToResultsImpl(
  rlm: ContextualSearchRLM,
  results: SearchResult[],
  _projectId: string,
): Promise<SearchResult[]> {
  return results.map((result) => {
    const metadata = result.metadata;
    const filePath = metadata?.filePath as string;
    const lineStart = metadata?.lineStart as number;
    const lineEnd = metadata?.lineEnd as number;

    if (filePath && lineStart && lineEnd) {
      return {
        ...result,
        highlights: [`${filePath}:${lineStart}-${lineEnd}`],
        metadata: {
          ...metadata,
          context: {
            filePath,
            lineStart,
            lineEnd,
            preview: rlm.extractPreview(result.content),
          },
        },
      };
    }

    return result;
  });
}

// ── extractPreview ───────────────────────────────────────────────────────────

export function extractPreviewImpl(content: string, maxLines: number = 5): string {
  const lines = content.split("\n");
  const preview = lines.slice(0, maxLines).join("\n");
  return lines.length > maxLines ? preview + "\n..." : preview;
}

// ── calculateAvgScore ────────────────────────────────────────────────────────

export function calculateAvgScoreImpl(results: SearchResult[]): number {
  if (results.length === 0) return 0;
  const sum = results.reduce((acc, r) => acc + r.score, 0);
  return sum / results.length;
}

// ── filterByPatterns ─────────────────────────────────────────────────────────

export function filterByPatternsImpl(
  results: SearchResult[],
  include?: string[],
  exclude?: string[],
): SearchResult[] {
  if (!include && !exclude) {
    return results;
  }

  return results.filter((result) => {
    const filePath = result.metadata?.filePath as string;
    if (!filePath) return !include?.length;

    // Check exclude patterns first (blacklist)
    if (exclude && exclude.length > 0) {
      const isExcluded = exclude.some((pattern) => minimatch(filePath, pattern));
      if (isExcluded) return false;
    }

    // Check include patterns (whitelist)
    if (include && include.length > 0) {
      const isIncluded = include.some((pattern) => minimatch(filePath, pattern));
      return isIncluded;
    }

    // No include patterns specified, include by default (unless excluded above)
    return true;
  });
}
