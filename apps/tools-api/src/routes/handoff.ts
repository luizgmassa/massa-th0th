/**
 * Handoff Routes (Phase 6 — cross-session handoffs, G2).
 *
 * POST /api/v1/handoff/begin  - Begin a handoff (open row + dual-write memory)
 * POST /api/v1/handoff/accept - Accept an open handoff (open→accepted + event)
 * POST /api/v1/handoff/cancel - Cancel an open handoff (open→expired)
 * POST /api/v1/handoff/list   - List pending (open) handoffs
 *
 * Returns 423 when handoffs is disabled via config, 400 on missing required
 * fields. The service never throws; all failures surface as {ok:false, reason}.
 */

import { getHandoffService } from "@massa-th0th/core";
import { config, logger } from "@massa-th0th/shared";
import { Elysia, t } from "elysia";

let cachedService: ReturnType<typeof getHandoffService> | null = null;
function service() {
  if (!cachedService) cachedService = getHandoffService();
  return cachedService;
}

function handoffsDisabled(): boolean {
  try {
    return (config.get("handoffs") as any)?.enabled === false;
  } catch {
    return false;
  }
}

const EVENT_DETAIL = {
  tags: ["handoffs"],
};

export const handoffRoutes = new Elysia({ prefix: "/api/v1/handoff" })
  .post(
    "/begin",
    async ({ body, set }) => {
      if (handoffsDisabled()) {
        set.status = 423;
        return { status: 423, error: "handoffs disabled" };
      }
      const b = body as {
        projectId?: string;
        sourceSessionId?: string;
        targetAgent?: string;
        summary?: string;
        openQuestions?: string[];
        nextSteps?: string[];
        files?: string[];
      };
      if (!b.projectId || !String(b.projectId).trim()) {
        set.status = 400;
        return { status: 400, error: "projectId required" };
      }
      try {
        const result = await service().begin({
          projectId: b.projectId,
          sourceSessionId: b.sourceSessionId,
          targetAgent: b.targetAgent,
          summary: b.summary,
          openQuestions: b.openQuestions,
          nextSteps: b.nextSteps,
          files: b.files,
        });
        set.status = result.ok ? 200 : 400;
        return { success: result.ok, data: result };
      } catch (e) {
        const err = e as Error;
        logger.error("handoff begin failed", err);
        set.status = 500;
        return { success: false, error: `handoff begin failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        projectId: t.String({ description: "Project identifier" }),
        sourceSessionId: t.Optional(t.String()),
        targetAgent: t.Optional(t.String()),
        summary: t.Optional(t.String()),
        openQuestions: t.Optional(t.Array(t.String())),
        nextSteps: t.Optional(t.Array(t.String())),
        files: t.Optional(t.Array(t.String())),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Begin a cross-session handoff",
        description:
          "Creates an open handoff row and a dual-write searchable memory. Optional LLM summary-polish (default-off). Never throws.",
      },
    },
  )
  .post(
    "/accept",
    async ({ body, set }) => {
      if (handoffsDisabled()) {
        set.status = 423;
        return { status: 423, error: "handoffs disabled" };
      }
      const b = body as { id?: string; projectId?: string };
      if (!b.id || !String(b.id).trim()) {
        set.status = 400;
        return { status: 400, error: "id required" };
      }
      try {
        const result = await service().accept({ id: b.id, projectId: b.projectId });
        set.status = result.ok ? 200 : 400;
        return { success: result.ok, data: result };
      } catch (e) {
        const err = e as Error;
        logger.error("handoff accept failed", err);
        set.status = 500;
        return { success: false, error: `handoff accept failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "Handoff id" }),
        projectId: t.Optional(t.String()),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Accept an open handoff",
        description:
          "Flips status open→accepted, sets accepted_at, emits handoff:accepted. Missing/non-open/project-mismatch → {ok:false, reason}.",
      },
    },
  )
  .post(
    "/cancel",
    async ({ body, set }) => {
      if (handoffsDisabled()) {
        set.status = 423;
        return { status: 423, error: "handoffs disabled" };
      }
      const b = body as { id?: string; projectId?: string };
      if (!b.id || !String(b.id).trim()) {
        set.status = 400;
        return { status: 400, error: "id required" };
      }
      try {
        const result = await service().cancel({ id: b.id, projectId: b.projectId });
        set.status = result.ok ? 200 : 400;
        return { success: result.ok, data: result };
      } catch (e) {
        const err = e as Error;
        logger.error("handoff cancel failed", err);
        set.status = 500;
        return { success: false, error: `handoff cancel failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "Handoff id" }),
        projectId: t.Optional(t.String()),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Cancel (expire) an open handoff",
        description:
          "Flips status open→expired (no event). Same failure semantics as accept on missing/non-open/project-mismatch.",
      },
    },
  )
  .post(
    "/list",
    async ({ body, set }) => {
      if (handoffsDisabled()) {
        set.status = 423;
        return { status: 423, error: "handoffs disabled" };
      }
      const b = body as { projectId?: string; targetAgent?: string };
      if (!b.projectId || !String(b.projectId).trim()) {
        set.status = 400;
        return { status: 400, error: "projectId required" };
      }
      try {
        const pending = service().listPending(b.projectId, b.targetAgent);
        set.status = 200;
        return {
          success: true,
          data: { pending, count: pending.length },
        };
      } catch (e) {
        const err = e as Error;
        logger.error("handoff list failed", err);
        set.status = 500;
        return { success: false, error: `handoff list failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        projectId: t.String({ description: "Project identifier" }),
        targetAgent: t.Optional(t.String()),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "List pending (open) handoffs",
        description:
          "Lists open handoffs for a project, optionally filtered by target agent, ordered oldest-first.",
      },
    },
  );
