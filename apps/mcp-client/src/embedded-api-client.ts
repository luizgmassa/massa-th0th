/**
 * EmbeddedApiClient — in-process tool dispatch without HTTP (Wave 6 N32, T18).
 *
 * Implements the same `ToolProxyApiClient` interface as `ApiClient` (HTTP),
 * but routes get/post/patch/delete directly to core service/controller/tool
 * calls instead of serializing through a REST round-trip. This lets the MCP
 * server run fully embedded (no separate tools-api process) when
 * `MASSA_TH0TH_EMBEDDED=true`.
 *
 * Endpoint mapping mirrors the tools-api REST routes exactly so a tool call
 * yields the same result shape in both modes (parity contract, T19).
 *
 * Also exposes `uploadAndIndex` + `healthCheck` (NOT on the proxy interface —
 * `McpProxyServer` calls these directly on `apiClient`). The embedded
 * `uploadAndIndex` does in-process file indexing with the same path-safety
 * validation as the HTTP upload route (`project.ts:351-356`).
 */

import { ApiHttpError } from "./api-client.js";
import type { ToolProxyApiClient } from "./call-tool-proxy.js";
import {
  IndexProjectTool,
  GetIndexStatusTool,
  SearchProjectTool,
  SearchCodeTool,
  StoreMemoryTool,
  SearchMemoriesTool,
  UpdateMemoryTool,
  DeleteMemoryTool,
  ListCheckpointsTool,
  CreateCheckpointTool,
  RestoreCheckpointTool,
  CompressContextTool,
  GetOptimizedContextTool,
  GetAnalyticsTool,
  ListProjectsTool,
  SearchDefinitionsTool,
  GetReferencesTool,
  GoToDefinitionTool,
  TracePathTool,
  ImpactAnalysisTool,
  GetArchitectureTool,
  ReadFileTool,
  FetchAndIndexTool,
  CompactSnapshotTool,
  ExecutorController,
  SymbolGraphService,
  getHookService,
  getHandoffService,
  getAutoImproveJob,
  getBootstrapService,
  getSessionRegistry,
  DEFAULT_BUFFER_CONFIG,
  DEFAULT_PREFETCH_CONFIG,
  buildPrefetchPlan,
  TaskEnvelopeService,
  workspaceManager,
  getVectorStore,
  getKeywordSearch,
  getMemoryRepository,
} from "@massa-th0th/core";
import type { PrefetchEntry } from "@massa-th0th/core/services";
import { SearchSource, logger } from "@massa-th0th/shared";
import { WebController } from "@massa-th0th/core";
import fs from "fs/promises";
import path from "path";
import { getGlobalDataDir } from "@massa-th0th/shared";

// ── Lazy singletons (mirror the REST route lazy-init pattern) ────────────────

let _indexProjectTool: IndexProjectTool | null = null;
function indexProjectTool(): IndexProjectTool {
  if (!_indexProjectTool) _indexProjectTool = new IndexProjectTool();
  return _indexProjectTool;
}

let _indexStatusTool: GetIndexStatusTool | null = null;
function indexStatusTool(): GetIndexStatusTool {
  if (!_indexStatusTool) _indexStatusTool = new GetIndexStatusTool();
  return _indexStatusTool;
}

let _searchProjectTool: SearchProjectTool | null = null;
function searchProjectTool(): SearchProjectTool {
  if (!_searchProjectTool) _searchProjectTool = new SearchProjectTool();
  return _searchProjectTool;
}

let _searchCodeTool: SearchCodeTool | null = null;
function searchCodeTool(): SearchCodeTool {
  if (!_searchCodeTool) _searchCodeTool = new SearchCodeTool();
  return _searchCodeTool;
}

let _storeMemoryTool: StoreMemoryTool | null = null;
function storeMemoryTool(): StoreMemoryTool {
  if (!_storeMemoryTool) _storeMemoryTool = new StoreMemoryTool();
  return _storeMemoryTool;
}

let _searchMemoriesTool: SearchMemoriesTool | null = null;
function searchMemoriesTool(): SearchMemoriesTool {
  if (!_searchMemoriesTool) _searchMemoriesTool = new SearchMemoriesTool();
  return _searchMemoriesTool;
}

let _updateMemoryTool: UpdateMemoryTool | null = null;
function updateMemoryTool(): UpdateMemoryTool {
  if (!_updateMemoryTool) _updateMemoryTool = new UpdateMemoryTool();
  return _updateMemoryTool;
}

let _deleteMemoryTool: DeleteMemoryTool | null = null;
function deleteMemoryTool(): DeleteMemoryTool {
  if (!_deleteMemoryTool) _deleteMemoryTool = new DeleteMemoryTool();
  return _deleteMemoryTool;
}

let _listCheckpointsTool: ListCheckpointsTool | null = null;
function listCheckpointsTool(): ListCheckpointsTool {
  if (!_listCheckpointsTool) _listCheckpointsTool = new ListCheckpointsTool();
  return _listCheckpointsTool;
}

let _createCheckpointTool: CreateCheckpointTool | null = null;
function createCheckpointTool(): CreateCheckpointTool {
  if (!_createCheckpointTool) _createCheckpointTool = new CreateCheckpointTool();
  return _createCheckpointTool;
}

let _restoreCheckpointTool: RestoreCheckpointTool | null = null;
function restoreCheckpointTool(): RestoreCheckpointTool {
  if (!_restoreCheckpointTool) _restoreCheckpointTool = new RestoreCheckpointTool();
  return _restoreCheckpointTool;
}

let _compressContextTool: CompressContextTool | null = null;
function compressContextTool(): CompressContextTool {
  if (!_compressContextTool) _compressContextTool = new CompressContextTool();
  return _compressContextTool;
}

let _optimizedContextTool: GetOptimizedContextTool | null = null;
function optimizedContextTool(): GetOptimizedContextTool {
  if (!_optimizedContextTool) _optimizedContextTool = new GetOptimizedContextTool();
  return _optimizedContextTool;
}

let _analyticsTool: GetAnalyticsTool | null = null;
function analyticsTool(): GetAnalyticsTool {
  if (!_analyticsTool) _analyticsTool = new GetAnalyticsTool();
  return _analyticsTool;
}

let _listProjectsTool: ListProjectsTool | null = null;
function listProjectsTool(): ListProjectsTool {
  if (!_listProjectsTool) _listProjectsTool = new ListProjectsTool();
  return _listProjectsTool;
}

let _searchDefsTool: SearchDefinitionsTool | null = null;
function searchDefsTool(): SearchDefinitionsTool {
  if (!_searchDefsTool) _searchDefsTool = new SearchDefinitionsTool();
  return _searchDefsTool;
}

let _getRefsTool: GetReferencesTool | null = null;
function getRefsTool(): GetReferencesTool {
  if (!_getRefsTool) _getRefsTool = new GetReferencesTool();
  return _getRefsTool;
}

let _goToDefTool: GoToDefinitionTool | null = null;
function goToDefTool(): GoToDefinitionTool {
  if (!_goToDefTool) _goToDefTool = new GoToDefinitionTool();
  return _goToDefTool;
}

let _tracePathTool: TracePathTool | null = null;
function tracePathTool(): TracePathTool {
  if (!_tracePathTool) _tracePathTool = new TracePathTool();
  return _tracePathTool;
}

let _impactAnalysisTool: ImpactAnalysisTool | null = null;
function impactAnalysisTool(): ImpactAnalysisTool {
  if (!_impactAnalysisTool) _impactAnalysisTool = new ImpactAnalysisTool();
  return _impactAnalysisTool;
}

let _getArchitectureTool: GetArchitectureTool | null = null;
function getArchitectureTool(): GetArchitectureTool {
  if (!_getArchitectureTool) _getArchitectureTool = new GetArchitectureTool();
  return _getArchitectureTool;
}

let _readFileTool: ReadFileTool | null = null;
function readFileTool(): ReadFileTool {
  if (!_readFileTool) {
    const symbolGraph = SymbolGraphService.getInstance();
    _readFileTool = new ReadFileTool(symbolGraph);
  }
  return _readFileTool;
}

let _fetchAndIndexTool: FetchAndIndexTool | null = null;
let _fetchAndIndexInit: Promise<FetchAndIndexTool> | null = null;
async function fetchAndIndexTool(): Promise<FetchAndIndexTool> {
  if (_fetchAndIndexTool) return _fetchAndIndexTool;
  if (_fetchAndIndexInit) return _fetchAndIndexInit;
  _fetchAndIndexInit = (async () => {
    const [vectorStore, keywordSearch] = await Promise.all([
      getVectorStore(),
      Promise.resolve(getKeywordSearch()),
    ]);
    WebController.instantiate({ vectorStore, keywordSearch });
    const controller = WebController.getInstance();
    _fetchAndIndexTool = new FetchAndIndexTool((params) => controller.fetchAndIndex(params));
    return _fetchAndIndexTool;
  })().finally(() => {
    _fetchAndIndexInit = null;
  });
  return _fetchAndIndexInit;
}

let _compactSnapshotTool: CompactSnapshotTool | null = null;
function compactSnapshotTool(): CompactSnapshotTool {
  if (!_compactSnapshotTool) _compactSnapshotTool = new CompactSnapshotTool();
  return _compactSnapshotTool;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Build an ApiHttpError-shaped error (same `{success:false, error}` structure) and throw it. */
function httpError(status: number, message: string): never {
  throw new ApiHttpError(status, { success: false, error: message });
}

/** Parse a query-param value to a string (the REST route receives strings). */
function qs(val: unknown): string | undefined {
  if (val === undefined || val === null) return undefined;
  return String(val);
}

/** Parse a query-param value to a bounded int (mirrors `boundedInt`). */
function boundedInt(val: unknown, def: number, min: number, max: number): number {
  if (val == null || val === "") return def;
  const n = Number(val);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

/** Serialize a Synapse session to the same shape the REST route returns. */
function serializeSession(s: ReturnType<ReturnType<typeof getSessionRegistry>["get"]>) {
  if (!s) return null;
  return {
    sessionId: s.sessionId,
    agentId: s.agentId,
    workspaceId: s.workspaceId,
    taskContext: s.taskContext,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
    accessHistorySize: s.accessHistory.size,
    bufferEnabled: !!s.buffer,
    bufferSize: s.buffer?.size(),
  };
}

// ── EmbeddedApiClient ────────────────────────────────────────────────────────

export class EmbeddedApiClient implements ToolProxyApiClient {
  /** GET request — maps to core service/controller calls by endpoint. */
  async get(endpoint: string, queryParams?: Record<string, unknown>): Promise<unknown> {
    try {
      // Symbol graph endpoints (GET with query params)
      if (endpoint === "/api/v1/symbol/definitions") {
        const q = queryParams ?? {};
        const projectId = qs(q.projectId);
        if (!projectId) return { success: false, error: "projectId is required" };
        const limit = boundedInt(qs(q.limit), 20, 1, 500);
        const { definitions: defs, total, total_exact } = await SymbolGraphService.getInstance().listDefinitions(projectId, {
          search: qs(q.search),
          kind: typeof q.kind === "string" ? (q.kind as string).split(",") : undefined,
          file: qs(q.file),
          exportedOnly: q.exportedOnly === "true",
          limit,
        });
        const shown = defs.length;
        return {
          success: true,
          data: {
            definitions: defs,
            definitions_total: total,
            definitions_shown: shown,
            definitions_omitted: Math.max(0, total - shown),
            definitions_total_exact: total_exact,
            total: shown,
          },
        };
      }

      if (endpoint === "/api/v1/symbol/references") {
        const q = queryParams ?? {};
        const projectId = qs(q.projectId);
        if (!projectId) return { success: false, error: "projectId is required" };
        const symbolName = qs(q.symbolName);
        if (!symbolName) return { success: false, error: "symbolName is required" };
        const fqn = qs(q.fqn);
        const lookup = fqn
          ? await SymbolGraphService.getInstance().lookupDefinition(projectId, fqn)
          : undefined;
        const refs = await SymbolGraphService.getInstance().getReferences(projectId, symbolName, fqn, lookup);
        const limit = boundedInt(qs(q.limit), 50, 1, 1000);
        const limited = refs.slice(0, limit);
        return {
          success: true,
          data: { references: limited, total: refs.length, shown: limited.length, omitted: refs.length - limited.length },
        };
      }

      if (endpoint === "/api/v1/symbol/definition") {
        const q = queryParams ?? {};
        const projectId = qs(q.projectId);
        if (!projectId) return { success: false, error: "projectId is required" };
        const symbolName = qs(q.symbolName);
        if (!symbolName) return { success: false, error: "symbolName is required" };
        const lookup = await SymbolGraphService.getInstance().lookupDefinition(projectId, symbolName);
        const defs = await SymbolGraphService.getInstance().goToDefinition(projectId, symbolName, qs(q.fromFile), lookup);
        return { success: true, data: { found: defs.length > 0, symbolName, definitions: defs } };
      }

      if (endpoint === "/api/v1/symbol/trace") {
        return await tracePathTool().handle(queryParams ?? {});
      }

      if (endpoint === "/api/v1/symbol/snippet") {
        const q = queryParams ?? {};
        const projectId = qs(q.projectId);
        if (!projectId) return { success: false, error: "projectId is required" };
        const file = qs(q.file);
        if (!file) return { success: false, error: "file is required" };
        const workspace = await workspaceManager.getWorkspace(projectId);
        if (!workspace) return { success: false, error: `Workspace '${projectId}' not found` };
        const start = boundedInt(qs(q.lineStart), 1, 1, 1_000_000);
        const MAX_SNIPPET_LINES = (() => {
          const v = Number(process.env.MASSA_TH0TH_READ_FILE_MAX_LINES);
          return Number.isFinite(v) && v > 0 ? Math.floor(v) : 500;
        })();
        const cappedEndMax = start + MAX_SNIPPET_LINES - 1;
        let end: number;
        let source_clipped = false;
        const lineEnd = qs(q.lineEnd);
        if (lineEnd) {
          const requestedEnd = boundedInt(lineEnd, start + 20, start, start + 10_000);
          if (requestedEnd - start + 1 > MAX_SNIPPET_LINES) {
            end = cappedEndMax;
            source_clipped = true;
          } else {
            end = requestedEnd;
          }
        } else {
          end = start + 20;
        }
        const absolutePath = path.join(workspace.project_path, file);
        const content = await fs.readFile(absolutePath, "utf-8");
        const lines = content.split(/\r?\n/);
        const slice = lines.slice(start - 1, Math.min(lines.length, end));
        const formatted = slice.map((text, idx) => ({ lineNumber: start + idx, content: text }));
        return { success: true, data: { file, projectId, startLine: start, endLine: start + slice.length - 1, source_clipped, lines: formatted } };
      }

      // Parametric GET endpoints (synapse session, workspace, architecture, index-status)
      // Match /api/v1/synapse/session/:id
      const synapseMatch = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)$/);
      if (synapseMatch) {
        const id = synapseMatch[1]!;
        const registry = getSessionRegistry();
        await registry.ensureReady();
        const session = registry.get(id);
        if (!session) return { success: false, error: "Session not found or expired" };
        return { success: true, data: serializeSession(session) };
      }

      // Match /api/v1/workspace/:id/map
      const mapMatch = endpoint.match(/^\/api\/v1\/workspace\/([^/]+)\/map$/);
      if (mapMatch) {
        const projectId = mapMatch[1]!;
        const q = queryParams ?? {};
        const centralityLimit = boundedInt(qs(q.centralityLimit), 20, 1, 500);
        const recentLimit = boundedInt(qs(q.recentLimit), 10, 1, 500);
        const map = await SymbolGraphService.getInstance().getProjectMap(projectId, { centralityLimit, recentLimit });
        if (!map) return { success: false, error: `Workspace '${projectId}' not found` };
        return { success: true, data: map };
      }

      // Match /api/v1/project/:id/architecture
      const archMatch = endpoint.match(/^\/api\/v1\/project\/([^/]+)\/architecture$/);
      if (archMatch) {
        const projectId = archMatch[1]!;
        const q = queryParams ?? {};
        return await getArchitectureTool().handle({
          projectId,
          aspects: typeof q.aspects === "string" ? q.aspects.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
          centralityLimit: boundedInt(qs(q.centralityLimit), 20, 1, 500),
          format: (qs(q.format) ?? "json") as "json" | "toon",
          fields: typeof q.fields === "string" ? q.fields.split(",").map((s) => s.trim()).filter(Boolean) : undefined,
        });
      }

      // Match /api/v1/project/index/status/:jobId
      const statusMatch = endpoint.match(/^\/api\/v1\/project\/index\/status\/([^/]+)$/);
      if (statusMatch) {
        return await indexStatusTool().handle({ jobId: statusMatch[1]! });
      }

      // Match /api/v1/workspace/list
      if (endpoint === "/api/v1/workspace/list") {
        return await listProjectsTool().handle({ status: qs(queryParams?.status) ?? "all" });
      }

      // Match /api/v1/synapse/sessions
      if (endpoint === "/api/v1/synapse/sessions") {
        const registry = getSessionRegistry();
        registry.evictExpired();
        return { success: true, data: { activeCount: registry.size() } };
      }

      // Match /api/v1/analytics (analytics is POST in REST, but handle GET gracefully)
      if (endpoint === "/api/v1/analytics" || endpoint === "/api/v1/analytics/") {
        return await analyticsTool().handle(queryParams ?? {});
      }

      return httpError(404, `EmbeddedApiClient: no GET handler for ${endpoint}`);
    } catch (error) {
      if (error instanceof ApiHttpError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw httpError(500, msg);
    }
  }

  /** POST request — maps to core tool/controller/service calls by endpoint. */
  async post(endpoint: string, body: unknown): Promise<unknown> {
    try {
      switch (endpoint) {
        case "/api/v1/project/index":
          return await indexProjectTool().handle(body);

        case "/api/v1/project/reset":
          return await this.handleProjectReset(body as Record<string, unknown>);

        case "/api/v1/project/rename":
          return await this.handleProjectIdentity("rename", body as Record<string, unknown>);

        case "/api/v1/project/merge":
          return await this.handleProjectIdentity("merge", body as Record<string, unknown>);

        case "/api/v1/search/project":
          return await searchProjectTool().handle(body);

        case "/api/v1/search/code":
          return await searchCodeTool().handle(body);

        case "/api/v1/memory/store":
          return await storeMemoryTool().handle(body);

        case "/api/v1/memory/search":
          return await searchMemoriesTool().handle(body);

        case "/api/v1/memory/update":
          return await updateMemoryTool().handle(body);

        case "/api/v1/memory/delete":
          return await deleteMemoryTool().handle(body);

        case "/api/v1/memory/list":
          return await this.handleMemoryList(body as Record<string, unknown>);

        case "/api/v1/checkpoints/list":
          return await listCheckpointsTool().handle(body);

        case "/api/v1/checkpoints/create":
          return await createCheckpointTool().handle(body);

        case "/api/v1/checkpoints/restore":
          return await restoreCheckpointTool().handle(body);

        case "/api/v1/context/compress":
          return await compressContextTool().handle(body);

        case "/api/v1/context/optimized":
          return await optimizedContextTool().handle(body);

        case "/api/v1/analytics":
        case "/api/v1/analytics/":
          return await analyticsTool().handle(body);

        case "/api/v1/symbol/impact":
          return await impactAnalysisTool().handle(body);

        case "/api/v1/file/read":
          return await readFileTool().handle(body);

        case "/api/v1/executor/execute":
          return await ExecutorController.getInstance().execute(body as any);

        case "/api/v1/executor/execute_file":
          return await ExecutorController.getInstance().executeFile(body as any);

        case "/api/v1/executor/batch_execute":
          return await ExecutorController.getInstance().batchExecute(body as any);

        case "/api/v1/web/fetch_and_index":
          return await (await fetchAndIndexTool()).handle(body);

        case "/api/v1/hook/batch":
          return await this.handleHookBatch(body as { events: unknown[] });

        case "/api/v1/hook/compact-snapshot":
          return await compactSnapshotTool().handle(body);

        case "/api/v1/bootstrap":
          return await this.handleBootstrap(body as Record<string, unknown>);

        case "/api/v1/handoff/begin":
          return await this.handleHandoffBegin(body as Record<string, unknown>);

        case "/api/v1/handoff/accept":
          return await this.handleHandoffAccept(body as Record<string, unknown>);

        case "/api/v1/handoff/cancel":
          return await this.handleHandoffCancel(body as Record<string, unknown>);

        case "/api/v1/handoff/list":
          return await this.handleHandoffList(body as Record<string, unknown>);

        case "/api/v1/proposal/list":
          return await this.handleProposalList(body as Record<string, unknown>);

        case "/api/v1/proposal/approve":
          return await this.handleProposalApprove(body as Record<string, unknown>);

        case "/api/v1/proposal/reject":
          return await this.handleProposalReject(body as Record<string, unknown>);

        case "/api/v1/synapse/session":
          return await this.handleSynapseSession(body as Record<string, unknown>);

        case "/api/v1/synapse/sessions":
          // POST to /sessions is not defined in REST; fall through to 404
          break;

        default:
          // Parametric POST endpoints handled below
          break;
      }

      // Match /api/v1/synapse/session/:id/prime
      const primeMatch = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)\/prime$/);
      if (primeMatch) {
        return await this.handleSynapsePrime(primeMatch[1]!, body as Record<string, unknown>);
      }

      // Match /api/v1/synapse/session/:id/access
      const accessMatch = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)\/access$/);
      if (accessMatch) {
        return await this.handleSynapseAccess(accessMatch[1]!, body as Record<string, unknown>);
      }

      // Match /api/v1/synapse/session/:id/prefetch
      const prefetchMatch = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)\/prefetch$/);
      if (prefetchMatch) {
        return await this.handleSynapsePrefetch(prefetchMatch[1]!, body as Record<string, unknown>);
      }

      // Match /api/v1/synapse/task/begin
      if (endpoint === "/api/v1/synapse/task/begin") {
        return await this.handleSynapseTaskBegin(body as Record<string, unknown>);
      }

      // Match /api/v1/synapse/task/:id/end
      const taskEndMatch = endpoint.match(/^\/api\/v1\/synapse\/task\/([^/]+)\/end$/);
      if (taskEndMatch) {
        const service = new TaskEnvelopeService();
        const result = service.end(taskEndMatch[1]!);
        if (!result) return { success: false, error: "Session not found or already ended" };
        return { success: true, data: result };
      }

      // Match /api/v1/workspace/:id/reindex
      const reindexMatch = endpoint.match(/^\/api\/v1\/workspace\/([^/]+)\/reindex$/);
      if (reindexMatch) {
        const b = body as { projectPath: string };
        return await indexProjectTool().handle({
          projectId: reindexMatch[1]!,
          projectPath: b.projectPath,
          forceReindex: true,
        });
      }

      return httpError(404, `EmbeddedApiClient: no POST handler for ${endpoint}`);
    } catch (error) {
      if (error instanceof ApiHttpError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw httpError(500, msg);
    }
  }

  /** PATCH request — maps to core service calls by endpoint. */
  async patch(endpoint: string, body: unknown): Promise<unknown> {
    try {
      // Match /api/v1/synapse/session/:id
      const match = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)$/);
      if (match) {
        const id = match[1]!;
        const b = body as { taskContext: string; taskEmbedding?: number[] };
        const registry = getSessionRegistry();
        await registry.ensureReady();
        const updated = registry.updateTaskContext(id, b.taskContext, b.taskEmbedding);
        if (!updated) return { success: false, error: "Session not found or expired" };
        return { success: true, data: serializeSession(updated) };
      }
      return httpError(404, `EmbeddedApiClient: no PATCH handler for ${endpoint}`);
    } catch (error) {
      if (error instanceof ApiHttpError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw httpError(500, msg);
    }
  }

  /** DELETE request — maps to core service calls by endpoint. */
  async delete(endpoint: string, _body?: unknown): Promise<unknown> {
    try {
      // Match /api/v1/synapse/session/:id
      const match = endpoint.match(/^\/api\/v1\/synapse\/session\/([^/]+)$/);
      if (match) {
        const removed = getSessionRegistry().delete(match[1]!);
        return { success: removed };
      }
      // Match /api/v1/workspace/:id
      const wsMatch = endpoint.match(/^\/api\/v1\/workspace\/([^/]+)$/);
      if (wsMatch) {
        await workspaceManager.removeWorkspace(wsMatch[1]!);
        return { success: true, data: { removed: wsMatch[1]! } };
      }
      return httpError(404, `EmbeddedApiClient: no DELETE handler for ${endpoint}`);
    } catch (error) {
      if (error instanceof ApiHttpError) throw error;
      const msg = error instanceof Error ? error.message : String(error);
      throw httpError(500, msg);
    }
  }

  // ── uploadAndIndex (NOT on ToolProxyApiClient — called directly by McpProxyServer) ──

  /**
   * In-process file indexing with the same path-safety validation as the HTTP
   * upload route (`project.ts:351-356`). Files are written to a staging dir,
   * then IndexProjectTool handles indexing.
   */
  async uploadAndIndex(params: {
    projectPath: string;
    projectId?: string;
    forceReindex?: boolean;
    warmCache?: boolean;
    warmupQueries?: string[];
    files: Array<{ relativePath: string; content: string }>;
  }): Promise<unknown> {
    const rawBase = params.projectId ||
      params.projectPath.replace(/\\/g, "/").split("/").filter(Boolean).pop() ||
      "default";
    const finalProjectId = rawBase.replace(/[^a-zA-Z0-9_.-]/g, "_").slice(0, 128);

    const uploadRoot = process.env.MASSA_TH0TH_UPLOAD_DIR || path.join(getGlobalDataDir(), "uploads");
    const stagingDir = path.resolve(uploadRoot, finalProjectId);

    await fs.rm(stagingDir, { recursive: true, force: true });
    await fs.mkdir(stagingDir, { recursive: true });

    const WRITE_BATCH = 20;
    for (let i = 0; i < params.files.length; i += WRITE_BATCH) {
      await Promise.all(
        params.files.slice(i, i + WRITE_BATCH).map(async (file) => {
          // Reject absolute paths and traversal sequences (same as project.ts:351-356)
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

    return await indexProjectTool().handle({
      projectPath: stagingDir,
      projectId: finalProjectId,
      forceReindex: params.forceReindex,
      warmCache: params.warmCache,
      warmupQueries: params.warmupQueries,
    });
  }

  // ── healthCheck (NOT on ToolProxyApiClient — called directly by McpProxyServer) ──

  async healthCheck(): Promise<boolean> {
    // Embedded mode is always "healthy" — core services are in-process.
    return true;
  }

  // ── Private handlers for complex endpoints ─────────────────────────────────

  private async handleMemoryList(body: Record<string, unknown>): Promise<unknown> {
    try {
      const repo = getMemoryRepository() as any;
      const limit = (body.limit as number) ?? 50;
      const offset = (body.offset as number) ?? 0;
      const all = await repo.search({
        types: body.type ? [body.type as string] : undefined,
        minImportance: (body.minImportance as number) ?? 0,
        projectId: body.projectId as string | undefined,
        userId: body.userId as string | undefined,
        sessionId: body.sessionId as string | undefined,
        agentId: body.agentId as string | undefined,
        includePersistent: true,
        limit: 10000,
      });
      const filtered =
        body.level !== undefined && body.level !== null
          ? all.filter((r: any) => r.level === body.level)
          : all;
      const total = filtered.length;
      const rows = filtered.slice(offset, offset + limit);
      return { success: true, data: { memories: rows, total, limit, offset } };
    } catch (error) {
      logger.error("Failed to list memories (embedded)", error as Error);
      return { success: false, error: `Failed to list memories: ${(error as Error).message}` };
    }
  }

  private async handleProjectReset(body: Record<string, unknown>): Promise<unknown> {
    const { projectId, clearVectors = true, clearSymbols = true, clearMemories = true } = body as {
      projectId: string;
      clearVectors?: boolean;
      clearSymbols?: boolean;
      clearMemories?: boolean;
    };
    if (!projectId) return { success: false, error: "projectId is required" };

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
        result.keywordsDeleted = keywordsDeleted;
      } catch (e) {
        errors.push(`vectors: ${(e as Error).message}`);
      }
    }
    if (clearSymbols) {
      try {
        await workspaceManager.removeWorkspace(projectId);
        result.symbolsDeleted = "ok";
      } catch (e) {
        errors.push(`symbols: ${(e as Error).message}`);
      }
    }
    if (clearMemories) {
      try {
        const repo = getMemoryRepository() as any;
        const deleted = await repo.deleteByProject(projectId);
        result.memoriesDeleted = deleted;
      } catch (e) {
        errors.push(`memories: ${(e as Error).message}`);
      }
    }

    return {
      success: errors.length === 0,
      data: { projectId, ...result, errors, message: `Project '${projectId}' reset complete.` },
    };
  }

  private async handleProjectIdentity(
    mode: "rename" | "merge",
    body: Record<string, unknown>,
  ): Promise<unknown> {
    const { createProjectIdentityService, ProjectIdentityError } = await import("@massa-th0th/core");
    const service = createProjectIdentityService();
    const dryRun = body.dryRun !== false;
    try {
      if (dryRun) {
        const preview = await service.preview({
          mode,
          sourceProjectId: body.sourceProjectId as string,
          targetProjectId: body.targetProjectId as string,
          dryRun: true,
        });
        return { success: true, data: preview };
      }
      const result = await service.apply({
        mode,
        sourceProjectId: body.sourceProjectId as string,
        targetProjectId: body.targetProjectId as string,
        dryRun: false,
        operationId: body.operationId as string,
        expectedPlanHash: body.expectedPlanHash as string,
      });
      return { success: true, data: result };
    } catch (error) {
      if (error instanceof ProjectIdentityError) {
        throw httpError(error.statusCode, error.message);
      }
      throw error;
    }
  }

  private async handleHookBatch(body: { events: unknown[] }): Promise<unknown> {
    const service = getHookService();
    try {
      const ids = await service.ingestBatch(body.events as any[]);
      return { status: 202, ids };
    } catch (e: any) {
      const { QueueSaturatedError, ValidationError } = await import("@massa-th0th/core");
      if (e instanceof QueueSaturatedError) {
        throw httpError(429, "writer queue saturated");
      }
      if (e instanceof ValidationError) {
        throw httpError(e.code, e.message);
      }
      throw httpError(500, `hook service unavailable: ${e.message}`);
    }
  }

  private async handleBootstrap(body: Record<string, unknown>): Promise<unknown> {
    const { projectId, projectPath, force } = body as {
      projectId: string;
      projectPath?: string;
      force?: boolean;
    };
    if (!projectId || !String(projectId).trim()) {
      throw httpError(400, "projectId required");
    }
    try {
      const result = await getBootstrapService().bootstrap(projectId, {
        projectPath,
        force: force === true,
      });
      return { success: true, data: result };
    } catch (e) {
      throw httpError(500, `bootstrap failed: ${(e as Error).message}`);
    }
  }

  private async handleHandoffBegin(body: Record<string, unknown>): Promise<unknown> {
    const { projectId } = body as { projectId?: string };
    if (!projectId || !String(projectId).trim()) {
      throw httpError(400, "projectId required");
    }
    try {
      const result = await getHandoffService().begin({
        projectId,
        sourceSessionId: body.sourceSessionId as string | undefined,
        targetAgent: body.targetAgent as string | undefined,
        summary: body.summary as string | undefined,
        openQuestions: body.openQuestions as string[] | undefined,
        nextSteps: body.nextSteps as string[] | undefined,
        files: body.files as string[] | undefined,
      });
      return { success: result.ok, data: result };
    } catch (e) {
      throw httpError(500, `handoff begin failed: ${(e as Error).message}`);
    }
  }

  private async handleHandoffAccept(body: Record<string, unknown>): Promise<unknown> {
    const { id } = body as { id?: string };
    if (!id || !String(id).trim()) {
      throw httpError(400, "id required");
    }
    try {
      const result = await getHandoffService().accept({ id, projectId: body.projectId as string | undefined });
      return { success: result.ok, data: result };
    } catch (e) {
      throw httpError(500, `handoff accept failed: ${(e as Error).message}`);
    }
  }

  private async handleHandoffCancel(body: Record<string, unknown>): Promise<unknown> {
    const { id } = body as { id?: string };
    if (!id || !String(id).trim()) {
      throw httpError(400, "id required");
    }
    try {
      const result = await getHandoffService().cancel({ id, projectId: body.projectId as string | undefined });
      return { success: result.ok, data: result };
    } catch (e) {
      throw httpError(500, `handoff cancel failed: ${(e as Error).message}`);
    }
  }

  private async handleHandoffList(body: Record<string, unknown>): Promise<unknown> {
    const { projectId } = body as { projectId?: string };
    if (!projectId || !String(projectId).trim()) {
      throw httpError(400, "projectId required");
    }
    try {
      const pending = await getHandoffService().listPending(projectId, body.targetAgent as string | undefined);
      return { success: true, data: { pending, count: pending.length } };
    } catch (e) {
      throw httpError(500, `handoff list failed: ${(e as Error).message}`);
    }
  }

  private async handleProposalList(body: Record<string, unknown>): Promise<unknown> {
    const { projectId } = body as { projectId?: string };
    if (!projectId || !String(projectId).trim()) {
      throw httpError(400, "projectId required");
    }
    try {
      const pending = await getAutoImproveJob().listPending(projectId);
      return { success: true, data: { pending, count: pending.length } };
    } catch (e) {
      throw httpError(500, `proposal list failed: ${(e as Error).message}`);
    }
  }

  private async handleProposalApprove(body: Record<string, unknown>): Promise<unknown> {
    const { id } = body as { id?: string };
    if (!id || !String(id).trim()) {
      throw httpError(400, "id required");
    }
    try {
      const result = await getAutoImproveJob().approve(id, body.projectId as string | undefined, (body.source as "llm" | "rule-based") ?? "rule-based");
      return { success: result.ok, data: result };
    } catch (e) {
      throw httpError(500, `proposal approve failed: ${(e as Error).message}`);
    }
  }

  private async handleProposalReject(body: Record<string, unknown>): Promise<unknown> {
    const { id } = body as { id?: string };
    if (!id || !String(id).trim()) {
      throw httpError(400, "id required");
    }
    try {
      const result = await getAutoImproveJob().reject(id, body.projectId as string | undefined, body.reason as string | undefined);
      return { success: result.ok, data: result };
    } catch (e) {
      throw httpError(500, `proposal reject failed: ${(e as Error).message}`);
    }
  }

  private async handleSynapseSession(body: Record<string, unknown>): Promise<unknown> {
    const registry = getSessionRegistry();
    const sessionId = (body.sessionId as string) ?? `syn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    const session = registry.create({
      sessionId,
      agentId: body.agentId as string,
      workspaceId: body.workspaceId as string | undefined,
      taskContext: body.taskContext as string | undefined,
      ttlMs: body.ttlMs as number | undefined,
      bufferConfig: body.enableBuffer
        ? {
            ...DEFAULT_BUFFER_CONFIG,
            maxSize: (body.bufferMaxSize as number) ?? DEFAULT_BUFFER_CONFIG.maxSize,
            ttlMs: (body.bufferTtlMs as number) ?? DEFAULT_BUFFER_CONFIG.ttlMs,
          }
        : undefined,
      accessHistoryMaxEntries: body.accessHistoryMaxEntries as number | undefined,
    });
    return { success: true, data: serializeSession(session) };
  }

  private async handleSynapsePrime(id: string, body: Record<string, unknown>): Promise<unknown> {
    const registry = getSessionRegistry();
    await registry.ensureReady();
    const session = registry.get(id);
    if (!session) return { success: false, error: "Session not found or expired" };
    if (!session.buffer) return { success: false, error: "Session has no working-memory buffer" };
    const entries = (body.entries as any[]).map((e) => ({
      id: e.id,
      content: e.content,
      score: e.score ?? 0.7,
      source: SearchSource.VECTOR,
      metadata: (e.metadata ?? {}) as any,
    }));
    session.buffer.prime(entries);
    return { success: true, data: { primed: entries.length, bufferSize: session.buffer.size() } };
  }

  private async handleSynapseAccess(id: string, body: Record<string, unknown>): Promise<unknown> {
    const registry = getSessionRegistry();
    await registry.ensureReady();
    registry.recordAccess(id, body.memoryId as string);
    const session = registry.get(id);
    return {
      success: !!session,
      data: session ? { accessHistorySize: session.accessHistory.size } : { error: "Session not found or expired" },
    };
  }

  private async handleSynapsePrefetch(id: string, body: Record<string, unknown>): Promise<unknown> {
    const registry = getSessionRegistry();
    await registry.ensureReady();
    const session = registry.get(id);
    if (!session) return { success: false, error: "Session not found or expired" };
    if (!session.buffer) return { success: false, error: "Session has no working-memory buffer" };

    const config = {
      ...DEFAULT_PREFETCH_CONFIG,
      enabled: true,
      ...(body.chains ? { chains: body.chains as string[] } : {}),
      ...(body.maxResults != null ? { maxResults: body.maxResults as number } : {}),
      ...(body.minImportance != null ? { minImportance: body.minImportance as number } : {}),
    };

    const plan = buildPrefetchPlan(
      { filePath: body.filePath as string, symbols: body.symbols as { name: string }[] | undefined },
      config,
    );
    if (!plan.enabled) {
      return { success: true, data: { enabled: false, query: plan.query, primed: 0, reason: "no-topics" } };
    }

    const entries: PrefetchEntry[] = (body.entries as any[]) ?? [];
    if (entries.length === 0) {
      return {
        success: true,
        data: { enabled: true, query: plan.query, chains: plan.chains, maxResults: plan.maxResults, primed: 0, note: "No entries provided." },
      };
    }

    const results = entries.map((e) => ({
      id: e.id,
      content: e.content,
      score: e.score ?? 0.7,
      source: SearchSource.VECTOR,
      metadata: (e.metadata ?? {}) as any,
    }));
    session.buffer.prime(results);
    return { success: true, data: { enabled: true, query: plan.query, primed: results.length, bufferSize: session.buffer.size() } };
  }

  private async handleSynapseTaskBegin(body: Record<string, unknown>): Promise<unknown> {
    const service = new TaskEnvelopeService();
    const result = await service.begin({
      agentId: body.agentId as string,
      taskContext: body.taskContext as string | undefined,
      workspaceId: body.workspaceId as string | undefined,
      query: body.query as string,
      projectId: body.projectId as string,
      entries: body.entries as any[] | undefined,
      limit: body.limit as number | undefined,
    });
    return { success: true, data: result };
  }
}