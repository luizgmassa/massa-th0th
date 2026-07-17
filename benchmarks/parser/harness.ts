/**
 * Shared benchmark harness primitives for TASK-025.
 *
 * Pure, deterministic helpers used by both `run.ts` (the measurement driver)
 * and `benchmark.test.ts` (the harness unit tests). No process spawning or
 * parsing lives here — only corpus loading, manifest verification, statistics,
 * and threshold math, so the tests can exercise them without a baseline
 * checkout.
 */

import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MODULE_DIR = dirname(fileURLToPath(import.meta.url));
export const CORPUS_DIR = resolve(MODULE_DIR, "corpus");
export const MANIFEST_PATH = resolve(CORPUS_DIR, "corpus-manifest.json");

/** DONE-WHEN thresholds from TASK-025. */
export const THROUGHPUT_REGRESSION_THRESHOLD_PCT = 25;
export const RSS_REGRESSION_THRESHOLD_PCT = 50;
/** MLTS-004 native-retention median-delta bound. */
export const DISPOSAL_STRESS_BOUND_BYTES = 16 * 1024 * 1024;
export const DISPOSAL_STRESS_CYCLES = 100;
/** Variance rule: any sample deviating more than this from the median triggers re-sampling. */
export const VARIANCE_DEVIATION_PCT = 15;
/** Minimum samples per measurement for a stable median. */
export const MIN_SAMPLES = 5;
/** Hard cap on variance-rule re-sampling retries. */
export const MAX_RESAMPLE_RETRIES = 3;

export interface CorpusManifestFile {
  readonly name: string;
  readonly extension: string;
  readonly bytes: number;
  readonly sha256: string;
}

export interface CorpusManifest {
  readonly version: number;
  readonly generatedBy: string;
  readonly fileCount: number;
  readonly totalBytes: number;
  readonly files: readonly CorpusManifestFile[];
  readonly corpusChecksum: string;
}

export interface CorpusEntry {
  readonly name: string;
  readonly extension: string;
  readonly bytes: number;
  readonly sha256: string;
  readonly source: Buffer;
}

/** Read and parse the frozen corpus manifest. */
export function readManifest(path: string = MANIFEST_PATH): CorpusManifest {
  const raw = readFileSync(path, "utf8");
  return JSON.parse(raw) as CorpusManifest;
}

/**
 * Compute the corpus checksum exactly as the generator does: SHA-256 over the
 * manifest JSON with the `corpusChecksum` field removed. Any on-disk drift in
 * file name/bytes/order changes this value.
 */
export function computeCorpusChecksum(manifest: CorpusManifest): string {
  const { corpusChecksum: _omitted, ...payload } = manifest;
  void _omitted;
  return createHash("sha256").update(JSON.stringify(payload, null, 2)).digest("hex");
}

export interface CorpusVerification {
  readonly ok: boolean;
  readonly manifestChecksum: string;
  readonly computedChecksum: string;
  readonly mismatched: readonly string[];
  readonly extras: readonly string[];
}

/**
 * Verify the on-disk corpus matches the manifest: every manifest file exists,
 * matches its recorded bytes + SHA-256, no extra files are present, and the
 * recomputed corpus checksum equals the manifest's checksum.
 */
export function verifyCorpus(path: string = MANIFEST_PATH): CorpusVerification {
  const manifest = readManifest(path);
  const computedChecksum = computeCorpusChecksum(manifest);
  const mismatched: string[] = [];
  const extras: string[] = [];
  const seen = new Set<string>();

  for (const file of manifest.files) {
    seen.add(file.name);
    const filePath = resolve(CORPUS_DIR, file.name);
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      mismatched.push(`${file.name}: missing`);
      continue;
    }
    if (stat.size !== file.bytes) {
      mismatched.push(`${file.name}: bytes ${stat.size} != ${file.bytes}`);
      continue;
    }
    const sha256 = createHash("sha256").update(readFileSync(filePath)).digest("hex");
    if (sha256 !== file.sha256) {
      mismatched.push(`${file.name}: sha256 ${sha256.slice(0, 12)} != ${file.sha256.slice(0, 12)}`);
    }
  }

  for (const entry of readdirSync(CORPUS_DIR)) {
    if (entry === "corpus-manifest.json") continue;
    if (!seen.has(entry)) extras.push(entry);
  }

  const checksumOk = computedChecksum === manifest.corpusChecksum;
  const ok = checksumOk && mismatched.length === 0 && extras.length === 0;
  return {
    ok,
    manifestChecksum: manifest.corpusChecksum,
    computedChecksum,
    mismatched,
    extras,
  };
}

/** Load every corpus file into memory, in manifest order. */
export function loadCorpus(path: string = MANIFEST_PATH): { manifest: CorpusManifest; entries: readonly CorpusEntry[] } {
  const manifest = readManifest(path);
  const entries: CorpusEntry[] = manifest.files.map((file) => {
    const filePath = resolve(CORPUS_DIR, file.name);
    const source = readFileSync(filePath);
    return {
      name: file.name,
      extension: file.extension,
      bytes: file.bytes,
      sha256: file.sha256,
      source,
    };
  });
  return { manifest, entries };
}

// ─── Statistics ─────────────────────────────────────────────────────────────

/** Median of a numeric sample (average of the two middle values for even N). */
export function median(values: readonly number[]): number {
  if (values.length === 0) throw new Error("median requires at least one value");
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1]! + ordered[middle]!) / 2
    : ordered[middle]!;
}

/** Spread ratio = (max - min) / median. 0 means perfectly stable. */
export function varianceRatio(values: readonly number[]): number {
  if (values.length === 0) throw new Error("varianceRatio requires at least one value");
  const med = median(values);
  if (med === 0) return Infinity;
  const max = Math.max(...values);
  const min = Math.min(...values);
  return (max - min) / med;
}

export interface VarianceVerdict {
  readonly stable: boolean;
  /** Largest single-sample deviation from the median, as a fraction (0.15 = 15%). */
  readonly maxDeviation: number;
}

/**
 * Variance rule: the sample set is stable iff every sample deviates <=
 * VARIANCE_DEVIATION_PCT from the median. Returns the worst deviation.
 */
export function varianceRule(values: readonly number[], thresholdPct = VARIANCE_DEVIATION_PCT): VarianceVerdict {
  if (values.length === 0) throw new Error("varianceRule requires at least one value");
  const med = median(values);
  const threshold = (thresholdPct / 100) * med;
  let maxDeviation = 0;
  for (const value of values) {
    const deviation = Math.abs(value - med);
    if (deviation > maxDeviation) maxDeviation = deviation;
  }
  const maxDeviationFraction = med === 0 ? Infinity : maxDeviation / med;
  return { stable: maxDeviation <= threshold, maxDeviation: maxDeviationFraction };
}

// ─── Threshold math ─────────────────────────────────────────────────────────

/**
 * Regression percentage of `candidate` vs `baseline` for a "higher is better"
 * metric (throughput). Returns the percent drop; 0 means no change.
 */
export function throughputRegressionPct(baselineBps: number, candidateBps: number): number {
  if (baselineBps <= 0) throw new Error("baseline throughput must be positive");
  if (candidateBps < 0) throw new Error("candidate throughput must be non-negative");
  return ((baselineBps - candidateBps) / baselineBps) * 100;
}

/**
 * Regression percentage for a "lower is better" metric (RSS). Returns the
 * percent growth; negative means the candidate used less memory.
 */
export function rssRegressionPct(baselineBytes: number, candidateBytes: number): number {
  if (baselineBytes <= 0) throw new Error("baseline RSS must be positive");
  if (candidateBytes < 0) throw new Error("candidate RSS must be non-negative");
  return ((candidateBytes - baselineBytes) / baselineBytes) * 100;
}

export interface BenchmarkVerdict {
  readonly throughputRegressionPct: number;
  readonly rssRegressionPct: number;
  readonly throughputPass: boolean;
  readonly rssPass: boolean;
  readonly disposalStressPass: boolean;
  readonly corpusChecksumMatch: boolean;
  readonly pass: boolean;
}

/** Apply the three DONE-WHEN thresholds plus the corpus/stress gates. */
export function evaluateVerdict(input: {
  baselineThroughputBps: number;
  candidateThroughputBps: number;
  baselineRssBytes: number;
  candidateRssBytes: number;
  disposalStressPass: boolean;
  corpusChecksumMatch: boolean;
}): BenchmarkVerdict {
  const throughputRegressionPctVal = throughputRegressionPct(
    input.baselineThroughputBps,
    input.candidateThroughputBps,
  );
  const rssRegressionPctVal = rssRegressionPct(input.baselineRssBytes, input.candidateRssBytes);
  const throughputPass = throughputRegressionPctVal <= THROUGHPUT_REGRESSION_THRESHOLD_PCT;
  const rssPass = rssRegressionPctVal <= RSS_REGRESSION_THRESHOLD_PCT;
  const pass =
    throughputPass &&
    rssPass &&
    input.disposalStressPass &&
    input.corpusChecksumMatch;
  return {
    throughputRegressionPct: throughputRegressionPctVal,
    rssRegressionPct: rssRegressionPctVal,
    throughputPass,
    rssPass,
    disposalStressPass: input.disposalStressPass,
    corpusChecksumMatch: input.corpusChecksumMatch,
    pass,
  };
}
