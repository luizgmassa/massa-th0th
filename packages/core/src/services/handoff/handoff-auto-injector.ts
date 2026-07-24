/**
 * HandoffAutoInjector — Phase 6 auto-inject seam (R3).
 *
 * Subscribes to the Phase-3 `observation:ingested` event. When a
 * `session-start` observation lands, it queries the HandoffService for
 * pending (`open`) handoffs for that project/target agent and records
 * (via logger.info) how many were found. This is observability + a
 * future auto-surface hook; the deterministic surfacing primitive is
 * `HandoffService.listPending` (invoked directly or via the
 * `handoff_list_pending` MCP tool).
 *
 * Design call: consume `observation:ingested` (already typed, already
 * fired by the Phase-3 SessionStart hook, already consumed by the
 * ObservationConsolidationJob). Reusing it keeps a single integration
 * bus (cross-cutting §3) and avoids coupling the memory recall path to
 * the handoff table.
 *
 * Graceful degradation: when the Phase-3 hook is not installed, the
 * event never fires and `listPending` still works as the recall-path
 * check. The injector never blocks the session-start path and never
 * throws.
 */

import { logger } from "@massa-ai/shared";
import { eventBus } from "../events/event-bus.js";
import type { HandoffService } from "./handoff-service.js";

export class HandoffAutoInjector {
  private unsubscribe: (() => void) | null = null;
  private readonly service: HandoffService;

  constructor(service: HandoffService) {
    this.service = service;
  }

  /** Subscribe to observation:ingested. Returns an unsubscribe fn. */
  start(): () => void {
    if (this.unsubscribe) return this.unsubscribe;
    this.unsubscribe = eventBus.subscribe("observation:ingested", (payload) => {
      if (!payload || payload.source !== "session-start") return;
      void (async () => {
        try {
          const projectId = payload.projectId;
          if (!projectId) return;
          // targetAgent is not in the observation payload directly; derive
          // best-effort from agentId if present. listPending with no
          // targetAgent returns all open handoffs for the project.
          const targetAgent =
            (payload as { agentId?: string }).agentId ?? undefined;
          const pending = await this.service.listPending(projectId, targetAgent);
          if (pending.length > 0) {
            logger.info("HandoffAutoInjector: pending handoffs found", {
              projectId,
              count: pending.length,
              ids: pending.map((h) => h.id),
            });
          }
        } catch (e) {
          logger.debug("HandoffAutoInjector: error handling session-start", {
            error: (e as Error).message,
          });
        }
      })();
    });
    return this.unsubscribe;
  }

  stop(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }
}
