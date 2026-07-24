import { describe, expect, test } from "bun:test";
import { SearchSource, type SearchResult } from "@massa-ai/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";

function candidate(index: number, eligible: boolean): SearchResult {
  return {
    id: `candidate-${index}`,
    content: `bounded retrieval candidate ${index}`,
    score: 0.9 - index / 10_000,
    source: SearchSource.VECTOR,
    metadata: {
      projectId: "filter-project",
      filePath: eligible
        ? `src/eligible/result-${index}.ts`
        : `src/excluded/result-${index}.ts`,
    },
  };
}

function createSearch(candidates: SearchResult[]) {
  const vectorLimits: number[] = [];
  const keywordLimits: number[] = [];
  const trigramLimits: number[] = [];
  const cacheOptions: Record<string, unknown>[] = [];
  const search = new ContextualSearchRLM({
    vectorStore: {
      search: async (_query: string, limit: number) => {
        vectorLimits.push(limit);
        return candidates.slice(0, limit);
      },
    } as any,
    keywordSearch: {
      searchWithFilter: async (
        _query: string,
        _filters: Record<string, unknown>,
        limit: number,
      ) => {
        keywordLimits.push(limit);
        return [];
      },
      searchTrigram: async (
        _query: string,
        _filters: Record<string, unknown>,
        limit: number,
      ) => {
        trigramLimits.push(limit);
        return [];
      },
    } as any,
    searchCache: {
      get: async (
        _query: string,
        _projectId: string,
        options: Record<string, unknown>,
      ) => {
        cacheOptions.push(options);
        return null;
      },
      set: async () => {},
    } as any,
    analytics: { trackSearch: () => {} } as any,
    symbolRepo: {} as any,
  });
  (search as any).buildGraphStream = async () => [];
  (search as any).addContextToResults = async (results: SearchResult[]) => results;
  (search as any).queryUnderstanding = { understand: async () => null };
  return { search, vectorLimits, keywordLimits, trigramLimits, cacheOptions };
}

describe("ContextualSearchRLM — bounded filtered retrieval", () => {
  test("blank queries return no hits without calling retrieval providers", async () => {
    const { search, vectorLimits, keywordLimits, trigramLimits } = createSearch([
      candidate(0, true),
    ]);

    const results = await search.search("   ", "filter-project", {
      maxResults: 5,
    });

    expect(results).toEqual([]);
    expect(vectorLimits).toEqual([]);
    expect(keywordLimits).toEqual([]);
    expect(trigramLimits).toEqual([]);
  });

  test("minScore rejects graph-only context without direct query relevance", async () => {
    const { search } = createSearch([
      { ...candidate(0, true), score: 0.65 },
    ]);
    (search as any).buildGraphStream = async () => [
      {
        id: "graph-only-memory",
        content: "context connected to an unrelated low-score seed",
        score: 0.45,
        source: SearchSource.MEMORY,
        metadata: {
          projectId: "filter-project",
          context: { graphNeighbor: true },
        },
      },
    ];

    const results = await search.search(
      "zzzqzx unicorn frobnicate",
      "filter-project",
      { maxResults: 5, minScore: 0.7 },
    );

    expect(results).toEqual([]);
  });

  test("include-only fills maxResults beyond the old 2N window in one pass", async () => {
    const candidates = [
      ...Array.from({ length: 20 }, (_, index) => candidate(index, false)),
      ...Array.from({ length: 5 }, (_, index) => candidate(index + 20, true)),
    ];
    const { search, vectorLimits, keywordLimits, trigramLimits } = createSearch(candidates);

    const results = await search.search("bounded retrieval", "filter-project", {
      maxResults: 5,
      minScore: 0,
      includeFilters: ["src/eligible/**"],
    });

    expect(results.map((entry) => entry.id)).toEqual([
      "candidate-20",
      "candidate-21",
      "candidate-22",
      "candidate-23",
      "candidate-24",
    ]);
    expect(vectorLimits).toEqual([25]);
    expect(keywordLimits).toEqual([25]);
    expect(trigramLimits).toEqual([25]);
  });

  test("exclude-only applies before the final slice", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...candidate(index, true),
      metadata: {
        projectId: "filter-project",
        filePath: index < 6
          ? `src/generated/result-${index}.ts`
          : `src/runtime/result-${index}.ts`,
      },
    }));
    const { search } = createSearch(candidates);

    const results = await search.search("bounded retrieval", "filter-project", {
      maxResults: 5,
      minScore: 0,
      excludeFilters: ["src/generated/**"],
    });

    expect(results).toHaveLength(5);
    expect(results.every((entry) =>
      String(entry.metadata.filePath).startsWith("src/runtime/"),
    )).toBe(true);
  });

  test("combined include and exclude filters apply before the final slice", async () => {
    const candidates = Array.from({ length: 12 }, (_, index) => ({
      ...candidate(index, true),
      metadata: {
        projectId: "filter-project",
        filePath: index < 6
          ? `src/eligible/generated/result-${index}.ts`
          : `src/eligible/runtime/result-${index}.ts`,
      },
    }));
    const { search } = createSearch(candidates);

    const results = await search.search("bounded retrieval", "filter-project", {
      maxResults: 5,
      minScore: 0,
      includeFilters: ["src/eligible/**"],
      excludeFilters: ["src/eligible/generated/**"],
    });

    expect(results).toHaveLength(5);
    expect(results.every((entry) =>
      String(entry.metadata.filePath).startsWith("src/eligible/runtime/"),
    )).toBe(true);
  });

  test("include whitelist rejects candidates without a file path", async () => {
    const pathless = {
      ...candidate(0, false),
      metadata: { projectId: "filter-project" },
    };
    const eligible = candidate(1, true);
    const { search } = createSearch([pathless, eligible]);

    const results = await search.search("bounded retrieval", "filter-project", {
      maxResults: 1,
      minScore: 0,
      includeFilters: ["src/eligible/**"],
    });

    expect(results.map((entry) => entry.id)).toEqual(["candidate-1"]);
  });

  test("recursive glob matches a file directly beneath its root", async () => {
    const directChild = {
      ...candidate(0, true),
      metadata: {
        projectId: "filter-project",
        filePath: "packages/core/src/services/mutex.ts",
      },
    };
    const { search } = createSearch([directChild]);

    const results = await search.search("mutex queue", "filter-project", {
      maxResults: 1,
      minScore: 0,
      includeFilters: ["packages/core/src/services/**/*.ts"],
    });

    expect(results.map((entry) => entry.id)).toEqual(["candidate-0"]);
  });

  test("filtered candidate window is capped at N + 200 and never retries", async () => {
    const candidates = [
      ...Array.from({ length: 300 }, (_, index) => candidate(index, false)),
      ...Array.from({ length: 10 }, (_, index) => candidate(index + 300, true)),
    ];
    const { search, vectorLimits, keywordLimits, trigramLimits } = createSearch(candidates);

    const results = await search.search("bounded retrieval", "filter-project", {
      maxResults: 100,
      minScore: 0,
      includeFilters: ["src/eligible/**"],
    });

    expect(results).toEqual([]);
    expect(vectorLimits).toEqual([300]);
    expect(keywordLimits).toEqual([300]);
    expect(trigramLimits).toEqual([300]);
  });

  test("unfiltered retrieval preserves the existing 2N window", async () => {
    const { search, vectorLimits, keywordLimits, trigramLimits } = createSearch(
      Array.from({ length: 20 }, (_, index) => candidate(index, true)),
    );

    await search.search("bounded retrieval", "filter-project", {
      maxResults: 5,
      minScore: 0,
    });

    expect(vectorLimits).toEqual([10]);
    expect(keywordLimits).toEqual([10]);
    expect(trigramLimits).toEqual([10]);
  });

  test("cache identity declares bounded-v1 without mutating filter arrays", async () => {
    const includeFilters = ["src/eligible/**"];
    const excludeFilters = ["**/*.test.ts"];
    const { search, cacheOptions } = createSearch([candidate(0, true)]);

    await search.search("bounded retrieval", "filter-project", {
      maxResults: 5,
      minScore: 0,
      includeFilters,
      excludeFilters,
    });

    expect(cacheOptions[0].retrievalWindow).toBe("bounded-v1");
    expect(includeFilters).toEqual(["src/eligible/**"]);
    expect(excludeFilters).toEqual(["**/*.test.ts"]);
  });
});
