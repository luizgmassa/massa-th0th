import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import type { SearchResult } from "@massa-th0th/shared";
import { SearchCache } from "../services/search/search-cache.js";
import { SearchCachePg } from "../services/search/search-cache-pg.js";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { closeConnections } from "../data/db-connection.js";

const databaseUrl = process.env.DATABASE_URL ?? "";
const DEDICATED_DB =
  process.env.MASSA_TH0TH_DEDICATED === "1"
  && /127\.0\.0\.1:5433\/massa_th0th_test(?:\?|$)/.test(databaseUrl);

const QUERY = "cache identity probe";
const BASE_OPTIONS = {
  maxResults: 10,
  minScore: 0.2,
  explainScores: false,
  includeFilters: ["src/**"],
  excludeFilters: ["**/*.test.ts"],
  retrievalWindow: "bounded-v1",
};
const RESULT: SearchResult[] = [{
  id: "cache-result",
  content: "cache identity probe",
  score: 0.8,
  metadata: { projectId: "cache-project", filePath: "src/cache.ts" },
}];

type CacheContract = {
  get(query: string, projectId: string, options?: Record<string, unknown>): Promise<SearchResult[] | null>;
  set(query: string, projectId: string, results: SearchResult[], options?: Record<string, unknown>): Promise<void>;
  invalidateProject(projectId: string): Promise<number>;
};

async function expectResultShapingOptionsDoNotCollide(
  cache: CacheContract,
  projectId: string,
): Promise<void> {
  await cache.set(QUERY, projectId, RESULT, BASE_OPTIONS);

  expect(await cache.get(QUERY, projectId, BASE_OPTIONS)).toEqual(RESULT);
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, minScore: 0.9 })).toBeNull();
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, explainScores: true })).toBeNull();
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, includeFilters: ["lib/**"] })).toBeNull();
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, excludeFilters: ["**/*.spec.ts"] })).toBeNull();
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, retrievalWindow: "legacy" })).toBeNull();

  // ContextualSearchRLM never consumes responseMode; SearchController formats
  // the returned raw results afterward. It is therefore result-invariant here.
  expect(await cache.get(QUERY, projectId, { ...BASE_OPTIONS, responseMode: "enriched" })).toEqual(RESULT);
}

describe("Search cache key — SQLite/PostgreSQL result-shaping parity", () => {
  const tempDir = mkdtempSync(path.join(tmpdir(), "th0th-search-cache-key-"));
  const sqlite = new SearchCache(path.join(tempDir, "search-cache.db"));

  afterAll(() => {
    sqlite.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  test("SQLite separates every RLM result-shaping option", async () => {
    await expectResultShapingOptionsDoNotCollide(sqlite, "cache-sqlite");
  });
});

describe.skipIf(!DEDICATED_DB)("Search cache key — dedicated PostgreSQL", () => {
  const pg = new SearchCachePg();
  const projectId = `cache-pg-${process.pid}-${Date.now()}`;

  beforeEach(async () => {
    await pg.invalidateProject(projectId);
  });

  afterAll(async () => {
    await pg.invalidateProject(projectId);
    await closeConnections();
  });

  test("PostgreSQL separates every RLM result-shaping option", async () => {
    await expectResultShapingOptionsDoNotCollide(pg, projectId);
  });
});

describe("ContextualSearchRLM cache option propagation", () => {
  test("forwards include/exclude filters using cache-normalized field names", async () => {
    const getCalls: Record<string, unknown>[] = [];
    const cacheHit: SearchResult[] = [{
      ...RESULT[0]!,
      metadata: { ...RESULT[0]!.metadata, projectId: "cache-propagation" },
    }];
    const search = new ContextualSearchRLM({
      searchCache: {
        get: async (_query: string, _projectId: string, options: Record<string, unknown>) => {
          getCalls.push(options);
          return cacheHit;
        },
      } as any,
      keywordSearch: {} as any,
      vectorStore: {} as any,
      analytics: { trackSearch: () => {} } as any,
      symbolRepo: {} as any,
    });

    const results = await search.search(QUERY, "cache-propagation", {
      maxResults: 7,
      minScore: 0.4,
      explainScores: true,
      includeFilters: ["src/**"],
      excludeFilters: ["**/*.test.ts"],
    });

    expect(results).toEqual(cacheHit);
    expect(getCalls).toEqual([{
      maxResults: 7,
      minScore: 0.4,
      explainScores: true,
      includeFilters: ["src/**"],
      excludeFilters: ["**/*.test.ts"],
      retrievalWindow: "bounded-v1",
    }]);
  });
});
