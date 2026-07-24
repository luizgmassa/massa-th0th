/**
 * Adaptive Confidence Gate.
 *
 * The original retrieval uses a static minScore (0.3) regardless of how
 * specific the query is. That is too permissive for narrow lookups and too
 * strict for exploratory ones. The gate classifies the query and applies a
 * threshold proportional to how much precision the caller is implicitly
 * asking for.
 */

import type { SearchResult } from "@massa-ai/shared";
import type { QueryClass } from "../types.js";

export interface ConfidenceGateConfig {
  enabled: boolean;
  thresholds: { specific: number; focused: number; broad: number };
}

const FILE_PATH_RE = /\b[\w./-]+\.[a-z]{2,5}\b/i;
const CAMEL_CASE_RE = /\b[a-z]+[A-Z][A-Za-z0-9]+\b/;
const PASCAL_CASE_RE = /\b[A-Z][a-z]+[A-Z][A-Za-z0-9]+\b/;
const SNAKE_CASE_RE = /\b[a-z][a-z0-9]*_[a-z0-9_]+\b/;
const FUNCTION_CALL_RE = /\b[A-Za-z_][\w]*\s*\(/;
const QUOTED_SYMBOL_RE = /["`'][^"`']{2,}["`']/;

const TECHNICAL_KEYWORDS = new Set([
  "function",
  "class",
  "interface",
  "type",
  "method",
  "module",
  "import",
  "export",
  "async",
  "await",
  "promise",
  "callback",
  "middleware",
  "handler",
  "service",
  "config",
  "schema",
  "migration",
  "query",
  "endpoint",
  "route",
  "controller",
  "repository",
  "factory",
  "provider",
  "adapter",
  "decorator",
  "hook",
  "store",
  "reducer",
  "selector",
  "component",
  "plugin",
]);

/**
 * Classify a query into specific / focused / broad based on cheap heuristics.
 * Sub-millisecond — no LLM call, no tokenizer dependency.
 */
export function classifyQuery(query: string): QueryClass {
  const trimmed = query.trim();
  if (!trimmed) return "broad";

  if (
    FILE_PATH_RE.test(trimmed) ||
    CAMEL_CASE_RE.test(trimmed) ||
    PASCAL_CASE_RE.test(trimmed) ||
    SNAKE_CASE_RE.test(trimmed) ||
    FUNCTION_CALL_RE.test(trimmed) ||
    QUOTED_SYMBOL_RE.test(trimmed)
  ) {
    return "specific";
  }

  const words = trimmed.toLowerCase().split(/\s+/);
  const technicalHits = words.filter((w) => TECHNICAL_KEYWORDS.has(w)).length;
  if (technicalHits >= 1 && words.length <= 8) {
    return "focused";
  }

  return "broad";
}

/**
 * Filter results below the threshold for the detected query class.
 *
 * IMP-5: the gate prefers the *raw* vector cosine (`_rrfRawVectorScore`)
 * over `result.score`. RRF normalization always lifts the top result to
 * ~1.0 regardless of actual semantic relevance, so applying a threshold
 * to the normalized score lets noise through on weak queries. The raw
 * vectorScore is absolute and meaningful across queries. Falls back to
 * `result.score` when the raw signal is unavailable (e.g., keyword-only
 * results that never got a vector score).
 */
function relevanceScore(result: SearchResult): number {
  const meta = result.metadata as Record<string, unknown> | undefined;
  const raw = meta?._rrfRawVectorScore;
  return typeof raw === "number" ? raw : result.score;
}

/**
 * IMP-16: cheap pre-filter applied BEFORE attention/chain/diversity.
 *
 * Cuts only results that *have* a raw vector score below the gate threshold —
 * they would be cut by the final gate anyway. Saves the downstream pipeline
 * from re-ranking, tokenizing, and applying chain boosts to candidates that
 * cannot survive. Results without a raw score are passed through unchanged
 * and go through the full pipeline as before; the late gate still has the
 * final word.
 *
 * Returns the surviving results plus the threshold/class for callers that
 * want to log or surface the decision.
 */
export function prefilterByRawScore(
  results: SearchResult[],
  query: string,
  config: ConfidenceGateConfig,
): { results: SearchResult[]; queryClass: QueryClass; threshold: number; cut: number } {
  const queryClass = classifyQuery(query);
  const threshold = config.thresholds[queryClass];

  if (!config.enabled) {
    return { results, queryClass, threshold, cut: 0 };
  }

  let cut = 0;
  const survivors: SearchResult[] = [];
  for (const r of results) {
    const meta = r.metadata as Record<string, unknown> | undefined;
    const raw = meta?._rrfRawVectorScore;
    if (typeof raw === "number" && raw < threshold) {
      cut++;
      continue;
    }
    survivors.push(r);
  }
  return { results: survivors, queryClass, threshold, cut };
}

export function applyConfidenceGate(
  results: SearchResult[],
  query: string,
  config: ConfidenceGateConfig,
): { results: SearchResult[]; queryClass: QueryClass; threshold: number } {
  const queryClass = classifyQuery(query);
  const threshold = config.thresholds[queryClass];

  if (!config.enabled) {
    return { results, queryClass, threshold };
  }

  const filtered = results.filter((r) => relevanceScore(r) >= threshold);
  return { results: filtered, queryClass, threshold };
}
