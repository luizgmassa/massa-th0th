/**
 * List Projects Tool (list_projects)
 *
 * Lists all indexed workspaces with their status and statistics.
 * Data sourced from WorkspaceManager (PostgreSQL workspaces table).
 */

import { IToolHandler, ToolResponse } from "@massa-ai/shared";
import { workspaceManager } from "../services/workspace/workspace-manager.js";
import type { WorkspaceStatus } from "../services/workspace/workspace-manager.js";
import { validateEnum } from "./enum-validation.js";

interface ListProjectsParams {
  status?: WorkspaceStatus | "all";
}

export class ListProjectsTool implements IToolHandler {
  name = "list_projects";
  description =
    "List all indexed projects with their status (pending/indexing/indexed/error), file counts, symbol counts, and last indexed time.";

  inputSchema = {
    type: "object",
    properties: {
      status: {
        type: "string",
        enum: ["pending", "indexing", "indexed", "error", "all"],
        description: "Filter by workspace status. Defaults to 'all'.",
        default: "all",
      },
    },
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const status = validateEnum<WorkspaceStatus | "all">(
      "status",
      ((params ?? {}) as ListProjectsParams).status ?? "all",
      ["pending", "indexing", "indexed", "error", "all"] as const,
    );

    try {
      const workspaces = await workspaceManager.listWorkspaces(status);

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
            createdAt: new Date(w.created_at).toISOString(),
            updatedAt: new Date(w.updated_at).toISOString(),
          })),
          total: workspaces.length,
          filter: status,
        },
      };
    } catch (error) {
      return {
        success: false,
        error: `Failed to list projects: ${(error as Error).message}`,
      };
    }
  }
}
