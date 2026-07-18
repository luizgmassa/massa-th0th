/**
 * rlm-indexing — indexing lifecycle delegates for ContextualSearchRLM.
 *
 * Extracted (M14 Phase 3, T3.1) from contextual-search-rlm.ts. Behavior is
 * byte-preserved: bodies moved verbatim with `this` → `rlm`. The class keeps
 * the static `indexingLocks` mutex map and `_indexProjectInternal` /
 * `ensureInitialized` as instance delegate methods (test monkey-patches them
 * on the instance; see design.md "Delegate-preservation contract").
 */

import { logger, config } from "@massa-th0th/shared";
import { VectorDocument } from "@massa-th0th/shared";
import fs from "fs/promises";
import path from "path";
import { glob } from "glob";
import { smartChunk } from "./smart-chunker.js";
import { loadProjectIgnore } from "./ignore-patterns.js";
import { IndexManager } from "./index-manager.js";
import { assertParserReadyForIndexing } from "../structural/parser-readiness.js";
import { getKeywordSearch } from "../../data/keyword/keyword-search-factory.js";
import { getVectorStore } from "../../data/vector/vector-store-factory.js";
import { getSearchCache } from "./cache-factory.js";
import { getSearchAnalytics } from "./analytics-factory.js";
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import type { ContextualSearchRLM } from "./contextual-search-rlm.js";

const globAsync = glob;

// ── Types (mirrors of the original inline signatures) ────────────────────────

export type IndexProjectOptions = {
  onProgress?: (current: number, total: number) => void;
};

export type IndexProjectResult = {
  filesIndexed: number;
  chunksIndexed: number;
  errors: number;
};

export type EnsureFreshIndexOptions = {
  allowFullReindex?: boolean;
  maxSyncFiles?: number;
};

export type EnsureFreshIndexResult = {
  wasStale: boolean;
  reindexed: boolean;
  reason?: string;
  deferred?: boolean;
  filesPending?: number;
};

export type SearchAdmissionResult = {
  admitted: boolean;
  error?: string;
  stale?: {
    reason: string;
    modifiedFiles?: number;
    newFiles?: number;
    deletedFiles?: number;
  };
};

// ── Mutex ────────────────────────────────────────────────────────────────────

/**
 * Per-project queue mutex: serializes concurrent indexing for the same project.
 *
 * Pattern: each caller chains its lock after the current tail, then waits for
 * the previous lock before proceeding. This guarantees correct ordering for any
 * number of concurrent callers (3+), unlike a simple check-and-set.
 *
 *   A sets map[proj] = lock_A, awaits null  → starts immediately
 *   B sets map[proj] = lock_B, awaits lock_A → waits for A
 *   C sets map[proj] = lock_C, awaits lock_B → waits for B
 *   A finishes → releases lock_A → B starts
 *   B finishes → releases lock_B → C starts
 *   C finishes → map[proj] === lock_C, so we clean up the entry
 *
 * The `try { await work() } finally { delete-if-still-owner; releaseLock() }`
 * shape is load-bearing: `releaseLock()` MUST run even when `work` throws, or
 * the lock leaks and subsequent callers hang (BUG-SYN-4).
 *
 * `work` is `() => this._indexProjectInternal(...)` in the caller — a lambda
 * that captures virtual dispatch through `this`, so test monkey-patches on the
 * instance still route. Do NOT inline a direct call to a module function here.
 */
export async function runWithIndexLock<T>(
  lockMap: Map<string, Promise<void>>,
  projectId: string,
  work: () => Promise<T>,
): Promise<T> {
  const prevLock = lockMap.get(projectId);
  const isQueued = prevLock !== undefined;

  let releaseLock!: () => void;
  const myLock = new Promise<void>((resolve) => { releaseLock = resolve; });
  lockMap.set(projectId, myLock);

  if (isQueued) {
    logger.info("Waiting for existing indexing to complete", { projectId });
    await prevLock;
  }

  try {
    return await work();
  } finally {
    // Only remove the map entry if we are still the tail (no new waiter after us)
    if (lockMap.get(projectId) === myLock) {
      lockMap.delete(projectId);
    }
    releaseLock();
  }
}

// ── _indexProjectInternal ────────────────────────────────────────────────────

export async function _indexProjectInternalImpl(
  rlm: ContextualSearchRLM,
  projectPath: string,
  projectId: string,
  options: IndexProjectOptions = {},
): Promise<IndexProjectResult> {
  await rlm.ensureInitialized();
  logger.info("Starting project indexing", { projectPath, projectId });

  const securityConfig = config.get("security");
  const allowedExtensions = securityConfig.allowedExtensions || [
    ".ts",
    ".js",
    ".tsx",
    ".jsx",
    ".dart",
    ".py",
  ];

  try {
    // Load .gitignore rules
    const ig = await loadGitignoreImpl(projectPath);

    // Find all relevant files
    const files = await globAsync(`**/*{${allowedExtensions.join(",")}}`, {
      cwd: projectPath,
      absolute: true,
      nodir: true,
      dot: false,
    });

    // Filter files using .gitignore rules
    const filteredFiles = files.filter((file) => {
      const relativePath = path.relative(projectPath, file);
      const shouldIgnore = ig.ignores(relativePath);

      if (shouldIgnore) {
        logger.debug("Ignoring file per .gitignore during indexing", {
          filePath: relativePath,
        });
      }

      return !shouldIgnore;
    });

    logger.info(
      `Found ${filteredFiles.length} files to index (${files.length - filteredFiles.length} ignored)`,
      {
        projectId,
      },
    );

    options.onProgress?.(0, filteredFiles.length);

    // Load centrality map once for the whole project so each chunk
    // carries its file's PageRank score in metadata.
    const centralityMap = await rlm.symbolRepo.getCentrality(projectId);

    let filesIndexed = 0;
    let chunksIndexed = 0;
    let errors = 0;

    // Process files in batches to avoid overloading
    const BATCH_SIZE = 20;
    let processedFiles = 0;
    for (let i = 0; i < filteredFiles.length; i += BATCH_SIZE) {
      const batch = filteredFiles.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(async (file) => {
          try {
            const result = await rlm.indexFile(file, projectId, projectPath, centralityMap);
            filesIndexed++;
            chunksIndexed += result.chunks;
          } catch (error) {
            logger.error("Failed to index file", error as Error, { file });
            errors++;
          } finally {
            processedFiles++;
            options.onProgress?.(processedFiles, filteredFiles.length);
          }
        }),
      );

      // Log progress
      if (i % 50 === 0) {
        logger.info(
          `Progress: ${i}/${filteredFiles.length} files processed`,
          {
            projectId,
          },
        );
      }
    }

    // Update index metadata after successful indexing
    const indexedFilesList = filteredFiles.map((f) =>
      path.relative(projectPath, f),
    );
    await rlm.indexManager.updateIndexMetadata(
      projectId,
      projectPath,
      indexedFilesList,
    );

    logger.info("Project indexing completed", {
      projectId,
      filesIndexed,
      chunksIndexed,
      errors,
    });

    return { filesIndexed, chunksIndexed, errors };
  } catch (error) {
    logger.error("Project indexing failed", error as Error, { projectId });
    throw error;
  }
}

// ── ensureFreshIndex ─────────────────────────────────────────────────────────

export async function ensureFreshIndexImpl(
  rlm: ContextualSearchRLM,
  projectId: string,
  projectPath: string,
  options: EnsureFreshIndexOptions = {},
): Promise<EnsureFreshIndexResult> {
  await rlm.ensureInitialized();
  const allowFullReindex = options.allowFullReindex ?? false;
  const maxSyncFiles =
    options.maxSyncFiles ?? config.get("search").autoReindexMaxFiles;

  const staleCheck = await rlm.indexManager.isIndexStale(
    projectId,
    projectPath,
  );

  if (!staleCheck.isStale) {
    return { wasStale: false, reindexed: false };
  }

  logger.info("Index is stale, performing incremental reindex", {
    projectId,
    reason: staleCheck.reason,
    modifiedFiles: staleCheck.modifiedFiles?.length,
    newFiles: staleCheck.newFiles?.length,
    deletedFiles: staleCheck.deletedFiles?.length,
  });

  // Get files that need reindexing (pass staleCheck to avoid double filesystem scan)
  const filesToReindex = await rlm.indexManager.getFilesToReindex(
    projectId,
    projectPath,
    staleCheck,
  );

  if (filesToReindex.length > maxSyncFiles) {
    logger.warn("Skipping sync reindex due to file limit", {
      projectId,
      reason: staleCheck.reason,
      filesToReindex: filesToReindex.length,
      maxSyncFiles,
    });

    return {
      wasStale: true,
      reindexed: false,
      deferred: true,
      reason: staleCheck.reason || "files_changed",
      filesPending: filesToReindex.length,
    };
  }

  if (filesToReindex.length === 0) {
    return {
      wasStale: true,
      reindexed: false,
      reason: "no_files_to_reindex",
    };
  }

  // For full reindex or many changes, clear and reindex
  const needsFullReindex =
    staleCheck.reason === "no_index" ||
    staleCheck.reason === "path_mismatch" ||
    filesToReindex.length > maxSyncFiles;

  if (needsFullReindex && !allowFullReindex) {
    logger.warn("Deferring full reindex in latency-sensitive path", {
      projectId,
      reason: staleCheck.reason,
      filesToReindex: filesToReindex.length,
    });

    return {
      wasStale: true,
      reindexed: false,
      deferred: true,
      reason: staleCheck.reason || "full_reindex_needed",
      filesPending: filesToReindex.length,
    };
  }

  if (needsFullReindex) {
    logger.info("Performing full reindex", { projectId });
    await rlm.indexProject(projectPath, projectId);

    // Invalidate cache after reindex
    await rlm.searchCache.invalidateProject(projectId);

    return {
      wasStale: true,
      reindexed: true,
      reason: "full_reindex",
    };
  }

  // Incremental reindex
  logger.info("Performing incremental reindex", {
    projectId,
    fileCount: filesToReindex.length,
  });

  // Load centrality map so chunks carry PageRank scores
  const centralityMap = await rlm.symbolRepo.getCentrality(projectId);

  let filesIndexed = 0;
  let chunksIndexed = 0;
  let errors = 0;

  for (const relativeFilePath of filesToReindex) {
    try {
      const fullPath = path.join(projectPath, relativeFilePath);
      const result = await rlm.indexFile(fullPath, projectId, projectPath, centralityMap);
      filesIndexed++;
      chunksIndexed += result.chunks;
    } catch (error) {
      logger.error("Failed to reindex file", error as Error, {
        file: relativeFilePath,
      });
      errors++;
    }
  }

  // Update metadata
  await rlm.indexManager.updateIndexMetadata(
    projectId,
    projectPath,
    filesToReindex,
  );

  // Invalidate cache after incremental reindex
  await rlm.searchCache.invalidateProject(projectId);

  logger.info("Incremental reindex completed", {
    projectId,
    filesIndexed,
    chunksIndexed,
    errors,
  });

  return {
    wasStale: true,
    reindexed: true,
    reason: "incremental_reindex",
  };
}

// ── checkSearchAdmission ─────────────────────────────────────────────────────

export async function checkSearchAdmissionImpl(
  rlm: ContextualSearchRLM,
  projectId: string,
  projectPath?: string,
): Promise<SearchAdmissionResult> {
  await rlm.ensureInitialized();

  const metadata = await rlm.indexManager.getIndexMetadata(projectId);
  if (!metadata) {
    return {
      admitted: false,
      error: `Project '${projectId}' is not indexed. Run index_project first, then retry.`,
    };
  }

  if (projectPath) {
    const staleCheck = await rlm.indexManager.isIndexStale(
      projectId,
      projectPath,
    );
    if (staleCheck.isStale) {
      return {
        admitted: true,
        stale: {
          reason: staleCheck.reason ?? "unknown",
          modifiedFiles: staleCheck.modifiedFiles?.length,
          newFiles: staleCheck.newFiles?.length,
          deletedFiles: staleCheck.deletedFiles?.length,
        },
      };
    }
  }

  return { admitted: true };
}

// ── indexFile ────────────────────────────────────────────────────────────────

export async function indexFileImpl(
  rlm: ContextualSearchRLM,
  filePath: string,
  projectId: string,
  projectRoot: string,
  centralityMap?: Map<string, number>,
): Promise<{ chunks: number }> {
  const content = await fs.readFile(filePath, "utf-8");
  const relativePath = path.relative(projectRoot, filePath);

  // Check maximum file size
  const maxFileSize = config.get("security").maxFileSize || 1024 * 1024;
  if (content.length > maxFileSize) {
    logger.warn("File too large, skipping", {
      filePath,
      size: content.length,
    });
    return { chunks: 0 };
  }

  // Smart chunking: language/format-aware splitting
  const chunks = smartChunk(content, relativePath);

  // Look up the file's PageRank centrality score (0 if unavailable)
  const centralityScore = centralityMap?.get(relativePath) ?? 0;

  const documents: VectorDocument[] = chunks.map((chunk, i) => ({
    id: `${projectId}:${relativePath}:${i}`,
    content: chunk.content,
    metadata: {
      projectId,
      filePath: relativePath,
      chunkIndex: i,
      totalChunks: chunks.length,
      type: chunk.type,
      language: path.extname(filePath).slice(1),
      lineStart: chunk.lineStart,
      lineEnd: chunk.lineEnd,
      label: chunk.label,
      centralityScore,
      ...(chunk.fileImports && { fileImports: chunk.fileImports }),
      ...(chunk.parentSymbol && { parentSymbol: chunk.parentSymbol }),
    },
  }));

  // Run vector and keyword indexing in parallel (I/O optimization)
  // Since embeddings are generated during addDocuments(), we can run
  // FTS5 keyword indexing concurrently to save ~30% total time
  await Promise.all([
    // Vector store: sub-batched embedding + insert
    rlm.vectorStore.addDocuments(documents),

    // Keyword search: parallel FTS5 inserts
    Promise.all(
      documents.map((doc) =>
        rlm.keywordSearch.index(doc.id, doc.content, doc.metadata),
      ),
    ),
  ]);

  return { chunks: chunks.length };
}

// ── loadGitignore ────────────────────────────────────────────────────────────

export function loadGitignoreImpl(projectPath: string) {
  return loadProjectIgnore(projectPath);
}

// ── ensureInitialized ────────────────────────────────────────────────────────

export async function ensureInitializedImpl(rlm: ContextualSearchRLM): Promise<void> {
  if (rlm.initialized) return;

  const injected = rlm.injectedDeps ?? {};
  const resolveKeyword = injected.keywordSearch
    ? Promise.resolve(injected.keywordSearch)
    : getKeywordSearch();
  const resolveVector = injected.vectorStore
    ? Promise.resolve(injected.vectorStore)
    : getVectorStore();
  const resolveCache = injected.searchCache
    ? Promise.resolve(injected.searchCache)
    : getSearchCache();
  const resolveAnalytics = injected.analytics
    ? Promise.resolve(injected.analytics)
    : getSearchAnalytics();
  const resolveSymbolRepo = injected.symbolRepo
    ? Promise.resolve(injected.symbolRepo)
    : getSymbolRepository();

  [
    rlm.keywordSearch,
    rlm.vectorStore,
    rlm.searchCache,
    rlm.analytics,
    rlm.symbolRepo,
  ] = await Promise.all([
    resolveKeyword,
    resolveVector,
    resolveCache,
    resolveAnalytics,
    resolveSymbolRepo,
  ]);

  rlm.indexManager = new IndexManager(rlm.vectorStore);
  rlm.initialized = true;
  logger.info("ContextualSearchRLM initialized", {
    via: injected.vectorStore ? "injected-seam" : "factory",
  });
}
