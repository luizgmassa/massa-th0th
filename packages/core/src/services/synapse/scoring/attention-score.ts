/**
 * Attention Score — multi-signal re-ranker (Option A: re-rank only top-N).
 *
 * Decision (informal ADR):
 *   We do NOT replace RRF. RRF runs first and produces `result.score`,
 *   which is the dominant signal here ("semantic"). AttentionScore folds
 *   five other signals on top and re-ranks the top-N. This keeps the
 *   battle-tested fusion intact while letting Synapse modulate ordering
 *   with context (session, recency, access patterns).
 *
 * Final score per candidate:
 *   final = Σ (weight_i × signal_i)         for i in active signals
 *
 * Signals (each in [0, 1]):
 *   - semantic     : the post-RRF normalized score (passed in as result.score)
 *   - recency      : exponential time-decay from metadata.createdAt
 *   - accessHeat   : log-normalized metadata.accessCount across the batch
 *   - taskAlign    : alignment with the session task (0 when no session)
 *   - agentAffinity: authorship + usage history (0 when no session)
 *   - confidence   : currently aliased to semantic; will pick up memory.confidence later
 *
 * Re-ranking applies only to the top `rerankWindow` results (default 50). Anything
 * below that window is appended unchanged, preserving RRF order at the tail.
 */

import type { SearchResult } from "@massa-ai/shared";
import type { AgentSession } from "../types.js";
import { computeTaskAlignment } from "./task-alignment.js";
import { computeAgentAffinity } from "./agent-affinity.js";

export interface AttentionWeights {
  semantic: number;
  recency: number;
  accessHeat: number;
  taskAlign: number;
  agentAffinity: number;
  confidence: number;
}

export interface AttentionScoreConfig {
  enabled: boolean;
  weights: AttentionWeights;
  rerankWindow: number;
  recencyHalfLifeMs: number;
  /** Multiplier applied to the rrf score to keep it on a comparable [0,1] scale. */
  semanticScale: number;
}

export interface AttentionScoreBreakdown {
  resultId: string;
  semantic: number;
  recency: number;
  accessHeat: number;
  taskAlign: number;
  agentAffinity: number;
  confidence: number;
  final: number;
}

const DEFAULT_HALF_LIFE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

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

function extractAccessCount(result: SearchResult): number {
  const meta = result.metadata as Record<string, unknown> | undefined;
  const raw = meta?.accessCount;
  if (typeof raw === "number" && Number.isFinite(raw) && raw >= 0) return raw;
  return 0;
}

function recencySignal(createdAt: number | null, now: number, halfLifeMs: number): number {
  if (createdAt == null) return 0;
  const age = Math.max(0, now - createdAt);
  return Math.pow(0.5, age / halfLifeMs);
}

function clamp01(x: number): number {
  if (Number.isNaN(x)) return 0;
  return Math.max(0, Math.min(1, x));
}

/**
 * Apply Attention Score over a result set. Returns a new array sorted by
 * the new final score. Disabled / empty input is returned unchanged.
 *
 * Active-weight renormalization (IMP-1): when a signal is structurally
 * unavailable (no createdAt → recency=0, no session → taskAlign=0, etc.),
 * its weight is excluded from the sum and the remaining weights are
 * renormalized to 1.0. This prevents score collapse on result sets that
 * lack metadata. In the degenerate case where only `semantic` and
 * `confidence` (its alias) contribute, the final score equals the input
 * semantic score, preserving the RRF ranking.
 *
 * A signal is treated as "available" when its dependency exists:
 *   - recency:       result has metadata.createdAt
 *   - accessHeat:    any result in the window has metadata.accessCount > 0
 *   - taskAlign:     session is provided AND session.taskContext exists
 *   - agentAffinity: session is provided
 *
 * `semantic` and `confidence` are always counted as available; without them
 * AttentionScore would have nothing to rerank against.
 */
export function applyAttentionScore(
  results: SearchResult[],
  config: AttentionScoreConfig,
  session: AgentSession | null,
  now: number = Date.now(),
): { results: SearchResult[]; breakdowns: AttentionScoreBreakdown[] } {
  if (!config.enabled || results.length === 0) {
    return { results, breakdowns: [] };
  }

  // IMP-14: cap the rerank window by the number of results we actually
  // intend to surface (`config.rerankWindow`). When the caller passes a
  // huge ceiling but only N results are available, doing the work for
  // anything beyond the displayed window is wasted. The lower bound of
  // 10 guarantees enough breathing room for ties/diversity at the tail.
  const effective = config.rerankWindow > 0 ? Math.floor(config.rerankWindow) : 10;
  const window = Math.min(effective, results.length);
  const head = results.slice(0, window);
  const tail = results.slice(window);

  // Precompute which signals are structurally available across the window.
  let maxAccess = 0;
  let anyCreatedAt = false;
  for (const r of head) {
    const c = extractAccessCount(r);
    if (c > maxAccess) maxAccess = c;
    if (extractCreatedAt(r) != null) anyCreatedAt = true;
  }
  const accessAvailable = maxAccess > 0;
  const recencyAvailable = anyCreatedAt;
  const taskAlignAvailable = !!(session && session.taskContext);
  const agentAffinityAvailable = !!session;
  const accessNorm = accessAvailable ? Math.log(maxAccess + 1) : 0;

  // Build the active-weight set and the renormalization factor.
  const w = config.weights;
  let totalActive = w.semantic + w.confidence;
  if (recencyAvailable) totalActive += w.recency;
  if (accessAvailable) totalActive += w.accessHeat;
  if (taskAlignAvailable) totalActive += w.taskAlign;
  if (agentAffinityAvailable) totalActive += w.agentAffinity;
  const scale = totalActive > 0 ? 1 / totalActive : 1;

  const breakdowns: AttentionScoreBreakdown[] = [];
  const rescored = head.map((r) => {
    const semantic = clamp01(r.score * config.semanticScale);
    const recency = recencyAvailable
      ? recencySignal(extractCreatedAt(r), now, config.recencyHalfLifeMs)
      : 0;
    const accessHeat = accessAvailable
      ? clamp01(Math.log(extractAccessCount(r) + 1) / accessNorm)
      : 0;
    const taskAlign = taskAlignAvailable
      ? clamp01(computeTaskAlignment(r, session!))
      : 0;
    const agentAffinity = agentAffinityAvailable
      ? clamp01(computeAgentAffinity(r, session!))
      : 0;
    const confidence = semantic; // alias until Memory.confidence exists

    let final =
      w.semantic * semantic +
      w.confidence * confidence;
    if (recencyAvailable) final += w.recency * recency;
    if (accessAvailable) final += w.accessHeat * accessHeat;
    if (taskAlignAvailable) final += w.taskAlign * taskAlign;
    if (agentAffinityAvailable) final += w.agentAffinity * agentAffinity;
    final *= scale;

    breakdowns.push({
      resultId: r.id,
      semantic,
      recency,
      accessHeat,
      taskAlign,
      agentAffinity,
      confidence,
      final,
    });

    return { ...r, score: final };
  });

  rescored.sort((a, b) => b.score - a.score);
  return { results: [...rescored, ...tail], breakdowns };
}

export const DEFAULT_ATTENTION_WEIGHTS: AttentionWeights = {
  semantic: 0.25,
  recency: 0.15,
  accessHeat: 0.15,
  taskAlign: 0.2,
  agentAffinity: 0.1,
  confidence: 0.15,
};

export const DEFAULT_ATTENTION_CONFIG: AttentionScoreConfig = {
  enabled: false, // opt-in until validated against benchmarks
  weights: DEFAULT_ATTENTION_WEIGHTS,
  rerankWindow: 50,
  recencyHalfLifeMs: DEFAULT_HALF_LIFE_MS,
  semanticScale: 1.0,
};
