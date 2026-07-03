import { describe, test, expect } from "bun:test";
import {
  applyConfidenceGate,
  classifyQuery,
} from "../services/synapse/inhibition/confidence-gate.js";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

function r(id: string, score: number): SearchResult {
  return {
    id,
    content: id,
    score,
    source: SearchSource.VECTOR,
    metadata: {},
  };
}

const CONFIG = {
  enabled: true,
  thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
};

describe("classifyQuery", () => {
  test("file paths are specific", () => {
    expect(classifyQuery("how does src/auth/middleware.ts work")).toBe("specific");
  });

  test("camelCase symbols are specific", () => {
    expect(classifyQuery("explain the getUserId function")).toBe("specific");
  });

  test("PascalCase symbols are specific", () => {
    expect(classifyQuery("MyService class behavior")).toBe("specific");
  });

  test("snake_case symbols are specific", () => {
    expect(classifyQuery("what does record_event do")).toBe("specific");
  });

  test("function calls are specific", () => {
    expect(classifyQuery("output of compute(items)")).toBe("specific");
  });

  test("quoted symbols are specific", () => {
    expect(classifyQuery("find references to `useStore` in code")).toBe("specific");
  });

  test("technical keywords without symbols are focused", () => {
    expect(classifyQuery("middleware ordering")).toBe("focused");
    expect(classifyQuery("provider config")).toBe("focused");
  });

  test("long technical phrasing is broad", () => {
    expect(
      classifyQuery(
        "how do we usually approach the long winded process of refactoring our service layer"
      )
    ).toBe("broad");
  });

  test("plain natural language is broad", () => {
    expect(classifyQuery("error handling style in this project")).toBe("broad");
  });

  test("empty query is broad", () => {
    expect(classifyQuery("")).toBe("broad");
    expect(classifyQuery("   ")).toBe("broad");
  });
});

describe("applyConfidenceGate", () => {
  test("disabled returns all results plus class/threshold", () => {
    const out = applyConfidenceGate(
      [r("a", 0.1), r("b", 0.9)],
      "MyService",
      { ...CONFIG, enabled: false }
    );
    expect(out.results).toHaveLength(2);
    expect(out.queryClass).toBe("specific");
    expect(out.threshold).toBe(0.55);
  });

  test("specific query filters below 0.55", () => {
    const out = applyConfidenceGate(
      [r("a", 0.3), r("b", 0.5), r("c", 0.6), r("d", 0.9)],
      "getUserId function",
      CONFIG
    );
    expect(out.queryClass).toBe("specific");
    expect(out.results.map((r) => r.id)).toEqual(["c", "d"]);
  });

  test("focused query filters below 0.4", () => {
    const out = applyConfidenceGate(
      [r("a", 0.3), r("b", 0.5), r("c", 0.9)],
      "middleware ordering",
      CONFIG
    );
    expect(out.queryClass).toBe("focused");
    expect(out.results.map((r) => r.id)).toEqual(["b", "c"]);
  });

  test("broad query filters below 0.25", () => {
    const out = applyConfidenceGate(
      [r("a", 0.1), r("b", 0.3), r("c", 0.9)],
      "how do we usually handle our long things in this codebase generally",
      CONFIG
    );
    expect(out.queryClass).toBe("broad");
    expect(out.results.map((r) => r.id)).toEqual(["b", "c"]);
  });
});
