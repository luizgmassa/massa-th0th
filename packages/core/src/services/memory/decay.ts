/**
 * Memory salience decay — pure, tested function.
 *
 * Borrowed from ai-memory's `decay.rs`. The score blends a recency-decayed
 * salience term with an access-reinforcement term:
 *
 *   score = salience · exp(-λ · Δt_days)
 *         + σ      · log(1 + access) · exp(-μ · Δt_access_days)
 *
 * where:
 *   - salience        = memory.importance (∈ [0,1])
 *   - Δt_days         = days since `lastAccessed ?? createdAt`
 *   - Δt_access_days  = days since `lastAccessed ?? createdAt`
 *   - access          = memory.accessCount (∈ ℕ)
 *
 * Properties (asserted in decay.test.ts):
 *   - Monotonic non-increasing in Δt (holding access fixed).
 *   - Pinned memories are decay-exempt: score === importance.
 *   - Bounded in [0,1] for all finite inputs.
 *   - Increasing accessCount (recency fixed) never decreases the access term.
 *   - Scores below `coldThreshold` flag the memory as a prune candidate.
 *
 * This module has NO runtime dependencies beyond `@massa-ai/shared`'s
 * `DecayParams` type — it is safe to unit-test without a database.
 */

import type { DecayParams } from "@massa-ai/shared";

/** Minimal memory shape consumed by `decayScore` — decoupled from the row type. */
export interface DecayMemory {
  /** Salience ∈ [0,1]. Maps to `memories.importance`. */
  importance: number;
  /** Number of times the memory has been accessed. */
  accessCount?: number;
  /** Epoch-ms creation time. */
  createdAt: number;
  /** Epoch-ms last access time (falls back to createdAt). */
  lastAccessed?: number | null;
  /** Pinned memories are decay-exempt. Maps to `memories.pinned` (0/1 or bool). */
  pinned?: number | boolean;
}

/** Canonical defaults, mirrored from ai-memory decay.rs. */
export const DEFAULT_DECAY_PARAMS: DecayParams = {
  lambda: 0.02,
  sigma: 0.6,
  mu: 0.04,
  coldThreshold: 0.2,
};

const DAY_MS = 24 * 60 * 60 * 1000;

function clamp01(x: number): number {
  if (!Number.isFinite(x)) return 0;
  if (x < 0) return 0;
  if (x > 1) return 1;
  return x;
}

/**
 * Compute the decayed salience score for a memory.
 *
 * @param mem    The memory (salience, access, timestamps, pinned flag).
 * @param params Decay tunables. Defaults to `DEFAULT_DECAY_PARAMS`.
 * @param now    Epoch-ms "now"; defaults to `Date.now()`. Injected for tests.
 * @returns Score clamped to [0,1]. Pinned memories return `importance`.
 */
export function decayScore(
  mem: DecayMemory,
  params: DecayParams = DEFAULT_DECAY_PARAMS,
  now: number = Date.now(),
): number {
  const salience = Number.isFinite(mem.importance) ? mem.importance : 0;

  // Pinned memories are decay-exempt: return salience unchanged.
  if (mem.pinned === 1 || mem.pinned === true) {
    return clamp01(salience);
  }

  const reference = mem.lastAccessed ?? mem.createdAt;
  const deltaDays = Math.max(0, (now - reference) / DAY_MS);
  const access = Math.max(0, Math.floor(mem.accessCount ?? 0));

  const salienceTerm = salience * Math.exp(-params.lambda * deltaDays);
  const accessTerm =
    params.sigma * Math.log1p(access) * Math.exp(-params.mu * deltaDays);

  return clamp01(salienceTerm + accessTerm);
}

/**
 * Whether a memory's decayed score is below the cold threshold, making it a
 * candidate for pruning. Pinned memories are never cold.
 */
export function isCold(
  mem: DecayMemory,
  params: DecayParams = DEFAULT_DECAY_PARAMS,
  now: number = Date.now(),
): boolean {
  if (mem.pinned === 1 || mem.pinned === true) return false;
  return decayScore(mem, params, now) < params.coldThreshold;
}
