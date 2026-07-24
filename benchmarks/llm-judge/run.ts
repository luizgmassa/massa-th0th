#!/usr/bin/env bun
/**
 * LLM-judge benchmark harness for massa-ai (qwen2.5 swap).
 *
 * Drives the REAL local Ollama LLM surface (qwen2.5:7b-instruct + coder) through
 * three judge paths, against curated known-duplicate / known-distinct fixtures:
 *
 *   (a) Consolidator merge-decision probe:
 *       - For each known-dup GROUP: send all members to the LLM and ask "are
 *         these duplicates?". Ground truth = merge=true.
 *       - For each known-distinct PAIR: send the two members and ask the same.
 *         Ground truth = merge=false.
 *       This isolates the *judge* decision from the rule-based cosine prefilter
 *       (the real consolidateWindow prefilter clusters on embeddings; the LLM
 *       only echoes sourceIds of the picked cluster). The probe scores the LLM's
 *       semantic-similarity judgment directly — the quality the swap affects.
 *   (b) Salience-judge consistency: score every member of each dup-group; a
 *       good judge gives paraphrases of the same fact a consistent score.
 *   (c) Reranker: for each rerank case, feed the candidates and check whether
 *       the expected-best lands at rank 1.
 *
 * Writes a results JSON (consumed by scorer.ts). Report filename is set by the
 * required --label arg (NO argless new Date for the path); `ranAt` inside the
 * body is the only ISO timestamp (mirrors the needles harness).
 *
 * Usage (from repo root):
 *   bun benchmarks/llm-judge/run.ts --label baseline
 *   bun benchmarks/llm-judge/run.ts --label qwen25 --salienceType decision
 *
 * Env (defaults match the live swap):
 *   RLM_LLM_MODEL         instruct model (default qwen2.5:7b-instruct)
 *   RLM_LLM_CODE_MODEL    coder model  (default qwen2.5-coder:7b)
 *   RLM_LLM_BASE_URL      Ollama /v1  (default http://localhost:11434/v1)
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { z } from "zod";
// Shared bits via the built dist (avoids a direct `@massa-ai/shared` import
// at repo root, which Bun does not resolve — mirrors the needles harness, which
// sidesteps the package import entirely).
import { config, logger, SearchSource } from "../../packages/shared/dist/index.js";
import type { SearchResult } from "../../packages/shared/dist/types/index.js";
// Core judge services via relative .ts paths (these transitively resolve
// `@massa-ai/shared` via their own package context, as proven at runtime).
import {
  llmObject,
  isLlmEnabled,
} from "../../packages/core/src/services/memory/llm-client.ts";
import { LLMJudgeReranker } from "../../packages/core/src/services/search/reranker.ts";
import { SalienceJudge } from "../../packages/core/src/services/memory/salience-judge.ts";

// ── Fixtures ───────────────────────────────────────────────────────────────

interface DupMember {
  id: string;
  content: string;
  type: string;
}
interface DupGroup {
  groupId: string;
  expectedMerge: boolean;
  expectedType: string;
  members: DupMember[];
}
interface DupFixtureFile {
  version: string;
  description: string;
  distractors: DupMember[];
  groups: DupGroup[];
}
interface DistinctFixtureFile {
  version: string;
  description: string;
  pairs: Array<{
    pairId: string;
    expectedMerge: boolean;
    rationale: string;
    a: DupMember;
    b: DupMember;
  }>;
}

// ── Results shape (mirrors scorer.ts) ──────────────────────────────────────

interface MergeProbeResult {
  kind: "dup-group" | "distinct-pair";
  refId: string;
  members: string[];
  judgeSaidMerge: boolean;
  latencyMs?: number;
}
interface SalienceProbeResult {
  groupId: string;
  scores: Array<{ id: string; salience: number }>;
}
interface RerankCase {
  caseId: string;
  query: string;
  inputOrder: string[];
  expectedBestId: string;
  outputOrder: string[];
}
interface ResultsFile {
  projectId: string;
  ranAt: string;
  model: string;
  codeModel: string;
  mergeProbes: MergeProbeResult[];
  salienceProbes: SalienceProbeResult[];
  rerankCases: RerankCase[];
}

// ── LLM surfaces (the REAL production handle; no fake injection here) ──────
//
// llmComplete/llmObject read config.llm + per-call modelRole. We enable the
// llm block in-process and restore it on exit so the harness is self-contained.

const DupVerdictSchema = z.object({
  areDuplicates: z.boolean(),
  rationale: z.string().optional(),
});

/**
 * Probe: are the given memory contents semantic duplicates? Uses the instruct
 * model (the consolidator's default role). Returns the judge's boolean.
 */
async function probeMerge(contents: string[]): Promise<{ areDuplicates: boolean; latencyMs: number }> {
  const start = Date.now();
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
  return {
    areDuplicates: res.ok && res.value ? !!res.value.areDuplicates : false,
    latencyMs: Date.now() - start,
  };
}

// ── Rerank fixture cases (built in-memory; expected best is known) ─────────

function buildRerankCases(): Array<{
  caseId: string;
  query: string;
  expectedBestId: string;
  results: SearchResult[];
}> {
  function mk(id: string, content: string, score: number): SearchResult {
    return {
      id,
      content,
      score,
      source: SearchSource.HYBRID,
      metadata: { projectId: "llm-judge-bench", filePath: `${id}.ts`, lineStart: 1, lineEnd: 2 },
    };
  }
  return [
    {
      caseId: "R1-llm-swap",
      query: "why was the LLM model swapped to qwen2.5",
      expectedBestId: "best-swap",
      results: [
        mk("distract-prompt", "The salience-judge prompt template asks for a JSON importance score.", 0.7),
        mk("best-swap", "Swapped the default LLM to qwen2.5:7b-instruct because the thinking model degraded structured calls.", 0.5),
        mk("distract-cache", "Capped the read_file fileCache at 512 entries with LRU promotion.", 0.6),
      ],
    },
    {
      caseId: "R2-checkpoint-async",
      query: "checkpoint restore made async for real postgres select",
      expectedBestId: "best-ckpt",
      results: [
        mk("distract-autockpt", "AutoCheckpointer triggers createCheckpoint after every N observations.", 0.6),
        mk("best-ckpt", "Made restoreCheckpoint async so the PG store can run a real SELECT for existing memory ids.", 0.55),
        mk("distract-skip", "Removed redundant Dx:SKIP guards from the Phase-4 integration tests.", 0.5),
      ],
    },
    {
      caseId: "R3-config-drift",
      query: "config interface reconciled with runtime server config shape",
      expectedBestId: "best-config",
      results: [
        mk("distract-deps", "Aligned @types/node to ^25 across workspace packages.", 0.6),
        mk("distract-vector-gate", "Aligned the PostgresVectorStore gate to DB_AVAILABLE.", 0.5),
        mk("best-config", "The declared config interface drifted from the runtime ServerConfig shape; reconciled the keys.", 0.55),
      ],
    },
  ];
}

// ── CLI args ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const val = argv[i + 1];
      if (val && !val.startsWith("--")) {
        out[key] = val;
        i++;
      } else {
        out[key] = "true";
      }
    }
  }
  return out;
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.label) {
    console.error("Usage: run.ts --label <name> [--dup <path>] [--distinct <path>] [--salienceType <type>]");
    console.error("  --label is required (report filename; no argless Date used for the path).");
    process.exit(2);
  }
  const repoRoot = resolve(import.meta.dir, "..", "..");
  const dupPath = resolve(
    repoRoot,
    args.dup ?? "benchmarks/llm-judge/fixtures/known-dup.json",
  );
  const distinctPath = resolve(
    repoRoot,
    args.distinct ?? "benchmarks/llm-judge/fixtures/known-distinct.json",
  );
  if (!existsSync(dupPath) || !existsSync(distinctPath)) {
    console.error(`Fixture missing: ${dupPath} or ${distinctPath}`);
    process.exit(2);
  }
  const dup = JSON.parse(readFileSync(dupPath, "utf8")) as DupFixtureFile;
  const distinct = JSON.parse(readFileSync(distinctPath, "utf8")) as DistinctFixtureFile;

  const salienceType = (args.salienceType ?? "decision") as
    | "critical"
    | "conversation"
    | "code"
    | "decision"
    | "pattern";

  // ── Enable the real LLM surface in-process (restore on exit) ───────────
  const ORIGINAL_LLM = config.get("llm");
  const ORIGINAL_SEARCH = config.get("search");
  const ORIGINAL_MEMORY = config.get("memory");
  config.set("llm", {
    ...ORIGINAL_LLM,
    enabled: true,
    model: process.env.RLM_LLM_MODEL ?? "qwen2.5:7b-instruct",
    codeModel: process.env.RLM_LLM_CODE_MODEL ?? "qwen2.5-coder:7b",
    baseUrl: process.env.RLM_LLM_BASE_URL ?? "http://localhost:11434/v1",
  });
  config.set("search", {
    ...ORIGINAL_SEARCH,
    rerank: { enabled: true, rerankWindow: 10 },
  });
  config.set("memory", {
    ...ORIGINAL_MEMORY,
    autoImportance: { enabled: true },
  });

  let exitCode = 0;
  try {
    if (!isLlmEnabled()) {
      console.error("LLM is not enabled after config.set — aborting.");
      process.exit(1);
    }

    const model =
      process.env.RLM_LLM_MODEL ?? ORIGINAL_LLM.model ?? "qwen2.5:7b-instruct";
    const codeModel =
      process.env.RLM_LLM_CODE_MODEL ?? ORIGINAL_LLM.codeModel ?? "qwen2.5-coder:7b";

    console.log(`\n=== LLM-judge benchmark — label ${args.label} ===`);
    console.log(`instruct model: ${model}`);
    console.log(`coder model:    ${codeModel}`);
    console.log(`dup groups:     ${dup.groups.length}`);
    console.log(`distinct pairs: ${distinct.pairs.length}\n`);

    // (a) Merge-decision probes.
    const mergeProbes: MergeProbeResult[] = [];
    console.log("→ merge-decision probes (dup groups)...");
    for (const g of dup.groups) {
      const contents = g.members.map((m) => m.content);
      const { areDuplicates, latencyMs } = await probeMerge(contents);
      mergeProbes.push({
        kind: "dup-group",
        refId: g.groupId,
        members: g.members.map((m) => m.id),
        judgeSaidMerge: areDuplicates,
        latencyMs,
      });
      console.log(`  ${g.groupId}: judge=${areDuplicates ? "merge" : "distinct"} (${latencyMs}ms)`);
    }
    console.log("→ merge-decision probes (distinct pairs)...");
    for (const p of distinct.pairs) {
      const { areDuplicates, latencyMs } = await probeMerge([p.a.content, p.b.content]);
      mergeProbes.push({
        kind: "distinct-pair",
        refId: p.pairId,
        members: [p.a.id, p.b.id],
        judgeSaidMerge: areDuplicates,
        latencyMs,
      });
      console.log(`  ${p.pairId}: judge=${areDuplicates ? "merge" : "distinct"} (${latencyMs}ms)`);
    }

    // (b) Salience consistency per dup-group.
    const salienceProbes: SalienceProbeResult[] = [];
    const judge = new SalienceJudge(); // real default LLM handle
    console.log("\n→ salience consistency probes...");
    for (const g of dup.groups) {
      const scores: Array<{ id: string; salience: number }> = [];
      for (const m of g.members) {
        const { salience } = await judge.scoreSalience(m.content, salienceType as never);
        scores.push({ id: m.id, salience });
      }
      salienceProbes.push({ groupId: g.groupId, scores });
      console.log(`  ${g.groupId}: [${scores.map((s) => s.salience.toFixed(2)).join(", ")}]`);
    }

    // (c) Reranker.
    const rerankCases: RerankCase[] = [];
    const reranker = new LLMJudgeReranker(); // real default LLM handle (code role)
    const cases = buildRerankCases();
    console.log("\n→ reranker probes...");
    for (const c of cases) {
      const out = await reranker.rerank(c.query, c.results, 10);
      const outputOrder = out.map((r) => r.id);
      rerankCases.push({
        caseId: c.caseId,
        query: c.query,
        inputOrder: c.results.map((r) => r.id),
        expectedBestId: c.expectedBestId,
        outputOrder,
      });
      console.log(`  ${c.caseId}: top=${outputOrder[0] ?? "(empty)"} expected=${c.expectedBestId}`);
    }

    // ── Write results JSON (timestamp in-body only; filename is the label) ──
    const resultsFile: ResultsFile = {
      projectId: "llm-judge",
      ranAt: new Date().toISOString(),
      model,
      codeModel,
      mergeProbes,
      salienceProbes,
      rerankCases,
    };
    const reportsDir = resolve(repoRoot, "benchmarks/llm-judge/reports");
    mkdirSync(reportsDir, { recursive: true });
    const resultsPath = resolve(reportsDir, `llm-judge-${args.label}-results.json`);
    writeFileSync(resultsPath, JSON.stringify(resultsFile, null, 2));
    console.log(`\nresults: ${resultsPath}`);
    console.log("score with:  bun benchmarks/llm-judge/scorer.ts \\");
    console.log(`  --dup ${dupPath} --distinct ${distinctPath} --results ${resultsPath}`);
  } catch (e) {
    exitCode = 1;
    logger.error("llm-judge run failed", e as Error);
    console.error((e as Error).message);
  } finally {
    // Restore config so the harness leaves no global side-effect.
    config.set("llm", ORIGINAL_LLM);
    config.set("search", ORIGINAL_SEARCH);
    config.set("memory", ORIGINAL_MEMORY);
  }
  if (exitCode !== 0) process.exit(exitCode);
}

await main();
