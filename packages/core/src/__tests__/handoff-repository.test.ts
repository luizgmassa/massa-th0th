/**
 * SqliteHandoffStore tests (Phase 6 — handoff store, direct unit).
 *
 * Mirrors observation-repository.test.ts: explicit temp dbPath, no
 * process-wide shared-config mock.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import {
  SqliteHandoffStore,
  MemoryHandoffStore,
  newHandoffId,
  type HandoffRecord,
} from "../data/handoff/handoff-repository.js";

function makeRecord(overrides: Partial<HandoffRecord> = {}): HandoffRecord {
  return {
    id: newHandoffId(),
    projectId: "proj-sqlite",
    sourceSessionId: "s1",
    targetAgent: "a1",
    summary: "summary",
    openQuestions: ["q"],
    nextSteps: ["n"],
    files: ["f"],
    status: "open",
    createdAt: Date.now(),
    acceptedAt: null,
    ...overrides,
  };
}

describe("SqliteHandoffStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SqliteHandoffStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-handoff-sqlite-"));
    dbPath = path.join(tmpDir, "handoffs.db");
    store = new SqliteHandoffStore(dbPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("insert + getById round-trips a handoff (JSON cols parsed)", () => {
    const rec = makeRecord({
      openQuestions: ["q1", "q2"],
      nextSteps: ["n1"],
      files: ["f1", "f2"],
    });
    store.insert(rec);
    const got = store.getById(rec.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(rec.id);
    expect(got!.projectId).toBe("proj-sqlite");
    expect(got!.summary).toBe("summary");
    expect(got!.openQuestions).toEqual(["q1", "q2"]);
    expect(got!.nextSteps).toEqual(["n1"]);
    expect(got!.files).toEqual(["f1", "f2"]);
    expect(got!.status).toBe("open");
    expect(got!.acceptedAt).toBeNull();
  });

  it("getById missing -> null", () => {
    expect(store.getById("nope")).toBeNull();
  });

  it("listPending filters by project + status + targetAgent (null matches)", () => {
    const t = Date.now();
    store.insert(makeRecord({ id: "h1", projectId: "p1", targetAgent: "a1", createdAt: t }));
    store.insert(makeRecord({ id: "h2", projectId: "p1", targetAgent: "a2", createdAt: t + 1 }));
    store.insert(makeRecord({ id: "h3", projectId: "p1", targetAgent: null, createdAt: t + 2 }));
    store.insert(makeRecord({ id: "h4", projectId: "p2", targetAgent: "a1", createdAt: t + 3 }));

    const allP1 = store.listPending("p1");
    expect(allP1.map((r) => r.id).sort()).toEqual(["h1", "h2", "h3"]);

    const a1 = store.listPending("p1", "a1");
    expect(a1.map((r) => r.id).sort()).toEqual(["h1", "h3"]); // h3 broadcast null included

    const none = store.listPending("p1", "nope");
    expect(none.map((r) => r.id).sort()).toEqual(["h3"]); // broadcast only
  });

  it("listPending excludes non-open + orders oldest-first", () => {
    const t = Date.now();
    store.insert(makeRecord({ id: "h1", projectId: "po", createdAt: t }));
    store.insert(makeRecord({ id: "h2", projectId: "po", createdAt: t + 10 }));
    store.insert(makeRecord({ id: "h3", projectId: "po", createdAt: t + 5 }));

    store.setStatus("h1", "accepted");
    const pending = store.listPending("po");
    expect(pending.map((r) => r.id)).toEqual(["h3", "h2"]); // ASC createdAt
  });

  it("setStatus accepted sets acceptedAt + returns updated row", () => {
    store.insert(makeRecord({ id: "ha" }));
    const before = Date.now();
    const updated = store.setStatus("ha", "accepted");
    const after = Date.now();
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("accepted");
    expect(updated!.acceptedAt).toBeGreaterThanOrEqual(before);
    expect(updated!.acceptedAt).toBeLessThanOrEqual(after);
    // persisted
    expect(store.getById("ha")!.status).toBe("accepted");
  });

  it("setStatus expired does NOT set acceptedAt", () => {
    store.insert(makeRecord({ id: "he" }));
    const updated = store.setStatus("he", "expired");
    expect(updated!.status).toBe("expired");
    expect(updated!.acceptedAt).toBeNull();
  });

  it("setStatus on non-open row is a no-op (status guard)", () => {
    store.insert(makeRecord({ id: "hn", status: "accepted", acceptedAt: 999 }));
    const updated = store.setStatus("hn", "accepted", 1234);
    // WHERE status='open' does not match -> row unchanged, getById returns it
    expect(updated!.status).toBe("accepted");
    expect(updated!.acceptedAt).toBe(999);
  });

  it("setStatus missing id -> null", () => {
    expect(store.setStatus("missing", "accepted")).toBeNull();
  });

  it("journalMode reports wal", () => {
    // WAL is set on open. (Some bun:sqlite builds report 'wal' upper or lower.)
    const mode = store.journalMode();
    expect(typeof mode).toBe("string");
    // WAL may be persisted as 'wal'
    expect(["wal", "WAL"]).toContain(mode);
  });

  it("createSchema is idempotent (reopen same path)", () => {
    store.insert(makeRecord({ id: "hr" }));
    // open a second store on the same file
    const store2 = new SqliteHandoffStore(dbPath);
    expect(store2.getById("hr")).not.toBeNull();
  });
});

describe("MemoryHandoffStore", () => {
  it("in-memory insert/getById/listPending/setStatus", () => {
    const s = new MemoryHandoffStore();
    s.insert(makeRecord({ id: "m1", projectId: "pm", targetAgent: "am" }));
    expect(s.getById("m1")).not.toBeNull();
    expect(s.listPending("pm").length).toBe(1);
    expect(s.listPending("pm", "am").length).toBe(1);
    const upd = s.setStatus("m1", "accepted");
    expect(upd!.status).toBe("accepted");
    expect(upd!.acceptedAt).toBeGreaterThan(0);
    expect(s.listPending("pm").length).toBe(0);
    expect(s.journalMode()).toBe("memory");
  });
});
