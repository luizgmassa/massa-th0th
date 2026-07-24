/**
 * Project Routes
 *
 * GET  /api/v1/project/list - Listar projetos indexados
 * POST /api/v1/project/index - Indexar projeto (assíncrono)
 * GET /api/v1/project/index/status/:jobId - Consultar status de indexação
 */

import {
  GetIndexStatusTool,
  IndexProjectTool,
  ProjectIdentityError,
  createProjectIdentityService,
  getMemoryRepository,
  getKeywordSearch,
  getOperationLogRepository,
  getSearchCache,
  getVectorStore,
  workspaceManager,
  type ActorContext,
  type ProjectIdentityService,
  UNKNOWN_ACTOR,
} from "@massa-ai/core";
import { Elysia, t } from "elysia";
import fs from "fs/promises";
import path from "path";
import { getGlobalDataDir } from "@massa-ai/shared";
import { deriveActor } from "../middleware/auth.js";

let indexProjectTool: IndexProjectTool | null = null;
let indexStatusTool: GetIndexStatusTool | null = null;
let projectIdentityService: ProjectIdentityService | null = null;

function getIndexProjectTool(): IndexProjectTool {
  if (!indexProjectTool) {
    indexProjectTool = new IndexProjectTool();
  }
  return indexProjectTool;
}

function getIndexStatusTool(): GetIndexStatusTool {
  if (!indexStatusTool) {
    indexStatusTool = new GetIndexStatusTool();
  }
  return indexStatusTool;
}

function getProjectIdentityService(): ProjectIdentityService {
  if (!projectIdentityService) {
    projectIdentityService = createProjectIdentityService();
  }
  return projectIdentityService;
}

interface IdentityRequestBody {
  sourceProjectId: string;
  targetProjectId: string;
  dryRun?: boolean;
  operationId?: string;
  expectedPlanHash?: string;
}

/**
 * Shared rename/merge handler (spec public contract). dryRun DEFAULTS TO
 * TRUE: a preview never mutates and returns the planHash the apply call must
 * echo back as expectedPlanHash together with a caller-chosen operationId.
 * Errors are the sanitized ProjectIdentityError codes (spec req 9).
 */
async function handleProjectIdentity(
  mode: "rename" | "merge",
  body: IdentityRequestBody,
  set: { status?: number | string },
) {
  const service = getProjectIdentityService();
  const dryRun = body.dryRun !== false;
  try {
    if (dryRun) {
      const preview = await service.preview({
        mode,
        sourceProjectId: body.sourceProjectId,
        targetProjectId: body.targetProjectId,
        dryRun: true,
      });
      return { success: true, data: preview };
    }
    const result = await service.apply({
      mode,
      sourceProjectId: body.sourceProjectId,
      targetProjectId: body.targetProjectId,
      dryRun: false,
      operationId: body.operationId as string,
      expectedPlanHash: body.expectedPlanHash as string,
    });
    return { success: true, data: result };
  } catch (error) {
    if (error instanceof ProjectIdentityError) {
      set.status = error.statusCode;
      return {
        success: false,
        error: { code: error.code, message: error.message },
      };
    }
    throw error;
  }
}

const identityBodySchema = t.Object({
  sourceProjectId: t.String({ description: "Current project ID to rename/merge from" }),
  targetProjectId: t.String({ description: "Target project ID" }),
  dryRun: t.Optional(t.Boolean({
    default: true,
    description: "Preview only (default true). Apply requires dryRun=false + operationId + expectedPlanHash.",
  })),
  operationId: t.Optional(t.String({
    description: "Idempotency key required when dryRun=false",
  })),
  expectedPlanHash: t.Optional(t.String({
    description: "planHash from the dryRun preview, required when dryRun=false",
  })),
});

export const projectRoutes = new Elysia({ prefix: "/api/v1/project" })
  .get(
    "/list",
    async () => {
      try {
        const vectorStore = await getVectorStore();
        const projects = await vectorStore.listProjects();
        return {
          success: true,
          data: {
            projects,
            total: projects.length,
          },
        };
      } catch (error) {
        return {
          success: false,
          error: (error as Error).message,
        };
      }
    },
    {
      detail: {
        tags: ["project"],
        summary: "List indexed projects",
        description:
          "List all projects that have been indexed in the vector store, with document counts and metadata.",
      },
    },
  )
  .post(
    "/index",
    async ({ body }) => {
      return await getIndexProjectTool().handle(body);
    },
    {
      body: t.Object({
        projectPath: t.String({
          description: "Absolute path to the project directory to index",
        }),
        projectId: t.Optional(
          t.String({ description: "Unique identifier for the project" }),
        ),
        forceReindex: t.Optional(t.Boolean({ default: false })),
        warmCache: t.Optional(
          t.Boolean({
            default: false,
            description: "Pre-cache common queries after indexing",
          }),
        ),
        warmupQueries: t.Optional(
          t.Array(t.String(), { description: "Custom queries to pre-cache" }),
        ),
      }),
      detail: {
        tags: ["project"],
        summary: "Index a project (async)",
        description:
          "Start indexing a project directory in background. Returns a jobId immediately. Use GET /index/status/:jobId to check progress.",
      },
    },
  )
  .post(
    "/reset",
    async ({ body, headers }) => {
      const {
        projectId,
        clearVectors = true,
        clearSymbols = true,
        clearMemories = true,
      } = body as {
        projectId: string;
        clearVectors?: boolean;
        clearSymbols?: boolean;
        clearMemories?: boolean;
      };

      // Derive the audit actor from the request headers (API-key identity
      // today; future identity sources plug into deriveActor without
      // rewriting call sites). Elysia flattens headers to a plain
      // lowercase-keyed object, so deriveActor can index directly. The
      // reset outcome is recorded in operation_log AFTER the destructive
      // work finishes — recordOperation is fail-safe so a broken audit
      // table NEVER blocks the reset itself.
      const actor: ActorContext = deriveActor(
        headers as Record<string, string>,
      ) ?? UNKNOWN_ACTOR;

      const result: Record<string, number | string> = {};
      const errors: string[] = [];

      if (clearVectors) {
        try {
          const vectorStore = await getVectorStore();
          const keywordSearch = getKeywordSearch();
          const [vectorsDeleted, keywordsDeleted] = await Promise.all([
            vectorStore.deleteByProject(projectId),
            keywordSearch.deleteByProject(projectId),
          ]);
          result.vectorsDeleted = vectorsDeleted;
          // Lexical rows are another representation of the indexed chunks,
          // so clearVectors governs both semantic and lexical search data.
          result.keywordsDeleted = keywordsDeleted;
          // Invalidate the in-process search cache (L1 + L2). Without this,
          // queries served from L1 keep returning stale chunk metadata
          // (file/lineStart/lineEnd) until the process restarts.
          await getSearchCache().invalidateProject(projectId);
        } catch (e) {
          errors.push(`vectors: ${(e as Error).message}`);
        }
      }

      if (clearSymbols) {
        try {
          await workspaceManager.removeWorkspace(projectId);
          result.symbolsCleared = 1;
        } catch (e) {
          // workspace may not exist — treat as success
          result.symbolsCleared = 0;
        }
      }

      if (clearMemories) {
        try {
          result.memoriesDeleted =
            await getMemoryRepository().deleteByProject(projectId);
        } catch (e) {
          errors.push(`memories: ${(e as Error).message}`);
        }
      }

      const outcome = errors.length > 0
        ? (errors.length >= 3 ? ("failure" as const) : ("partial" as const))
        : ("success" as const);

      // M8 audit trail. Best-effort: recordOperation swallows errors so a
      // broken operation_log NEVER blocks the reset. Scope captures what
      // was requested + what was deleted (counts are cheap and already in
      // hand). The await preserves ordering (audit row lands after the
      // destructive op) without introducing failure surface.
      await getOperationLogRepository().recordOperation({
        actorType: actor.actorType,
        actorId: actor.actorId,
        projectId,
        op: "project_reset",
        scope: {
          projectId,
          requestedScopes: {
            vectors: clearVectors,
            symbols: clearSymbols,
            memories: clearMemories,
          },
        },
        result: outcome,
        meta: { ...result },
        error: errors.length > 0 ? errors.join("; ") : null,
      });

      if (errors.length > 0) {
        return {
          success: false,
          data: result,
          errors,
        };
      }

      return {
        success: true,
        data: {
          projectId,
          ...result,
          message: `Project '${projectId}' reset complete.`,
        },
      };
    },
    {
      body: t.Object({
        projectId: t.String({ description: "Project ID to reset" }),
        clearVectors: t.Optional(
          t.Boolean({
            default: true,
            description: "Delete vector embeddings (semantic search index)",
          }),
        ),
        clearSymbols: t.Optional(
          t.Boolean({
            default: true,
            description:
              "Delete symbol graph (definitions, references, imports, centrality)",
          }),
        ),
        clearMemories: t.Optional(
          t.Boolean({
            default: true,
            description: "Delete stored memories for this project",
          }),
        ),
      }),
      detail: {
        tags: ["project"],
        summary: "Reset / clean a project",
        description:
          "Delete all indexed data for a project: vector embeddings, symbol graph, and memories. Each scope can be toggled independently. Useful before a full reindex or to free space.",
      },
    },
  )

  .post(
    "/upload-and-index",
    async ({ body }) => {
      // Normalize cross-platform separators then take basename for a safe slug
      const rawBase = body.projectId ||
        body.projectPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
        "default";
      const finalProjectId = rawBase.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128);

      const uploadRoot = process.env.MASSA_AI_UPLOAD_DIR || path.join(getGlobalDataDir(), "uploads");
      const stagingDir = path.resolve(uploadRoot, finalProjectId);

      // Clear stale files from previous uploads so deleted/renamed files don't linger
      await fs.rm(stagingDir, { recursive: true, force: true });
      await fs.mkdir(stagingDir, { recursive: true });

      // Write files in bounded batches to avoid EMFILE on large uploads
      const WRITE_BATCH = 20;
      for (let i = 0; i < body.files.length; i += WRITE_BATCH) {
        await Promise.all(
          body.files.slice(i, i + WRITE_BATCH).map(async (file) => {
            // Reject absolute paths and traversal sequences
            if (path.isAbsolute(file.relativePath) || file.relativePath.includes("..")) {
              throw new Error(`Invalid file path: ${file.relativePath}`);
            }
            const dest = path.resolve(stagingDir, file.relativePath.replace(/\//g, path.sep));
            if (!dest.startsWith(stagingDir + path.sep)) {
              throw new Error(`Path escapes staging directory: ${file.relativePath}`);
            }
            await fs.mkdir(path.dirname(dest), { recursive: true });
            await fs.writeFile(dest, file.content, "utf-8");
          }),
        );
      }

      return await getIndexProjectTool().handle({
        projectPath: stagingDir,
        projectId: finalProjectId,
        forceReindex: body.forceReindex,
        warmCache: body.warmCache,
        warmupQueries: body.warmupQueries,
      });
    },
    {
      body: t.Object({
        projectPath: t.String({
          description: "Original path on the client machine (used to derive projectId)",
        }),
        projectId: t.Optional(t.String()),
        forceReindex: t.Optional(t.Boolean({ default: false })),
        warmCache: t.Optional(t.Boolean({ default: false })),
        warmupQueries: t.Optional(t.Array(t.String())),
        files: t.Array(
          t.Object({
            relativePath: t.String(),
            content: t.String(),
          }),
        ),
      }),
      detail: {
        tags: ["project"],
        summary: "Upload files and index (remote client)",
        description:
          "Receive project files from a remote MCP client, write them to a server-side staging directory, and kick off the ETL indexing pipeline.",
      },
    },
  )

  .get(
    "/index/status/:jobId",
    async ({ params }) => {
      return await getIndexStatusTool().handle({ jobId: params.jobId });
    },
    {
      params: t.Object({
        jobId: t.String({ description: "Job ID returned by POST /index" }),
      }),
      detail: {
        tags: ["project"],
        summary: "Get indexing job status",
        description:
          "Get the status and progress of an async indexing job started with POST /index",
      },
    },
  )
  .post(
    "/rename",
    async ({ body, set }) => handleProjectIdentity("rename", body, set),
    {
      body: identityBodySchema,
      detail: {
        tags: ["project"],
        summary: "Rename a project identity (transactional)",
        description:
          "Preview (dryRun default true) returns canonical roots, per-store counts, conflicts, and planHash. Apply (dryRun=false) requires operationId + expectedPlanHash and executes the rename in one transaction.",
      },
    },
  )
  .post(
    "/merge",
    async ({ body, set }) => handleProjectIdentity("merge", body, set),
    {
      body: identityBodySchema,
      detail: {
        tags: ["project"],
        summary: "Merge two project identities (transactional)",
        description:
          "Merge source into target under the same canonical root. Preview (dryRun default true) returns counts/conflicts/planHash; apply (dryRun=false) requires operationId + expectedPlanHash.",
      },
    },
  );
