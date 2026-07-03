/**
 * Chain Inhibition — intent-driven boosting and suppression by memory type.
 *
 * The existing `Memory.type` field already partitions memories into chains
 * (decision / pattern / code / conversation / preference / critical). When a
 * query expresses a clear intent ("why did we decide…", "how do I fix…"),
 * the matching chain should rise and the unrelated chains should fade —
 * not be removed (that's the gate's job), just demoted.
 *
 * Detection is regex-based and sub-millisecond. No LLM call.
 *
 * If a result has no `type` in its metadata, its score is left untouched —
 * code-search results pass through, only memory-search results are modulated.
 */

import type { SearchResult } from "@massa-th0th/shared";
import type { ChainBoostMap, QueryIntent } from "../types.js";
import { inferTypeFromPath } from "./type-inference.js";

export interface ChainInhibitionConfig {
  enabled: boolean;
  /** Per-intent multipliers applied to results whose metadata.type matches a chain. */
  boosts: Record<QueryIntent, ChainBoostMap>;
}

/**
 * Intent patterns ordered by specificity, NOT alphabetically.
 * Explicit keywords ("pattern", "decision", "rationale") match before
 * catch-all keywords ("error", "broken") so a phrase like
 * "pattern for error handling" is correctly tagged as `pattern`.
 */
const INTENT_PATTERNS: Array<{ intent: QueryIntent; patterns: RegExp[] }> = [
  {
    intent: "pattern",
    patterns: [
      /\bpattern\b/i,
      /\bpadr(?:ã|a)o\b/i,
      /\bidiom(?:atic)?\b/i,
      /\bconvention\b/i,
      /\bbest\s+practice/i,
      /\bhow\s+(?:do|should)\s+(?:we|you)\s+(?:usually|typically|normally)/i,
    ],
  },
  {
    intent: "decision",
    patterns: [
      /\bwhy\s+(?:did|do|are|is|we|they|the)\b/i,
      /\bpor\s+que\s+(?:decid|escolh|usa)/i,
      /\bdecision\b/i,
      /\bdecid(?:ed|ing|imos|iu)\b/i,
      /\brationale\b/i,
      /\btrade[- ]?off/i,
      /\bchose\b/i,
    ],
  },
  {
    intent: "symbol",
    patterns: [
      /\bdefinition\s+of\b/i,
      /\bsignature\s+of\b/i,
      /\bo\s+que\s+(?:é|faz)\b/i,
      /\bcomo\s+funciona\b/i,
      /\bwhat\s+is\s+(?:the\s+)?[A-Z][A-Za-z0-9_]+\b/, // CamelCase / PascalCase only
    ],
  },
  {
    intent: "debug",
    patterns: [
      /\b(?:error|exception|stack\s*trace|crash|panic|throw)/i,
      /\b(?:erro|exce(?:ç|c)ão|falha)\b/i,
      /\bhow\s+(?:do|can|to)\s+(?:i\s+|we\s+)?(?:fix|solve|resolve|debug)/i,
      /\bcomo\s+(?:resolv|consert|corrig)/i,
      /\b(?:fix|debug)\s+(?:the|this|that)\b/i,
      /\bbroken\b/i,
      /\bECONN(?:REFUSED|RESET|ABORTED|TIMEDOUT)\b/i,
      /\bENO(?:ENT|TFOUND|MEM|TDIR)\b/i,
      /\bcannot\s+connect\b/i,
      /\bnão\s+(?:consegue|consigo)\s+conectar/i,
    ],
  },
];

export function detectIntent(query: string): QueryIntent {
  for (const { intent, patterns } of INTENT_PATTERNS) {
    if (patterns.some((re) => re.test(query))) {
      return intent;
    }
  }
  return "general";
}

function extractType(result: SearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return inferTypeFromPath(undefined);
  const direct = meta.type;
  if (typeof direct === "string" && direct.length > 0) return direct;
  const context = meta.context as Record<string, unknown> | undefined;
  if (context && typeof context.type === "string") return context.type;
  // IMP-3 fallback: derive a synthetic type from filePath so chain
  // inhibition can operate on code-search results (which never carry a
  // type tag from the indexer).
  const filePath = (meta.filePath ?? meta.file_path) as string | undefined;
  return inferTypeFromPath(filePath);
}

/**
 * Apply chain-aware multipliers based on detected intent. Results whose
 * metadata carries no `type` are passed through unchanged.
 */
export function applyChainInhibition(
  results: SearchResult[],
  query: string,
  config: ChainInhibitionConfig,
): { results: SearchResult[]; intent: QueryIntent } {
  const intent = detectIntent(query);
  if (!config.enabled || intent === "general") {
    return { results, intent };
  }

  const boostMap = config.boosts[intent];
  if (!boostMap) return { results, intent };

  const adjusted = results.map((r) => {
    const type = extractType(r);
    if (!type) return r;
    const multiplier = (boostMap as Record<string, number | undefined>)[type];
    if (multiplier == null || multiplier === 1) return r;
    return { ...r, score: Math.max(0, r.score * multiplier) };
  });

  adjusted.sort((a, b) => b.score - a.score);
  return { results: adjusted, intent };
}

/**
 * Default boost map per intent. 2.0 = strong boost, 0.5 = strong inhibition,
 * 1.0 = pass-through. Tunable via config.
 */
export const DEFAULT_CHAIN_BOOSTS: Record<QueryIntent, ChainBoostMap> = {
  decision: { decision: 2.0, critical: 1.5, conversation: 0.6, documentation: 1.2 },
  // Debug benefits from runbooks & troubleshooting docs as much as code,
  // so documentation gets a healthy boost alongside conversation/code.
  debug: { conversation: 1.8, code: 1.4, "code-test": 1.5, documentation: 1.6, decision: 0.6, pattern: 0.7 },
  pattern: { pattern: 2.0, code: 1.3, "code-test": 1.4, documentation: 1.1, decision: 0.8 },
  symbol: { code: 2.0, pattern: 1.2, "code-test": 0.8 }, // tests deprioritized for "what is X"
  general: {},
};
