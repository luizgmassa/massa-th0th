/**
 * Bridge-wiring tests (SG-6 / task #20).
 *
 * Verifies that getHookService() wires the REAL ObservationConsolidationJob
 * (not NoopBridge) so captured observations flow into the consolidation
 * pipeline, and that the bridge receives newly-ingested observations.
 *
 * Isolation: construct via getHookService (production path) but drive the
 * singleton's job through its public counters (runCalls / newSinceRun). Reset
 * between cases. No process-wide config mock.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { setTimeout as sleep } from "timers/promises";
import {
  getHookService,
  resetHookService,
  type IncomingEvent,
} from "../services/hooks/hook-service.js";
import {
  resetAttributionResolver,
  setAttributionResolverForTests,
} from "../services/hooks/attribution-resolver.js";
import { observationConsolidationJob } from "../services/jobs/observation-consolidation-job.js";
import { eventBus } from "../services/events/event-bus.js";

// allow the writer turn to flush
async function flush(): Promise<void> {
  await sleep(15);
}

// Hermetic verbatim resolver — prevents the production PG-backed resolver from
// touching shared DB state during these singleton-wiring tests (M45 regression
// guard). Defined once, reused across cases.
const VERBATIM_RESOLVER = {
  resolve: async (input: { callerProjectId: string }) =>
    ({ projectId: input.callerProjectId, source: "verbatim" as const }),
  pinSession: () => {},
};

function validEvent(over: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    event: over.event ?? "user-prompt",
    projectId: over.projectId ?? "proj-bridge",
    sessionId: over.sessionId,
    payload: over.payload ?? { prompt: "hello" },
    importance: over.importance,
    agentId: over.agentId,
    ts: over.ts,
  };
}

describe("getHookService bridge wiring (#20)", () => {
  beforeEach(() => {
    resetHookService();
    resetAttributionResolver();
    setAttributionResolverForTests(VERBATIM_RESOLVER);
    // Reset the singleton job's counters so cases don't bleed.
    observationConsolidationJob.runCalls = 0;
    (observationConsolidationJob as any).newSinceRun = 0;
    (observationConsolidationJob as any).lastRunAt = 0;
  });

  it("getHookService wires the real ObservationConsolidationJob, not NoopBridge", () => {
    const svc = getHookService();
    // The bridge must be the singleton job instance (same reference).
    expect(svc.bridge).toBe(observationConsolidationJob);
    // Sanity: the job implements the BridgeTrigger contract.
    expect(typeof svc.bridge.maybeRun).toBe("function");
  });

  it("ingestion forwards observations to the consolidation bridge (maybeRun invoked)", async () => {
    const svc = getHookService();
    const before = (observationConsolidationJob as any).newSinceRun as number;
    // Subscribe to confirm the observation was actually persisted (no regression).
    let ingested = 0;
    const unsub = eventBus.subscribe("observation:ingested", () => {
      ingested++;
    });
    try {
      await svc.ingestOne(validEvent({ projectId: "p-bridge-1" }));
      await flush();
    } finally {
      unsub();
    }
    // Observation persisted (ingestion unaffected by the bridge wiring).
    expect(ingested).toBe(1);
    // maybeRun was called → newSinceRun incremented exactly once.
    const after = (observationConsolidationJob as any).newSinceRun as number;
    expect(after).toBe(before + 1);
  });

  it("multiple ingestions each trigger the bridge", async () => {
    const svc = getHookService();
    const before = (observationConsolidationJob as any).newSinceRun as number;
    await svc.ingestBatch([
      validEvent({ projectId: "p-bridge-2" }),
      validEvent({ projectId: "p-bridge-2", event: "post-tool-use" }),
      validEvent({ projectId: "p-bridge-2", event: "session-end" }),
    ]);
    await flush();
    const after = (observationConsolidationJob as any).newSinceRun as number;
    // Each persist calls maybeRun once → counter advanced by 3.
    expect(after - before).toBe(3);
  });

  it("getHookService returns a cached singleton across calls", () => {
    const a = getHookService();
    const b = getHookService();
    expect(a).toBe(b);
  });
});

describe("NoopBridge fallback intact", () => {
  it("an explicitly-injected no-op bridge still works (disabled-feature path)", async () => {
    // Construct HookService directly with a no-op bridge — mirrors the
    // !enabled / degraded path. No LLM, no consolidation.
    const { HookService } = await import("../services/hooks/hook-service.js");
    const calls: string[] = [];
    const noopBridge = { maybeRun: (p: string) => calls.push(p) };
    const svc = new HookService({
      bridge: noopBridge,
      maxPending: 16,
      resolver: VERBATIM_RESOLVER,
      idFactory: () => `id-${Math.random().toString(36).slice(2, 8)}`,
    });
    await svc.ingestOne(validEvent({ projectId: "p-noop" }));
    await flush();
    // The injected bridge is used verbatim (not swapped for the real job).
    expect(svc.bridge).toBe(noopBridge);
    expect(calls).toEqual(["p-noop"]);
  });
});
