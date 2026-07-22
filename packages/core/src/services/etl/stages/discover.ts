/**
 * ETL Stage 1 — Discover
 *
 * Scans the project directory for indexable files.
 * Computes SHA-256 content hashes and compares against stored hashes
 * to skip files that haven't changed (fingerprint cache).
 *
 * Output order: high-centrality + recently-modified files first,
 * so the Load stage populates the most important context earliest.
 */

import { glob } from "glob";
import type { Ignore } from "ignore";
import fs from "fs/promises";
import path from "path";
import { createHash } from "crypto";
import ignoreModule from "ignore";
import { config, logger } from "@massa-th0th/shared";
import { getSymbolRepository } from "../../../data/symbol/symbol-repository-factory.js";
import type { EtlStageContext, DiscoveredFile } from "../stage-context.js";
import { DEFAULT_EXTENSIONS, DEFAULT_IGNORES, loadProjectIgnore } from "../../search/ignore-patterns.js";

const ignore = (ignoreModule as unknown as { default: typeof ignoreModule }).default ?? ignoreModule;

// Test/benchmark glob patterns inside DEFAULT_IGNORES (ignore-patterns.ts:33-45).
// When includeTests is true, the discover-local Ignore omits ONLY these so test
// files are indexed; everything else in DEFAULT_IGNORES (build artifacts, locks,
// generated, etc.) still applies. loadProjectIgnore itself is untouched so
// query-time callers keep excluding tests.
const TEST_IGNORE_PATTERNS = new Set([
  "**/__tests__/**",
  "**/tests/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/benchmarks/**",
  "**/fixtures/**",
]);

export class DiscoverStage {
  /**
   * Run the discovery stage.
   *
   * @param ctx - Stage execution context (projectId, projectPath, jobId, emit)
   * @param opts.forceReindex - When true, marks all files as needsReparse=true
   * @param opts.filesToProcess - Explicit list of relative paths for incremental reindex
   * @param opts.includeTests - When true, do NOT exclude test/benchmark files.
   *   Builds a discover-local Ignore that omits the test globs from
   *   DEFAULT_IGNORES; loadProjectIgnore itself is unchanged so query-time
   *   callers (index-manager, contextual-search-rlm) still ignore tests.
   */
  async run(
    ctx: EtlStageContext,
    opts: {
      forceReindex?: boolean;
      filesToProcess?: string[];
      includeTests?: boolean;
    } = {},
  ): Promise<DiscoveredFile[]> {
    const t0 = performance.now();

    ctx.emit({
      type: "stage_start",
      stage: "discover",
      payload: { projectId: ctx.projectId, projectPath: ctx.projectPath },
      timestamp: Date.now(),
    });

    const ig = await this.loadIgnore(ctx.projectPath, opts.includeTests ?? false);
    const allowedExts: string[] =
      (config.get("security") as Record<string, unknown>).allowedExtensions as string[] ??
      DEFAULT_EXTENSIONS;

    let relPaths: string[];

    if (opts.filesToProcess && opts.filesToProcess.length > 0) {
      relPaths = opts.filesToProcess;
    } else {
      const pattern = `**/*{${allowedExts.join(",")}}`;
      const found = await glob(pattern, {
        cwd: ctx.projectPath,
        nodir: true,
        dot: false,
        absolute: false,
      });
      // Ensure paths are relative (ignore library requires relative paths)
      relPaths = found
        .map((p) => (path.isAbsolute(p) ? path.relative(ctx.projectPath, p) : p))
        .filter((p) => !ig.ignores(p));
    }

    // ── Wave 5 FR-10: FileCursor resume. If a cursor from a previous run
    // is present, skip files at-or-before the cursor path (already-applied).
    // The cursor's `path` is the LAST file successfully applied before the
    // cursor was written; everything at-or-before it has been applied.
    // `offset` is reserved for byte-level resume within a file (future
    // work); at file-level granularity the cursor file is treated as fully
    // applied (vectors upsert idempotently via deterministic doc ids, so a
    // re-apply is safe, but we skip it to avoid redundant work). The filter
    // applies to both glob-discovered and explicitly-passed `filesToProcess`
    // so callers that pass an incremental hint still resume correctly.
    // AC-24: kill mid-load leaves the cursor at the PREVIOUS file (the
    // killed file's cursor write never commits), so restart re-processes
    // the killed file (vectors upsert idempotently — partial re-apply safe).
    if (ctx.resumeCursor?.path) {
      const cursorPath = ctx.resumeCursor.path;
      relPaths = relPaths.filter((rel) => rel.localeCompare(cursorPath) > 0);
    }

    // Load stored centrality scores for priority ordering
    const centralityMap = await getSymbolRepository().getCentrality(ctx.projectId);

    // Process files and compute fingerprints in parallel (batches of 30)
    const discovered: DiscoveredFile[] = [];
    const BATCH = 30;

    for (let i = 0; i < relPaths.length; i += BATCH) {
      if (ctx.abortSignal?.aborted) throw ctx.abortSignal.reason;
      const batch = relPaths.slice(i, i + BATCH);
      const results = await Promise.all(
        batch.map((rel) => this.processFile(ctx, rel, opts.forceReindex ?? false)),
      );
      for (const f of results) {
        if (f) discovered.push(f);
      }

      ctx.emit({
        type: "progress",
        stage: "discover",
        payload: {
          current: Math.min(i + BATCH, relPaths.length),
          total: relPaths.length,
          percentage: Math.round((Math.min(i + BATCH, relPaths.length) / relPaths.length) * 100),
        },
        timestamp: Date.now(),
      });
    }

    // Sort: centrality desc → mtime desc → path asc
    discovered.sort((a, b) => {
      const ca = centralityMap.get(a.relativePath) ?? 0;
      const cb = centralityMap.get(b.relativePath) ?? 0;
      if (cb !== ca) return cb - ca;
      if (b.mtime !== a.mtime) return b.mtime - a.mtime;
      return a.relativePath.localeCompare(b.relativePath);
    });

    const durationMs = Math.round(performance.now() - t0);

    ctx.emit({
      type: "stage_end",
      stage: "discover",
      payload: {
        total: discovered.length,
        needsReparse: discovered.filter((f) => f.needsReparse).length,
        skipped: discovered.filter((f) => !f.needsReparse).length,
        durationMs,
      },
      timestamp: Date.now(),
    });

    logger.info("ETL Discover complete", {
      projectId: ctx.projectId,
      total: discovered.length,
      needsReparse: discovered.filter((f) => f.needsReparse).length,
      durationMs,
    });

    return discovered;
  }

  private async processFile(
    ctx: EtlStageContext,
    relativePath: string,
    forceReindex: boolean,
  ): Promise<DiscoveredFile | null> {
    const absolutePath = path.join(ctx.projectPath, relativePath);

    try {
      const stat = await fs.stat(absolutePath);
      const content = await fs.readFile(absolutePath, "utf-8");
      const contentHash = createHash("sha256").update(content).digest("hex");

      let needsReparse = forceReindex;

      if (!forceReindex) {
        const stored = await getSymbolRepository().getFile(ctx.projectId, relativePath);
        needsReparse = !stored || stored.content_hash !== contentHash;
      }

      return {
        absolutePath,
        relativePath,
        mtime: stat.mtimeMs,
        size: stat.size,
        contentHash,
        snapshotContent: content,
        needsReparse,
      };
    } catch (err) {
      logger.warn("DiscoverStage: failed to stat/read file", {
        relativePath,
        error: (err as Error).message,
      });
      throw new Error(`required_file_unreadable:${relativePath}:${(err as Error).message}`);
    }
  }

  /**
   * Build the project Ignore. When includeTests is false (default), delegates
   * to {@link loadProjectIgnore} unchanged (keeps query-time callers ignoring
   * tests). When includeTests is true, constructs a discover-local Ignore that
   * omits the test/benchmark globs from DEFAULT_IGNORES so test files are
   * indexed but everything else (build artifacts, locks, generated, etc.)
   * stays ignored. This does NOT mutate loadProjectIgnore.
   */
  private async loadIgnore(projectPath: string, includeTests: boolean): Promise<Ignore> {
    if (!includeTests) return loadProjectIgnore(projectPath);

    // Build a discover-local Ignore with test globs stripped.
    const ig = ignore();
    for (const pattern of DEFAULT_IGNORES) {
      if (TEST_IGNORE_PATTERNS.has(pattern)) continue;
      ig.add(pattern);
    }
    try {
      const gitignorePath = path.join(projectPath, ".gitignore");
      const gitignoreContent = await fs.readFile(gitignorePath, "utf8");
      const rules = gitignoreContent
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      ig.add(rules);
    } catch {
      // No .gitignore — defaults only.
    }
    return ig;
  }
}
