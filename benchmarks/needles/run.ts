#!/usr/bin/env bun
/**
 * Standalone needle-in-haystack harness for massa-ai chunker/search tuning.
 *
 * Self-contained retrieval pipeline — does NOT need the live tools-api stack:
 *   1. Read the fixture (needles + expected hits).
 *   2. Chunk every referenced source file with `smartChunk` (configurable).
 *   3. Embed the query + every chunk via the Ollama embedding endpoint
 *      (qwen3-embedding:8b by default — same model as the E2E baseline).
 *   4. Cosine-rank chunks per query, take top-K.
 *   5. Score with the same hit@k / MRR / ±line-tolerance rules as scorer.ts.
 *
 * Why standalone? The chunker is the lever this task tunes. Running retrieval
 * in-process isolates chunker effects from API/DB/RRF variance, giving stable,
 * reproducible before/after numbers. The live E2E test (14.needles.test.ts)
 * remains the full-stack gate; this harness is the fast chunker-quality signal.
 *
 * Usage (run from repo root):
 *   bun benchmarks/needles/run.ts                       # default config
 *   bun benchmarks/needles/run.ts --label after         # tag the report
 *   bun benchmarks/needles/run.ts --model nomic-embed-text
 *   bun benchmarks/needles/run.ts --codeChunkTarget 60 --chunkOverlapLines 6
 *   NEEDLE_FLOOR_MRR=0.5 bun benchmarks/needles/run.ts  # CI: exit 1 if below
 *
 * Environment:
 *   OLLAMA_HOST          Ollama base URL (default http://localhost:11434)
 *   NEEDLE_MODEL         Embedding model (default qwen3-embedding:8b)
 *   NEEDLE_FLOOR_HIT1    Exit 1 if hit@1 below this float (default: off)
 *   NEEDLE_FLOOR_MRR     Exit 1 if MRR below this float (default: off)
 *
 * Output: prints a per-needle table + aggregate metrics, and writes a results
 * JSON + Markdown report under benchmarks/needles/reports/ (gitignored).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { smartChunk, type ChunkerConfig, type Chunk } from "../../packages/core/src/services/search/smart-chunker.ts";

// ── Types (mirror fixtures/massa-ai.json + scorer.ts) ───────────────────
interface NeedleExpected {
  filePath: string;
  lineStart: number;
  lineEnd: number;
}
interface Needle {
  id: string;
  category: string;
  difficulty: "easy" | "medium" | "hard";
  query: string;
  expected: NeedleExpected;
  rationale: string;
}
interface Dataset {
  projectId: string;
  version: string;
  description: string;
  scoring: { topK: number; hitAtK: number[]; lineTolerance: number; notes: string };
  needles: Needle[];
}
interface Hit {
  filePath: string;
  lineStart: number;
  lineEnd: number;
  score: number;
}
interface RawResult {
  needleId: string;
  query: string;
  hits: Hit[];
  latencyMs?: number;
}
interface ResultsFile {
  projectId: string;
  ranAt: string;
  config: Record<string, unknown>;
  model: string;
  results: RawResult[];
}

// ── Scoring (verbatim semantics from benchmarks/needles/scorer.ts) ─────────
function intersects(a: [number, number], b: [number, number], tol: number): boolean {
  const aStart = a[0] - tol;
  const aEnd = a[1] + tol;
  return !(aEnd < b[0] || aStart > b[1]);
}
function findRank(needle: Needle, hits: Hit[], tol: number): { rank: number | null; hit: Hit | null } {
  for (let i = 0; i < hits.length; i++) {
    const h = hits[i];
    if (
      h.filePath === needle.expected.filePath &&
      intersects([h.lineStart, h.lineEnd], [needle.expected.lineStart, needle.expected.lineEnd], tol)
    ) {
      return { rank: i + 1, hit: h };
    }
  }
  return { rank: null, hit: null };
}

// ── Embedding (Ollama /api/embeddings, bounded-parallel pool) ─────────────
const OLLAMA_HOST = process.env.OLLAMA_HOST ?? "http://localhost:11434";
const DEFAULT_MODEL = process.env.NEEDLE_MODEL ?? "qwen3-embedding:8b";

async function embed(text: string, model: string): Promise<number[]> {
  // Ollama on a constrained CI runner can serialize/queue concurrent embedding
  // requests, so a single request can exceed a tight per-call timeout. Use a
  // generous timeout and retry transient failures (abort under contention, a
  // dropped connection) so one slow request never sinks the whole run.
  const maxAttempts = 3;
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 300_000);
    try {
      const res = await fetch(`${OLLAMA_HOST}/api/embeddings`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ model, prompt: text.slice(0, 8000) }),
        signal: ctrl.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings HTTP ${res.status}: ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding?: number[]; error?: string };
      if (!json.embedding) throw new Error(`Ollama error: ${json.error ?? "no embedding"}`);
      return json.embedding;
    } catch (err) {
      lastError = err;
      if (attempt === maxAttempts) break;
      await new Promise((r) => setTimeout(r, 1000 * attempt));
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
}

function cosine(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// Bounded-concurrency map that preserves input order (results[i] ↔ items[i]).
// This standalone harness hits localhost Ollama over plain HTTP — there is no
// live-stack embedding mutex here, so embedding can safely fan out. Determinism
// is preserved by index alignment plus sequential scoring downstream.
// Default 1 (sequential): the embed phase is Ollama-bound, and on a constrained
// CI runner an 8B model serializes concurrent requests — fanning out mostly adds
// per-call timeout risk (a queued request aborts). Raise NEEDLE_EMBED_CONCURRENCY
// only on hosts where Ollama truly parallelizes (num_parallel > 1, enough RAM/CPU).
const EMBED_CONCURRENCY = Math.max(1, Number(process.env.NEEDLE_EMBED_CONCURRENCY ?? "1") || 1);

async function mapPool<T, R>(
  items: T[],
  worker: (item: T, index: number) => Promise<R>,
  concurrency: number,
  onProgress?: (done: number, total: number) => void,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  const total = items.length;
  let next = 0;
  let done = 0;
  const size = Math.max(1, Math.min(concurrency, total));
  async function run(): Promise<void> {
    while (true) {
      const i = next++;
      if (i >= total) return;
      results[i] = await worker(items[i], i);
      done++;
      onProgress?.(done, total);
    }
  }
  await Promise.all(Array.from({ length: size }, () => run()));
  return results;
}

// ── CLI args ───────────────────────────────────────────────────────────────
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

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = parseArgs(process.argv.slice(2));
  const repoRoot = resolve(import.meta.dir, "..", "..");
  const fixturePath = resolve(
    repoRoot,
    args.dataset ?? "benchmarks/needles/fixtures/massa-ai.json",
  );
  if (!existsSync(fixturePath)) {
    console.error(`Fixture not found: ${fixturePath}`);
    process.exit(2);
  }
  const dataset: Dataset = JSON.parse(readFileSync(fixturePath, "utf8"));
  const model = args.model ?? DEFAULT_MODEL;

  // Chunker config overrides (for tuning sweeps).
  const cfgOverride: Partial<ChunkerConfig> = {};
  for (const k of ["maxChunkLines", "minChunkLines", "codeChunkTarget", "fixedChunkSize", "chunkOverlapLines", "maxChunkChars"] as const) {
    if (args[k] !== undefined) {
      const n = Number(args[k]);
      if (Number.isFinite(n)) (cfgOverride as Record<string, number>)[k] = n;
    }
  }
  if (args.addFileContext !== undefined) cfgOverride.addFileContext = args.addFileContext === "true";

  // Collect the set of source files referenced by needles, chunk each once.
  const files = Array.from(new Set(dataset.needles.map((n) => n.expected.filePath)));
  type ChunkRec = { filePath: string; lineStart: number; lineEnd: number; content: string };
  const allChunks: ChunkRec[] = [];
  const chunkStats: Record<string, { chunks: number; avgLines: number; avgChars: number }> = {};
  for (const rel of files) {
    const abs = resolve(repoRoot, rel);
    if (!existsSync(abs)) {
      console.error(`[warn] needle file missing, skipping: ${rel}`);
      continue;
    }
    const content = readFileSync(abs, "utf8");
    const chunks: Chunk[] = smartChunk(content, rel, cfgOverride);
    for (const c of chunks) {
      allChunks.push({
        filePath: rel,
        lineStart: c.lineStart,
        lineEnd: c.lineEnd,
        content: c.content,
      });
    }
    const lineCounts = chunks.map((c) => c.content.split("\n").length);
    const charCounts = chunks.map((c) => c.content.length);
    chunkStats[rel] = {
      chunks: chunks.length,
      avgLines: lineCounts.length ? +(lineCounts.reduce((a, b) => a + b, 0) / lineCounts.length).toFixed(1) : 0,
      avgChars: charCounts.length ? +(charCounts.reduce((a, b) => a + b, 0) / charCounts.length).toFixed(0) : 0,
    };
  }

  console.log(`\n=== Needle harness — ${dataset.projectId} ===`);
  console.log(`model: ${model}`);
  console.log(`chunker cfg override:`, cfgOverride);
  console.log(`files: ${files.length}, total chunks: ${allChunks.length}`);
  for (const [f, s] of Object.entries(chunkStats)) {
    console.log(`  ${f}: ${s.chunks} chunks (avg ${s.avgLines}L / ${s.avgChars}ch)`);
  }

  // Embed all chunk contents ONCE (cache by content; queries are separate).
  console.log(`\nEmbedding ${allChunks.length} chunks (concurrency ${EMBED_CONCURRENCY})...`);
  const chunkVecs = await mapPool(
    allChunks,
    (c) => embed(c.content, model),
    EMBED_CONCURRENCY,
    (d, t) => {
      if (d % 10 === 0 || d === t) process.stdout.write(`\r  ${d}/${t}`);
    },
  );
  process.stdout.write("\r                       \r");

  // Per-needle retrieval.
  const tol = dataset.scoring.lineTolerance;
  const topK = dataset.scoring.topK;
  const perNeedle: Array<{
    id: string; difficulty: string; query: string;
    rank: number | null; topHit: Hit | null; expected: NeedleExpected;
    reciprocalRank: number; empty: boolean;
  }> = [];
  const rawResults: RawResult[] = [];
  const emptyNeedles: string[] = [];

  // Pre-embed all query vectors in parallel; retrieval + scoring stays sequential
  // so per-needle output ordering (and the printed table) stays deterministic.
  console.log(`\nEmbedding ${dataset.needles.length} queries (concurrency ${EMBED_CONCURRENCY})...`);
  const queryVecs = await mapPool(dataset.needles, (n) => embed(n.query, model), EMBED_CONCURRENCY);
  console.log(`\nRetrieving ${dataset.needles.length} needles (rank + score)...`);
  for (let ni = 0; ni < dataset.needles.length; ni++) {
    const needle = dataset.needles[ni];
    const qStart = Date.now();
    const qVec = queryVecs[ni];
    const scored = allChunks
      .map((c, i) => ({ c, sim: cosine(qVec, chunkVecs[i]) }))
      .sort((a, b) => b.sim - a.sim);
    const hits: Hit[] = scored.slice(0, topK).map((s) => ({
      filePath: s.c.filePath,
      lineStart: s.c.lineStart,
      lineEnd: s.c.lineEnd,
      score: +s.sim.toFixed(4),
    }));
    const empty = hits.length === 0;
    if (empty) emptyNeedles.push(needle.id);
    const { rank } = findRank(needle, hits, tol);
    perNeedle.push({
      id: needle.id,
      difficulty: needle.difficulty,
      query: needle.query,
      rank,
      topHit: hits[0] ?? null,
      expected: needle.expected,
      reciprocalRank: rank ? 1 / rank : 0,
      empty,
    });
    rawResults.push({ needleId: needle.id, query: needle.query, hits, latencyMs: Date.now() - qStart });
  }

  const total = perNeedle.length;
  const hitAt1 = perNeedle.filter((e) => e.rank !== null && e.rank <= 1).length / total;
  const hitAt3 = perNeedle.filter((e) => e.rank !== null && e.rank <= 3).length / total;
  const hitAt5 = perNeedle.filter((e) => e.rank !== null && e.rank <= 5).length / total;
  const hitAt10 = perNeedle.filter((e) => e.rank !== null && e.rank <= 10).length / total;
  const mrr = perNeedle.reduce((s, e) => s + e.reciprocalRank, 0) / total;

  // Print per-needle table.
  console.log("\nper-needle:");
  console.log("  id                                diff     rank  hit         expected");
  for (const e of perNeedle) {
    const rank = e.rank === null ? "—" : String(e.rank);
    const hit = e.rank === null ? "MISS" : `@${e.rank}`;
    const top = e.topHit ? `${e.topHit.filePath}:${e.topHit.lineStart}-${e.topHit.lineEnd}` : "(no hits)";
    console.log(
      `  ${e.id.padEnd(33)}  ${e.difficulty.padEnd(6)}  ${String(rank).padStart(4)}  ${hit.padEnd(10)}  ${e.expected.filePath}:${e.expected.lineStart}-${e.expected.lineEnd}`,
    );
    if (e.rank === null || e.rank > 5) {
      console.log(`    ↳ top: ${top}`);
    }
  }

  console.log("\naggregate:");
  console.log(`  hit@1  = ${(hitAt1 * 100).toFixed(1)}%`);
  console.log(`  hit@3  = ${(hitAt3 * 100).toFixed(1)}%`);
  console.log(`  hit@5  = ${(hitAt5 * 100).toFixed(1)}%`);
  console.log(`  hit@10 = ${(hitAt10 * 100).toFixed(1)}%`);
  console.log(`  MRR    = ${mrr.toFixed(3)}`);
  if (emptyNeedles.length > 0) console.log(`  empty-result needles: ${emptyNeedles.join(", ")}`);

  // Write report (gitignored dir).
  const label = args.label ?? `run-${new Date().toISOString().replace(/[:.]/g, "").slice(0, 15)}`;
  const reportsDir = resolve(repoRoot, "benchmarks/needles/reports");
  mkdirSync(reportsDir, { recursive: true });
  const resultsFile: ResultsFile = {
    projectId: dataset.projectId,
    ranAt: new Date().toISOString(),
    model,
    config: { ...cfgOverride, totalChunks: allChunks.length },
    results: rawResults,
  };
  const resultsPath = resolve(reportsDir, `massa-ai-${label}-results.json`);
  writeFileSync(resultsPath, JSON.stringify(resultsFile, null, 2));
  console.log(`\nresults: ${resultsPath}`);

  // CI floor gate.
  const floorHit1 = process.env.NEEDLE_FLOOR_HIT1 ? Number(process.env.NEEDLE_FLOOR_HIT1) : null;
  const floorMrr = process.env.NEEDLE_FLOOR_MRR ? Number(process.env.NEEDLE_FLOOR_MRR) : null;
  let failed = false;
  if (floorHit1 !== null) {
    const ok = hitAt1 >= floorHit1;
    console.log(`[gate] hit@1 ${hitAt1.toFixed(3)} >= ${floorHit1} → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) failed = true;
  }
  if (floorMrr !== null) {
    const ok = mrr >= floorMrr;
    console.log(`[gate] MRR ${mrr.toFixed(3)} >= ${floorMrr} → ${ok ? "PASS" : "FAIL"}`);
    if (!ok) failed = true;
  }
  if (failed) process.exit(1);
}

await main();
