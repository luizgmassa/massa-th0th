/**
 * Index Project Tool
 *
 * Indexes an entire project for optimized contextual search (ASYNC).
 * Creates embeddings and FTS5 indexes for all relevant files.
 *
 * Returns a jobId immediately and processes indexing in background.
 * Use get_index_status(jobId) to check progress.
 *
 * Now powered by the 4-stage ETL Pipeline:
 *   discover → parse → resolve → load
 */

import { IToolHandler } from "@massa-ai/shared";
import { ToolResponse } from "@massa-ai/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { logger } from "@massa-ai/shared";
import { indexJobTracker } from "../services/jobs/index-job-tracker.js";
import { EtlPipeline, EtlPipelineBusyError } from "../services/etl/pipeline.js";
import { workspaceManager } from "../services/workspace/workspace-manager.js";
import { realpath } from "node:fs/promises";
import path from "path";
import { randomUUID } from "node:crypto";
import { assertParserReadyForIndexing } from "../services/structural/parser-readiness.js";
import { ManagedRunRepositoryPg } from "../data/managed-runs/managed-run-repository-pg.js";
import type { ManagedRunLease } from "../data/managed-runs/managed-run-contract.js";

interface IndexProjectParams {
  projectPath: string;
  projectId?: string;
  forceReindex?: boolean;
  warmCache?: boolean;
  warmupQueries?: string[];
  /** Include test/benchmark files so typed edges from `.test.ts` etc. are indexed. */
  include_tests?: boolean;
}

type CanonicalizePath = (projectPath: string) => Promise<string>;

export async function canonicalizeProjectRoot(
  projectPath: string,
  canonicalize: CanonicalizePath = realpath,
): Promise<string> {
  return canonicalize(path.resolve(projectPath));
}

export async function assertProjectRootReuse(options: {
  projectId: string;
  canonicalProjectPath: string;
  storedProjectPath?: string | null;
  forceReindex: boolean;
  canonicalize?: CanonicalizePath;
}): Promise<void> {
  if (!options.storedProjectPath || options.forceReindex) return;
  const canonicalize = options.canonicalize ?? realpath;
  let storedCanonical: string;
  try {
    storedCanonical = await canonicalize(path.resolve(options.storedProjectPath));
  } catch {
    storedCanonical = path.resolve(options.storedProjectPath);
  }
  if (storedCanonical !== options.canonicalProjectPath) {
    throw new Error(
      `Project ID "${options.projectId}" already indexes canonical root ` +
        `"${storedCanonical}", not "${options.canonicalProjectPath}"; ` +
        "use forceReindex only after verifying ownership of the existing project",
    );
  }
}

export class IndexProjectTool implements IToolHandler {
  name = "index_project";
  description =
    "Index a project directory for contextual code search with semantic embeddings";
  inputSchema = {
    type: "object",
    properties: {
      projectPath: {
        type: "string",
        description: "Absolute path to the project directory to index",
      },
      projectId: {
        type: "string",
        description:
          "Unique identifier for the project (defaults to directory name)",
      },
      forceReindex: {
        type: "boolean",
        description: "Force reindex even if project already exists",
        default: false,
      },
      warmCache: {
        type: "boolean",
        description: "Pre-cache common queries after indexing for faster initial searches",
        default: false,
      },
      warmupQueries: {
        type: "array",
        items: { type: "string" },
        description: "Custom queries to pre-cache (uses defaults if not provided)",
      },
      include_tests: {
        type: "boolean",
        description:
          "Index test/benchmark files too so typed edges from .test.ts files are captured (default false)",
        default: false,
      },
    },
    required: ["projectPath"],
  };

  private contextualSearch: ContextualSearchRLM;

  constructor() {
    this.contextualSearch = new ContextualSearchRLM();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      projectPath,
      projectId,
      forceReindex = false,
      warmCache = false,
      warmupQueries,
      include_tests = false,
    } = params as IndexProjectParams;

    try {
      // Do not create or return an accepted job while native parsing is down.
      await assertParserReadyForIndexing();
      const canonicalProjectPath = await canonicalizeProjectRoot(projectPath);
      // Gera projectId se não fornecido
      const finalProjectId =
        projectId || path.basename(canonicalProjectPath) || "default";
      const existing = await workspaceManager.getWorkspace(finalProjectId);
      await assertProjectRootReuse({
        projectId: finalProjectId,
        canonicalProjectPath,
        storedProjectPath: existing?.project_path,
        forceReindex,
      });

      // Cria job de indexação
      const job = indexJobTracker.createJob(finalProjectId, canonicalProjectPath);

      logger.info("Indexing job created", {
        jobId: job.jobId,
        projectPath: canonicalProjectPath,
        projectId: finalProjectId,
      });

      // ── Wave 5 FR-09: acquire a managed_runs lease synchronously so the
      // MCP/HTTP caller gets 202 (acquired) or 409 busy BEFORE the long ETL
      // runs in the background. The lease is passed into the pipeline, which
      // owns heartbeat/complete/abort. eventId is derived from the job id so
      // a retry of the same job is idempotent at the lease layer (a
      // completed/aborted row's event_id is not reused because the partial
      // UNIQUE only covers active rows).
      const eventId = `index:${job.jobId}`;
      const managedRunRepo = ManagedRunRepositoryPg.getInstance();
      let lease: ManagedRunLease | undefined;
      try {
        const beginOutcome = await managedRunRepo.begin({
          projectId: finalProjectId,
          runKind: "indexing",
          eventId,
        });
        if (beginOutcome.status === "busy") {
          // 409: another live indexer holds this project. Surface the active
          // runId so the caller can poll get_index_status.
          indexJobTracker.setResult(
            job.jobId,
            { filesIndexed: 0, chunksIndexed: 0, errors: 0, duration: 0 },
            `indexing_busy:${beginOutcome.activeRunId}`,
          );
          return {
            success: false,
            error: `indexing_busy:${beginOutcome.activeRunId}`,
            data: {
              jobId: job.jobId,
              projectId: finalProjectId,
              status: "busy",
              activeRunId: beginOutcome.activeRunId,
              leaseExpiresAt: beginOutcome.leaseExpiresAt,
              message: "Another indexing run is active for this project. Poll get_index_status(activeRunId).",
            },
          };
        }
        lease = beginOutcome.lease;
      } catch (beginError) {
        logger.error("managed_runs begin failed", beginError as Error, { jobId: job.jobId, projectId: finalProjectId });
        // Fail loud — a lease failure is a 500, not a silent retry. The caller
        // can retry; the lease table is the source of truth.
        indexJobTracker.setResult(
          job.jobId,
          { filesIndexed: 0, chunksIndexed: 0, errors: 1, duration: 0 },
          `managed_runs_begin_failed:${(beginError as Error).message}`,
        );
        return {
          success: false,
          error: `Failed to acquire indexing lease: ${(beginError as Error).message}`,
        };
      }

      // Executa indexação em background (não await)
      this.executeIndexing(
        job.jobId,
        finalProjectId,
        canonicalProjectPath,
        forceReindex,
        warmCache,
        warmupQueries,
        include_tests,
        lease,
      ).catch((error) => {
        logger.error("Background indexing failed", error as Error, {
          jobId: job.jobId,
        });
      });

      // Return immediately with jobId
      return {
        success: true,
        data: {
          jobId: job.jobId,
          projectId: finalProjectId,
          projectPath: canonicalProjectPath,
          status: "started",
          runId: lease.runId,
          message:
            "Indexing started in background. Use get_index_status(jobId) to check progress.",
        },
      };
    } catch (error) {
      logger.error("Failed to start indexing job", error as Error, {
        projectPath,
        projectId,
      });

      return {
        success: false,
        error: `Failed to start indexing: ${(error as Error).message}`,
      };
    }
  }

  /**
   * Executa indexação em background usando o ETL Pipeline de 4 estágios.
   *
   * O pipeline substitui o monobloco contextualSearch.indexProject() anterior:
   *   discover → parse → resolve → load
   *
   * Mantém compatibilidade: warmCache continua funcionando via contextualSearch.
   */
  private async executeIndexing(
    jobId: string,
    projectId: string,
    projectPath: string,
    forceReindex: boolean,
    warmCache: boolean,
    warmupQueries?: string[],
    include_tests: boolean = false,
    managedRunLease?: ManagedRunLease,
  ): Promise<void> {
    const startTime = Date.now();

    try {
      indexJobTracker.updateStatus(jobId, "running");

      logger.info("Starting project indexing via ETL Pipeline", {
        jobId,
        projectPath,
        projectId,
        forceReindex,
        warmCache,
        include_tests,
      });

      // ETL Pipeline: discover → parse → resolve → load
      // EventBus integration handles progress updates and WorkspaceManager status
      const etlResult = await EtlPipeline.getInstance().run({
        projectId,
        projectPath,
        jobId,
        forceReindex,
        include_tests,
        managedRunLease,
      });

      const duration = Date.now() - startTime;

      logger.info("ETL Pipeline completed", {
        jobId,
        projectId,
        duration,
        filesIndexed: etlResult.filesIndexed,
        filesSkipped: etlResult.filesSkipped,
        chunksIndexed: etlResult.chunksIndexed,
        symbolsIndexed: etlResult.symbolsIndexed,
        errors: etlResult.errors,
        stageTimings: etlResult.stageTimings,
      });

      // Warmup semantic search cache if requested (unchanged from before)
      if (warmCache) {
        logger.info("Starting cache warmup", { jobId, projectId });
        const warmupStats = await this.contextualSearch.warmupCache(
          projectId,
          projectPath,
          warmupQueries
        );
        logger.info("Cache warmup completed", { jobId, projectId, ...warmupStats });
      }

      // Mark job complete. Emit 100% progress immediately before the terminal
      // transition so any poller that reads progress atomically with status sees
      // a consistent completed+100% shape (the pipeline also emits this; this is
      // belt-and-suspenders in case the pipeline path changes).
      indexJobTracker.updateProgress(
        jobId,
        etlResult.filesIndexed,
        etlResult.filesIndexed,
      );
      await indexJobTracker.setResultAndFlush(jobId, {
        filesIndexed: etlResult.filesIndexed,
        chunksIndexed: etlResult.chunksIndexed,
        errors: etlResult.errors,
        duration,
        activatedGraphGenerationId: etlResult.activatedGraphGenerationId,
        parserDiagnostics: etlResult.parserDiagnostics,
      });
    } catch (error) {
      const duration = Date.now() - startTime;
      logger.error("Project indexing failed", error as Error, {
        jobId,
        projectPath,
        projectId,
        duration,
      });

      indexJobTracker.setResult(
        jobId,
        {
          filesIndexed: 0,
          chunksIndexed: 0,
          errors: 1,
          duration,
        },
        (error as Error).message
      );
    }
  }
}
