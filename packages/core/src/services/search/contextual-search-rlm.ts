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
} from "@massa-ai/shared";
import { logger } from "@massa-ai/shared";
import { config } from "@massa-ai/shared";
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
import {
  applySynapseStateImpl,
  correctQueryImpl,
  buildGraphStreamImpl,
} from "./rlm-synapse.js";
import {
  searchImpl,
  fuseResultsImpl,
  generateScoreExplanationImpl,
  addContextToResultsImpl,
  extractPreviewImpl,
  calculateAvgScoreImpl,
  filterByPatternsImpl,
} from "./rlm-search.js";
import type {
  SearchDegradation,
  SearchDegradationReporter,
} from "./search-diagnostics.js";
import {
  clearProjectIndexImpl,
  getProjectStatsImpl,
  warmupCacheImpl,
  getAnalyticsImpl,
} from "./rlm-admin.js";

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
  // Visibility relaxed from `private` so rlm-admin.ts can read via rlm param.
  fileFilterCache: FileFilterCache;
  /** Phase 2: query understanding (LLM rewrite + HyDE). Default-off, silent-degrade. */
  // Visibility relaxed from `private` so rlm-search.ts can read via rlm param.
  queryUnderstanding: QueryUnderstandingService;
  // Visibility relaxed from `private` so rlm-search.ts (fuseResults) can read.
  readonly RRF_K = 60; // Constant for Reciprocal Rank Fusion
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
      onDegradations?: (degradations: readonly SearchDegradation[]) => void;
    } = {},
  ): Promise<SearchResult[]> {
    return searchImpl(this, query, projectId, options);
  }

  /**
   * Apply session state after the session-independent base result is cached.
   * Invalid and workspace-mismatched sessions return the exact base array.
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  async applySynapseState(
    baseResults: SearchResult[],
    query: string,
    projectId: string,
    sessionId?: string,
    reportDegradation?: SearchDegradationReporter,
  ): Promise<SearchResult[]> {
    return applySynapseStateImpl(
      this,
      baseResults,
      query,
      projectId,
      sessionId,
      reportDegradation,
    );
  }

  /**
   * Fuzzy-correct each non-stopword query term via the keyword store's
   * vocabulary. Returns the corrected query string (lowercased, space-joined),
   * or null when no term corrects to a different word or fuzzyCorrect is
   * unavailable. Only words of length >= 3 are considered (shorter tokens
   * can't be reliably corrected).
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  async correctQuery(query: string): Promise<string | null> {
    return correctQueryImpl(this, query);
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
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  async buildGraphStream(
    resultSets: SearchResult[][],
    maxResults: number,
    projectId?: string,
    reportDegradation?: SearchDegradationReporter,
  ): Promise<SearchResult[]> {
    return buildGraphStreamImpl(
      this,
      resultSets,
      maxResults,
      projectId,
      reportDegradation,
    );
  }

  /**
   * Reciprocal Rank Fusion (RRF) - Combines multiple result lists
   *
   * Now includes intelligent boosting:
   * - Keywords get higher weight when query contains function/class names
   * - Exact matches in keyword results get additional boost
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  fuseResults(
    resultSets: SearchResult[][],
    query: string,
    explainScores: boolean = false,
  ): SearchResult[] {
    return fuseResultsImpl(this, resultSets, query, explainScores);
  }

  /**
   * Generate detailed score explanation
   */
  // Visibility relaxed from `private` so rlm-search.ts (fuseResults) can call via rlm param.
  generateScoreExplanation(
    finalScore: number,
    rrfScore: number,
    vectorScore?: number,
    keywordScore?: number,
    vectorRank?: number,
    keywordRank?: number,
    combinedRank?: number,
  ): any {
    return generateScoreExplanationImpl(
      finalScore,
      rrfScore,
      vectorScore,
      keywordScore,
      vectorRank,
      keywordRank,
      combinedRank,
    );
  }

  /**
   * Add expanded context to results
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  async addContextToResults(
    results: SearchResult[],
    _projectId: string,
  ): Promise<SearchResult[]> {
    return addContextToResultsImpl(this, results, _projectId);
  }

  /**
   * Extract content preview (first lines)
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  extractPreview(content: string, maxLines: number = 5): string {
    return extractPreviewImpl(content, maxLines);
  }

  /**
   * Calculate average score
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  calculateAvgScore(results: SearchResult[]): number {
    return calculateAvgScoreImpl(results);
  }

  /**
   * Filter results by glob patterns
   */
  // Visibility relaxed from `private` so rlm-search.ts can call via rlm param.
  filterByPatterns(
    results: SearchResult[],
    include?: string[],
    exclude?: string[],
  ): SearchResult[] {
    return filterByPatternsImpl(results, include, exclude);
  }

  /**
   * Clear project index
   */
  async clearProjectIndex(projectId: string): Promise<{ deleted: number }> {
    return clearProjectIndexImpl(this, projectId);
  }

  /**
   * Get project statistics
   */
  async getProjectStats(projectId: string): Promise<{
    totalDocuments: number;
    totalSize: number;
  }> {
    return getProjectStatsImpl(this, projectId);
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
    return warmupCacheImpl(this, projectId, _projectPath, customQueries);
  }

  /**
   * Get analytics instance for querying metrics
   */
  getAnalytics(): SearchAnalytics | SearchAnalyticsPg {
    return getAnalyticsImpl(this);
  }
}
