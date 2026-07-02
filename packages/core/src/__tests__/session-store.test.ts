/**
 * Unit tests for SqliteSessionStore + SessionRegistry durability (Phase 1, P1-SESSIONS).
 *
 * Drives the real SQLite store against a temp dbPath (no config mock needed —
 * the store ctor accepts an explicit path). Proves round-trip persistence,
 * LRU access-history preservation, expiry-on-load, and write-through from the
 * registry.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import { SqliteSessionStore, MemorySessionStore } from "../services/synapse/session/session-store.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import type { AgentSession } from "../services/synapse/types.js";

let dbPath: string;
let tmpDir: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "th0th-sess-"));
  dbPath = path.join(tmpDir, "sessions.db");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function mkSession(over: Partial<AgentSession> = {}): AgentSession {
  return {
    sessionId: "s1",
    agentId: "agent-x",
    workspaceId: "ws-1",
    taskContext: "fix the auth bug",
    taskTokens: new Set(["fix", "the", "auth", "bug"]),
    taskEmbedding: [0.1, 0.2, 0.3],
    ttlMs: 3_600_000,
    createdAt: 1_000_000,
    expiresAt: 1_000_000 + 3_600_000,
    accessHistory: new Map(),
    accessHistoryLimit: 1000,
    ...over,
  };
}

describe("SqliteSessionStore — round-trip", () => {
  test("save then load returns the persisted scalar fields + tokens + embedding", () => {
    const store = new SqliteSessionStore(dbPath);
    const s = mkSession();
    s.accessHistory.set("mem-1", 3);
    s.accessHistory.set("mem-2", 1);
    store.save(s);

    const loaded = store.load("s1");
    expect(loaded).not.toBeNull();
    expect(loaded!.agentId).toBe("agent-x");
    expect(loaded!.taskContext).toBe("fix the auth bug");
    expect(loaded!.taskTokens).toEqual(new Set(["fix", "the", "auth", "bug"]));
    const emb = Array.from(loaded!.taskEmbedding as number[]);
    expect(emb.length).toBe(3);
    expect(emb[0]).toBeCloseTo(0.1, 5);
    expect(emb[1]).toBeCloseTo(0.2, 5);
    expect(emb[2]).toBeCloseTo(0.3, 5);
  });

  test("accessHistory is preserved on load", () => {
    const store = new SqliteSessionStore(dbPath);
    const s = mkSession();
    s.accessHistory.set("mem-a", 5);
    s.accessHistory.set("mem-b", 2);
    store.save(s);

    const loaded = store.load("s1")!;
    expect(loaded.accessHistory.get("mem-a")).toBe(5);
    expect(loaded.accessHistory.get("mem-b")).toBe(2);
    expect(loaded.accessHistory.size).toBe(2);
  });

  test("load on a missing session returns null", () => {
    const store = new SqliteSessionStore(dbPath);
    expect(store.load("nope")).toBeNull();
  });

  test("delete removes the session and its access history", () => {
    const store = new SqliteSessionStore(dbPath);
    const s = mkSession();
    s.accessHistory.set("mem-1", 1);
    store.save(s);
    store.delete("s1");
    expect(store.load("s1")).toBeNull();
  });

  test("recordAccess persists an access touch independently", () => {
    const store = new SqliteSessionStore(dbPath);
    store.save(mkSession());
    store.recordAccess("s1", "mem-x", 4);
    const loaded = store.load("s1")!;
    expect(loaded.accessHistory.get("mem-x")).toBe(4);
  });

  test("upsert (re-save) updates fields without duplicating rows", () => {
    const store = new SqliteSessionStore(dbPath);
    store.save(mkSession({ taskContext: "first" }));
    store.save(mkSession({ taskContext: "second" }));
    const loaded = store.load("s1")!;
    expect(loaded.taskContext).toBe("second");
  });
});

describe("MemorySessionStore — no-op fallback", () => {
  test("load always returns null (ephemeral)", () => {
    const store = new MemorySessionStore();
    store.save(mkSession());
    expect(store.load("s1")).toBeNull();
  });
});

describe("SessionRegistry — write-through + lazy-load", () => {
  test("a session created via a store-backed registry persists and reloads after the hot cache is dropped", () => {
    const store = new SqliteSessionStore(dbPath);
    const reg = new SessionRegistry(3_600_000, store);

    reg.create({
      sessionId: "r1",
      agentId: "a",
      taskContext: "build the feature",
    });
    reg.recordAccess("r1", "mem-1");
    reg.recordAccess("r1", "mem-2");
    reg.recordAccess("r1", "mem-1"); // bump to 2

    // Simulate a process restart: new registry, same store (same db file).
    const reg2 = new SessionRegistry(3_600_000, store);
    const loaded = reg2.get("r1");
    expect(loaded).not.toBeNull();
    expect(loaded!.taskContext).toBe("build the feature");
    expect(loaded!.accessHistory.get("mem-1")).toBe(2);
    expect(loaded!.accessHistory.get("mem-2")).toBe(1);
  });

  test("an expired persisted session is discarded on load (not returned)", () => {
    const store = new SqliteSessionStore(dbPath);
    const now = Date.now();
    // Save a session that already expired.
    store.save(
      mkSession({
        sessionId: "exp",
        createdAt: now - 10_000,
        expiresAt: now - 1, // expired
      }),
    );
    const reg = new SessionRegistry(3_600_000, store);
    expect(reg.get("exp")).toBeNull();
  });

  test("delete removes from the store as well", () => {
    const store = new SqliteSessionStore(dbPath);
    const reg = new SessionRegistry(3_600_000, store);
    reg.create({ sessionId: "d1", agentId: "a" });
    expect(reg.get("d1")).not.toBeNull();
    reg.delete("d1");
    // New registry over the same store must not find it either.
    const reg2 = new SessionRegistry(3_600_000, store);
    expect(reg2.get("d1")).toBeNull();
  });
});
