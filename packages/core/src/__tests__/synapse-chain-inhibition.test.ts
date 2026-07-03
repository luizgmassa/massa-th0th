import { describe, test, expect } from "bun:test";
import {
  applyChainInhibition,
  detectIntent,
  DEFAULT_CHAIN_BOOSTS,
} from "../services/synapse/inhibition/chain-inhibition.js";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, score: number, type?: string): SearchResult {
  return {
    id,
    content: id,
    score,
    source: SearchSource.VECTOR,
    metadata: type ? ({ type } as any) : {},
  };
}

const CONFIG = { enabled: true, boosts: DEFAULT_CHAIN_BOOSTS };

describe("detectIntent", () => {
  test("decision queries", () => {
    expect(detectIntent("why did we choose Elysia over Express")).toBe("decision");
    expect(detectIntent("por que decidimos usar RRF")).toBe("decision");
    expect(detectIntent("what was the rationale for that decision")).toBe("decision");
  });

  test("debug queries", () => {
    expect(detectIntent("how do I fix this ECONNREFUSED error")).toBe("debug");
    expect(detectIntent("como resolver este erro de timeout")).toBe("debug");
    expect(detectIntent("the build is broken")).toBe("debug");
  });

  test("pattern queries", () => {
    expect(detectIntent("what is the pattern for error handling here")).toBe("pattern");
    expect(detectIntent("padrão de migrations neste projeto")).toBe("pattern");
    expect(detectIntent("best practice for testing")).toBe("pattern");
  });

  test("symbol queries", () => {
    expect(detectIntent("what is the MemoryService class")).toBe("symbol");
    expect(detectIntent("definition of computeAttention")).toBe("symbol");
  });

  test("general queries", () => {
    expect(detectIntent("auth middleware behavior")).toBe("general");
    expect(detectIntent("anything")).toBe("general");
  });
});

describe("applyChainInhibition", () => {
  test("disabled returns input unchanged", () => {
    const input = [r("a", 0.5, "decision"), r("b", 0.6, "code")];
    const out = applyChainInhibition(input, "why did we decide", { ...CONFIG, enabled: false });
    expect(out.results).toEqual(input);
  });

  test("general intent leaves results untouched", () => {
    const input = [r("a", 0.5, "decision"), r("b", 0.6, "code")];
    const out = applyChainInhibition(input, "anything", CONFIG);
    expect(out.intent).toBe("general");
    expect(out.results.map((r) => r.score)).toEqual([0.5, 0.6]);
  });

  test("decision intent boosts decisions and suppresses conversations", () => {
    const decision = r("d", 0.5, "decision");
    const conversation = r("c", 0.5, "conversation");
    const code = r("code", 0.5, "code");
    const out = applyChainInhibition(
      [decision, conversation, code],
      "why did we choose this",
      CONFIG,
    );
    expect(out.intent).toBe("decision");
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r.score]));
    expect(byId.d).toBeCloseTo(1.0, 5); // 0.5 * 2.0
    expect(byId.c).toBeCloseTo(0.3, 5); // 0.5 * 0.6
    expect(byId.code).toBe(0.5); // no entry in boost map -> untouched
    // sorted by score DESC
    expect(out.results[0].id).toBe("d");
  });

  test("results without type pass through untouched", () => {
    const a = r("a", 0.7); // no type
    const b = r("b", 0.5, "decision");
    const out = applyChainInhibition([a, b], "why did we decide", CONFIG);
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r.score]));
    expect(byId.a).toBe(0.7);
    expect(byId.b).toBeCloseTo(1.0, 5);
  });

  test("debug intent boosts conversations (debug-bucket) and suppresses decisions", () => {
    const c = r("c", 0.4, "conversation");
    const d = r("d", 0.8, "decision");
    const out = applyChainInhibition([c, d], "how to fix this error", CONFIG);
    expect(out.intent).toBe("debug");
    const byId = Object.fromEntries(out.results.map((r) => [r.id, r.score]));
    expect(byId.c).toBeCloseTo(0.72, 5); // 0.4 * 1.8
    expect(byId.d).toBeCloseTo(0.48, 5); // 0.8 * 0.6
  });
});
