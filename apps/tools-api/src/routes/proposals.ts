/**
 * Proposal Routes (Phase 5 — auto-improvement loop, G7).
 *
 * POST /api/v1/proposal/list    - List pending proposals for a project
 * POST /api/v1/proposal/approve - Approve a pending proposal (apply + flip + event)
 * POST /api/v1/proposal/reject  - Reject a pending proposal (flip, no apply/event)
 *
 * Returns 423 when auto-improve is disabled via config and 400 on missing
 * required fields. Canonical persistence failures flow to the global sanitized
 * error envelope; domain rejections surface as {ok:false, reason}.
 */

import { getAutoImproveJob, SearchServiceError } from "@massa-ai/core";
import { config, logger } from "@massa-ai/shared";
import { Elysia, t } from "elysia";

let cachedJob: ReturnType<typeof getAutoImproveJob> | null = null;
function job() {
  if (!cachedJob) cachedJob = getAutoImproveJob();
  return cachedJob;
}

function autoImproveDisabled(): boolean {
  try {
    return (config.get("memory") as any)?.autoImprove?.enabled === false;
  } catch {
    return false;
  }
}

const EVENT_DETAIL = {
  tags: ["proposals"],
};

export const proposalRoutes = new Elysia({ prefix: "/api/v1/proposal" })
  .post(
    "/list",
    async ({ body, set }) => {
      if (autoImproveDisabled()) {
        set.status = 423;
        return { status: 423, error: "auto-improve disabled" };
      }
      const b = body as { projectId?: string };
      if (!b.projectId || !String(b.projectId).trim()) {
        set.status = 400;
        return { status: 400, error: "projectId required" };
      }
      try {
        const pending = await job().listPending(b.projectId);
        set.status = 200;
        return {
          success: true,
          data: { pending, count: pending.length },
        };
      } catch (e) {
        if (e instanceof SearchServiceError) throw e;
        const err = e as Error;
        logger.error("proposal list failed", err);
        set.status = 500;
        return { success: false, error: `proposal list failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        projectId: t.String({ description: "Project identifier" }),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "List pending auto-improvement proposals",
        description:
          "Lists pending proposals for a project, ordered newest-first. The surfacing primitive for the review-gate path.",
      },
    },
  )
  .post(
    "/approve",
    async ({ body, set }) => {
      if (autoImproveDisabled()) {
        set.status = 423;
        return { status: 423, error: "auto-improve disabled" };
      }
      const b = body as { id?: string; projectId?: string; source?: "llm" | "rule-based" };
      if (!b.id || !String(b.id).trim()) {
        set.status = 400;
        return { status: 400, error: "id required" };
      }
      try {
        const result = await job().approve(b.id, b.projectId, b.source ?? "rule-based");
        set.status = result.ok ? 200 : 400;
        return { success: result.ok, data: result };
      } catch (e) {
        if (e instanceof SearchServiceError) throw e;
        const err = e as Error;
        logger.error("proposal approve failed", err);
        set.status = 500;
        return { success: false, error: `proposal approve failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "Proposal id" }),
        projectId: t.Optional(t.String()),
        source: t.Optional(t.Union([t.Literal("llm"), t.Literal("rule-based")])),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Approve a pending proposal",
        description:
          "Applies the proposed memory edit, flips status pending→approved, emits memory:auto-improved. Missing/non-pending/project-mismatch/apply-failed → {ok:false, reason}.",
      },
    },
  )
  .post(
    "/reject",
    async ({ body, set }) => {
      if (autoImproveDisabled()) {
        set.status = 423;
        return { status: 423, error: "auto-improve disabled" };
      }
      const b = body as { id?: string; projectId?: string; reason?: string };
      if (!b.id || !String(b.id).trim()) {
        set.status = 400;
        return { status: 400, error: "id required" };
      }
      try {
        const result = await job().reject(b.id, b.projectId, b.reason);
        set.status = result.ok ? 200 : 400;
        return { success: result.ok, data: result };
      } catch (e) {
        if (e instanceof SearchServiceError) throw e;
        const err = e as Error;
        logger.error("proposal reject failed", err);
        set.status = 500;
        return { success: false, error: `proposal reject failed: ${err.message}` };
      }
    },
    {
      body: t.Object({
        id: t.String({ description: "Proposal id" }),
        projectId: t.Optional(t.String()),
        reason: t.Optional(t.String()),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Reject a pending proposal",
        description:
          "Flips status pending→rejected (no apply, no event). Same failure semantics as approve on missing/non-pending/project-mismatch.",
      },
    },
  );
