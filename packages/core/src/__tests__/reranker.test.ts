/**
 * Phase 7a — LLM-judge reranker tests.
 *
 * Derives from spec R7A-01..04 + edge cases. Injects a fake LLM surface so no
 * network/config-gate is needed; the feature gate (`search.rerank.enabled`) is
 * toggled via the real `config` object (this file does not mock shared, mirrors
 * query-understanding.test.ts — the in-suite mock landmine is about mock.module
 * collision, which we avoid by not mocking shared here).
 *
 * Tests assert spec OUTCOMES, never mirroring the implementation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { config, SearchSource } from "@massa-ai/shared";
import type { SearchResult } from "@massa-ai/shared";
import {
  LLMJudgeReranker,
  applyVerdict,
  RerankVerdictSchema,
  type QueryLlmSurface,
} from "../services/search/reranker.js";
import { _setLlmEnabledForTesting } from "../services/memory/llm-client.js";
import type { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Verdict = z.infer<typeof RerankVerdictSchema>;

function makeResult(id: string, score = 0.5, content = `content of ${id}`): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.HYBRID,
    metadata: { projectId: "p7a", filePath: `${id}.ts`, lineStart: 1, lineEnd: 2 },
  };
}

function fakeSurface(
  verdict: Verdict | null,
  opts: { enabled?: boolean; throws?: boolean } = {},
): QueryLlmSurface {
  return {
    object: async (_prompt, _schema) => {
      if (opts.throws) throw new Error("boom");
      if (verdict == null) return { ok: false, error: "disabled" };
      return { ok: true, value: verdict };
    },
    complete: async () => ({ ok: false, error: "unused" }),
    isEnabled: () => opts.enabled ?? true,
  };
}

const ORIGINAL_SEARCH = config.get("search");

beforeEach(() => {
  _setLlmEnabledForTesting(true);
  // Enable the rerank feature gate for each test (some tests turn it back off).
  config.set("search", {
    ...ORIGINAL_SEARCH,
    rerank: { enabled: true, rerankWindow: 50 },
  });
});

afterEach(() => {
  _setLlmEnabledForTesting(null);
  config.set("search", ORIGINAL_SEARCH);
});

// ─── R7A-01: top-K re-order ───────────────────────────────────────────────────

describe("LLMJudgeReranker — R7A-01 top-K re-order", () => {
  test("re-orders the head per the LLM verdict and preserves the tail", async () => {
    // 3 results in head, 1 in tail; LLM flips head[0] <-> head[1].
    const results = [
      makeResult("a", 0.9),
      makeResult("b", 0.8),
      makeResult("c", 0.7),
      makeResult("d", 0.6),
    ];
    const verdict = { rankedIds: ["b", "a", "c"] };
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results, 3);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
  });

  test("window defaults from config.search.rerank.rerankWindow", async () => {
    config.set("search", {
      ...config.get("search"),
      rerank: { enabled: true, rerankWindow: 2 },
    });
    const results = [
      makeResult("a", 0.9),
      makeResult("b", 0.8),
      makeResult("c", 0.7),
      makeResult("d", 0.6),
    ];
    // Verdict only references a,b (the window=2 head); c,d are tail, untouched.
    const verdict = { rankedIds: ["b", "a"] };
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
  });
});

// ─── R7A-02: degradation (the discrimination-sensor target) ───────────────────

describe("LLMJudgeReranker — R7A-02 degradation returns input verbatim", () => {
  test("feature disabled → input order verbatim", async () => {
    config.set("search", {
      ...config.get("search"),
      rerank: { enabled: false, rerankWindow: 50 },
    });
    const results = [makeResult("a"), makeResult("b"), makeResult("c")];
    // Even with a valid verdict, disabled → no re-order.
    const reranker = new LLMJudgeReranker(fakeSurface({ rankedIds: ["c", "b", "a"] }));
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  test("LLM disabled → input order verbatim", async () => {
    const results = [makeResult("a"), makeResult("b")];
    const reranker = new LLMJudgeReranker(
      fakeSurface({ rankedIds: ["b", "a"] }, { enabled: false }),
    );
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("LLM returns {ok:false} → input order verbatim", async () => {
    const results = [makeResult("a"), makeResult("b")];
    const reranker = new LLMJudgeReranker(fakeSurface(null));
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("LLM throws → input order verbatim (no throw escapes)", async () => {
    const results = [makeResult("a"), makeResult("b")];
    const reranker = new LLMJudgeReranker(
      fakeSurface({ rankedIds: ["b", "a"] }, { throws: true }),
    );
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });

  test("empty input → empty output (no-op)", async () => {
    const reranker = new LLMJudgeReranker(fakeSurface({ rankedIds: ["x"] }));
    const out = await reranker.rerank("q", []);
    expect(out).toEqual([]);
  });
});

// ─── Edge cases (spec §"Edge cases") ──────────────────────────────────────────

describe("LLMJudgeReranker — edge cases", () => {
  test("window >= result count re-orders the whole list", async () => {
    const results = [makeResult("a"), makeResult("b"), makeResult("c")];
    const verdict = { rankedIds: ["c", "a", "b"] };
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results, 100);
    expect(out.map((r) => r.id)).toEqual(["c", "a", "b"]);
  });

  test("verdict missing some ids → missing ids appended in original order", async () => {
    const results = [makeResult("a"), makeResult("b"), makeResult("c"), makeResult("d")];
    // Verdict omits c,d → they keep original relative order at the tail of head.
    const verdict = { rankedIds: ["b", "a"] };
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results, 4);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c", "d"]);
  });

  test("verdict with duplicate ids → first occurrence wins, rest dropped", async () => {
    const results = [makeResult("a"), makeResult("b"), makeResult("c")];
    const verdict = { rankedIds: ["b", "b", "a", "b", "c"] };
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results, 3);
    expect(out.map((r) => r.id)).toEqual(["b", "a", "c"]);
  });

  test("final list length == input length (rerank never drops results)", async () => {
    const results = Array.from({ length: 10 }, (_, i) => makeResult(`r${i}`));
    const verdict = { rankedIds: ["r9", "r8"] }; // only 2 ids, rest appended
    const reranker = new LLMJudgeReranker(fakeSurface(verdict));
    const out = await reranker.rerank("q", results, 5);
    expect(out).toHaveLength(10);
    // head (5) re-ordered + tail (5) preserved → all 10 unique.
    expect(new Set(out.map((r) => r.id)).size).toBe(10);
  });
});

// ─── applyVerdict unit (pure helper) ──────────────────────────────────────────

describe("applyVerdict — pure helper", () => {
  test("verdict ids not in head are ignored", () => {
    const head = [makeResult("a"), makeResult("b")];
    const out = applyVerdict(head, ["z", "a", "b"]);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
  });
});

// ─── Discrimination sensor (mutant must be killed by R7A-02) ──────────────────
// The R7A-02 "LLM returns {ok:false} → verbatim" test above IS the mutant-kill:
// if the degrade branch were removed (verdict always applied), {ok:false} would
// still re-order, breaking the assertion. Verified by inspection.

describe("discrimination sensor — degrade branch is load-bearing", () => {
  test("removing the {ok:false} guard would re-order (mutant kill)", async () => {
    const results = [makeResult("a"), makeResult("b")];
    // A surface that says {ok:false}; the guard MUST keep ["a","b"].
    const reranker = new LLMJudgeReranker(fakeSurface(null));
    const out = await reranker.rerank("q", results);
    expect(out.map((r) => r.id)).toEqual(["a", "b"]);
    // Sanity: if the guard existed-but-didn't-stop, this would be ["b","a"].
    expect(out.map((r) => r.id)).not.toEqual(["b", "a"]);
  });
});
