/**
 * AutoImproveJob tests (Phase 5 — auto-improvement loop, G7).
 *
 * Test-isolation rule (Phase 1/2/3/4/6): do NOT `mock.module("@massa-ai/shared")`
 * (process-wide collision — memory-crud.test.ts owns it). Inject a fake
 * ProposalStore (MemoryProposalStore), a fake ObservationStore (MemoryObservationStore
 * pre-loaded with deterministic observations), a fake MemoryApplySeam, and a fake
 * LlmSurface. No real MemoryRepository singleton is touched.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import type { z } from "zod";

import {
  AutoImproveJob,
  detectPatterns,
  type AutoImproveJobOptions,
  type MemoryApplySeam,
  type PatternCandidate,
} from "../services/jobs/auto-improve-job.js";
import {
  MemoryProposalStore,
  type ProposalRecord,
} from "../data/proposal/proposal-repository.js";
import {
  MemoryObservationStore,
  type Observation,
  type ObservationStore,
} from "../data/memory/observation-repository.js";
import type { InsertMemoryInput, UpdateMemoryPatch } from "../data/memory/memory-repository.js";
import type { LlmSurface } from "../services/memory/consolidator.js";
import { eventBus } from "../services/events/event-bus.js";
import { SearchServiceError } from "../services/search/search-diagnostics.js";

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
  failNext: boolean;
} {
  const inserted: InsertMemoryInput[] = [];
  const updated: Array<{ id: string; patch: UpdateMemoryPatch }> = [];
  const repo = {
    inserted,
    updated,
    failNext: false,
    insert(input: InsertMemoryInput): void {
      if ((repo as any).failNext) throw new Error("injected apply failure");
      inserted.push(input);
    },
    update(id: string, patch: UpdateMemoryPatch): boolean {
      if ((repo as any).failNext) throw new Error("injected apply failure");
      updated.push({ id, patch });
      return true;
    },
  };
  return repo as any;
}

function enabledEnrichSurface(items: Array<{ signalKey: string; content: string; rationale: string }>): LlmSurface {
  return {
    isEnabled: () => true,
    async object<T>(_prompt: string, _schema: z.ZodSchema<T>) {
      return { ok: true, value: { items } as any as T };
    },
  };
}

function failingSurface(): LlmSurface {
  return {
    isEnabled: () => true,
    async object() {
      return { ok: false, error: "boom" };
    },
  };
}

function throwingSurface(): LlmSurface {
  return {
    isEnabled: () => true,
    async object() {
      throw new Error("network down");
    },
  };
}

function disabledSurface(): LlmSurface {
  return {
    isEnabled: () => false,
    async object() {
      return { ok: false, error: "disabled" };
    },
  };
}

let idCounter = 0;
function deterministicIdFactory() {
  return () => `proposal_test_${Date.now()}_${idCounter++}`;
}

function makeJob(opts: Partial<AutoImproveJobOptions> & { observations: Observation[] }): {
  job: AutoImproveJob;
  store: MemoryProposalStore;
  obsStore: ObservationStore;
  mem: ReturnType<typeof makeFakeMemoryRepo>;
} {
  const obsStore = new MemoryObservationStore();
  for (const o of opts.observations) obsStore.insert(o);
  const store = new MemoryProposalStore();
  const mem = makeFakeMemoryRepo();
  const job = new AutoImproveJob({
    observationStore: obsStore,
    proposalStore: store,
    memoryRepo: mem,
    idFactory: deterministicIdFactory(),
    thresholds: { minQueryHits: 3, minFileHits: 3, minFixHits: 2 },
    maxWindow: 50,
    reviewGate: opts.reviewGate,
    llm: opts.llm,
  });
  return { job, store, obsStore, mem };
}

// Deterministic observation set: a hot file referenced 4 times.
function hotFileObservations(projectId = "proj-ai"): Observation[] {
  const obs: Observation[] = [];
  let i = 0;
  for (; i < 4; i++) {
    obs.push(
      makeObs(
        projectId,
        "post-tool-use",
        { tool: "Edit", filePath: "src/auth.ts" },
        i,
      ),
    );
  }
  // Add a couple of distinct user-prompts (below query threshold).
  obs.push(makeObs(projectId, "user-prompt", { prompt: "totally unrelated question" }, i++));
  obs.push(makeObs(projectId, "user-prompt", { prompt: "another distinct question" }, i++));
  return obs;
}

// ── detectPatterns unit ─────────────────────────────────────────────────────

describe("detectPatterns (pure)", () => {
  it("emits a memory.create candidate for a recurring file above threshold", () => {
    const obs = hotFileObservations();
    const cands = detectPatterns(obs, { minQueryHits: 3, minFileHits: 3, minFixHits: 2 });
    const fileCand = cands.find((c) => c.signalKey.startsWith("file::"));
    expect(fileCand).toBeDefined();
    expect(fileCand!.kind).toBe("memory.create");
    expect(fileCand!.rationale).toContain("src/auth.ts");
    expect(fileCand!.rationale).toContain("4 times");
    expect(fileCand!.source).toBe("rule-based");
  });

  it("emits a query candidate for a recurring user-prompt above threshold", () => {
    const obs: Observation[] = [];
    for (let i = 0; i < 3; i++) {
      obs.push(makeObs("p", "user-prompt", { prompt: "How do I configure the auth middleware?" }, i));
    }
    const cands = detectPatterns(obs, { minQueryHits: 3, minFileHits: 3, minFixHits: 2 });
    const q = cands.find((c) => c.signalKey.startsWith("query::"));
    expect(q).toBeDefined();
    expect(q!.kind).toBe("memory.create");
  });

  it("emits nothing when no signal meets threshold", () => {
    const obs: Observation[] = [
      makeObs("p", "post-tool-use", { filePath: "a.ts" }, 0),
      makeObs("p", "user-prompt", { prompt: "random" }, 1),
    ];
    const cands = detectPatterns(obs, { minQueryHits: 3, minFileHits: 3, minFixHits: 2 });
    expect(cands.length).toBe(0);
  });

  it("is total: malformed payloadJson is skipped, never thrown", () => {
    const obs: Observation[] = [
      { ...makeObs("p", "post-tool-use", {}, 0), payloadJson: "{not json" },
      ...hotFileObservations(),
    ];
    expect(() => detectPatterns(obs, { minQueryHits: 3, minFileHits: 3, minFixHits: 2 })).not.toThrow();
  });
});

// ── AutoImproveJob AC tests ─────────────────────────────────────────────────

describe("AutoImproveJob — runOnce + review gate", () => {
  beforeEach(() => {
    idCounter = 0;
  });

  it("P5-DETECT-01: produces >=1 pending proposal from a deterministic pattern (reviewGate=true)", async () => {
    const { job, store } = makeJob({ observations: hotFileObservations(), reviewGate: true, llm: disabledSurface() });
    const res = await job.runOnce("proj-ai");
    expect(res.improved).toBe(true);
    expect(res.proposalsCreated).toBeGreaterThanOrEqual(1);
    expect(res.proposalsApplied).toBe(0); // review gate on → no auto-apply
    const pending = await store.listPending("proj-ai");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    const fileProp = pending.find((p) => p.rationale.includes("src/auth.ts"));
    expect(fileProp).toBeDefined();
    expect(fileProp!.status).toBe("pending");
    expect(fileProp!.kind).toBe("memory.create");
    expect(fileProp!.decidedAt).toBeNull();
  });

  it("P5-DETECT-02: no recurring pattern → 0 proposals, no throw", async () => {
    const distinct: Observation[] = [
      makeObs("p", "post-tool-use", { filePath: "a.ts" }, 0),
      makeObs("p", "post-tool-use", { filePath: "b.ts" }, 1),
      makeObs("p", "user-prompt", { prompt: "q1" }, 2),
      makeObs("p", "user-prompt", { prompt: "q2" }, 3),
    ];
    const { job, store } = makeJob({ observations: distinct, reviewGate: true });
    const res = await job.runOnce("p");
    expect(res.improved).toBe(false);
    expect(res.proposalsCreated).toBe(0);
    expect((await store.listPending("p")).length).toBe(0);
  });

  it("P5-DETECT-02 (edge): < 2 observations → noop", async () => {
    const { job } = makeJob({ observations: [makeObs("p", "user-prompt", { prompt: "x" }, 0)], reviewGate: true });
    const res = await job.runOnce("p");
    expect(res.improved).toBe(false);
  });

  it("P5-AUTOAPPROVE-01: reviewGate=false (default) auto-applies, flips status, emits event, logs", async () => {
    const { job, store, mem } = makeJob({ observations: hotFileObservations(), llm: disabledSurface() });
    const events: any[] = [];
    const unsub = eventBus.subscribe("memory:auto-improved", (e) => events.push(e));
    try {
      const res = await job.runOnce("proj-ai");
      expect(res.improved).toBe(true);
      expect(res.proposalsApplied).toBeGreaterThanOrEqual(1);
      // Memory was applied (insert for memory.create).
      expect(mem.inserted.length).toBeGreaterThanOrEqual(1);
      // Status flipped to approved.
      const approved = store.rows.filter((r) => r.status === "approved");
      expect(approved.length).toBeGreaterThanOrEqual(1);
      expect(approved[0].decidedAt).not.toBeNull();
      // Event fired with the spec shape.
      expect(events.length).toBeGreaterThanOrEqual(1);
      const e = events[0];
      expect(e.proposalId).toBeDefined();
      expect(e.kind).toBe("memory.create");
      expect(e.status).toBe("approved");
      expect(e.source).toBe("rule-based");
      expect(typeof e.appliedAt).toBe("number");
    } finally {
      unsub();
    }
  });

  it("P5-DEGRADE-01: LLM off → rule-based proposals still produced (no throw)", async () => {
    const { job, store } = makeJob({
      observations: hotFileObservations(),
      reviewGate: true,
      llm: disabledSurface(),
    });
    const res = await job.runOnce("proj-ai");
    expect(res.improved).toBe(true);
    expect(res.proposalsCreated).toBeGreaterThanOrEqual(1);
    expect(res.source).toBe("rule-based");
    expect((await store.listPending("proj-ai")).length).toBeGreaterThanOrEqual(1);
  });

  it("P5-DEGRADE-02: LLM on + {ok:false} → rule-based candidates verbatim", async () => {
    const baseline = makeJob({
      observations: hotFileObservations(),
      reviewGate: true,
      llm: disabledSurface(),
    });
    const baselineRes = await baseline.job.runOnce("proj-ai");
    const baselineCount = baselineRes.proposalsCreated;

    idCounter = 0;
    const degraded = makeJob({
      observations: hotFileObservations(),
      reviewGate: true,
      llm: failingSurface(),
    });
    const res = await degraded.job.runOnce("proj-ai");
    expect(res.proposalsCreated).toBe(baselineCount);
    expect(res.source).toBe("rule-based"); // enrichment did not apply
  });

  it("P5-DEGRADE-02 (throw): LLM throws → rule-based candidates verbatim (no throw)", async () => {
    const { job, store } = makeJob({
      observations: hotFileObservations(),
      reviewGate: true,
      llm: throwingSurface(),
    });
    const res = await job.runOnce("proj-ai");
    expect(res.improved).toBe(true);
    expect(res.proposalsCreated).toBeGreaterThanOrEqual(1);
    expect(res.source).toBe("rule-based");
    expect((await store.listPending("proj-ai")).length).toBeGreaterThanOrEqual(1);
  });

  it("P5-DEGRADE-02 (enrich ok): LLM enriches content + rationale, source='llm'", async () => {
    const { job, store } = makeJob({
      observations: hotFileObservations(),
      reviewGate: true,
      llm: enabledEnrichSurface([
        { signalKey: "file::src/auth.ts", content: "ENRICHED content for auth", rationale: "ENRICHED rationale" },
      ]),
    });
    const res = await job.runOnce("proj-ai");
    expect(res.source).toBe("llm");
    const prop = store.rows[0];
    const payload = prop.payload as Record<string, unknown>;
    expect(payload.content).toBe("ENRICHED content for auth");
    expect(prop.rationale).toBe("ENRICHED rationale");
  });
});

describe("AutoImproveJob — approve / reject state machine", () => {
  let store: MemoryProposalStore;
  let job: AutoImproveJob;
  let mem: ReturnType<typeof makeFakeMemoryRepo>;

  beforeEach(() => {
    idCounter = 0;
    const obsStore = new MemoryObservationStore();
    for (const o of hotFileObservations()) obsStore.insert(o);
    store = new MemoryProposalStore();
    mem = makeFakeMemoryRepo();
    job = new AutoImproveJob({
      observationStore: obsStore,
      proposalStore: store,
      memoryRepo: mem,
      idFactory: deterministicIdFactory(),
      thresholds: { minQueryHits: 3, minFileHits: 3, minFixHits: 2 },
      maxWindow: 50,
      reviewGate: true,
      llm: disabledSurface(),
    });
  });

  it("P5-LIST-01: listPending returns pending proposals for the project", async () => {
    await job.runOnce("proj-ai");
    const pending = await job.listPending("proj-ai");
    expect(pending.length).toBeGreaterThanOrEqual(1);
    for (const p of pending) {
      expect(p.status).toBe("pending");
      expect(p.projectId).toBe("proj-ai");
    }
  });

  it("P5-APPROVE-01: approve applies the edit, flips status, emits memory:auto-improved", async () => {
    await job.runOnce("proj-ai");
    const pending = await job.listPending("proj-ai");
    const target = pending[0];
    const events: any[] = [];
    const unsub = eventBus.subscribe("memory:auto-improved", (e) => events.push(e));
    try {
      const res = await job.approve(target.id, "proj-ai");
      expect(res.ok).toBe(true);
      expect(res.proposal!.status).toBe("approved");
      expect(res.proposal!.decidedAt).not.toBeNull();
      // Edit applied (insert for memory.create).
      expect(mem.inserted.length).toBeGreaterThanOrEqual(1);
      const applied = mem.inserted[mem.inserted.length - 1];
      expect(applied.id).toBeDefined();
      // Event fired.
      expect(events.length).toBe(1);
      expect(events[0].proposalId).toBe(target.id);
      expect(events[0].kind).toBe(target.kind);
      expect(events[0].status).toBe("approved");
      expect(events[0].targetMemoryId).toBe(applied.id);
    } finally {
      unsub();
    }
  });

  it("P5-EVENT-01: memory:auto-improved is in EventMap with the R6 shape", async () => {
    await job.runOnce("proj-ai");
    const target = (await job.listPending("proj-ai"))[0];
    const events: any[] = [];
    const unsub = eventBus.subscribe("memory:auto-improved", (e) => events.push(e));
    try {
      await job.approve(target.id, "proj-ai");
      expect(events.length).toBe(1);
      const e = events[0];
      // Full R6 shape assertion.
      expect(typeof e.proposalId).toBe("string");
      expect(e.projectId).toBe("proj-ai");
      expect(["memory.create", "memory.update", "memory.tag"]).toContain(e.kind);
      expect(e.status).toBe("approved");
      expect(typeof e.appliedAt).toBe("number");
      expect(["llm", "rule-based"]).toContain(e.source);
    } finally {
      unsub();
    }
  });

  it("P5-REJECT-01: reject flips status, does NOT apply, does NOT emit", async () => {
    await job.runOnce("proj-ai");
    const target = (await job.listPending("proj-ai"))[0];
    const beforeInserted = mem.inserted.length;
    const events: any[] = [];
    const unsub = eventBus.subscribe("memory:auto-improved", (e) => events.push(e));
    try {
      const res = await job.reject(target.id, "proj-ai", "not useful");
      expect(res.ok).toBe(true);
      expect(res.proposal!.status).toBe("rejected");
      expect(res.proposal!.decidedAt).not.toBeNull();
      expect(mem.inserted.length).toBe(beforeInserted); // no apply
      expect(events.length).toBe(0); // no event
    } finally {
      unsub();
    }
  });

  it("P5-FAIL-01: approve on missing → {ok:false, not-found}; no event", async () => {
    const events: any[] = [];
    const unsub = eventBus.subscribe("memory:auto-improved", (e) => events.push(e));
    try {
      const res = await job.approve("missing-id", "proj-ai");
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("not-found");
      expect(events.length).toBe(0);
    } finally {
      unsub();
    }
  });

  it("P5-FAIL-01: approve on already-approved → {ok:false, not-pending}", async () => {
    await job.runOnce("proj-ai");
    const target = (await job.listPending("proj-ai"))[0];
    const first = await job.approve(target.id, "proj-ai");
    expect(first.ok).toBe(true);
    const second = await job.approve(target.id, "proj-ai");
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("not-pending");
  });

  it("P5-FAIL-01: approve with project mismatch → {ok:false, project-mismatch}", async () => {
    await job.runOnce("proj-ai");
    const target = (await job.listPending("proj-ai"))[0];
    const res = await job.approve(target.id, "other-project");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("project-mismatch");
  });

  it("P5-FAIL-01 (empty id): approve('') → {ok:false, missing-id}", async () => {
    const res = await job.approve("");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing-id");
  });

  it("apply-failed: memoryRepo.insert throws → status stays pending, {ok:false, apply-failed}", async () => {
    await job.runOnce("proj-ai");
    const target = (await job.listPending("proj-ai"))[0];
    mem.failNext = true;
    const res = await job.approve(target.id, "proj-ai");
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("apply-failed");
    // Status unchanged.
    const row = await store.getById(target.id);
    expect(row!.status).toBe("pending");
  });

  it("canonical read failures propagate from approve and reject", async () => {
    const failure = new SearchServiceError("STORE_CORRUPTION", "proposal.payload_json");
    store.getById = async () => {
      throw failure;
    };
    await expect(job.approve("proposal-1", "proj-ai")).rejects.toBe(failure);
    await expect(job.reject("proposal-1", "proj-ai")).rejects.toBe(failure);
  });

  it("canonical status failures propagate from approve and reject", async () => {
    await job.runOnce("proj-ai");
    const [target] = await job.listPending("proj-ai");
    const failure = new SearchServiceError("SEARCH_BACKEND_UNAVAILABLE", "proposal_store");
    store.setStatus = async () => {
      throw failure;
    };
    await expect(job.approve(target.id, "proj-ai")).rejects.toBe(failure);
    await expect(job.reject(target.id, "proj-ai")).rejects.toBe(failure);
  });

  it("auto-approval rethrows canonical persistence failures", async () => {
    const auto = makeJob({
      observations: hotFileObservations(),
      reviewGate: false,
      llm: disabledSurface(),
    });
    const failure = new SearchServiceError("SEARCH_BACKEND_UNAVAILABLE", "proposal_store");
    auto.store.setStatus = async () => {
      throw failure;
    };
    await expect(auto.job.runOnce("proj-ai")).rejects.toBe(failure);
  });
});

// ── Tool / route wiring assertion ───────────────────────────────────────────

describe("P5-TOOL-01: MCP tools + route registered", () => {
  it("tool-definitions.ts exposes the 3 proposal tools", async () => {
    const mod = await import("../../../../apps/mcp-client/src/tool-definitions.js");
    const defs = (mod as any).TOOL_DEFINITIONS as Array<{ name: string; apiEndpoint: string }>;
    const names = defs.map((d) => d.name);
    expect(names).toContain("list_proposals");
    expect(names).toContain("approve_proposal");
    expect(names).toContain("reject_proposal");
    const approve = defs.find((d) => d.name === "approve_proposal")!;
    expect(approve.apiEndpoint).toBe("/api/v1/proposal/approve");
  });

  it("routes/proposals.ts exports proposalRoutes", async () => {
    const mod = await import("../../../../apps/tools-api/src/routes/proposals.js");
    expect((mod as any).proposalRoutes).toBeDefined();
  });
});
