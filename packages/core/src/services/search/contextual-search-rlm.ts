/**
 * ContextualSearchRLM - Optimized Contextual Search Service
 *
 * Implementation inspired by parallel search patterns,
 * adapted for the RLM ecosystem with:
 *
 * Features:
 * - Automatic project indexing with per-projectId namespace
 * - Hybrid search (vector + keyword) with RRF (Reciprocal Rank Fusion)
 * - Parallel search across multiple files
 * - Returns only relevant excerpts with context
 * - Multi-level intelligent cache
 * - Integration with existing embedding service
 *
 * Architecture:
 * - Uses PostgreSQL as single backend (vector + keyword + cache)
 * - Per-projectId namespace for isolation
 * - Embedding reuse across projects
 */

import {
  SearchResult,
  VectorDocument,
} from "@massa-th0th/shared";
import { logger } from "@massa-th0th/shared";
import { config } from "@massa-th0th/shared";
import { IndexManager } from "./index-manager.js";
import { SearchAnalytics } from "./search-analytics.js";
import type { SearchAnalyticsPg } from "./search-analytics-pg.js";
import { getGraphStore } from "../graph/graph-store-factory.js";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import { minimatch } from "minimatch";
import { FileFilterCache } from "./file-filter-cache.js";
import { smartChunk } from "./smart-chunker.js";
import {
  QueryUnderstandingService,
  buildRewrittenFTSQuery,
} from "./query-understanding.js";
import { applyProximityRerank, extractQueryTerms } from "./lexical-search.js";
import { eventBus } from "../events/event-bus.js";
import { getSynapseManager } from "../synapse/index.js";
import { getSessionRegistry } from "../synapse/session/index.js";
import type { SynapseManager } from "../synapse/synapse-manager.js";
import type { SessionRegistry } from "../synapse/session/session-registry.js";
import type { AgentSession } from "../synapse/types.js";
import { assertParserReadyForIndexing } from "../structural/parser-readiness.js";
import type { getKeywordSearch } from "../../data/keyword/keyword-search-factory.js";
import type { getVectorStore } from "../../data/vector/vector-store-factory.js";
import type { getSearchCache } from "./cache-factory.js";
import type { getSearchAnalytics } from "./analytics-factory.js";
import type { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import {
  runWithIndexLock,
  _indexProjectInternalImpl,
  ensureFreshIndexImpl,
  indexFileImpl,
  loadGitignoreImpl,
  checkSearchAdmissionImpl,
  ensureInitializedImpl,
  type IndexProjectOptions,
} from "./rlm-indexing.js";

const globAsync = glob;

/**
 * ContextualSearchRLM - Main contextual search service
 */
export class ContextualSearchRLM {
  // NOTE (M14 Phase 3): fields below were `private`. Relaxed to `public`
  // (modifier dropped) so the extracted delegate modules in rlm-indexing.ts /
  // rlm-synapse.ts / rlm-search.ts / rlm-admin.ts can read them via the passed
  // `rlm` parameter. Runtime-identical; type-surface only. See design.md
  // "Encapsulation decision (accepted cost)".
  keywordSearch!: Awaited<ReturnType<typeof getKeywordSearch>>;
  vectorStore!: Awaited<ReturnType<typeof getVectorStore>>;
  indexManager!: IndexManager;
  searchCache!: Awaited<ReturnType<typeof getSearchCache>>;
  analytics!: Awaited<ReturnType<typeof getSearchAnalytics>>;
  symbolRepo!: Awaited<ReturnType<typeof getSymbolRepository>>;
  private fileFilterCache: FileFilterCache;
  /** Phase 2: query understanding (LLM rewrite + HyDE). Default-off, silent-degrade. */
  private queryUnderstanding: QueryUnderstandingService;
  private readonly RRF_K = 60; // Constant for Reciprocal Rank Fusion
  initialized = false;

  // Per-project mutex to prevent concurrent indexing
  private static indexingLocks = new Map<string, Promise<void>>();

  /**
   * Optional test/extension seam: pre-resolved dependencies. When provided,
   * `ensureInitialized` skips the factory calls (which are process-wide
   * mock.module targets in the full test suite) and uses these instances
   * directly. Production callers pass nothing and resolve via factories.
   */
  readonly injectedDeps?: {
    keywordSearch?: Awaited<ReturnType<typeof getKeywordSearch>>;
    vectorStore?: Awaited<ReturnType<typeof getVectorStore>>;
    searchCache?: Awaited<ReturnType<typeof getSearchCache>>;
    analytics?: Awaited<ReturnType<typeof getSearchAnalytics>>;
    symbolRepo?: Awaited<ReturnType<typeof getSymbolRepository>>;
    sessionRegistry?: Pick<SessionRegistry, "getAsync">;
    synapseManager?: Pick<SynapseManager, "process">;
  };

  constructor(deps?: {
    keywordSearch?: Awaited<ReturnType<typeof getKeywordSearch>>;
    vectorStore?: Awaited<ReturnType<typeof getVectorStore>>;
    searchCache?: Awaited<ReturnType<typeof getSearchCache>>;
    analytics?: Awaited<ReturnType<typeof getSearchAnalytics>>;
    symbolRepo?: Awaited<ReturnType<typeof getSymbolRepository>>;
    sessionRegistry?: Pick<SessionRegistry, "getAsync">;
    synapseManager?: Pick<SynapseManager, "process">;
  }) {
    this.fileFilterCache = new FileFilterCache();
    this.queryUnderstanding = new QueryUnderstandingService();
    this.injectedDeps = deps;
  }

  // Delegate-preservation contract: stays an instance method (thin delegate
  // to the module function) because concurrent-indexing.test.ts:67 and the
  // characterization test monkey-patch `(inst as any).ensureInitialized` on
  // the instance; routing through a module-local function would bypass that.
  // Visibility relaxed from `private` to public-equivalent so rlm-indexing.ts
  // can dispatch through `rlm.ensureInitialized()` (runtime-identical).
  async ensureInitialized(): Promise<void> {
    return ensureInitializedImpl(this);
  }

  /**
   * Load and parse .gitignore file (delegates to shared ignore-patterns module)
   */
  private loadGitignore(projectPath: string) {
    return loadGitignoreImpl(projectPath);
  }

  /**
   * Index an entire project
   *
   * @param projectPath - Path to the project
   * @param projectId - Unique project ID (namespace)
   * @returns Indexing statistics
   */
  async indexProject(
    projectPath: string,
    projectId: string,
    options: IndexProjectOptions = {},
  ): Promise<{
    filesIndexed: number;
    chunksIndexed: number;
    errors: number;
  }> {
    // This legacy direct indexing path must fail before mutating its queue.
    await assertParserReadyForIndexing();
    // `work` lambda captures virtual dispatch through `this` so the test's
    // `(inst as any)._indexProjectInternal` patch still routes (Challenge #1).
    return runWithIndexLock(
      ContextualSearchRLM.indexingLocks,
      projectId,
      () => this._indexProjectInternal(projectPath, projectId, options),
    );
  }

  // Delegate-preservation contract: stays an instance method (thin delegate
  // to the module function) because concurrent-indexing.test.ts:181-289 and
  // the characterization test monkey-patch `(inst as any)._indexProjectInternal`
  // on the instance; routing through a module-local function would bypass it.
  private async _indexProjectInternal(
    projectPath: string,
    projectId: string,
    options: IndexProjectOptions = {},
  ): Promise<{
    filesIndexed: number;
    chunksIndexed: number;
    errors: number;
  }> {
    return _indexProjectInternalImpl(this, projectPath, projectId, options);
  }

  /**
   * Check if index is stale and optionally trigger reindexing
   */
  async ensureFreshIndex(
    projectId: string,
    projectPath: string,
    options: {
      allowFullReindex?: boolean;
      maxSyncFiles?: number;
    } = {},
  ): Promise<{
    wasStale: boolean;
    reindexed: boolean;
    reason?: string;
    deferred?: boolean;
    filesPending?: number;
  }> {
    return ensureFreshIndexImpl(this, projectId, projectPath, options);
  }

  /**
   * Search admission preflight — two-tier gate run before `search()`.
   *
   * Tier 1 (HARD-FAIL): pure metadata-existence check, no projectPath needed.
   *   Returns `{admitted:false, error}` when the project has no index metadata
   *   at all. Caller MUST surface the error and NOT call `search()`.
   *
   * Tier 2 (WARN): only evaluated when `projectPath` is supplied (the staleness
   *   check needs it). If metadata exists but `isIndexStale` reports any reason
   *   (files_changed / path_mismatch / age_threshold), admission still succeeds
   *   but a `stale` descriptor is attached for the caller to relay as a warning.
   *   When `projectPath` is absent the stale check is skipped gracefully.
   */
  async checkSearchAdmission(
    projectId: string,
    projectPath?: string,
  ): Promise<{
    admitted: boolean;
    error?: string;
    stale?: {
      reason: string;
      modifiedFiles?: number;
      newFiles?: number;
      deletedFiles?: number;
    };
  }> {
    return checkSearchAdmissionImpl(this, projectId, projectPath);
  }

  /**
   * Index a single file, splitting it into semantic chunks
   *
   * Uses the smart chunker which is language-aware:
   * - Markdown: splits by headings with hierarchy context
   * - JSON: splits by top-level keys
   * - YAML: splits by document separators or top-level keys
   * - Code: splits by functions/classes with preceding comments
   */
  // Visibility relaxed from `private` so rlm-indexing.ts can dispatch through
  // `rlm.indexFile()` (runtime-identical; type-additive only).
  async indexFile(
    filePath: string,
    projectId: string,
    projectRoot: string,
    centralityMap?: Map<string, number>,
  ): Promise<{ chunks: number }> {
    return indexFileImpl(this, filePath, projectId, projectRoot, centralityMap);
  }

  /**
   * Hybrid search (vector + keyword) with projectId filter
   */
  async search(
    query: string,
    projectId: string,
    options: {
      maxResults?: number;
      minScore?: number;
      explainScores?: boolean;
      includeFilters?: string[];
      excludeFilters?: string[];
      /** Phase 2: Synapse session id forwarded for future Synapse-biased fusion. */
      sessionId?: string;
    } = {},
  ): Promise<SearchResult[]> {
    await this.ensureInitialized();
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
    const cachedResults = await this.searchCache.get(
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
      this.analytics.trackSearch({
        timestamp: Date.now(),
        projectId,
        query,
        resultCount: cachedResults.length,
        duration,
        cacheHit: true,
        score: this.calculateAvgScore(cachedResults),
      });

      logger.info("Cache hit - returning cached results", {
        projectId,
        resultCount: cachedResults.length,
        duration,
        durationMs: `${duration}ms`,
        preciseMs: `${(endTime - startTime).toFixed(3)}ms`,
      });
      return this.applySynapseState(
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
          const understood = await this.queryUnderstanding.understand(
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
              this.vectorStore.search(query, retrievalLimit, projectId),
              disableKeyword
                ? Promise.resolve([] as SearchResult[])
                : this.keywordSearch
                    .searchWithFilter(rewrittenFTS, { projectId }, retrievalLimit)
                    .catch((err) => {
                      logger.warn(
                        "Keyword search (rewritten) failed — falling back to vector-only",
                        { err: (err as Error).message },
                      );
                      return [] as SearchResult[];
                    }),
              understood.hydeVector
                ? this.vectorStore.searchByEmbedding(
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
            this.vectorStore.search(query, fetchN, projectId),
            disableKeyword
              ? Promise.resolve([] as SearchResult[])
              : this.keywordSearch
                  .searchWithFilter(query, { projectId }, fetchN)
                  .catch((err) => {
                    logger.warn(
                      "Keyword search failed — falling back to vector-only",
                      { err: (err as Error).message },
                    );
                    return [] as SearchResult[];
                  }),
            // Trigram stream (best-effort; [] when tokenizer unavailable).
            disableKeyword || !this.keywordSearch.searchTrigram
              ? Promise.resolve([] as SearchResult[])
              : this.keywordSearch
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
        if (!disableKeyword && typeof this.keywordSearch.fuzzyCorrect === "function") {
          const corrected = await this.correctQuery(query);
          if (corrected && corrected !== query.toLowerCase().trim()) {
            try {
              const [fuzzyKeyword, fuzzyTrigram] = await Promise.all([
                this.keywordSearch
                  .searchWithFilter(corrected, { projectId }, fetchN)
                  .catch(() => [] as SearchResult[]),
                this.keywordSearch.searchTrigram
                  ? this.keywordSearch
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
      const graphStream = await this.buildGraphStream(resultSets, maxResults, projectId);
      if (graphStream.length > 0) {
        resultSets = [...resultSets, graphStream];
      }

      // Combine results using RRF (with score explanation if requested)
      const fusedResults = this.fuseResults(resultSets, query, explainScores);

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
        filteredByPattern = this.filterByPatterns(
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
      const withContext = await this.addContextToResults(filtered, projectId);

      // Cache the results
      await this.searchCache.set(query, projectId, withContext, cacheOptions);

      const duration = Math.round(performance.now() - startTime); // Use performance.now() for consistency

      // Track cache miss
      this.analytics.trackSearch({
        timestamp: Date.now(),
        projectId,
        query,
        resultCount: withContext.length,
        duration,
        cacheHit: false,
        score: this.calculateAvgScore(withContext),
      });

      logger.info("Contextual search completed", {
        projectId,
        totalResults: withContext.length,
        avgScore: this.calculateAvgScore(withContext),
        duration,
      });

      return this.applySynapseState(
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

  /**
   * Apply session state after the session-independent base result is cached.
   * Invalid and workspace-mismatched sessions return the exact base array.
   */
  private async applySynapseState(
    baseResults: SearchResult[],
    query: string,
    projectId: string,
    sessionId?: string,
  ): Promise<SearchResult[]> {
    if (!sessionId) return baseResults;

    const registry = this.injectedDeps?.sessionRegistry ?? getSessionRegistry();
    let session: AgentSession | null;
    try {
      session = await registry.getAsync(sessionId);
    } catch (error) {
      logger.warn("Synapse session lookup failed — using stateless search", {
        sessionId,
        projectId,
        error: (error as Error).message,
      });
      return baseResults;
    }

    if (!session || (session.workspaceId && session.workspaceId !== projectId)) {
      return baseResults;
    }

    const synapseManager = this.injectedDeps?.synapseManager ?? getSynapseManager();
    const allowBufferInjection = session.workspaceId === projectId;
    const processed = synapseManager.process(baseResults, query, {
      session,
      projectId,
      allowBufferInjection,
    });
    const baseIds = new Set(baseResults.map((result) => result.id));

    return processed.results.filter((result) => {
      if (baseIds.has(result.id)) return true;
      const metadata = result.metadata as Record<string, unknown> | undefined;
      return allowBufferInjection && metadata?.projectId === projectId;
    });
  }

  /**
   * Fuzzy-correct each non-stopword query term via the keyword store's
   * vocabulary. Returns the corrected query string (lowercased, space-joined),
   * or null when no term corrects to a different word or fuzzyCorrect is
   * unavailable. Only words of length >= 3 are considered (shorter tokens
   * can't be reliably corrected).
   */
  private async correctQuery(query: string): Promise<string | null> {
    if (typeof this.keywordSearch.fuzzyCorrect !== "function") return null;
    const terms = extractQueryTerms(query).filter((w) => w.length >= 3);
    // Vocabulary-nearest correction is reliable for identifier typo probes
    // ("useEffct") but unsafe for natural-language sentences: ordinary
    // Portuguese words were rewritten to unrelated English code tokens and
    // added as an entire extra RRF stream.
    if (terms.length !== 1) return null;
    const corrected: string[] = [];
    let changed = false;
    for (const term of terms) {
      const fix = await this.keywordSearch.fuzzyCorrect!(term);
      if (fix && fix !== term) {
        corrected.push(fix);
        changed = true;
      } else {
        corrected.push(term);
      }
    }
    return changed ? corrected.join(" ") : null;
  }

  /**
   * Phase 7c: build the graph-neighbor RRF stream. BFS depth-2 over outgoing
   * memory-graph edges; resolved to SearchResults via the memory repository at
   * a fixed sub-hit score (0.45).
   *
   * Id-bridge fix (A3): graph edges connect MEMORY ids, but vector/code-search
   * results key on chunk ids (e.g. "projectId:path:0"). Seeding BFS with chunk
   * ids therefore silently omitted the stream for code queries — the primary
   * use case. We now bridge the two id spaces: collect graph seeds by (a)
   * trying the raw hit ids (preserves the original behavior for memory search
   * where memory ids already flow in), AND (b) mapping each code chunk to
   * memory ids that reference the same filePath/symbol via fullTextSearch.
   * This makes the graph stream participate for code queries while remaining
   * a silent-omit no-op when no bridged seeds resolve.
   *
   * Degradation (silent-omit): returns [] when the neighbor set is empty, the
   * graph store throws, or the memory repo returns nothing. The caller only
   * appends the stream when non-empty, so `resultSets.length` (and thus the
   * `search:reranked` streamCount) always reflects the real stream count.
   */
  private async buildGraphStream(
    resultSets: SearchResult[][],
    maxResults: number,
    projectId?: string,
  ): Promise<SearchResult[]> {
    try {
      // Seed candidates = top-N ids + derived filePath/symbol anchors from the
      // first (vector) stream's chunk metadata.
      const vectorStream = resultSets[0] ?? [];
      const topHits = vectorStream.slice(0, Math.min(maxResults, 20));
      const rawIds = topHits
        .map((r) => r.id)
        .filter((id): id is string => typeof id === "string" && id.length > 0);

      // Derive anchor terms (filePath / symbol) from code-chunk metadata.
      // These are used to find MEMORY ids whose content references the same
      // code, bridging the chunk-id → memory-id gap.
      const anchors = new Set<string>();
      for (const r of topHits) {
        const meta = (r.metadata ?? {}) as Record<string, unknown>;
        const fp = meta.filePath;
        if (typeof fp === "string" && fp.length > 0) {
          // Use the basename + the full path; basename is the most common
          // reference form in memories ("updated store.ts ...").
          anchors.add(fp);
          const base = fp.split("/").pop();
          if (base && base.length >= 3) anchors.add(base);
        }
        for (const key of ["parentSymbol", "symbolName", "label"] as const) {
          const v = meta[key];
          if (typeof v === "string" && v.length >= 3) anchors.add(v);
        }
      }

      const seedIds = new Set<string>(rawIds);
      // Bridge: resolve anchors to memory ids via fullTextSearch. Bounded to
      // the top few anchors to keep latency in check.
      if (anchors.size > 0) {
        const repo = getMemoryRepository();
        const anchorTerms = [...anchors].slice(0, 6);
        for (const term of anchorTerms) {
          try {
            // fullTextSearch(query, filters) — pass a SearchFilters object as
            // the second arg so both the number and object overloads resolve.
            const rows = await Promise.resolve(
              repo.fullTextSearch(term, 5, {
                projectId,
                minImportance: 0,
              }),
            );
            for (const row of rows) {
              if (typeof row.id === "string") seedIds.add(row.id);
            }
          } catch {
            // Defensive: a single anchor lookup never aborts bridging.
          }
        }
      }

      if (seedIds.size === 0) return [];
      const graph = getGraphStore();
      // PostgreSQL bfsNeighbors is sync; Pg is async. Normalize via Promise.resolve
      // so both backends work without an isPostgres short-circuit.
      const ns = await Promise.resolve(
        typeof (graph as { bfsNeighbors?: unknown }).bfsNeighbors === "function"
          ? (graph as { bfsNeighbors: (ids: string[], d: number) => string[] | Promise<string[]> }).bfsNeighbors([...seedIds], 2)
          : [],
      );
      if (!Array.isArray(ns) || ns.length === 0) return [];
      // Filter out ids already in the result set (avoid double-counting RRF).
      const present = new Set<string>();
      for (const set of resultSets)
        for (const r of set) present.add(r.id);
      const fresh = ns.filter((id) => !present.has(id));
      if (fresh.length === 0) return [];

      const repo = getMemoryRepository();
      const out: SearchResult[] = [];
      for (const id of fresh) {
        try {
          // Backend-polymorphic: PostgreSQL getById is sync, Pg is async. Normalize.
          const row = await Promise.resolve(repo.getById(id));
          if (!row || row.deleted_at !== null) continue;
          out.push({
            id: row.id,
            content: row.content,
            // Fixed sub-hit score: below a typical direct vector hit, above
            // the minScore 0.3 floor, so RRF surfaces neighbors mid-list.
            score: 0.45,
            source: "memory" as SearchResult["source"],
            metadata: {
              projectId: row.project_id ?? undefined,
              context: {
                memoryType: row.type,
                graphNeighbor: true,
                importance: row.importance,
              },
            },
          });
        } catch {
          // Defensive: a single missing memory never aborts the stream.
        }
      }
      return out;
    } catch (e) {
      logger.debug("graph stream omitted", {
        err: (e as Error).message,
      });
      return [];
    }
  }

  /**
   * Reciprocal Rank Fusion (RRF) - Combines multiple result lists
   *
   * Now includes intelligent boosting:
   * - Keywords get higher weight when query contains function/class names
   * - Exact matches in keyword results get additional boost
   */
  private fuseResults(
    resultSets: SearchResult[][],
    query: string,
    explainScores: boolean = false,
  ): SearchResult[] {
    const scoreMap = new Map<
      string,
      {
        result: SearchResult;
        rrfScore: number;
        vectorRank?: number;
        keywordRank?: number;
        vectorScore?: number;
        keywordScore?: number;
        vectorRrfScore: number;
        lexicalRrfScore: number;
        memoryRrfScore: number;
      }
    >();

    // Detect if query contains code-specific patterns (functions, classes, etc.)
    const hasCodePattern = (text: string): boolean => {
      const codePatterns = [
        /\w+\(\)/, // function calls: cn(), useState()
        /\bfunction\b/i, // "function" keyword
        /\bclass\b/i, // "class" keyword
        /\binterface\b/i, // "interface" keyword
        /\benum\b/i, // "enum" keyword
        /\btype\b/i, // "type" keyword
        /\bconst\b/i, // "const" keyword
        /\bimport\b/i, // "import" keyword
        /\bexport\b/i, // "export" keyword
      ];
      return codePatterns.some((pattern) => pattern.test(text));
    };

    // Check if this is a code-focused query
    const isCodeQuery = hasCodePattern(query);

    // Keyword weight multiplier (higher = more weight to keyword results)
    // For code queries: 2.5x boost to keyword matches
    // For general queries: 1.0x (equal weight)
    const codeKeywordBoostRaw = Number(process.env.RRF_KEYWORD_BOOST ?? "2.5");
    const codeKeywordBoost = Number.isFinite(codeKeywordBoostRaw) && codeKeywordBoostRaw > 0 ? codeKeywordBoostRaw : 2.5;
    const KEYWORD_BOOST = isCodeQuery ? codeKeywordBoost : 1.0;

    logger.debug("RRF fusion parameters", {
      query,
      isCodeQuery,
      keywordBoost: KEYWORD_BOOST,
      vectorResults: resultSets[0]?.length || 0,
      keywordResults: resultSets[1]?.length || 0,
    });

    // Calculate RRF score for each result.
    // Stream roles: index 0 is always the vector stream (see search()). All
    // other streams are lexical (porter keyword, trigram, fuzzy) or memory
    // (graph). Lexical streams get the code-query keyword boost; the memory
    // graph stream gets neutral weight (1.0) since it surfaces context, not a
    // direct lexical match.
    for (let i = 0; i < resultSets.length; i++) {
      const results = resultSets[i];
      const isVector = i === 0;
      const isMemoryStream = results.some(
        (r) =>
          (r.source as string) === "memory" ||
          ((r.metadata as Record<string, unknown>)?.context as Record<string, unknown>)
            ?.graphNeighbor === true,
      );
      const boost = isVector ? 1.0 : isMemoryStream ? 1.0 : KEYWORD_BOOST;

      results.forEach((result, rank) => {
        const rrfScore = (1 / (this.RRF_K + rank + 1)) * boost;

        if (scoreMap.has(result.id)) {
          const existing = scoreMap.get(result.id)!;

          if (isVector) {
            existing.vectorRrfScore += rrfScore;
            existing.vectorRank = rank;
            existing.vectorScore = result.score;
          } else if (isMemoryStream) {
            existing.memoryRrfScore += rrfScore;
          } else {
            // Porter, trigram, and fuzzy are correlated lexical views of the
            // same document. Count the best lexical rank once so duplicate
            // matches cannot overwhelm a strong vector-only result.
            existing.lexicalRrfScore = Math.max(
              existing.lexicalRrfScore,
              rrfScore,
            );
            // Record the best lexical rank/score (porter/trigram/fuzzy).
            if (
              existing.keywordRank === undefined ||
              rank < existing.keywordRank
            ) {
              existing.keywordRank = rank;
              existing.keywordScore = result.score;
            }
          }
          existing.rrfScore =
            existing.vectorRrfScore +
            existing.lexicalRrfScore +
            existing.memoryRrfScore;
        } else {
          const vectorRrfScore = isVector ? rrfScore : 0;
          const lexicalRrfScore = !isVector && !isMemoryStream ? rrfScore : 0;
          const memoryRrfScore = isMemoryStream ? rrfScore : 0;
          scoreMap.set(result.id, {
            result: { ...result },
            rrfScore: vectorRrfScore + lexicalRrfScore + memoryRrfScore,
            vectorRrfScore,
            lexicalRrfScore,
            memoryRrfScore,
            vectorRank: isVector ? rank : undefined,
            keywordRank: !isVector && !isMemoryStream ? rank : undefined,
            vectorScore: isVector ? result.score : undefined,
            keywordScore: !isVector && !isMemoryStream ? result.score : undefined,
          });
        }
      });
    }

    // Convert to array and sort by RRF score
    const sorted = Array.from(scoreMap.values())
      .sort((a, b) => b.rrfScore - a.rrfScore);

    // Dynamic normalization: use the top RRF score as divisor so results
    // span the full [0, 1] range instead of being capped by a fixed constant.
    const maxRrfScore = sorted[0]?.rrfScore || 1;
    const vectorWeightRaw = Number(process.env.RRF_VECTOR_WEIGHT ?? "0.3");
    const vectorWeight = Number.isFinite(vectorWeightRaw) ? Math.min(1, Math.max(0, vectorWeightRaw)) : 0.3;

    return sorted
      .map(
        (
          {
            result,
            rrfScore,
            vectorRank,
            keywordRank,
            vectorScore,
            keywordScore,
            vectorRrfScore,
            lexicalRrfScore,
            memoryRrfScore,
          },
          index,
        ) => {
          const rrfNormalized = rrfScore / maxRrfScore;

          // Combine RRF score with vector similarity for better relevance measurement
          // Weight: 70% RRF (ranking-based) + 30% vector similarity (semantic)
          const vectorSimilarity = vectorScore || 0;
          const combinedScore = rrfNormalized * (1 - vectorWeight) + vectorSimilarity * vectorWeight;

          // Centrality boost: symbols with higher PageRank get a mild re-ranking bonus.
          // finalScore = combined_score * (1 + 0.2 * centralityScore)
          // centralityScore is in [0, 1]; clamped to [0, 1] after boost.
          const centralityScore =
            typeof (result.metadata as Record<string, unknown>)?.centralityScore === "number"
              ? ((result.metadata as Record<string, unknown>).centralityScore as number)
              : 0;
          const normalizedScore = Math.min(1, combinedScore * (1 + 0.2 * centralityScore));
          const memoryOnly =
            memoryRrfScore > 0 && vectorRrfScore === 0 && lexicalRrfScore === 0;

          // Generate explanation if requested
          const explanation = explainScores
            ? this.generateScoreExplanation(
                normalizedScore,
                rrfScore,
                vectorScore,
                keywordScore,
                vectorRank,
                keywordRank,
                index,
              )
            : undefined;

          return {
            ...result,
            score: normalizedScore,
            explanation,
            // Internal field: raw cosine similarity from the vector store.
            // Used by search() to apply minScore as an absolute relevance gate
            // (normalized RRF score is always ~1.0 for the top result and
            // therefore cannot filter semantic noise). Stripped before caching.
            metadata: {
              ...(result.metadata as Record<string, unknown>),
              // Graph-only context has no direct query-relevance signal. Give
              // it an explicit zero for minScore gating so dynamic RRF
              // normalization cannot turn an unrelated neighbor into a 0.7
              // hit. A result also found by vector/lexical retrieval keeps its
              // direct relevance behavior.
              _rrfRawVectorScore: vectorScore ?? (memoryOnly ? 0 : undefined),
            } as typeof result.metadata,
          };
        },
      );
  }

  /**
   * Generate detailed score explanation
   */
  private generateScoreExplanation(
    finalScore: number,
    rrfScore: number,
    vectorScore?: number,
    keywordScore?: number,
    vectorRank?: number,
    keywordRank?: number,
    combinedRank?: number,
  ): any {
    const parts: string[] = [];

    if (vectorScore != null && vectorRank != null) {
      parts.push(
        `Vector: ${(vectorScore * 100).toFixed(1)}% (rank #${vectorRank + 1})`,
      );
    }

    if (keywordScore != null && keywordRank != null) {
      parts.push(
        `Keyword: ${(keywordScore * 100).toFixed(1)}% (rank #${keywordRank + 1})`,
      );
    }

    const breakdown =
      parts.join(" + ") +
      ` → RRF: ${rrfScore.toFixed(4)} → Final: ${(finalScore * 100).toFixed(1)}%`;

    return {
      finalScore,
      vectorScore: vectorScore ?? undefined,
      keywordScore: keywordScore ?? undefined,
      rrfScore,
      vectorRank: vectorRank != null ? vectorRank + 1 : undefined,
      keywordRank: keywordRank != null ? keywordRank + 1 : undefined,
      combinedRank: combinedRank != null ? combinedRank + 1 : undefined,
      breakdown,
    };
  }

  /**
   * Add expanded context to results
   */
  private async addContextToResults(
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
              preview: this.extractPreview(result.content),
            },
          },
        };
      }

      return result;
    });
  }

  /**
   * Extract content preview (first lines)
   */
  private extractPreview(content: string, maxLines: number = 5): string {
    const lines = content.split("\n");
    const preview = lines.slice(0, maxLines).join("\n");
    return lines.length > maxLines ? preview + "\n..." : preview;
  }

  /**
   * Calculate average score
   */
  private calculateAvgScore(results: SearchResult[]): number {
    if (results.length === 0) return 0;
    const sum = results.reduce((acc, r) => acc + r.score, 0);
    return sum / results.length;
  }

  /**
   * Filter results by glob patterns
   */
  private filterByPatterns(
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

  /**
   * Clear project index
   */
  async clearProjectIndex(projectId: string): Promise<{ deleted: number }> {
    await this.ensureInitialized();
    try {
      const [deleted, keywordDeleted] = await Promise.all([
        this.vectorStore.deleteByProject(projectId),
        this.keywordSearch.deleteByProject(projectId),
      ]);

      // Clear associated caches
      await this.searchCache.invalidateProject(projectId);
      this.fileFilterCache.invalidateProject(projectId);

      logger.info("Project index and caches cleared", {
        projectId,
        deleted,
        keywordDeleted,
      });
      return { deleted };
    } catch (error) {
      logger.error("Failed to clear project index", error as Error, {
        projectId,
      });
      return { deleted: 0 };
    }
  }

  /**
   * Get project statistics
   */
  async getProjectStats(projectId: string): Promise<{
    totalDocuments: number;
    totalSize: number;
  }> {
    await this.ensureInitialized();
    return this.vectorStore.getStats(projectId);
  }

  /**
   * Warmup cache with common queries
   *
   * Pre-caches typical search patterns to improve initial search performance
   */
  async warmupCache(
    projectId: string,
    _projectPath: string,
    customQueries?: string[],
  ): Promise<{ queriesWarmed: number; errors: number }> {
    await this.ensureInitialized();
    logger.info("Starting cache warmup", { projectId });

    // Common search patterns based on file types and structure
    const commonQueries = customQueries || [
      "authentication",
      "api endpoints",
      "database models",
      "components",
      "utils",
      "configuration",
      "routes",
      "services",
      "tests",
      "types",
      "interfaces",
      "error handling",
      "validation",
      "middleware",
      "hooks",
    ];

    let queriesWarmed = 0;
    let errors = 0;

    // Run searches in background to populate cache
    for (const query of commonQueries) {
      try {
        await this.search(query, projectId, {
          maxResults: 10,
          minScore: 0.3,
        });
        queriesWarmed++;

        logger.debug("Warmed cache for query", { query, projectId });
      } catch (error) {
        logger.error("Failed to warm cache for query", error as Error, {
          query,
          projectId,
        });
        errors++;
      }
    }

    logger.info("Cache warmup completed", {
      projectId,
      queriesWarmed,
      errors,
      totalQueries: commonQueries.length,
    });

    return { queriesWarmed, errors };
  }

  /**
   * Get analytics instance for querying metrics
   */
  getAnalytics(): SearchAnalytics | SearchAnalyticsPg {
    return this.analytics;
  }
}
