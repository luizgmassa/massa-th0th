/**
 * Synapse Task Envelope tests (Wave 5 T21 / FR-14 / FR-25 / AD-W5-019).
 *
 * Validates:
 *  - begin() returns sessionId + search + primed on success.
 *  - Partial-failure contract (AD-W5-019): session always returned;
 *    partial=true + errors[] on sub-step failure; search may be null.
 *  - priming works when entries are provided.
 *  - search failure → partial=true, errors=["search"], search=null,
 *    session still exists and is usable.
 */

import { describe, expect, test } from "bun:test";
import { TaskEnvelopeService } from "../services/synapse/task-envelope.js";
import { getSessionRegistry, resetSessionRegistry } from "../services/synapse/session/index.js";
import type { SearchController } from "../controllers/search-controller.js";

function makeMockSearchController(opts: {
  results?: Array<{ id: string; filePath: string; score: number }>;
  shouldFail?: boolean;
}): SearchController {
  const results = opts.results ?? [{ id: "hit-1", filePath: "src/foo.ts", score: 0.9 }];
  const mock: any = {
    searchProject: async (input: any) => {
      if (opts.shouldFail) throw new Error("simulated search failure");
      return {
        query: input.query,
        projectId: input.projectId,
        responseMode: "summary",
        tokenSavings: "~70%",
        indexStatus: { wasStale: false, reindexed: false },
        recommendations: [],
        filters: { applied: false, include: [], exclude: [], totalResults: results.length, filteredResults: results.length },
        results: results.map((r) => ({ id: r.id, score: r.score, filePath: r.filePath, preview: `preview of ${r.filePath}` })),
        results_total: results.length,
        results_shown: results.length,
        results_omitted: 0,
      };
    },
  };
  return mock as SearchController;
}

describe("TaskEnvelopeService.begin (T21 / FR-14 / FR-25 / AD-W5-019)", () => {
  test("success: returns sessionId + search + primed", async () => {
    resetSessionRegistry();
    const ctrl = makeMockSearchController({});
    const service = new TaskEnvelopeService(ctrl);
    const result = await service.begin({
      agentId: "test-agent",
      query: "test query",
      projectId: "test-project",
      entries: [{ id: "mem-1", content: "recall content", score: 0.8 }],
    });
    expect(result.sessionId).toBeTruthy();
    expect(result.sessionId.startsWith("syn_")).toBe(true);
    expect(result.search).toBeTruthy();
    expect(result.partial).toBe(false);
    expect(result.errors).toEqual([]);
    expect(result.primed).toBe(1);
    const registry = getSessionRegistry();
    const session = registry.get(result.sessionId);
    expect(session).toBeTruthy();
    registry.delete(result.sessionId);
  });

  test("partial-failure: search fails → partial=true, errors includes search, search=null, session exists", async () => {
    resetSessionRegistry();
    const ctrl = makeMockSearchController({ shouldFail: true });
    const service = new TaskEnvelopeService(ctrl);
    const result = await service.begin({
      agentId: "test-agent",
      query: "test query",
      projectId: "test-project",
    });
    expect(result.sessionId).toBeTruthy();
    expect(result.partial).toBe(true);
    expect(result.errors).toContain("search");
    expect(result.search).toBeNull();
    const registry = getSessionRegistry();
    const session = registry.get(result.sessionId);
    expect(session).toBeTruthy();
    registry.delete(result.sessionId);
  });

  test("no entries → primed=0, search still works", async () => {
    resetSessionRegistry();
    const ctrl = makeMockSearchController({});
    const service = new TaskEnvelopeService(ctrl);
    const result = await service.begin({
      agentId: "test-agent",
      query: "test query",
      projectId: "test-project",
    });
    expect(result.primed).toBe(0);
    expect(result.search).toBeTruthy();
    expect(result.partial).toBe(false);
    const registry = getSessionRegistry();
    registry.delete(result.sessionId);
  });

  test("search with results → access recorded for first hit", async () => {
    resetSessionRegistry();
    const ctrl = makeMockSearchController({
      results: [
        { id: "hit-1", filePath: "src/foo.ts", score: 0.9 },
        { id: "hit-2", filePath: "src/bar.ts", score: 0.7 },
      ],
    });
    const service = new TaskEnvelopeService(ctrl);
    const result = await service.begin({
      agentId: "test-agent",
      query: "test query",
      projectId: "test-project",
    });
    expect(result.search).toBeTruthy();
    expect(result.partial).toBe(false);
    const registry = getSessionRegistry();
    const session = registry.get(result.sessionId);
    expect(session).toBeTruthy();
    expect(session!.accessHistory.has("hit-1")).toBe(true);
    registry.delete(result.sessionId);
  });
});