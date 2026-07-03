import { describe, test, expect } from "bun:test";
import {
  applyAttentionScore,
  DEFAULT_ATTENTION_CONFIG,
  DEFAULT_ATTENTION_WEIGHTS,
} from "../services/synapse/scoring/attention-score.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

const NOW = 2_000_000_000;
const DAY = 86_400_000;

function r(
  id: string,
  content: string,
  score: number,
  meta: Record<string, unknown> = {},
): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.VECTOR,
    metadata: meta as any,
  };
}

const cfg = {
  ...DEFAULT_ATTENTION_CONFIG,
  enabled: true,
};

describe("applyAttentionScore", () => {
  test("disabled returns input unchanged", () => {
    const input = [r("a", "x", 0.9), r("b", "y", 0.5)];
    const out = applyAttentionScore(input, { ...cfg, enabled: false }, null, NOW);
    expect(out.results).toEqual(input);
    expect(out.breakdowns).toEqual([]);
  });

  test("empty input returns empty output", () => {
    const out = applyAttentionScore([], cfg, null, NOW);
    expect(out.results).toEqual([]);
  });

  test("preserves a ranking when only semantic signal differs", () => {
    const input = [r("a", "x", 0.9), r("b", "y", 0.5)];
    const out = applyAttentionScore(input, cfg, null, NOW);
    expect(out.results[0].id).toBe("a");
    expect(out.results[1].id).toBe("b");
  });

  test("recency boosts a fresher candidate over an older one with similar semantic score", () => {
    const fresh = r("fresh", "x", 0.5, { createdAt: NOW - DAY });
    const old = r("old", "y", 0.5, { createdAt: NOW - 60 * DAY });
    const out = applyAttentionScore([fresh, old], cfg, null, NOW);
    expect(out.results[0].id).toBe("fresh");
  });

  test("access heat lifts a frequently accessed result", () => {
    const hot = r("hot", "x", 0.5, { accessCount: 50 });
    const cold = r("cold", "y", 0.5, { accessCount: 0 });
    const out = applyAttentionScore([hot, cold], cfg, null, NOW);
    expect(out.results[0].id).toBe("hot");
  });

  test("task alignment lifts task-related result when session provides taskContext", () => {
    const reg = new SessionRegistry();
    const session = reg.create({
      sessionId: "s1",
      agentId: "claude",
      taskContext: "debugging auth middleware timeout",
    });
    const aligned = r("aligned", "auth middleware timeout fix", 0.5);
    const offtopic = r("offtopic", "database migration rollback policy", 0.5);
    const out = applyAttentionScore([aligned, offtopic], cfg, session, NOW);
    expect(out.results[0].id).toBe("aligned");
  });

  test("agent affinity lifts memory authored by the session agent", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    const mine = r("mine", "x", 0.5, { agentId: "claude" });
    const theirs = r("theirs", "y", 0.5, { agentId: "cursor" });
    const out = applyAttentionScore([mine, theirs], cfg, session, NOW);
    expect(out.results[0].id).toBe("mine");
  });

  test("rerankWindow limits re-ranking to top-N", () => {
    const results: SearchResult[] = [];
    for (let i = 0; i < 10; i++) {
      results.push(r(`r${i}`, `content ${i}`, 1 - i * 0.05));
    }
    const out = applyAttentionScore(
      results,
      { ...cfg, rerankWindow: 3 },
      null,
      NOW,
    );
    // last 7 (indices 3..9) should be untouched in order
    expect(out.results.slice(3).map((r) => r.id)).toEqual([
      "r3", "r4", "r5", "r6", "r7", "r8", "r9",
    ]);
  });

  test("breakdown shape includes all signals", () => {
    const out = applyAttentionScore(
      [r("a", "x", 0.5, { createdAt: NOW, accessCount: 5 })],
      cfg,
      null,
      NOW,
    );
    expect(out.breakdowns).toHaveLength(1);
    const b = out.breakdowns[0];
    expect(b.resultId).toBe("a");
    expect(b.semantic).toBeGreaterThan(0);
    expect(b.recency).toBeGreaterThan(0.9); // fresh -> close to 1
    expect(b.final).toBeGreaterThan(0);
  });
});
