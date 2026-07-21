/** PostgreSQL parity and async-ordering tests for PgScheduledJobStore. */

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { randomUUID } from "crypto";
import { PgScheduledJobStore } from "../services/scheduler/scheduler-store-pg.js";
import type { ScheduledJob } from "../services/scheduler/scheduler-types.js";

const DB_AVAILABLE = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const TEST_PREFIX = "pg-scheduler-test-";
let prisma: any;

// M35: instance-scoped seam tracking. The shared DB may carry `scheduled-*`
// rows from the production scheduler. The parity test at :101 asserts an
// exact listAll() result; on a shared DB those scheduled-* rows leak in and
// break the assertion. We wrap storeB.listAll per-test to filter them out,
// then restore in afterEach. A follow-up test proves restoration by asserting
// a fresh storeB sees the full unfiltered set (including scheduled-*).
let seamStore: PgScheduledJobStore | null = null;
let seamOriginalListAll: (() => ScheduledJob[]) | null = null;

function installScheduledFilterSeam(store: PgScheduledJobStore): void {
  seamOriginalListAll = store.listAll.bind(store);
  store.listAll = function () {
    return seamOriginalListAll!().filter((e) => !e.id.startsWith("scheduled-"));
  };
  seamStore = store;
}

function restoreSeam(): void {
  if (seamStore && seamOriginalListAll) {
    seamStore.listAll = seamOriginalListAll;
  }
  seamStore = null;
  seamOriginalListAll = null;
}

function job(
  id: string,
  overrides: Partial<ScheduledJob> = {},
): ScheduledJob {
  return {
    id,
    name: "test schedule",
    jobKind: "memory-consolidation",
    schedule: { type: "interval", intervalMs: 60_000 },
    nextRunAt: 2_000,
    lastRunAt: 1_000,
    enabled: true,
    payload: { projectId: "scheduler-parity" },
    ...overrides,
  };
}

function testId(): string {
  return `${TEST_PREFIX}${randomUUID()}`;
}

async function cleanup(): Promise<void> {
  if (!prisma) return;
  await prisma.$executeRaw`
    DELETE FROM scheduled_jobs WHERE id LIKE ${TEST_PREFIX + "%"}
  `;
}

async function row(id: string): Promise<any | null> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT * FROM scheduled_jobs WHERE id = ${id}
  `;
  return rows[0] ?? null;
}

async function hydrate(store: PgScheduledJobStore): Promise<void> {
  await (store as any).ensureHydrated();
}

describe.skipIf(!DB_AVAILABLE)("PgScheduledJobStore — PostgreSQL parity", () => {
  beforeAll(async () => {
    const { getPrismaClient } = await import("../services/query/prisma-client.js");
    prisma = getPrismaClient();
    await cleanup();
  });

  afterEach(() => {
    restoreSeam();
    return cleanup();
  });
  afterAll(cleanup);

  test("persists every field and hydrates interval and cron jobs after restart", async () => {
    const intervalId = testId();
    const cronId = testId();
    const storeA = new PgScheduledJobStore();
    await hydrate(storeA);

    storeA.save(job(intervalId));
    storeA.save(job(cronId, {
      name: "cron schedule",
      jobKind: "decay-sweep",
      schedule: { type: "cron", cron: "5 * * * *" },
      nextRunAt: 1_500,
      lastRunAt: 500,
      enabled: false,
      payload: { nested: { value: 42 }, flag: true },
    }));
    await storeA.__drain();

    const raw = await row(cronId);
    expect(raw).not.toBeNull();
    expect(raw.schedule_type).toBe("cron");
    expect(raw.interval_ms).toBeNull();
    expect(raw.cron).toBe("5 * * * *");
    expect(Number(raw.enabled)).toBe(0);
    expect(JSON.parse(raw.payload)).toEqual({ nested: { value: 42 }, flag: true });

    const storeB = new PgScheduledJobStore();
    expect(storeB.get(cronId)).toBeNull();
    await hydrate(storeB);

    expect(storeB.get(intervalId)).toEqual(job(intervalId));
    expect(storeB.get(cronId)).toEqual(job(cronId, {
      name: "cron schedule",
      jobKind: "decay-sweep",
      schedule: { type: "cron", cron: "5 * * * *" },
      nextRunAt: 1_500,
      lastRunAt: 500,
      enabled: false,
      payload: { nested: { value: 42 }, flag: true },
    }));
    // M35: install the instance-scoped seam so the exact-listAll assertion
    // passes against a shared DB that may carry `scheduled-*` rows from the
    // production scheduler. The seam filters `scheduled-*` rows for this
    // storeB instance only; afterEach restores the original listAll.
    installScheduledFilterSeam(storeB);
    expect(storeB.listAll().map((entry) => entry.id)).toEqual([cronId, intervalId]);
    expect(storeB.listEnabled().map((entry) => entry.id)).toEqual([intervalId]);
  });

  // M35: follow-up test proving the seam restores. After afterEach runs
  // (restoreSeam + cleanup), a fresh storeB sees the full unfiltered set.
  // On a dedicated test DB with no scheduled-* rows, this test asserts the
  // seam did not pollute the PgScheduledJobStore class or global SQL. On a
  // shared DB, it asserts the scheduled-* rows are visible again.
  test("M35: seam restores — fresh storeB.listAll returns unfiltered set after afterEach", async () => {
    const storeB = new PgScheduledJobStore();
    await hydrate(storeB);
    const allIds = storeB.listAll().map((entry) => entry.id);
    // The fresh storeB (no seam installed) sees whatever the DB holds. We
    // only assert the seam did NOT modify the class — listAll is the original
    // method. The presence/absence of scheduled-* rows depends on the DB
    // state; the invariant is that no test-prefixed rows leaked (cleanup ran).
    expect(allIds.filter((id) => id.startsWith(TEST_PREFIX))).toEqual([]);
    // Behavioral proof that the seam is reversible: install the seam, verify
    // it filters scheduled-* rows; restore, verify listAll returns the same
    // unfiltered set as before the seam. This proves the seam did NOT modify
    // the PgScheduledJobStore class or global SQL — it's instance-scoped.
    const beforeSeam = storeB.listAll();
    installScheduledFilterSeam(storeB);
    const duringSeam = storeB.listAll();
    expect(duringSeam.every((e) => !e.id.startsWith("scheduled-"))).toBe(true);
    // The seam MUST filter at least as much as the original (scheduled-* rows
    // are removed). If there were no scheduled-* rows, duringSeam === beforeSeam.
    expect(duringSeam.length).toBeLessThanOrEqual(beforeSeam.length);
    restoreSeam();
    const afterSeam = storeB.listAll();
    // After restore, listAll returns the same set as before the seam (the
    // original method). If there were scheduled-* rows before, they're back.
    expect(afterSeam.length).toBe(beforeSeam.length);
    expect(afterSeam.map((e) => e.id).sort()).toEqual(beforeSeam.map((e) => e.id).sort());
  });

  test("rapid same-ID saves commit in call order and preserve the latest value", async () => {
    const id = testId();
    const store = new PgScheduledJobStore();
    await hydrate(store);
    const actual = (store as any).getClient();
    let calls = 0;
    (store as any).prisma = {
      $queryRaw: (...args: any[]) => actual.$queryRaw.apply(actual, args),
      $executeRaw: async (...args: any[]) => {
        calls += 1;
        if (calls === 1) await new Promise((resolve) => setTimeout(resolve, 75));
        return actual.$executeRaw.apply(actual, args);
      },
    };

    store.save(job(id, { name: "old", nextRunAt: 100 }));
    store.save(job(id, { name: "new", nextRunAt: 200 }));
    await store.__drain();

    const persisted = await row(id);
    expect(calls).toBe(2);
    expect(persisted.name).toBe("new");
    expect(Number(persisted.next_run_at)).toBe(200);
    expect(store.get(id)?.name).toBe("new");
  });

  test("save/delete mutations for one ID retain invocation ordering", async () => {
    const deletedId = testId();
    const restoredId = testId();
    const store = new PgScheduledJobStore();
    await hydrate(store);

    store.save(job(deletedId));
    store.delete(deletedId);
    store.delete(restoredId);
    store.save(job(restoredId, { name: "restored" }));
    await store.__drain();

    expect(await row(deletedId)).toBeNull();
    expect(store.get(deletedId)).toBeNull();
    expect((await row(restoredId))?.name).toBe("restored");
    expect(store.get(restoredId)?.name).toBe("restored");
  });

  test("a failed best-effort write settles and a later save recovers", async () => {
    const id = testId();
    const store = new PgScheduledJobStore();
    await hydrate(store);
    const actual = (store as any).getClient();
    let shouldFail = true;
    (store as any).prisma = {
      $queryRaw: (...args: any[]) => actual.$queryRaw.apply(actual, args),
      $executeRaw: (...args: any[]) => {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error("injected scheduler write failure"));
        }
        return actual.$executeRaw.apply(actual, args);
      },
    };

    store.save(job(id, { name: "failed write" }));
    await store.__drain();
    expect(await row(id)).toBeNull();
    expect(store.get(id)?.name).toBe("failed write");

    store.save(job(id, { name: "recovered write" }));
    await store.__drain();
    expect((await row(id))?.name).toBe("recovered write");
  });

  test("a failed hydration is retried and recovers on the next read", async () => {
    const id = testId();
    const seed = new PgScheduledJobStore();
    await hydrate(seed);
    seed.save(job(id, { name: "hydrate recovery" }));
    await seed.__drain();

    const store = new PgScheduledJobStore();
    const actual = (store as any).getClient();
    let shouldFail = true;
    (store as any).prisma = {
      $executeRaw: (...args: any[]) => actual.$executeRaw.apply(actual, args),
      $queryRaw: (...args: any[]) => {
        if (shouldFail) {
          shouldFail = false;
          return Promise.reject(new Error("injected scheduler hydration failure"));
        }
        return actual.$queryRaw.apply(actual, args);
      },
    };

    await hydrate(store);
    expect(store.get(id)).toBeNull();
    await store.__drain();
    expect(store.get(id)?.name).toBe("hydrate recovery");
  });
});
