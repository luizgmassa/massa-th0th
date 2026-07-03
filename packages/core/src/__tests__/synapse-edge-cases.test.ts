/**
 * Edge-case suite — covers the failure shapes the v2 benchmark emits when
 * the API returns garbage: empty results, missing metadata, weird types,
 * extreme values. Every pipeline function must degrade gracefully — no
 * thrown exceptions, no NaN/Infinity leaks.
 */

import { describe, test, expect } from "bun:test";
import {
  applyDiversityPenalty,
} from "../services/synapse/inhibition/diversity-penalty.js";
import {
  applyConfidenceGate,
  classifyQuery,
} from "../services/synapse/inhibition/confidence-gate.js";
import {
  applyTemporalInhibition,
} from "../services/synapse/inhibition/temporal-inhibition.js";
import {
  applyChainInhibition,
  DEFAULT_CHAIN_BOOSTS,
  detectIntent,
} from "../services/synapse/inhibition/chain-inhibition.js";
import {
  applyAttentionScore,
  DEFAULT_ATTENTION_CONFIG,
} from "../services/synapse/scoring/attention-score.js";
import { analyzeSpectrum } from "../services/synapse/metacognition/score-spectrum.js";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import { inferTypeFromPath } from "../services/synapse/inhibition/type-inference.js";
import type { SearchResult, SynapseRuntimeConfig } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, score: number, meta: Record<string, unknown> = {}): SearchResult {
  return { id, content: id, score, source: SearchSource.VECTOR, metadata: meta as any };
}

function isFiniteScore(x: SearchResult): boolean {
  return Number.isFinite(x.score) && x.score >= 0 && x.score <= 2;
}

function defaultConfig(): SynapseRuntimeConfig {
  return {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4, samePathPenalty: 0.15 },
      temporalInhibition: { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: { enabled: true, thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 } },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: true,
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: { semantic: 0.25, recency: 0.15, accessHeat: 0.15, taskAlign: 0.2, agentAffinity: 0.1, confidence: 0.15 },
      },
    },
    metacognition: { enabled: true, lowConfidenceThreshold: 0.15, definitiveTopScore: 0.8, definitiveGap: 0.2 },
    buffer: { enabled: false, maxSize: 20, ttlMs: 900_000, hitBoost: 1.3, matchThreshold: 0.4 },
  };
}

describe("Edge cases — empty input never throws", () => {
  test("every filter accepts an empty list", () => {
    const cfg = defaultConfig();
    expect(applyDiversityPenalty([], cfg.inhibition.diversityPenalty)).toEqual([]);
    expect(applyConfidenceGate([], "anything", cfg.inhibition.confidenceGate).results).toEqual([]);
    expect(applyTemporalInhibition([], "anything", cfg.inhibition.temporalInhibition)).toEqual([]);
    expect(applyChainInhibition([], "anything", { enabled: true, boosts: DEFAULT_CHAIN_BOOSTS }).results).toEqual([]);
    const att = applyAttentionScore([], DEFAULT_ATTENTION_CONFIG, null);
    expect(att.results).toEqual([]);
    expect(att.breakdowns).toEqual([]);
  });

  test("SynapseManager.process accepts an empty list", () => {
    const mgr = new SynapseManager(defaultConfig());
    const out = mgr.process([], "anything", { now: 1_000_000 });
    expect(out.results).toEqual([]);
    expect(out.flags.lowConfidence).toBe(false);
    expect(out.flags.confidence).toBe(0);
  });
});

describe("Edge cases — missing/malformed metadata is tolerated", () => {
  test("results with no metadata pass through scoring", () => {
    const r1: SearchResult = { id: "a", content: "x", score: 0.7, source: SearchSource.VECTOR, metadata: undefined as any };
    const r2: SearchResult = { id: "b", content: "y", score: 0.6, source: SearchSource.VECTOR, metadata: null as any };
    const out = applyAttentionScore([r1, r2], { ...DEFAULT_ATTENTION_CONFIG, enabled: true }, null);
    expect(out.results.every(isFiniteScore)).toBe(true);
    expect(out.results.map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  test("temporal inhibition handles non-numeric createdAt gracefully", () => {
    const r1 = r("a", 0.8, { createdAt: "not-a-date" });
    const r2 = r("b", 0.5, { createdAt: null });
    const r3 = r("c", 0.4, { createdAt: { weird: "object" } });
    const out = applyTemporalInhibition(
      [r1, r2, r3],
      "anything broad",
      { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      Date.now(),
    );
    expect(out.every(isFiniteScore)).toBe(true);
  });

  test("classifyQuery and detectIntent accept empty / whitespace", () => {
    expect(classifyQuery("")).toBe("broad");
    expect(classifyQuery("    ")).toBe("broad");
    expect(detectIntent("")).toBe("general");
    expect(detectIntent("    ")).toBe("general");
  });

  test("inferTypeFromPath handles malformed paths without throwing", () => {
    expect(inferTypeFromPath("")).toBeNull();
    expect(inferTypeFromPath(null)).toBeNull();
    expect(inferTypeFromPath(undefined)).toBeNull();
    expect(inferTypeFromPath("//////")).toBeNull();
    expect(inferTypeFromPath("noextension")).toBeNull();
  });
});

describe("Edge cases — extreme values do not produce NaN/Infinity", () => {
  test("zero scores are accepted", () => {
    const inputs = [r("a", 0), r("b", 0)];
    const out = applyAttentionScore(inputs, { ...DEFAULT_ATTENTION_CONFIG, enabled: true }, null);
    expect(out.results.every(isFiniteScore)).toBe(true);
  });

  test("scores above 1 stay finite through the pipeline", () => {
    const inputs = [r("a", 1.5), r("b", 1.2)];
    const out = applyAttentionScore(inputs, { ...DEFAULT_ATTENTION_CONFIG, enabled: true }, null);
    expect(out.results.every(isFiniteScore)).toBe(true);
  });

  test("analyzeSpectrum handles a single-element list", () => {
    const out = analyzeSpectrum([0.7], 0.3, {
      enabled: true,
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      definitiveGap: 0.2,
    });
    expect(Number.isFinite(out.spread)).toBe(true);
    expect(Number.isFinite(out.mean)).toBe(true);
    expect(Number.isFinite(out.confidence)).toBe(true);
  });

  test("analyzeSpectrum handles identical scores (spread = 0)", () => {
    const out = analyzeSpectrum([0.5, 0.5, 0.5, 0.5], 0.3, {
      enabled: true,
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      definitiveGap: 0.2,
    });
    expect(out.spread).toBe(0);
    expect(out.confidence).toBe(0);
    expect(out.lowConfidence).toBe(true);
  });
});

describe("Edge cases — disabled pipeline is identity", () => {
  test("disabled Synapse returns inputs unchanged", () => {
    const cfg = defaultConfig();
    cfg.enabled = false;
    const inputs = [r("a", 0.9, { filePath: "src/foo.ts" }), r("b", 0.5, { filePath: "src/bar.ts" })];
    const mgr = new SynapseManager(cfg);
    const out = mgr.process(inputs, "any query");
    expect(out.results).toBe(inputs);
    expect(out.appliedFilters).toEqual([]);
  });

  test("each submodule honors its own enabled=false flag", () => {
    const inputs = [r("a", 0.9, { filePath: "src/foo.ts" }), r("b", 0.5, { filePath: "src/foo.ts" })];
    const out1 = applyDiversityPenalty(inputs, { enabled: false, threshold: 0.85, lambda: 0.4 });
    expect(out1).toBe(inputs);

    const out2 = applyConfidenceGate(inputs, "MyService", {
      enabled: false,
      thresholds: { specific: 0.99, focused: 0.99, broad: 0.99 },
    });
    expect(out2.results).toHaveLength(2);

    const out3 = applyTemporalInhibition(
      inputs,
      "anything",
      { enabled: false, penaltyAgeMs: 10, penalty: 10 },
    );
    expect(out3).toBe(inputs);

    const out4 = applyChainInhibition(inputs, "why did we decide", {
      enabled: false,
      boosts: DEFAULT_CHAIN_BOOSTS,
    });
    expect(out4.results).toBe(inputs);
  });
});

describe("Edge cases — very long input lists do not degrade catastrophically", () => {
  // The benchmark sometimes feeds 50+ candidates; assert linear behaviour.
  test("attention score handles 100 candidates", () => {
    const inputs: SearchResult[] = [];
    for (let i = 0; i < 100; i++) {
      inputs.push(r(`x${i}`, 1 - i * 0.005, { filePath: `src/file-${i % 10}.ts` }));
    }
    const start = performance.now();
    const out = applyAttentionScore(inputs, { ...DEFAULT_ATTENTION_CONFIG, enabled: true, rerankWindow: 50 }, null);
    const elapsed = performance.now() - start;
    expect(out.results).toHaveLength(100);
    const maxMs = Number(process.env.SYNAPSE_ATTENTION_MAX_MS ?? "250");
    expect(elapsed).toBeLessThan(maxMs);
  });

  test("diversity penalty handles 50 same-file chunks", () => {
    const inputs: SearchResult[] = [];
    for (let i = 0; i < 50; i++) {
      inputs.push(r(`x${i}`, 0.9 - i * 0.01, { filePath: "src/big.ts" }));
    }
    const out = applyDiversityPenalty(inputs, {
      enabled: true,
      threshold: 0.85,
      lambda: 0.4,
      samePathPenalty: 0.15,
    });
    expect(out).toHaveLength(50);
    // Strong same-path compounding: tail scores should be heavily decayed.
    expect(out[out.length - 1].score).toBeLessThan(out[0].score * 0.5);
  });
});
