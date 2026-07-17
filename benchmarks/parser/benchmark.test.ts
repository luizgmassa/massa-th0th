/**
 * TASK-025 parser benchmark harness tests.
 *
 * Fast (<10s) unit/smoke tests for the benchmark harness logic:
 *   - corpus manifest parses and is self-consistent (checksum recomputes)
 *   - on-disk corpus matches the manifest (bytes + SHA-256 + no extras)
 *   - statistics: median, variance ratio, variance rule on synthetic samples
 *   - threshold-comparison math (throughput/RSS regression, verdict aggregation)
 *   - SMOKE: candidate-vs-candidate throughput (both load the current parser)
 *     asserts roughly equal throughput within thresholds, without needing the
 *     baseline checkout.
 */

import { describe, expect, test } from "bun:test";
import {
  computeCorpusChecksum,
  evaluateVerdict,
  loadCorpus,
  median,
  readManifest,
  rssRegressionPct,
  throughputRegressionPct,
  varianceRatio,
  varianceRule,
  verifyCorpus,
  DISPOSAL_STRESS_BOUND_BYTES,
  MIN_SAMPLES,
  RSS_REGRESSION_THRESHOLD_PCT,
  THROUGHPUT_REGRESSION_THRESHOLD_PCT,
  VARIANCE_DEVIATION_PCT,
} from "./harness.ts";

describe("parser benchmark corpus", () => {
  test("manifest parses with expected shape", () => {
    const manifest = readManifest();
    expect(manifest.version).toBe(1);
    expect(manifest.fileCount).toBe(manifest.files.length);
    expect(manifest.files.length).toBeGreaterThan(0);
    expect(manifest.totalBytes).toBeGreaterThan(100_000);
    expect(manifest.corpusChecksum).toMatch(/^[0-9a-f]{64}$/);
    for (const file of manifest.files) {
      expect(file.name).toMatch(/^module-(ts|tsx|js|jsx)-\d+\.(ts|tsx|js|jsx)$/);
      expect(file.bytes).toBeGreaterThan(0);
      expect(file.sha256).toMatch(/^[0-9a-f]{64}$/);
    }
  });

  test("manifest totalBytes equals sum of file bytes", () => {
    const manifest = readManifest();
    const sum = manifest.files.reduce((acc, file) => acc + file.bytes, 0);
    expect(sum).toBe(manifest.totalBytes);
  });

  test("corpus checksum is self-consistent (recomputes from manifest)", () => {
    const manifest = readManifest();
    expect(computeCorpusChecksum(manifest)).toBe(manifest.corpusChecksum);
  });

  test("on-disk corpus matches manifest bytes + SHA-256 with no extras", () => {
    const verification = verifyCorpus();
    expect(verification.ok).toBe(true);
    expect(verification.mismatched).toEqual([]);
    expect(verification.extras).toEqual([]);
    expect(verification.computedChecksum).toBe(verification.manifestChecksum);
  });

  test("corpus covers all four TS/JS extensions", () => {
    const { manifest } = loadCorpus();
    const extensions = new Set(manifest.files.map((file) => file.extension));
    expect(extensions).toEqual(new Set([".ts", ".tsx", ".js", ".jsx"]));
  });

  test("corpus is large enough for stable throughput (>= several hundred KB)", () => {
    const { manifest } = loadCorpus();
    expect(manifest.totalBytes).toBeGreaterThanOrEqual(300_000);
  });
});

describe("parser benchmark statistics", () => {
  test("median of odd-length sample is the middle element", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([10, 20, 30, 40, 50])).toBe(30);
  });

  test("median of even-length sample is the average of the two middle elements", () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([10, 20, 30, 40])).toBe(25);
  });

  test("varianceRatio is zero for identical samples", () => {
    expect(varianceRatio([100, 100, 100])).toBe(0);
  });

  test("varianceRatio grows with spread", () => {
    const stable = varianceRatio([100, 101, 99]);
    const unstable = varianceRatio([100, 200, 50]);
    expect(unstable).toBeGreaterThan(stable);
    expect(unstable).toBeGreaterThan(0.5);
  });

  test("varianceRule marks a tight cluster stable", () => {
    const verdict = varianceRule([1000, 1010, 990, 1005, 995]);
    expect(verdict.stable).toBe(true);
    expect(verdict.maxDeviation).toBeLessThanOrEqual(VARIANCE_DEVIATION_PCT / 100);
  });

  test("varianceRule marks a wide spread unstable", () => {
    const verdict = varianceRule([1000, 1500, 600, 1100, 900]);
    expect(verdict.stable).toBe(false);
    expect(verdict.maxDeviation).toBeGreaterThan(VARIANCE_DEVIATION_PCT / 100);
  });

  test("varianceRule respects a custom threshold", () => {
    // Median of [100, 130] is 115; max deviation is 15 (~13% of median).
    // That passes the default 15% threshold but fails a tighter 5% threshold.
    const sample = [100, 130];
    expect(varianceRule(sample, 15).stable).toBe(true);
    expect(varianceRule(sample, 5).stable).toBe(false);
  });
});

describe("parser benchmark threshold math", () => {
  test("throughputRegressionPct is 0 when candidate equals baseline", () => {
    expect(throughputRegressionPct(1000, 1000)).toBe(0);
  });

  test("throughputRegressionPct is positive when candidate is slower", () => {
    // Baseline 1000 Bps, candidate 800 Bps => 20% drop.
    expect(throughputRegressionPct(1000, 800)).toBeCloseTo(20, 5);
  });

  test("throughputRegressionPct is negative when candidate is faster", () => {
    expect(throughputRegressionPct(1000, 1200)).toBeCloseTo(-20, 5);
  });

  test("rssRegressionPct is 0 when candidate equals baseline", () => {
    expect(rssRegressionPct(100_000_000, 100_000_000)).toBe(0);
  });

  test("rssRegressionPct is positive when candidate uses more RSS", () => {
    // Baseline 100MB, candidate 150MB => 50% growth.
    expect(rssRegressionPct(100_000_000, 150_000_000)).toBeCloseTo(50, 5);
  });

  test("evaluateVerdict passes when all gates are within bounds", () => {
    const verdict = evaluateVerdict({
      baselineThroughputBps: 1_000_000,
      candidateThroughputBps: 900_000, // 10% drop, within 25%
      baselineRssBytes: 100_000_000,
      candidateRssBytes: 120_000_000, // 20% growth, within 50%
      disposalStressPass: true,
      corpusChecksumMatch: true,
    });
    expect(verdict.throughputPass).toBe(true);
    expect(verdict.rssPass).toBe(true);
    expect(verdict.pass).toBe(true);
  });

  test("evaluateVerdict fails on throughput regression beyond threshold", () => {
    const verdict = evaluateVerdict({
      baselineThroughputBps: 1_000_000,
      candidateThroughputBps: 700_000, // 30% drop, beyond 25%
      baselineRssBytes: 100_000_000,
      candidateRssBytes: 100_000_000,
      disposalStressPass: true,
      corpusChecksumMatch: true,
    });
    expect(verdict.throughputPass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  test("evaluateVerdict fails on RSS regression beyond threshold", () => {
    const verdict = evaluateVerdict({
      baselineThroughputBps: 1_000_000,
      candidateThroughputBps: 1_000_000,
      baselineRssBytes: 100_000_000,
      candidateRssBytes: 160_000_000, // 60% growth, beyond 50%
      disposalStressPass: true,
      corpusChecksumMatch: true,
    });
    expect(verdict.rssPass).toBe(false);
    expect(verdict.pass).toBe(false);
  });

  test("evaluateVerdict fails when disposal stress fails", () => {
    const verdict = evaluateVerdict({
      baselineThroughputBps: 1_000_000,
      candidateThroughputBps: 1_000_000,
      baselineRssBytes: 100_000_000,
      candidateRssBytes: 100_000_000,
      disposalStressPass: false,
      corpusChecksumMatch: true,
    });
    expect(verdict.pass).toBe(false);
  });

  test("evaluateVerdict fails when corpus checksum mismatches", () => {
    const verdict = evaluateVerdict({
      baselineThroughputBps: 1_000_000,
      candidateThroughputBps: 1_000_000,
      baselineRssBytes: 100_000_000,
      candidateRssBytes: 100_000_000,
      disposalStressPass: true,
      corpusChecksumMatch: false,
    });
    expect(verdict.pass).toBe(false);
  });

  test("declared thresholds match the TASK-025 done-when contract", () => {
    expect(THROUGHPUT_REGRESSION_THRESHOLD_PCT).toBe(25);
    expect(RSS_REGRESSION_THRESHOLD_PCT).toBe(50);
    expect(DISPOSAL_STRESS_BOUND_BYTES).toBe(16 * 1024 * 1024);
    expect(MIN_SAMPLES).toBeGreaterThanOrEqual(5);
  });
});

describe("parser benchmark smoke (candidate-vs-candidate)", () => {
  // SMOKE: run the candidate throughput worker twice in fresh processes and
  // assert the two samples are roughly equal (within the throughput threshold).
  // This proves the harness wiring end-to-end without requiring the baseline
  // worktree checkout, and keeps the run under ~10s for a small sample count.
  test(
    "two independent candidate samples are within the regression threshold",
    async () => {
      const { spawn } = await import("node:child_process");
      const { dirname, resolve } = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      const workerPath = resolve(
        dirname(fileURLToPath(import.meta.url)),
        "workers/candidate-worker.ts",
      );

      const runSample = (): Promise<{ throughputBps: number; rssBytes: number }> =>
        new Promise((resolvePromise, reject) => {
          const child = spawn("bun", [workerPath, "throughput", "0"], {
            stdio: ["ignore", "pipe", "pipe"],
          });
          let stdout = "";
          let stderr = "";
          child.stdout.on("data", (chunk: Buffer) => {
            stdout += chunk.toString("utf8");
          });
          child.stderr.on("data", (chunk: Buffer) => {
            stderr += chunk.toString("utf8");
          });
          child.on("error", reject);
          child.on("exit", (code) => {
            if (code !== 0) {
              reject(new Error(`smoke worker exited ${code}: ${stderr.trim().slice(-400)}`));
              return;
            }
            const line = stdout
              .split("\n")
              .find((entry) => entry.startsWith("BENCH_SAMPLE_RESULT="));
            if (!line) {
              reject(new Error("smoke worker produced no result line"));
              return;
            }
            const parsed = JSON.parse(line.slice("BENCH_SAMPLE_RESULT=".length)) as {
              throughputBps: number;
              peakRssBytes: number;
            };
            resolvePromise({ throughputBps: parsed.throughputBps, rssBytes: parsed.peakRssBytes });
          });
        });

      const [a, b] = await Promise.all([runSample(), runSample()]);
      expect(a.throughputBps).toBeGreaterThan(0);
      expect(b.throughputBps).toBeGreaterThan(0);
      // Two runs of the SAME parser should be within 25% of each other.
      const drop = throughputRegressionPct(Math.max(a.throughputBps, b.throughputBps), Math.min(a.throughputBps, b.throughputBps));
      expect(drop).toBeLessThanOrEqual(THROUGHPUT_REGRESSION_THRESHOLD_PCT);
    },
    { timeout: 30_000 },
  );
});
