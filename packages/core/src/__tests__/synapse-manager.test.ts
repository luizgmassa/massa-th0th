import { describe, test, expect } from "bun:test";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import type { SynapseRuntimeConfig, SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, content: string, score: number, createdAt?: number): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.VECTOR,
    metadata: createdAt == null ? {} : { createdAt },
  };
}

function makeConfig(overrides: Partial<SynapseRuntimeConfig> = {}): SynapseRuntimeConfig {
  return {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4 },
      temporalInhibition: { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: {
        enabled: true,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: false,
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: {
          semantic: 0.25,
          recency: 0.15,
          accessHeat: 0.15,
          taskAlign: 0.2,
          agentAffinity: 0.1,
          confidence: 0.15,
        },
      },
    },
    metacognition: {
      enabled: true,
      lowConfidenceThreshold: 0.1,
      definitiveTopScore: 0.8,
      definitiveGap: 0.4,
    },
    buffer: {
      enabled: true,
      maxSize: 20,
      ttlMs: 900_000,
      hitBoost: 1.3,
      matchThreshold: 0.4,
    },
    ...overrides,
  };
}

describe("SynapseManager", () => {
  test("disabled manager is a no-op", () => {
    const mgr = new SynapseManager(makeConfig({ enabled: false }));
    expect(mgr.isEnabled()).toBe(false);
    const results = [r("a", "anything", 0.9)];
    const out = mgr.process(results, "any query");
    expect(out.results).toBe(results);
    expect(out.appliedFilters).toEqual([]);
  });

  test("enabled manager runs all filters and surfaces flags", () => {
    const mgr = new SynapseManager(makeConfig());
    const results = [
      r("a", "alpha beta gamma delta epsilon zeta", 0.95),
      r("b", "alpha beta gamma delta epsilon zeta", 0.92), // near-clone of a
      r("c", "unique topic xi omicron pi rho", 0.5),
    ];
    const out = mgr.process(results, "alpha beta gamma");
    expect(out.appliedFilters).toContain("diversity");
    expect(out.appliedFilters).toContain("temporal");
    expect(out.appliedFilters).toContain("confidence-gate");
    expect(out.appliedFilters).toContain("spectrum");
    expect(out.queryClass).toBe("broad");
    expect(out.results.length).toBeGreaterThan(0);
    expect(out.results[0].id).toBe("a");
  });

  test("individual submodule disabled is respected", () => {
    const cfg = makeConfig();
    cfg.inhibition.diversityPenalty.enabled = false;
    const mgr = new SynapseManager(cfg);
    const out = mgr.process([r("a", "x", 0.9), r("b", "x", 0.8)], "anything broad query");
    expect(out.appliedFilters).not.toContain("diversity");
    expect(out.appliedFilters).toContain("temporal");
  });

  test("confidence gate drops low-score results for specific queries", () => {
    const mgr = new SynapseManager(makeConfig());
    const results = [
      r("a", "first content", 0.3),
      r("b", "second content", 0.4),
      r("c", "third content", 0.6),
      r("d", "fourth content", 0.9),
    ];
    const out = mgr.process(results, "getUserId function");
    expect(out.queryClass).toBe("specific");
    expect(out.results.map((r) => r.id)).toEqual(["d", "c"]);
  });

  test("low-confidence flag fires on weak clustered results", () => {
    const mgr = new SynapseManager(makeConfig());
    const results = [
      r("a", "first content variation", 0.42),
      r("b", "second content distinct", 0.41),
      r("c", "third content distinct", 0.41),
    ];
    const out = mgr.process(results, "broad style query");
    expect(out.flags.lowConfidence).toBe(true);
  });

  test("chain inhibition fires when intent is detected", () => {
    const mgr = new SynapseManager(makeConfig());
    const decision: SearchResult = {
      id: "d",
      content: "we chose RRF because of stability",
      score: 0.6,
      source: SearchSource.VECTOR,
      metadata: { type: "decision" } as any,
    };
    const conversation: SearchResult = {
      id: "c",
      content: "stack trace logs blah",
      score: 0.6,
      source: SearchSource.VECTOR,
      metadata: { type: "conversation" } as any,
    };
    const out = mgr.process([decision, conversation], "why did we decide to use RRF");
    expect(out.intent).toBe("decision");
    expect(out.results[0].id).toBe("d");
  });

  test("attention score, when enabled, re-ranks before chain inhibition", () => {
    const cfg = makeConfig();
    cfg.scoring.attention.enabled = true;
    // Drop the gate so we can observe attention-only re-ordering.
    cfg.inhibition.confidenceGate.enabled = false;
    cfg.inhibition.diversityPenalty.enabled = false;
    cfg.inhibition.temporalInhibition.enabled = false;
    const mgr = new SynapseManager(cfg);
    const now = 2_000_000_000;
    const fresh: SearchResult = {
      id: "fresh",
      content: "auth middleware fresh",
      score: 0.5,
      source: SearchSource.VECTOR,
      metadata: { createdAt: now - 86_400_000 } as any,
    };
    const old: SearchResult = {
      id: "old",
      content: "auth middleware historic",
      score: 0.5,
      source: SearchSource.VECTOR,
      metadata: { createdAt: now - 60 * 86_400_000 } as any,
    };
    const out = mgr.process([fresh, old], "anything broad", { now });
    expect(out.appliedFilters).toContain("attention");
    expect(out.results[0].id).toBe("fresh");
  });
});
