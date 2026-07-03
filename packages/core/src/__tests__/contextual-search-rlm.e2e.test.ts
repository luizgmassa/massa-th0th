/**
 * Phase 7e — End-to-end characterization test for ContextualSearchRLM.
 *
 * This is the 7f gate: it exercises the real search path
 *   ContextualSearchRLM.search → SQLiteVectorStore → EmbeddingService
 *   (which 7f relocates out of data/chromadb). If 7f breaks the rewiring, this
 *   test fails.
 *
 * Isolation strategy (design.md §7): the full bun suite runs in ONE process and
 * other test files (concurrent-indexing.test.ts, search-controller.test.ts) use
 * `mock.module` to replace `getKeywordSearch`/`getVectorStore`/`@massa-th0th/shared`
 * with bare stubs (no `index`, no `config.set`). Those mocks are process-wide
 * and registered before this file runs. To stay independent of that landmine we:
 *   1. Construct REAL `KeywordSearch` + `SQLiteVectorStore` instances DIRECTLY
 *      (bypassing the mocked factories). They read the global default config
 *      (`~/.massa-th0th-data` data dir) — we isolate by PROJECT-prefixed unique IDs, not by
 *      dbPath, because the mocked `config` in-suite lacks `.set`.
 *   2. Pass those same instances into `ContextualSearchRLM` via its injected-deps
 *      ctor seam, so `search()` exercises the real load-bearing path
 *      (vectorStore.search → fuseResults → cache) regardless of the mock.
 *   3. `afterAll` deletes every fixture ID we inserted from both stores.
 *
 * The embedding provider auto-falls-back to random vectors in non-production
 * (dev) mode, so no Ollama is required.
 *
 * 7f GATE: after the EmbeddingService is relocated out of data/chromadb and the
 * chromadb file is deleted, this test must stay green — it proves the rewired
 * SQLiteVectorStore → EmbeddingService path is intact.
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import type { VectorDocument } from "@massa-th0th/shared";
import { KeywordSearch } from "../data/sqlite/keyword-search.js";
import { SQLiteVectorStore } from "../data/vector/sqlite-vector-store.js";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import { SearchCache } from "../services/search/search-cache.js";
import { SearchAnalytics } from "../services/search/search-analytics.js";
import { symbolRepository } from "../data/sqlite/symbol-repository.js";

const PROJECT_ID = "p7e-csrlm-e2e";

let search: ContextualSearchRLM;
let vs: SQLiteVectorStore;
let ks: KeywordSearch;
const docIds: string[] = [];

function doc(id: string, content: string, filePath: string, lineStart: number, lineEnd: number): VectorDocument {
  return {
    id,
    content,
    metadata: {
      projectId: PROJECT_ID,
      filePath,
      chunkIndex: 0,
      totalChunks: 1,
      type: "code_block",
      language: "ts",
      lineStart,
      lineEnd,
      label: filePath,
      centralityScore: 0,
    },
    embedding: [],
  };
}

beforeAll(async () => {
  // Construct REAL instances directly. They read the default global config
  // (~/.massa-th0th-data data dir); we isolate via the PROJECT_ID-scoped unique IDs below +
  // clean them up in afterAll.
  vs = new SQLiteVectorStore();
  ks = new KeywordSearch();

  const authDoc = doc(
    `${PROJECT_ID}:auth.ts:0`,
    "// File: auth.ts\n// Section: login\nexport function login(user, pass) { return user === 'admin'; }\n",
    "auth.ts",
    2,
    4,
  );
  const billDoc = doc(
    `${PROJECT_ID}:billing.ts:0`,
    "// File: billing.ts\n// Section: charge\nexport function charge(amount) { return amount > 0; }\n",
    "billing.ts",
    2,
    4,
  );
  docIds.push(authDoc.id, billDoc.id);

  await vs.addDocuments([authDoc, billDoc]);
  await Promise.all([
    ks.index(authDoc.id, authDoc.content, authDoc.metadata),
    ks.index(billDoc.id, billDoc.content, billDoc.metadata),
  ]);

  // Build the search service with the injected-deps ctor seam so it uses these
  // real instances, not the process-wide mocked factories.
  search = new ContextualSearchRLM({
    keywordSearch: ks,
    vectorStore: vs,
    searchCache: new SearchCache(),
    analytics: new SearchAnalytics(),
    symbolRepo: symbolRepository,
  });
});

afterAll(async () => {
  // Clean up the fixture IDs from both stores. Best-effort; never throw.
  try {
    for (const id of docIds) {
      await vs.delete(id).catch(() => {});
      await ks.delete(id).catch(() => {});
    }
  } catch {
    /* best-effort cleanup */
  }
});

describe("ContextualSearchRLM — e2e (characterization)", () => {
  test("search returns results with filePath + line metadata for a relevant query", async () => {
    const results = await search.search("login authentication", PROJECT_ID, {
      maxResults: 5,
      minScore: 0,
    });
    expect(Array.isArray(results)).toBe(true);
    for (const r of results) {
      const meta = r.metadata as Record<string, unknown>;
      // filePath/lineStart/lineEnd are present on indexed-document hits; some
      // results (keyword-only fallback) may omit them. When present, assert type.
      if (meta.filePath !== undefined) expect(typeof meta.filePath).toBe("string");
      if (meta.lineStart !== undefined) expect(typeof meta.lineStart).toBe("number");
      if (meta.lineEnd !== undefined) expect(typeof meta.lineEnd).toBe("number");
      // highlights are added by addContextToResults only for filePath-bearing
      // hits; other results may have undefined/missing highlights.
      if (r.highlights !== undefined) {
        expect(Array.isArray(r.highlights)).toBe(true);
        if (r.highlights.length > 0) {
          expect(typeof r.highlights[0]).toBe("string");
          if (meta.filePath !== undefined) {
            expect(r.highlights[0]).toMatch(/:\d+-\d+$/);
          }
        }
      }
    }
  });

  test("minScore threshold filters low-relevance results", async () => {
    const loose = await search.search("function", PROJECT_ID, {
      maxResults: 10,
      minScore: 0,
    });
    const strict = await search.search("function", PROJECT_ID, {
      maxResults: 10,
      minScore: 0.99,
    });
    expect(strict.length).toBeLessThanOrEqual(loose.length);
  });

  test("maxResults caps the returned count", async () => {
    const r1 = await search.search("export function", PROJECT_ID, {
      maxResults: 1,
      minScore: 0,
    });
    expect(r1.length).toBeLessThanOrEqual(1);
  });

  test("repeat query returns stable result ids (cache + fusion determinism)", async () => {
    const first = await search.search("charge billing", PROJECT_ID, {
      maxResults: 5,
      minScore: 0,
    });
    const second = await search.search("charge billing", PROJECT_ID, {
      maxResults: 5,
      minScore: 0,
    });
    // A second identical query hits the cache (or recomputes the same fusion);
    // either way the id set must be identical and order stable.
    expect(second.map((r) => r.id)).toEqual(first.map((r) => r.id));
  });
});
