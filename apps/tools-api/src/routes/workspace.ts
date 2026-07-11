/**
 * Workspace Routes
 *
 * GET    /api/v1/workspace/list            ← list all workspaces (list_projects)
 * GET    /api/v1/workspace/:id             ← get single workspace details
 * DELETE /api/v1/workspace/:id             ← remove workspace + symbol data
 * POST   /api/v1/workspace/:id/reindex     ← force reindex
 *
 * GET    /api/v1/symbol/definitions        ← search_definitions
 * GET    /api/v1/symbol/references         ← get_references
 * GET    /api/v1/symbol/definition         ← go_to_definition
 */

import {
  IndexProjectTool,
  GraphController,
  symbolGraphService,
  workspaceManager,
} from "@massa-th0th/core";
import { Elysia, t } from "elysia";
import fs from "fs/promises";
import path from "path";
import { realpathSync } from "fs";

let indexProjectTool: IndexProjectTool | null = null;

function getIndexProjectTool(): IndexProjectTool {
  if (!indexProjectTool) {
    indexProjectTool = new IndexProjectTool();
  }
  return indexProjectTool;
}

/**
 * Parse a query-string numeric into a bounded integer. Non-numeric / out-of-
 * range values fall back to `def` (never NaN), so a bad `?depth=abc` can't
 * silently defeat a depth/limit bound. `min`/`max` are inclusive.
 */
function boundedInt(
  raw: string | string[] | undefined,
  def: number,
  min: number,
  max: number,
): number {
  if (raw == null) return def;
  const s = Array.isArray(raw) ? raw[0] : raw;
  if (s == null || s === "") return def;
  const n = Number(s);
  if (!Number.isFinite(n)) return def;
  const i = Math.trunc(n);
  return Math.max(min, Math.min(max, i));
}

/**
 * Resolve a path to its canonical realpath, falling back to the lexical
 * absolute path if the target doesn't exist (so the boundary check still
 * compares consistent forms, and a missing path produces a clear downstream
 * error rather than a spurious "blocked").
 */
function realpathSafe(p: string): string {
  try {
    return realpathSync(p);
  } catch {
    return path.resolve(p);
  }
}

let graphController: GraphController | null = null;
function getGraphController(): GraphController {
  if (!graphController) graphController = GraphController.getInstance();
  return graphController;
}

export const workspaceRoutes = new Elysia({ prefix: "/api/v1" })
  // ── Workspace management ──────────────────────────────────────────────────

  .get(
    "/workspace/list",
    async ({ query }) => {
      try {
        const status = (query.status as string) || "all";
        const workspaces = await workspaceManager.listWorkspaces(
          status as "all",
        );
        return {
          success: true,
          data: {
            workspaces: workspaces.map((w) => ({
              projectId: w.project_id,
              projectPath: w.project_path,
              displayName: w.display_name,
              status: w.status,
              lastIndexedAt: w.last_indexed_at
                ? new Date(w.last_indexed_at).toISOString()
                : null,
              lastError: w.last_error,
              filesCount: w.files_count,
              chunksCount: w.chunks_count,
              symbolsCount: w.symbols_count,
            })),
            total: workspaces.length,
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["workspace"],
        summary: "List all indexed workspaces",
        description:
          "Returns all registered projects with their indexing status and statistics.",
      },
    },
  )

  .get(
    "/workspace/:id",
    async ({ params }) => {
      try {
        const workspace = await workspaceManager.getWorkspace(params.id);
        if (!workspace) {
          return {
            success: false,
            error: `Workspace '${params.id}' not found`,
          };
        }
        return { success: true, data: workspace };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: { tags: ["workspace"], summary: "Get workspace details" },
    },
  )

  .delete(
    "/workspace/:id",
    async ({ params }) => {
      try {
        await workspaceManager.removeWorkspace(params.id);
        return { success: true, data: { removed: params.id } };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["workspace"],
        summary: "Remove workspace and all symbol data",
      },
    },
  )

  .post(
    "/workspace/:id/reindex",
    async ({ params, body }) => {
      try {
        const { projectPath } = body as { projectPath: string };
        return await getIndexProjectTool().handle({
          projectId: params.id,
          projectPath,
          forceReindex: true,
        });
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      body: t.Object({
        projectPath: t.String({
          description: "Absolute path to project directory",
        }),
      }),
      detail: {
        tags: ["workspace"],
        summary: "Force reindex a workspace",
      },
    },
  )

  // ── Symbol graph ──────────────────────────────────────────────────────────

  .get(
    "/symbol/definitions",
    async ({ query }) => {
      try {
        const {
          projectId,
          search,
          kind,
          file,
          exportedOnly,
          limit = "20",
        } = query as Record<string, string>;

        if (!projectId)
          return { success: false, error: "projectId is required" };

        const defs = await symbolGraphService.listDefinitions(projectId, {
          search,
          kind: kind ? kind.split(",") : undefined,
          file,
          exportedOnly: exportedOnly === "true",
          limit: boundedInt(limit, 20, 1, 500),
        });

        return {
          success: true,
          data: { definitions: defs, total: defs.length },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Search symbol definitions",
        description:
          "Browse functions, classes, variables, types, and interfaces. Params: projectId, search (name), kind (comma-separated), file, exportedOnly, limit.",
      },
    },
  )

  .get(
    "/symbol/references",
    async ({ query }) => {
      try {
        const {
          projectId,
          symbolName,
          fqn,
          limit = "50",
        } = query as Record<string, string>;

        if (!projectId)
          return { success: false, error: "projectId is required" };
        if (!symbolName)
          return { success: false, error: "symbolName is required" };

        const refs = await symbolGraphService.getReferences(
          projectId,
          symbolName,
          fqn,
        );
        const limited = refs.slice(0, boundedInt(limit, 50, 1, 1000));

        return {
          success: true,
          data: {
            references: limited,
            total: refs.length,
            shown: limited.length,
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Get all references to a symbol",
      },
    },
  )

  .get(
    "/symbol/definition",
    async ({ query }) => {
      try {
        const { projectId, symbolName, fromFile } = query as Record<
          string,
          string
        >;

        if (!projectId)
          return { success: false, error: "projectId is required" };
        if (!symbolName)
          return { success: false, error: "symbolName is required" };

        const defs = await symbolGraphService.goToDefinition(
          projectId,
          symbolName,
          fromFile,
        );

        return {
          success: true,
          data: {
            found: defs.length > 0,
            symbolName,
            definitions: defs,
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Go to definition of a symbol",
      },
    },
  )

  .get(
    "/symbol/trace",
    async ({ query }) => {
      try {
        const {
          projectId,
          function_name,
          symbol,
          qualifiedName,
          direction,
          mode,
          depth,
          include_tests,
          edge_types,
        } = query as Record<string, string | string[] | undefined>;

        if (!projectId)
          return { success: false, error: "projectId is required" };
        const seed = (function_name ?? symbol ?? qualifiedName) as
          | string
          | undefined;
        if (!seed)
          return {
            success: false,
            error: "function_name (or symbol/qualifiedName) is required",
          };

        const result = await getGraphController().tracePath({
          projectId,
          function_name: function_name as string | undefined,
          symbol: symbol as string | undefined,
          qualifiedName: qualifiedName as string | undefined,
          direction: direction as
            | "outbound"
            | "inbound"
            | "both"
            | undefined,
          mode: mode as
            | "calls"
            | "data_flow"
            | "cross_service"
            | "all"
            | undefined,
          // Coerce + bound depth so a non-numeric `?depth=abc` can't become NaN
          // and defeat the service's MAX_DEPTH (6) BFS bound. Default 3, [1,6].
          depth: boundedInt(depth, 3, 1, 6),
          include_tests:
            include_tests === undefined ? undefined : include_tests === "true",
          edge_types: edge_types
            ? (Array.isArray(edge_types) ? edge_types : (edge_types as string).split(","))
                .filter(Boolean)
                .map((t) => t.trim())
            : undefined,
        });

        if (!result.found) {
          return {
            success: false,
            error: `Symbol '${result.symbol}' not found in project '${result.projectId}'.`,
            data: { hint: result.hint },
          };
        }

        return { success: true, data: result.result };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Trace path — BFS over typed edges (callers/callees/data-flow/cross-service)",
        description:
          "Traverse the code graph from a seed symbol following typed edges (CALLS/DATA_FLOWS/HTTP_CALLS/EMITS/LISTENS). " +
          "Params: projectId, function_name (or symbol/qualifiedName), direction (outbound|inbound|both, default outbound), " +
          "mode (calls|data_flow|cross_service|all, default calls), depth (default 3, max 6), include_tests (default false), " +
          "edge_types (comma-separated override).",
      },
    },
  )

  .post(
    "/symbol/impact",
    async ({ body }) => {
      try {
        const {
          projectId,
          projectPath,
          scope,
          base_branch,
          since,
          depth,
          paths,
        } = body as Record<string, unknown> as {
          projectId: string;
          projectPath: string;
          scope?: string;
          base_branch?: string;
          since?: string;
          depth?: number;
          paths?: string[];
        };

        if (!projectId)
          return { success: false, error: "projectId is required" };
        if (!projectPath)
          return {
            success: false,
            error:
              "projectPath is required (absolute path to the working tree where git runs).",
          };

        // Boundary: the caller-supplied projectPath must match (or be within)
        // the workspace's registered project_path. This prevents a caller from
        // pointing `git -C` at an arbitrary directory via the impact route.
        // Both paths are realpath-resolved so symlinks can't bypass the check.
        const workspace = await workspaceManager.getWorkspace(projectId);
        if (!workspace) {
          return { success: false, error: `Workspace '${projectId}' not found` };
        }
        const registeredRoot = realpathSafe(workspace.project_path);
        const callerRoot = realpathSafe(projectPath);
        const rel = path.relative(registeredRoot, callerRoot);
        const escapes = rel.startsWith("..") || path.isAbsolute(rel);
        if (registeredRoot !== callerRoot && escapes) {
          return {
            success: false,
            error:
              `projectPath "${projectPath}" is outside the registered workspace root ` +
              `"${workspace.project_path}". Impact analysis is restricted to the workspace tree.`,
          };
        }

        const result = await getGraphController().analyzeImpact({
          projectId,
          projectPath,
          scope: (scope as "unstaged" | "staged" | "committed" | undefined) ?? "unstaged",
          base_branch,
          since,
          depth,
          paths,
        });

        return { success: true, data: result };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      body: t.Object({
        projectId: t.String({ description: "The project ID to analyze" }),
        projectPath: t.String({
          description: "Absolute path to the project working tree (where git runs)",
        }),
        scope: t.Optional(
          t.Union(
            [t.Literal("unstaged"), t.Literal("staged"), t.Literal("committed")],
            { description: "unstaged (default) | staged | committed" },
          ),
        ),
        base_branch: t.Optional(
          t.String({ description: "For committed scope: diff vs this branch (default main)" }),
        ),
        since: t.Optional(
          t.String({ description: "For committed scope: commits since this ref/date (wins over base_branch)" }),
        ),
        depth: t.Optional(
          t.Number({ description: "Propagation depth through reverse import graph (default 2, max 4)" }),
        ),
        paths: t.Optional(
          t.Array(t.String(), { description: "Optional filter — only these changed relative paths" }),
        ),
      }),
      detail: {
        tags: ["symbol"],
        summary: "Impact analysis — git diff → impacted symbols ranked by centrality risk",
        description:
          "Runs a scoped git diff, maps changed files → symbols, then reverse-traverses importers + references to find impacted consumers, ranked by PageRank centrality + proximity. " +
          "Params: projectId, projectPath, scope (unstaged|staged|committed), base_branch/since (committed), depth (default 2), paths (filter).",
      },
    },
  )

  .get(
    "/workspace/:id/map",
    async ({ params, query }) => {
      try {
        const projectId = params.id;
        const centralityLimit = boundedInt(query.centralityLimit as string | undefined, 20, 1, 500);
        const recentLimit = boundedInt(query.recentLimit as string | undefined, 10, 1, 500);

        const map = await symbolGraphService.getProjectMap(projectId, {
          centralityLimit,
          recentLimit,
        });

        if (!map) {
          return { success: false, error: `Workspace '${projectId}' not found` };
        }

        return { success: true, data: map };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["workspace"],
        summary: "Project map — aggregate view of an indexed workspace",
        description:
          "Returns stats, top central files (PageRank), symbols grouped by kind, files grouped by extension, and recently indexed files. Query params: centralityLimit (default 20), recentLimit (default 10).",
      },
    },
  )

  .get(
    "/symbol/centrality/:projectId",
    async ({ params, query }) => {
      try {
        const projectId = params.projectId;
        if (!projectId) {
          return { success: false, error: "projectId is required" };
        }

        const limit = boundedInt(query.limit as string | undefined, 20, 1, 500);
        const files = await symbolGraphService.getTopCentralFiles(
          projectId,
          limit,
        );

        return {
          success: true,
          data: {
            projectId,
            files,
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Get top central files",
        description:
          "Returns files ranked by PageRank centrality for a project",
      },
    },
  )

  .get(
    "/symbol/snippet",
    async ({ query }) => {
      try {
        const {
          projectId,
          file,
          lineStart = "1",
          lineEnd,
        } = query as Record<string, string>;

        if (!projectId)
          return { success: false, error: "projectId is required" };
        if (!file) return { success: false, error: "file is required" };

        const workspace = await workspaceManager.getWorkspace(projectId);
        if (!workspace) {
          return {
            success: false,
            error: `Workspace '${projectId}' not found`,
          };
        }

        const start = boundedInt(lineStart, 1, 1, 1_000_000);
        const end = lineEnd
          ? boundedInt(lineEnd, start + 20, start, start + 10_000)
          : start + 20;
        const absolutePath = path.join(workspace.project_path, file);
        const content = await fs.readFile(absolutePath, "utf-8");
        const lines = content.split(/\r?\n/);
        const slice = lines.slice(start - 1, Math.min(lines.length, end));

        const formatted = slice.map((text, idx) => ({
          lineNumber: start + idx,
          content: text,
        }));

        return {
          success: true,
          data: {
            file,
            projectId,
            startLine: start,
            endLine: start + slice.length - 1,
            lines: formatted,
          },
        };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    },
    {
      detail: {
        tags: ["symbol"],
        summary: "Get file snippet",
        description:
          "Returns code lines for the specified file and line range in a workspace",
      },
    },
  );
