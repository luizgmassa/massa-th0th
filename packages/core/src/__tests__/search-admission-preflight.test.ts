import { describe, expect, test } from "bun:test";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { SearchController } from "../controllers/search-controller.js";
import { SearchProjectTool } from "../tools/search_project.js";
import { SearchCodeTool } from "../tools/search_code.js";

/**
 * M10 — search admission preflight.
 *
 * Two-tier gate:
 *   Tier 1 — HARD-FAIL when the project has no index metadata (pure existence
 *            check; no projectPath required). search() must NOT be called.
 *   Tier 2 — WARN when indexed but stale (projectPath required); search() runs
 *            and the result carries a warning/stale descriptor.
 *
 * The indexManager seam is mocked directly on the ContextualSearchRLM instance
 * to avoid PG / filesystem dependencies.
 */

function createSearch() {
  const search = new ContextualSearchRLM({
    vectorStore: { search: async () => [] } as any,
    keywordSearch: {
      searchWithFilter: async () => [],
      searchTrigram: async () => [],
    } as any,
    searchCache: {
      get: async () => null,
      set: async () => {},
    } as any,
    analytics: { trackSearch: () => {} } as any,
    symbolRepo: {} as any,
  });
  (search as any).buildGraphStream = async () => [];
  (search as any).addContextToResults = async (results: any[]) => results;
  (search as any).queryUnderstanding = { understand: async () => null };
  return search;
}

function attachIndexManagerMock(
  search: ContextualSearchRLM,
  meta: { hasIndex: boolean; stale?: { isStale: boolean; reason?: string } },
) {
  const calls: { getIndexMetadata: number; isIndexStale: number; search: number } = {
    getIndexMetadata: 0,
    isIndexStale: 0,
    search: 0,
  };
  (search as any).indexManager = {
    getIndexMetadata: async (_projectId: string) => {
      calls.getIndexMetadata++;
      return meta.hasIndex
        ? {
            projectId: "proj",
            projectPath: "/proj",
            lastIndexed: Date.now(),
            fileCount: 1,
            totalSize: 10,
            files: {},
          }
        : null;
    },
    isIndexStale: async (_projectId: string, _projectPath: string) => {
      calls.isIndexStale++;
      return meta.stale ?? { isStale: false };
    },
  };
  return { calls };
}

/** Bypass ensureInitialized() — it would re-resolve factories and overwrite indexManager. */
function markInitialized(search: ContextualSearchRLM) {
  (search as any).initialized = true;
}

function freshController(search: ContextualSearchRLM): SearchController {
  // Inject the mocked engine without going through the singleton.
  const controller = Object.create(SearchController.prototype) as SearchController;
  (controller as any).contextualSearch = search;
  return controller;
}

describe("search admission preflight (M10)", () => {
  test("Tier 1: unindexed project → success:false with /not indexed/, search NOT called", async () => {
    const search = createSearch();
    markInitialized(search);
    const { calls } = attachIndexManagerMock(search, { hasIndex: false });

    // Spy on search() to assert it is never reached.
    let searchReached = false;
    (search as any).search = async () => {
      searchReached = true;
      return [];
    };

    const controller = freshController(search);
    const tool = Object.create(SearchProjectTool.prototype) as SearchProjectTool;
    (tool as any).controller = controller;

    const response = await tool.handle({
      query: "anything",
      projectId: "proj",
      format: "json",
    });

    expect(response.success).toBe(false);
    expect((response as any).error).toMatch(/not indexed/);
    expect(searchReached).toBe(false);
    expect(calls.getIndexMetadata).toBe(1);
    // Tier 2 must not run when metadata is missing.
    expect(calls.isIndexStale).toBe(0);
  });

  test("Tier 1: search_code path also hard-fails on unindexed (parity)", async () => {
    const search = createSearch();
    markInitialized(search);
    attachIndexManagerMock(search, { hasIndex: false });

    let searchReached = false;
    (search as any).search = async () => {
      searchReached = true;
      return [];
    };

    const controller = freshController(search);
    const projectTool = Object.create(SearchProjectTool.prototype) as SearchProjectTool;
    (projectTool as any).controller = controller;

    const codeTool = Object.create(SearchCodeTool.prototype) as SearchCodeTool;
    (codeTool as any).searchProjectTool = projectTool;

    const response = await codeTool.handle({ query: "x", projectId: "proj" });

    expect(response.success).toBe(false);
    expect((response as any).error).toMatch(/not indexed/);
    expect(searchReached).toBe(false);
  });

  test("Tier 0: indexed + fresh + projectPath → search called, result unchanged, no warning", async () => {
    const search = createSearch();
    markInitialized(search);
    attachIndexManagerMock(search, { hasIndex: true, stale: { isStale: false } });

    let searchCalled = false;
    (search as any).search = async () => {
      searchCalled = true;
      return [
        {
          id: "hit-1",
          content: "fn foo() {}",
          score: 0.8,
          metadata: { filePath: "src/a.ts" },
        },
      ];
    };

    const controller = freshController(search);
    const result = await controller.searchProject({
      query: "foo",
      projectId: "proj",
      projectPath: "/proj",
    });

    expect(searchCalled).toBe(true);
    expect(result.warning).toBeUndefined();
    expect(result.stale).toBeUndefined();
    expect(result.results.length).toBe(1);
    expect(result.results[0].id).toBe("hit-1");
  });

  test("Tier 2: indexed + stale + projectPath → search STILL called, result carries warning + stale", async () => {
    const search = createSearch();
    markInitialized(search);
    const { calls } = attachIndexManagerMock(search, {
      hasIndex: true,
      stale: { isStale: true, reason: "files_changed" },
    });

    let searchCalled = false;
    (search as any).search = async () => {
      searchCalled = true;
      return [];
    };

    const controller = freshController(search);
    const result = await controller.searchProject({
      query: "foo",
      projectId: "proj",
      projectPath: "/proj",
    });

    expect(searchCalled).toBe(true);
    expect(calls.isIndexStale).toBe(1);
    expect(result.warning).toMatch(/stale/);
    expect(result.stale).toBeDefined();
    expect(result.stale?.reason).toBe("files_changed");
  });

  test("Tier 2 skip: indexed + no projectPath → search proceeds, no stale check, no warning", async () => {
    const search = createSearch();
    markInitialized(search);
    const { calls } = attachIndexManagerMock(search, {
      hasIndex: true,
      stale: { isStale: true, reason: "files_changed" },
    });

    let searchCalled = false;
    (search as any).search = async () => {
      searchCalled = true;
      return [];
    };

    const controller = freshController(search);
    const result = await controller.searchProject({
      query: "foo",
      projectId: "proj",
      // projectPath intentionally absent
    });

    expect(searchCalled).toBe(true);
    // No projectPath ⇒ stale check cannot run.
    expect(calls.isIndexStale).toBe(0);
    expect(result.warning).toBeUndefined();
    expect(result.stale).toBeUndefined();
  });
});
