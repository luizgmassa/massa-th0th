import { describe, expect, test } from "bun:test";
import { SearchSource, type SearchResult } from "@massa-th0th/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { SearchProjectTool } from "../tools/search_project.js";
import { SearchController } from "../controllers/search-controller.js";
import { LocalHealthChecker } from "../services/health/local-health-checker.js";
import {
  getSearchDiagnostics,
  recordSearchDegradation,
  resetSearchDiagnosticsForTests,
  SearchServiceError,
  type SearchDegradation,
} from "../services/search/search-diagnostics.js";

const HIT: SearchResult = {
  id: "vector-hit",
  content: "required vector retrieval remains available",
  score: 0.9,
  source: SearchSource.VECTOR,
  metadata: {
    projectId: "outage-project",
    filePath: "src/vector.ts",
  },
};

function createSearch(options: {
  vectorSearch: () => Promise<SearchResult[]>;
  keywordSearch?: () => Promise<SearchResult[]>;
  trigramSearch?: () => Promise<SearchResult[]>;
  fuzzyCorrect?: () => Promise<string | null>;
  analytics?: () => void;
  graphSearch?: () => Promise<SearchResult[]>;
  synapseProcess?: () => never;
}) {
  const cacheWrites: SearchResult[][] = [];
  const search = new ContextualSearchRLM({
    vectorStore: {
      search: options.vectorSearch,
    } as any,
    keywordSearch: {
      searchWithFilter: options.keywordSearch ?? (async () => []),
      searchTrigram: options.trigramSearch ?? (async () => []),
      fuzzyCorrect: options.fuzzyCorrect,
    } as any,
    searchCache: {
      get: async () => null,
      set: async (
        _query: string,
        _projectId: string,
        results: SearchResult[],
      ) => {
        cacheWrites.push(results);
      },
    } as any,
    analytics: { trackSearch: options.analytics ?? (() => {}) } as any,
    symbolRepo: {} as any,
    sessionRegistry: { getAsync: async () => ({ workspaceId: "outage-project" }) } as any,
    synapseManager: options.synapseProcess
      ? { process: options.synapseProcess }
      : undefined,
  });
  (search as any).buildGraphStream = options.graphSearch ?? (async () => []);
  (search as any).addContextToResults = async (results: SearchResult[]) => results;
  (search as any).queryUnderstanding = { understand: async () => null };
  return { search, cacheWrites };
}

describe("ContextualSearchRLM dependency-outage transparency", () => {
  test("genuine zero-hit retrieval succeeds with an empty result", async () => {
    const { search, cacheWrites } = createSearch({
      vectorSearch: async () => [],
    });

    const results = await search.search("no matching document", "outage-project");

    expect(results).toEqual([]);
    expect(cacheWrites).toEqual([[]]);
  });

  test("required vector backend failure rejects instead of becoming a zero hit", async () => {
    resetSearchDiagnosticsForTests();
    const { search, cacheWrites } = createSearch({
      vectorSearch: async () => {
        throw new Error("vector backend offline");
      },
    });

    try {
      await search.search("required retrieval", "outage-project");
      throw new Error("expected search to reject");
    } catch (error) {
      expect(error).toBeInstanceOf(SearchServiceError);
      expect((error as SearchServiceError).code).toBe("SEARCH_BACKEND_UNAVAILABLE");
      expect((error as SearchServiceError).component).toBe("vector_search");
      expect((error as Error).message).not.toContain("offline");
    }
    expect(cacheWrites).toEqual([]);
    expect(getSearchDiagnostics()).toMatchObject([
      {
        kind: "failure",
        code: "SEARCH_BACKEND_UNAVAILABLE",
        component: "vector_search",
      },
    ]);
    expect(JSON.stringify(getSearchDiagnostics())).not.toContain("offline");
  });

  test("required primary keyword failure rejects instead of becoming a vector-only hit", async () => {
    const { search, cacheWrites } = createSearch({
      vectorSearch: async () => [HIT],
      keywordSearch: async () => {
        throw new Error("keyword backend offline");
      },
    });

    await expect(
      search.search("required retrieval", "outage-project"),
    ).rejects.toMatchObject({
      code: "SEARCH_BACKEND_UNAVAILABLE",
      component: "keyword_search",
    });
    expect(cacheWrites).toEqual([]);
  });

  test("optional failures succeed with bounded sanitized degradations", async () => {
    resetSearchDiagnosticsForTests();
    const { search } = createSearch({
      vectorSearch: async () => [HIT],
      trigramSearch: async () => {
        throw new Error("secret trigram connection detail");
      },
      fuzzyCorrect: async () => { throw new Error("secret vocabulary detail"); },
      graphSearch: async () => { throw new Error("secret graph detail"); },
      analytics: () => { throw new Error("secret audit detail"); },
      synapseProcess: () => { throw new Error("secret session detail"); },
    });
    let degradations: readonly SearchDegradation[] = [];

    const results = await search.search("required", "outage-project", {
      sessionId: "session-1",
      onDegradations: (entries) => { degradations = entries; },
    });

    expect(results.map((entry) => entry.id)).toEqual(["vector-hit"]);
    expect(degradations.map((entry) => entry.code)).toEqual([
      "TRIGRAM_UNAVAILABLE",
      "FUZZY_SEARCH_UNAVAILABLE",
      "GRAPH_AUGMENTATION_UNAVAILABLE",
      "SEARCH_ANALYTICS_UNAVAILABLE",
      "SYNAPSE_UNAVAILABLE",
    ]);
    expect(JSON.stringify(degradations)).not.toContain("secret");
  });

  test("diagnostic history retains only the newest 100 sanitized entries", async () => {
    resetSearchDiagnosticsForTests();
    for (let index = 0; index < 105; index += 1) {
      const { search } = createSearch({
        vectorSearch: async () => [HIT],
        trigramSearch: async () => { throw new Error(`secret-${index}`); },
      });
      await search.search(`required-${index}`, "outage-project");
    }

    const diagnostics = getSearchDiagnostics();
    expect(diagnostics).toHaveLength(100);
    expect(diagnostics.every((entry) => entry.code === "TRIGRAM_UNAVAILABLE")).toBe(true);
    expect(JSON.stringify(diagnostics)).not.toContain("secret-");
  });
});

describe("SearchProjectTool outage envelope", () => {
  test("typed required retrieval rejection remains typed for transports", async () => {
    const tool = Object.create(SearchProjectTool.prototype) as SearchProjectTool;
    (tool as any).controller = {
      searchProject: async () => {
        throw new SearchServiceError("SEARCH_BACKEND_UNAVAILABLE", "vector_search", {
          cause: new Error("vector backend password=secret"),
        });
      },
    };

    await expect(tool.handle({
      query: "required retrieval",
      projectId: "outage-project",
      format: "json",
    })).rejects.toMatchObject({
      code: "SEARCH_BACKEND_UNAVAILABLE",
      component: "vector_search",
      statusCode: 503,
      message: "A required search backend is unavailable",
    });
  });

  test("non-service failures retain the tool-level compatibility envelope", async () => {
    const tool = Object.create(SearchProjectTool.prototype) as SearchProjectTool;
    (tool as any).controller = {
      searchProject: async () => { throw new Error("project is not indexed"); },
    };

    const response = await tool.handle({ query: "query", projectId: "missing" });
    expect(response.success).toBe(false);
    expect(response.error).toContain("Failed to search project");
  });
});

describe("search transport metadata", () => {
  test("SearchController includes bounded degradations only when present", async () => {
    const controller = Object.create(SearchController.prototype) as SearchController;
    (controller as any).contextualSearch = {
      checkSearchAdmission: async () => ({ admitted: true }),
      search: async (_query: string, _projectId: string, options: any) => {
        options.onDegradations(Array.from({ length: 12 }, (_, index) => ({
          code: "TRIGRAM_UNAVAILABLE",
          component: `optional-${index}`,
          message: "Trigram enrichment was unavailable",
        })));
        return [];
      },
    };

    const result = await controller.searchProject({ query: "query", projectId: "project" });

    expect(result.degradations).toHaveLength(10);
    expect(JSON.stringify(result.degradations)).not.toContain("cause");
  });

  test("local health exposes at most 100 sanitized search diagnostics", async () => {
    resetSearchDiagnosticsForTests();
    for (let index = 0; index < 105; index += 1) {
      recordSearchDegradation("TRIGRAM_UNAVAILABLE", `trigram-${index}`, "project");
    }
    const checker = new LocalHealthChecker();
    const healthy = { available: true, details: { pgvector: true } };
    (checker as any).checkOllama = async () => healthy;
    (checker as any).checkDataDirectory = async () => healthy;
    (checker as any).checkPostgres = async () => healthy;

    const report = await checker.checkAll();

    expect(report.diagnostics.search).toHaveLength(100);
    expect(report.diagnostics.search[0]?.component).toBe("trigram-5");
    expect(JSON.stringify(report.diagnostics.search)).not.toContain("cause");
  });
});
