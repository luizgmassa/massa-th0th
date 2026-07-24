import { describe, test, expect } from "bun:test";
import {
  applyTemporalInhibition,
  hasTemporalIndicator,
} from "../services/synapse/inhibition/temporal-inhibition.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

function r(id: string, score: number, createdAt: number | null): SearchResult {
  return {
    id,
    content: id,
    score,
    source: SearchSource.VECTOR,
    metadata: createdAt == null ? {} : { createdAt },
  };
}

const CONFIG = { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 };
const NOW = 1_000_000_000;

describe("hasTemporalIndicator", () => {
  test("detects English indicators", () => {
    expect(hasTemporalIndicator("what is the latest auth change")).toBe(true);
    expect(hasTemporalIndicator("recent migrations")).toBe(true);
    expect(hasTemporalIndicator("anything new today")).toBe(true);
  });

  test("detects Portuguese indicators", () => {
    expect(hasTemporalIndicator("decisões recentes")).toBe(true);
    expect(hasTemporalIndicator("o que mudou hoje")).toBe(true);
  });

  test("returns false for non-temporal queries", () => {
    expect(hasTemporalIndicator("auth middleware behavior")).toBe(false);
    expect(hasTemporalIndicator("getUserId function")).toBe(false);
  });
});

describe("applyTemporalInhibition", () => {
  test("disabled returns input unchanged", () => {
    const input = [r("a", 0.9, NOW - 1000)];
    const out = applyTemporalInhibition(input, "anything", { ...CONFIG, enabled: false }, NOW);
    expect(out).toEqual(input);
  });

  test("temporal query skips penalty", () => {
    const fresh = r("fresh", 0.9, NOW - 1000);
    const old = r("old", 0.8, NOW - 10_000_000);
    const out = applyTemporalInhibition([fresh, old], "what is the latest", CONFIG, NOW);
    expect(out[0].id).toBe("fresh");
    expect(out[0].score).toBe(0.9);
  });

  test("penalizes fresh memories on non-temporal query", () => {
    const fresh = r("fresh", 0.9, NOW - 1000);
    const old = r("old", 0.8, NOW - 10_000_000);
    const out = applyTemporalInhibition([fresh, old], "auth middleware", CONFIG, NOW);
    const freshOut = out.find((x) => x.id === "fresh")!;
    const oldOut = out.find((x) => x.id === "old")!;
    expect(freshOut.score).toBeCloseTo(0.75, 5);
    expect(oldOut.score).toBe(0.8);
  });

  test("re-sorts after penalty so older but better memories surface", () => {
    const fresh = r("fresh", 0.85, NOW - 1000);
    const old = r("old", 0.75, NOW - 10_000_000);
    const out = applyTemporalInhibition([fresh, old], "auth middleware", CONFIG, NOW);
    expect(out[0].id).toBe("old");
    expect(out[1].id).toBe("fresh");
  });

  test("results without createdAt are untouched", () => {
    const noDate = r("nodate", 0.9, null);
    const old = r("old", 0.8, NOW - 10_000_000);
    const out = applyTemporalInhibition([noDate, old], "auth middleware", CONFIG, NOW);
    expect(out[0].score).toBe(0.9);
    expect(out[1].score).toBe(0.8);
  });

  test("does not produce negative scores", () => {
    const fresh = r("fresh", 0.1, NOW - 1000);
    const out = applyTemporalInhibition([fresh], "auth middleware", CONFIG, NOW);
    expect(out[0].score).toBeGreaterThanOrEqual(0);
  });
});
