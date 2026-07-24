/**
 * rlm-admin — admin/stats delegates for ContextualSearchRLM.
 *
 * Extracted (M14 Phase 3, T3.3) from contextual-search-rlm.ts. Behavior is
 * byte-preserved: bodies moved verbatim with `this` → `rlm`.
 */

import { logger } from "@massa-ai/shared";
import { SearchAnalytics } from "./search-analytics.js";
import type { SearchAnalyticsPg } from "./search-analytics-pg.js";
import type { ContextualSearchRLM } from "./contextual-search-rlm.js";

// ── clearProjectIndex ────────────────────────────────────────────────────────

export async function clearProjectIndexImpl(
  rlm: ContextualSearchRLM,
  projectId: string,
): Promise<{ deleted: number }> {
  await rlm.ensureInitialized();
  try {
    const [deleted, keywordDeleted] = await Promise.all([
      rlm.vectorStore.deleteByProject(projectId),
      rlm.keywordSearch.deleteByProject(projectId),
    ]);

    // Clear associated caches
    await rlm.searchCache.invalidateProject(projectId);
    rlm.fileFilterCache.invalidateProject(projectId);

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

// ── getProjectStats ──────────────────────────────────────────────────────────

export async function getProjectStatsImpl(
  rlm: ContextualSearchRLM,
  projectId: string,
): Promise<{
  totalDocuments: number;
  totalSize: number;
}> {
  await rlm.ensureInitialized();
  return rlm.vectorStore.getStats(projectId);
}

// ── warmupCache ──────────────────────────────────────────────────────────────

export async function warmupCacheImpl(
  rlm: ContextualSearchRLM,
  projectId: string,
  _projectPath: string,
  customQueries?: string[],
): Promise<{ queriesWarmed: number; errors: number }> {
  await rlm.ensureInitialized();
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
      await rlm.search(query, projectId, {
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

// ── getAnalytics ─────────────────────────────────────────────────────────────

export function getAnalyticsImpl(
  rlm: ContextualSearchRLM,
): SearchAnalytics | SearchAnalyticsPg {
  return rlm.analytics;
}
