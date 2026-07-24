/**
 * Task Envelope Service — Wave 5 FR-14 / FR-25 / AD-W5-019.
 *
 * Collapses 5 Synapse moves into a single `begin` call:
 *   1. create session
 *   2. prime buffer (if entries provided)
 *   3. search (the first search of the task)
 *   4. prefetch first hit (if search returned results)
 *   5. record access (for the first hit)
 *
 * Partial-failure contract (AD-W5-019 / FR-25):
 *   - The session is ALWAYS returned (created in step 1; survives all later
 *     failures). The caller can retry or end via synapse_task_end.
 *   - `partial: true` + `errors: string[]` when any sub-step fails.
 *   - `search` may be `null` when the search sub-step (step 3) failed.
 *   - Each sub-step is independent — a failure in step 4 does not prevent
 *     step 5 (though step 5 is skipped if step 3 produced no results).
 *
 * The service delegates to the existing Synapse session registry + search
 * controller. It does NOT re-implement search or session logic — it
 * orchestrates the existing primitives in sequence.
 */

import { logger } from "@massa-ai/shared";
import { getSessionRegistry } from "../synapse/session/index.js";
import { DEFAULT_BUFFER_CONFIG } from "../synapse/buffer/index.js";
import { SearchController } from "../../controllers/search-controller.js";
import type { SearchSource } from "@massa-ai/shared";
import { SearchSource as SearchSourceEnum } from "@massa-ai/shared";

/**
 * Input for `synapse_task_begin`.
 */
export interface TaskBeginInput {
  /** Stable identifier of the calling agent. */
  agentId: string;
  /** One-sentence description of the current task. */
  taskContext?: string;
  /** Project ID this session is scoped to. */
  workspaceId?: string;
  /** The search query for the first search. */
  query: string;
  /** Project ID for the search. */
  projectId: string;
  /** Optional entries to prime the buffer with (from recall). */
  entries?: Array<{
    id: string;
    content: string;
    score?: number;
    metadata?: Record<string, unknown>;
  }>;
  /** Max results for the first search (default 10). */
  limit?: number;
}

/**
 * Result of `synapse_task_begin`. Per AD-W5-019, the session is always
 * returned; `partial` + `errors` indicate sub-step failures; `search` may
 * be null when the search sub-step failed.
 */
export interface TaskBeginResult {
  /** The created session ID (always present). */
  sessionId: string;
  /** The search result (null when the search sub-step failed). */
  search: unknown | null;
  /** Number of entries primed into the buffer (0 if step 2 failed/skipped). */
  primed: number;
  /** True when any sub-step failed. */
  partial: boolean;
  /** List of failed sub-step names (e.g. ["search", "prefetch"]). */
  errors: string[];
}

/**
 * Result of `synapse_task_end` (FR-15). Returns a summary + deletes the
 * session. A follow-up GET on the session ID returns 404 after this.
 */
export interface TaskEndResult {
  /** The session ID that was ended. */
  sessionId: string;
  /** Session duration in milliseconds (createdAt → end). */
  durationMs: number;
  /** Number of unique files/memories accessed during the session. */
  accessCount: number;
  /** Top accessed files (memoryId), sorted by access count descending. */
  topFiles: string[];
}

/**
 * Task Envelope Service — orchestrates the 5-move begin sequence.
 */
export class TaskEnvelopeService {
  private searchController: SearchController;

  constructor(searchController?: SearchController) {
    this.searchController = searchController ?? SearchController.getInstance();
  }

  /**
   * Begin a task: create session → prime → search → prefetch first hit →
   * record access. Each step is independent; failures set partial=true.
   * The session is always returned.
   */
  async begin(input: TaskBeginInput): Promise<TaskBeginResult> {
    const errors: string[] = [];
    let primed = 0;
    let search: unknown | null = null;

    // Step 1: create session. This is the anchor — it must succeed for the
    // envelope to return a sessionId. If it fails, we cannot continue.
    const registry = getSessionRegistry();
    let sessionId: string;
    try {
      sessionId = `syn_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      registry.create({
        sessionId,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        taskContext: input.taskContext,
        bufferConfig: DEFAULT_BUFFER_CONFIG,
      });
    } catch (err) {
      // Session creation failure is fatal — no sessionId to return.
      throw new Error(
        `synapse_task_begin: session creation failed — ${err instanceof Error ? err.message : String(err)}`,
      );
    }

    // Step 2: prime buffer (if entries provided). Failure is partial.
    if (input.entries && input.entries.length > 0) {
      try {
        const session = registry.get(sessionId);
        if (session?.buffer) {
          const results = input.entries.map((e) => ({
            id: e.id,
            content: e.content,
            score: e.score ?? 0.7,
            source: SearchSourceEnum.VECTOR as SearchSource,
            metadata: (e.metadata ?? {}) as any,
          }));
          session.buffer.prime(results);
          primed = results.length;
        }
      } catch (err) {
        errors.push("prime");
        logger.warn("synapse_task_begin: prime sub-step failed", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 3: search. Failure is partial; search stays null.
    let firstHitId: string | null = null;
    let firstHitFile: string | null = null;
    try {
      const result = await this.searchController.searchProject({
        query: input.query,
        projectId: input.projectId,
        maxResults: input.limit ?? 10,
        sessionId,
      });
      search = result;
      // Extract the first hit for prefetch + access (step 4 + 5).
      if (result.results && result.results.length > 0) {
        const first = result.results[0];
        firstHitId = first.id;
        firstHitFile = first.filePath ?? null;
      }
    } catch (err) {
      errors.push("search");
      logger.warn("synapse_task_begin: search sub-step failed", {
        sessionId,
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Step 4: prefetch first hit (if search produced a result with a file).
    if (firstHitFile) {
      try {
        const session = registry.get(sessionId);
        if (session?.buffer) {
          // Prefetch is best-effort — we prime with the first hit's metadata
          // so the buffer has the most relevant context for the task.
          // The full prefetch plan requires memory search; here we use the
          // search result itself as the prefetch entry (simplified envelope).
          if (firstHitId) {
            session.buffer.prime([
              {
                id: firstHitId,
                content: "", // content already in the search result
                score: 0.8,
                source: SearchSourceEnum.VECTOR as SearchSource,
                metadata: { filePath: firstHitFile, prefetched: true } as any,
              },
            ]);
          }
        }
      } catch (err) {
        errors.push("prefetch");
        logger.warn("synapse_task_begin: prefetch sub-step failed", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Step 5: record access (for the first hit). Best-effort.
    if (firstHitId) {
      try {
        registry.recordAccess(sessionId, firstHitId);
      } catch (err) {
        errors.push("access");
        logger.warn("synapse_task_begin: access sub-step failed", {
          sessionId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return {
      sessionId,
      search,
      primed,
      partial: errors.length > 0,
      errors,
    };
  }

  /**
   * End a task: compute summary (accessCount, topFiles), DELETE the session,
   * and return the summary. A follow-up GET on the session ID returns 404.
   *
   * FR-15 / AC-12: returns { sessionId, durationMs, accessCount, topFiles }.
   */
  end(sessionId: string): TaskEndResult | null {
    const registry = getSessionRegistry();
    const session = registry.get(sessionId);
    if (!session) {
      return null;
    }

    const durationMs = Date.now() - session.createdAt;

    // Compute accessCount (unique files/memories accessed).
    const accessCount = session.accessHistory.size;

    // Compute topFiles: sort access history by count descending, take top 10.
    const entries = Array.from(session.accessHistory.entries());
    entries.sort((a, b) => b[1] - a[1]);
    const topFiles = entries.slice(0, 10).map(([id]) => id);

    // Delete the session.
    registry.delete(sessionId);

    return {
      sessionId,
      durationMs,
      accessCount,
      topFiles,
    };
  }
}