/**
 * Gated LLM-judge benchmark test (qwen2.5 swap non-regression).
 *
 * This is NOT a pass/fail unit test by default — it skips cleanly when Ollama
 * is unreachable so the unit batch stays 0-fail with Ollama DOWN. When Ollama
 * IS up, it drives the REAL local LLM (qwen2.5:7b-instruct + coder) through a
 * SMALL subset of the consolidator / salience / reranker judge paths and
 * asserts non-regression against committed threshold floors.
 *
 * Recorded baseline (2026-07-12, qwen2.5:7b-instruct + qwen2.5-coder:7b, full
 * fixtures via benchmarks/llm-judge/run.ts --label baseline):
 *   consolidator merge: precision 1.000, recall 0.500, F1 0.667, accuracy 0.800
 *   salience consistency: 0.500 (meanSpread 0.375)
 *   reranker hit@1: 0.667
 *
 * Floors are set conservatively BELOW the observed baseline to tolerate
 * sampling noise (temperature 0.2), not to catch every dip. A model/prompt
 * change that drops below a floor is a regression worth investigating.
 *
 * Run the full harness + scorer for the authoritative numbers:
 *   bun benchmarks/llm-judge/run.ts --label <name>
 *   bun benchmarks/llm-judge/scorer.ts --dup ... --distinct ... --results ...
 */

import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import { z } from "zod";
import { config, SearchSource } from "@massa-th0th/shared";
import type { SearchResult } from "@massa-th0th/shared";
import { llmObject, isLlmEnabled } from "../services/memory/llm-client.js";
import { LLMJudgeReranker } from "../services/search/reranker.js";
import { SalienceJudge } from "../services/memory/salience-judge.js";
import { _setLlmEnabledForTesting } from "../services/memory/llm-client.js";

// ─── Committed non-regression floors (calibrated from the 2026-07-12 baseline) ─
const FLOOR_MERGE_PRECISION = 0.6; // baseline 1.000
const FLOOR_MERGE_RECALL = 0.4; // baseline 0.500
const FLOOR_RERANK_HIT1 = 0.5; // baseline 0.667
const FLOOR_SALIENCE_CONSISTENCY = 0.4; // baseline 0.500

// ─── Ollama probe (skip cleanly when down) ────────────────────────────────────
// Override the probe URL via `LLM_JUDGE_PROBE_URL` to simulate Ollama being
// down (e.g. point at a dead port) without actually stopping the service.
const OLLAMA_TAG_URL =
  process.env.LLM_JUDGE_PROBE_URL ?? "http://localhost:11434/api/tags";

async function ollamaUp(): Promise<boolean> {
  try {
    const r = await fetch(OLLAMA_TAG_URL, { signal: AbortSignal.timeout(3000) });
    if (!r.ok) return false;
    const json = (await r.json()) as { models?: Array<{ name: string }> };
    const names = (json.models ?? []).map((m) => m.name);
    // Need at least the instruct model to run the probes.
    return names.includes("qwen2.5:7b-instruct");
  } catch {
    return false;
  }
}

const OLLAMA_UP = await ollamaUp();

// ─── Small in-process benchmark subset ────────────────────────────────────────

const DupVerdictSchema = z.object({
  areDuplicates: z.boolean(),
  rationale: z.string().optional(),
});

async function probeMerge(contents: string[]): Promise<boolean> {
  const prompt = [
    "You are judging whether memory entries are semantic duplicates of each other.",
    "Entries are duplicates if they encode the SAME underlying fact/decision/pattern,",
    "even when worded differently. Entries that share keywords but encode different",
    "facts are NOT duplicates. Entries that contradict each other are NOT duplicates.",
    "Return ONLY a JSON object {\"areDuplicates\": boolean}.",
    "",
    "Entries:",
    ...contents.map((c, i) => `[${i}] ${c}`),
  ].join("\n");
  const res = await llmObject(prompt, DupVerdictSchema, { modelRole: "instruct" });
  return res.ok && res.value ? !!res.value.areDuplicates : false;
}

// Two true dup-groups (expect merge) + two distinct pairs (expect distinct).
const DUP_GROUPS: Array<{ id: string; contents: string[] }> = [
  {
    id: "G1-llm-model-swap",
    contents: [
      "Swapped the default LLM from qwen3.5:9b to qwen2.5:7b-instruct because the thinking model degraded structured calls.",
      "The model default is now qwen2.5:7b-instruct; the old qwen3.5:9b thinking model caused empty content channels on generateObject.",
    ],
  },
  {
    id: "G2-file-cache-lru",
    contents: [
      "The read_file fileCache was unbounded; capped it at 512 entries with LRU promotion on get.",
      "Added a 512-entry LRU cap to the read_file tool's fileCache, mirroring web-controller's pattern.",
    ],
  },
];

const DISTINCT_PAIRS: Array<{ id: string; contents: [string, string] }> = [
  {
    id: "P1-same-keyword-different-fact",
    contents: [
      "Capped the read_file fileCache at 512 entries with LRU promotion to bound memory.",
      "The web-controller dedupes concurrent identical requests via an LRU request cache keyed by URL.",
    ],
  },
  {
    id: "P2-same-component-different-concern",
    contents: [
      "Made restoreCheckpoint async so the PG store can run a real SELECT for existing memory ids.",
      "AutoCheckpointer triggers createCheckpoint after every N observations during indexing.",
    ],
  },
];

function mkResult(id: string, content: string, score: number): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.HYBRID,
    metadata: { projectId: "llm-judge-bench", filePath: `${id}.ts`, lineStart: 1, lineEnd: 2 },
  };
}

const RERANK_CASES: Array<{
  caseId: string;
  query: string;
  expectedBestId: string;
  results: SearchResult[];
}> = [
  {
    caseId: "R1-llm-swap",
    query: "why was the LLM model swapped to qwen2.5",
    expectedBestId: "best-swap",
    results: [
      mkResult("distract-prompt", "The salience-judge prompt template asks for a JSON importance score.", 0.7),
      mkResult("best-swap", "Swapped the default LLM to qwen2.5:7b-instruct because the thinking model degraded structured calls.", 0.5),
      mkResult("distract-cache", "Capped the read_file fileCache at 512 entries with LRU promotion.", 0.6),
    ],
  },
  {
    caseId: "R2-checkpoint-async",
    query: "checkpoint restore made async for real postgres select",
    expectedBestId: "best-ckpt",
    results: [
      mkResult("distract-autockpt", "AutoCheckpointer triggers createCheckpoint after every N observations.", 0.6),
      mkResult("best-ckpt", "Made restoreCheckpoint async so the PG store can run a real SELECT for existing memory ids.", 0.55),
      mkResult("distract-skip", "Removed redundant Dx:SKIP guards from the Phase-4 integration tests.", 0.5),
    ],
  },
];

// ─── Config save/restore (enable the real LLM surface in-process) ─────────────

const ORIGINAL_LLM = config.get("llm");
const ORIGINAL_SEARCH = config.get("search");
const ORIGINAL_MEMORY = config.get("memory");

beforeAll(() => {
  _setLlmEnabledForTesting(true);
  config.set("llm", {
    ...ORIGINAL_LLM,
    enabled: true,
    model: process.env.RLM_LLM_MODEL ?? "qwen2.5:7b-instruct",
    codeModel: process.env.RLM_LLM_CODE_MODEL ?? "qwen2.5-coder:7b",
  });
  config.set("search", {
    ...ORIGINAL_SEARCH,
    rerank: { enabled: true, rerankWindow: 10 },
  });
  config.set("memory", {
    ...ORIGINAL_MEMORY,
    autoImportance: { enabled: true },
  });
});

afterAll(() => {
  _setLlmEnabledForTesting(null);
  config.set("llm", ORIGINAL_LLM);
  config.set("search", ORIGINAL_SEARCH);
  config.set("memory", ORIGINAL_MEMORY);
});

// ─── Gated suite ──────────────────────────────────────────────────────────────

describe.skipIf(!OLLAMA_UP)("LLM-judge benchmark — qwen2.5 non-regression (gated on Ollama)", () => {
  test("consolidator merge-decision: precision >= floor and recall >= floor", async () => {
    expect(isLlmEnabled()).toBe(true);

    let tp = 0;
    let fp = 0;
    let fn = 0;
    let tn = 0;

    for (const g of DUP_GROUPS) {
      const said = await probeMerge(g.contents);
      if (said) tp++;
      else fn++; // expected merge, judge said distinct
    }
    for (const p of DISTINCT_PAIRS) {
      const said = await probeMerge(p.contents);
      if (said) fp++; // expected distinct, judge said merge
      else tn++;
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 1;
    const recall = tp + fn > 0 ? tp / (tp + fn) : 0;

    // Diagnostics on failure (not assertions): show the confusion matrix.
    if (precision < FLOOR_MERGE_PRECISION || recall < FLOOR_MERGE_RECALL) {
      console.warn(`[llm-judge-bench] merge confusion: TP=${tp} FP=${fp} FN=${fn} TN=${tn}`, {
        precision,
        recall,
        floorPrecision: FLOOR_MERGE_PRECISION,
        floorRecall: FLOOR_MERGE_RECALL,
      });
    }

    expect(precision).toBeGreaterThanOrEqual(FLOOR_MERGE_PRECISION);
    expect(recall).toBeGreaterThanOrEqual(FLOOR_MERGE_RECALL);
  }, 120_000);

  test("reranker: hit@1 >= floor (expected best at rank 1)", async () => {
    const reranker = new LLMJudgeReranker();
    let hits = 0;
    for (const c of RERANK_CASES) {
      const out = await reranker.rerank(c.query, c.results, 10);
      if ((out[0]?.id ?? "") === c.expectedBestId) hits++;
    }
    const hitAt1 = hits / RERANK_CASES.length;
    if (hitAt1 < FLOOR_RERANK_HIT1) {
      console.warn(`[llm-judge-bench] rerank hit@1 below floor`, {
        hitAt1,
        floor: FLOOR_RERANK_HIT1,
      });
    }
    expect(hitAt1).toBeGreaterThanOrEqual(FLOOR_RERANK_HIT1);
  }, 120_000);

  test("salience judge: dup-group consistency >= floor", async () => {
    const judge = new SalienceJudge();
    const tolerance = 0.2;
    let consistent = 0;
    for (const g of DUP_GROUPS) {
      const scores: number[] = [];
      for (const content of g.contents) {
        const { salience } = await judge.scoreSalience(content, "decision");
        scores.push(salience);
      }
      const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
      if (scores.every((s) => Math.abs(s - mean) <= tolerance)) consistent++;
    }
    const rate = consistent / DUP_GROUPS.length;
    if (rate < FLOOR_SALIENCE_CONSISTENCY) {
      console.warn(`[llm-judge-bench] salience consistency below floor`, {
        rate,
        floor: FLOOR_SALIENCE_CONSISTENCY,
      });
    }
    expect(rate).toBeGreaterThanOrEqual(FLOOR_SALIENCE_CONSISTENCY);
  }, 120_000);
});

describe("LLM-judge benchmark — skip-when-down sentinel", () => {
  test("OLLAMA_UP flag is boolean (probe did not throw)", () => {
    expect(typeof OLLAMA_UP).toBe("boolean");
  });
});
