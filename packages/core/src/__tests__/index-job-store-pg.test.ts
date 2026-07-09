/**
 * Unit tests for PgJobStore + IndexJobTracker durability on PostgreSQL (T9).
 *
 * Mirrors the SqliteJobStore cases in index-job-store.test.ts, adapted for
 * PgJobStore's async-mirror design:
 *   - save() updates an in-memory mirror SYNCHRONOUSLY (sync read contract);
 *     the PG row lands fire-and-forget.
 *   - a fresh PgJobStore hydrates its mirror from PG on first use and runs
 *     crash recovery (stale `running` → `failed`) once.
 *
 * So the persistence round-trip and crash-recovery tests await the
 * fire-and-forget write / hydration by polling a direct PG query
 * ($queryRaw via the shared prisma client). The mirror-sync-read case asserts
 * the synchronous contract directly.
 *
 * Hygiene: all test jobs use a test-only projectId prefix
 * (`pg-jobstore-unit-test-…`) and are deleted in afterEach + afterAll. The
 * shared DB is left clean. Tests are skipped when DATABASE_URL is not postgres.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "bun:test";
import { randomUUID } from "crypto";

import { PgJobStore } from "../services/jobs/index-job-store-pg.js";
import { IndexJobTracker } from "../services/jobs/index-job-tracker.js";
import type { IndexJob } from "../services/jobs/index-job-tracker.js";

const DB_AVAILABLE = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const TEST_PREFIX = "pg-jobstore-unit-test-";
let prisma: any;

// ── helpers ──────────────────────────────────────────────────────────────────

function testProjectId(): string {
  return `${TEST_PREFIX}${randomUUID()}`;
}

function makeJob(overrides: Partial<IndexJob> & { projectId: string }): IndexJob {
  return {
    jobId: randomUUID(),
    projectPath: "/test/path",
    status: "running",
    progress: { current: 0, total: 10, percentage: 0 },
    createdAt: new Date(),
    ...overrides,
  };
}

/** Read a raw index_jobs row straight from PG (bypasses the mirror). */
async function pgGetRow(jobId: string): Promise<any | null> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT * FROM index_jobs WHERE job_id = ${jobId}`;
  return rows[0] ?? null;
}

/** Wait until a job row is visible in PG, or timeout. */
async function waitForPGRow(
  jobId: string,
  timeoutMs = 3000,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  let row: any | null = null;
  while (Date.now() < deadline) {
    row = await pgGetRow(jobId);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return row;
}

/**
 * Force a PgJobStore to complete its (fire-and-forget) first hydration +
 * crash-recovery pass BEFORE the test saves anything. This matters because:
 *   - hydration clears + repopulates the mirror from PG, so a save() made
 *     before hydration lands can be clobbered when hydration resolves; and
 *   - crash recovery flips every `running` row → `failed` on first hydration,
 *     so a `running` job saved before hydration would be recovered, not listed.
 * Hydrating up front mirrors a warm process: the store is recovered, the
 * mirror is stable, and saves stick.
 */
async function hydrateStore(store: PgJobStore): Promise<void> {
  // Trigger the lazy hydration via any read, then await the in-flight promise
  // by polling the mirror size stabilizing (cheap and avoids touching prod).
  store.get("__hydrate_probe__");
  // Give the fire-and-forget ensureHydrated a moment to resolve.
  await new Promise((r) => setTimeout(r, 150));
}

async function pgCleanup() {
  await prisma.$executeRaw`DELETE FROM index_jobs WHERE project_id LIKE ${TEST_PREFIX + "%"}`;
}

// ── suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!DB_AVAILABLE)("PgJobStore — unit tests on PostgreSQL", () => {
  beforeAll(async () => {
    const { getPrismaClient } = await import(
      "../services/query/prisma-client.js"
    );
    prisma = getPrismaClient();
    await pgCleanup();
  });

  afterAll(async () => {
    if (prisma) {
      await pgCleanup();
      const { disconnectPrisma } = await import(
        "../services/query/prisma-client.js"
      );
      await disconnectPrisma();
    }
  });

  beforeEach(pgCleanup);
  afterEach(pgCleanup);

  // ── mirror sync read (the sync JobStore contract) ────────────────────────

  describe("mirror sync read", () => {
    test("save() makes get() return the job synchronously (mirror hit)", () => {
      const store = new PgJobStore();
      const pid = testProjectId();
      const job = makeJob({ projectId: pid, status: "running" });
      store.save(job);
      // No await: the mirror is updated synchronously inside save().
      const loaded = store.get(job.jobId);
      expect(loaded).not.toBeNull();
      expect(loaded!.jobId).toBe(job.jobId);
      expect(loaded!.projectId).toBe(pid);
      expect(loaded!.status).toBe("running");
    });

    test("get() on an unknown id returns null (mirror miss, pre-hydration)", () => {
      const store = new PgJobStore();
      expect(store.get("definitely-not-a-real-job-id")).toBeNull();
    });
  });

  // ── persistence round-trip (fire-and-forget write → PG row) ──────────────

  describe("persistence round-trip", () => {
    test("save() lands the row in PG with correct columns", async () => {
      const store = new PgJobStore();
      const pid = testProjectId();
      const createdAt = new Date("2026-01-15T10:00:00Z");
      const job = makeJob({
        projectId: pid,
        projectPath: "/proj/x",
        status: "running",
        progress: { current: 5, total: 10, percentage: 50 },
        createdAt,
        heartbeatAt: new Date("2026-01-15T10:00:05Z"),
      });
      store.save(job);

      const row = await waitForPGRow(job.jobId);
      expect(row).not.toBeNull();
      expect(row.project_id).toBe(pid);
      expect(row.project_path).toBe("/proj/x");
      expect(row.status).toBe("running");
      expect(Number(row.current)).toBe(5);
      expect(Number(row.total)).toBe(10);
      expect(Number(row.percentage)).toBe(50);
      // bigint ms-epoch column → compare to getTime().
      expect(Number(row.created_at)).toBe(createdAt.getTime());
      expect(Number(row.heartbeat_at)).toBe(
        new Date("2026-01-15T10:00:05Z").getTime(),
      );
      // No result set yet → nullable result columns are null.
      expect(row.files_indexed).toBeNull();
    });

    test("save() with a result block round-trips the result columns", async () => {
      const store = new PgJobStore();
      const pid = testProjectId();
      const job = makeJob({
        projectId: pid,
        status: "completed",
        progress: { current: 10, total: 10, percentage: 100 },
        result: { filesIndexed: 12, chunksIndexed: 48, errors: 1, duration: 4321 },
        completedAt: new Date("2026-01-15T11:00:00Z"),
      });
      store.save(job);

      const row = await waitForPGRow(job.jobId);
      expect(row).not.toBeNull();
      expect(row.status).toBe("completed");
      expect(Number(row.files_indexed)).toBe(12);
      expect(Number(row.chunks_indexed)).toBe(48);
      expect(Number(row.errors)).toBe(1);
      expect(Number(row.duration)).toBe(4321);
      expect(Number(row.completed_at)).toBe(
        new Date("2026-01-15T11:00:00Z").getTime(),
      );
    });

    test("repeated save() upserts the same row (ON CONFLICT update)", async () => {
      const store = new PgJobStore();
      const pid = testProjectId();
      const jobId = randomUUID();
      store.save(
        makeJob({
          jobId,
          projectId: pid,
          status: "running",
          progress: { current: 1, total: 10, percentage: 10 },
        }),
      );
      store.save(
        makeJob({
          jobId,
          projectId: pid,
          status: "running",
          progress: { current: 9, total: 10, percentage: 90 },
        }),
      );
      // Give both fire-and-forget writes a chance to settle, then read the
      // final on-disk state.
      await new Promise((r) => setTimeout(r, 150));
      const row = await pgGetRow(jobId);
      expect(row).not.toBeNull();
      expect(Number(row.percentage)).toBe(90);
    });
  });

  // ── listByProject / listRunning (mirror-served, after hydration) ─────────

  describe("listByProject / listRunning", () => {
    test("listByProject returns only that project's jobs after flush", async () => {
      const store = new PgJobStore();
      await hydrateStore(store);
      const pidA = testProjectId();
      const pidB = testProjectId();
      const a = makeJob({ projectId: pidA, status: "completed" });
      const b = makeJob({ projectId: pidB, status: "completed" });
      store.save(a);
      store.save(b);
      await Promise.all([waitForPGRow(a.jobId), waitForPGRow(b.jobId)]);

      const jobs = store.listByProject(pidA);
      expect(jobs.map((j) => j.jobId)).toContain(a.jobId);
      expect(jobs.map((j) => j.jobId)).not.toContain(b.jobId);
    });

    test("listRunning returns only running jobs (on an already-recovered warm store)", async () => {
      // Hydrate + recover FIRST: crash recovery flips every `running` row →
      // `failed` on first hydration, so we must recover before saving a running
      // job or it would be recovered (and absent from listRunning()).
      const store = new PgJobStore();
      await hydrateStore(store);
      const pid = testProjectId();
      const running = makeJob({ projectId: pid, status: "running" });
      const done = makeJob({ projectId: pid, status: "completed" });
      store.save(running);
      store.save(done);
      await Promise.all([waitForPGRow(running.jobId), waitForPGRow(done.jobId)]);

      const ids = store.listRunning().map((j) => j.jobId);
      expect(ids).toContain(running.jobId);
      expect(ids).not.toContain(done.jobId);
    });
  });

  // ── crash recovery (new instance hydrates + flips running → failed) ──────

  describe("crash recovery", () => {
    test("on first hydration, stale `running` jobs are recovered as `failed`", async () => {
      const pid = testProjectId();
      const jobId = randomUUID();
      // Insert a running row directly into PG (simulates a crashed process).
      const createdAt = Date.now();
      await prisma.$executeRaw`
        INSERT INTO index_jobs (
          job_id, project_id, project_path, status, current, total, percentage,
          files_indexed, chunks_indexed, errors, duration, error,
          created_at, started_at, completed_at, heartbeat_at
        ) VALUES (
          ${jobId}, ${pid}, ${"/crash"}, ${"running"},
          ${3}::int, ${10}::int, ${30}::int,
          NULL, NULL, NULL, NULL, NULL,
          ${createdAt}::bigint, NULL, NULL, NULL
        )
      `;
      expect(await pgGetRow(jobId)).not.toBeNull();

      // A NEW instance hydrates from PG + runs recovery (fire-and-forget).
      const store = new PgJobStore();
      // Force hydration by triggering a read path; then poll the PG row until
      // recovery has flipped it (recovery is inside ensureHydrated).
      store.get(jobId);
      let row: any = null;
      const deadline = Date.now() + 3000;
      while (Date.now() < deadline) {
        row = await pgGetRow(jobId);
        if (row && row.status === "failed") break;
        await new Promise((r) => setTimeout(r, 25));
      }
      expect(row).not.toBeNull();
      expect(row.status).toBe("failed");
      expect(row.error).toMatch(/process restart/);
      expect(Number(row.completed_at)).toBeGreaterThan(0);
    });

    test("completed/pending jobs are NOT touched by recovery", async () => {
      const pid = testProjectId();
      const doneId = randomUUID();
      const pendId = randomUUID();
      const createdAt = Date.now();
      // Insert a completed and a pending row directly into PG.
      await prisma.$executeRaw`
        INSERT INTO index_jobs (
          job_id, project_id, project_path, status, current, total, percentage,
          files_indexed, chunks_indexed, errors, duration, error,
          created_at, started_at, completed_at, heartbeat_at
        ) VALUES (
          ${doneId}, ${pid}, ${"/done"}, ${"completed"},
          ${0}::int, ${0}::int, ${0}::int,
          NULL, NULL, NULL, NULL, NULL,
          ${createdAt}::bigint, NULL, ${createdAt}::bigint, NULL
        )
      `;
      await prisma.$executeRaw`
        INSERT INTO index_jobs (
          job_id, project_id, project_path, status, current, total, percentage,
          files_indexed, chunks_indexed, errors, duration, error,
          created_at, started_at, completed_at, heartbeat_at
        ) VALUES (
          ${pendId}, ${pid}, ${"/pend"}, ${"pending"},
          ${0}::int, ${0}::int, ${0}::int,
          NULL, NULL, NULL, NULL, NULL,
          ${createdAt}::bigint, NULL, NULL, NULL
        )
      `;

      const store = new PgJobStore();
      // Trigger hydration (which runs recovery) and let it settle.
      store.get(doneId);
      await new Promise((r) => setTimeout(r, 300));

      const doneRow = await pgGetRow(doneId);
      const pendRow = await pgGetRow(pendId);
      expect(doneRow.status).toBe("completed");
      expect(pendRow.status).toBe("pending");
    });
  });

  // ── tracker write-through + lazy-load (parity with SQLite test) ──────────

  describe("IndexJobTracker — write-through + lazy-load on PgJobStore", () => {
    test("a job created via a PgJobStore-backed tracker is correct in-memory and persists to PG", async () => {
      const pid = testProjectId();
      const store = new PgJobStore();
      await hydrateStore(store);
      const tracker = new IndexJobTracker(store);
      const job = tracker.createJob(pid, "/path");
      tracker.updateStatus(job.jobId, "running");
      tracker.updateProgress(job.jobId, 7, 10);
      tracker.setResult(job.jobId, {
        filesIndexed: 10,
        chunksIndexed: 50,
        errors: 0,
        duration: 99,
      });

      // 1) The tracker's in-memory + mirror state is the authoritative hot
      //    cache and is correct immediately (sync save contract).
      const live = tracker.getJob(job.jobId);
      expect(live).toBeDefined();
      expect(live!.status).toBe("completed");
      expect(live!.progress.percentage).toBe(70);
      expect(live!.result?.chunksIndexed).toBe(50);

      // 2) A new tracker over the SAME store lazy-loads the completed job from
      //    the mirror (no PG round-trip needed — the mirror saw every save).
      const tracker2 = new IndexJobTracker(store);
      const loaded = tracker2.getJob(job.jobId);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe("completed");
      expect(loaded!.progress.percentage).toBe(70);
      expect(loaded!.result?.chunksIndexed).toBe(50);

      // 3) The row lands in PG with the correct FINAL on-disk state. save()
      //    chains persists per-jobId so they commit in call order; after
      //    draining the in-flight writes the terminal state is deterministic.
      await store.__drain(job.jobId);
      const row = await pgGetRow(job.jobId);
      expect(row).not.toBeNull();
      expect(row.project_id).toBe(pid);
      expect(row.status).toBe("completed");
      expect(Number(row.percentage)).toBe(70);
    });
  });

  // ── reaper on PG (T8 parity) ─────────────────────────────────────────────

  describe("IndexJobTracker.reapStaleJobs — PG-backed", () => {
    test("reaps a stale `running` job (old heartbeat) → failed", async () => {
      // The reaper handles jobs that go stale DURING a process's life. Crash
      // recovery (which flips every `running` row → `failed` on first
      // hydration) is the OTHER mechanism and would swallow this scenario, so
      // we hydrate + recover the store first, then introduce a stale running
      // job via save() — modeling a job that's mid-flight in this process.
      const store = new PgJobStore();
      await hydrateStore(store);

      const pid = testProjectId();
      const staleHeartbeat = new Date(Date.now() - 60_000); // 60s ago
      const jobId = randomUUID();
      const staleJob = makeJob({
        jobId,
        projectId: pid,
        status: "running",
        progress: { current: 3, total: 10, percentage: 30 },
        startedAt: staleHeartbeat,
        heartbeatAt: staleHeartbeat,
      });
      store.save(staleJob);
      // Confirm the mirror sees it as running.
      expect(store.listRunning().map((j) => j.jobId)).toContain(jobId);

      const tracker = new IndexJobTracker(store);
      const reaped = tracker.reapStaleJobs(10_000); // 10s stale window
      expect(reaped).toBeGreaterThanOrEqual(1);
      const loaded = tracker.getJob(jobId);
      expect(loaded).toBeDefined();
      expect(loaded!.status).toBe("failed");
      expect(loaded!.error).toMatch(/heartbeat stale/i);
    });
  });

  // ── serialized write ordering (per-jobId commit order) ───────────────────
  //
  // PgJobStore.save() chains each persist onto the previous in-flight write for
  // the same jobId, so rapid successive saves (pending → running → progress →
  // completed) commit in call order. After draining the in-flight writes, the
  // FINAL on-disk PG status reflects the terminal state, not an intermediate.

  describe("Persistence — serialized write ordering", () => {
    test("rapid pending→running→completed saves land `completed` on disk after drain", async () => {
      const store = new PgJobStore();
      await hydrateStore(store);
      const pid = testProjectId();
      const jobId = randomUUID();
      const mk = (status: IndexJob["status"], pct: number): IndexJob =>
        makeJob({
          jobId,
          projectId: pid,
          status,
          progress: { current: pct, total: 100, percentage: pct },
        });
      // Fire several saves in rapid succession (mirrors tracker lifecycle).
      store.save(mk("pending", 0));
      store.save(mk("running", 30));
      store.save(mk("completed", 100));

      // The mirror (sync read path) is always correct: last write wins.
      expect(store.get(jobId)?.status).toBe("completed");
      expect(store.get(jobId)?.progress.percentage).toBe(100);

      // After draining the serialized write chain, the FINAL on-disk state is
      // the terminal state — NOT an intermediate (the old racy behavior settled
      // at status=running, percentage=30).
      await store.__drain(jobId);
      const row = await pgGetRow(jobId);
      expect(row).not.toBeNull();
      expect(row.project_id).toBe(pid);
      expect(row.status).toBe("completed");
      expect(Number(row.percentage)).toBe(100);
    });
  });
});
