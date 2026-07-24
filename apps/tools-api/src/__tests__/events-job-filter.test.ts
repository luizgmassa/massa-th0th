/**
 * SSE /api/v1/events ?jobId= filter — Wave 5 FR-16 / AC-13 (T23).
 *
 * Verifies:
 *  - ?jobId= filters events whose payload carries that jobId (non-matching skipped)
 *  - ?jobId= and ?projectId= compose with AND (both must match)
 *  - connected initial event reports both filters
 *
 * Strategy: mount the events route, open the SSE stream, publish synthetic
 * events on the global eventBus concurrently while reading frames back. This
 * exercises the real filter code path in events.ts without a DB.
 */

import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { eventBus } from "@massa-ai/core";
import { eventsRoutes } from "../routes/events.js";

const app = new Elysia().use(eventsRoutes);

interface SseFrame {
  event?: string;
  payload?: Record<string, unknown>;
  timestamp?: string;
}

/**
 * Open the SSE stream and collect frames for a fixed window. Returns a
 * controller with `frames` and `stop()`. The caller publishes events while the
 * window is open, then stops and asserts.
 */
class SseCollector {
  frames: SseFrame[] = [];
  private reader?: ReadableStreamDefaultReader<Uint8Array>;
  private decoder = new TextDecoder();
  private buffer = "";
  private done = false;
  private readPromise: Promise<void> = Promise.resolve();

  constructor(query: string) {
    void this.start(query);
  }

  private async start(query: string): Promise<void> {
    const url = `http://localhost/api/v1/events${query}`;
    const res = await app.handle(new Request(url, {
      headers: { Accept: "text/event-stream" },
    }));
    if (!res.body) throw new Error("no stream body");
    this.reader = res.body.getReader() as ReadableStreamDefaultReader<Uint8Array>;
    this.readPromise = this.readLoop();
  }

  private async readLoop(): Promise<void> {
    while (!this.done) {
      if (!this.reader) break;
      const { value, done } = await this.reader.read();
      if (done) break;
      this.buffer += this.decoder.decode(value, { stream: true });
      let nlIdx: number;
      while ((nlIdx = this.buffer.indexOf("\n\n")) !== -1) {
        const chunk = this.buffer.slice(0, nlIdx);
        this.buffer = this.buffer.slice(nlIdx + 2);
        if (!chunk.startsWith("data: ")) continue; // skip heartbeats/comments
        try {
          const obj = JSON.parse(chunk.slice(6)) as SseFrame;
          this.frames.push(obj);
        } catch {
          // ignore malformed
        }
      }
    }
  }

  async stop(): Promise<void> {
    this.done = true;
    await this.reader?.cancel().catch(() => {});
    await this.readPromise.catch(() => {});
  }
}

function pub(event: "indexing:started" | "indexing:progress" | "indexing:completed", payload: Record<string, unknown>) {
  eventBus.publish(event, payload as never);
}

async function withCollector<T>(
  query: string,
  fn: (c: SseCollector) => Promise<T>,
): Promise<{ collector: SseCollector; result: T }> {
  const c = new SseCollector(query);
  // let the stream open + first frame (connected) arrive
  await new Promise((r) => setTimeout(r, 80));
  const result = await fn(c);
  await new Promise((r) => setTimeout(r, 120)); // let trailing events flush
  await c.stop();
  return { collector: c, result };
}

describe("GET /api/v1/events ?jobId= filter (W5-T23, FR-16/AC-13)", () => {
  test("connected frame reports jobIdFilter and projectIdFilter", async () => {
    const { collector } = await withCollector(
      "?jobId=job-xyz&projectId=proj-1",
      async () => {},
    );
    const connected = collector.frames.find((f) => f.event === "connected");
    expect(connected).toBeDefined();
    expect(connected!.payload).toEqual({
      projectIdFilter: "proj-1",
      jobIdFilter: "job-xyz",
    });
  });

  test("?jobId= receives only events whose payload.jobId matches", async () => {
    const target = "job-A";
    const other = "job-B";
    const { collector } = await withCollector(`?jobId=${target}`, async (c) => {
      pub("indexing:progress", { jobId: target, projectId: "p1", stage: "parse", current: 1, total: 10, percentage: 10 });
      pub("indexing:progress", { jobId: other, projectId: "p1", stage: "parse", current: 2, total: 10, percentage: 20 });
      pub("indexing:progress", { jobId: target, projectId: "p1", stage: "parse", current: 3, total: 10, percentage: 30 });
    });

    const progress = collector.frames.filter((f) => f.event === "indexing:progress");
    const jobIds = progress.map((f) => f.payload!.jobId as string);
    expect(jobIds.length).toBeGreaterThanOrEqual(1);
    expect(jobIds.every((id) => id === target)).toBe(true);
    expect(jobIds).not.toContain(other);
  });

  test("?jobId= and ?projectId= compose with AND", async () => {
    const job = "job-X";
    const proj = "proj-X";
    const { collector } = await withCollector(`?jobId=${job}&projectId=${proj}`, async () => {
      // (jobId match, projectId match) -> included
      pub("indexing:progress", { jobId: job, projectId: proj, stage: "s", current: 1, total: 4, percentage: 25 });
      // (jobId match, projectId mismatch) -> excluded
      pub("indexing:progress", { jobId: job, projectId: "other-proj", stage: "s", current: 2, total: 4, percentage: 50 });
      // (jobId mismatch, projectId match) -> excluded
      pub("indexing:progress", { jobId: "other-job", projectId: proj, stage: "s", current: 3, total: 4, percentage: 75 });
      // (both mismatch) -> excluded
      pub("indexing:progress", { jobId: "other-job", projectId: "other-proj", stage: "s", current: 4, total: 4, percentage: 100 });
    });

    const progress = collector.frames.filter((f) => f.event === "indexing:progress");
    expect(progress.length).toBe(1);
    expect(progress[0]!.payload!.jobId).toBe(job);
    expect(progress[0]!.payload!.projectId).toBe(proj);
  });

  test("events without a jobId payload are skipped when ?jobId= is set", async () => {
    const job = "job-Z";
    const { collector } = await withCollector(`?jobId=${job}`, async () => {
      // started with matching jobId -> included
      pub("indexing:started", { jobId: job, projectId: "p", projectPath: "/x" });
      // started WITHOUT jobId (legacy event) -> skipped
      pub("indexing:started", { projectId: "p", projectPath: "/y" } as never);
    });

    const started = collector.frames.filter((f) => f.event === "indexing:started");
    expect(started.length).toBe(1);
    expect(started[0]!.payload!.jobId).toBe(job);
  });
});