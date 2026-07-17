/**
 * TASK-025 frozen parser benchmark driver.
 *
 * Measures the candidate (current tree-sitter StructuralRuntime) against the
 * baseline (5d43a96 regex extractTypedEdges) on the frozen TS/JS corpus.
 *
 * Methodology (per the TASK-025 done-when contract):
 *   - Baseline and candidate are measured in SEPARATE FRESH child processes
 *     (one spawn per sample) so native module state never leaks across them.
 *   - Throughput: total bytes / wall seconds over the whole corpus, N>=5
 *     samples; report median + variance ratio. If any sample deviates >15%
 *     from the median, re-sample up to MAX_RESAMPLE_RETRIES times and flag
 *     instability.
 *   - Peak RSS: max RSS across the corpus parse (process.memoryUsage().rss).
 *   - Disposal stress (CANDIDATE only): 100-cycle explicit-disposal / forced-GC
 *     native-retention sensor, 16 MiB median-delta bound, reusing the
 *     verifier's exact method.
 *   - Corpus checksum must match the frozen manifest.
 *
 * Usage:
 *   bun benchmarks/parser/run.ts [--baseline <commit>] [--samples <n>]
 *
 * Prints a single JSON result object on stdout (after progress on stderr).
 */

import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CORPUS_DIR,
  MIN_SAMPLES,
  MAX_RESAMPLE_RETRIES,
  VARIANCE_DEVIATION_PCT,
  THROUGHPUT_REGRESSION_THRESHOLD_PCT,
  RSS_REGRESSION_THRESHOLD_PCT,
  computeCorpusChecksum,
  evaluateVerdict,
  loadCorpus,
  median,
  readManifest,
  varianceRule,
  verifyCorpus,
} from "./harness.ts";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(MODULE_DIR, "../..");
const CANDIDATE_WORKER = resolve(MODULE_DIR, "workers/candidate-worker.ts");
const BASELINE_WORKER = resolve(MODULE_DIR, "workers/baseline-worker.ts");
const DEFAULT_BASELINE_COMMIT = "5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03";
const RESULT_PREFIX = "BENCH_SAMPLE_RESULT=";

interface ThroughputSample {
  readonly kind: string;
  readonly sampleIndex: number;
  readonly elapsedSeconds: number;
  readonly totalBytes: number;
  readonly throughputBps: number;
  readonly peakRssBytes: number;
  readonly fileCount: number;
}

interface StressResult {
  readonly cycles: number;
  readonly firstRss: number;
  readonly lastRss: number;
  readonly growthBytes: number;
  readonly cycles21To40Median: number;
  readonly cycles81To100Median: number;
  readonly medianDeltaBytes: number;
  readonly boundBytes: number;
  readonly pass: boolean;
}

interface SideResult {
  readonly throughputBps: number;
  readonly rssBytes: number;
  readonly samples: readonly ThroughputSample[];
  readonly varianceStable: boolean;
  readonly maxDeviationPct: number;
  readonly resampleRetries: number;
  readonly unstable: boolean;
}

function log(message: string): void {
  process.stderr.write(`${message}\n`);
}

function parseArgs(argv: readonly string[]): { baseline: string; samples: number } {
  let baseline = DEFAULT_BASELINE_COMMIT;
  let samples = MIN_SAMPLES;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--baseline") {
      baseline = argv[i + 1] ?? baseline;
      i += 1;
    } else if (arg === "--samples") {
      samples = Number(argv[i + 1] ?? samples);
      i += 1;
    }
  }
  if (samples < MIN_SAMPLES) samples = MIN_SAMPLES;
  return { baseline, samples };
}

function runWorker(
  command: string,
  args: readonly string[],
  env: NodeJS.ProcessEnv,
): Promise<unknown> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`worker exited ${code}: ${stderr.trim() || stdout.trim()}`));
        return;
      }
      const line = stdout.split("\n").find((entry) => entry.startsWith(RESULT_PREFIX));
      if (!line) {
        reject(new Error(`worker produced no result line. stderr: ${stderr.trim()}`));
        return;
      }
      try {
        resolvePromise(JSON.parse(line.slice(RESULT_PREFIX.length)));
      } catch (error) {
        reject(new Error(`worker result JSON parse failed: ${error instanceof Error ? error.message : String(error)}`));
      }
    });
  });
}

/** Run throughput samples with the variance-rule re-sample loop. */
async function measureSide(
  kind: "candidate" | "baseline",
  worker: string,
  workerArgs: (sampleIndex: number) => readonly string[],
  env: NodeJS.ProcessEnv,
  targetSamples: number,
  command: string,
): Promise<SideResult> {
  const collected: ThroughputSample[] = [];
  let resampleRetries = 0;
  // Hard cap on total samples drawn across all re-sample retries.
  const maxTotalSamples = targetSamples * (1 + MAX_RESAMPLE_RETRIES);

  // Keep drawing samples until we have targetSamples that satisfy the variance
  // rule, or we exhaust the retry budget (in which case we report instability).
  while (collected.length < targetSamples) {
    const sampleIndex = collected.length;
    log(`  [${kind}] sample ${sampleIndex + 1}/${targetSamples}…`);
    const raw = (await runWorker(command, [worker, ...workerArgs(sampleIndex)], env)) as ThroughputSample;
    collected.push(raw);

    if (collected.length >= targetSamples) {
      const throughputs = collected.map((sample) => sample.throughputBps);
      const verdict = varianceRule(throughputs, VARIANCE_DEVIATION_PCT);
      if (!verdict.stable && resampleRetries < MAX_RESAMPLE_RETRIES && collected.length < maxTotalSamples) {
        resampleRetries += 1;
        // Drop the worst offender so the next loop iteration replaces it.
        const med = median(throughputs);
        let worstIndex = 0;
        let worstDelta = 0;
        for (let i = 0; i < collected.length; i += 1) {
          const delta = Math.abs(collected[i]!.throughputBps - med);
          if (delta > worstDelta) {
            worstDelta = delta;
            worstIndex = i;
          }
        }
        log(`    variance unstable (max dev ${(verdict.maxDeviation * 100).toFixed(1)}%); dropping sample ${worstIndex + 1} (retry ${resampleRetries}/${MAX_RESAMPLE_RETRIES})`);
        collected.splice(worstIndex, 1);
      }
    }
  }

  const throughputs = collected.map((sample) => sample.throughputBps);
  const rssValues = collected.map((sample) => sample.peakRssBytes);
  const throughputBps = median(throughputs);
  // Peak RSS: report the median sample's peak to avoid one GC outlier skewing.
  const rssBytes = median(rssValues);
  const verdict = varianceRule(throughputs, VARIANCE_DEVIATION_PCT);
  return {
    throughputBps,
    rssBytes,
    samples: collected,
    varianceStable: verdict.stable,
    maxDeviationPct: verdict.maxDeviation * 100,
    resampleRetries,
    unstable: !verdict.stable,
  };
}

async function measureDisposalStress(command: string): Promise<StressResult> {
  log("  [candidate] disposal stress (100 cycles, forced GC)…");
  const raw = (await runWorker(command, [CANDIDATE_WORKER, "stress"], {})) as StressResult;
  return raw;
}

async function setupBaselineWorktree(commit: string): Promise<string> {
  const worktreePath = mkdtempSync(resolve(tmpdir(), "massa-th0th-bench-baseline-"));
  log(`baseline worktree: ${worktreePath}`);
  await run("git", ["worktree", "add", "--detach", worktreePath, commit], REPO_ROOT);
  try {
    log("  building baseline worktree (bun install --frozen-lockfile)…");
    await run("bun", ["install", "--frozen-lockfile"], worktreePath);
    log("  building baseline worktree (bun run build)…");
    await run("bun", ["run", "build"], worktreePath);
  } catch (error) {
    // Build may fail if the baseline commit predates some tooling; the worker
    // falls back to source. Surface the warning but continue.
    log(`  warning: baseline build step failed (${error instanceof Error ? error.message : String(error)}); worker will try source fallback`);
  }
  return worktreePath;
}

function run(command: string, args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString("utf8");
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${command} ${args.join(" ")} exited ${code}: ${stderr.trim().slice(-800)}`));
    });
  });
}

async function main(): Promise<void> {
  const { baseline: baselineCommit, samples } = parseArgs(process.argv.slice(2));

  // 1. Verify the frozen corpus before measuring anything.
  const verification = verifyCorpus();
  if (!verification.ok) {
    process.stderr.write(
      `FATAL: corpus verification failed.\n` +
        `  checksum: manifest=${verification.manifestChecksum.slice(0, 12)} computed=${verification.computedChecksum.slice(0, 12)}\n` +
        `  mismatched: ${verification.mismatched.join("; ") || "(none)"}\n` +
        `  extras: ${verification.extras.join("; ") || "(none)"}\n`,
    );
    process.exit(1);
  }
  log(`corpus verified (checksum ${verification.manifestChecksum.slice(0, 12)}…)`);

  const manifest = readManifest();
  const { entries } = loadCorpus();
  log(`corpus: ${entries.length} files, ${manifest.totalBytes} bytes`);

  // Resolve the runner command. The benchmark runs under the same Bun that
  // the repo pins (1.3.11); prefer the explicit workspace bun.
  const bunCommand = "bun";

  // 2. Measure candidate (fresh process per sample).
  log(`measuring CANDIDATE (current tree-sitter StructuralRuntime), ${samples} samples…`);
  const candidate = await measureSide(
    "candidate",
    CANDIDATE_WORKER,
    (sampleIndex) => ["throughput", String(sampleIndex)],
    {},
    samples,
    bunCommand,
  );

  // 3. Disposal stress (candidate only).
  const stress = await measureDisposalStress(bunCommand);

  // 4. Measure baseline (fresh process per sample, separate worktree build).
  log(`measuring BASELINE (${baselineCommit}), ${samples} samples…`);
  let baseline: SideResult | null = null;
  let baselineError: string | null = null;
  let worktreePath: string | null = null;
  try {
    worktreePath = await setupBaselineWorktree(baselineCommit);
    baseline = await measureSide(
      "baseline",
      BASELINE_WORKER,
      (sampleIndex) => [String(sampleIndex)],
      { BENCH_BASELINE_WORKTREE: worktreePath },
      samples,
      bunCommand,
    );
  } catch (error) {
    baselineError = error instanceof Error ? error.message : String(error);
    log(`baseline measurement failed: ${baselineError}`);
  } finally {
    if (worktreePath) {
      try {
        await run("git", ["worktree", "remove", "--force", worktreePath], REPO_ROOT);
      } catch {
        rmSync(worktreePath, { recursive: true, force: true });
      }
      try {
        await run("git", ["worktree", "prune"], REPO_ROOT);
      } catch {
        // Non-fatal.
      }
    }
  }

  if (!baseline) {
    const result = {
      baseline: null,
      baselineError,
      candidate: sideToJson(candidate),
      throughputRegressionPct: null,
      rssRegressionPct: null,
      throughputPass: false,
      rssPass: false,
      disposalStressPass: stress.pass,
      disposalStress: stress,
      corpusChecksum: manifest.corpusChecksum,
      computedChecksum: computeCorpusChecksum(manifest),
      verdict: "BASELINE_FAILED" as const,
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    process.exit(1);
  }

  // 5. Evaluate verdict.
  const verdict = evaluateVerdict({
    baselineThroughputBps: baseline.throughputBps,
    candidateThroughputBps: candidate.throughputBps,
    baselineRssBytes: baseline.rssBytes,
    candidateRssBytes: candidate.rssBytes,
    disposalStressPass: stress.pass,
    corpusChecksumMatch: manifest.corpusChecksum === computeCorpusChecksum(manifest),
  });

  const result = {
    baseline: sideToJson(baseline),
    candidate: sideToJson(candidate),
    throughputRegressionPct: Number(verdict.throughputRegressionPct.toFixed(2)),
    rssRegressionPct: Number(verdict.rssRegressionPct.toFixed(2)),
    throughputPass: verdict.throughputPass,
    throughputThresholdPct: THROUGHPUT_REGRESSION_THRESHOLD_PCT,
    rssPass: verdict.rssPass,
    rssThresholdPct: RSS_REGRESSION_THRESHOLD_PCT,
    disposalStressPass: verdict.disposalStressPass,
    disposalStress: stress,
    corpusChecksum: manifest.corpusChecksum,
    corpusChecksumMatch: verdict.corpusChecksumMatch,
    corpus: {
      fileCount: manifest.fileCount,
      totalBytes: manifest.totalBytes,
      dir: CORPUS_DIR,
    },
    baselineCommit,
    verdict: verdict.pass ? "PASS" : "FAIL",
  };
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  process.exit(verdict.pass ? 0 : 1);
}

function sideToJson(side: SideResult): unknown {
  return {
    throughputBps: Math.round(side.throughputBps),
    rssBytes: side.rssBytes,
    varianceStable: side.varianceStable,
    maxDeviationPct: Number(side.maxDeviationPct.toFixed(2)),
    resampleRetries: side.resampleRetries,
    unstable: side.unstable,
    sampleCount: side.samples.length,
    samples: side.samples.map((sample) => ({
      index: sample.sampleIndex,
      elapsedSeconds: Number(sample.elapsedSeconds.toFixed(4)),
      throughputBps: Math.round(sample.throughputBps),
      peakRssBytes: sample.peakRssBytes,
    })),
  };
}

main().catch((error) => {
  process.stderr.write(`bench:parser fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
