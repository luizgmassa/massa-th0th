/**
 * Dashboard routes — Wave 6 T27 / N28.
 *
 * GET /api/v1/scheduler/status   — scheduler snapshot
 * GET /api/v1/hooks/queue-status — hook writer-queue depth
 *
 * Both routes are read-only, return expected shapes, and degrade gracefully
 * (no 500) when subsystems are unavailable.
 */

import { describe, expect, test, beforeAll, afterEach } from "bun:test";
import { Elysia } from "elysia";
import { dashboardRoutes } from "../routes/dashboard.js";
import { resetScheduler } from "@massa-ai/core/services";
import { resetHookService } from "@massa-ai/core";

const app = new Elysia().use(dashboardRoutes);

async function getJson(path: string): Promise<any> {
  const res = await app.handle(new Request(`http://localhost${path}`));
  return { status: res.status, body: await res.json() };
}

describe("GET /api/v1/scheduler/status (T27)", () => {
  beforeAll(() => {
    resetScheduler();
  });

  afterEach(() => {
    resetScheduler();
    resetHookService();
  });

  test("returns running flag + tickIntervalMs + jobs array", async () => {
    const { status, body } = await getJson("/api/v1/scheduler/status");
    expect(status).toBe(200);
    expect(typeof body.running).toBe("boolean");
    expect(typeof body.tickIntervalMs).toBe("number");
    expect(Array.isArray(body.jobs)).toBe(true);
  });

  test("each job has required fields", async () => {
    const { body } = await getJson("/api/v1/scheduler/status");
    for (const job of body.jobs) {
      expect(job).toHaveProperty("id");
      expect(job).toHaveProperty("name");
      expect(job).toHaveProperty("jobKind");
      expect(job).toHaveProperty("enabled");
      expect(job).toHaveProperty("nextRunAt");
      expect(job).toHaveProperty("lastRunAt");
      expect(job).toHaveProperty("consecutiveFailures");
      expect(job).toHaveProperty("due");
      expect(job).toHaveProperty("currentlyRunning");
    }
  });
});

describe("GET /api/v1/hooks/queue-status (T27)", () => {
  afterEach(() => {
    resetHookService();
  });

  test("returns pendingCount + maxPending + saturated", async () => {
    const { status, body } = await getJson("/api/v1/hooks/queue-status");
    expect(status).toBe(200);
    expect(typeof body.pendingCount).toBe("number");
    expect(typeof body.maxPending).toBe("number");
    expect(typeof body.saturated).toBe("boolean");
  });
});