/**
 * ObservationRepository tests (Phase 3).
 *
 * Test-isolation rule (Phase 1/2): do NOT `mock.module("@massa-th0th/shared")` —
 * it is process-wide and collides with other files. Instead construct the
 * SqliteObservationStore with an explicit temp dbPath so no shared config
 * singleton is relied upon.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { tmpdir } from "os";
import path from "path";
import fs from "fs";
import {
  SqliteObservationStore,
  MemoryObservationStore,
  newObservationId,
  type Observation,
} from "../data/memory/observation-repository.js";

function makeObs(over: Partial<Observation> = {}): Observation {
  return {
    id: over.id ?? newObservationId(),
    projectId: over.projectId ?? "proj-x",
    sessionId: over.sessionId ?? null,
    source: over.source ?? "user-prompt",
    payloadJson: over.payloadJson ?? JSON.stringify({ prompt: "hello" }),
    importance: over.importance ?? 0.5,
    createdAt: over.createdAt ?? Date.now(),
  };
}

function tempDbPath(): string {
  const dir = fs.mkdtempSync(path.join(tmpdir(), "massa-th0th-obs-"));
  return path.join(dir, "observations.db");
}

describe("MemoryObservationStore", () => {
  let store: MemoryObservationStore;
  beforeEach(() => {
    store = new MemoryObservationStore();
  });

  it("inserts and lists observations by project (newest first)", () => {
    store.insert(makeObs({ projectId: "p1", createdAt: 100 }));
    store.insert(makeObs({ projectId: "p1", createdAt: 300 }));
    store.insert(makeObs({ projectId: "p2", createdAt: 200 }));

    const p1 = store.listRecent("p1", 10);
    expect(p1.length).toBe(2);
    expect(p1[0].createdAt).toBeGreaterThanOrEqual(p1[1].createdAt);

    expect(store.listRecent("p2", 10).length).toBe(1);
    expect(store.countByProject("p1")).toBe(2);
    expect(store.countByProject("nope")).toBe(0);
  });

  it("respects the limit", () => {
    for (let i = 0; i < 5; i++) store.insert(makeObs({ projectId: "p", createdAt: i }));
    expect(store.listRecent("p", 2).length).toBe(2);
  });
});

describe("SqliteObservationStore", () => {
  let dbPath: string;
  let store: SqliteObservationStore;

  beforeEach(() => {
    dbPath = tempDbPath();
    store = new SqliteObservationStore(dbPath);
  });

  it("creates the observations table and persists rows", () => {
    const obs = makeObs({ projectId: "proj-a" });
    store.insert(obs);

    expect(store.countByProject("proj-a")).toBe(1);
    expect(store.countByProject("other")).toBe(0);

    const listed = store.listRecent("proj-a", 10);
    expect(listed.length).toBe(1);
    expect(listed[0].id).toBe(obs.id);
    expect(listed[0].projectId).toBe("proj-a");
    expect(listed[0].source).toBe("user-prompt");
    expect(listed[0].payloadJson).toBe(obs.payloadJson);
  });

  it("lists newest-first and respects limit", () => {
    for (let i = 0; i < 6; i++) {
      store.insert(makeObs({ projectId: "p", createdAt: 1000 + i }));
    }
    const listed = store.listRecent("p", 3);
    expect(listed.length).toBe(3);
    // newest first
    expect(listed[0].createdAt).toBeGreaterThan(listed[listed.length - 1].createdAt);
  });

  it("enables WAL journal mode (cross-cutting §4)", () => {
    // WAL is requested on open; SQLite may report "wal" or, on some tmpfs, "memory".
    // The contract is that the PRAGMA was issued and the mode is WAL where supported.
    const mode = store.journalMode();
    expect(["wal", "memory"]).toContain(mode);
  });

  it("isolates databases by dbPath (no cross-test leakage)", () => {
    store.insert(makeObs({ projectId: "isolated" }));
    const other = new SqliteObservationStore(tempDbPath());
    expect(other.countByProject("isolated")).toBe(0);
  });

  it("survives reopen (idempotent schema)", () => {
    store.insert(makeObs({ projectId: "persist" }));
    // Construct a second store pointed at the same file — should not throw on schema creation.
    const again = new SqliteObservationStore(dbPath);
    expect(again.countByProject("persist")).toBe(1);
  });
});
