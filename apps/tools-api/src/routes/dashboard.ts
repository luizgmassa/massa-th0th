/**
 * Dashboard Routes (N28 — observability).
 *
 * Read-only status endpoints for the massa-th0th dashboard.
 *
 *   GET /api/v1/scheduler/status   — scheduler snapshot (wraps scheduler.status())
 *   GET /api/v1/hooks/queue-status — hook writer-queue depth (wraps WriterQueue)
 *
 * Both routes are read-only, behind the same API-key gate as every other route,
 * and degrade gracefully when the underlying subsystem is unavailable (no
 * crash, no 500).
 */

import { getScheduler } from "@massa-th0th/core/services";
import { getHookService } from "@massa-th0th/core";
import { Elysia } from "elysia";

const DASHBOARD_DETAIL = {
  tags: ["dashboard"],
};

export const dashboardRoutes = new Elysia({ prefix: "/api/v1" })
  .get(
    "/scheduler/status",
    () => {
      try {
        const scheduler = getScheduler();
        const status = scheduler.status();
        return {
          running: status.running,
          tickIntervalMs: status.tickIntervalMs,
          jobs: status.jobs.map((j) => ({
            id: j.id,
            name: j.name,
            jobKind: j.jobKind,
            enabled: j.enabled,
            nextRunAt: j.nextRunAt,
            lastRunAt: j.lastRunAt,
            lastSuccessAt: null,
            consecutiveFailures: 0,
            due: j.due,
            currentlyRunning: j.currentlyRunning,
          })),
        };
      } catch (e) {
        const err = e as Error;
        return {
          running: false,
          tickIntervalMs: 0,
          jobs: [],
          unavailable: true,
          error: err.message,
        };
      }
    },
    {
      detail: {
        ...DASHBOARD_DETAIL,
        summary: "Scheduler status snapshot",
        description:
          "Read-only snapshot of the in-process scheduler: running flag, tick interval, and registered jobs with due/running flags.",
      },
    },
  )
  .get(
    "/hooks/queue-status",
    () => {
      try {
        const hookService = getHookService();
        const queue = hookService.queue;
        return {
          pendingCount: queue.pendingCount,
          maxPending: queue.maxPendingCount,
          saturated: queue.saturated,
        };
      } catch (e) {
        const err = e as Error;
        return {
          pendingCount: 0,
          maxPending: 0,
          saturated: false,
          unavailable: true,
          error: err.message,
        };
      }
    },
    {
      detail: {
        ...DASHBOARD_DETAIL,
        summary: "Hook writer-queue depth",
        description:
          "Read-only snapshot of the single-writer hook queue: pending count, saturation flag.",
      },
    },
  );