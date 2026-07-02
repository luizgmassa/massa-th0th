/**
 * Unit tests for SqliteJobStore + IndexJobTracker durability (Phase 1, P1-JOBS).
 *
 * Drives the real SQLite store against a temp dbPath (no config mock — the
 * store ctor accepts an explicit path). Proves round-trip persistence and
 * crash recovery (stale `running` → `failed` on init).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { SqliteJobStore } from "../services/jobs/index-job-store.js";
import { IndexJobTracker } from "../services/jobs/index-job-tracker.js";
import type { IndexJob } from "../services/jobs/index-job-tracker.js";

let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "th0th-jobs-"));
  dbPath = path.join(tmpDir, "jobs.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("SqliteJobStore — round-trip", () => {
  test("save then get returns the persisted job", () => {
    const store = new SqliteJobStore(dbPath);
    const job: IndexJob = {
      jobId: "j1",
      projectId: "p1",
      projectPath: "/x",
      status: "running",
      progress: { current: 5, total: 10, percentage: 50 },
      createdAt: new Date(),
    };
    store.save(job);
    const loaded = store.get("j1");
    expect(loaded).not.toBeNull();
    expect(loaded!.projectId).toBe("p1");
    expect(loaded!.status).toBe("running");
    expect(loaded!.progress.percentage).toBe(50);
  });

  test("listByProject returns only that project's jobs", () => {
    const store = new SqliteJobStore(dbPath);
    store.save({ jobId: "a", projectId: "p1", projectPath: "/", status: "completed", progress: { current: 0, total: 0, percentage: 0 }, createdAt: new Date() });
    store.save({ jobId: "b", projectId: "p2", projectPath: "/", status: "completed", progress: { current: 0, total: 0, percentage: 0 }, createdAt: new Date() });
    expect(store.listByProject("p1").map((j) => j.jobId)).toEqual(["a"]);
  });

  test("save with result round-trips the result block", () => {
    const store = new SqliteJobStore(dbPath);
    store.save({
      jobId: "r1", projectId: "p", projectPath: "/", status: "completed",
      progress: { current: 10, total: 10, percentage: 100 },
      result: { filesIndexed: 10, chunksIndexed: 40, errors: 0, duration: 1234 },
      createdAt: new Date(),
    });
    expect(store.get("r1")?.result?.chunksIndexed).toBe(40);
  });

  test("get on missing id returns null", () => {
    expect(new SqliteJobStore(dbPath).get("nope")).toBeNull();
  });
});

describe("SqliteJobStore — crash recovery", () => {
  test("on first open, stale `running` jobs are marked `failed` (process restart)", () => {
    // First instance: write a running job, then drop the handle (simulate crash).
    const store1 = new SqliteJobStore(dbPath);
    store1.save({
      jobId: "stuck", projectId: "p", projectPath: "/", status: "running",
      progress: { current: 3, total: 10, percentage: 30 },
      createdAt: new Date(),
    });

    // New instance over the same file: recovery runs on open.
    const store2 = new SqliteJobStore(dbPath);
    const recovered = store2.get("stuck");
    expect(recovered).not.toBeNull();
    expect(recovered!.status).toBe("failed");
    expect(recovered!.error).toMatch(/process restart/);
  });

  test("completed/failed/pending jobs are NOT touched by recovery", () => {
    const store1 = new SqliteJobStore(dbPath);
    store1.save({ jobId: "ok", projectId: "p", projectPath: "/", status: "completed", progress: { current: 0, total: 0, percentage: 0 }, createdAt: new Date() });
    store1.save({ jobId: "pend", projectId: "p", projectPath: "/", status: "pending", progress: { current: 0, total: 0, percentage: 0 }, createdAt: new Date() });

    const store2 = new SqliteJobStore(dbPath);
    expect(store2.get("ok")?.status).toBe("completed");
    expect(store2.get("pend")?.status).toBe("pending");
  });
});

describe("IndexJobTracker — write-through + lazy-load", () => {
  test("a job created via a store-backed tracker persists and reloads after the hot cache is dropped", () => {
    const store = new SqliteJobStore(dbPath);
    const tracker = new IndexJobTracker(store);
    const job = tracker.createJob("proj", "/path");
    tracker.updateStatus(job.jobId, "running");
    tracker.updateProgress(job.jobId, 7, 10);
    tracker.setResult(job.jobId, { filesIndexed: 10, chunksIndexed: 50, errors: 0, duration: 99 });

    // New tracker over the same store: lazy-load the completed job.
    const tracker2 = new IndexJobTracker(store);
    const loaded = tracker2.getJob(job.jobId);
    expect(loaded).toBeDefined();
    expect(loaded!.status).toBe("completed");
    // setResult completes the job but does not recompute progress; the last
    // updateProgress(7,10) left percentage at 70.
    expect(loaded!.progress.percentage).toBe(70);
    expect(loaded!.result?.chunksIndexed).toBe(50);
  });
});
