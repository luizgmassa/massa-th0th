/**
 * Bootstrap Routes (Phase 4 — repo bootstrap, G6).
 *
 * POST /api/v1/bootstrap - Scan a project and store LLM-summarized (or
 * rule-based) seed memories. Idempotent; refresh with force=true. Returns
 * 423 when bootstrap is disabled via config, 400 on empty projectId.
 */

import { getBootstrapService } from "@massa-ai/core";
import { config, logger } from "@massa-ai/shared";
import { Elysia, t } from "elysia";

let cachedService: ReturnType<typeof getBootstrapService> | null = null;
function service() {
  if (!cachedService) cachedService = getBootstrapService();
  return cachedService;
}

function bootstrapDisabled(): boolean {
  try {
    return (config.get("memory") as any)?.bootstrap?.enabled === false;
  } catch {
    return false;
  }
}

const EVENT_DETAIL = {
  tags: ["bootstrap"],
};

export const bootstrapRoutes = new Elysia({ prefix: "/api/v1/bootstrap" }).post(
  "/",
  async ({ body, set }) => {
    if (bootstrapDisabled()) {
      set.status = 423;
      return { status: 423, error: "bootstrap disabled" };
    }
    const { projectId, projectPath, force } = body as {
      projectId: string;
      projectPath?: string;
      force?: boolean;
    };
    if (!projectId || !String(projectId).trim()) {
      set.status = 400;
      return { status: 400, error: "projectId required" };
    }
    try {
      const result = await service().bootstrap(projectId, {
        projectPath,
        force: force === true,
      });
      set.status = 200;
      return { success: true, data: result };
    } catch (e) {
      const err = e as Error;
      logger.error("bootstrap failed", err);
      set.status = 500;
      return { success: false, error: `bootstrap failed: ${err.message}` };
    }
  },
  {
    body: t.Object({
      projectId: t.String({ description: "Project identifier" }),
      projectPath: t.Optional(t.String({ description: "Project root path" })),
      force: t.Optional(
        t.Boolean({ description: "Refresh even if already bootstrapped" }),
      ),
    }),
    detail: {
      ...EVENT_DETAIL,
      summary: "Bootstrap seed memories from repo signals",
      description:
        "Scans git log, README, docs, manifests, and top central files (PageRank); stores LLM-summarized (or rule-based) seed memories. Idempotent — skips if already bootstrapped unless force=true. LLM-off degrades to rule-based seeds.",
    },
  },
);
