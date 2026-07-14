/**
 * ETL Pipeline Orchestrator
 *
 * Runs the 4 stages in sequence: discover → parse → resolve → load
 *
 * Integrates with:
 * - IndexJobTracker (in-memory job status polling)
 * - EventBus (real-time SSE broadcast)
 * - SymbolRepository (centrality-based priority ordering in discover)
 * - ContextualSearchRLM (vector clear on forceReindex)
 *
 * Usage:
 *   const pipeline = EtlPipeline.getInstance();
 *   const result = await pipeline.run({ projectId, projectPath, jobId });
 */

import { logger } from "@massa-th0th/shared";
import { DiscoverStage } from "./stages/discover.js";
import { ParseStage } from "./stages/parse.js";
import { ResolveStage } from "./stages/resolve.js";
import { LoadStage } from "./stages/load.js";
import { eventBus } from "../events/event-bus.js";
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import { indexJobTracker } from "../jobs/index-job-tracker.js";
import { getSearchCache } from "../search/cache-factory.js";
import { getVectorStore } from "../../data/vector/vector-store-factory.js";
import { getKeywordSearch } from "../../data/keyword/keyword-search-factory.js";
import type { EtlStageContext, EtlEvent, EtlResult, EtlStage } from "./stage-context.js";
import { assertParserReadyForIndexing } from "../structural/parser-readiness.js";
import { StructuralEtlParseError } from "./stages/parse.js";
import { createHash } from "node:crypto";
import { STRUCTURAL_FINGERPRINT_INPUTS } from "../structural/language-manifest.js";
import {
  buildGraphInputSnapshotHash,
  GraphGenerationCoordinator,
} from "./graph-generation-coordinator.js";
import type { GraphGenerationLease } from "../../data/graph-generation/graph-generation-contract.js";
import { setTimeout as delay } from "node:timers/promises";

export interface PipelineInput {
  projectId: string;
  projectPath: string;
  jobId: string;
  forceReindex?: boolean;
  /** If provided, only process these relative paths (incremental mode). */
  filesToProcess?: string[];
  /**
   * When true, the Discover stage does NOT exclude test/benchmark files
   * (`.test.ts`, `__tests__/`, `*.spec.*`, etc.), so typed edges from test
   * files are indexed. Default false (preserve search-recall hygiene —
   * {@link loadProjectIgnore} stays unchanged for query-time callers).
   */
  include_tests?: boolean;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    let abortReason: unknown;
    const onAbort = () => { abortReason = signal.reason; };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => abortReason === undefined ? resolve(value) : reject(abortReason),
      (error) => reject(abortReason ?? error),
    ).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export class EtlPipeline {
  private static instance: EtlPipeline | null = null;
  private static runTails = new Map<string, Promise<void>>();

  private readonly discover = new DiscoverStage();
  private readonly parse = new ParseStage();
  private readonly resolve = new ResolveStage();
  private readonly load = new LoadStage();
  private readonly graphGenerations = new GraphGenerationCoordinator();

  private constructor() {}

  static getInstance(): EtlPipeline {
    if (!EtlPipeline.instance) {
      EtlPipeline.instance = new EtlPipeline();
    }
    return EtlPipeline.instance;
  }

  async run(input: PipelineInput): Promise<EtlResult> {
    // Reject before queue or destructive force-reindex mutations are created.
    await assertParserReadyForIndexing();
    const previous = EtlPipeline.runTails.get(input.projectId);
    let release!: () => void;
    const tail = new Promise<void>((resolve) => {
      release = resolve;
    });
    EtlPipeline.runTails.set(input.projectId, tail);

    if (previous) {
      logger.info("EtlPipeline: waiting for prior project run", {
        projectId: input.projectId,
        jobId: input.jobId,
      });
      await previous;
    }

    try {
      return await this.runInternal(input);
    } finally {
      if (EtlPipeline.runTails.get(input.projectId) === tail) {
        EtlPipeline.runTails.delete(input.projectId);
      }
      release();
    }
  }

  private async runInternal(input: PipelineInput, generationRetry = 0): Promise<EtlResult> {
    const { projectId, projectPath, jobId, forceReindex = false, filesToProcess, include_tests = false } = input;
    const t0 = performance.now();
    const stageTimings: Record<EtlStage, number> = {
      discover: 0,
      parse: 0,
      resolve: 0,
      load: 0,
    };

    // Semantic vector/keyword stores intentionally retain their established
    // non-generational lifecycle (MLTS-013). Structural graph visibility is
    // independently protected by pending-generation activation.
    if (forceReindex) {
      const vectorStore = await getVectorStore();
      const keywordSearch = getKeywordSearch();
      await Promise.all([
        vectorStore.deleteByProject(projectId),
        keywordSearch.deleteByProject(projectId),
      ]);
    }

    // Build stage context with event emission
    const ctx: EtlStageContext = {
      projectId,
      projectPath,
      jobId,
      emit: (event: EtlEvent) => {
        // Forward ETL events to the global EventBus for SSE + job tracker
        if (event.type === "progress") {
          const p = event.payload as { current: number; total: number; percentage: number };
          indexJobTracker.updateProgress(jobId, p.current, p.total);
          eventBus.publish("indexing:progress", {
            jobId,
            projectId,
            stage: event.stage,
            current: p.current,
            total: p.total,
            percentage: p.percentage,
          });
        } else if (event.type === "file_error") {
          const p = event.payload as { filePath: string; error: string };
          eventBus.publish("indexing:file", {
            jobId,
            projectId,
            filePath: p.filePath,
            stage: event.stage,
            status: "error",
            error: p.error,
          });
        } else if (event.type === "file_processed") {
          const p = event.payload as { filePath: string };
          eventBus.publish("indexing:file", {
            jobId,
            projectId,
            filePath: p.filePath,
            stage: event.stage,
            status: "ok",
          });
        }
      },
    };

    eventBus.publish("indexing:started", { jobId, projectId, projectPath });

    let graphGenerationLease: GraphGenerationLease | undefined;
    let graphHeartbeat: Promise<void> | undefined;
    let graphHeartbeatFailure: Error | undefined;
    const graphAbortController = new AbortController();
    const heartbeatTimerController = new AbortController();
    let stopGraphHeartbeat = false;
    try {
      // ── Stage 1: Discover ─────────────────────────────────────────────────
      const st1 = performance.now();
      // Structural generations are complete project snapshots. A caller's
      // incremental hint cannot narrow membership or omitted/deleted paths
      // would disappear from completeness evidence unpredictably.
      const discoveredSnapshot = await this.discover.run(ctx, { forceReindex, includeTests: include_tests });
      stageTimings.discover = Math.round(performance.now() - st1);

      const activeGraph = await getSymbolRepository().getActiveGraphSnapshot(projectId);
      try {
        graphGenerationLease = await this.graphGenerations.begin({
          projectId,
          expectedActiveGenerationId: activeGraph?.generationId ?? null,
          fingerprint: `sha256:${createHash("sha256").update(JSON.stringify(STRUCTURAL_FINGERPRINT_INPUTS)).digest("hex")}`,
          inputSnapshotHash: buildGraphInputSnapshotHash(discoveredSnapshot),
          expectedFilesCount: discoveredSnapshot.length,
        });
      } catch (beginError) {
        if ((beginError as Error).message.startsWith("graph_generation_stale_active:") && generationRetry < 3) {
          return this.runInternal(input, generationRetry + 1);
        }
        throw beginError;
      }
      ctx.graphGenerationLease = graphGenerationLease;
      ctx.abortSignal = graphAbortController.signal;
      graphHeartbeat = (async () => {
        while (!stopGraphHeartbeat) {
          try { await delay(30_000, undefined, { signal: heartbeatTimerController.signal }); }
          catch { return; }
          if (stopGraphHeartbeat || !graphGenerationLease) return;
          try { await this.graphGenerations.heartbeat(graphGenerationLease); }
          catch (heartbeatError) {
            graphHeartbeatFailure = heartbeatError as Error;
            graphAbortController.abort(graphHeartbeatFailure);
            return;
          }
        }
      })();
      // A pending generation is a complete immutable graph snapshot. Semantic
      // stores keep their existing lifecycle; only structural work bypasses
      // the active-generation fingerprint skip.
      const requestedPaths = new Set(filesToProcess ?? []);
      const preparedFiles = discoveredSnapshot.map((file) => ({
        ...file,
        needsReparse: forceReindex || !activeGraph || file.needsReparse || requestedPaths.has(file.relativePath),
      }));
      if (activeGraph) {
        for (const file of preparedFiles) {
          if (file.needsReparse) continue;
          const copied = await getSymbolRepository().copyFileGeneration(
            graphGenerationLease,
            activeGraph.generationId,
            file.relativePath,
          );
          if (copied.status === "lease_lost") throw new Error("graph_generation_lease_lost");
          if (copied.status === "missing") file.needsReparse = true;
        }
      }
      const discovered = preparedFiles.map((file) => Object.freeze(file));

      eventBus.publish("indexing:started", {
        jobId,
        projectId,
        projectPath,
        totalFiles: discovered.filter((f) => f.needsReparse).length,
      });

      // ── Stage 2: Parse ────────────────────────────────────────────────────
      const st2 = performance.now();
      let remainingFiles = [...discovered];
      let parsed: Awaited<ReturnType<ParseStage["run"]>> = [];
      const staleFailures = new Set<string>();
      while (remainingFiles.length > 0) {
        try {
          parsed.push(...await abortable(this.parse.run(ctx, remainingFiles), graphAbortController.signal));
          break;
        } catch (parseError) {
          if (!activeGraph || forceReindex || !filesToProcess?.length || !(parseError instanceof StructuralEtlParseError) || staleFailures.has(parseError.filePath)) throw parseError;
          staleFailures.add(parseError.filePath);
          const stale = await getSymbolRepository().markFileStaleGeneration(
            graphGenerationLease,
            parseError.filePath,
            {
              lastKnownGoodGenerationId: activeGraph.generationId,
              diagnostics: parseError.diagnostics.length > 0
                ? parseError.diagnostics.slice(0, 10).map((diagnostic) => ({ ...diagnostic }))
                : [{ code: "incremental_structural_failure", message: parseError.message }],
              parserErrorCount: parseError.diagnosticCount,
            },
          );
          if (stale.status !== "stale") throw parseError;
          remainingFiles = remainingFiles.filter((file) => file.relativePath !== parseError.filePath);
        }
      }
      if (graphHeartbeatFailure) throw graphHeartbeatFailure;
      stageTimings.parse = Math.round(performance.now() - st2);

      // ── Stage 3: Resolve ──────────────────────────────────────────────────
      const st3 = performance.now();
      const resolved = await abortable(this.resolve.run(ctx, parsed), graphAbortController.signal);
      if (graphHeartbeatFailure) throw graphHeartbeatFailure;
      stageTimings.resolve = Math.round(performance.now() - st3);

      // ── Stage 4: Load ─────────────────────────────────────────────────────
      const st4 = performance.now();
      const loadResult = await abortable(this.load.run(ctx, resolved), graphAbortController.signal);
      if (graphHeartbeatFailure) throw graphHeartbeatFailure;
      stageTimings.load = Math.round(performance.now() - st4);

      if (loadResult.errors > 0) {
        throw new Error(
          `ETL completed with ${loadResult.errors} file error${loadResult.errors === 1 ? "" : "s"}`,
        );
      }

      const activationSnapshot = await abortable(this.discover.run(ctx, { forceReindex, includeTests: include_tests }), graphAbortController.signal);
      if (buildGraphInputSnapshotHash(activationSnapshot) !== graphGenerationLease.inputSnapshotHash) {
        throw new Error("graph_generation_stale_snapshot");
      }
      if (graphHeartbeatFailure) throw graphHeartbeatFailure;
      stopGraphHeartbeat = true;
      heartbeatTimerController.abort();
      await graphHeartbeat;
      const activatedGraph = await this.graphGenerations.activate(graphGenerationLease);
      const activeGraphSummary = await getSymbolRepository().getActiveGraphSnapshot(projectId);
      if (!activeGraphSummary || activeGraphSummary.generationId !== activatedGraph.generationId) {
        throw new Error("activated_graph_summary_mismatch");
      }

      const durationMs = Math.round(performance.now() - t0);

      const result: EtlResult = {
        filesDiscovered: discovered.length,
        filesIndexed: loadResult.filesLoaded,
        filesSkipped: discovered.filter((f) => !f.needsReparse).length,
        chunksIndexed: loadResult.chunksLoaded,
        symbolsIndexed: loadResult.symbolsLoaded,
        errors: loadResult.errors,
        durationMs,
        stageTimings,
        activatedGraphGenerationId: activatedGraph.generationId,
        parserDiagnostics: {
          diagnosticsCount: activeGraphSummary.diagnostics.errors,
          recoveredFiles: activeGraphSummary.diagnostics.recovered,
          hardFailureFiles: activeGraphSummary.diagnostics.hardFailures,
          staleFiles: activeGraphSummary.diagnostics.staleFiles,
          languages: activeGraphSummary.languages,
        },
      };

      // Index mutations invalidate every cached result for this project,
      // including cached misses created while the index was still cold. Do
      // this before publishing completion / marking the job terminal so a
      // status poller can safely query the newly materialized data as soon as
      // it observes `completed`.
      await getSearchCache().invalidateProject(projectId);

      // Belt-and-suspenders terminal signal: mark the job completed the moment
      // the pipeline resolves, independent of the caller's warmup path (which
      // may OOM or hang before reaching its own setResult). Idempotent —
      // setResult overwrites status/result. updateProgress first so percentage
      // is recorded at 100 before the terminal transition.
      indexJobTracker.updateProgress(jobId, result.filesIndexed, result.filesIndexed);
      await indexJobTracker.setResultAndFlush(jobId, {
        filesIndexed: result.filesIndexed,
        chunksIndexed: result.chunksIndexed,
        errors: result.errors,
        duration: durationMs,
        activatedGraphGenerationId: result.activatedGraphGenerationId,
        parserDiagnostics: result.parserDiagnostics,
      });

      eventBus.publish("indexing:completed", {
        jobId,
        projectId,
        filesIndexed: result.filesIndexed,
        chunksIndexed: result.chunksIndexed,
        symbolsIndexed: result.symbolsIndexed,
        durationMs,
        activatedGraphGenerationId: result.activatedGraphGenerationId,
      });

      await this.graphGenerations.cleanup(graphGenerationLease);
      stopGraphHeartbeat = true;
      heartbeatTimerController.abort();
      await graphHeartbeat;

      logger.info("EtlPipeline: run completed", { projectId, jobId, ...result });
      return result;
    } catch (err) {
      const durationMs = Math.round(performance.now() - t0);
      const error = (err as Error).message;

      if (graphGenerationLease) {
        try {
          await this.graphGenerations.abort(graphGenerationLease, error);
        } catch (abortError) {
          logger.error("EtlPipeline: pending generation abort failed", abortError as Error, { projectId, jobId });
        }
      }
      stopGraphHeartbeat = true;
      heartbeatTimerController.abort();
      graphAbortController.abort();
      await graphHeartbeat;

      eventBus.publish("indexing:failed", { jobId, projectId, error, durationMs });

      // Belt-and-suspenders terminal signal on failure: mark the job failed so
      // a poller sees a terminal state rather than a stuck "running". Idempotent
      // — the caller may also call setResult with the error; last write wins.
      indexJobTracker.setResult(
        jobId,
        { filesIndexed: 0, chunksIndexed: 0, errors: 1, duration: durationMs },
        error,
      );

      logger.error("EtlPipeline: run failed", err as Error, { projectId, jobId, durationMs });
      throw err;
    }
  }
}

export const etlPipeline = EtlPipeline.getInstance();
