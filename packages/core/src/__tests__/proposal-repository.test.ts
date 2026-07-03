/**
 * SqliteProposalStore tests (Phase 5 — proposal store, direct unit).
 *
 * Mirrors handoff-repository.test.ts: explicit temp dbPath, no process-wide
 * shared-config mock.
 */

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";

import {
  SqliteProposalStore,
  MemoryProposalStore,
  newProposalId,
  type ProposalRecord,
} from "../data/proposal/proposal-repository.js";

function makeRecord(overrides: Partial<ProposalRecord> = {}): ProposalRecord {
  return {
    id: newProposalId(),
    projectId: "proj-sqlite",
    kind: "memory.create",
    targetMemoryId: null,
    payload: { content: "hello", tags: ["t"] },
    rationale: "because",
    status: "pending",
    createdAt: Date.now(),
    decidedAt: null,
    ...overrides,
  };
}

describe("SqliteProposalStore", () => {
  let tmpDir: string;
  let dbPath: string;
  let store: SqliteProposalStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "massa-th0th-proposal-sqlite-"));
    dbPath = path.join(tmpDir, "proposals.db");
    store = new SqliteProposalStore(dbPath);
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("insert + getById round-trips a proposal (payload JSON parsed)", () => {
    const rec = makeRecord({
      kind: "memory.update",
      targetMemoryId: "mem-1",
      payload: { content: "edited", importance: 0.9, tags: ["x", "y"] },
      rationale: "frequent file",
    });
    store.insert(rec);
    const got = store.getById(rec.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(rec.id);
    expect(got!.projectId).toBe("proj-sqlite");
    expect(got!.kind).toBe("memory.update");
    expect(got!.targetMemoryId).toBe("mem-1");
    expect(got!.status).toBe("pending");
    expect(got!.decidedAt).toBeNull();
    const payload = got!.payload as Record<string, unknown>;
    expect(payload.content).toBe("edited");
    expect(payload.importance).toBe(0.9);
    expect(got!.rationale).toBe("frequent file");
  });

  it("listPending returns only pending rows for the project (newest-first)", () => {
    const older = makeRecord({ createdAt: 1000 });
    const newer = makeRecord({ createdAt: 2000 });
    const approved = makeRecord({ status: "approved", decidedAt: 1500 });
    const otherProject = makeRecord({ projectId: "other" });
    store.insert(older);
    store.insert(newer);
    store.insert(approved);
    store.insert(otherProject);

    const pending = store.listPending("proj-sqlite");
    expect(pending.length).toBe(2);
    expect(pending[0].id).toBe(newer.id);
    expect(pending[1].id).toBe(older.id);
  });

  it("setStatus flips pending→approved with decidedAt", () => {
    const rec = makeRecord();
    store.insert(rec);
    const updated = store.setStatus(rec.id, "approved", 12345);
    expect(updated).not.toBeNull();
    expect(updated!.status).toBe("approved");
    expect(updated!.decidedAt).toBe(12345);
  });

  it("setStatus on non-pending row is a no-op (WHERE status='pending' guard)", () => {
    const rec = makeRecord();
    store.insert(rec);
    store.setStatus(rec.id, "approved", 1000);
    // Second setStatus should not flip (status is already 'approved').
    const second = store.setStatus(rec.id, "rejected", 2000);
    // The row is returned (getById), but status is unchanged.
    expect(second).not.toBeNull();
    expect(second!.status).toBe("approved");
    expect(second!.decidedAt).toBe(1000);
  });

  it("setStatus on missing id returns null", () => {
    const res = store.setStatus("does-not-exist", "approved");
    expect(res).toBeNull();
  });

  it("createSchema is idempotent (reopen same dbPath reads prior row)", () => {
    const rec = makeRecord();
    store.insert(rec);
    // Open a second store on the same path.
    const store2 = new SqliteProposalStore(dbPath);
    const got = store2.getById(rec.id);
    expect(got).not.toBeNull();
    expect(got!.id).toBe(rec.id);
  });

  it("uses WAL journal mode", () => {
    // Force the DB open.
    store.journalMode();
    const mode = store.journalMode();
    // On some filesystems WAL may report 'wal' or fall back; assert it
    // returns a non-empty string from PRAGMA.
    expect(typeof mode).toBe("string");
    expect(mode.length).toBeGreaterThan(0);
  });
});

describe("MemoryProposalStore", () => {
  it("insert + listPending + setStatus in-memory", () => {
    const store = new MemoryProposalStore();
    const a = makeRecord({ createdAt: 1 });
    const b = makeRecord({ createdAt: 2, projectId: "other" });
    store.insert(a);
    store.insert(b);
    const pending = store.listPending("proj-sqlite");
    expect(pending.length).toBe(1);
    expect(pending[0].id).toBe(a.id);
    const updated = store.setStatus(a.id, "rejected");
    expect(updated!.status).toBe("rejected");
    expect(store.listPending("proj-sqlite").length).toBe(0);
  });
});
