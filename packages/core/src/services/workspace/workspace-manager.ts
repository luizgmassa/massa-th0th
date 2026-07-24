/**
 * Workspace Manager
 *
 * Single source of truth for project registration and indexing status.
 * Persists all state to the `workspaces` table in the symbol PostgreSQL DB
 * (replacing the zero-embedding _metadata docs in the vector store).
 *
 * Subscribes to EventBus to auto-update status on indexing lifecycle events.
 */

import { logger } from "@massa-ai/shared";
import { getSymbolRepository } from "../../data/symbol/symbol-repository-factory.js";
import type { WorkspaceRow, WorkspaceStatus } from "../../data/symbol/symbol-repository-pg.js";
import { eventBus } from "../events/event-bus.js";
import { symbolGraphService } from "../symbol/symbol-graph.service.js";

export type { WorkspaceRow, WorkspaceStatus };

export class WorkspaceManager {
  private static instance: WorkspaceManager | null = null;

  private constructor() {
    this.subscribeToEvents();
  }

  static getInstance(): WorkspaceManager {
    if (!WorkspaceManager.instance) {
      WorkspaceManager.instance = new WorkspaceManager();
    }
    return WorkspaceManager.instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * Register a workspace as "indexing" (called at the start of ETL).
   * Creates the row if it doesn't exist yet.
   */
  async markIndexing(projectId: string, projectPath: string): Promise<void> {
    const repo = getSymbolRepository();
    const existing = await repo.getWorkspace(projectId);
    await repo.upsertWorkspace({
      project_id: projectId,
      project_path: projectPath,
      display_name: projectPath.split("/").pop(),
      status: "indexing",
      files_count: existing?.files_count ?? 0,
      chunks_count: existing?.chunks_count ?? 0,
      symbols_count: existing?.symbols_count ?? 0,
      created_at: existing?.created_at,
    });

    eventBus.publish("workspace:updated", { projectId, status: "indexing" });
    logger.info("WorkspaceManager: marked as indexing", { projectId });
  }

  /**
   * Called after a successful ETL run.
   * Triggers centrality recomputation in the background.
   */
  async markIndexed(
    projectId: string,
    stats: { filesCount: number; chunksCount: number; symbolsCount: number },
  ): Promise<void> {
    await getSymbolRepository().updateWorkspaceStatus(projectId, "indexed", {
      lastIndexedAt: Date.now(),
      lastError: null,
      filesCount: stats.filesCount,
      chunksCount: stats.chunksCount,
      symbolsCount: stats.symbolsCount,
    });

    eventBus.publish("workspace:updated", {
      projectId,
      status: "indexed",
      filesCount: stats.filesCount,
      symbolsCount: stats.symbolsCount,
    });

    // Background centrality recomputation (non-blocking)
    symbolGraphService
      .recomputeCentrality(projectId)
      .catch((err) =>
        logger.error("WorkspaceManager: centrality recomputation failed", err as Error, { projectId }),
      );

    logger.info("WorkspaceManager: marked as indexed", { projectId, ...stats });
  }

  /**
   * Called on ETL failure.
   */
  async markError(projectId: string, error: string): Promise<void> {
    await getSymbolRepository().updateWorkspaceStatus(projectId, "error", {
      lastError: error,
    });

    eventBus.publish("workspace:updated", { projectId, status: "error" });
    logger.warn("WorkspaceManager: marked as error", { projectId, error });
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  async listWorkspaces(statusFilter?: WorkspaceStatus | "all"): Promise<WorkspaceRow[]> {
    const all = await getSymbolRepository().listWorkspaces();
    if (!statusFilter || statusFilter === "all") return all;
    return all.filter((w) => w.status === statusFilter);
  }

  async getWorkspace(projectId: string): Promise<WorkspaceRow | null> {
    return getSymbolRepository().getWorkspace(projectId);
  }

  /**
   * M25: Resolve a project by its unique name tail (the last segment of the
   * project path or the projectId itself).
   *
   * - Unique match → return the WorkspaceRow
   * - Ambiguous (2+ matches) → throw with candidate list
   * - No match → return null (not-found)
   *
   * The "name tail" is the last path segment of `projectPath` (e.g.,
   * `/home/user/my-project` → `my-project`) or the `projectId` itself if the
   * path has no slashes. Case-sensitive.
   */
  async resolveByNameTail(nameTail: string): Promise<WorkspaceRow | null> {
    if (!nameTail) return null;
    const all = await getSymbolRepository().listWorkspaces();
    const matches = all.filter((w) => {
      const pathTail = w.project_path.split("/").pop() ?? w.project_path;
      return pathTail === nameTail || w.project_id === nameTail;
    });
    if (matches.length === 0) return null;
    if (matches.length > 1) {
      const candidates = matches.map((w) => w.project_id).join(", ");
      throw new Error(
        `Ambiguous project name tail "${nameTail}": matches ${matches.length} projects [${candidates}]. Use the full projectId instead.`,
      );
    }
    return matches[0]!;
  }

  /**
   * Remove a project: deletes workspace row + all symbol data (CASCADE).
   * Does NOT clear the vector store — caller is responsible for that.
   */
  async removeWorkspace(projectId: string): Promise<void> {
    await getSymbolRepository().clearProject(projectId);
    logger.info("WorkspaceManager: workspace removed", { projectId });
  }

  // ── EventBus integration ──────────────────────────────────────────────────

  private subscribeToEvents(): void {
    eventBus.subscribe("indexing:started", ({ projectId, projectPath }) => {
      this.markIndexing(projectId, projectPath).catch((err) =>
        logger.error("WorkspaceManager: failed to mark indexing", err as Error, { projectId }),
      );
    });

    eventBus.subscribe("indexing:completed", ({ projectId, filesIndexed, chunksIndexed, symbolsIndexed }) => {
      this.markIndexed(projectId, {
        filesCount: filesIndexed,
        chunksCount: chunksIndexed,
        symbolsCount: symbolsIndexed,
      }).catch((err) =>
        logger.error("WorkspaceManager: failed to mark indexed", err as Error, { projectId }),
      );
    });

    eventBus.subscribe("indexing:failed", ({ projectId, error }) => {
      this.markError(projectId, error).catch((err) =>
        logger.error("WorkspaceManager: failed to mark error", err as Error, { projectId }),
      );
    });
  }
}

export const workspaceManager = WorkspaceManager.getInstance();
