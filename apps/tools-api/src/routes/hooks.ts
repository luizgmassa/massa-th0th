/**
 * Hook Routes (Phase 3 — passive lifecycle capture).
 *
 * POST /api/v1/hook        - Ingest a single lifecycle event → Observation.
 * POST /api/v1/hook/batch  - Ingest a batch of events atomically.
 *
 * Fire-and-forget: returns 202 + id(s) on admission. 429 when the single-writer
 * queue is saturated. 400/413 on validation failure. 423 when hooks are
 * disabled via config.
 */

import {
  getHookService,
  ValidationError,
  QueueSaturatedError,
  CompactSnapshotTool,
} from "@massa-ai/core";
import { config, logger } from "@massa-ai/shared";
import { Elysia, t } from "elysia";

let cachedService: ReturnType<typeof getHookService> | null = null;
function service() {
  if (!cachedService) cachedService = getHookService();
  return cachedService;
}

let cachedSnapshotTool: CompactSnapshotTool | null = null;
function snapshotTool() {
  if (!cachedSnapshotTool) cachedSnapshotTool = new CompactSnapshotTool();
  return cachedSnapshotTool;
}

function hooksDisabled(): boolean {
  try {
    return config.get("hooks").enabled === false;
  } catch {
    return false;
  }
}

const EVENT_DETAIL = {
  tags: ["hooks"],
};

export const hookRoutes = new Elysia({ prefix: "/api/v1/hook" })
  .post(
    "/",
    async ({ body, set }) => {
      if (hooksDisabled()) {
        set.status = 423;
        return { status: 423, error: "hooks disabled" };
      }
      try {
        const id = await service().ingestOne(body as any);
        set.status = 202;
        return { status: 202, id };
      } catch (e) {
        if (e instanceof QueueSaturatedError) {
          set.status = 429;
          set.headers["Retry-After"] = String(e.retryAfterSeconds);
          return { status: 429, error: "writer queue saturated", retryAfter: e.retryAfterSeconds };
        }
        if (e instanceof ValidationError) {
          set.status = e.code;
          return { status: e.code, error: e.message };
        }
        const err = e as Error;
        logger.error("hook ingestion failed", err);
        set.status = 500;
        return { status: 500, error: `hook service unavailable: ${err.message}` };
      }
    },
    {
      body: t.Object({
        event: t.String({ description: "Lifecycle event kind" }),
        projectId: t.String({ description: "Project identifier" }),
        sessionId: t.Optional(t.String()),
        payload: t.Record(t.String(), t.Unknown()),
        importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
        agentId: t.Optional(t.String()),
        ts: t.Optional(t.Number()),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Ingest a lifecycle event",
        description:
          "Fire-and-forget ingestion of a single lifecycle event (session-start, user-prompt, pre/post-tool-use, pre-compact, session-end). Returns 202 + observation id; 429 when saturated.",
      },
    },
  )
  .post(
    "/batch",
    async ({ body, set }) => {
      if (hooksDisabled()) {
        set.status = 423;
        return { status: 423, error: "hooks disabled" };
      }
      try {
        const ids = await service().ingestBatch((body as any).events);
        set.status = 202;
        return { status: 202, ids };
      } catch (e) {
        if (e instanceof QueueSaturatedError) {
          set.status = 429;
          set.headers["Retry-After"] = String(e.retryAfterSeconds);
          return { status: 429, error: "writer queue saturated", retryAfter: e.retryAfterSeconds };
        }
        if (e instanceof ValidationError) {
          set.status = e.code;
          return { status: e.code, error: e.message };
        }
        const err = e as Error;
        logger.error("hook batch ingestion failed", err);
        set.status = 500;
        return { status: 500, error: `hook service unavailable: ${err.message}` };
      }
    },
    {
      body: t.Object({
        events: t.Array(
          t.Object({
            event: t.String(),
            projectId: t.String(),
            sessionId: t.Optional(t.String()),
            payload: t.Record(t.String(), t.Unknown()),
            importance: t.Optional(t.Number({ minimum: 0, maximum: 1 })),
            agentId: t.Optional(t.String()),
            ts: t.Optional(t.Number()),
          }),
        ),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Ingest a batch of lifecycle events",
        description:
          "Atomic validation then admission of N events. Returns 202 + ids[]; 400/413 if ANY event is bad; 429 when saturated.",
      },
    },
  )
  .post(
    "/compact-snapshot",
    async ({ body }) => {
      return await snapshotTool().handle(body);
    },
    {
      body: t.Object({
        sessionId: t.String({ description: "Session ID to build the snapshot for" }),
        projectId: t.Optional(t.String({ description: "Project ID (defaults to 'default')" })),
        persist: t.Optional(
          t.Boolean({
            default: false,
            description:
              "If true, persist the snapshot as an observation of category 'compaction-snapshots'",
          }),
        ),
        cwd: t.Optional(
          t.String({
            description: "Session working directory (attribution containment hint)",
          }),
        ),
      }),
      detail: {
        ...EVENT_DETAIL,
        summary: "Build a compaction snapshot for a session",
        description:
          "Builds a bounded (<~2KB) reference-based table-of-contents with runnable recall/search calls for the session's observations. Zero information loss — raw events stay in the store. Optionally persists the snapshot as an observation.",
      },
    },
  );
