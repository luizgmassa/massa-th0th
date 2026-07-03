/**
 * Round-3 regression tests for IMP-15, IMP-16, IMP-17.
 *
 *  IMP-15 — session endpoints (verified at the registry+buffer level here;
 *           the HTTP wiring is tested via curl in the v2 benchmark scripts)
 *  IMP-16 — pre-gate cuts results with raw vector score below threshold
 *  IMP-17 — executePrefetch composes plan → fetch → prime
 */

import { describe, test, expect } from "bun:test";
import {
  prefilterByRawScore,
} from "../services/synapse/inhibition/confidence-gate.js";
import {
  executePrefetch,
  buildPrefetchPlan,
  DEFAULT_PREFETCH_CONFIG,
  type PrefetchEntry,
} from "../services/synapse/prefetch/prefetch.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import { DEFAULT_BUFFER_CONFIG } from "../services/synapse/buffer/working-memory-buffer.js";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import type { SearchResult, SynapseRuntimeConfig } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, score: number, meta: Record<string, unknown> = {}, content: string = id): SearchResult {
  return { id, content, score, source: SearchSource.VECTOR, metadata: meta as any };
}

function makeRuntimeConfig(): SynapseRuntimeConfig {
  return {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4, samePathPenalty: 0.15 },
      temporalInhibition: { enabled: false, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: { enabled: true, thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 } },
      chainInhibition: { enabled: false },
    },
    scoring: {
      attention: {
        enabled: false,
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: { semantic: 0.25, recency: 0.15, accessHeat: 0.15, taskAlign: 0.2, agentAffinity: 0.1, confidence: 0.15 },
      },
    },
    metacognition: { enabled: false, lowConfidenceThreshold: 0.15, definitiveTopScore: 0.8, definitiveGap: 0.2 },
    buffer: { enabled: false, maxSize: 20, ttlMs: 900_000, hitBoost: 1.3, matchThreshold: 0.4 },
  };
}

// ── IMP-15 ─────────────────────────────────────────────────────────────────
describe("IMP-15: Session lifecycle exposes create/get/prime/access", () => {
  test("registry round-trip mirrors what the route does", () => {
    const reg = new SessionRegistry();
    const created = reg.create({
      sessionId: "test-1",
      agentId: "claude-code",
      taskContext: "debugging auth middleware",
      bufferConfig: DEFAULT_BUFFER_CONFIG,
    });
    expect(created.buffer).toBeDefined();

    // Update context
    const updated = reg.updateTaskContext("test-1", "new task");
    expect(updated?.taskContext).toBe("new task");

    // Record accesses
    reg.recordAccess("test-1", "mem-1");
    reg.recordAccess("test-1", "mem-1");
    const session = reg.get("test-1")!;
    expect(session.accessHistory.get("mem-1")).toBe(2);

    // Prime buffer
    session.buffer!.prime([
      { id: "p1", content: "auth middleware decision context", score: 0.9, source: "vector" as any, metadata: {} },
    ]);
    const hit = session.buffer!.get("auth middleware");
    expect(hit.hitIds.has("p1")).toBe(true);

    // Delete
    expect(reg.delete("test-1")).toBe(true);
    expect(reg.get("test-1")).toBeNull();
  });
});

// ── IMP-16 ─────────────────────────────────────────────────────────────────
describe("IMP-16: prefilterByRawScore cuts before the heavy pipeline", () => {
  const cfg = {
    enabled: true,
    thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
  };

  test("results with raw score below threshold are cut", () => {
    const good = r("good", 0.9, { _rrfRawVectorScore: 0.7 });
    const noise = r("noise", 0.85, { _rrfRawVectorScore: 0.15 });
    const out = prefilterByRawScore([good, noise], "MyService", cfg);
    expect(out.cut).toBe(1);
    expect(out.results.map((r) => r.id)).toEqual(["good"]);
  });

  test("results without raw score pass through pre-filter", () => {
    const good = r("good", 0.9, { _rrfRawVectorScore: 0.7 });
    const noRaw = r("noRaw", 0.05); // no _rrfRawVectorScore
    const out = prefilterByRawScore([good, noRaw], "MyService", cfg);
    expect(out.cut).toBe(0);
    expect(out.results).toHaveLength(2);
  });

  test("disabled config is a no-op", () => {
    const r1 = r("a", 0.9, { _rrfRawVectorScore: 0.01 });
    const out = prefilterByRawScore([r1], "MyService", { ...cfg, enabled: false });
    expect(out.cut).toBe(0);
    expect(out.results).toEqual([r1]);
  });

  test("SynapseManager records pre-gate when cuts occur", () => {
    const mgr = new SynapseManager(makeRuntimeConfig());
    const inputs = [
      r("good", 0.9, { _rrfRawVectorScore: 0.7 }),
      r("noise", 0.85, { _rrfRawVectorScore: 0.15 }),
    ];
    const out = mgr.process(inputs, "MyService", { now: 1_000_000 });
    expect(out.appliedFilters).toContain("pre-gate");
    expect(out.results.map((r) => r.id)).not.toContain("noise");
  });

  test("SynapseManager omits pre-gate when nothing would be cut", () => {
    const mgr = new SynapseManager(makeRuntimeConfig());
    const inputs = [
      r("a", 0.9, { _rrfRawVectorScore: 0.7 }),
      r("b", 0.8, { _rrfRawVectorScore: 0.65 }),
    ];
    const out = mgr.process(inputs, "MyService", { now: 1_000_000 });
    expect(out.appliedFilters).not.toContain("pre-gate");
  });
});

// ── IMP-17 ─────────────────────────────────────────────────────────────────
describe("IMP-17: executePrefetch composes plan → fetch → prime", () => {
  test("disabled-config plan returns enabled:false with skippedReason", async () => {
    const out = await executePrefetch(
      { filePath: "" },
      async () => [],
      () => 0,
      { ...DEFAULT_PREFETCH_CONFIG, enabled: false },
    );
    expect(out.enabled).toBe(false);
    expect(out.skippedReason).toBe("no-topics-or-disabled");
  });

  test("plan with no fetched entries returns no-matches", async () => {
    const out = await executePrefetch(
      { filePath: "src/auth/middleware.ts" },
      async () => [],
      () => 0,
      { ...DEFAULT_PREFETCH_CONFIG, enabled: true },
    );
    expect(out.enabled).toBe(true);
    expect(out.primed).toBe(0);
    expect(out.skippedReason).toBe("no-matches");
  });

  test("happy path primes the buffer with returned entries", async () => {
    const captured: PrefetchEntry[][] = [];
    const out = await executePrefetch(
      { filePath: "src/auth/middleware.ts", symbols: [{ name: "verifyJwt" }] },
      async (plan) => {
        expect(plan.query).toContain("auth");
        expect(plan.query).toContain("middleware");
        return [
          { id: "m1", content: "jwt token verification", score: 0.85 },
          { id: "m2", content: "auth middleware setup", score: 0.8 },
        ];
      },
      (entries) => {
        captured.push(entries);
        return entries.length;
      },
      { ...DEFAULT_PREFETCH_CONFIG, enabled: true },
    );
    expect(out.enabled).toBe(true);
    expect(out.primed).toBe(2);
    expect(captured).toHaveLength(1);
  });

  test("fetch errors are swallowed and surfaced via skippedReason", async () => {
    const out = await executePrefetch(
      { filePath: "src/foo.ts" },
      async () => {
        throw new Error("network down");
      },
      () => 0,
      { ...DEFAULT_PREFETCH_CONFIG, enabled: true },
    );
    expect(out.enabled).toBe(true);
    expect(out.primed).toBe(0);
    expect(out.skippedReason).toContain("network down");
  });

  test("buildPrefetchPlan + executePrefetch are consistent on disabled", async () => {
    const plan = buildPrefetchPlan(
      { filePath: "" },
      { ...DEFAULT_PREFETCH_CONFIG, enabled: false },
    );
    expect(plan.enabled).toBe(false);
    const out = await executePrefetch(
      { filePath: "" },
      async () => [{ id: "x", content: "y" }],
      () => 1,
      { ...DEFAULT_PREFETCH_CONFIG, enabled: false },
    );
    expect(out.primed).toBe(0);
  });
});
