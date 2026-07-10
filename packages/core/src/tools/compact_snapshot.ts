/**
 * Compact Snapshot Tool
 *
 * MCP tool for building a reference-based compaction snapshot of the current
 * session's observations. The snapshot is a bounded (<~2KB) table-of-contents
 * with runnable search/recall calls — NOT inlined data. Zero information loss:
 * raw events stay in the observation store; the snapshot just points to them.
 *
 * Optionally persists the snapshot itself as an observation of category
 * `compaction-snapshots` so it is available for future sessions.
 */

import { IToolHandler, ToolResponse, logger } from "@massa-th0th/shared";
import { getObservationStore, newObservationId } from "../data/memory/observation-repository.js";
import { getCompactionSnapshotService } from "../services/hooks/compaction-snapshot-service.js";

interface CompactSnapshotParams {
  sessionId: string;
  projectId?: string;
  persist?: boolean;
}

export class CompactSnapshotTool implements IToolHandler {
  name = "compact_snapshot";
  description =
    "Build a reference-based compaction snapshot (bounded table-of-contents with runnable search/recall calls) for the current session's observations. Zero information loss — raw events stay in the store; the snapshot points to them. Optionally persists the snapshot as an observation.";
  inputSchema = {
    type: "object",
    properties: {
      sessionId: {
        type: "string",
        description: "Session ID to build the snapshot for",
      },
      projectId: {
        type: "string",
        description: "Project ID (defaults to 'default')",
      },
      persist: {
        type: "boolean",
        default: false,
        description:
          "If true, persist the snapshot as an observation of category 'compaction-snapshots'",
      },
    },
    required: ["sessionId"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const { sessionId, projectId = "default", persist = false } = params as CompactSnapshotParams;

    if (!sessionId || typeof sessionId !== "string") {
      return { success: false, error: "sessionId is required" };
    }

    try {
      const store = getObservationStore();
      const service = getCompactionSnapshotService(store);

      const snapshot = service.build({
        sessionId,
        projectId,
        compactCount: 0,
      });

      // Optionally persist the snapshot as an observation so it survives across
      // sessions and can be retrieved by future compaction cycles.
      let persistedId: string | undefined;
      if (persist && snapshot.eventCount > 0) {
        persistedId = newObservationId();
        try {
          store.insert({
            id: persistedId,
            projectId,
            sessionId,
            source: "pre-compact",
            category: "compaction-snapshots",
            payloadJson: JSON.stringify({
              snapshot: snapshot.xml,
              eventCount: snapshot.eventCount,
              compactCount: snapshot.compactCount,
              generatedAt: snapshot.generatedAt,
              sectionCount: snapshot.sections.length,
            }),
            importance: 0.8,
            createdAt: Date.now(),
          });
          logger.info("compact_snapshot: persisted", {
            persistedId,
            sessionId,
            bytes: snapshot.bytes,
          });
        } catch (e) {
          logger.warn("compact_snapshot: persist failed (non-fatal)", {
            error: (e as Error).message,
          });
          persistedId = undefined;
        }
      }

      return {
        success: true,
        data: {
          snapshot: snapshot.xml,
          bytes: snapshot.bytes,
          eventCount: snapshot.eventCount,
          sectionCount: snapshot.sections.length,
          sections: snapshot.sections.map((s) => ({
            category: s.category,
            label: s.label,
            count: s.count,
            observationIds: s.observationIds,
          })),
          persistedId,
          generatedAt: snapshot.generatedAt,
        },
        metadata: {
          tokensSaved: Math.round(snapshot.bytes / 4),
        },
      };
    } catch (error) {
      logger.error("compact_snapshot: failed", error as Error, { sessionId });
      return {
        success: false,
        error: `Failed to build compaction snapshot: ${(error as Error).message}`,
      };
    }
  }
}
