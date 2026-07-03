/**
 * HookService tests (Phase 3).
 *
 * Test-isolation rule (Phase 1/2): do NOT `mock.module("@massa-th0th/shared")` —
 * it is process-wide. Construct HookService with injected MemoryObservationStore
 * + a fake bridge + explicit maxPending/maxPayloadBytes so no shared config
 * singleton is relied upon.
 */

import { describe, expect, it, beforeEach } from "bun:test";
import { setTimeout as sleep } from "timers/promises";
import {
  HookService,
  ValidationError,
  validateEvent,
  type IncomingEvent,
  type BridgeTrigger,
} from "../services/hooks/hook-service.js";
import { QueueSaturatedError } from "../services/hooks/writer-queue.js";
import {
  MemoryObservationStore,
  type ObservationStore,
} from "../data/memory/observation-repository.js";
import { eventBus } from "../services/events/event-bus.js";

function validEvent(over: Partial<IncomingEvent> = {}): IncomingEvent {
  return {
    event: over.event ?? "user-prompt",
    projectId: over.projectId ?? "proj-1",
    sessionId: over.sessionId,
    payload: over.payload ?? { prompt: "hello" },
    importance: over.importance,
    agentId: over.agentId,
    ts: over.ts,
  };
}

function makeService(opts: {
  store?: ObservationStore;
  maxPending?: number;
  maxPayloadBytes?: number;
  bridge?: BridgeTrigger;
} = {}): { svc: HookService; store: MemoryObservationStore; bridge: FakeBridge } {
  const store = opts.store ?? new MemoryObservationStore();
  const bridge = opts.bridge ?? new FakeBridge();
  const svc = new HookService({
    store,
    maxPending: opts.maxPending ?? 256,
    maxPayloadBytes: opts.maxPayloadBytes ?? 65_536,
    bridge,
    idFactory: () => `id-${Math.random().toString(36).slice(2, 8)}`,
  });
  return { svc, store, bridge };
}

class FakeBridge implements BridgeTrigger {
  calls: string[] = [];
  maybeRun(projectId: string): void {
    this.calls.push(projectId);
  }
}

// allow the writer turn to flush
async function flush(): Promise<void> {
  await sleep(10);
}

// ── validateEvent (pure) ────────────────────────────────────────────────────

describe("validateEvent", () => {
  it("accepts a valid event and normalizes (case-insensitive kind, default importance, ts)", () => {
    const r = validateEvent(
      { event: "USER-PROMPT", projectId: "p", payload: { x: 1 } },
      65_536,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.event.event).toBe("user-prompt");
    expect(r.event.importance).toBe(0.5);
    expect(r.event.sessionId).toBeNull();
    expect(typeof r.event.ts).toBe("number");
  });

  it("rejects unknown event kind (400)", () => {
    const r = validateEvent(validEvent({ event: "nope" }), 65_536);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(400);
  });

  it("rejects empty projectId (400)", () => {
    const r = validateEvent(validEvent({ projectId: "  " }), 65_536);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(400);
  });

  it("rejects non-object / empty payload (400)", () => {
    expect(validateEvent({ ...validEvent(), payload: [] as any }, 65_536)).toMatchObject({ ok: false, code: 400 });
    expect(validateEvent({ ...validEvent(), payload: {} }, 65_536)).toMatchObject({ ok: false, code: 400 });
    expect(validateEvent({ ...validEvent(), payload: "str" as any }, 65_536)).toMatchObject({ ok: false, code: 400 });
  });

  it("rejects oversized payload (413)", () => {
    const big = { blob: "x".repeat(1000) };
    const r = validateEvent(validEvent({ payload: big }), 100);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.code).toBe(413);
  });

  it("clamps importance to [0,1] instead of rejecting", () => {
    expect(validateEvent(validEvent({ importance: 5 }), 65_536)).toMatchObject({ ok: true });
    const r = validateEvent(validEvent({ importance: -2 }), 65_536);
    if (!r.ok) throw new Error("expected ok");
    expect(r.event.importance).toBe(0);
  });
});

// ── ingestOne / ingestBatch ─────────────────────────────────────────────────

describe("HookService.ingestOne", () => {
  let env: ReturnType<typeof makeService>;
  beforeEach(() => {
    env = makeService();
  });

  it("P3-INGEST-01: persists exactly one observation and returns an id", async () => {
    const id = await env.svc.ingestOne(validEvent({ projectId: "p1" }));
    await flush();
    expect(typeof id).toBe("string");
    expect(id.length).toBeGreaterThan(0);
    expect(env.store.countByProject("p1")).toBe(1);
    const obs = env.store.listRecent("p1", 1)[0];
    expect(obs.id).toBe(id);
    expect(obs.source).toBe("user-prompt");
  });

  it("P3-VALIDATE-02: throws ValidationError(400) on malformed event", async () => {
    expect(() => env.svc.ingestOne(validEvent({ event: "bogus" }))).toThrow(ValidationError);
    await flush();
    expect(env.store.rows.length).toBe(0);
  });

  it("P3-VALIDATE-01: throws ValidationError(413) on oversized payload", async () => {
    const svc = new HookService({
      store: env.store,
      maxPayloadBytes: 50,
      bridge: env.bridge,
      idFactory: () => "x",
    });
    expect(() => svc.ingestOne(validEvent({ payload: { big: "x".repeat(200) } }))).toThrow(ValidationError);
    await flush();
    expect(env.store.rows.length).toBe(0);
  });

  it("P3-QUEUE-01: persists in submission order under concurrent posts", async () => {
    const ids: string[] = [];
    let counter = 0;
    const svc = new HookService({
      store: env.store,
      maxPending: 256,
      bridge: env.bridge,
      idFactory: () => `o${counter++}`,
    });
    // Fire 5 concurrently; the promise-chain serializes them.
    await Promise.all([
      svc.ingestOne(validEvent({ projectId: "p", ts: 1 })),
      svc.ingestOne(validEvent({ projectId: "p", ts: 2 })),
      svc.ingestOne(validEvent({ projectId: "p", ts: 3 })),
      svc.ingestOne(validEvent({ projectId: "p", ts: 4 })),
      svc.ingestOne(validEvent({ projectId: "p", ts: 5 })),
    ]);
    await flush();
    expect(env.store.countByProject("p")).toBe(5);
    // The store preserves insertion order; the queue preserves admission order.
  });

  it("P3-EVENT-01: emits observation:ingested with the correct shape", async () => {
    let captured: any = null;
    const unsub = eventBus.subscribe("observation:ingested", (p) => {
      captured = p;
    });
    try {
      await env.svc.ingestOne(
        validEvent({ projectId: "pe", sessionId: "s1", importance: 0.7 }),
      );
      await flush();
      expect(captured).not.toBeNull();
      expect(captured.projectId).toBe("pe");
      expect(captured.sessionId).toBe("s1");
      expect(captured.source).toBe("user-prompt");
      expect(captured.importance).toBe(0.7);
      expect(typeof captured.observationId).toBe("string");
    } finally {
      unsub();
    }
  });

  it("P3-DEGRADE-01: ingestion works regardless of LLM (bridge is a no-op seam)", async () => {
    // The default bridge is NoopBridge; ingestion has no LLM dep by construction.
    const id = await env.svc.ingestOne(validEvent({ projectId: "pd" }));
    await flush();
    expect(env.store.countByProject("pd")).toBe(1);
    expect(id).toBeTruthy();
  });

  it("forwards sessionId + agentId when provided", async () => {
    await env.svc.ingestOne(
      validEvent({ projectId: "pf", sessionId: "sess", agentId: "ag" }),
    );
    await flush();
    const obs = env.store.listRecent("pf", 1)[0];
    expect(obs.sessionId).toBe("sess");
  });

  it("triggers the bridge after each persist", async () => {
    await env.svc.ingestOne(validEvent({ projectId: "pb" }));
    await env.svc.ingestOne(validEvent({ projectId: "pb" }));
    await flush();
    expect(env.bridge.calls.length).toBe(2);
    expect(env.bridge.calls.every((p) => p === "pb")).toBe(true);
  });
});

describe("HookService.ingestBatch", () => {
  let env: ReturnType<typeof makeService>;
  beforeEach(() => {
    env = makeService();
  });

  it("P3-INGEST-02: persists N events and returns N ids", async () => {
    const ids = await env.svc.ingestBatch([
      validEvent({ projectId: "b1" }),
      validEvent({ projectId: "b1", event: "post-tool-use" }),
      validEvent({ projectId: "b1", event: "session-end" }),
    ]);
    await flush();
    expect(ids.length).toBe(3);
    expect(new Set(ids).size).toBe(3);
    expect(env.store.countByProject("b1")).toBe(3);
  });

  it("rejects the whole batch if any event is malformed (atomic)", async () => {
    expect(() =>
      env.svc.ingestBatch([
        validEvent({ projectId: "b2" }),
        validEvent({ event: "nope" }),
      ]),
    ).toThrow(ValidationError);
    await flush();
    expect(env.store.countByProject("b2")).toBe(0);
  });

  it("rejects an empty/non-array batch", async () => {
    expect(() => env.svc.ingestBatch([])).toThrow(ValidationError);
  });
});

// ── Backpressure ────────────────────────────────────────────────────────────

describe("WriterQueue saturation (P3-BACKPRESSURE)", () => {
  it("P3-BACKPRESSURE-01: throws QueueSaturatedError when full and does not persist", async () => {
    // maxPending = 1; a single in-flight work holds the slot.
    const store = new MemoryObservationStore();
    let releaseWork: () => void = () => {};
    const blockingBridge: BridgeTrigger = {
      maybeRun() {
        /* no-op */
      },
    };
    const svc = new HookService({
      store,
      maxPending: 1,
      bridge: blockingBridge,
      idFactory: () => `s${Math.random()}`,
    });
    // Block the writer turn so the slot stays occupied.
    const block = new Promise<void>((resolve) => {
      releaseWork = resolve;
    });
    // Manually occupy the queue.
    void svc.queue.enqueue(async () => {
      await block;
    });
    expect(svc.queue.saturated).toBe(true);

    // A second ingest must throw QueueSaturatedError before persisting.
    let threw = false;
    try {
      await svc.ingestOne(validEvent({ projectId: "sat" }));
    } catch (e) {
      threw = e instanceof QueueSaturatedError;
    }
    expect(threw).toBe(true);
    expect(store.countByProject("sat")).toBe(0);

    // Release the blocked work.
    releaseWork();
    await flush();
  });

  it("P3-BACKPRESSURE-02: queue recovers after drain", async () => {
    const { svc, store } = makeService({ maxPending: 1 });
    // First event admitted; queue pending briefly hits 1 then drains.
    await svc.ingestOne(validEvent({ projectId: "rec" }));
    await flush();
    expect(svc.queue.pendingCount).toBe(0);
    // Second event should now succeed.
    const id2 = await svc.ingestOne(validEvent({ projectId: "rec" }));
    await flush();
    expect(store.countByProject("rec")).toBe(2);
    expect(id2).toBeTruthy();
  });

  it("QueueSaturatedError carries a retryAfter hint", () => {
    const e = new QueueSaturatedError(2);
    expect(e.retryAfterSeconds).toBe(2);
    expect(e).toBeInstanceOf(Error);
  });
});
