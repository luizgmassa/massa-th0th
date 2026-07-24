/**
 * Temporal Inhibition — anti-recency bias.
 *
 * Memories just created get an inflated importance simply because they are
 * fresh. When the query carries no temporal intent, freshness is noise:
 * the user did not ask for what is new. Penalize young memories so the
 * historical signal can compete.
 */

import type { SearchResult } from "@massa-ai/shared";

export interface TemporalInhibitionConfig {
  enabled: boolean;
  penaltyAgeMs: number;
  penalty: number;
}

const TEMPORAL_INDICATORS = [
  "recent",
  "recente",
  "latest",
  "último",
  "ultima",
  "today",
  "hoje",
  "yesterday",
  "ontem",
  "now",
  "agora",
  "current",
  "atual",
  "just",
  "new",
  "novo",
  "this week",
  "this hour",
  "minute ago",
  "horas atrás",
  "this morning",
];

export function hasTemporalIndicator(query: string): boolean {
  const lowered = query.toLowerCase();
  return TEMPORAL_INDICATORS.some((indicator) => lowered.includes(indicator));
}

function extractCreatedAt(result: SearchResult): number | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  const raw = meta?.createdAt;
  if (raw == null) return null;
  if (typeof raw === "number") return raw;
  if (typeof raw === "string" || raw instanceof Date) {
    const parsed = new Date(raw).getTime();
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * Apply absolute score penalty to results younger than `penaltyAgeMs` when
 * the query has no temporal intent. Returns a new sorted array.
 */
export function applyTemporalInhibition(
  results: SearchResult[],
  query: string,
  config: TemporalInhibitionConfig,
  now: number = Date.now(),
): SearchResult[] {
  if (!config.enabled || results.length === 0) return results;
  if (hasTemporalIndicator(query)) return results;

  const adjusted = results.map((r) => {
    const createdAt = extractCreatedAt(r);
    if (createdAt == null) return r;
    const age = now - createdAt;
    if (age >= 0 && age < config.penaltyAgeMs) {
      return { ...r, score: Math.max(0, r.score - config.penalty) };
    }
    return r;
  });

  return adjusted.sort((a, b) => b.score - a.score);
}
