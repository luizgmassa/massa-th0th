/**
 * Tests for MemoryConsolidationJob — throttle + PostgreSQL integration.
 *
 * The SQLite integration tests (LLM-off/on, SUPERSEDES edges, pinned-exempt,
 * recall hides sources) live in memory-crud.test.ts, because bun's
 * `mock.module("@massa-th0th/shared")` is process-wide and two files mocking the
 * same module collide. memory-crud.test.ts already mocks config for the memory
 * subsystem, so the consolidation SQLite scenarios co-locate there.
 *
 * Phase 1 reshaped this job: backend-polymorphic (no `isPostgresEnabled()`
 * short-circuit), decay via the pure `decayScore` (pinned-exempt), prune is
 * soft-delete, plus a new LLM merge phase (default-off, silent-degrade).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MemoryConsolidationJob } from "../services/jobs/memory-consolidation-job.js";

// ── maybeRun throttle (no config mock needed) ───────────────────────────────

describe("maybeRun throttle", () => {
  test("does not run twice within the minimum interval", async () => {
    const job = new MemoryConsolidationJob();
    let runCount = 0;
    (job as any).runOnce = async () => { runCount++; };
    (job as any).minIntervalMs = 60_000;

    job.maybeRun("store");
    job.maybeRun("store");

    await new Promise((r) => setTimeout(r, 50));
    expect(runCount).toBe(1);
  });

  test("runs again after interval elapsed", async () => {
    const job = new MemoryConsolidationJob();
    let runCount = 0;
    (job as any).runOnce = async () => { runCount++; };
    (job as any).minIntervalMs = 10;
    (job as any).lastRunAt = Date.now() - 100;

    job.maybeRun("store");
    await new Promise((r) => setTimeout(r, 50));
    expect(runCount).toBe(1);
  });

  test("maybeRun never short-circuits on SQLite (no isPostgresEnabled gate)", async () => {
    // The legacy job no-op'd on SQLite via isPostgresEnabled(). The new job
    // dispatches polymorphically; verify it attempts a run on SQLite env.
    const job = new MemoryConsolidationJob();
    let attempted = false;
    (job as any).runOnce = async () => { attempted = true; };
    (job as any).minIntervalMs = 10;
    (job as any).lastRunAt = 0;

    job.maybeRun("store");
    await new Promise((r) => setTimeout(r, 50));
    expect(attempted).toBe(true);
  });
});

// ── PostgreSQL integration (skipped without DATABASE_URL=postgres) ──────────
// Adapted to the Phase-1 private-method signatures. These exercise the PG
// decay/promote/prune raw-SQL paths when a Postgres service is available.

const DB_AVAILABLE = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const TEST_PREFIX = "cjtest_";
let prisma: any;

const LEVEL_MAP: Record<string, number> = {
  persistent: 0,
  project: 1,
  user: 2,
  session: 3,
};

async function pgInsertMemory(opts: {
  type: string;
  importance: number;
  level?: string;
  createdAt?: Date;
  lastAccessed?: Date | null;
  accessCount?: number;
}): Promise<string> {
  const id = `${TEST_PREFIX}${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const stale = new Date(Date.now() - 10 * 24 * 60 * 60 * 1000);
  const level = LEVEL_MAP[opts.level ?? "session"] ?? 0;
  const createdAt = opts.createdAt ?? stale;
  const lastAccessed = opts.lastAccessed !== undefined ? opts.lastAccessed : stale;
  const accessCount = opts.accessCount ?? 0;

  await prisma.$executeRaw`
    INSERT INTO memories (id, content, type, importance, level, created_at, updated_at,
                          last_accessed, access_count, embedding)
    VALUES (
      ${id}, ${"Test memory for " + opts.type}, ${opts.type}, ${opts.importance},
      ${level}, ${createdAt}, ${createdAt}, ${lastAccessed}, ${accessCount}, NULL
    )
  `;
  return id;
}

async function pgGetImportance(id: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ importance: number }[]>`
    SELECT importance FROM memories WHERE id = ${id}`;
  return rows[0]?.importance ?? null;
}

async function pgGetLevel(id: string): Promise<number | null> {
  const rows = await prisma.$queryRaw<{ level: number }[]>`
    SELECT level FROM memories WHERE id = ${id}`;
  return rows[0]?.level ?? null;
}

async function pgCleanup() {
  await prisma.$executeRaw`DELETE FROM memories WHERE id LIKE ${TEST_PREFIX + "%"}`;
}

describe.skipIf(!DB_AVAILABLE)(
  "MemoryConsolidationJob — PostgreSQL integration",
  () => {
    const day = 24 * 60 * 60 * 1000;

    beforeAll(async () => {
      const { getPrismaClient } = await import("../services/query/prisma-client.js");
      prisma = getPrismaClient();
      await pgCleanup();
    });
    afterAll(async () => {
      await pgCleanup();
      const { disconnectPrisma } = await import("../services/query/prisma-client.js");
      await disconnectPrisma();
    });
    beforeEach(pgCleanup);

    test("decay writes back decayScore for stale, non-pinned rows", async () => {
      const job = new MemoryConsolidationJob();
      const id = await pgInsertMemory({ type: "decision", importance: 0.6 });
      const before = await pgGetImportance(id);
      await job.consolidate();
      const after = await pgGetImportance(id);
      expect(after).not.toBeNull();
      // decayScore < original for a 10-day-old, never-accessed memory.
      expect(after!).toBeLessThan(before!);
    });

    test("promote: eligible session memory → user level", async () => {
      const job = new MemoryConsolidationJob();
      const old = new Date(Date.now() - 2 * day);
      const id = await pgInsertMemory({
        type: "decision",
        importance: 0.75,
        level: "session",
        createdAt: old,
        accessCount: 5,
      });
      await job.consolidate();
      expect(await pgGetLevel(id)).toBe(LEVEL_MAP.user);
    });

    test("prune: soft-deletes very old low-signal memories (tombstone, not hard-delete)", async () => {
      const job = new MemoryConsolidationJob();
      const veryOld = new Date(Date.now() - 50 * day);
      const id = await pgInsertMemory({
        type: "conversation",
        importance: 0.15,
        createdAt: veryOld,
        accessCount: 0,
      });
      await job.consolidate();
      // Soft-delete: row still exists but has deleted_at set.
      const rows = await prisma.$queryRaw<{ deleted_at: Date | null }[]>`
        SELECT deleted_at FROM memories WHERE id = ${id}`;
      expect(rows[0]?.deleted_at).not.toBeNull();
    });
  },
);
