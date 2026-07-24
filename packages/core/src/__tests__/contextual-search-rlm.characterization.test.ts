/**
 * ContextualSearchRLM — characterization tests (M14 Phase 2, T2.1)
 *
 * Purpose: pin observable behavior of the god-class BEFORE the Phase 3
 * facade split so any drift is caught. These tests are mutation-killing
 * anchors — each assertion is hand-computed against the live RRF formula
 * (RRF_K=60) and mutex semantics.
 *
 * Two seams are exercised (see design.md "Reachability model"):
 *   - injected-deps constructor: reaches `search()` end-to-end and the
 *     `indexProject` mutex path.
 *   - `(inst as any).method()` cast: reaches private pure helpers
 *     (`fuseResults`, `calculateAvgScore`, `extractPreview`, `filterByPatterns`).
 *     Precedented — `concurrent-indexing.test.ts` and
 *     `search-ranking-regression.test.ts` already cast.
 *
 * Discrimination spot-check (run before reporting): flip one expected rank
 * in the RRF + search anchors and remove the throw in the mutex-throw anchor;
 * each must FAIL. See commit message.
 */

import { describe, test, expect, beforeEach, mock, afterEach } from "bun:test";
import { SearchSource, type SearchResult } from "@massa-ai/shared";
import { describeNative } from "./_helpers/native-skip.js";
import {
  resetParserReadinessForTests,
} from "../services/structural/parser-readiness.js";
import { LANGUAGE_MANIFEST } from "../services/structural/language-manifest.js";
import { grammarArtifactKey } from "../services/structural/grammar-loaders.js";

// ── Restore any stale mocks from other test files (shared module registry) ───
mock.restore();

// ── Mock heavy infrastructure so we can import the class cleanly ─────────────
// Same set as concurrent-indexing.test.ts: keep the module registry clean so
// importing RLM here doesn't contaminate other test files. vector-store-factory
// is intentionally NOT mocked (ensureInitialized is replaced via injected deps).
mock.module("../data/keyword/keyword-search-factory.js", () => ({
  getKeywordSearch: mock(async () => ({})),
}));
mock.module("../services/search/cache-factory.js", () => ({
  getSearchCache: mock(async () => ({})),
}));
mock.module("../services/search/analytics-factory.js", () => ({
  getSearchAnalytics: mock(async () => ({})),
}));
mock.module("../data/symbol/symbol-repository-factory.js", () => ({
  getSymbolRepository: mock(async () => ({})),
}));
mock.module("../services/search/index-manager.js", () => ({
  IndexManager: class MockIndexManager {},
}));
mock.module("../services/search/ignore-patterns.js", () => ({
  loadProjectIgnore: mock(() => null),
}));
mock.module("../services/search/file-filter-cache.js", () => ({
  FileFilterCache: class MockFileFilterCache {
    shouldInclude() { return true; }
    clear() {}
    invalidateProject() {}
  },
}));
mock.module("@massa-ai/shared", () => {
  const actual = require("@massa-ai/shared");
  return {
    ...actual,
    logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
    config: {
      get: () => ({
        queryUnderstanding: { enabled: false },
        // Other props left undefined; search() only reads queryUnderstanding.
      }),
    },
    estimateTokens: (s: string) => Math.ceil(s.length / 4),
  };
});

import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

const RRF_K = 60;

function result(
  id: string,
  score: number,
  source: SearchSource = SearchSource.HYBRID,
): SearchResult {
  return {
    id,
    content: `${id} content`,
    score,
    source,
    metadata: { projectId: "char-test", filePath: `${id}.ts` },
  };
}

/** Controlled async task — resolves when `release()` is called. */
function makeGate(): { gate: Promise<void>; release: () => void } {
  let release!: () => void;
  const gate = new Promise<void>((r) => { release = r; });
  return { gate, release };
}

/** Delay for N ms (tiny pauses to let microtask queue flush). */
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/**
 * Stub grammar loader that satisfies `assertParserReadyForIndexing()` without
 * touching the real native tree-sitter artifacts. Used by the mutex tests to
 * neutralize parser-readiness contamination left by other test files that
 * share the same Bun process (e.g. indexing-readiness-guard.test.ts puts
 * readiness into a FAILED state and only resets it to PENDING in afterAll).
 *
 * The fake Parser.parse() returns a rootNode whose endIndex matches the
 * fixture byte length (so the readiness validator accepts it) and hasError
 * stays false.
 */
function makeStubGrammarSet(): {
  Parser: new () => {
    setLanguage(_lang: unknown): void;
    parse(source: string): {
      rootNode: { hasError: boolean; endIndex: number; type: string };
      delete(): void;
    };
  };
  grammars: Map<string, unknown>;
} {
  const grammars = new Map<string, unknown>();
  for (const entry of LANGUAGE_MANIFEST) {
    grammars.set(grammarArtifactKey(entry.grammarArtifact), { lang: entry.extension });
  }
  class StubParser {
    setLanguage(_lang: unknown): void {}
    parse(source: string) {
      return {
        rootNode: {
          hasError: false,
          endIndex: Buffer.byteLength(source, "utf8"),
          type: "program",
        },
        delete() {},
      };
    }
  }
  return { Parser: StubParser as any, grammars };
}

/**
 * Hand-computed RRF ordering for the fixed anchor scenario used by both the
 * direct `fuseResults` test and the `search()` end-to-end test.
 *
 * Input (plain natural-language query → KEYWORD_BOOST = 1.0):
 *   vector  = [V1, V2]                       (scores 0.9, 0.7)
 *   keyword = [V2, K1]                       (scores 0.6, 0.5)
 *
 * resultSets index 0 = vector stream (boost 1.0), index 1 = lexical
 * (boost KEYWORD_BOOST = 1.0 for a non-code query).
 *
 * rrf contribution per appearance = 1 / (RRF_K + rank + 1)
 *
 *   V1: vector rank 0 → 1/61 = 0.016393...
 *   V2: vector rank 1 (1/62 = 0.016129) + lexical rank 0 (1/61 = 0.016393)
 *       = 0.032522...
 *   K1: lexical rank 1 → 1/62 = 0.016129
 *
 * Sort desc: V2 (0.032522) > V1 (0.016393) > K1 (0.016129).
 */
const ANCHOR_EXPECTED_ORDER = ["V2", "V1", "K1"];
const anchorVector = [result("V1", 0.9), result("V2", 0.7)];
const anchorKeyword = [result("V2", 0.6), result("K1", 0.5)];

// ── Reset static locks between tests ─────────────────────────────────────────
beforeEach(() => {
  (ContextualSearchRLM as any).indexingLocks = new Map();
});

afterEach(() => {
  (ContextualSearchRLM as any).indexingLocks = new Map();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("ContextualSearchRLM — characterization (pre-split pins)", () => {
  // ── Item 1: RRF fusion (direct cast seam) ──────────────────────────────────
  describe("RRF fusion — fuseResults", () => {
    test("hand-computed fused order matches rrfScore desc", () => {
      const inst = new ContextualSearchRLM();
      // Plain natural-language query → isCodeQuery=false → KEYWORD_BOOST=1.0.
      // V2 appears in both streams and must win; V1 (rank-0 vector) beats K1
      // (rank-1 keyword) by 1/61 vs 1/62.
      const fused = (inst as any).fuseResults.call(
        inst,
        [anchorVector, anchorKeyword],
        "natural language query",
        false,
      ) as SearchResult[];

      expect(fused.map((r) => r.id)).toEqual(ANCHOR_EXPECTED_ORDER);
    });

    test("rank-1 from either source wins over rank-2 from the other (symmetry)", () => {
      // Vector-only rank-0 (1/61) must beat keyword-only rank-1 (1/62).
      const inst = new ContextualSearchRLM();
      const fused = (inst as any).fuseResults.call(
        inst,
        [[result("only-vec", 0.9)], [result("only-kw", 0.9)]],
        "natural language query",
        false,
      ) as SearchResult[];

      // 1/61 > 1/62 → only-vec first.
      expect(fused.map((r) => r.id)).toEqual(["only-vec", "only-kw"]);
    });

    test("RRF_K=60 constant anchors the divisor (1/(K+rank+1))", () => {
      // Pin the constant: with K=60, two rank-0 hits from two streams each
      // contribute 1/61 = ~0.016393. The fused top rrfScore for a double-hit
      // at rank 0/0 is exactly 2/61.
      expect(RRF_K).toBe(60);
      const inst = new ContextualSearchRLM();
      const fused = (inst as any).fuseResults.call(
        inst,
        [
          [result("X", 1.0)],
          [result("X", 1.0)],
        ],
        "natural language query",
        true, // generate explanation to read raw rrfScore
      ) as SearchResult[];

      expect(fused).toHaveLength(1);
      // The top result is normalized to score 1.0 (dynamic normalization divides
      // by maxRrfScore, which is its own score for the only entry).
      expect(fused[0].score).toBeCloseTo(1.0, 6);
      // Explanation carries the raw rrfScore = 2/61.
      expect(fused[0].explanation.rrfScore).toBeCloseTo(2 / 61, 6);
    });
  });

  // ── Item 2: search() end-to-end (injected-deps seam) ───────────────────────
  describe("search() end-to-end — RRF ordering via injected-deps", () => {
    function makeSearchInstance(stubVector: SearchResult[], stubKeyword: SearchResult[]) {
      // Inject keyword + vector + cache + analytics stubs. ensureInitialized
      // wires them onto the instance without touching factories.
      const vectorStore = {
        search: async () => stubVector,
        searchByEmbedding: async () => [] as SearchResult[],
        deleteByProject: async () => 0,
        getStats: async () => ({ totalDocuments: 0, totalSize: 0 }),
      };
      const keywordSearch = {
        searchWithFilter: async () => stubKeyword,
        // No trigram / fuzzyCorrect → search() skips those streams.
        deleteByProject: async () => 0,
      };
      const searchCache = {
        get: async () => null, // force miss → real fusion path
        set: async () => undefined,
        invalidateProject: async () => undefined,
      };
      const analytics = { trackSearch: () => undefined };
      // symbolRepo is needed by ensureInitialized; buildGraphStream stays [].
      const symbolRepo = {};
      return new ContextualSearchRLM({
        // @ts-expect-error — stubs intentionally partial for characterization
        keywordSearch,
        // @ts-expect-error
        vectorStore,
        // @ts-expect-error
        searchCache,
        // @ts-expect-error
        analytics,
        // @ts-expect-error
        symbolRepo,
      });
    }

    test("final search() ordering matches hand-computed RRF (primary anchor)", async () => {
      const inst = makeSearchInstance(anchorVector, anchorKeyword);
      const results = await inst.search("natural language query", "char-test", {
        maxResults: 10,
        minScore: 0, // pass everything through; we care about order, not gating
      });

      expect(results.map((r) => r.id)).toEqual(ANCHOR_EXPECTED_ORDER);
    });

    test("maxResults bounds the final slice", async () => {
      const inst = makeSearchInstance(anchorVector, anchorKeyword);
      const results = await inst.search("natural language query", "char-test", {
        maxResults: 1,
        minScore: 0,
      });
      // Only the top fused result is returned.
      expect(results.map((r) => r.id)).toEqual(["V2"]);
    });
  });

  // ── Item 3: calculateAvgScore (direct cast seam) ───────────────────────────
  describe("calculateAvgScore — boundary + mean", () => {
    test("empty array returns 0 (not NaN)", () => {
      const inst = new ContextualSearchRLM();
      const avg = (inst as any).calculateAvgScore.call(inst, []);
      expect(avg).toBe(0);
      expect(Number.isNaN(avg)).toBe(false);
    });

    test("non-empty array returns arithmetic mean of scores", () => {
      const inst = new ContextualSearchRLM();
      const input = [
        result("a", 0.2),
        result("b", 0.4),
        result("c", 0.6),
      ];
      const avg = (inst as any).calculateAvgScore.call(inst, input);
      expect(avg).toBeCloseTo((0.2 + 0.4 + 0.6) / 3, 10);
    });

    test("single-element array returns that element's score", () => {
      const inst = new ContextualSearchRLM();
      const avg = (inst as any).calculateAvgScore.call(inst, [result("solo", 0.73)]);
      expect(avg).toBeCloseTo(0.73, 10);
    });
  });

  // ── Item 4: extractPreview (direct cast seam) ──────────────────────────────
  describe("extractPreview — clamping + default maxLines=5", () => {
    test("default maxLines=5 and appends ellipsis when content is longer", () => {
      const inst = new ContextualSearchRLM();
      const content = ["L1", "L2", "L3", "L4", "L5", "L6", "L7"].join("\n");
      const preview = (inst as any).extractPreview.call(inst, content);
      // First 5 lines joined, with trailing "..." because there were more.
      expect(preview).toBe(["L1", "L2", "L3", "L4", "L5"].join("\n") + "\n...");
    });

    test("content exactly maxLines long returns content unchanged (no ellipsis)", () => {
      const inst = new ContextualSearchRLM();
      const content = ["L1", "L2", "L3", "L4", "L5"].join("\n");
      const preview = (inst as any).extractPreview.call(inst, content);
      expect(preview).toBe(content);
    });

    test("short content (fewer than maxLines) is returned verbatim", () => {
      const inst = new ContextualSearchRLM();
      const content = "only one line";
      const preview = (inst as any).extractPreview.call(inst, content);
      expect(preview).toBe("only one line");
    });

    test("explicit maxLines override clamps accordingly", () => {
      const inst = new ContextualSearchRLM();
      const content = ["A", "B", "C", "D"].join("\n");
      const preview = (inst as any).extractPreview.call(inst, content, 2);
      expect(preview).toBe("A\nB\n...");
    });
  });

  // ── Item 5: filterByPatterns (direct cast seam) ────────────────────────────
  describe("filterByPatterns — include/exclude glob behavior", () => {
    function fileResult(id: string, filePath: string): SearchResult {
      return {
        id,
        content: id,
        score: 0.5,
        source: SearchSource.HYBRID,
        metadata: { filePath, projectId: "char-test" },
      };
    }

    test("no include/exclude returns input untouched", () => {
      const inst = new ContextualSearchRLM();
      const input = [fileResult("a", "src/a.ts")];
      const out = (inst as any).filterByPatterns.call(inst, input);
      expect(out).toBe(input);
    });

    test("include whitelist keeps only matching paths", () => {
      const inst = new ContextualSearchRLM();
      const input = [
        fileResult("a", "src/a.ts"),
        fileResult("b", "test/b.test.ts"),
        fileResult("c", "src/c.ts"),
      ];
      const out = (inst as any).filterByPatterns.call(inst, input, ["src/*.ts"]);
      expect(out.map((r) => r.id)).toEqual(["a", "c"]);
    });

    test("exclude blacklist drops matching paths", () => {
      const inst = new ContextualSearchRLM();
      const input = [
        fileResult("a", "src/a.ts"),
        fileResult("b", "test/b.test.ts"),
        fileResult("c", "dist/c.ts"),
      ];
      const out = (inst as any).filterByPatterns.call(
        inst,
        input,
        undefined,
        ["test/*", "dist/*"],
      );
      expect(out.map((r) => r.id)).toEqual(["a"]);
    });

    test("exclude takes precedence over include", () => {
      const inst = new ContextualSearchRLM();
      const input = [
        fileResult("a", "src/secret.ts"),   // matches include AND exclude → dropped
        fileResult("b", "src/b.ts"),         // matches include only → kept
      ];
      const out = (inst as any).filterByPatterns.call(
        inst,
        input,
        ["src/*.ts"],
        ["**/secret.ts"],
      );
      expect(out.map((r) => r.id)).toEqual(["b"]);
    });

    test("result without filePath is dropped when include is set, kept otherwise", () => {
      const inst = new ContextualSearchRLM();
      const noPath = {
        id: "no-path",
        content: "x",
        score: 0.5,
        source: SearchSource.HYBRID,
        metadata: {},
      } as SearchResult;
      const input = [noPath];

      // include set, no filePath → !include?.length === false → dropped.
      const withInclude = (inst as any).filterByPatterns.call(inst, input, ["**/*.ts"]);
      expect(withInclude).toHaveLength(0);

      // exclude only, no filePath → !include?.length === true (include is undefined)
      //   → no exclude match → kept.
      const withExcludeOnly = (inst as any).filterByPatterns.call(
        inst,
        input,
        undefined,
        ["x/*"],
      );
      expect(withExcludeOnly.map((r) => r.id)).toEqual(["no-path"]);
    });
  });

  // ── Item 6: Mutex ordering (injected-deps + cast, mirror concurrent-indexing) ─
  //
  // Gated on the native tree-sitter target via `describeNative`, matching
  // concurrent-indexing.test.ts: `indexProject` calls
  // `assertParserReadyForIndexing()` before acquiring the mutex, and that
  // assertion only succeeds where the real native grammars load. Mocking
  // parser-readiness globally would contaminate the shared module registry
  // and break indexing-readiness-guard.test.ts in the same process, so we
  // follow the established convention instead.
  describeNative("mutex ordering — runWithIndexLock try/finally", () => {
    // `indexProject` calls `assertParserReadyForIndexing()` before acquiring
    // the mutex. Other test files in the same Bun process (notably
    // indexing-readiness-guard.test.ts) leave parser readiness in a FAILED /
    // PENDING state. Install a stub loader so validation succeeds here without
    // the slow native grammar load, then restore the production loader on exit.
    beforeEach(() => {
      resetParserReadinessForTests(async () => makeStubGrammarSet());
    });
    afterEach(() => {
      resetParserReadinessForTests();
    });

    function makeInstance(): ContextualSearchRLM {
      const inst = new ContextualSearchRLM();
      // Skip real infrastructure init (same as concurrent-indexing.test.ts).
      (inst as any).ensureInitialized = async () => {
        (inst as any).initialized = true;
      };
      return inst;
    }

    test("same projectId: two concurrent calls serialize (2nd starts after 1st releases)", async () => {
      const inst = makeInstance();
      const { gate, release } = makeGate();
      const order: string[] = [];
      let callCount = 0;

      (inst as any)._indexProjectInternal = async () => {
        callCount++;
        const n = callCount;
        order.push(`start:${n}`);
        if (n === 1) await gate;
        order.push(`end:${n}`);
        return { filesIndexed: 1, chunksIndexed: 1, errors: 0 };
      };

      const p1 = inst.indexProject("/tmp/proj", "proj-char-a");
      const p2 = inst.indexProject("/tmp/proj", "proj-char-a");

      await delay(10);
      // Only the first call has started; second is queued behind it.
      expect(order).toEqual(["start:1"]);

      release();
      await Promise.all([p1, p2]);

      expect(order).toEqual(["start:1", "end:1", "start:2", "end:2"]);
    });

    test("different projectIds run concurrently (no serialization)", async () => {
      const inst = makeInstance();
      const { gate, release } = makeGate();
      const order: string[] = [];

      (inst as any)._indexProjectInternal = async (_p: string, id: string) => {
        order.push(`start:${id}`);
        if (id === "proj-char-x") await gate;
        order.push(`end:${id}`);
        return { filesIndexed: 1, chunksIndexed: 1, errors: 0 };
      };

      const pX = inst.indexProject("/tmp/proj", "proj-char-x");
      const pY = inst.indexProject("/tmp/proj", "proj-char-y");

      await delay(10);
      // proj-y has no contention → finishes without waiting.
      expect(order).toContain("start:proj-char-x");
      expect(order).toContain("start:proj-char-y");
      expect(order).toContain("end:proj-char-y");
      expect(order).not.toContain("end:proj-char-x");

      release();
      await Promise.all([pX, pY]);
    });

    test("lock map cleared after completion", async () => {
      const inst = makeInstance();
      (inst as any)._indexProjectInternal = async () => ({
        filesIndexed: 1,
        chunksIndexed: 1,
        errors: 0,
      });

      await inst.indexProject("/tmp/proj", "proj-char-clear");

      expect((ContextualSearchRLM as any).indexingLocks.has("proj-char-clear"))
        .toBe(false);
    });

    test("DISCRIMINATION ANCHOR — lock released even if _indexProjectInternal throws", async () => {
      // This is the highest-risk Phase 3 seam: runWithIndexLock's try/finally
      // must run delete-if-still-owner + releaseLock() even when work throws.
      // A refactor that linearizes without finally would leak the lock and fail here.
      const inst = makeInstance();
      const order: string[] = [];
      let callCount = 0;

      (inst as any)._indexProjectInternal = async () => {
        callCount++;
        if (callCount === 1) {
          order.push("throw");
          throw new Error("indexing failed");
        }
        order.push("success");
        return { filesIndexed: 1, chunksIndexed: 1, errors: 0 };
      };

      // p1 throws; p2 must still run AND the lock map must be clean afterward.
      const p1 = inst.indexProject("/tmp/proj", "proj-char-throw").catch(() => "error");
      const p2 = inst.indexProject("/tmp/proj", "proj-char-throw");

      const [r1, r2] = await Promise.all([p1, p2]);

      expect(r1).toBe("error");
      expect(r2).toMatchObject({ filesIndexed: 1 });
      expect(order).toEqual(["throw", "success"]);
      // Lock map cleaned up despite the throw — this is the crux of the try/finally.
      expect((ContextualSearchRLM as any).indexingLocks.has("proj-char-throw"))
        .toBe(false);
    });
  });
});
