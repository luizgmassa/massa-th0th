/**
 * Unit tests for PgSynapseSessionStore + factory dispatch (Phase 3, C4).
 *
 * Mirrors session-store.test.ts (SQLite) cases, adapted for
 * PgSynapseSessionStore's async-mirror design:
 *   - save() updates an in-memory mirror SYNCHRONOUSLY (sync read contract);
 *     the PG row lands fire-and-forget.
 *   - a fresh PgSynapseSessionStore hydrates its mirror from PG on first use.
 *
 * The persistence round-trip + resume-after-restart tests await the
 * fire-and-forget write by polling a direct PG query ($queryRaw via the shared
 * prisma client) and by forcing hydration. The mirror-sync-read case asserts
 * the synchronous contract directly.
 *
 * Hygiene: all test sessions use a test-only sessionId prefix
 * (`pg-synapse-test-…`) and are deleted in afterEach + afterAll. The shared DB
 * is left clean. Tests are skipped when DATABASE_URL is not postgres.
 */

import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import { randomUUID } from "crypto";

// ── Mock logger only (shared, no dedicated test file) ───────────────────────
const mockLogger = {
  info: mock(() => {}),
  warn: mock(() => {}),
  error: mock(() => {}),
  debug: mock(() => {}),
  metric: mock(() => {}),
};

mock.module("@massa-th0th/shared", () => {
  const actual = require("@massa-th0th/shared");
  return { ...actual, logger: mockLogger };
});

// ── Import after mock ───────────────────────────────────────────────────────
import { PgSynapseSessionStore } from "../services/synapse/session/session-store-pg.js";
import {
  getSessionStore,
  resetSessionStore,
  MemorySessionStore,
} from "../services/synapse/session/session-store.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import type { AgentSession } from "../services/synapse/types.js";
import { WorkingMemoryBuffer } from "../services/synapse/buffer/working-memory-buffer.js";
import type { SearchResult } from "@massa-th0th/shared";

const DB_AVAILABLE = (process.env.DATABASE_URL ?? "").startsWith("postgres");
const TEST_PREFIX = "pg-synapse-test-";
let prisma: any;

// ── helpers ──────────────────────────────────────────────────────────────────

function testSessionId(): string {
  return `${TEST_PREFIX}${randomUUID()}`;
}

function mkSession(over: Partial<AgentSession> & { sessionId: string }): AgentSession {
  const now = Date.now();
  return {
    agentId: "agent-x",
    workspaceId: "ws-1",
    taskContext: "fix the auth bug",
    taskTokens: new Set(["fix", "the", "auth", "bug"]),
    taskEmbedding: [0.1, 0.2, 0.3],
    ttlMs: 3_600_000,
    createdAt: now,
    expiresAt: now + 3_600_000,
    accessHistory: new Map(),
    accessHistoryLimit: 1000,
    ...over,
  };
}

function mkResult(id: string, score = 0.8): SearchResult {
  return {
    id,
    content: `content for ${id}`,
    score,
    source: "vector" as any,
    metadata: {} as any,
  };
}

/** Read a raw synapse_sessions row straight from PG (bypasses the mirror). */
async function pgGetSessionRow(sessionId: string): Promise<any | null> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT * FROM synapse_sessions WHERE session_id = ${sessionId}`;
  return rows[0] ?? null;
}

/** Read raw synapse_access_history rows straight from PG. */
async function pgGetAccessRows(sessionId: string): Promise<any[]> {
  const rows = await prisma.$queryRaw<any[]>`
    SELECT * FROM synapse_access_history WHERE session_id = ${sessionId}`;
  return rows;
}

/** Wait until a session row is visible in PG, or timeout. */
async function waitForPGSession(
  sessionId: string,
  timeoutMs = 3000,
): Promise<any | null> {
  const deadline = Date.now() + timeoutMs;
  let row: any | null = null;
  while (Date.now() < deadline) {
    row = await pgGetSessionRow(sessionId);
    if (row) return row;
    await new Promise((r) => setTimeout(r, 25));
  }
  return row;
}

/**
 * Force a PgSynapseSessionStore to complete its (fire-and-forget) first
 * hydration BEFORE the test saves anything. Hydration clears + repopulates the
 * mirror from PG, so a save() made before hydration lands can be clobbered when
 * hydration resolves. Hydrating up front mirrors a warm process.
 */
async function hydrateStore(store: PgSynapseSessionStore): Promise<void> {
  await store.__hydrate();
}

async function pgCleanup() {
  if (!prisma) return;
  // Delete access history first (FK-less but logically dependent), then sessions.
  await prisma.$executeRaw`DELETE FROM synapse_access_history WHERE session_id LIKE ${TEST_PREFIX + "%"}`;
  await prisma.$executeRaw`DELETE FROM synapse_sessions WHERE session_id LIKE ${TEST_PREFIX + "%"}`;
}

// ── suite ────────────────────────────────────────────────────────────────────

describe.skipIf(!DB_AVAILABLE)("PgSynapseSessionStore — unit tests on PostgreSQL", () => {
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

  beforeEach(() => {
    mockLogger.info.mockClear();
    return pgCleanup();
  });
  afterEach(pgCleanup);

  // ── mirror sync read (the sync SessionStore contract) ───────────────────

  describe("mirror sync read", () => {
    test("save() makes load() return the session synchronously (mirror hit)", () => {
      const store = new PgSynapseSessionStore();
      const sid = testSessionId();
      const s = mkSession({ sessionId: sid });
      store.save(s);
      // No await: the mirror is updated synchronously inside save().
      const loaded = store.load(sid);
      expect(loaded).not.toBeNull();
      expect(loaded!.sessionId).toBe(sid);
      expect(loaded!.agentId).toBe("agent-x");
      expect(loaded!.taskContext).toBe("fix the auth bug");
    });

    test("load() on an unknown id returns null (mirror miss, pre-hydration)", () => {
      const store = new PgSynapseSessionStore();
      expect(store.load("definitely-not-a-real-session-id")).toBeNull();
    });
  });

  // ── persistence round-trip (fire-and-forget write → PG row) ─────────────

  describe("persistence round-trip", () => {
    test("save() lands the session row in PG with scalar fields + tokens + embedding", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      const s = mkSession({
        sessionId: sid,
        taskContext: "build the feature",
        taskTokens: new Set(["build", "the", "feature"]),
        taskEmbedding: [0.4, 0.5, 0.6],
      });
      s.accessHistory.set("mem-1", 3);
      s.accessHistory.set("mem-2", 1);
      store.save(s);

      const row = await waitForPGSession(sid);
      expect(row).not.toBeNull();
      expect(row.agent_id).toBe("agent-x");
      expect(row.task_context).toBe("build the feature");
      expect(JSON.parse(row.task_tokens)).toEqual(["build", "the", "feature"]);
      expect(Number(row.ttl_ms)).toBe(3_600_000);
      // access history rows persisted
      const access = await pgGetAccessRows(sid);
      expect(access.length).toBe(2);
      const counts = Object.fromEntries(access.map((a) => [a.memory_id, Number(a.access_count)]));
      expect(counts["mem-1"]).toBe(3);
      expect(counts["mem-2"]).toBe(1);
    });

    test("taskEmbedding round-trips through the BYTEA column", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      const emb = [0.1, 0.2, 0.3, 0.4, 0.5];
      store.save(mkSession({ sessionId: sid, taskEmbedding: emb }));

      const row = await waitForPGSession(sid);
      expect(row).not.toBeNull();
      expect(row.task_embedding).not.toBeNull();
      // Reconstruct the Float32 array from the BYTEA buffer (as the store does).
      const buf = Buffer.from(row.task_embedding);
      const back = Array.from(new Float32Array(buf.buffer, buf.byteOffset, buf.length / 4));
      expect(back.length).toBe(5);
      expect(back[0]).toBeCloseTo(0.1, 5);
      expect(back[4]).toBeCloseTo(0.5, 5);
    });

    test("buffer snapshot round-trips as a JSON blob in buffer_snapshot", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      const s = mkSession({ sessionId: sid });
      const buf = new WorkingMemoryBuffer({ maxSize: 20, ttlMs: 900_000, hitBoost: 1.3, matchThreshold: 0.4 });
      buf.prime([mkResult("r1", 0.9), mkResult("r2", 0.7)]);
      s.buffer = buf;
      store.save(s);

      const row = await waitForPGSession(sid);
      expect(row).not.toBeNull();
      expect(row.buffer_snapshot).not.toBeNull();
      const snap = JSON.parse(row.buffer_snapshot);
      expect(snap.entries.length).toBe(2);
      const ids = snap.entries.map((e: any) => e.id).sort();
      expect(ids).toEqual(["r1", "r2"]);
      expect(snap.config.maxSize).toBe(20);
      // baselineScore preserved per entry.
      const r1 = snap.entries.find((e: any) => e.id === "r1");
      expect(r1.baselineScore).toBeCloseTo(0.9, 5);
    });

    test("repeated save() upserts the same row (ON CONFLICT update)", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      store.save(mkSession({ sessionId: sid, taskContext: "first" }));
      store.save(mkSession({ sessionId: sid, taskContext: "second" }));
      await store.__drain();

      const row = await waitForPGSession(sid);
      expect(row).not.toBeNull();
      expect(row.task_context).toBe("second");
    });

    test("recordAccess persists an access touch independently in PG", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      store.save(mkSession({ sessionId: sid }));
      store.recordAccess(sid, "mem-x", 4);
      await store.__drain();

      const access = await pgGetAccessRows(sid);
      expect(access.length).toBe(1);
      expect(access[0].memory_id).toBe("mem-x");
      expect(Number(access[0].access_count)).toBe(4);
    });
  });

  // ── resume after restart (new store hydrates from PG) ───────────────────

  describe("resume after restart", () => {
    test("a session persisted by one store loads from PG in a fresh store after the mirror is reset", async () => {
      const storeA = new PgSynapseSessionStore();
      await hydrateStore(storeA);
      const sid = testSessionId();
      const s = mkSession({
        sessionId: sid,
        taskContext: "resume me",
        taskTokens: new Set(["resume", "me"]),
      });
      s.accessHistory.set("mem-a", 5);
      s.accessHistory.set("mem-b", 2);
      storeA.save(s);
      await storeA.__drain();

      // Simulate a process restart: new store instance, empty mirror.
      const storeB = new PgSynapseSessionStore();
      // Before hydration, the mirror is empty → load returns null.
      expect(storeB.load(sid)).toBeNull();
      // After hydration, the session + access history load from PG.
      await hydrateStore(storeB);
      const loaded = storeB.load(sid);
      expect(loaded).not.toBeNull();
      expect(loaded!.taskContext).toBe("resume me");
      expect(loaded!.taskTokens).toEqual(new Set(["resume", "me"]));
      expect(loaded!.accessHistory.get("mem-a")).toBe(5);
      expect(loaded!.accessHistory.get("mem-b")).toBe(2);
    });

    test("registry resume: a store-backed registry reloads a persisted session after registry reset", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      const reg = new SessionRegistry(3_600_000, store);
      reg.create({ sessionId: sid, agentId: "a", taskContext: "build the feature" });
      reg.recordAccess(sid, "mem-1");
      reg.recordAccess(sid, "mem-2");
      reg.recordAccess(sid, "mem-1"); // bump to 2
      await store.__drain();

      // Simulate a process restart: new registry over the SAME store type, but
      // with a fresh mirror that must hydrate from PG.
      const store2 = new PgSynapseSessionStore();
      const reg2 = new SessionRegistry(3_600_000, store2);
      // First get() triggers lazy-load via the store; the mirror is empty until
      // hydration settles, so trigger + await hydration explicitly.
      void reg2.get(sid);
      await hydrateStore(store2);
      const loaded = reg2.get(sid);
      expect(loaded).not.toBeNull();
      expect(loaded!.taskContext).toBe("build the feature");
      expect(loaded!.accessHistory.get("mem-1")).toBe(2);
      expect(loaded!.accessHistory.get("mem-2")).toBe(1);
    });

    test("delete removes the session and its access history from PG", async () => {
      const store = new PgSynapseSessionStore();
      await hydrateStore(store);
      const sid = testSessionId();
      const s = mkSession({ sessionId: sid });
      s.accessHistory.set("mem-1", 1);
      store.save(s);
      await store.__drain();
      expect(await pgGetSessionRow(sid)).not.toBeNull();

      store.delete(sid);
      await store.__drain();
      expect(await pgGetSessionRow(sid)).toBeNull();
      expect(await pgGetAccessRows(sid)).toEqual([]);
    });
  });
});

// ── Factory dispatch (runs regardless of DB availability) ─────────────────────

describe("getSessionStore factory dispatch", () => {
  afterEach(() => {
    resetSessionStore();
  });

  test("selects PgSynapseSessionStore when DATABASE_URL is postgres", () => {
    const original = process.env.DATABASE_URL;
    try {
      process.env.DATABASE_URL = "postgresql://user:pass@localhost:5432/db";
      const store = getSessionStore();
      // Constructor is the PG variant (the import is lazy; check the class name).
      expect(store.constructor.name).toBe("PgSynapseSessionStore");
    } finally {
      if (original === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = original;
      resetSessionStore();
    }
  });

  test("selects SqliteSessionStore when DATABASE_URL is not postgres", () => {
    const original = process.env.DATABASE_URL;
    try {
      delete process.env.DATABASE_URL;
      const store = getSessionStore();
      expect(store.constructor.name).toBe("SqliteSessionStore");
    } finally {
      if (original !== undefined) process.env.DATABASE_URL = original;
      resetSessionStore();
    }
  });
});

// ── No-op fallback behavior (always available) ────────────────────────────────

describe("MemorySessionStore — no-op fallback", () => {
  test("load always returns null (ephemeral) — disabled/no-op behavior preserved", () => {
    const store = new MemorySessionStore();
    store.save(mkSession({ sessionId: "noop-1" }));
    expect(store.load("noop-1")).toBeNull();
    expect(store.load("anything")).toBeNull();
    // delete/recordAccess are no-ops (do not throw).
    store.delete("noop-1");
    store.recordAccess("noop-1", "mem", 1);
  });
});
