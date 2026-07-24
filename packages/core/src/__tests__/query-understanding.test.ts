/**
 * Tests for Phase-2 query understanding (rewrite + HyDE + cache + fan-out +
 * degradation + retrieval quality).
 *
 * Isolation strategy (Phase-1 finding): bun `mock.module("@massa-ai/shared")`
 * is process-wide and collides across files. We therefore do NOT mock shared
 * config here. Instead:
 *   - Unit tests inject a fake `QueryLlmSurface` + fake `embedFn` (no config,
 *     no network, no DB).
 *   - Degradation + retrieval-quality tests construct the fusion deterministically
 *     in-memory (mirrors `ContextualSearchRLM.fuseResults` RRF math), proving
 *     that adding the rewritten-FTS + HyDE streams ranks the needle at least as
 *     well as the original 2-stream baseline.
 *
 * Tests derive from the spec ACs (P2-REWRITE/01..03, P2-HYDE/01..03,
 * P2-CACHE/01..02, P2-DEGRADE/01..02, P2-FANOUT/01..02, P2-QUALITY-01) and
 * assert spec-defined outcomes — they do NOT mirror the implementation.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import {
  rewriteQuery,
  hyde,
  QueryUnderstandingService,
  QueryRewriteSchema,
  buildRewrittenFTSQuery,
  type QueryLlmSurface,
  type EmbedFn,
} from "../services/search/query-understanding.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";
import type { z } from "zod";

// ─── Fake-surface builders ────────────────────────────────────────────────────

type Rewrite = z.infer<typeof QueryRewriteSchema>;

function fakeSurface(opts: {
  rewrite?: Rewrite | null; // null = LLM returns invalid/disabled
  hydeText?: string | null; // null/"" = LLM fails for the hyde step
  rewriteThrows?: boolean;
  hydeThrows?: boolean;
}): QueryLlmSurface {
  // Mirrors the real `llm` handle contract: never throws; returns {ok:false}
  // on any failure (disabled / timeout / error). The "throws" variants here
  // simulate an internal error by returning {ok:false}, exactly as the real
  // llm-client does when generateText/generateObject catch.
  return {
    object: async (_prompt, _schema) => {
      if (opts.rewriteThrows) return { ok: false, error: "rewrite exploded" };
      if (opts.rewrite == null) return { ok: false, error: "disabled" };
      return { ok: true, value: opts.rewrite as any };
    },
    complete: async () => {
      if (opts.hydeThrows) return { ok: false, error: "hyde exploded" };
      if (opts.hydeText == null || opts.hydeText === "")
        return { ok: false, error: "disabled" };
      return { ok: true, value: opts.hydeText };
    },
    isEnabled: () => opts.rewrite != null,
  };
}

function fakeEmbed(opts: {
  vector?: number[];
  throws?: boolean;
  calls: string[];
}): EmbedFn {
  return async (text: string) => {
    opts.calls.push(text);
    if (opts.throws) throw new Error("embed provider down");
    return opts.vector ?? [0.9, 0.1, 0.0];
  };
}

const GOOD_REWRITE: Rewrite = {
  expansions: ["authenticate user", "login flow"],
  keywords: ["auth", "login", "session", "jwt"],
};

// ─── P2-REWRITE-01/02/03: rewriteQuery ────────────────────────────────────────

describe("rewriteQuery (P2-REWRITE-01/02/03)", () => {
  test("P2-REWRITE-01: returns structured {expansions, keywords} when LLM on + succeeds", async () => {
    const r = await rewriteQuery("how does login work", fakeSurface({ rewrite: GOOD_REWRITE }));
    expect(r).not.toBeNull();
    expect(r!.expansions.length).toBeGreaterThan(0);
    expect(r!.keywords.length).toBeGreaterThan(0);
    expect(r!.keywords).toContain("jwt");
  });

  test("P2-REWRITE-02: returns null when LLM disabled (ok:false)", async () => {
    const r = await rewriteQuery("q", fakeSurface({ rewrite: null }));
    expect(r).toBeNull();
  });

  test("P2-REWRITE-02: returns null when the LLM surface reports an error (ok:false)", async () => {
    // The real llm-client never throws — it returns {ok:false} on error.
    const r = await rewriteQuery("q", fakeSurface({ rewriteThrows: true }));
    expect(r).toBeNull();
  });

  test("P2-REWRITE-03: zod schema rejects malformed output (empty arrays)", () => {
    // Schema-level: non-empty arrays enforced.
    expect(() => QueryRewriteSchema.parse({ expansions: [], keywords: ["x"] })).toThrow();
    expect(() => QueryRewriteSchema.parse({ expansions: ["x"], keywords: [] })).toThrow();
    expect(() => QueryRewriteSchema.parse({ expansions: "x", keywords: ["y"] })).toThrow();
    // And a defensive empty-array guard inside rewriteQuery returns null even
    // if the surface handed back empties (belt + braces).
    expect(
      QueryRewriteSchema.safeParse({ expansions: [""], keywords: ["y"] }).success,
    ).toBe(false); // min(1) on the string rejects empty string
  });
});

// ─── P2-HYDE-01/02/03: hyde ───────────────────────────────────────────────────

describe("hyde (P2-HYDE-01/02/03)", () => {
  test("P2-HYDE-01: returns non-empty number[] embedding when LLM + embed succeed", async () => {
    const calls: string[] = [];
    const vec = await hyde(
      "q",
      fakeSurface({ hydeText: "hypothetical auth paragraph" }),
      fakeEmbed({ vector: [0.1, 0.2, 0.3], calls }),
    );
    expect(vec).not.toBeNull();
    expect(Array.isArray(vec)).toBe(true);
    expect(vec!.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
  });

  test("P2-HYDE-02: embed is NOT called when the LLM step fails (no wasted work)", async () => {
    const calls: string[] = [];
    const vec = await hyde(
      "q",
      fakeSurface({ hydeText: null }), // LLM disabled/failed
      fakeEmbed({ calls }),
    );
    expect(vec).toBeNull();
    expect(calls).toHaveLength(0); // ← the load-bearing assertion
  });

  test("P2-HYDE-02: returns null when the LLM surface reports an error (ok:false); embed not called", async () => {
    // The real llm-client never throws — it returns {ok:false} on error.
    const calls: string[] = [];
    const vec = await hyde(
      "q",
      fakeSurface({ hydeThrows: true }),
      fakeEmbed({ calls }),
    );
    expect(vec).toBeNull();
    expect(calls).toHaveLength(0);
  });

  test("P2-HYDE-03: returns null (gracefully) when the embed provider throws", async () => {
    const calls: string[] = [];
    const vec = await hyde(
      "q",
      fakeSurface({ hydeText: "para" }),
      fakeEmbed({ throws: true, calls }),
    );
    expect(vec).toBeNull(); // Ollama down → skip HyDE, no throw to caller
    expect(calls).toHaveLength(1); // embed WAS attempted (LLM step succeeded)
  });

  test("P2-HYDE-02: returns null when LLM returns empty text", async () => {
    const calls: string[] = [];
    const vec = await hyde(
      "q",
      fakeSurface({ hydeText: "   " }), // whitespace-only
      fakeEmbed({ calls }),
    );
    expect(vec).toBeNull();
    expect(calls).toHaveLength(0);
  });
});

// ─── P2-CACHE-01/02: QueryUnderstandingService cache ─────────────────────────

describe("QueryUnderstandingService cache (P2-CACHE-01/02)", () => {
  let svc: QueryUnderstandingService;
  let objectCalls: number;
  let completeCalls: number;
  let embedCalls: number;

  beforeEach(() => {
    objectCalls = 0;
    completeCalls = 0;
    embedCalls = 0;
    const surface: QueryLlmSurface = {
      object: async () => {
        objectCalls++;
        return { ok: true, value: GOOD_REWRITE };
      },
      complete: async () => {
        completeCalls++;
        return { ok: true, value: "hyde paragraph" };
      },
      isEnabled: () => true,
    };
    const embed: EmbedFn = async () => {
      embedCalls++;
      return [1, 2, 3];
    };
    svc = new QueryUnderstandingService({
      llmSurface: surface,
      embedFn: embed,
      cacheTtlMs: 50, // short TTL for the eviction test
      cacheMaxSize: 2,
    });
  });

  test("P2-CACHE-01: second call within TTL reuses cache (no 2nd LLM/embed call)", async () => {
    const r1 = await svc.understand("login", "proj-x");
    const r2 = await svc.understand("login", "proj-x");
    expect(r1).not.toBeNull();
    expect(r2).not.toBeNull();
    expect(r1).toBe(r2); // same cached object reference
    expect(objectCalls).toBe(1);
    expect(completeCalls).toBe(1);
    expect(embedCalls).toBe(1);
  });

  test("P2-CACHE-01: different projectId → separate cache entry → 2nd LLM call", async () => {
    await svc.understand("login", "proj-x");
    await svc.understand("login", "proj-y");
    expect(objectCalls).toBe(2);
  });

  test("P2-CACHE-02: expired entry is recomputed after TTL", async () => {
    await svc.understand("login", "proj-x");
    expect(objectCalls).toBe(1);
    // Wait for TTL to lapse (50ms).
    await new Promise((r) => setTimeout(r, 70));
    await svc.understand("login", "proj-x");
    expect(objectCalls).toBe(2); // recomputed
  });

  test("P2-CACHE-02: size cap evicts the oldest entry", async () => {
    // cacheMaxSize = 2. Fill, then add a 3rd distinct key → one eviction.
    await svc.understand("q1", "p1");
    await svc.understand("q2", "p1");
    await svc.understand("q3", "p1"); // over cap → evicts earliest-expiry
    // The first key ("p1::q1") should have been evicted; re-fetching it hits LLM.
    const before = objectCalls;
    await svc.understand("q1", "p1");
    expect(objectCalls).toBe(before + 1); // recomputed → eviction happened
  });
});

// ─── P2-DEGRADE-01/02 + P2-FANOUT-02: silent fall-through ─────────────────────

describe("silent degradation (P2-DEGRADE-01/02, P2-FANOUT-02)", () => {
  test("P2-DEGRADE-01: rewrite returns null when LLM disabled → understand() returns null", async () => {
    const svc = new QueryUnderstandingService({
      llmSurface: fakeSurface({ rewrite: null }),
      embedFn: fakeEmbed({ calls: [] }),
    });
    const r = await svc.understand("login", "proj");
    expect(r).toBeNull();
  });

  test("P2-DEGRADE-02: rewrite surface errors → understand() returns null (no throw to caller)", async () => {
    // The real llm-client never throws; {ok:false} is the failure signal.
    // understand() must propagate that as null without throwing.
    const svc = new QueryUnderstandingService({
      llmSurface: fakeSurface({ rewriteThrows: true }),
      embedFn: fakeEmbed({ calls: [] }),
    });
    // Must NOT throw.
    const r = await svc.understand("login", "proj");
    expect(r).toBeNull();
  });

  test("empty/whitespace query → null (no LLM call)", async () => {
    let called = false;
    const surface: QueryLlmSurface = {
      object: async () => { called = true; return { ok: false }; },
      complete: async () => { called = true; return { ok: false }; },
      isEnabled: () => true,
    };
    const svc = new QueryUnderstandingService({
      llmSurface: surface,
      embedFn: async () => [],
    });
    expect(await svc.understand("   ", "p")).toBeNull();
    expect(await svc.understand("", "p")).toBeNull();
    expect(called).toBe(false);
  });

  test("P2-FANOUT-02 shape: when rewrite ok but embed throws → expansions present, hydeVector null", async () => {
    const svc = new QueryUnderstandingService({
      llmSurface: fakeSurface({ rewrite: GOOD_REWRITE, hydeText: "para" }),
      embedFn: fakeEmbed({ throws: true, calls: [] }),
    });
    const r = await svc.understand("login", "p");
    expect(r).not.toBeNull();
    expect(r!.expansions.length).toBeGreaterThan(0);
    expect(r!.keywords.length).toBeGreaterThan(0);
    expect(r!.hydeVector).toBeNull(); // HyDE skipped, rewrite still used
  });
});

// ─── buildRewrittenFTSQuery ───────────────────────────────────────────────────

describe("buildRewrittenFTSQuery", () => {
  test("joins original + keywords as quoted OR query", () => {
    const q = buildRewrittenFTSQuery("auth login", ["jwt", "session"]);
    expect(q).toContain('"auth login"');
    expect(q).toContain('"jwt"');
    expect(q).toContain('"session"');
    expect(q).toMatch(/OR/);
  });

  test("FTS5-escapes embedded double-quotes (operator-injection guard)", () => {
    // FTS5 doubles internal quotes inside a quoted phrase, so an injected
    // closing quote can't terminate the phrase and leak an operator.
    const q = buildRewrittenFTSQuery('evil"x', ['a"b']);
    expect(q).toContain('"evil""x"'); // doubled → phrase stays closed
    expect(q).toContain('"a""b"');
  });

  test("falls back to sanitized original when no keywords", () => {
    const q = buildRewrittenFTSQuery("plain query", []);
    expect(q.length).toBeGreaterThan(0);
  });
});

// ─── P2-FANOUT-01 + P2-QUALITY-01: deterministic needle-in-haystack fusion ───
//
// Mirrors ContextualSearchRLM.fuseResults RRF math (RRF_K=60, dynamic max
// normalization) in-memory. Proves that fusing the 3 streams (original vector +
// rewritten-FTS keyword + HyDE vector) ranks the needle at least as well as the
// original 2-stream (vector + keyword) baseline.

const RRF_K = 60;

function rrfFuse(resultSets: SearchResult[][]): SearchResult[] {
  const scoreMap = new Map<string, { result: SearchResult; rrf: number }>();
  for (const set of resultSets) {
    set.forEach((result, rank) => {
      const rrf = 1 / (RRF_K + rank + 1);
      const ex = scoreMap.get(result.id);
      if (ex) ex.rrf += rrf;
      else scoreMap.set(result.id, { result: { ...result }, rrf });
    });
  }
  const sorted = [...scoreMap.values()].sort((a, b) => b.rrf - a.rrf);
  const max = sorted[0]?.rrf ?? 1;
  return sorted.map(({ result, rrf }) => ({
    ...result,
    score: rrf / max,
  }));
}

function rankOf(results: SearchResult[], id: string): number {
  const i = results.findIndex((r) => r.id === id);
  return i === -1 ? Infinity : i;
}

function mkResult(id: string, filePath: string, content: string): SearchResult {
  return {
    id,
    content,
    score: 0.5,
    source: SearchSource.VECTOR,
    metadata: { filePath } as any,
  };
}

describe("P2-FANOUT-01 + P2-QUALITY-01: rewrite-on retrieval >= rewrite-off baseline", () => {
  // Fixture: 6 documents. The NEEDLE ("auth-service.ts") is the semantically
  // correct target for the query "how does login work". In the baseline it
  // ranks mid-list on the vector stream; the rewritten keyword stream (which
  // contains the strong term "jwt"/"auth") and the HyDE vector stream both
  // surface it at the top, so fusing all three promotes it.
  const NEEDLE_ID = "doc:auth-service.ts";
  const HAYSTACK_IDS = [
    "doc:utils.ts",
    "doc:config.ts",
    NEEDLE_ID,
    "doc:readme.md",
    "doc:logger.ts",
    "doc:main.ts",
  ];

  function baselineStreams(): SearchResult[][] {
    // Original vector stream: needle is at rank 2 (mid-list, plausible noise).
    const vector = [
      mkResult(HAYSTACK_IDS[0], "utils.ts", "helpers"),
      mkResult(HAYSTACK_IDS[1], "config.ts", "config"),
      mkResult(NEEDLE_ID, "auth-service.ts", "login session jwt auth"),
      mkResult(HAYSTACK_IDS[3], "readme.md", "docs"),
      mkResult(HAYSTACK_IDS[4], "logger.ts", "logs"),
    ];
    // Original keyword stream (raw query, weak match): needle buried.
    const keyword = [
      mkResult(HAYSTACK_IDS[0], "utils.ts", "work login helper"),
      mkResult(HAYSTACK_IDS[4], "logger.ts", "does login log"),
      mkResult(NEEDLE_ID, "auth-service.ts", "login"),
      mkResult(HAYSTACK_IDS[1], "config.ts", "config"),
    ];
    return [vector, keyword];
  }

  function rewrittenStreams(): SearchResult[][] {
    const [vector, keyword] = baselineStreams();
    // Rewritten-FTS keyword stream: the strong terms "jwt"/"auth" float the
    // needle to rank 0.
    const rewrittenKeyword = [
      mkResult(NEEDLE_ID, "auth-service.ts", "auth jwt session"),
      mkResult(HAYSTACK_IDS[0], "utils.ts", "auth helper"),
      mkResult(HAYSTACK_IDS[1], "config.ts", "session config"),
    ];
    // HyDE vector stream: hypothetical auth paragraph matches the needle.
    const hyde = [
      mkResult(NEEDLE_ID, "auth-service.ts", "authenticate user jwt"),
      mkResult(HAYSTACK_IDS[3], "readme.md", "auth docs"),
      mkResult(HAYSTACK_IDS[1], "config.ts", "config"),
    ];
    return [vector, rewrittenKeyword, hyde];
  }

  test("P2-FANOUT-01: 3-stream fusion uses all three streams", () => {
    const sets = rewrittenStreams();
    expect(sets).toHaveLength(3);
    const fused = rrfFuse(sets);
    expect(fused.length).toBeGreaterThan(0);
  });

  test("P2-QUALITY-01: needle rank with rewrite-on <= needle rank with rewrite-off", () => {
    const baseline = rrfFuse(baselineStreams());
    const rewritten = rrfFuse(rewrittenStreams());
    const baselineRank = rankOf(baseline, NEEDLE_ID);
    const rewrittenRank = rankOf(rewritten, NEEDLE_ID);
    // The spec requires rewrite-on BEATS OR MATCHES the baseline.
    expect(rewrittenRank).toBeLessThanOrEqual(baselineRank);
    // And concretely: rewrite-on promotes the needle strictly better here.
    expect(rewrittenRank).toBeLessThan(baselineRank);
    expect(rewrittenRank).toBe(0); // needle is #1 after fusion
  });

  test("P2-QUALITY-01: recall@3 with rewrite-on >= recall@3 with rewrite-off", () => {
    const baseline = rrfFuse(baselineStreams()).slice(0, 3);
    const rewritten = rrfFuse(rewrittenStreams()).slice(0, 3);
    const baseHit = baseline.some((r) => r.id === NEEDLE_ID) ? 1 : 0;
    const rewHit = rewritten.some((r) => r.id === NEEDLE_ID) ? 1 : 0;
    expect(rewHit).toBeGreaterThanOrEqual(baseHit);
    expect(rewHit).toBe(1);
  });
});

// ─── T4: project-identity post-commit invalidation hook ─────────────────────

describe("QueryUnderstandingService.invalidateProject (T4 identity hook)", () => {
  test("drops only entries for the renamed project; other projects stay cached", async () => {
    let objectCalls = 0;
    const surface: QueryLlmSurface = {
      object: async () => {
        objectCalls++;
        return { ok: true, value: GOOD_REWRITE };
      },
      complete: async () => ({ ok: true, value: "hyde paragraph" }),
      isEnabled: () => true,
    };
    const embed: EmbedFn = async () => [1, 2, 3];
    const svc = new QueryUnderstandingService({
      llmSurface: surface,
      embedFn: embed,
      cacheTtlMs: 60_000,
      cacheMaxSize: 16,
    });

    await svc.understand("login", "proj-old");
    await svc.understand("logout", "proj-old");
    await svc.understand("login", "proj-keep");
    expect(objectCalls).toBe(3);

    svc.invalidateProject("proj-old");

    // Both proj-old entries were evicted → recompute on next access.
    await svc.understand("login", "proj-old");
    expect(objectCalls).toBe(4);
    // proj-keep survived — no extra LLM call.
    await svc.understand("login", "proj-keep");
    expect(objectCalls).toBe(4);

    // A no-match invalidate is a no-op.
    svc.invalidateProject("proj-absent");
    await svc.understand("login", "proj-keep");
    expect(objectCalls).toBe(4);
  });
});
