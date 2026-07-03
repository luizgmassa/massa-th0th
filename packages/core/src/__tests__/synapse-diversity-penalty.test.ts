import { describe, test, expect } from "bun:test";
import { applyDiversityPenalty } from "../services/synapse/inhibition/diversity-penalty.js";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, content: string, score: number): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.VECTOR,
    metadata: {},
  };
}

const CONFIG = { enabled: true, threshold: 0.85, lambda: 0.4 };

describe("applyDiversityPenalty", () => {
  test("returns input unchanged when disabled", () => {
    const input = [r("a", "x y z", 0.9), r("b", "x y z", 0.8)];
    const out = applyDiversityPenalty(input, { ...CONFIG, enabled: false });
    expect(out).toEqual(input);
  });

  test("returns input unchanged for single-element list", () => {
    const input = [r("a", "x y z", 0.9)];
    const out = applyDiversityPenalty(input, CONFIG);
    expect(out).toEqual(input);
  });

  test("penalizes near-duplicate content", () => {
    const a = r("a", "auth middleware timeout configuration setting", 0.9);
    const b = r("b", "auth middleware timeout configuration setting", 0.85);
    const out = applyDiversityPenalty([a, b], CONFIG);
    expect(out[0].id).toBe("a");
    expect(out[0].score).toBeCloseTo(0.9, 5);
    expect(out[1].score).toBeLessThan(0.85);
  });

  test("does not penalize distinct content", () => {
    const a = r("a", "auth middleware setup", 0.9);
    const b = r("b", "database migration rollback", 0.85);
    const out = applyDiversityPenalty([a, b], CONFIG);
    expect(out[0].score).toBeCloseTo(0.9, 5);
    expect(out[1].score).toBeCloseTo(0.85, 5);
  });

  test("re-sorts after penalty so dominant unique result wins over a heavily-penalized cluster", () => {
    const a = r("a", "alpha beta gamma delta epsilon", 0.95);
    const b = r("b", "alpha beta gamma delta epsilon", 0.92); // near-clone of a
    const c = r("c", "zeta eta theta iota kappa", 0.80);     // unique topic
    const out = applyDiversityPenalty([a, b, c], CONFIG);
    expect(out[0].id).toBe("a");
    // b should have been penalized below c's untouched score
    expect(out[1].id).toBe("c");
    expect(out[2].id).toBe("b");
  });

  test("empty list returns empty list", () => {
    const out = applyDiversityPenalty([], CONFIG);
    expect(out).toEqual([]);
  });
});
