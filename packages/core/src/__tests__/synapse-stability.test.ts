/**
 * Stability suite — what the benchmark v2 measures as "within-batch
 * stability_j@5". For the *pure* parts of Synapse (everything except the
 * working-memory buffer, which intentionally has session state), identical
 * input must produce byte-for-byte identical output across repeated calls.
 *
 * If a non-determinism creeps in (Date.now in scoring, Math.random tie-break,
 * accidental Map iteration order assumption), one of these tests breaks.
 */

import { describe, test, expect } from "bun:test";
import {
  applyAttentionScore,
  DEFAULT_ATTENTION_CONFIG,
} from "../services/synapse/scoring/attention-score.js";
import {
  applyDiversityPenalty,
  applyConfidenceGate,
  applyTemporalInhibition,
  applyChainInhibition,
  DEFAULT_CHAIN_BOOSTS,
} from "../services/synapse/inhibition/index.js";
import { analyzeSpectrum } from "../services/synapse/metacognition/score-spectrum.js";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import {
  computeStrengthenUpdates,
  DEFAULT_STRENGTHEN_CONFIG,
} from "../services/synapse/plasticity/strengthen.js";
import {
  evolveEmbeddings,
  DEFAULT_EMBEDDING_EVOLUTION_CONFIG,
} from "../services/synapse/plasticity/embedding-evolution.js";
import { CORPUS, toResult } from "./fixtures/synapse-test-corpus.js";
import type { SynapseRuntimeConfig } from "@massa-th0th/shared";

const RUNS = 10;
const FIXED_NOW = 2_000_000_000;

function snapshot(results: { id: string; score: number }[]): string {
  return results.map((r) => `${r.id}:${r.score.toFixed(8)}`).join("|");
}

function runConfig(): SynapseRuntimeConfig {
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
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      definitiveGap: 0.2,
    },
    buffer: { enabled: false, maxSize: 20, ttlMs: 900_000, hitBoost: 1.3, matchThreshold: 0.4 },
  };
}

describe("Synapse pipeline stability — same input, N repeats, identical output", () => {
  test("applyDiversityPenalty is deterministic", () => {
    const inputs = CORPUS.map(toResult);
    const cfg = { enabled: true, threshold: 0.85, lambda: 0.4, samePathPenalty: 0.15 };
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) snaps.add(snapshot(applyDiversityPenalty(inputs, cfg)));
    expect(snaps.size).toBe(1);
  });

  test("applyConfidenceGate is deterministic", () => {
    const inputs = CORPUS.map(toResult);
    const cfg = { enabled: true, thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 } };
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = applyConfidenceGate(inputs, "ContextualSearchRLM hybrid search", cfg);
      snaps.add(snapshot(out.results) + "|" + out.queryClass + "|" + out.threshold);
    }
    expect(snaps.size).toBe(1);
  });

  test("applyTemporalInhibition is deterministic with fixed `now`", () => {
    const inputs = CORPUS.map(toResult);
    const cfg = { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 };
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      snaps.add(snapshot(applyTemporalInhibition(inputs, "best practice X", cfg, FIXED_NOW)));
    }
    expect(snaps.size).toBe(1);
  });

  test("applyChainInhibition is deterministic", () => {
    const inputs = CORPUS.map(toResult);
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = applyChainInhibition(inputs, "why did we choose this design", {
        enabled: true,
        boosts: DEFAULT_CHAIN_BOOSTS,
      });
      snaps.add(snapshot(out.results) + "|" + out.intent);
    }
    expect(snaps.size).toBe(1);
  });

  test("applyAttentionScore is deterministic with fixed `now` and null session", () => {
    const inputs = CORPUS.map(toResult);
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = applyAttentionScore(
        inputs,
        { ...DEFAULT_ATTENTION_CONFIG, enabled: true },
        null,
        FIXED_NOW,
      );
      snaps.add(snapshot(out.results));
    }
    expect(snaps.size).toBe(1);
  });

  test("analyzeSpectrum is deterministic", () => {
    const scores = [0.9, 0.7, 0.5, 0.3, 0.1];
    const cfg = {
      enabled: true,
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      definitiveGap: 0.2,
    };
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = analyzeSpectrum(scores, 0.25, cfg);
      snaps.add(JSON.stringify(out));
    }
    expect(snaps.size).toBe(1);
  });

  test("SynapseManager.process is deterministic with fixed `now`", () => {
    const inputs = CORPUS.map(toResult);
    const mgr = new SynapseManager(runConfig());
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = mgr.process(inputs, "ContextualSearchRLM hybrid search", { now: FIXED_NOW });
      snaps.add(snapshot(out.results) + "|" + out.intent + "|" + out.queryClass);
    }
    expect(snaps.size).toBe(1);
  });

  test("computeStrengthenUpdates is deterministic", () => {
    const stats = [
      { id: "a", importance: 0.5, accessCount: 10, recentAccessCount: 5, edgeCount: 4, referencedByDecision: true },
      { id: "b", importance: 0.7, accessCount: 3, recentAccessCount: 1, edgeCount: 0 },
    ];
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = computeStrengthenUpdates(stats, DEFAULT_STRENGTHEN_CONFIG);
      snaps.add(JSON.stringify(out));
    }
    expect(snaps.size).toBe(1);
  });

  test("evolveEmbeddings is deterministic", () => {
    const inputs = [{
      id: "a",
      original: [0.5, 0.5, 0, 0],
      queryEmbeddings: [
        [0.6, 0.4, 0, 0],
        [0.55, 0.45, 0, 0],
        [0.5, 0.5, 0.1, 0],
        [0.45, 0.55, 0, 0],
        [0.5, 0.5, 0, 0.1],
      ],
    }];
    const snaps = new Set<string>();
    for (let i = 0; i < RUNS; i++) {
      const out = evolveEmbeddings(
        inputs,
        { ...DEFAULT_EMBEDDING_EVOLUTION_CONFIG, enabled: true, driftThreshold: -1 },
      );
      snaps.add(JSON.stringify(out));
    }
    expect(snaps.size).toBe(1);
  });
});
