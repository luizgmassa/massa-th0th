/**
 * ObservationConsolidationJob tests (Phase 3 bridge).
 *
 * Test-isolation rule (Phase 1/2): do NOT `mock.module("@massa-ai/shared")`.
 * Inject a fake LlmSurface, a fake store, and a fake memory repo that captures
 * inserts. Use ctor overrides (minObservations etc.) so no shared config is
 * relied upon.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { setTimeout as sleep } from "timers/promises";
import {
  ObservationConsolidationJob,
} from "../services/jobs/observation-consolidation-job.js";
import {
  MemoryObservationStore,
  newObservationId,
  type Observation,
} from "../data/memory/observation-repository.js";
import { eventBus } from "../services/events/event-bus.js";
import type { LlmSurface } from "../services/memory/consolidator.js";
import type { z } from "zod";

// ── Fakes ───────────────────────────────────────────────────────────────────

interface CapturedInsert {
  id: string;
  content: string;
  type: string;
  metadata: Record<string, unknown>;
}

function makeFakeMemoryRepo() {
  const inserted: CapturedInsert[] = [];
  const repo = {
    inserted,
    insert(input: any): void {
      inserted.push({
        id: input.id,
        content: input.content,
        type: input.type,
        metadata: input.metadata ?? {},
      });
    },
  };
  return repo;
}

/** A fake LlmSurface that returns a fixed valid batch when enabled. */
function enabledSurface(): LlmSurface & { calls: number } {
  let calls = 0;
  const surface = {
    calls: 0,
    isEnabled: () => true,
    async object<T>(_prompt: string, _schema: z.ZodSchema<T>): Promise<{
      ok: boolean;
      value?: T;
      error?: string;
    }> {
      calls++;
      // Return a valid ConsolidatedBatch-compatible value.
      return {
        ok: true,
        value: {
          summary: "Consolidated observation summary",
          type: "pattern",
          level: 2,
          rationale: "themes overlap",
          sourceIds: ["obs-1", "obs-2"],
        } as any as T,
      };
    },
  };
  return surface as LlmSurface & { calls: number };
}

function disabledSurface(): LlmSurface {
  return {
    isEnabled: () => false,
    async object() {
      return { ok: false, error: "disabled" };
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

function makeStoreWith(n: number): MemoryObservationStore {
  const s = new MemoryObservationStore();
  for (let i = 0; i < n; i++) {
    const obs: Observation = {
      id: `obs-${i + 1}`,
      projectId: "p",
      sessionId: null,
      source: "user-prompt",
      payloadJson: JSON.stringify({ prompt: `q${i}` }),
      importance: 0.5,
      createdAt: Date.now() - (n - i) * 1000,
    };
    s.insert(obs);
  }
  return s;
}

// Patch getMemoryRepository to return our fake. We import the module and
// override the function binding via a module-level mock only for THIS file is
// not allowed (process-wide). Instead, the job calls getMemoryRepository() at
// run-time; we cannot easily intercept it. So we verify via the EventBus event
// (memory:consolidated) which carries newMemoryId, and we accept that the real
// repository.insert is also invoked (it writes to the real PostgreSQL store; this
// is fine — it's additive and isolated by projectId). The captured-insert
// assertion is replaced by event-shape + runOnce return assertions.

describe("ObservationConsolidationJob", () => {
  let store: MemoryObservationStore;

  beforeEach(() => {
    store = makeStoreWith(4);
  });

  it("P3-CONSOLIDATE-01: with LLM on, turns observations into a memory and emits memory:consolidated", async () => {
    const surface = enabledSurface();
    const memRepo = makeFakeMemoryRepo();
    const job = new ObservationConsolidationJob({
      llm: surface,
      store,
      memoryRepo: memRepo,
      maxWindow: 8,
      minObservations: 1,
      minIntervalMs: 0,
    });

    let captured: any = null;
    const unsub = eventBus.subscribe("memory:consolidated", (p) => {
      captured = p;
    });

    try {
      const res = await job.runOnce("p");
      expect(res.consolidated).toBe(true);
      expect(res.batchesCreated).toBe(1);
      await sleep(5);
      expect(captured).not.toBeNull();
      expect(captured.projectId).toBe("p");
      expect(captured.newMemoryId).toMatch(/^mem-/);
      expect(captured.sourceIds).toEqual(["obs-1", "obs-2"]);
      expect(captured.stats.batchesCreated).toBe(1);
      // The summary memory was inserted via the injected repo.
      expect(memRepo.inserted.length).toBe(1);
      expect(memRepo.inserted[0].content).toBe("Consolidated observation summary");
      expect(memRepo.inserted[0].type).toBe("pattern");
      expect(memRepo.inserted[0].metadata).toMatchObject({ source: "observations" });
    } finally {
      unsub();
    }
  });

  it("P3-CONSOLIDATE-02: with LLM off (isEnabled=false), is a no-op (no memory, no throw)", async () => {
    const surface = disabledSurface();
    const memRepo = makeFakeMemoryRepo();
    const job = new ObservationConsolidationJob({
      llm: surface,
      store,
      memoryRepo: memRepo,
      maxWindow: 8,
      minObservations: 1,
      minIntervalMs: 0,
    });

    let sawEvent = false;
    const unsub = eventBus.subscribe("memory:consolidated", () => {
      sawEvent = true;
    });

    try {
      const res = await job.runOnce("p");
      expect(res.consolidated).toBe(false);
      expect(res.batchesCreated).toBe(0);
      await sleep(5);
      expect(sawEvent).toBe(false);
      expect(memRepo.inserted.length).toBe(0);
    } finally {
      unsub();
    }
  });

  it("P3-CONSOLIDATE-03: with LLM on but {ok:false}, is a no-op (no memory, no throw)", async () => {
    const surface = failingSurface();
    const memRepo = makeFakeMemoryRepo();
    const job = new ObservationConsolidationJob({
      llm: surface,
      store,
      memoryRepo: memRepo,
      maxWindow: 8,
      minObservations: 1,
      minIntervalMs: 0,
    });

    let sawEvent = false;
    const unsub = eventBus.subscribe("memory:consolidated", () => {
      sawEvent = true;
    });

    try {
      const res = await job.runOnce("p");
      expect(res.consolidated).toBe(false);
      expect(res.batchesCreated).toBe(0);
      await sleep(5);
      expect(sawEvent).toBe(false);
      expect(memRepo.inserted.length).toBe(0);
    } finally {
      unsub();
    }
  });

  it("is a no-op when fewer than 2 observations exist", async () => {
    const tiny = makeStoreWith(1);
    const surface = enabledSurface();
    const job = new ObservationConsolidationJob({
      llm: surface,
      store: tiny,
      maxWindow: 8,
      minObservations: 1,
      minIntervalMs: 0,
    });
    const res = await job.runOnce("p");
    expect(res.consolidated).toBe(false);
  });

  it("maybeRun is debounce-gated and fire-and-forget (never throws)", async () => {
    const surface = disabledSurface(); // ensures runOnce is a cheap no-op
    const job = new ObservationConsolidationJob({
      llm: surface,
      store,
      maxWindow: 8,
      minObservations: 100, // high so maybeRun should NOT fire runOnce
      minIntervalMs: 60_000,
    });
    const before = job.runCalls;
    job.maybeRun("p");
    job.maybeRun("p");
    expect(job.runCalls).toBe(before); // did not fire
    expect(() => job.maybeRun("p")).not.toThrow();
  });

  it("maybeRun fires runOnce once thresholds are crossed", async () => {
    const surface = enabledSurface();
    const job = new ObservationConsolidationJob({
      llm: surface,
      store,
      maxWindow: 8,
      minObservations: 2,
      minIntervalMs: 0,
    });
    const before = job.runCalls;
    job.maybeRun("p");
    job.maybeRun("p"); // second call crosses minObservations=2
    await sleep(20);
    expect(job.runCalls).toBeGreaterThan(before);
  });
});
