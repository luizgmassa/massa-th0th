/**
 * M40 — pinned-memory invariant + fail-closed proposal validation.
 *
 * The auto-improve apply path (applyProposal, reached via approve()) must:
 *   1. NEVER rewrite a pinned memory (reject `reason: "pinned"`, no mutation).
 *   2. FAIL CLOSED on an unreadable/missing target (`reason:
 *      "unreadable_target"`, no mutation) — not silently coerce.
 *   3. Behavior-preserving for the common unpinned+well-formed case.
 *   4. Reject a malformed proposal payload fail-closed
 *      (`reason: "malformed-payload"`, no mutation) instead of papering over
 *      a bad value with a silent default.
 *
 * DB-free: the memoryRepo seam is a fake exposing getById/update/insert.
 * Mirrors the pin-truthy check in decay.ts (`pinned === 1 || pinned === true`)
 * and the exemption consolidation already honors.
 */

import { describe, expect, it } from "bun:test";
import {
  AutoImproveJob,
  type AutoImproveJobOptions,
  type MemoryApplySeam,
} from "../services/jobs/auto-improve-job.js";
import {
  MemoryProposalStore,
  type ProposalRecord,
} from "../data/proposal/proposal-repository.js";
import { MemoryObservationStore } from "../data/memory/observation-repository.js";
import type {
  InsertMemoryInput,
  MemoryRow,
  UpdateMemoryPatch,
} from "../data/memory/memory-repository.js";

// ── Fakes ────────────────────────────────────────────────────────────────────

type UpdateCall = { id: string; patch: UpdateMemoryPatch };
type InsertCall = InsertMemoryInput;

interface FakeRepo {
  rows: Map<string, MemoryRow>;
  getByIdThrow?: boolean;
  getById(id: string): MemoryRow | null;
  update(id: string, patch: UpdateMemoryPatch): boolean;
  insert(input: InsertMemoryInput): void;
  // Observability for assertions:
  updateCalls: UpdateCall[];
  insertCalls: InsertCall[];
}

function makeFakeRepo(rows: MemoryRow[] = []): FakeRepo & MemoryApplySeam {
  const map = new Map<string, MemoryRow>();
  for (const r of rows) map.set(r.id, r);
  const updateCalls: UpdateCall[] = [];
  const insertCalls: InsertCall[] = [];
  const repo: FakeRepo = {
    rows: map,
    updateCalls,
    insertCalls,
    getById(id: string): MemoryRow | null {
      if (repo.getByIdThrow) throw new Error("injected getById failure");
      return map.get(id) ?? null;
    },
    update(id: string, patch: UpdateMemoryPatch): boolean {
      updateCalls.push({ id, patch });
      return true;
    },
    insert(input: InsertMemoryInput): void {
      insertCalls.push(input);
    },
  };
  return repo as FakeRepo & MemoryApplySeam;
}

function makeRow(id: string, pinned: number = 0): MemoryRow {
  return {
    id,
    content: `content-${id}`,
    type: "pattern",
    level: 2,
    user_id: null,
    session_id: null,
    project_id: "proj-m40",
    agent_id: null,
    importance: 0.5,
    tags: "[]",
    embedding: null,
    metadata: null,
    created_at: 1000,
    updated_at: 1000,
    access_count: 0,
    last_accessed: null,
    pinned,
    deleted_at: null,
  };
}

function makeJob(
  repo: FakeRepo & MemoryApplySeam,
  overrides: Partial<AutoImproveJobOptions> = {},
): { job: AutoImproveJob; store: MemoryProposalStore } {
  // Minimal observation store — M40 tests drive approve() directly, so the
  // observation content is irrelevant; we just need the job to construct.
  const obsStore = new MemoryObservationStore();
  const store = new MemoryProposalStore();
  const job = new AutoImproveJob({
    observationStore: obsStore,
    proposalStore: store,
    memoryRepo: repo,
    reviewGate: true,
    ...overrides,
  });
  return { job, store };
}

/** Insert a proposal directly into the store and return it. */
async function seedProposal(
  store: MemoryProposalStore,
  partial: Partial<ProposalRecord> & {
    kind: ProposalRecord["kind"];
    targetMemoryId?: string | null;
    payload: ProposalRecord["payload"];
  },
): Promise<ProposalRecord> {
  const rec: ProposalRecord = {
    id: `prop_${Math.random().toString(36).slice(2, 8)}`,
    projectId: "proj-m40",
    kind: partial.kind,
    targetMemoryId: partial.targetMemoryId ?? null,
    payload: partial.payload,
    rationale: partial.rationale ?? "test",
    status: "pending",
    createdAt: Date.now(),
    decidedAt: null,
  };
  await store.insert(rec);
  return rec;
}

// ── M40 invariant: pinned target is never rewritten ─────────────────────────

describe("M40 — pinned-memory invariant", () => {
  it("memory.update on a pinned (pinned=1) target → reason 'pinned', NO mutation", async () => {
    const repo = makeFakeRepo([makeRow("mem-1", 1)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.update",
      targetMemoryId: "mem-1",
      payload: { content: "attacker-overwrite", importance: 0.1 },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("pinned");
    expect(repo.updateCalls).toHaveLength(0); // invariant: NO mutation
    // Status stays pending (apply never flipped it).
    const row = await store.getById(prop.id);
    expect(row!.status).toBe("pending");
  });

  it("memory.tag on a pinned (pinned=true-equivalent via row=1) target → reason 'pinned', NO mutation", async () => {
    const repo = makeFakeRepo([makeRow("mem-tag", 1)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.tag",
      targetMemoryId: "mem-tag",
      payload: { tags: ["evil", "overwrite"] },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("pinned");
    expect(repo.updateCalls).toHaveLength(0);
  });
});

// ── M40 fail-closed: unreadable / missing target ───────────────────────────

describe("M40 — fail CLOSED on unreadable/missing target", () => {
  it("memory.update on a missing target → reason 'unreadable_target', NO mutation", async () => {
    const repo = makeFakeRepo([]); // no rows → target not found
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.update",
      targetMemoryId: "does-not-exist",
      payload: { content: "x" },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unreadable_target");
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("memory.tag on a target whose getById throws → reason 'unreadable_target', NO mutation", async () => {
    const repo = makeFakeRepo([makeRow("mem-2", 0)]);
    repo.getByIdThrow = true;
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.tag",
      targetMemoryId: "mem-2",
      payload: { tags: ["t"] },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("unreadable_target");
    expect(repo.updateCalls).toHaveLength(0);
  });
});

// ── M40 behavior-preserving: unpinned + well-formed ────────────────────────

describe("M40 — behavior-preserving on unpinned readable target", () => {
  it("memory.update on an unpinned readable target → applies the patch as before", async () => {
    const repo = makeFakeRepo([makeRow("mem-ok", 0)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.update",
      targetMemoryId: "mem-ok",
      payload: { content: "new content", importance: 0.8, tags: ["a", "b"] },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(true);
    expect(repo.updateCalls).toHaveLength(1);
    expect(repo.updateCalls[0].id).toBe("mem-ok");
    expect(repo.updateCalls[0].patch.content).toBe("new content");
    expect(repo.updateCalls[0].patch.importance).toBe(0.8);
    expect(repo.updateCalls[0].patch.tags).toEqual(["a", "b"]);
  });

  it("memory.tag on an unpinned readable target → applies the tags as before", async () => {
    const repo = makeFakeRepo([makeRow("mem-ok2", 0)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.tag",
      targetMemoryId: "mem-ok2",
      payload: { tags: ["x", "y"] },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(true);
    expect(repo.updateCalls).toHaveLength(1);
    expect(repo.updateCalls[0].patch.tags).toEqual(["x", "y"]);
  });
});

// ── M40 fail-closed: malformed proposal payload ─────────────────────────────

describe("M40 — malformed proposal payload rejected (fail-closed)", () => {
  it("memory.update with present-but-invalid importance → reason 'malformed-payload', NO mutation", async () => {
    const repo = makeFakeRepo([makeRow("mem-p", 0)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.update",
      targetMemoryId: "mem-p",
      payload: { importance: 42 }, // out of [0,1]
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("malformed-payload");
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("memory.update with non-string content → reason 'malformed-payload', NO mutation", async () => {
    const repo = makeFakeRepo([makeRow("mem-p2", 0)]);
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.update",
      targetMemoryId: "mem-p2",
      payload: { content: 12345 }, // wrong type
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("malformed-payload");
    expect(repo.updateCalls).toHaveLength(0);
  });

  it("memory.create with invalid type → reason 'malformed-payload', NO insert", async () => {
    const repo = makeFakeRepo();
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.create",
      targetMemoryId: null,
      payload: { type: "not-a-real-memory-type", content: "x" },
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(false);
    expect(res.reason).toBe("malformed-payload");
    expect(repo.insertCalls).toHaveLength(0); // invariant: NO insert
  });

  it("memory.create with valid optional-absent payload still applies (well-formed)", async () => {
    const repo = makeFakeRepo();
    const { job, store } = makeJob(repo);
    const prop = await seedProposal(store, {
      kind: "memory.create",
      targetMemoryId: null,
      payload: { content: "legit" }, // no type/importance → defaults OK
    });

    const res = await job.approve(prop.id, "proj-m40");

    expect(res.ok).toBe(true);
    expect(repo.insertCalls).toHaveLength(1);
  });
});
