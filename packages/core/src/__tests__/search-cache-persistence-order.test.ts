import { describe, expect, test } from "bun:test";
import type { SearchResult } from "@massa-ai/shared";
import { SearchCachePg } from "../services/search/search-cache-pg.js";

const RESULT: SearchResult = {
  id: "result-1",
  content: "content",
  score: 0.9,
  source: "vector",
  metadata: { projectId: "project-1" },
};

describe("SearchCachePg mandatory persistence ordering", () => {
  test("failed upsert never installs a retry-visible L1 entry", async () => {
    const cache = new SearchCachePg() as any;
    let phase: "fail-write" | "empty-read" = "fail-write";
    let calls = 0;
    cache.pool = {
      query: async () => {
        calls += 1;
        if (phase === "fail-write") throw new Error("database unavailable");
        return { rows: [] };
      },
      end: async () => {},
    };

    await expect(
      cache.set("query", "project-1", [RESULT], { maxResults: 10 }),
    ).rejects.toThrow("database unavailable");

    phase = "empty-read";
    expect(
      await cache.get("query", "project-1", { maxResults: 10 }),
    ).toBeNull();
    expect(calls).toBe(2);
  });

  test("failed mandatory L2 access update never promotes the row to L1", async () => {
    const cache = new SearchCachePg() as any;
    let phase: "l2-read" | "empty-read" = "l2-read";
    let calls = 0;
    cache.pool = {
      query: async (sql: string) => {
        calls += 1;
        if (phase === "empty-read") return { rows: [] };
        if (sql.includes("SELECT * FROM search_cache")) {
          return {
            rows: [{
              key: "persisted-key",
              query: "query",
              project_id: "project-1",
              results: [RESULT],
              options: {},
              created_at: new Date(),
              access_count: 1,
              last_accessed: new Date(),
            }],
          };
        }
        throw new Error("access update unavailable");
      },
      end: async () => {},
    };

    await expect(
      cache.get("query", "project-1", { maxResults: 10 }),
    ).rejects.toThrow("access update unavailable");

    phase = "empty-read";
    expect(
      await cache.get("query", "project-1", { maxResults: 10 }),
    ).toBeNull();
    expect(calls).toBe(3);
  });
});
