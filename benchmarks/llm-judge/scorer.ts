#!/usr/bin/env bun
/**
 * LLM-judge scorer for massa-ai (qwen2.5 swap benchmark).
 *
 * Given the judge's actual decisions vs the fixtures' ground truth, compute
 * precision / recall / F1 for three judges:
 *   (a) Consolidator merge-decision probe — did it flag known-dup groups as
 *       duplicates (true positives) and known-distinct pairs as distinct
 *       (true negatives)?
 *   (b) Salience-judge consistency — within a known-dup group, does the judge
 *       score members within a tolerance band? (Dup-group members should score
 *       consistently; the metric is the fraction of groups whose member scores
 *       fall within `salienceTolerance` of the group mean.)
 *   (c) Reranker — does the LLM-judge reranker preserve the expected best
 *       result at rank 1 within tolerance? (hit@1 over a set of rerank cases.)
 *
 * Mirrors the needles scorer's output shape: per-metric + aggregate summary,
 * plus a per-case evaluations array.
 *
 * This module is pure: it takes already-collected judge outputs (the harness in
 * run.ts drives the real LLM and writes a results JSON; scorer.ts reads that +
 * the fixture, writes report + evaluations). Separating drive from score keeps
 * the scorer deterministic and re-runnable across model swaps.
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";

// ─── Types (mirror fixtures + run.ts results shape) ──────────────────────────

interface DupFixture {
  version: string;
  description: string;
  groups: Array<{
    groupId: string;
    expectedMerge: boolean;
    expectedType: string;
    members: Array<{ id: string; content: string; type: string }>;
  }>;
  distractors: Array<{ id: string; content: string; type: string }>;
}

interface DistinctFixture {
  version: string;
  description: string;
  pairs: Array<{
    pairId: string;
    expectedMerge: boolean;
    rationale: string;
    a: { id: string; content: string; type: string };
    b: { id: string; content: string; type: string };
  }>;
}

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

interface EvalMerge {
  refId: string;
  kind: "dup-group" | "distinct-pair";
  expectedMerge: boolean;
  judgeSaidMerge: boolean;
  tp: boolean;
  fp: boolean;
  fn: boolean;
  tn: boolean;
}

interface EvalSalience {
  groupId: string;
  scores: number[];
  spread: number;
  consistent: boolean;
}

interface EvalRerank {
  caseId: string;
  query: string;
  expectedBestId: string;
  topId: string;
  hitAt1: boolean;
}

interface Summary {
  merge: {
    n: number;
    tp: number;
    fp: number;
    fn: number;
    tn: number;
    precision: number;
    recall: number;
    f1: number;
    accuracy: number;
  };
  salience: {
    n: number;
    consistentGroups: number;
    consistencyRate: number;
    meanSpread: number;
  };
  rerank: {
    n: number;
    hitAt1: number;
  };
}

// ─── Metric math ─────────────────────────────────────────────────────────────

function prf(tp: number, fp: number, fn: number): { precision: number; recall: number; f1: number } {
  const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
  const recall = tp + fn > 0 ? tp / (tp + fn) : 0;
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;
  return { precision, recall, f1 };
}

// ─── Evaluate ────────────────────────────────────────────────────────────────

function evaluate(
  _dup: DupFixture,
  _distinct: DistinctFixture,
  results: ResultsFile,
  opts: { salienceTolerance?: number },
): { mergeEvals: EvalMerge[]; salienceEvals: EvalSalience[]; rerankEvals: EvalRerank[]; summary: Summary } {
  const salTol = opts.salienceTolerance ?? 0.2;

  // (a) Merge-decision probes. Each probe has an expected (ground-truth) merge
  // flag and the judge's flag. Confusion matrix over "judge says merge".
  const mergeEvals: EvalMerge[] = results.mergeProbes.map((p) => {
    const expectedMerge = p.kind === "dup-group"; // dup-groups expect merge=true; distinct-pairs expect merge=false
    const said = p.judgeSaidMerge;
    return {
      refId: p.refId,
      kind: p.kind,
      expectedMerge,
      judgeSaidMerge: said,
      tp: expectedMerge && said,
      fp: !expectedMerge && said,
      fn: expectedMerge && !said,
      tn: !expectedMerge && !said,
    };
  });

  const tp = mergeEvals.filter((e) => e.tp).length;
  const fp = mergeEvals.filter((e) => e.fp).length;
  const fn = mergeEvals.filter((e) => e.fn).length;
  const tn = mergeEvals.filter((e) => e.tn).length;
  const { precision, recall, f1 } = prf(tp, fp, fn);
  const n = mergeEvals.length;

  // (b) Salience consistency: within each dup-group, scores should fall within
  // `salTol` of the group mean (members are paraphrases → same salience).
  const salienceEvals: EvalSalience[] = results.salienceProbes.map((g) => {
    const scores = g.scores.map((s) => s.salience);
    const mean = scores.reduce((a, b) => a + b, 0) / (scores.length || 1);
    const spread = Math.max(...scores) - Math.min(...scores);
    const consistent = scores.every((s) => Math.abs(s - mean) <= salTol);
    return { groupId: g.groupId, scores, spread, consistent };
  });
  const consistentGroups = salienceEvals.filter((e) => e.consistent).length;
  const meanSpread =
    salienceEvals.length > 0
      ? salienceEvals.reduce((s, e) => s + e.spread, 0) / salienceEvals.length
      : 0;

  // (c) Reranker hit@1: expected best id at top of output.
  const rerankEvals: EvalRerank[] = results.rerankCases.map((c) => ({
    caseId: c.caseId,
    query: c.query,
    expectedBestId: c.expectedBestId,
    topId: c.outputOrder[0] ?? "",
    hitAt1: (c.outputOrder[0] ?? "") === c.expectedBestId,
  }));
  const rerankHit1 = rerankEvals.filter((e) => e.hitAt1).length;

  const summary: Summary = {
    merge: {
      n,
      tp,
      fp,
      fn,
      tn,
      precision: +precision.toFixed(3),
      recall: +recall.toFixed(3),
      f1: +f1.toFixed(3),
      accuracy: n > 0 ? +((tp + tn) / n).toFixed(3) : 0,
    },
    salience: {
      n: salienceEvals.length,
      consistentGroups,
      consistencyRate: salienceEvals.length > 0 ? +(consistentGroups / salienceEvals.length).toFixed(3) : 0,
      meanSpread: +meanSpread.toFixed(3),
    },
    rerank: {
      n: rerankEvals.length,
      hitAt1: rerankEvals.length > 0 ? +(rerankHit1 / rerankEvals.length).toFixed(3) : 0,
    },
  };

  return { mergeEvals, salienceEvals, rerankEvals, summary };
}

// ─── Report rendering ────────────────────────────────────────────────────────

function renderMarkdown(
  results: ResultsFile,
  evals: {
    mergeEvals: EvalMerge[];
    salienceEvals: EvalSalience[];
    rerankEvals: EvalRerank[];
    summary: Summary;
  },
): string {
  const { summary: s } = evals;
  const lines: string[] = [];
  lines.push(`# massa-ai LLM-judge Benchmark Report`);
  lines.push("");
  lines.push(`- Ran at: \`${results.ranAt}\``);
  lines.push(`- Instruction model: \`${results.model}\``);
  lines.push(`- Coder model: \`${results.codeModel}\``);
  lines.push("");
  lines.push("## Aggregate");
  lines.push("");
  lines.push("| Judge | Metric | Value |");
  lines.push("|---|---|---:|");
  lines.push(`| Consolidator merge | n | ${s.merge.n} |`);
  lines.push(`| Consolidator merge | TP / FP / FN / TN | ${s.merge.tp} / ${s.merge.fp} / ${s.merge.fn} / ${s.merge.tn} |`);
  lines.push(`| Consolidator merge | precision | ${s.merge.precision} |`);
  lines.push(`| Consolidator merge | recall | ${s.merge.recall} |`);
  lines.push(`| Consolidator merge | F1 | ${s.merge.f1} |`);
  lines.push(`| Consolidator merge | accuracy | ${s.merge.accuracy} |`);
  lines.push(`| Salience consistency | groups | ${s.salience.n} |`);
  lines.push(`| Salience consistency | consistent groups | ${s.salience.consistentGroups} |`);
  lines.push(`| Salience consistency | consistency rate | ${s.salience.consistencyRate} |`);
  lines.push(`| Salience consistency | mean spread | ${s.salience.meanSpread} |`);
  lines.push(`| Reranker | cases | ${s.rerank.n} |`);
  lines.push(`| Reranker | hit@1 | ${s.rerank.hitAt1} |`);
  lines.push("");
  lines.push("## Merge-decision per-case");
  lines.push("");
  lines.push("| ref | kind | expected | judge | outcome |");
  lines.push("|---|---|---|---|---|");
  for (const e of evals.mergeEvals) {
    const outcome = e.tp ? "TP" : e.fp ? "FP" : e.fn ? "FN" : "TN";
    lines.push(`| ${e.refId} | ${e.kind} | ${e.expectedMerge ? "merge" : "distinct"} | ${e.judgeSaidMerge ? "merge" : "distinct"} | ${outcome} |`);
  }
  lines.push("");
  lines.push("## Salience per-group");
  lines.push("");
  lines.push("| group | scores | spread | consistent |");
  lines.push("|---|---|---:|---|");
  for (const e of evals.salienceEvals) {
    lines.push(`| ${e.groupId} | [${e.scores.map((x) => x.toFixed(2)).join(", ")}] | ${e.spread.toFixed(2)} | ${e.consistent ? "yes" : "no"} |`);
  }
  lines.push("");
  lines.push("## Reranker per-case");
  lines.push("");
  lines.push("| case | query | expected best | judge top | hit@1 |");
  lines.push("|---|---|---|---|---|");
  for (const e of evals.rerankEvals) {
    lines.push(`| ${e.caseId} | ${e.query} | ${e.expectedBestId} | ${e.topId} | ${e.hitAt1 ? "yes" : "no"} |`);
  }
  lines.push("");
  return lines.join("\n");
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

interface DupGroup {
  groupId: string;
  expectedMerge: boolean;
  expectedType: string;
  members: Array<{ id: string; content: string; type: string }>;
}
interface DupFixtureFile {
  version: string;
  description: string;
  distractors: Array<{ id: string; content: string; type: string }>;
  groups: DupGroup[];
}
interface DistinctFixtureFile {
  version: string;
  description: string;
  pairs: Array<{
    pairId: string;
    expectedMerge: boolean;
    rationale: string;
    a: { id: string; content: string; type: string };
    b: { id: string; content: string; type: string };
  }>;
}

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

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.dup || !args.distinct || !args.results) {
    console.error(
      "Usage: scorer.ts --dup <known-dup.json> --distinct <known-distinct.json> --results <results.json> [--out <prefix>] [--salienceTolerance 0.2]",
    );
    process.exit(1);
  }
  const dupPath = resolve(args.dup);
  const distinctPath = resolve(args.distinct);
  const resultsPath = resolve(args.results);
  const outPrefix = resolve(args.out ?? resultsPath.replace(/\.json$/, ""));
  const salienceTolerance = args.salienceTolerance ? Number(args.salienceTolerance) : 0.2;

  const dup = JSON.parse(readFileSync(dupPath, "utf8")) as DupFixture;
  const distinct = JSON.parse(readFileSync(distinctPath, "utf8")) as DistinctFixture;
  const results = JSON.parse(readFileSync(resultsPath, "utf8")) as ResultsFile;

  const evals = evaluate(dup, distinct, results, { salienceTolerance });
  mkdirSync(dirname(outPrefix), { recursive: true });
  const reportPath = `${outPrefix}.md`;
  const evalPath = `${outPrefix}.evaluations.json`;
  writeFileSync(evalPath, JSON.stringify(evals, null, 2));
  writeFileSync(reportPath, renderMarkdown(results, evals));
  console.log(`Report:      ${reportPath}`);
  console.log(`Evaluations: ${evalPath}`);
  console.log(`Summary:`, evals.summary);
}

if (import.meta.main) main();
