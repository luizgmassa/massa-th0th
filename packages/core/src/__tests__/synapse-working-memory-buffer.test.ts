import { describe, test, expect } from "bun:test";
import {
  WorkingMemoryBuffer,
  DEFAULT_BUFFER_CONFIG,
} from "../services/synapse/buffer/working-memory-buffer.js";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, score: number, content?: string): SearchResult {
  return {
    id,
    content: content ?? id,
    score,
    source: SearchSource.VECTOR,
    metadata: {},
  };
}

const NOW = 2_000_000_000;

describe("WorkingMemoryBuffer", () => {
  test("put + get with same query returns hits with boost", () => {
    const buf = new WorkingMemoryBuffer(DEFAULT_BUFFER_CONFIG);
    buf.put([r("a", 0.5), r("b", 0.4)], "auth middleware", NOW);
    const hit = buf.get("auth middleware", NOW);
    expect(hit.hitIds.size).toBe(2);
    const byId = Object.fromEntries(hit.results.map((x) => [x.id, x.score]));
    expect(byId.a).toBeCloseTo(0.65, 5); // 0.5 * 1.3
    expect(byId.b).toBeCloseTo(0.52, 5); // 0.4 * 1.3
  });

  test("get returns no hits when query is unrelated", () => {
    const buf = new WorkingMemoryBuffer(DEFAULT_BUFFER_CONFIG);
    buf.put([r("a", 0.9)], "auth middleware token configuration", NOW);
    const hit = buf.get("database migration rollback strategy", NOW);
    expect(hit.results).toHaveLength(0);
  });

  test("partial query overlap above threshold yields hit", () => {
    const buf = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      matchThreshold: 0.3,
    });
    buf.put([r("a", 0.5)], "auth middleware timeout", NOW);
    const hit = buf.get("middleware timeout settings", NOW);
    expect(hit.results.length).toBeGreaterThan(0);
  });

  test("primed entries match via content tokens (IMP-9)", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.2 });
    // The primed entry's content shares tokens with the query.
    buf.prime([r("p1", 0.7, "auth middleware token configuration")], NOW);
    const overlapping = buf.get("auth middleware behavior", NOW);
    expect(overlapping.hitIds.has("p1")).toBe(true);

    // An unrelated query should NOT pull the primed entry (no flood).
    const unrelated = buf.get("database migration rollback strategy", NOW);
    expect(unrelated.hitIds.has("p1")).toBe(false);
  });

  test("eviction respects maxSize using LRU-by-score", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, maxSize: 2 });
    buf.put([r("a", 0.9)], "auth middleware", NOW);
    buf.put([r("b", 0.5)], "auth middleware", NOW);
    buf.put([r("c", 0.7)], "auth middleware", NOW);
    expect(buf.size()).toBe(2);
    expect(buf.has("a")).toBe(true);
    expect(buf.has("c")).toBe(true);
    expect(buf.has("b")).toBe(false); // lowest score evicted
  });

  test("TTL expiry removes stale entries", () => {
    const buf = new WorkingMemoryBuffer({ ...DEFAULT_BUFFER_CONFIG, ttlMs: 1000 });
    buf.put([r("a", 0.5)], "auth middleware", NOW);
    expect(buf.size()).toBe(1);
    buf.evictExpired(NOW + 2000);
    expect(buf.size()).toBe(0);
  });

  test("invalidate removes specific ids", () => {
    const buf = new WorkingMemoryBuffer(DEFAULT_BUFFER_CONFIG);
    buf.put([r("a", 0.5), r("b", 0.5), r("c", 0.5)], "auth middleware", NOW);
    expect(buf.invalidate(["a", "b"])).toBe(2);
    expect(buf.size()).toBe(1);
    expect(buf.has("c")).toBe(true);
  });

  test("put accumulates query tokens across calls (IMP-8: baseline preserved)", () => {
    const buf = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      matchThreshold: 0.3,
    });
    buf.put([r("a", 0.5)], "auth middleware", NOW);
    // Second put with a different (post-pipeline) score must NOT override
    // the original baseline — IMP-8 prevents drift across cycles.
    buf.put([r("a", 0.6)], "session storage", NOW);
    const hit1 = buf.get("auth middleware", NOW);
    expect(hit1.results[0].score).toBeCloseTo(0.65, 5); // 0.5 * 1.3
    const hit2 = buf.get("session storage", NOW);
    expect(hit2.results[0].score).toBeCloseTo(0.65, 5);
  });

  test("put with explicit rawScores overwrites baseline (IMP-8)", () => {
    const buf = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      matchThreshold: 0.3,
    });
    buf.put([r("a", 0.5)], "auth middleware", NOW);
    // Caller explicitly hands in the raw pre-pipeline score.
    buf.put([r("a", 0.9)], "auth middleware refined", NOW, new Map([["a", 0.55]]));
    const hit = buf.get("auth middleware", NOW);
    expect(hit.results[0].score).toBeCloseTo(0.715, 5); // 0.55 * 1.3
  });
});
