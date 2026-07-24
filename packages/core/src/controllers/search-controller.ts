/**
 * Search Controller
 *
 * Orchestration layer for project search operations.
 * Extracts preview generation, glob filtering, and auto-reindex
 * coordination from the SearchProjectTool.
 */

import { logger, config } from "@massa-ai/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { eventBus } from "../services/events/event-bus.js";
import { LLMJudgeReranker } from "../services/search/reranker.js";
import type { SearchDegradation } from "../services/search/search-diagnostics.js";
import { minimatch } from "minimatch";
import { validateFilters } from "../services/search/filter-validation.js";
import type { FilterDowngrade } from "../services/search/filter-validation.js";

// ── Types ────────────────────────────────────────────────────

export interface ProjectSearchInput {
  query: string;
  projectId: string;
  projectPath?: string;
  maxResults?: number;
  minScore?: number;
  responseMode?: "summary" | "full" | "enriched";
  autoReindex?: boolean;
  include?: string[];
  exclude?: string[];
  explainScores?: boolean;
  /**
   * Files to boost in ranking (from Symbol Graph prefilter).
   * Results whose filePath is in this list get score * 1.3.
   */
  boostFiles?: string[];
  sessionId?: string;
}

export interface ProjectSearchResult {
  query: string;
  projectId: string;
  responseMode: string;
  tokenSavings: string;
  indexStatus: any;
  recommendations: string[];
  filters: {
    applied: boolean;
    include: string[];
    exclude: string[];
    totalResults: number;
    filteredResults: number;
  };
  results: FormattedResult[];
  /**
   * N4 (WAVE4-N4): pre-clamp reachable count, post-clamp shown, omitted.
   * `results_total` is the count of results that survived admission + search +
   * glob filtering (the reachable set) BEFORE the final `.slice(0, maxResults)`
   * clamps the displayed page. `results_shown` is the displayed page length.
   * `results_omitted = results_total - results_shown`.
   * Spec AC 3 — emitted at the top level (not centralized in serializeToolResponse
   * per the M36 contract; per-tool is the existing convention).
   */
  results_total: number;
  results_shown: number;
  results_omitted: number;
  /**
   * Admission preflight warning (Tier 2). Present only when the project is
   * indexed but `isIndexStale` flagged it (files_changed / path_mismatch /
   * age_threshold). Search still ran; callers MAY surface this to the user.
   * Absent when fresh, or when no projectPath was supplied (stale check skipped).
   */
  warning?: string;
  stale?: {
    reason: string;
    modifiedFiles?: number;
    newFiles?: number;
    deletedFiles?: number;
  };
  /** Optional subsystems that failed without invalidating mandatory retrieval. */
  degradations?: SearchDegradation[];
  /**
   * Wave 5 FR-18 / AD-W5-012: filter downgrade records. Present only when
   * `validateFilters` reconciled a contradiction (same pattern in both
   * include and exclude). The exclude entry is dropped (never both) and the
   * record is emitted here so the caller can correct its hints. Additive —
   * absent when no downgrades occurred.
   */
  filter_downgrades?: FilterDowngrade[];
}

interface FormattedResult {
  id: string;
  score: number;
  filePath: string;
  lineStart?: number;
  lineEnd?: number;
  language?: string;
  preview: string;
  explanation?: string;
  content?: string;
  parentSymbol?: string;
  fileImports?: string;
  chunkIndex?: number;
  totalChunks?: number;
}

// ── Controller ───────────────────────────────────────────────

export class SearchController {
  private static instance: SearchController | null = null;
  private contextualSearch: ContextualSearchRLM;

  private constructor() {
    this.contextualSearch = new ContextualSearchRLM();
  }

  static getInstance(): SearchController {
    if (!SearchController.instance) {
      SearchController.instance = new SearchController();
    }
    return SearchController.instance;
  }

  /** Expose the underlying search engine for direct use by ContextController. */
  getSearchEngine(): ContextualSearchRLM {
    return this.contextualSearch;
  }

  // ── Main search use case ───────────────────────────────────

  async searchProject(input: ProjectSearchInput): Promise<ProjectSearchResult> {
    const {
      query,
      projectId,
      projectPath,
      maxResults = 10,
      minScore = (() => { const v = Number(process.env.SEARCH_MIN_SCORE ?? "0.3"); return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 0.3; })(),
      responseMode = "summary",
      autoReindex = false,
      include,
      exclude,
      explainScores = false,
      boostFiles,
      sessionId,
    } = input;

    const startTime = Date.now();

    logger.info("Starting project search", {
      query,
      projectId,
      maxResults,
      autoReindex,
      explainScores,
    });

    // Admission preflight (M10): two-tier gate before any retrieval.
    //   Tier 1 — HARD-FAIL: no index metadata → throw, caller wraps as
    //            success:false. Replaces the prior silent `results:[]` path.
    //   Tier 2 — WARN: indexed but stale (needs projectPath) → search proceeds,
    //            `staleWarning` attached to the returned result.
    const admission = await this.contextualSearch.checkSearchAdmission(
      projectId,
      projectPath,
    );
    if (!admission.admitted) {
      throw new Error(admission.error ?? `Project '${projectId}' is not indexed`);
    }
    const staleWarning = admission.stale ?? null;

    // Auto-reindex if requested
    let reindexInfo = null;
    if (autoReindex && projectPath) {
      reindexInfo = await this.handleAutoReindex(projectId, projectPath);
    }

    // Execute search
    let degradations: readonly SearchDegradation[] = [];
    const results = await this.contextualSearch.search(query, projectId, {
      maxResults,
      minScore,
      explainScores,
      includeFilters: include,
      excludeFilters: exclude,
      sessionId,
      onDegradations: (entries) => {
        degradations = entries.slice(0, 10);
      },
    });

    logger.info("Project search completed", {
      projectId,
      resultCount: results.length,
      totalLatencyMs: Date.now() - startTime,
    });

    // Wave 5 FR-18 / N16 / AC-15: server-side revalidation of client filter
    // hints BEFORE filterByPatterns consumes them. Caps include+exclude,
    // validates glob syntax (teaching error on invalid), and downgrades
    // contradictions (same pattern in both → drop exclude, emit downgrade).
    // filterByPatterns uses the cleaned (post-downgrade) patterns. The
    // downgrade records are attached to the response (additive).
    const filterValidation = validateFilters(
      include,
      exclude,
      (config.get("filterValidation") as { maxFilterPatterns?: number }).maxFilterPatterns,
    );

    // Apply glob filters
    const filteredResults = this.filterByPatterns(
      results,
      filterValidation.include,
      filterValidation.exclude,
    );

    if (filteredResults.length < results.length) {
      logger.info("Results filtered by patterns", {
        before: results.length,
        after: filteredResults.length,
        include: filterValidation.include,
        exclude: filterValidation.exclude,
      });
    }

    // Apply centrality/graph boost: files identified by Symbol Graph prefilter
    // get a 30% score multiplier, then re-sort
    const boostedResults = boostFiles && boostFiles.length > 0
      ? this.applyBoost(filteredResults, boostFiles)
      : filteredResults;

    // Phase 7a: LLM-judge rerank of the top-K window (after centrality boost).
    // Default-off via config.search.rerank.enabled; silent-degrades to the
    // boosted order on LLM off/{ok:false}/throw. Never throws.
    const rerankCfg = (config.get("search") as { rerank?: { enabled?: boolean } }).rerank;
    let rerankedResults = boostedResults;
    if (rerankCfg?.enabled) {
      const reranker = new LLMJudgeReranker();
      rerankedResults = await reranker.rerank(query, boostedResults);
      eventBus.publish("search:reranked", {
        query,
        projectId,
        // The RRF stream count (2 = vector+keyword, 3 = +HyDE/qu) is owned by
        // ContextualSearchRLM; at the controller layer we report the fused
        // result count. Phase-2 still emits its own pre-rerank search:reranked
        // with the precise streamCount; this post-rerank emit adds source.
        streamCount: 2,
        resultCount: rerankedResults.length,
        source: "llm-judge",
      });
    }

    // N4 (WAVE4-N4): the reachable set is the post-filter, post-rerank list
    // BEFORE the final `.slice(0, maxResults)` clamps the displayed page. This
    // is the "pre-clamp reachable count" per spec AC 3. `results_shown` is the
    // page length after the slice. `results_omitted = results_total - results_shown`.
    const results_total = rerankedResults.length;

    const formattedResults = rerankedResults.slice(0, maxResults).map((r) => {
      const meta = (r.metadata ?? {}) as Record<string, unknown>;
      const base: FormattedResult = {
        id: r.id,
        score: r.score,
        filePath: meta.filePath as string,
        lineStart: meta.lineStart as number | undefined,
        lineEnd: meta.lineEnd as number | undefined,
        language: meta.language as string | undefined,
        preview: this.generatePreview(r, query),
      };
      if (r.explanation) base.explanation = r.explanation;
      if (responseMode === "full" || responseMode === "enriched") {
        base.content = r.content;
        base.chunkIndex = meta.chunkIndex as number | undefined;
        base.totalChunks = meta.totalChunks as number | undefined;
      }
      if (responseMode === "enriched") {
        if (meta.parentSymbol) base.parentSymbol = meta.parentSymbol as string;
        if (meta.fileImports) base.fileImports = meta.fileImports as string;
      }
      return base;
    });

    // Emit search:completed for hook subscribers (e.g. SearchSessionHook)
    eventBus.publish("search:completed", {
      query,
      projectId,
      sessionId,
      results: formattedResults.map((r) => ({
        filePath: r.filePath,
        score: r.score,
        lineStart: r.lineStart,
        lineEnd: r.lineEnd,
      })),
      durationMs: Date.now() - startTime,
      resultCount: formattedResults.length,
    });

    // Generate intelligent recommendations
    const recommendations: string[] = [];
    
    // Add reindex recommendations
    if ((reindexInfo as any)?.deferred) {
      recommendations.push("Indexing deferred to keep this search responsive");
      recommendations.push("Run index(projectPath, projectId) and poll get_index_status(jobId)");
    }

    // Add usage recommendations based on response mode
    if (responseMode === "summary" && formattedResults.length > 0) {
      recommendations.push("Use responseMode='enriched' to get full content + file imports + parentSymbol without extra tool calls");
      if (formattedResults.length >= 3) recommendations.push("Use optimized_context(query) for compressed multi-file context");
    }
    if (responseMode === "full") recommendations.push("Try responseMode='enriched' — same content plus fileImports and parentSymbol");
    if (responseMode === "enriched" && formattedResults.length > 0) recommendations.push("Enriched mode: content + fileImports + parentSymbol included. Use chunkIndex/totalChunks to navigate adjacent chunks.");

    // Add project-specific recommendations
    if (formattedResults.length === 0) {
      recommendations.push("Try lowering minScore (current: " + minScore + ") or different query terms");
      recommendations.push("Check if project is indexed: list_projects()");
    }

    return {
      query,
      projectId,
      responseMode,
      tokenSavings: responseMode === "summary" ? "~70% vs full mode" : "none",
      indexStatus: reindexInfo || { wasStale: false, reindexed: false },
      recommendations,
      filters: {
        applied:
          filterValidation.include.length > 0 ||
          filterValidation.exclude.length > 0 ||
          false,
        include: filterValidation.include,
        exclude: filterValidation.exclude,
        totalResults: results.length,
        filteredResults: filteredResults.length,
      },
      results: formattedResults,
      // N4 (WAVE4-N4): top-level totals for the clamped results list.
      results_total,
      results_shown: formattedResults.length,
      results_omitted: Math.max(0, results_total - formattedResults.length),
      ...(degradations.length > 0 ? { degradations: [...degradations] } : {}),
      // Wave 5 FR-18 / AD-W5-012: observable filter downgrade records.
      // Additive — present only when validateFilters reconciled a
      // contradiction (same pattern in both include and exclude).
      ...(filterValidation.downgrades.length > 0
        ? { filter_downgrades: filterValidation.downgrades }
        : {}),
      ...(staleWarning
        ? {
            warning: `Index may be stale (reason: ${staleWarning.reason}). Results reflect the indexed snapshot, not the current files.`,
            stale: staleWarning,
          }
        : {}),
    };
  }

  // ── Helpers ────────────────────────────────────────────────

  private async handleAutoReindex(
    projectId: string,
    projectPath: string,
  ): Promise<any> {
    const freshnessStart = Date.now();
    const info = await this.contextualSearch.ensureFreshIndex(
      projectId,
      projectPath,
      {
        allowFullReindex: false,
        maxSyncFiles: config.get("search").autoReindexMaxFiles,
      },
    );

    logger.info("Index freshness check completed", {
      projectId,
      latencyMs: Date.now() - freshnessStart,
      wasStale: info.wasStale,
      reindexed: info.reindexed,
      reason: info.reason,
      deferred: (info as any).deferred || false,
      filesPending: (info as any).filesPending || 0,
    });

    return info;
  }

  generatePreview(result: any, _query?: string): string {
    if (result.metadata?.context?.preview) return result.metadata.context.preview;
    const content = result.content || "";
    const allLines = content.split("\n");
    if (!allLines.some((l: string) => l.trim())) return "(empty)";
    const lang = (result.metadata?.language as string) || "";
    const isCode = /^(ts|tsx|js|jsx|mjs|cjs|py|go|rs|java|kt|swift|dart|cpp|c|cs|rb|php)$/.test(lang);
    if (isCode) {
      const bodyLines = allLines.filter((l: string) => {
        const t = l.trim();
        return t && !t.startsWith("// File:") && !t.startsWith("// Section:");
      });
      const sigLines: string[] = [];
      for (const line of bodyLines) {
        const t = line.trim();
        if (sigLines.length === 0 && (t.startsWith("//") || t.startsWith("/*") || t.startsWith("*") || t.startsWith("@"))) continue;
        if (sigLines.length === 0 && t.startsWith("import ")) continue;
        sigLines.push(line.trimEnd());
        if (t.endsWith("{") || t.endsWith("=>") || t.endsWith(";")) break;
        if (sigLines.length >= 8) break;
      }
      if (sigLines.length > 0) return sigLines.join("\n");
    }
    const meaningful = allLines.find((l: string) => {
      const t = l.trim();
      return t && !t.startsWith("import ") && !t.startsWith("//") && !t.startsWith("#") && !t.startsWith("/*") && !t.startsWith("*");
    }) || allLines.find((l: string) => l.trim()) || allLines[0];
    const preview = meaningful.trimEnd();
    return preview.length > 150 ? preview.substring(0, 147) + "..." : preview;
  }


  filterByPatterns(
    results: any[],
    include?: string[],
    exclude?: string[],
  ): any[] {
    return results.filter((result) => {
      const filePath = result.metadata?.filePath || "";
      if (!filePath) return !include?.length;

      if (exclude && exclude.length > 0) {
        for (const pattern of exclude) {
          if (minimatch(filePath, pattern)) return false;
        }
      }

      if (include && include.length > 0) {
        for (const pattern of include) {
          if (minimatch(filePath, pattern)) return true;
        }
        return false;
      }

      return true;
    });
  }

  /**
   * Apply a 30% score boost to results whose filePath is in boostFiles.
   * Re-sorts by boosted score descending.
   */
  applyBoost(results: any[], boostFiles: string[]): any[] {
    const boostSet = new Set(boostFiles);
    const BOOST_FACTOR = 1.3;

    return results
      .map((r) => {
        const filePath = r.metadata?.filePath || r.filePath || "";
        const boosted = boostSet.has(filePath)
          ? { ...r, score: Math.min(1, r.score * BOOST_FACTOR) }
          : r;
        return boosted;
      })
      .sort((a, b) => b.score - a.score);
  }
}
