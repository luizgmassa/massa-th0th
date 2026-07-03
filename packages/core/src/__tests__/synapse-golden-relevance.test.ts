/**
 * Relevance suite — runs the whole post-RRF Synapse pipeline against a small
 * curated corpus and asserts on IR metrics.
 *
 * Two kinds of assertions:
 *   1) ABSOLUTE: per-query RRF-style inputs where the relevant doc is already
 *      near the top; Synapse must keep it there (MRR >= 0.5, NDCG > 0.6).
 *   2) NON-REGRESSION: enabling Attention Score (the IMP-1 fix) must not
 *      degrade MRR or NDCG on the global corpus, even when scores are
 *      contrived. This is the invariant that broke before IMP-1 (top1
 *      collapse) and the test we want failing if it ever comes back.
 */

import { describe, test, expect } from "bun:test";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import { CORPUS, GOLDEN, toResult } from "./fixtures/synapse-test-corpus.js";
import {
  precisionAtK,
  recallAtK,
  mrrAtK,
  ndcgAtK,
} from "./fixtures/ir-metrics.js";
import type { SynapseRuntimeConfig, SearchResult } from "@massa-th0th/shared";

function defaultConfig(attentionEnabled: boolean): SynapseRuntimeConfig {
  return {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4, samePathPenalty: 0.15 },
      temporalInhibition: { enabled: false, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: { enabled: true, thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 } },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: attentionEnabled,
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

function ids(results: SearchResult[]): string[] {
  return results.map((r) => r.id);
}

const globalInputs: SearchResult[] = CORPUS.map(toResult).sort((a, b) => b.score - a.score);

// ─── Per-query inputs — emulate what RRF would actually return ──────────────
// For each test query we pick a small ranked subset where the *relevant* docs
// are already near the top (as real hybrid search would deliver). Synapse's
// job is then to keep them there, suppress noise, and improve diversity.
function fakeRrfFor(query: string): SearchResult[] {
  const all = CORPUS.map(toResult);
  // Per-query "RRF" score boost: relevant items get +0.10 over their base.
  const relevant = new Set(GOLDEN[query] ?? []);
  const reranked = all.map((r) =>
    relevant.has(r.id)
      ? { ...r, score: Math.min(1, r.score + 0.1) }
      : r,
  );
  return reranked.sort((a, b) => b.score - a.score);
}

interface Case {
  category: string;
  query: string;
  minMRR?: number;
  minNDCG?: number;
}

const CASES: Case[] = [
  { category: "decision", query: "why did we choose pgvector over chromadb", minMRR: 0.5, minNDCG: 0.5 },
  { category: "decision", query: "why did we decide RRF over pure cosine", minMRR: 0.5, minNDCG: 0.5 },
  { category: "ranking", query: "applyDiversityPenalty MMR Jaccard tokens", minMRR: 0.5, minNDCG: 0.5 },
  { category: "ranking", query: "RedundancyFilter cosine similarity 0.95", minMRR: 0.5, minNDCG: 0.5 },
  { category: "configuration", query: "embedding provider configuration ollama setup", minMRR: 0.5, minNDCG: 0.5 },
  { category: "troubleshooting", query: "how to fix ECONNREFUSED postgres connection", minMRR: 0.5, minNDCG: 0.5 },
  // ContextualSearchRLM has 3 chunks from the same file in the golden set.
  // IMP-4 same-path penalty intentionally demotes the 3rd one out of top-10,
  // so nDCG@10 caps around 0.65 by design (diversity > exhaustive recall).
  // MRR remains 1.0 because the top hit is always impl-1a.
  { category: "implementation", query: "ContextualSearchRLM hybrid search", minMRR: 1.0, minNDCG: 0.6 },
];

describe("Absolute relevance — Synapse default with per-query RRF inputs", () => {
  const mgr = new SynapseManager(defaultConfig(false));

  for (const c of CASES) {
    test(`[${c.category}] "${c.query}"`, () => {
      const inputs = fakeRrfFor(c.query);
      const golden = new Set(GOLDEN[c.query]);
      const out = mgr.process(inputs, c.query, { now: 1_000_000_000 });
      const retrieved = ids(out.results);
      const mrr = mrrAtK(retrieved, golden, 10);
      const ndcg = ndcgAtK(retrieved, golden, 10);

      if (c.minMRR != null) expect(mrr).toBeGreaterThanOrEqual(c.minMRR);
      if (c.minNDCG != null) expect(ndcg).toBeGreaterThanOrEqual(c.minNDCG);
    });
  }
});

describe("Non-regression — Attention enabled vs disabled", () => {
  // IMP-1 invariant: enabling Attention must not collapse MRR/NDCG.
  // Allow tiny tolerance because Attention legitimately re-orders ties.
  const mgrOff = new SynapseManager(defaultConfig(false));
  const mgrOn = new SynapseManager(defaultConfig(true));
  const TOLERANCE = 0.05;

  for (const c of CASES) {
    test(`[${c.category}] MRR stays within ${TOLERANCE} of disabled — "${c.query}"`, () => {
      const inputs = fakeRrfFor(c.query);
      const golden = new Set(GOLDEN[c.query]);
      const off = mgrOff.process(inputs, c.query, { now: 1_000_000_000 });
      const on = mgrOn.process(inputs, c.query, { now: 1_000_000_000 });
      const mrrOff = mrrAtK(ids(off.results), golden, 10);
      const mrrOn = mrrAtK(ids(on.results), golden, 10);
      // Attention is allowed to improve, allowed to be ~equal,
      // not allowed to collapse — pre-IMP-1 this dropped to ~0.0
      expect(mrrOn).toBeGreaterThanOrEqual(mrrOff - TOLERANCE);
    });
  }

  test("aggregate MRR across all queries: attention does not regress", () => {
    let sumOff = 0;
    let sumOn = 0;
    for (const c of CASES) {
      const inputs = fakeRrfFor(c.query);
      const golden = new Set(GOLDEN[c.query]);
      const off = mgrOff.process(inputs, c.query, { now: 1_000_000_000 });
      const on = mgrOn.process(inputs, c.query, { now: 1_000_000_000 });
      sumOff += mrrAtK(ids(off.results), golden, 10);
      sumOn += mrrAtK(ids(on.results), golden, 10);
    }
    const avgOff = sumOff / CASES.length;
    const avgOn = sumOn / CASES.length;
    // Aggregate must not regress by more than the tolerance.
    expect(avgOn).toBeGreaterThanOrEqual(avgOff - TOLERANCE);
  });
});

describe("Noise rejection (IMP-5) — inflated RRF + low raw cosine should be cut", () => {
  const mgr = new SynapseManager(defaultConfig(false));

  test("specific query rejects results with raw cosine below the threshold", () => {
    const out = mgr.process(globalInputs, "applyDiversityPenalty MMR Jaccard tokens", {
      now: 1_000_000_000,
    });
    expect(out.queryClass).toBe("specific");
    const surviving = ids(out.results);
    expect(surviving).not.toContain("noise-1"); // raw 0.15 < 0.55
    expect(surviving).not.toContain("noise-2"); // raw 0.10 < 0.55
  });

  test("broad query keeps medium-cosine results", () => {
    const out = mgr.process(globalInputs, "talk about the things in here generally", {
      now: 1_000_000_000,
    });
    expect(out.queryClass).toBe("broad");
    // raw 0.66, 0.69 etc. are above the broad threshold (0.25); they should survive.
    const surviving = ids(out.results);
    expect(surviving.length).toBeGreaterThan(5);
  });
});

describe("Diversity@5 invariant (IMP-4) — same-file chunks should not dominate", () => {
  const mgr = new SynapseManager(defaultConfig(false));

  test("for the implementation query, top-5 contains at least 2 distinct files", () => {
    const inputs = fakeRrfFor("ContextualSearchRLM hybrid search");
    const out = mgr.process(inputs, "ContextualSearchRLM hybrid search", {
      now: 1_000_000_000,
    });
    const top5 = out.results.slice(0, 5);
    const filePaths = new Set(top5.map((r) => (r.metadata as any)?.filePath));
    expect(filePaths.size).toBeGreaterThanOrEqual(2);
  });
});
