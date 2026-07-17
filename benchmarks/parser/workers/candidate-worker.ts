/**
 * Candidate measurement worker (runs in a FRESH child process).
 *
 * Loads the frozen corpus, parses every file through the current tree-sitter
 * `StructuralRuntime`, and prints a single JSON line with throughput + peak RSS
 * for ONE sample. The parent spawns N of these for stable medians.
 *
 * Protocol: prints `BENCH_SAMPLE_RESULT=<json>\n` on stdout. Any error is
 * printed to stderr and the process exits non-zero.
 *
 * Mode "stress" runs the 100-cycle explicit-disposal / forced-GC native-
 * retention sensor. This reuses the verifier's EXACT method (a single reused
 * raw `Parser`, explicit `tree.delete()`, `Bun.gc(true)` per cycle, 16 MiB
 * median-delta bound) to validate MLTS-004 native binding disposal in the
 * benchmark's own process. The full StructuralRuntime path is already covered
 * by structural-runtime.test.ts (TASK-005).
 *
 * Invocation:
 *   bun benchmarks/parser/workers/candidate-worker.ts throughput
 *   bun benchmarks/parser/workers/candidate-worker.ts stress
 */

import { structuralRuntime } from "@massa-th0th/core/services";
// Reach into the core source for the validated grammar set + manifest. The
// services barrel does not re-export these internals, and the stress sensor
// needs the same validated native binding the StructuralRuntime loads.
import {
  getValidatedNativeGrammarSet,
  validateAllGrammars,
} from "../../../packages/core/src/services/structural/parser-readiness.ts";
import { grammarArtifactKey } from "../../../packages/core/src/services/structural/grammar-loaders.ts";
import { LANGUAGE_MANIFEST } from "../../../packages/core/src/services/structural/language-manifest.ts";
import { loadCorpus, DISPOSAL_STRESS_CYCLES, DISPOSAL_STRESS_BOUND_BYTES, median } from "../harness.ts";

const RESULT_PREFIX = "BENCH_SAMPLE_RESULT=";

interface ThroughputSample {
  readonly kind: "throughput";
  readonly sampleIndex: number;
  readonly elapsedSeconds: number;
  readonly totalBytes: number;
  readonly throughputBps: number;
  readonly peakRssBytes: number;
  readonly fileCount: number;
}

interface StressSample {
  readonly kind: "stress";
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

type Sample = ThroughputSample | StressSample;

function emit(sample: Sample): void {
  process.stdout.write(`${RESULT_PREFIX}${JSON.stringify(sample)}\n`);
}

async function measureThroughput(sampleIndex: number): Promise<ThroughputSample> {
  const { entries } = loadCorpus();
  const totalBytes = entries.reduce((sum, entry) => sum + entry.bytes, 0);
  let peakRss = process.memoryUsage().rss;
  const start = performance.now();
  for (const entry of entries) {
    await structuralRuntime.parse({
      extension: entry.extension,
      source: entry.source,
    });
    const rss = process.memoryUsage().rss;
    if (rss > peakRss) peakRss = rss;
  }
  const elapsedSeconds = (performance.now() - start) / 1000;
  const throughputBps = elapsedSeconds > 0 ? totalBytes / elapsedSeconds : 0;
  return { kind: "throughput", sampleIndex, elapsedSeconds, totalBytes, throughputBps, peakRssBytes: peakRss, fileCount: entries.length };
}

/**
 * 100-cycle explicit-disposal / forced-GC native-retention sensor (CANDIDATE).
 *
 * Reuses the verifier's EXACT method (scripts/verify-tree-sitter-grammars.ts):
 * a single reused raw `Parser` loaded from the same consumer entry, parse a
 * >=32 KiB deterministic source 100 times, explicitly `tree.delete()` each
 * cycle, call `Bun.gc(true)` per cycle, and bound the cycles-81-to-100 median
 * RSS to within DISPOSAL_STRESS_BOUND_BYTES (16 MiB) of the cycles-21-to-40
 * median. This validates MLTS-004 native binding disposal in the benchmark's
 * own process. The full StructuralRuntime path (parse + query-pack + adapter)
 * is already covered by structural-runtime.test.ts (TASK-005).
 */
async function measureStress(): Promise<StressSample> {
  // Load the candidate's own validated native grammar set — the same patched
  // tree-sitter binding the StructuralRuntime uses. This handles the Bun
  // version masking and consumer-entry resolution the same way readiness does.
  await validateAllGrammars();
  const loaded = getValidatedNativeGrammarSet();
  const jsEntry = LANGUAGE_MANIFEST.find((entry) => entry.extension === ".js")!;
  const grammar = loaded.grammars.get(grammarArtifactKey(jsEntry.grammarArtifact));
  if (!grammar) throw new Error("validated grammar set lacks the JavaScript grammar");
  const parser = new loaded.Parser();
  parser.setLanguage(grammar);

  // Deterministic >=32 KiB JS source (identical shape to the verifier's).
  const source = Array.from(
    { length: 768 },
    (_, index) => `function value_${index}(input) { return input + ${index}; }\n`,
  ).join("");
  if (Buffer.byteLength(source) < 32 * 1024) {
    throw new Error(`stress source is ${Buffer.byteLength(source)} bytes, need >= 32 KiB`);
  }

  const samples: number[] = [];
  for (let cycle = 0; cycle < DISPOSAL_STRESS_CYCLES; cycle += 1) {
    const tree = parser.parse(source);
    try {
      if (tree.rootNode.hasError) {
        throw new Error(`stress cycle ${cycle + 1} produced a parse error`);
      }
    } finally {
      // Explicit disposal — the exact path the verifier exercises.
      tree.delete();
    }
    Bun.gc(true);
    samples.push(process.memoryUsage().rss);
  }

  const firstRss = samples[0]!;
  const lastRss = samples.at(-1)!;
  const growthBytes = lastRss - firstRss;
  const cycles21To40Median = median(samples.slice(20, 40));
  const cycles81To100Median = median(samples.slice(80, 100));
  const medianDeltaBytes = cycles81To100Median - cycles21To40Median;
  const pass = medianDeltaBytes <= DISPOSAL_STRESS_BOUND_BYTES;
  return {
    kind: "stress",
    cycles: DISPOSAL_STRESS_CYCLES,
    firstRss,
    lastRss,
    growthBytes,
    cycles21To40Median,
    cycles81To100Median,
    medianDeltaBytes,
    boundBytes: DISPOSAL_STRESS_BOUND_BYTES,
    pass,
  };
}

async function main(): Promise<void> {
  const mode = (process.argv[2] ?? "throughput") as "throughput" | "stress";
  if (mode === "stress") {
    emit(await measureStress());
    return;
  }
  const sampleIndex = Number(process.argv[3] ?? "0");
  emit(await measureThroughput(sampleIndex));
}

main().catch((error) => {
  process.stderr.write(`candidate-worker fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}\n`);
  process.exit(1);
});
