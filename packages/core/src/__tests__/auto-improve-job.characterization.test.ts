/**
 * AutoImproveJob — characterization tests (Wave 6 N31, T03)
 *
 * Purpose: pin detectPatterns output + approve/reject state transitions
 * before the Phase 3 facade split so any drift is caught.
 *
 * DB-free seam: inject fakes via the constructor (observationStore,
 * proposalStore, memoryRepo, llm, idFactory). No real MemoryRepository
 * singleton is touched. Mirrors the test-isolation pattern from the
 * existing auto-improve-job.test.ts (Phase 5).
 *
 * Discrimination spot-check: flip one expected candidate signalKey, swap
 * the approve/reject terminal status, drop the pinned-memory guard;
 * each must FAIL.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  AutoImproveJob,
  detectPatterns,
  type MemoryApplySeam,
  type PatternCandidate,
  type PatternThresholds,
} from "../services/jobs/auto-improve-job.js";
import {
  MemoryProposalStore,
  type ProposalRecord,
  type ProposalStore,
} from "../data/proposal/proposal-repository.js";
import {
  MemoryObservationStore,
  type Observation,
  type ObservationStore,
} from "../data/memory/observation-repository.js";
import type { InsertMemoryInput, UpdateMemoryPatch, MemoryRow } from "../data/memory/memory-repository.js";
import type { LlmSurface } from "../services/memory/consolidator.js";
import { MemoryType, MemoryLevel } from "@massa-th0th/shared";

// ── Fakes ────────────────────────────────────────────────────────────────────

function makeObs(
  projectId: string,
  source: Observation["source"],
  payload: unknown,
  i: number,
): Observation {
  return {
    id: `obs_${i}`,
    projectId,
    sessionId: "s1",
    source,
    payloadJson: JSON.stringify(payload),
    importance: 0.5,
    createdAt: 1000 + i,
  };
}

function makeFakeMemoryRepo(): MemoryApplySeam & {
  inserted: InsertMemoryInput[];
  updated: Array<{ id: string; patch: UpdateMemoryPatch }>;
  rows: Map<string, MemoryRow>;
  pinned: Set<string>;
} {
  const inserted: InsertMemoryInput[] = [];
  const updated: Array<{ id: string; patch: UpdateMemoryPatch }> = [];
  const rows = new Map<string, MemoryRow>();
  const pinned = new Set<string>();
  const repo = {
    inserted,
    updated,
    rows,
    pinned,
    insert(input: InsertMemoryInput): void {
      inserted.push(input);
      rows.set(input.id, {
        id: input.id,
        content: input.content,
        type: input.type,
        level: input.level,
        project_id: input.projectId,
        importance: input.importance,
        tags: input.tags,
        embedding: input.embedding,
        metadata: input.metadata,
        pinned: false,
        created_at: Date.now(),
        updated_at: Date.now(),
      } as unknown as MemoryRow);
    },
    update(id: string, patch: UpdateMemoryPatch): boolean {
      updated.push({ id, patch });
      const row = rows.get(id);
      if (row) {
        if (patch.content !== undefined) (row as any).content = patch.content;
        if (patch.importance !== undefined) (row as any).importance = patch.importance;
        if (patch.tags !== undefined) (row as any).tags = patch.tags;
      }
      return true;
    },
    getById(id: string): MemoryRow | null {
      const row = rows.get(id);
      if (!row) return null;
      if (pinned.has(id)) (row as any).pinned = 1;
      return row;
    },
  };
  return repo as any;
}

function disabledLlm(): LlmSurface {
  return { isEnabled: () => false } as any;
}

function makeJob(opts: {
  observations?: Observation[];
  thresholds?: PatternThresholds;
  reviewGate?: boolean;
  memoryRepo?: MemoryApplySeam;
  proposalStore?: ProposalStore;
}) {
  const observationStore: ObservationStore = new MemoryObservationStore();
  for (const o of opts.observations ?? []) observationStore.insert(o);
  return new AutoImproveJob({
    observationStore,
    proposalStore: opts.proposalStore ?? new MemoryProposalStore(),
    memoryRepo: opts.memoryRepo ?? makeFakeMemoryRepo(),
    llm: disabledLlm(),
    reviewGate: opts.reviewGate,
    thresholds: opts.thresholds,
    minObservations: 1,
    minIntervalMs: 0,
    maxWindow: 100,
    idFactory: () => `prop-${Math.random().toString(36).slice(2, 8)}`,
  });
}

// ── detectPatterns (pure) ────────────────────────────────────────────────────

describe("detectPatterns — characterization (T03)", () => {
  const thresholds: PatternThresholds = { minQueryHits: 3, minFileHits: 3, minFixHits: 2 };

  test("recurring query ≥ minQueryHits produces a memory.create candidate", () => {
    const obs = [
      makeObs("p1", "user-prompt", { prompt: "how do I configure search" }, 0),
      makeObs("p1", "user-prompt", { prompt: "how do I configure search" }, 1),
      makeObs("p1", "user-prompt", { prompt: "how do I configure search" }, 2),
    ];
    const candidates = detectPatterns(obs, thresholds);
    expect(candidates.length).toBe(1);
    expect(candidates[0].kind).toBe("memory.create");
    expect(candidates[0].signalKey).toBe("query::configure search");
    expect(candidates[0].source).toBe("rule-based");
    expect((candidates[0].payload as any).type).toBe(MemoryType.PATTERN);
    expect((candidates[0].payload as any).importance).toBe(0.7);
  });

  test("hot file ≥ minFileHits produces a memory.create candidate", () => {
    const obs = [
      makeObs("p1", "post-tool-use", { tool: "edit", file_path: "src/a.ts" }, 0),
      makeObs("p1", "post-tool-use", { tool: "edit", file_path: "src/a.ts" }, 1),
      makeObs("p1", "post-tool-use", { tool: "edit", file_path: "src/a.ts" }, 2),
    ];
    const candidates = detectPatterns(obs, thresholds);
    // Both a hot-file candidate AND a recurring-fix candidate fire (the same
    // post-tool-use observations feed both signal buckets). Characterization:
    // pin both signal keys.
    const keys = candidates.map((c) => c.signalKey);
    expect(keys).toContain("file::src/a.ts");
    expect(keys).toContain("fix::edit:src");
    const fileCand = candidates.find((c) => c.signalKey === "file::src/a.ts")!;
    expect((fileCand.payload as any).tags).toContain("hot-file");
  });

  test("recurring fix ≥ minFixHits produces a memory.create candidate", () => {
    const obs = [
      makeObs("p1", "post-tool-use", { tool: "edit", file_path: "src/a.ts" }, 0),
      makeObs("p1", "post-tool-use", { tool: "edit", file_path: "src/a.ts" }, 1),
    ];
    const candidates = detectPatterns(obs, thresholds);
    // fix signature = "edit:src" (pathBucket of src/a.ts = "src")
    expect(candidates.length).toBe(1);
    expect(candidates[0].signalKey).toBe("fix::edit:src");
    expect((candidates[0].payload as any).tags).toContain("recurring-fix");
  });

  test("below-threshold observations produce no candidates", () => {
    const obs = [
      makeObs("p1", "user-prompt", { prompt: "unique query" }, 0),
      makeObs("p1", "user-prompt", { prompt: "different query" }, 1),
    ];
    const candidates = detectPatterns(obs, thresholds);
    expect(candidates).toEqual([]);
  });

  test("malformed payload JSON is skipped (not thrown)", () => {
    const obs = [
      { ...makeObs("p1", "user-prompt", {}, 0), payloadJson: "not-json" },
      { ...makeObs("p1", "user-prompt", {}, 1), payloadJson: "not-json" },
      { ...makeObs("p1", "user-prompt", {}, 2), payloadJson: "not-json" },
    ];
    expect(() => detectPatterns(obs, thresholds)).not.toThrow();
    expect(detectPatterns(obs, thresholds)).toEqual([]);
  });
});

// ── approve / reject state machine ──────────────────────────────────────────

describe("approve / reject state transitions — characterization (T03)", () => {
  let job: AutoImproveJob;
  let proposalStore: ProposalStore;
  let memRepo: ReturnType<typeof makeFakeMemoryRepo>;

  beforeEach(() => {
    proposalStore = new MemoryProposalStore();
    memRepo = makeFakeMemoryRepo();
    job = makeJob({ observations: [], proposalStore, memoryRepo: memRepo });
  });

  async function seedPending(proposalId: string, projectId = "p1"): Promise<ProposalRecord> {
    const record: ProposalRecord = {
      id: proposalId,
      projectId,
      kind: "memory.create",
      targetMemoryId: null,
      payload: { content: "test", type: MemoryType.PATTERN, level: MemoryLevel.PROJECT, importance: 0.7, tags: ["t"] },
      rationale: "test",
      status: "pending",
      createdAt: Date.now(),
      decidedAt: null,
    };
    await proposalStore.insert(record);
    return record;
  }

  test("approve flips pending→approved and applies the memory.create payload", async () => {
    await seedPending("p1");
    const res = await job.approve("p1", "p1", "rule-based");
    expect(res.ok).toBe(true);
    expect(res.proposal!.status).toBe("approved");
    expect(memRepo.inserted.length).toBe(1);
    expect(memRepo.inserted[0].content).toBe("test");
  });

  test("approve on missing proposal returns {ok:false, reason:not-found}", async () => {
    const res = await job.approve("nope");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-found");
  });

  test("approve on non-pending returns {ok:false, reason:not-pending}", async () => {
    await seedPending("p2");
    await job.approve("p2", "p1"); // first approve
    const res = await job.approve("p2", "p1"); // second
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-pending");
  });

  test("approve with project-mismatch returns {ok:false, reason:project-mismatch}", async () => {
    await seedPending("p3", "projA");
    const res = await job.approve("p3", "projB");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("project-mismatch");
  });

  test("reject flips pending→rejected with no memory apply", async () => {
    await seedPending("p4");
    const res = await job.reject("p4", "p1");
    expect(res.ok).toBe(true);
    expect(res.proposal!.status).toBe("rejected");
    expect(memRepo.inserted.length).toBe(0);
  });

  test("reject on missing proposal returns {ok:false, reason:not-found}", async () => {
    const res = await job.reject("nope");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-found");
  });

  test("approve on a pinned memory.update target returns {ok:false, reason:pinned}", async () => {
    // Seed a memory.update proposal targeting a pinned memory.
    const record: ProposalRecord = {
      id: "p5",
      projectId: "p1",
      kind: "memory.update",
      targetMemoryId: "mem-pinned",
      payload: { content: "new" },
      rationale: "test",
      status: "pending",
      createdAt: Date.now(),
      decidedAt: null,
    };
    await proposalStore.insert(record);
    memRepo.pinned.add("mem-pinned");
    memRepo.rows.set("mem-pinned", {
      id: "mem-pinned", content: "old", type: MemoryType.PATTERN,
      level: MemoryLevel.PROJECT, project_id: "p1", importance: 0.5,
      tags: [], pinned: 1 as any, embedding: [], metadata: {},
      created_at: 0, updated_at: 0,
    } as unknown as MemoryRow);
    const res = await job.approve("p5", "p1");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("pinned");
  });
});