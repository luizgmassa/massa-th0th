/**
 * Lexical search helpers: trigram query sanitization, Levenshtein fuzzy
 * correction, and proximity/title re-ranking.
 *
 * These are pure functions (no I/O, no DB coupling) so they can be unit-tested
 * in isolation and shared across the PostgreSQL + PG keyword stores and the fusion
 * layer in contextual-search-rlm.ts.
 *
 * Algorithm references (rewritten fresh in TS, not copied):
 *  - RRF multi-stream fusion + proximity rerank: Cormack et al. 2009; the
 *    minSpan/adjacent-pair window approach layers a positional signal on top
 *    of rank-based RRF.
 *  - Levenshtein fuzzy correction over a per-store vocabulary table,
 *    length-bounded by maxEditDistance and LRU-cached at the call site.
 */

import type { SearchResult } from "@massa-ai/shared";

// ─────────────────────────────────────────────────────────────────────────────
// Stopwords
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Common words that match everywhere and dilute BM25/proximity scoring.
 * Filtered from proximity/title/fuzzy paths; kept as a fallback when every
 * query term is a stopword so a query never produces an empty term list.
 */
export const STOPWORDS = new Set<string>([
  "the", "and", "for", "are", "but", "not", "you", "all", "can", "had",
  "her", "was", "one", "our", "out", "has", "his", "how", "its", "may",
  "new", "now", "old", "see", "way", "who", "did", "get", "got", "let",
  "say", "she", "too", "use", "will", "with", "this", "that", "from",
  "they", "been", "have", "many", "some", "them", "than", "each", "make",
  "like", "just", "over", "such", "take", "into", "year", "your", "good",
  "could", "would", "about", "which", "their", "there", "other", "after",
  "should", "through", "also", "more", "most", "only", "very", "when",
  "what", "then", "these", "those", "being", "does", "done", "both",
  "same", "still", "while", "where", "here", "were", "much",
]);

// ─────────────────────────────────────────────────────────────────────────────
// Trigram query sanitization
// ─────────────────────────────────────────────────────────────────────────────

function dedupeTokens(tokens: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const t of tokens) {
    const key = t.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      out.push(t);
    }
  }
  return out;
}

/**
 * Build an FTS5 trigram MATCH expression from a raw query.
 *
 * Trigram tokenizers match 3-char substrings, so very short tokens (<3 chars)
 * are dropped (they cannot form a trigram and would yield zero matches). The
 * result is an OR-joined quoted-token list suitable for `WHERE tbl MATCH ?`.
 * Returns "" when no usable tokens remain — callers should treat "" as
 * "skip the trigram stream".
 *
 * mode "OR" broadens recall (any token matches); "AND" narrows it. We default
 * to OR so the trigram stream supplements (not replaces) the porter keyword
 * stream in RRF fusion.
 */
export function sanitizeTrigramQuery(
  query: string,
  mode: "AND" | "OR" = "OR",
): string {
  const cleaned = query.replace(/["'(){}[\]*:^~]/g, "").trim();
  if (cleaned.length < 3) return "";
  const words = dedupeTokens(
    cleaned.split(/\s+/).filter((w) => w.length >= 3),
  );
  if (words.length === 0) return "";

  const meaningful = words.filter((w) => !STOPWORDS.has(w.toLowerCase()));
  const final = meaningful.length > 0 ? meaningful : words;

  return final.map((w) => `"${w}"`).join(mode === "OR" ? " OR " : " ");
}

// ─────────────────────────────────────────────────────────────────────────────
// Levenshtein fuzzy correction
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classic two-row Levenshtein edit distance. O(a.length * b.length) time,
 * O(b.length) space.
 */
export function levenshtein(a: string, b: string): number {
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      curr[j] =
        a[i - 1] === b[j - 1]
          ? prev[j - 1]
          : 1 + Math.min(prev[j], curr[j - 1], prev[j - 1]);
    }
    prev = curr;
  }
  return prev[b.length];
}

/**
 * Length-tolerant max edit distance. Longer words tolerate more edits because
 * a single typo/inflection is proportionally smaller. Short words (≤4 chars)
 * get distance 1 to avoid spurious corrections of "is"→"if" style noise.
 */
export function maxEditDistance(wordLength: number): number {
  if (wordLength <= 4) return 1;
  if (wordLength <= 12) return 2;
  return 3;
}

// ─────────────────────────────────────────────────────────────────────────────
// Proximity helpers (positional re-ranking)
// ─────────────────────────────────────────────────────────────────────────────

/** Find all character positions of `term` in `text` (ascending). */
export function findAllPositions(text: string, term: string): number[] {
  const positions: number[] = [];
  if (term.length === 0) return positions;
  let idx = text.indexOf(term);
  while (idx !== -1) {
    positions.push(idx);
    idx = text.indexOf(term, idx + 1);
  }
  return positions;
}

/**
 * Minimum window span covering at least one position from each list.
 * Sweep-line: repeatedly advance the pointer at the current minimum until any
 * list is exhausted. Returns Infinity for empty input, 0 for a single list.
 */
export function findMinSpan(positionLists: number[][]): number {
  if (positionLists.length === 0) return Infinity;
  if (positionLists.length === 1) return 0;

  const ptrs = new Array(positionLists.length).fill(0);
  let minSpan = Infinity;

  while (true) {
    let curMin = Infinity;
    let curMax = -Infinity;
    let minIdx = 0;

    for (let i = 0; i < positionLists.length; i++) {
      const val = positionLists[i][ptrs[i]];
      if (val < curMin) {
        curMin = val;
        minIdx = i;
      }
      if (val > curMax) {
        curMax = val;
      }
    }

    const span = curMax - curMin;
    if (span < minSpan) minSpan = span;

    ptrs[minIdx]++;
    if (ptrs[minIdx] >= positionLists[minIdx].length) break;
  }

  return minSpan;
}

/**
 * Count matched adjacent pairs across consecutive query terms within `gap`
 * chars. Each right position is consumed by at most one left position so a
 * repeated token like "foo foo bar" counts 1 pair, not 2. Layers a saturating
 * phrase-frequency signal on top of minSpan proximity.
 */
export function countAdjacentPairs(
  positionLists: number[][],
  terms: string[],
  gap: number = 30,
): number {
  if (positionLists.length < 2 || terms.length < 2) return 0;
  let total = 0;
  const pairs = Math.min(positionLists.length, terms.length) - 1;
  for (let i = 0; i < pairs; i++) {
    const left = positionLists[i];
    const right = positionLists[i + 1];
    const leftLen = terms[i].length;
    let j = 0;
    for (const p of left) {
      const minStart = p + leftLen;
      const maxStart = minStart + gap;
      while (j < right.length && right[j] < minStart) j++;
      if (j < right.length && right[j] <= maxStart) {
        total++;
        j++;
      }
    }
  }
  return total;
}

/**
 * Extract query terms for proximity/title scoring: lowercase, split on
 * whitespace, drop very short tokens, then filter stopwords (falling back to
 * all terms when every term is a stopword so the term list is never empty).
 */
export function extractQueryTerms(query: string): string[] {
  const all = query
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);
  const filtered = all.filter((w) => !STOPWORDS.has(w));
  return filtered.length > 0 ? filtered : all;
}

/**
 * Resolve a "title" for a SearchResult for proximity/title boosting.
 * Prefers explicit metadata fields (label, parentSymbol, symbolName, filePath)
 * then falls back to the first content line, mirroring how chunks are titled
 * at index time.
 */
function resolveTitle(result: SearchResult): string {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const candidates = [
    meta.label,
    meta.parentSymbol,
    meta.symbolName,
    meta.filePath,
  ];
  for (const c of candidates) {
    if (typeof c === "string" && c.length > 0) return c;
  }
  const firstLine = result.content.split("\n", 1)[0] ?? "";
  return firstLine.slice(0, 80);
}

/**
 * Detect whether a result is a code chunk (stronger title boost applies).
 * Code chunks carry `type` metadata like "code_block", or a language/parentSymbol.
 */
function isCodeResult(result: SearchResult): boolean {
  const meta = (result.metadata ?? {}) as Record<string, unknown>;
  const type = meta.type;
  if (type === "code_block") return true;
  if (typeof meta.language === "string" && meta.language.length > 0) return true;
  return false;
}

/**
 * Proximity + title re-ranking pass.
 *
 * Boosts results whose title contains query terms and whose body positions the
 * query terms close together. Code chunks get a stronger title boost
 * (function/class names are high signal); prose chunks get a moderate one.
 *
 * This is a STABLE re-rank on top of RRF: results are sorted by boost (desc)
 * with the original rank as tiebreaker, so equally-boosted results keep their
 * RRF order. Applied after fusion, before minScore/file-chunk limiting.
 *
 * Pure over inputs — safe to unit-test without a DB.
 */
export function applyProximityRerank(
  results: SearchResult[],
  query: string,
): SearchResult[] {
  const terms = extractQueryTerms(query);
  if (results.length === 0) return results;

  const decorated = results.map((result, index) => {
      const titleLower = resolveTitle(result).toLowerCase();
      const titleHits = terms.filter((t) => titleLower.includes(t)).length;
      const titleWeight = isCodeResult(result) ? 0.6 : 0.3;
      const titleBoost =
        titleHits > 0 ? titleWeight * (titleHits / terms.length) : 0;

      let proximityBoost = 0;
      let phraseBoost = 0;
      if (terms.length >= 2) {
        const content = result.content.toLowerCase();
        const positions = terms.map((t) => findAllPositions(content, t));

        if (!positions.some((p) => p.length === 0)) {
          const minSpan = findMinSpan(positions);
          proximityBoost = 1 / (1 + minSpan / Math.max(content.length, 1));

          const adjacentPairs = countAdjacentPairs(positions, terms);
          phraseBoost = 0.5 * Math.min(1, adjacentPairs / 4);
        }
      }

      return {
        result,
        boost: titleBoost + proximityBoost + phraseBoost,
        rank: index,
      };
    });

  // RRF remains the primary ranking contract. Proximity only breaks ties
  // inside contiguous groups whose final scores differ by <= 1 percentage
  // point. Sorting the entire pool by raw lexical boost previously let a weak
  // rank-40 result jump to rank 1 on an incidental short substring match.
  const output: SearchResult[] = [];
  for (let start = 0; start < decorated.length;) {
    let end = start + 1;
    while (
      end < decorated.length &&
      Math.abs(
        decorated[end].result.score - decorated[start].result.score,
      ) <= 0.01
    ) {
      end++;
    }
    const group = decorated
      .slice(start, end)
      .sort((a, b) => b.boost - a.boost || a.rank - b.rank);
    output.push(...group.map(({ result }) => result));
    start = end;
  }
  return output;
}
