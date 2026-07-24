/**
 * Regression tests for the IMP-1..IMP-7 improvements that came out of the
 * production benchmark. Each test pins the *fix*: if someone reverts the
 * improvement, the test breaks and tells them exactly which one.
 */

import { describe, test, expect } from "bun:test";
import {
  applyAttentionScore,
  DEFAULT_ATTENTION_CONFIG,
} from "../services/synapse/scoring/attention-score.js";
import {
  applyConfidenceGate,
} from "../services/synapse/inhibition/confidence-gate.js";
import {
  applyChainInhibition,
  DEFAULT_CHAIN_BOOSTS,
} from "../services/synapse/inhibition/chain-inhibition.js";
import { inferTypeFromPath } from "../services/synapse/inhibition/type-inference.js";
import { applyDiversityPenalty } from "../services/synapse/inhibition/diversity-penalty.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

function r(
  id: string,
  score: number,
  meta: Record<string, unknown> = {},
  content: string = id,
): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.VECTOR,
    metadata: meta as any,
  };
}

// ── IMP-1 ───────────────────────────────────────────────────────────────────
describe("IMP-1: Attention score renormalizes weights based on active signals", () => {
  const cfg = { ...DEFAULT_ATTENTION_CONFIG, enabled: true };

  test("with no session and no metadata: final score ≈ semantic (no collapse)", () => {
    const out = applyAttentionScore(
      [r("a", 0.8), r("b", 0.5)],
      cfg,
      null,
    );
    // Before IMP-1, final would have been ~0.40 * semantic = 0.32 and 0.20.
    // After IMP-1, the only active signals are semantic + confidence; their
    // weights renormalize to 1.0 so the score equals the input semantic.
    expect(out.results[0].score).toBeCloseTo(0.8, 5);
    expect(out.results[1].score).toBeCloseTo(0.5, 5);
  });

  test("preserves RRF ranking when all session/metadata signals are zero", () => {
    const out = applyAttentionScore(
      [r("a", 0.9), r("b", 0.7), r("c", 0.5)],
      cfg,
      null,
    );
    expect(out.results.map((x) => x.id)).toEqual(["a", "b", "c"]);
  });

  test("activates recency only when at least one result carries createdAt", () => {
    const now = 2_000_000_000;
    const day = 86_400_000;
    // No createdAt anywhere -> recency excluded from renormalization.
    const out1 = applyAttentionScore([r("a", 0.5)], cfg, null, now);
    expect(out1.results[0].score).toBeCloseTo(0.5, 5);

    // Same result with a fresh createdAt -> recency joins the active set.
    const out2 = applyAttentionScore(
      [r("a", 0.5, { createdAt: now - day })],
      cfg,
      null,
      now,
    );
    // active weights = semantic(0.25) + confidence(0.15) + recency(0.15) = 0.55
    // semantic+conf contribution = 0.40 * 0.5 = 0.20
    // recency contribution ≈ 0.15 * 0.905 (1d half-life of 7d) = 0.136
    // final = (0.20 + 0.136) / 0.55 ≈ 0.610
    expect(out2.results[0].score).toBeGreaterThan(0.55);
    expect(out2.results[0].score).toBeLessThan(0.65);
  });
});

// ── IMP-3 ───────────────────────────────────────────────────────────────────
describe("IMP-3: Chain inhibition infers type from filePath", () => {
  test("inferTypeFromPath classifies paths", () => {
    expect(inferTypeFromPath("src/auth/middleware.ts")).toBe("code");
    expect(inferTypeFromPath("src/auth/auth.test.ts")).toBe("code-test");
    expect(inferTypeFromPath("packages/core/__tests__/foo.ts")).toBe("code-test");
    expect(inferTypeFromPath("docs/architecture.md")).toBe("documentation");
    expect(inferTypeFromPath("README.md")).toBe("documentation");
    expect(inferTypeFromPath("README")).toBe("documentation");
    expect(inferTypeFromPath("CHANGELOG.md")).toBe("documentation");
    expect(inferTypeFromPath("prisma/migrations/001/up.sql")).toBe("code");
    expect(inferTypeFromPath("unknown.xyz")).toBeNull();
    expect(inferTypeFromPath("")).toBeNull();
    expect(inferTypeFromPath(undefined)).toBeNull();
  });

  test("chain inhibition boosts code-search results without explicit type", () => {
    const decision = r("d", 0.6, { filePath: "docs/decisions/001.md" });
    const code = r("c", 0.6, { filePath: "src/auth/middleware.ts" });
    const test = r("t", 0.6, { filePath: "src/auth/middleware.test.ts" });
    const out = applyChainInhibition(
      [decision, code, test],
      "why did we choose this approach",
      { enabled: true, boosts: DEFAULT_CHAIN_BOOSTS },
    );
    expect(out.intent).toBe("decision");
    const byId = Object.fromEntries(out.results.map((x) => [x.id, x.score]));
    expect(byId.d).toBeCloseTo(0.72, 5); // 0.6 * 1.2 (documentation boost for decision intent)
    expect(byId.c).toBe(0.6); // code not in decision boost map
    expect(byId.t).toBe(0.6); // code-test not in decision boost map
  });

  test("symbol intent boosts code and demotes code-test", () => {
    const code = r("c", 0.6, { filePath: "src/auth/middleware.ts" });
    const test = r("t", 0.6, { filePath: "src/auth/middleware.test.ts" });
    const out = applyChainInhibition(
      [code, test],
      "definition of authenticateRequest",
      { enabled: true, boosts: DEFAULT_CHAIN_BOOSTS },
    );
    expect(out.intent).toBe("symbol");
    const byId = Object.fromEntries(out.results.map((x) => [x.id, x.score]));
    expect(byId.c).toBeCloseTo(1.2, 5); // 0.6 * 2.0
    expect(byId.t).toBeCloseTo(0.48, 5); // 0.6 * 0.8
  });
});

// ── IMP-4 ───────────────────────────────────────────────────────────────────
describe("IMP-4: Diversity penalty applies samePathPenalty", () => {
  const cfg = {
    enabled: true,
    threshold: 0.85,
    lambda: 0.4,
    samePathPenalty: 0.15,
  };

  test("two chunks from same file get the samePathPenalty", () => {
    const a = r("a", 0.9, { filePath: "src/foo.ts" }, "alpha words here");
    const b = r("b", 0.8, { filePath: "src/foo.ts" }, "beta different words");
    const out = applyDiversityPenalty([a, b], cfg);
    const byId = Object.fromEntries(out.map((x) => [x.id, x.score]));
    expect(byId.a).toBeCloseTo(0.9, 5);
    expect(byId.b).toBeCloseTo(0.68, 5); // 0.8 * 0.85
  });

  test("two chunks from different files are not penalized", () => {
    const a = r("a", 0.9, { filePath: "src/foo.ts" }, "alpha");
    const b = r("b", 0.8, { filePath: "src/bar.ts" }, "beta");
    const out = applyDiversityPenalty([a, b], cfg);
    const byId = Object.fromEntries(out.map((x) => [x.id, x.score]));
    expect(byId.a).toBeCloseTo(0.9, 5);
    expect(byId.b).toBeCloseTo(0.8, 5);
  });

  test("samePathPenalty=0 disables the file-level penalty", () => {
    const a = r("a", 0.9, { filePath: "src/foo.ts" }, "alpha");
    const b = r("b", 0.8, { filePath: "src/foo.ts" }, "beta");
    const out = applyDiversityPenalty([a, b], { ...cfg, samePathPenalty: 0 });
    expect(out.find((x) => x.id === "b")!.score).toBeCloseTo(0.8, 5);
  });

  test("results without filePath are unaffected", () => {
    const a = r("a", 0.9, {}, "alpha");
    const b = r("b", 0.8, {}, "beta");
    const out = applyDiversityPenalty([a, b], cfg);
    expect(out.find((x) => x.id === "b")!.score).toBeCloseTo(0.8, 5);
  });
});

// ── IMP-5 ───────────────────────────────────────────────────────────────────
describe("IMP-5: Confidence gate prefers _rrfRawVectorScore over result.score", () => {
  const cfg = {
    enabled: true,
    thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
  };

  test("uses raw vector score when present (cuts where RRF inflated)", () => {
    // RRF lifted the top result to 0.95, but the raw cosine was 0.2 — noise.
    // Before IMP-5, the gate let it through; after IMP-5, it gets cut.
    const inflated = r("a", 0.95, { _rrfRawVectorScore: 0.2 });
    const real = r("b", 0.8, { _rrfRawVectorScore: 0.7 });
    const out = applyConfidenceGate([inflated, real], "MyService", cfg);
    expect(out.queryClass).toBe("specific");
    expect(out.results.map((x) => x.id)).toEqual(["b"]);
  });

  test("falls back to result.score when raw is absent", () => {
    const a = r("a", 0.3);
    const b = r("b", 0.8);
    const out = applyConfidenceGate([a, b], "MyService", cfg);
    expect(out.results.map((x) => x.id)).toEqual(["b"]);
  });

  test("disabled gate ignores both signals", () => {
    const a = r("a", 0.95, { _rrfRawVectorScore: 0.1 });
    const out = applyConfidenceGate([a], "MyService", { ...cfg, enabled: false });
    expect(out.results).toHaveLength(1);
  });
});

// ── IMP-2 ───────────────────────────────────────────────────────────────────
// Spectrum-threshold change is verified indirectly: see synapse-score-spectrum.test.ts
// (existing) and the default config in shared/config/index.ts. No additional
// runtime path to pin here beyond the default values themselves.
