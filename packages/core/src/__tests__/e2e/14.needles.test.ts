/**
 * T10 — Needles benchmark (E2E, live stack).
 *
 * Domain: search quality — needle-in-haystack retrieval against the running
 * massa-ai instance. Read-only: no production source / route edits, no
 * restart of tools-api (pid 9524), no dist rebuild, no DB schema changes.
 *
 * Strategy:
 *  - Reuses the shared index `e2e-ai-shared` (indexed ONCE across the whole
 *    E2E suite via ensureSharedIndex). Do NOT reset SHARED_PID.
 *  - Loads the dogfood corpus from benchmarks/needles/fixtures/massa-ai.json
 *    (14 needles covering string-literal magic, business-rule utilities,
 *    cross-file event coupling, cross-language stack).
 *  - Reuses scorer semantics from benchmarks/needles/scorer.ts (hit@1/3/5/10 +
 *    MRR + ±5 line tolerance, filePath equality + line-range intersection).
 *  - For each needle: ONE search = ONE Ollama embed (~10-40s on this host).
 *    Run needles SEQUENTIALLY (no Promise.all — Ollama mutex serializes and
 *    parallel embeds risk OOM). One big `test()` with a high timeout.
 *
 * Scenarios:
 *  - F-NEEDLE-1: aggregate hit@1/hit@5/MRR floors (CONSERVATIVE — set to ~80%
 *    of the observed warm baseline so the test is a regression guard, not an
 *    aspirational target). See OBSERVED_BASELINE below.
 *  - F-NEEDLE-2: every needle returns SOMETHING (no empty result arrays). A
 *    needle returning 0 hits is reported as a search-quality finding and
 *    skipped, not failed.
 *  - F-NEEDLE-3 (determinism): re-run the benchmark once more in the same test
 *    and assert the two runs' hit@k counts are identical (warm-cache ranking
 *    stability).
 *
 * OBSERVED_BASELINE (warm shared index, qwen3-embedding:8b, PostgreSQL):
 *   T7 lift (fixture refresh + chunk overlap):
 *     hit@1  = 0.500  (7/14)
 *     hit@3  = 0.643  (9/14)
 *     hit@5  = 0.714  (10/14)
 *     hit@10 = 0.714  (10/14)
 *     MRR    = 0.586
 *   Pre-T7 (stale fixture ranges, no overlap):
 *     hit@1  = 0.357  (5/14)
 *     hit@5  = 0.571  (8/14)
 *     MRR    = 0.443
 * Floors below are derived from the T7 baseline at ~80% (rounded down) so a
 * catastrophic regression trips the test while normal embed jitter does not.
 * Determinism: two sequential sweeps on the warm index produced IDENTICAL
 * per-needle ranks (zero rank drift) — embedding cache yields stable ranking.
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import {
  E2E_ENABLED,
  probeAvailability,
  ensureSharedIndex,
  PROJECT_PATH,
} from "./_helpers";

// ── Gating ────────────────────────────────────────────────────────────────
// Two-stage gate: RUN_E2E + API up + Ollama up (search needs embeddings).
const READY = await (async () => {
  if (!E2E_ENABLED) return false;
  const a = await probeAvailability();
  return a.API_UP && a.OLLAMA_UP;
})();

// ── Long-timeout POST (shared helper caps at 120s; search embeds can exceed) ─
async function postLong<T = any>(endpoint: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  const key = process.env.MASSA_AI_API_KEY ?? "";
  if (key) headers["x-api-key"] = key;
  const api = process.env.MASSA_AI_API_URL ?? "http://localhost:3333";
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${api}${endpoint}`, {
      method: "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

// ── Dataset + scorer (imported from the repo, read-only) ────────────────────
const FIXTURE_PATH = path.join(
  PROJECT_PATH,
  "benchmarks/needles/fixtures/massa-ai.json",
);

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

/** Replicates scorer.ts#intersects with ±tol on each side of range a. */
function intersects(a: [number, number], b: [number, number], tol: number): boolean {
  const aStart = a[0] - tol;
  const aEnd = a[1] + tol;
  return !(aEnd < b[0] || aStart > b[1]);
}

/** Replicates scorer.ts#findRank: first hit matching filePath + line intersect. */
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

interface SweepResult {
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
  hitAt10: number;
  mrr: number;
  perNeedle: Array<{
    id: string;
    difficulty: string;
    query: string;
    rank: number | null;
    topHit: Hit | null;
    expected: NeedleExpected;
    reciprocalRank: number;
    empty: boolean;
  }>;
  emptyNeedles: string[];
}

/** Run the full needle sweep against the shared index, sequentially. */
async function runSweep(pid: string, dataset: Dataset): Promise<SweepResult> {
  const tol = dataset.scoring.lineTolerance;
  const perNeedle: SweepResult["perNeedle"] = [];
  const emptyNeedles: string[] = [];

  for (const needle of dataset.needles) {
    const r = await postLong<any>(
      "/api/v1/search/project",
      {
        query: needle.query,
        projectId: pid,
        maxResults: 10,
        minScore: 0.05,
        format: "json",
      },
      90_000,
    );
    const hits: Hit[] = (r?.data?.results ?? []).map((x: any) => ({
      filePath: String(x.filePath),
      lineStart: Number(x.lineStart ?? 0),
      lineEnd: Number(x.lineEnd ?? 0),
      score: Number(x.score ?? 0),
    }));
    const empty = hits.length === 0;
    if (empty) emptyNeedles.push(needle.id);
    const { rank, hit } = findRank(needle, hits, tol);
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
  }

  const total = perNeedle.length;
  const hitAt1 = perNeedle.filter((e) => e.rank !== null && e.rank <= 1).length / total;
  const hitAt3 = perNeedle.filter((e) => e.rank !== null && e.rank <= 3).length / total;
  const hitAt5 = perNeedle.filter((e) => e.rank !== null && e.rank <= 5).length / total;
  const hitAt10 = perNeedle.filter((e) => e.rank !== null && e.rank <= 10).length / total;
  const mrr = perNeedle.reduce((s, e) => s + e.reciprocalRank, 0) / total;

  return { hitAt1, hitAt3, hitAt5, hitAt10, mrr, perNeedle, emptyNeedles };
}

function printTable(label: string, s: SweepResult): void {
  console.log(`\n=== T10 Needles — ${label} ===`);
  console.log("per-needle:");
  console.log(
    "  id                              diff     rank  hit  expected",
  );
  for (const e of s.perNeedle) {
    const rank = e.rank === null ? "—" : String(e.rank);
    const hit = e.rank === null ? "MISS" : `@${e.rank}`;
    const top = e.topHit ? `${e.topHit.filePath}:${e.topHit.lineStart}-${e.topHit.lineEnd}` : "(no hits)";
    console.log(
      `  ${e.id.padEnd(30)}  ${e.difficulty.padEnd(6)}  ${String(rank).padStart(4)}  ${hit.padEnd(5)}  ${e.expected.filePath}:${e.expected.lineStart}-${e.expected.lineEnd}`,
    );
    if (e.rank === null || e.rank > 5) {
      console.log(`    ↳ top: ${top}`);
    }
  }
  console.log("\naggregate:");
  console.log(`  hit@1  = ${(s.hitAt1 * 100).toFixed(1)}%`);
  console.log(`  hit@3  = ${(s.hitAt3 * 100).toFixed(1)}%`);
  console.log(`  hit@5  = ${(s.hitAt5 * 100).toFixed(1)}%`);
  console.log(`  hit@10 = ${(s.hitAt10 * 100).toFixed(1)}%`);
  console.log(`  MRR    = ${s.mrr.toFixed(3)}`);
  if (s.emptyNeedles.length > 0) {
    console.log(`  empty-result needles: ${s.emptyNeedles.join(", ")}`);
  }
}

describe.skipIf(!READY)("T10 needles benchmark", () => {
  let pid: string;
  let dataset: Dataset;

  beforeAll(async () => {
    pid = await ensureSharedIndex();
    dataset = JSON.parse(readFileSync(FIXTURE_PATH, "utf8"));
  }, 700_000);

  test(
    "F-NEEDLE-1/2/3: needle sweep — hit@k floors, non-empty results, determinism",
    async () => {
      // ── Run #1 ──────────────────────────────────────────────────────────
      const sweep1 = await runSweep(pid, dataset);
      printTable("run #1", sweep1);

      // F-NEEDLE-2: every needle returns SOMETHING. A needle returning 0 hits
      // is a search-quality finding — report it. We do NOT fail the suite on
      // empty results (per task contract), but surface them prominently.
      if (sweep1.emptyNeedles.length > 0) {
        console.log(
          `[T10] FINDING — ${sweep1.emptyNeedles.length} needle(s) returned zero results: ` +
            sweep1.emptyNeedles.join(", "),
        );
      }
      // Defensive: assert the API didn't error out wholesale (at least some
      // needle returned hits). If literally every needle is empty, that's a
      // broken stack, not a quality finding.
      const anyHits = sweep1.perNeedle.some((e) => !e.empty);
      expect(anyHits).toBe(true);

      // ── Run #2 (determinism — F-NEEDLE-3) ───────────────────────────────
      const sweep2 = await runSweep(pid, dataset);
      printTable("run #2 (determinism)", sweep2);

      // F-NEEDLE-3: warm-cache ranking must be stable on a warm index.
      // Tolerance: exact equality on hit@k counts.
      expect(sweep2.hitAt1).toBe(sweep1.hitAt1);
      expect(sweep2.hitAt3).toBe(sweep1.hitAt3);
      expect(sweep2.hitAt5).toBe(sweep1.hitAt5);
      expect(sweep2.hitAt10).toBe(sweep1.hitAt10);

      // Also compare per-needle ranks for stability visibility.
      let rankDrift = 0;
      for (let i = 0; i < sweep1.perNeedle.length; i++) {
        const a = sweep1.perNeedle[i].rank;
        const b = sweep2.perNeedle[i].rank;
        if (a !== b) {
          rankDrift++;
          console.log(
            `[T10] rank drift ${sweep1.perNeedle[i].id}: run1=${a ?? "—"} run2=${b ?? "—"}`,
          );
        }
      }
      // hit@k equality is the contract; rank drift within the same hit@k bucket
      // is tolerated by the spec. Surface it but don't fail on it.

      // ── F-NEEDLE-1: conservative regression floors ──────────────────────
      // OBSERVED_BASELINE (T7 lift: fixture refresh + chunk overlap; warm shared
      // index, this host; two sequential sweeps identical):
      //   hit@1 = 0.500 (7/14)  hit@3 = 0.643 (9/14)
      //   hit@5 = 0.714 (10/14) hit@10= 0.714 (10/14)
      //   MRR   = 0.586
      // Floors set at ~80% of baseline (rounded DOWN to the nearest whole
      // needle so the test only trips on a real regression, not jitter):
      //   hit@1 ≥ 5/14 ≈ 0.357 → floor 0.36   (was 0.28 pre-T7)
      //   hit@5 ≥ 9/14 ≈ 0.643 → floor 0.64   (was 0.57 pre-T7)
      //   MRR  ≥ 0.47              (was 0.40 pre-T7)
      // Pre-T7 floors (0.28/0.57/0.4) were derived from a stale-fixture
      // baseline (0.357/0.571/0.443); the T7 fixture refresh + chunk overlap
      // lifted quality ~40% on hit@1, so the floors rise with it. Every new
      // floor is ≥ its pre-T7 value — this is a quality lift, not a carve-out.
      // We assert against the FIRST run (warm cache); if run #1 dipped, run #2
      // almost certainly dipped too, so this is the right gate.
      const HIT1_FLOOR = 0.36;
      const HIT5_FLOOR = 0.64;
      const MRR_FLOOR = 0.47;

      console.log("\n=== T10 regression floors ===");
      console.log(`  hit@1 ${sweep1.hitAt1.toFixed(3)} ≥ ${HIT1_FLOOR}  → ${sweep1.hitAt1 >= HIT1_FLOOR ? "PASS" : "FAIL"}`);
      console.log(`  hit@5 ${sweep1.hitAt5.toFixed(3)} ≥ ${HIT5_FLOOR}  → ${sweep1.hitAt5 >= HIT5_FLOOR ? "PASS" : "FAIL"}`);
      console.log(`  MRR   ${sweep1.mrr.toFixed(3)} ≥ ${MRR_FLOOR}   → ${sweep1.mrr >= MRR_FLOOR ? "PASS" : "FAIL"}`);

      expect(sweep1.hitAt1).toBeGreaterThanOrEqual(HIT1_FLOOR);
      expect(sweep1.hitAt5).toBeGreaterThanOrEqual(HIT5_FLOOR);
      expect(sweep1.mrr).toBeGreaterThanOrEqual(MRR_FLOOR);
    },
    // 14 needles × 2 runs × ~40s worst-case embed = ~1120s; pad to 1500s.
    1_500_000,
  );
});
