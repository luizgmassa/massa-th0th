/**
 * Round-2 regression tests for the bugs the audit surfaced (IMP-8..IMP-14).
 * Each test pins ONE invariant; if a future change reverts the fix the test
 * names tell you exactly which improvement broke.
 */

import { describe, test, expect } from "bun:test";
import { WorkingMemoryBuffer, DEFAULT_BUFFER_CONFIG } from "../services/synapse/buffer/working-memory-buffer.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import { analyzeSpectrum } from "../services/synapse/metacognition/score-spectrum.js";
import {
  computeStrengthenUpdates,
  DEFAULT_STRENGTHEN_CONFIG,
} from "../services/synapse/plasticity/strengthen.js";
import {
  applyAttentionScore,
  DEFAULT_ATTENTION_CONFIG,
} from "../services/synapse/scoring/attention-score.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

function r(id: string, score: number, content: string = id): SearchResult {
  return { id, content, score, source: SearchSource.VECTOR, metadata: {} };
}

const NOW = 2_000_000_000;

// ── IMP-8 ──────────────────────────────────────────────────────────────────
describe("IMP-8: Buffer baseline score never compounds across cycles", () => {
  test("repeated put-get cycles keep the same effective score", () => {
    const buf = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      matchThreshold: 0.3,
    });
    buf.put([r("a", 0.5)], "auth middleware", NOW);
    // Simulate three subsequent pipeline cycles writing post-pipeline scores
    // (each could be different) — baseline must NOT drift.
    for (let i = 0; i < 3; i++) {
      const hit = buf.get("auth middleware", NOW + i);
      const seenScore = hit.results[0].score;
      buf.put([{ ...r("a", seenScore), content: "auth middleware" }], "auth middleware", NOW + i);
    }
    const finalHit = buf.get("auth middleware", NOW + 100);
    expect(finalHit.results[0].score).toBeCloseTo(0.65, 5); // 0.5 * 1.3 forever
  });

  test("explicit rawScores update the baseline", () => {
    const buf = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      matchThreshold: 0.3,
    });
    buf.put([r("a", 0.5)], "auth middleware", NOW);
    buf.put([r("a", 0.99)], "auth middleware", NOW, new Map([["a", 0.7]]));
    const hit = buf.get("auth middleware", NOW);
    expect(hit.results[0].score).toBeCloseTo(0.91, 5); // 0.7 * 1.3
  });
});

// ── IMP-9 ──────────────────────────────────────────────────────────────────
describe("IMP-9: Primed entries match via content tokens, not unconditionally", () => {
  test("unrelated query does NOT pull primed entries", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.2 });
    buf.prime([r("p1", 0.9, "auth middleware decision rationale")]);
    const hit = buf.get("database migration rollback policy", NOW);
    expect(hit.hitIds.has("p1")).toBe(false);
  });

  test("query overlapping with primed content surfaces it", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.2 });
    buf.prime([r("p1", 0.9, "auth middleware decision rationale")]);
    const hit = buf.get("auth middleware behavior", NOW);
    expect(hit.hitIds.has("p1")).toBe(true);
  });

  test("priming 20 entries does not flood an unrelated query", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.2 });
    const primed: SearchResult[] = [];
    for (let i = 0; i < 20; i++) {
      primed.push(r(`p${i}`, 0.5, `topic ${i} unique vocabulary alpha${i}`));
    }
    buf.prime(primed);
    const hit = buf.get("totally distinct database migration query terms", NOW);
    expect(hit.results.length).toBeLessThan(5); // pre-IMP-9 this would be 20
  });
});

// ── IMP-10 ─────────────────────────────────────────────────────────────────
describe("IMP-10: Session TTL refreshes on get()", () => {
  test("get() extends expiresAt", () => {
    const reg = new SessionRegistry(1000);
    const session = reg.create({ sessionId: "s1", agentId: "claude" }, NOW);
    const initialExpiry = session.expiresAt;
    const refreshed = reg.get("s1", NOW + 500);
    expect(refreshed!.expiresAt).toBeGreaterThan(initialExpiry);
    // The session must still be alive at the new boundary.
    expect(reg.get("s1", NOW + 1200)).not.toBeNull();
  });

  test("get() does not shrink TTL when called before midway", () => {
    const reg = new SessionRegistry(1000);
    reg.create({ sessionId: "s1", agentId: "claude" }, NOW);
    const s = reg.get("s1", NOW); // very early access
    // Refreshed expiry would be NOW + 1000 = same as original, no shrink.
    expect(s!.expiresAt).toBeGreaterThanOrEqual(NOW + 1000);
  });
});

// ── IMP-11 ─────────────────────────────────────────────────────────────────
describe("IMP-11: accessHistory is bounded with LRU eviction", () => {
  test("size stays at limit after exceeding entries", () => {
    const reg = new SessionRegistry();
    reg.create({ sessionId: "s1", agentId: "claude", accessHistoryMaxEntries: 5 });
    for (let i = 0; i < 100; i++) {
      reg.recordAccess("s1", `mem-${i}`);
    }
    const session = reg.get("s1")!;
    expect(session.accessHistory.size).toBe(5);
  });

  test("oldest entries are evicted first", () => {
    const reg = new SessionRegistry();
    reg.create({ sessionId: "s1", agentId: "claude", accessHistoryMaxEntries: 3 });
    reg.recordAccess("s1", "old-1");
    reg.recordAccess("s1", "old-2");
    reg.recordAccess("s1", "old-3");
    reg.recordAccess("s1", "new-1"); // pushes old-1 out
    const session = reg.get("s1")!;
    expect(session.accessHistory.has("old-1")).toBe(false);
    expect(session.accessHistory.has("new-1")).toBe(true);
  });

  test("re-recording a key refreshes its LRU recency", () => {
    const reg = new SessionRegistry();
    reg.create({ sessionId: "s1", agentId: "claude", accessHistoryMaxEntries: 3 });
    reg.recordAccess("s1", "a"); // a inserted
    reg.recordAccess("s1", "b");
    reg.recordAccess("s1", "c");
    reg.recordAccess("s1", "a"); // a moved to most-recent position
    reg.recordAccess("s1", "d"); // b should be evicted (now the oldest)
    const session = reg.get("s1")!;
    expect(session.accessHistory.has("a")).toBe(true);
    expect(session.accessHistory.has("b")).toBe(false);
    expect(session.accessHistory.get("a")).toBe(2);
  });
});

// ── IMP-12 ─────────────────────────────────────────────────────────────────
describe("IMP-12: Spectrum flags are mutually exclusive", () => {
  const cfg = {
    enabled: true,
    lowConfidenceThreshold: 0.15,
    definitiveTopScore: 0.8,
    definitiveGap: 0.2,
  };

  test("a single strong result is definitive, not low-confidence", () => {
    const out = analyzeSpectrum([0.95], 0.3, cfg);
    expect(out.definitiveMatch).toBe(true);
    expect(out.lowConfidence).toBe(false);
    expect(out.noStrongMatch).toBe(false);
  });

  test("definitive top + close second is not definitive", () => {
    const out = analyzeSpectrum([0.95, 0.85, 0.7], 0.3, cfg);
    expect(out.definitiveMatch).toBe(false);
  });

  test("noStrongMatch suppresses lowConfidence", () => {
    const out = analyzeSpectrum([0.1, 0.05, 0.02], 0.3, cfg);
    expect(out.noStrongMatch).toBe(true);
    expect(out.lowConfidence).toBe(false);
  });

  test("at most one flag fires at a time", () => {
    const cases: number[][] = [
      [0.95], // definitive
      [0.95, 0.85, 0.7], // none
      [0.1, 0.05, 0.02], // noStrongMatch
      [0.4, 0.39, 0.38, 0.37], // lowConfidence
      [0.9, 0.3, 0.2], // definitive again (gap=0.6)
    ];
    for (const c of cases) {
      const out = analyzeSpectrum(c, 0.3, cfg);
      const count =
        Number(out.lowConfidence) + Number(out.noStrongMatch) + Number(out.definitiveMatch);
      expect(count).toBeLessThanOrEqual(1);
    }
  });
});

// ── IMP-13 ─────────────────────────────────────────────────────────────────
describe("IMP-13: Strengthen has a continuous ramp, no cliff", () => {
  const baseStats = (recent: number, edges: number = 0) => ({
    id: "a",
    importance: 0.5,
    accessCount: 100,
    recentAccessCount: recent,
    edgeCount: edges,
  });

  test("delta increases smoothly with recentAccessCount", () => {
    const deltas: number[] = [];
    for (let n = 0; n <= 6; n++) {
      const out = computeStrengthenUpdates([baseStats(n)], DEFAULT_STRENGTHEN_CONFIG);
      deltas.push(out[0]?.delta ?? 0);
    }
    // Must be non-decreasing — no cliff drops.
    for (let i = 1; i < deltas.length; i++) {
      expect(deltas[i]).toBeGreaterThanOrEqual(deltas[i - 1]);
    }
    // Below 50% threshold => 0.
    expect(deltas[0]).toBe(0);
    expect(deltas[1]).toBe(0);
    // At/above threshold (3) => positive.
    expect(deltas[3]).toBeGreaterThan(0);
    // Saturation kicks in above 2× threshold.
    expect(deltas[6]).toBeLessThanOrEqual(DEFAULT_STRENGTHEN_CONFIG.frequentAccessBoost * 1.5 + 1e-9);
  });

  test("delta caps at maxDelta", () => {
    const out = computeStrengthenUpdates(
      [{
        id: "a",
        importance: 0.5,
        accessCount: 100,
        recentAccessCount: 50,
        edgeCount: 50,
        referencedByDecision: true,
      }],
      DEFAULT_STRENGTHEN_CONFIG,
    );
    expect(out[0].delta).toBeLessThanOrEqual(DEFAULT_STRENGTHEN_CONFIG.maxDelta + 1e-9);
  });
});

// ── IMP-14 ─────────────────────────────────────────────────────────────────
describe("IMP-14: rerankWindow has a minimum floor", () => {
  test("rerankWindow of 0 is treated as 10 to avoid skipping all results", () => {
    const inputs: SearchResult[] = [];
    for (let i = 0; i < 20; i++) inputs.push(r(`x${i}`, 1 - i * 0.01));
    const out = applyAttentionScore(
      inputs,
      { ...DEFAULT_ATTENTION_CONFIG, enabled: true, rerankWindow: 0 },
      null,
    );
    // First 10 are re-ranked; tail of 10 is appended unchanged.
    expect(out.breakdowns).toHaveLength(10);
    expect(out.results).toHaveLength(20);
  });

  test("rerankWindow far above input length covers everything", () => {
    const inputs: SearchResult[] = [r("a", 0.5), r("b", 0.4)];
    const out = applyAttentionScore(
      inputs,
      { ...DEFAULT_ATTENTION_CONFIG, enabled: true, rerankWindow: 1000 },
      null,
    );
    expect(out.breakdowns).toHaveLength(2);
  });
});
