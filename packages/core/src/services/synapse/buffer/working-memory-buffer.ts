/**
 * WorkingMemoryBuffer — session-scoped hot cache for retrieval results.
 *
 * Holds the top-N most relevant SearchResults the agent has seen in a session,
 * keyed by result id. Each entry remembers the query tokens that produced it,
 * so a new query can be matched against past queries via Jaccard — cheap,
 * deterministic, no embedding round-trip.
 *
 * Semantics:
 *   - put(results, query): inserts/updates, refreshes timestamps, prunes by
 *     size after insertion using LRU-by-score (lowest score evicted first).
 *   - prime(results): bulk seed without any associated query — used by session
 *     priming. Entries are still subject to eviction; treat as "warm start".
 *   - get(query, matchThreshold): returns matching entries with score boost.
 *   - invalidate(ids): removes specific entries (e.g., after Git invalidation).
 *   - evict(now): removes entries past TTL. Called opportunistically.
 *
 * Not thread-safe — designed for the single-process synapse runtime.
 */

import type { SearchResult } from "@massa-th0th/shared";

const TOKEN_RE = /[a-z0-9_]{2,}/g;

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    out.add(match[0]);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of smaller) if (larger.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

export interface WorkingMemoryBufferConfig {
  maxSize: number;
  ttlMs: number;
  /** Multiplier applied to a result's score when it is served from the buffer. */
  hitBoost: number;
  /** Jaccard threshold over query tokens above which a buffer entry counts as a hit. */
  matchThreshold: number;
}

interface BufferEntry {
  result: SearchResult;
  queryTokens: Set<string>;
  /** Pre-tokenized result content. Used for primed entries that have no
   *  associated query — we match the *new* query against the content
   *  tokens instead of unconditionally returning the entry (IMP-9). */
  contentTokens: Set<string>;
  addedAt: number;
  lastAccessedAt: number;
  /**
   * Original (pre-pipeline) score from the search layer. Persisting this
   * prevents score drift when the buffer is hit multiple times — every
   * boost is applied to the same starting value, not to the previously
   * boosted one (IMP-8).
   */
  baselineScore: number;
}

export interface BufferGetResult {
  results: SearchResult[];
  hitIds: Set<string>;
  appliedBoost: boolean;
}

export class WorkingMemoryBuffer {
  private entries = new Map<string, BufferEntry>();
  constructor(public readonly config: WorkingMemoryBufferConfig) {}

  size(): number {
    return this.entries.size;
  }

  has(id: string): boolean {
    return this.entries.has(id);
  }

  /**
   * Pull entries matching the new query.
   *
   * Match decision (IMP-9):
   *   - For query-seeded entries: Jaccard between the new query tokens and
   *     the tokens of the queries that originally produced the entry.
   *   - For primed entries (no associated query): Jaccard between the new
   *     query tokens and the entry's *content* tokens. A primed entry only
   *     surfaces if the query is plausibly looking for it.
   *
   * Score returned is always derived from the persisted baseline (IMP-8),
   * never from a previously boosted snapshot — this prevents compounding
   * across repeated buffer hits.
   */
  get(query: string, now: number = Date.now()): BufferGetResult {
    this.evictExpired(now);
    const queryTokens = tokenize(query);
    const hits: SearchResult[] = [];
    const hitIds = new Set<string>();

    for (const entry of this.entries.values()) {
      const primed = entry.queryTokens.size === 0;
      const sim = primed
        ? jaccard(queryTokens, entry.contentTokens)
        : jaccard(queryTokens, entry.queryTokens);
      if (sim >= this.config.matchThreshold) {
        entry.lastAccessedAt = now;
        hits.push({
          ...entry.result,
          score: Math.min(1, entry.baselineScore * this.config.hitBoost),
        });
        hitIds.add(entry.result.id);
      }
    }
    hits.sort((a, b) => b.score - a.score);
    return { results: hits, hitIds, appliedBoost: hits.length > 0 };
  }

  /**
   * Insert or refresh results from a normal retrieval. Each entry's queryTokens
   * is the union of tokens across all queries that have produced it.
   *
   * IMP-8: `baselineScore` is the *first* score observed (or the highest if
   * raw is unavailable). Subsequent puts do NOT compound it. This way, the
   * hit boost is always applied to a stable starting point regardless of
   * how many pipeline cycles have re-scored the entry.
   *
   * The optional `rawScore` param lets the caller hand in the pre-modulation
   * score explicitly — preferred whenever it is available.
   */
  put(
    results: SearchResult[],
    query: string,
    now: number = Date.now(),
    rawScores?: Map<string, number>,
  ): void {
    this.evictExpired(now);
    const queryTokens = tokenize(query);

    for (const result of results) {
      const baseline = rawScores?.get(result.id);
      const existing = this.entries.get(result.id);
      if (existing) {
        existing.result = result;
        existing.contentTokens = tokenize(result.content || "");
        for (const t of queryTokens) existing.queryTokens.add(t);
        existing.lastAccessedAt = now;
        // Only overwrite baselineScore when an explicit raw score was given.
        // Otherwise the original baseline survives — preventing drift.
        if (baseline != null) existing.baselineScore = baseline;
      } else {
        this.entries.set(result.id, {
          result,
          queryTokens: new Set(queryTokens),
          contentTokens: tokenize(result.content || ""),
          addedAt: now,
          lastAccessedAt: now,
          baselineScore: baseline ?? result.score,
        });
      }
    }

    this.evictToMaxSize();
  }

  /**
   * Seed the buffer with results that should be considered always-relevant
   * for this session — but only matched against new queries via content
   * tokens, not unconditionally (IMP-9).
   */
  prime(results: SearchResult[], now: number = Date.now()): void {
    for (const result of results) {
      if (this.entries.has(result.id)) continue;
      this.entries.set(result.id, {
        result,
        queryTokens: new Set(), // empty -> matched via contentTokens
        contentTokens: tokenize(result.content || ""),
        addedAt: now,
        lastAccessedAt: now,
        baselineScore: result.score,
      });
    }
    this.evictToMaxSize();
  }

  /** Remove specific entries — e.g., when Git invalidation marks them stale. */
  invalidate(ids: Iterable<string>): number {
    let removed = 0;
    for (const id of ids) {
      if (this.entries.delete(id)) removed++;
    }
    return removed;
  }

  evictExpired(now: number = Date.now()): number {
    let removed = 0;
    for (const [id, entry] of this.entries) {
      if (now - entry.lastAccessedAt >= this.config.ttlMs) {
        this.entries.delete(id);
        removed++;
      }
    }
    return removed;
  }

  /** Remove the lowest-baseline-score entries when over maxSize. */
  private evictToMaxSize(): void {
    if (this.entries.size <= this.config.maxSize) return;
    const sorted = [...this.entries.entries()].sort(
      (a, b) => a[1].baselineScore - b[1].baselineScore,
    );
    const toRemove = this.entries.size - this.config.maxSize;
    for (let i = 0; i < toRemove; i++) {
      this.entries.delete(sorted[i][0]);
    }
  }

  /** Test hook. */
  clear(): void {
    this.entries.clear();
  }
}

export const DEFAULT_BUFFER_CONFIG: WorkingMemoryBufferConfig = {
  maxSize: 20,
  ttlMs: 900_000, // 15 minutes
  hitBoost: 1.3,
  matchThreshold: 0.4,
};
