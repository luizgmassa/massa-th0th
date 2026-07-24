/**
 * Compact Snapshot Tool
 *
 * MCP tool for building a reference-based compaction snapshot of the current
 * session's observations. The snapshot is a bounded (<~2KB) table-of-contents
 * with runnable search/recall calls — NOT inlined data. Zero information loss:
 * raw events stay in the observation store; the snapshot just points to them.
 *
 * SESSION continuity, NOT task state. This is distinct from `create_checkpoint`
 * (which versions TASK progress/decisions/files in PostgreSQL memories table). See
 * `packages/core/src/services/SESSION-STATE.md` for the full reconciliation.
 *
 * Optionally persists the snapshot itself as an observation of category
 * `compaction-snapshots` so it is available for future sessions.
 */

import { IToolHandler, ToolResponse, logger } from "@massa-ai/shared";
import {
  getObservationStore,
  newObservationId,
  type ObservationStore,
} from "../data/memory/observation-repository.js";
import { getCompactionSnapshotService } from "../services/hooks/compaction-snapshot-service.js";
import {
  getAttributionResolver,
  type AttributionResolverLike,
} from "../services/hooks/attribution-resolver.js";

interface CompactSnapshotParams {
  sessionId: string;
  projectId?: string;
  persist?: boolean;
  cwd?: string;
}

export interface CompactSnapshotToolOptions {
  /** Injectable store (tests); defaults to the shared observation store. */
  store?: ObservationStore;
  /** Injectable attribution resolver (tests); defaults to the shared resolver. */
  resolver?: AttributionResolverLike;
}

export class CompactSnapshotTool implements IToolHandler {
  name = "compact_snapshot";
  private readonly storeOverride?: ObservationStore;
  private readonly resolverOverride?: AttributionResolverLike;

  constructor(options: CompactSnapshotToolOptions = {}) {
    this.storeOverride = options.store;
    this.resolverOverride = options.resolver;
  }
  description =
    "Build a reference-based compaction snapshot — bounded table-of-contents with " +
    "runnable search/recall calls for the current session's observations (SESSION " +
    "continuity, not task state). Zero information loss — raw events stay in the " +
    "observation store; the snapshot points to them. Distinct from checkpoints " +
    "(which version TASK progress in PostgreSQL memories table). Optionally persists the snapshot " +
    "as an observation of category 'compaction-snapshots' in PostgreSQL observations table.";
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
      cwd: {
        type: "string",
        description:
          "Optional working directory of the session (used for attribution containment when the caller projectId is not a registered workspace)",
      },
    },
    required: ["sessionId"],
  };

  async handle(params: unknown): Promise<ToolResponse> {
    const { sessionId, projectId = "default", persist = false, cwd } = params as CompactSnapshotParams;

    if (!sessionId || typeof sessionId !== "string") {
      return { success: false, error: "sessionId is required" };
    }

    try {
      const store = this.storeOverride ?? getObservationStore();
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
          const attribution = await (
            this.resolverOverride ?? getAttributionResolver()
          ).resolve({ callerProjectId: projectId, sessionId, cwd });
          store.insert({
            id: persistedId,
            projectId: attribution.projectId,
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
            attributionSource: attribution.source,
          });
          // Mirror HookService: admission (insert) survived → record sticky pin.
          (this.resolverOverride ?? getAttributionResolver()).pinSession(
            sessionId,
            attribution.projectId,
            attribution.source,
          );
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
