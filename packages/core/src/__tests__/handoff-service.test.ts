/**
 * HandoffService tests (Phase 6 — cross-session handoffs, G2).
 *
 * Test-isolation rule (Phase 1/2/3/4): do NOT `mock.module("@massa-ai/shared")`
 * (process-wide collision — memory-crud.test.ts owns it). Inject a fake
 * HandoffStore, a fake HandoffMemorySeam, and a fake LlmSurface. The single
 * P6-SEARCH-01 integration block mirrors bootstrap-service.test.ts's P4-SEARCH-01:
 * it resets the MemoryRepository singleton to a temp dataDir and restores it
 * in afterEach.
 */

import { describe, expect, it, beforeAll, afterAll, beforeEach, afterEach } from "bun:test";
import fs from "fs";
import path from "path";
import os from "os";
import type { z } from "zod";

import {
  HandoffService,
  buildHandoffMemoryInput,
  formatMemoryContent,
  type HandoffMemorySeam,
} from "../services/handoff/handoff-service.js";
import {
  MemoryHandoffStore,
  type HandoffRecord,
  type HandoffStore,
} from "../data/handoff/handoff-repository.js";
import type { InsertMemoryInput } from "../data/memory/memory-repository.js";
import type { LlmSurface } from "../services/memory/consolidator.js";
import { eventBus } from "../services/events/event-bus.js";
import { MemoryLevel, MemoryType } from "@massa-ai/shared";

// ── Fakes ────────────────────────────────────────────────────────────────────

interface CapturedInsert extends InsertMemoryInput {}

function makeFakeMemoryRepo(): HandoffMemorySeam & { inserted: CapturedInsert[] } {
  const inserted: CapturedInsert[] = [];
  const repo = {
    inserted,
    insert(input: InsertMemoryInput): void {
      inserted.push(input);
    },
  };
  return repo as any;
}

function makeFakeStore(): HandoffStore & { rows: HandoffRecord[] } {
  return new MemoryHandoffStore() as any;
}

function enabledSummarySurface(summary: string): LlmSurface {
  return {
    isEnabled: () => true,
    async object<T>(_prompt: string, _schema: z.ZodSchema<T>) {
      return { ok: true, value: { summary } as any as T };
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

function failingSurface(): LlmSurface {
  return {
    isEnabled: () => true,
    async object() {
      return { ok: false, error: "boom" };
    },
  };
}

let idCounter = 0;
function deterministicIdFactory() {
  return () => `handoff_test_${Date.now()}_${idCounter++}`;
}

// ── Service-level AC tests ───────────────────────────────────────────────────

describe("HandoffService — begin", () => {
  let store: ReturnType<typeof makeFakeStore>;
  let mem: ReturnType<typeof makeFakeMemoryRepo>;
  let svc: HandoffService;

  beforeEach(() => {
    store = makeFakeStore();
    mem = makeFakeMemoryRepo();
    svc = new HandoffService({
      store,
      memoryRepo: mem,
      llm: disabledSurface(),
      idFactory: deterministicIdFactory(),
    });
  });

  it("P6-BEGIN-01: creates an open handoff row + returns id/status/memoryId", async () => {
    const res = await svc.begin({
      projectId: "proj-a",
      sourceSessionId: "sess-1",
      targetAgent: "agent-b",
      summary: "Implement handoff begin path",
      openQuestions: ["How to scope projectId?"],
      nextSteps: ["Write tests", "Wire route"],
      files: ["src/h.ts"],
    });
    expect(res.ok).toBe(true);
    expect(res.status).toBe("open");
    expect(res.id).toMatch(/^handoff_test_/);
    expect(res.memoryId).toMatch(/^handoff-mem-/);
    expect(store.rows.length).toBe(1);
    const row = store.rows[0];
    expect(row.status).toBe("open");
    expect(row.projectId).toBe("proj-a");
    expect(row.summary).toContain("Implement handoff begin path");
    expect(row.targetAgent).toBe("agent-b");
    expect(row.sourceSessionId).toBe("sess-1");
    expect(row.openQuestions).toEqual(["How to scope projectId?"]);
    expect(row.nextSteps).toEqual(["Write tests", "Wire route"]);
    expect(row.files).toEqual(["src/h.ts"]);
    expect(row.acceptedAt).toBeNull();
  });

  it("P6-BEGIN-01: missing projectId -> {ok:false, missing-project}", async () => {
    const res = await svc.begin({ projectId: "", summary: "x" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing-project");
    expect(store.rows.length).toBe(0);
  });

  it("P6-DUALWRITE-01: dual-write memory has conversation type, PROJECT level, 0.7 importance, handoff tags, no embedding", async () => {
    await svc.begin({
      projectId: "proj-dw",
      summary: "dualwrite-summary-token",
    });
    expect(mem.inserted.length).toBe(1);
    const m = mem.inserted[0];
    expect(m.type).toBe(MemoryType.CONVERSATION);
    expect(m.level).toBe(MemoryLevel.PROJECT);
    expect(m.importance).toBe(0.7);
    expect(m.tags).toContain("handoff");
    expect(m.tags.some((t) => t.startsWith("handoff:handoff_test_"))).toBe(true);
    expect(m.tags).toContain("handoff:proj-dw");
    expect(m.embedding).toEqual([]);
    expect(m.metadata?.source).toBe("handoff");
  });

  it("P6-DEGRADE-01: empty summary + LLM off -> stores empty/auto summary, no throw", async () => {
    const res = await svc.begin({ projectId: "proj-d", summary: "" });
    expect(res.ok).toBe(true);
    expect(store.rows[0].summary).toBe("");
  });

  it("P6-DEGRADE-01 (polish): empty summary + LLM on -> polished summary used", async () => {
    const svc2 = new HandoffService({
      store,
      memoryRepo: mem,
      llm: enabledSummarySurface("Polished summary from LLM"),
      idFactory: deterministicIdFactory(),
    });
    const res = await svc2.begin({ projectId: "proj-polish", summary: "" });
    expect(res.ok).toBe(true);
    expect(store.rows[store.rows.length - 1].summary).toBe("Polished summary from LLM");
  });

  it("P6-DEGRADE-01 (polish-fail): empty summary + LLM on but {ok:false} -> empty summary, no throw", async () => {
    const svc3 = new HandoffService({
      store,
      memoryRepo: mem,
      llm: failingSurface(),
      idFactory: deterministicIdFactory(),
    });
    const res = await svc3.begin({ projectId: "proj-polish-fail", summary: "" });
    expect(res.ok).toBe(true);
    expect(store.rows[store.rows.length - 1].summary).toBe("");
  });

  it("begin: dedup + trim openQuestions/nextSteps/files", async () => {
    await svc.begin({
      projectId: "proj-dd",
      summary: "s",
      openQuestions: ["  q1  ", "q1", "", "q2"],
      nextSteps: ["s1"],
      files: ["f1", "f1"],
    });
    const row = store.rows[store.rows.length - 1];
    expect(row.openQuestions).toEqual(["q1", "q2"]);
    expect(row.nextSteps).toEqual(["s1"]);
    expect(row.files).toEqual(["f1"]);
  });

  it("begin: canonical store insert failure propagates", async () => {
    const throwingStore = makeFakeStore();
    throwingStore.insert = async () => {
      throw new Error("boom");
    };
    const svcThrow = new HandoffService({
      store: throwingStore,
      memoryRepo: mem,
      llm: disabledSurface(),
      idFactory: deterministicIdFactory(),
    });
    await expect(svcThrow.begin({ projectId: "p", summary: "s" })).rejects.toThrow("boom");
  });

  it("begin: memory insert throws -> still ok, memoryId null", async () => {
    const throwingMem: HandoffMemorySeam = {
      insert(): void {
        throw new Error("mem boom");
      },
    };
    const svcMem = new HandoffService({
      store,
      memoryRepo: throwingMem,
      llm: disabledSurface(),
      idFactory: deterministicIdFactory(),
    });
    const res = await svcMem.begin({ projectId: "p", summary: "s" });
    expect(res.ok).toBe(true);
    expect(res.memoryId).toBeNull();
  });
});

describe("HandoffService — accept", () => {
  let store: ReturnType<typeof makeFakeStore>;
  let svc: HandoffService;
  let openId: string;

  beforeEach(async () => {
    store = makeFakeStore();
    svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      idFactory: deterministicIdFactory(),
    });
    const r = await svc.begin({
      projectId: "proj-a",
      summary: "to accept",
      targetAgent: "agent-b",
    });
    openId = r.id!;
  });

  it("P6-ACCEPT-01: accept flips status to accepted, sets acceptedAt, emits handoff:accepted", async () => {
    let captured: any = null;
    const unsub = eventBus.subscribe("handoff:accepted", (p) => {
      captured = p;
    });
    try {
      const before = Date.now();
      const res = await svc.accept({ id: openId });
      const after = Date.now();
      expect(res.ok).toBe(true);
      expect(res.handoff!.status).toBe("accepted");
      expect(res.handoff!.acceptedAt).toBeGreaterThanOrEqual(before);
      expect(res.handoff!.acceptedAt).toBeLessThanOrEqual(after);
      // event
      expect(captured).not.toBeNull();
      expect(captured.handoffId).toBe(openId);
      expect(captured.projectId).toBe("proj-a");
      expect(captured.targetAgent).toBe("agent-b");
      expect(typeof captured.acceptedAt).toBe("number");
    } finally {
      unsub();
    }
  });

  it("P6-FAIL-01: accept on missing id -> {ok:false, not-found}", async () => {
    let eventFired = false;
    const unsub = eventBus.subscribe("handoff:accepted", () => {
      eventFired = true;
    });
    try {
      const res = await svc.accept({ id: "does-not-exist" });
      expect(res.ok).toBe(false);
      expect(res.reason).toBe("not-found");
      expect(eventFired).toBe(false);
    } finally {
      unsub();
    }
  });

  it("P6-FAIL-02: accept on already-accepted -> {ok:false, not-open}, acceptedAt unchanged", async () => {
    const first = await svc.accept({ id: openId });
    const firstAcceptedAt = first.handoff!.acceptedAt;
    let eventFired = false;
    const unsub = eventBus.subscribe("handoff:accepted", () => {
      eventFired = true;
    });
    try {
      const second = await svc.accept({ id: openId });
      expect(second.ok).toBe(false);
      expect(second.reason).toBe("not-open");
      expect(eventFired).toBe(false);
      // acceptedAt unchanged
      const row = store.rows.find((r) => r.id === openId);
      expect(row!.acceptedAt).toBe(firstAcceptedAt);
    } finally {
      unsub();
    }
  });

  it("P6-FAIL-03: accept with projectId mismatch -> {ok:false, project-mismatch}", async () => {
    const res = await svc.accept({ id: openId, projectId: "wrong-project" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("project-mismatch");
    // status unchanged
    const row = store.rows.find((r) => r.id === openId);
    expect(row!.status).toBe("open");
  });

  it("accept: missing id -> {ok:false, missing-id}", async () => {
    const res = await svc.accept({ id: "" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("missing-id");
  });
});

describe("HandoffService — cancel", () => {
  let store: ReturnType<typeof makeFakeStore>;
  let svc: HandoffService;
  let openId: string;

  beforeEach(async () => {
    store = makeFakeStore();
    svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      idFactory: deterministicIdFactory(),
    });
    const r = await svc.begin({ projectId: "proj-c", summary: "to cancel" });
    openId = r.id!;
  });

  it("P6-CANCEL-01: cancel flips status to expired; no handoff:accepted event", async () => {
    let eventFired = false;
    const unsub = eventBus.subscribe("handoff:accepted", () => {
      eventFired = true;
    });
    try {
      const res = await svc.cancel({ id: openId });
      expect(res.ok).toBe(true);
      expect(res.handoff!.status).toBe("expired");
      expect(res.handoff!.acceptedAt).toBeNull();
      expect(eventFired).toBe(false);
    } finally {
      unsub();
    }
  });

  it("P6-FAIL-02: cancel on expired -> {ok:false, not-open}", async () => {
    await svc.cancel({ id: openId });
    const second = await svc.cancel({ id: openId });
    expect(second.ok).toBe(false);
    expect(second.reason).toBe("not-open");
  });

  it("P6-FAIL-01: cancel on missing id -> {ok:false, not-found}", async () => {
    const res = await svc.cancel({ id: "missing" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("not-found");
  });
});

describe("HandoffService — listPending (auto-inject surfacing)", () => {
  it("P6-AUTOINJECT-01: returns only open handoffs for project/target, ordered oldest-first", async () => {
    const store = makeFakeStore();
    const svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      // distinct ids with monotonic-ish createdAt
      idFactory: (() => {
        let n = 0;
        return () => `h_${++n}`;
      })(),
    });
    await svc.begin({ projectId: "p1", targetAgent: "a1", summary: "1" });
    await new Promise((r) => setTimeout(r, 5));
    await svc.begin({ projectId: "p1", targetAgent: "a1", summary: "2" });
    await new Promise((r) => setTimeout(r, 5));
    await svc.begin({ projectId: "p1", targetAgent: "a2", summary: "3" });
    await svc.begin({ projectId: "p2", targetAgent: "a1", summary: "4" });

    // all p1
    const all = await svc.listPending("p1");
    expect(all.length).toBe(3);
    expect(all.map((h) => h.summary)).toEqual(["1", "2", "3"]);

    // target a1 only (broadcast nulls included)
    const a1 = await svc.listPending("p1", "a1");
    expect(a1.length).toBe(2);
    expect(a1.map((h) => h.summary)).toEqual(["1", "2"]);

    // accept one -> excluded
    await svc.accept({ id: all[0].id });
    const afterAccept = await svc.listPending("p1");
    expect(afterAccept.length).toBe(2);
    expect(afterAccept.find((h) => h.summary === "1")).toBeUndefined();

    // p2 untouched
    expect((await svc.listPending("p2")).length).toBe(1);
  });

  it("listPending: canonical store failure propagates", async () => {
    const throwingStore = makeFakeStore();
    throwingStore.listPending = async () => {
      throw new Error("boom");
    };
    const svc = new HandoffService({
      store: throwingStore,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
    });
    await expect(svc.listPending("p")).rejects.toThrow("boom");
  });
});

describe("HandoffService — P6-EVENT-01 handoff:accepted event shape", () => {
  it("payload has handoffId, projectId?, sourceSessionId?, targetAgent?, acceptedAt", async () => {
    const store = makeFakeStore();
    const svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      idFactory: () => "h_event",
    });
    await svc.begin({
      projectId: "p-evt",
      sourceSessionId: "s-evt",
      targetAgent: "a-evt",
      summary: "x",
    });
    let captured: any = null;
    const unsub = eventBus.subscribe("handoff:accepted", (p) => {
      captured = p;
    });
    try {
      await svc.accept({ id: "h_event" });
      expect(captured).not.toBeNull();
      expect(captured.handoffId).toBe("h_event");
      expect(captured.projectId).toBe("p-evt");
      expect(captured.sourceSessionId).toBe("s-evt");
      expect(captured.targetAgent).toBe("a-evt");
      expect(typeof captured.acceptedAt).toBe("number");
    } finally {
      unsub();
    }
  });
});

describe("HandoffAutoInjector — session-start surfacing", () => {
  it("P6-AUTOINJECT-01: on session-start observation:ingested, listPending is consulted", async () => {
    const { HandoffAutoInjector } = await import("../services/handoff/handoff-auto-injector.js");
    const store = makeFakeStore();
    const svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      idFactory: () => "h_inject",
    });
    await svc.begin({ projectId: "p-inj", targetAgent: "a-inj", summary: "pending" });
    const injector = new HandoffAutoInjector(svc);
    injector.start();
    try {
      // simulate the Phase-3 session-start observation event
      eventBus.publish("observation:ingested", {
        observationId: "obs-1",
        projectId: "p-inj",
        sessionId: "s-new",
        source: "session-start",
        importance: 0.5,
      });
      // listPending still works as the recall path
      const pending = await svc.listPending("p-inj");
      expect(pending.length).toBe(1);
      expect(pending[0].id).toBe("h_inject");
    } finally {
      injector.stop();
    }
  });

  it("ignores non-session-start observations", async () => {
    const { HandoffAutoInjector } = await import("../services/handoff/handoff-auto-injector.js");
    const store = makeFakeStore();
    const svc = new HandoffService({
      store,
      memoryRepo: makeFakeMemoryRepo(),
      llm: disabledSurface(),
      idFactory: () => "h_ignore",
    });
    await svc.begin({ projectId: "p-ign", summary: "x" });
    const injector = new HandoffAutoInjector(svc);
    injector.start();
    try {
      // should not throw / not affect pending list
      eventBus.publish("observation:ingested", {
        observationId: "obs-2",
        projectId: "p-ign",
        source: "post-tool-use",
        importance: 0.3,
      });
      expect((await svc.listPending("p-ign")).length).toBe(1);
    } finally {
      injector.stop();
    }
  });
});

// ── Pure helpers ─────────────────────────────────────────────────────────────

describe("HandoffService — pure helpers", () => {
  it("buildHandoffMemoryInput builds the expected InsertMemoryInput", () => {
    const record: HandoffRecord = {
      id: "h1",
      projectId: "p1",
      sourceSessionId: "s1",
      targetAgent: "a1",
      summary: "summary text",
      openQuestions: ["q1"],
      nextSteps: ["n1"],
      files: ["f1"],
      status: "open",
      createdAt: 1000,
      acceptedAt: null,
    };
    const input = buildHandoffMemoryInput("mem1", record);
    expect(input.id).toBe("mem1");
    expect(input.type).toBe(MemoryType.CONVERSATION);
    expect(input.level).toBe(MemoryLevel.PROJECT);
    expect(input.importance).toBe(0.7);
    expect(input.projectId).toBe("p1");
    expect(input.tags).toContain("handoff");
    expect(input.tags).toContain("handoff:h1");
    expect(input.tags).toContain("handoff:p1");
    expect(input.embedding).toEqual([]);
    expect(input.metadata).toMatchObject({
      source: "handoff",
      handoffId: "h1",
      targetAgent: "a1",
      sourceSessionId: "s1",
    });
    expect(input.pinned).toBe(false);
  });

  it("formatMemoryContent includes summary + sections", () => {
    const record: HandoffRecord = {
      id: "h",
      projectId: "p",
      sourceSessionId: null,
      targetAgent: null,
      summary: "my summary",
      openQuestions: ["q"],
      nextSteps: ["n"],
      files: ["f"],
      status: "open",
      createdAt: 1,
      acceptedAt: null,
    };
    const out = formatMemoryContent(record);
    expect(out).toContain("Handoff: my summary");
    expect(out).toContain("Open questions: q");
    expect(out).toContain("Next steps: n");
    expect(out).toContain("Files: f");
  });

  it("formatMemoryContent handles empty summary", () => {
    const record: HandoffRecord = {
      id: "h",
      projectId: "p",
      sourceSessionId: null,
      targetAgent: null,
      summary: "",
      openQuestions: [],
      nextSteps: [],
      files: [],
      status: "open",
      createdAt: 1,
      acceptedAt: null,
    };
    expect(formatMemoryContent(record)).toContain("(no summary)");
  });
});
