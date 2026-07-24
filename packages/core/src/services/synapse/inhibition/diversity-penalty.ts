/**
 * Diversity Penalty (MMR-inspired).
 *
 * Penalizes results that are too similar to results already selected, so the
 * top-N covers more distinct topics instead of restating the same chunk in
 * different words. Operates on string similarity (Jaccard over normalized
 * tokens) rather than embeddings, so it has zero extra cost and no embedding
 * dependency at this layer.
 */

import type { SearchResult } from "@massa-ai/shared";

export interface DiversityPenaltyConfig {
  enabled: boolean;
  threshold: number; // 0–1; above this two contents are considered redundant
  lambda: number;    // 0–1; penalty strength applied to redundant scores
  /** Additional penalty applied when two results share the same filePath (IMP-4). */
  samePathPenalty?: number;
}

const TOKEN_RE = /[a-z0-9_]{2,}/g;

function tokenize(text: string): Set<string> {
  const lowered = text.toLowerCase();
  const tokens = new Set<string>();
  for (const match of lowered.matchAll(TOKEN_RE)) {
    tokens.add(match[0]);
  }
  return tokens;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of smaller) {
    if (larger.has(token)) intersection++;
  }
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function extractFilePath(result: SearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  const raw = meta.filePath ?? meta.file_path;
  return typeof raw === "string" && raw.length > 0 ? raw : null;
}

/**
 * Apply MMR-style diversity penalty in score order.
 * Returns a new array, sorted by adjusted score DESC. Original list is not mutated.
 *
 * IMP-4: in addition to token Jaccard, a same-`filePath` penalty is applied
 * so chunks from the same file get demoted relative to chunks from new files.
 * Token similarity between two chunks of the same file is usually low (they
 * cover different lines), so this is a complementary signal, not a duplicate.
 */
export function applyDiversityPenalty(
  results: SearchResult[],
  config: DiversityPenaltyConfig,
): SearchResult[] {
  if (!config.enabled || results.length < 2) return results;

  const samePathPenalty = config.samePathPenalty ?? 0.15;

  const ordered = [...results].sort((a, b) => b.score - a.score);
  const selected: {
    result: SearchResult;
    tokens: Set<string>;
    filePath: string | null;
  }[] = [];
  const output: SearchResult[] = [];

  for (const candidate of ordered) {
    const tokens = tokenize(candidate.content || "");
    const filePath = extractFilePath(candidate);
    let adjusted = candidate.score;

    for (const prior of selected) {
      const sim = jaccard(tokens, prior.tokens);
      if (sim > config.threshold) {
        adjusted *= 1 - config.lambda * sim;
      }
      if (
        samePathPenalty > 0 &&
        filePath &&
        prior.filePath &&
        filePath === prior.filePath
      ) {
        adjusted *= 1 - samePathPenalty;
      }
    }

    selected.push({ result: { ...candidate, score: adjusted }, tokens, filePath });
    output.push({ ...candidate, score: adjusted });
  }

  return output.sort((a, b) => b.score - a.score);
}
