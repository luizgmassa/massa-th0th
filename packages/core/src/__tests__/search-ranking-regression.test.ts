import { describe, expect, test } from "bun:test";
import { SearchSource, type SearchResult } from "@massa-ai/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";

function result(id: string, score: number): SearchResult {
  return {
    id,
    content: id,
    score,
    source: SearchSource.HYBRID,
    metadata: { projectId: "ranking-test", filePath: `${id}.ts` },
  };
}

describe("hybrid ranking regressions", () => {
  test("correlated lexical streams contribute only their best rank", () => {
    const search = new ContextualSearchRLM();
    const fused = (search as any).fuseResults(
      [
        [result("semantic-needle", 0.9)],
        [result("lexical-duplicate", 1)],
        [result("lexical-duplicate", 1)],
      ],
      "natural language query",
      false,
    ) as SearchResult[];

    expect(fused.map((entry) => entry.id)).toEqual([
      "semantic-needle",
      "lexical-duplicate",
    ]);
  });

  test("fuzzy correction is limited to a single identifier-like term", async () => {
    let calls = 0;
    const search = new ContextualSearchRLM();
    (search as any).keywordSearch = {
      fuzzyCorrect: async () => {
        calls++;
        return "corrected";
      },
    };

    expect(await (search as any).correctQuery("limite máximo de iterações")).toBeNull();
    expect(calls).toBe(0);
    expect(await (search as any).correctQuery("useEffct")).toBe("corrected");
    expect(calls).toBe(1);
  });
});
