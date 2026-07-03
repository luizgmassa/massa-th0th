/**
 * SynapseManager — orchestrates the post-retrieval pipeline.
 *
 * Composes scoring + inhibition + metacognition over a single result set
 * plus an optional working-memory buffer keyed by session.
 *
 * Order matters:
 *   0) buffer merge        — fold prior hot results into the fresh ones (opt-in via session)
 *   1) attention score     — re-rank top-N by multi-signal score (opt-in)
 *   2) chain inhibition    — boost/suppress by memory type for matched intent
 *   3) diversity penalty   — re-rank, deduplicate near-clones
 *   4) temporal inhibition — penalize fresh-but-irrelevant
 *   5) confidence gate     — drop everything below adaptive threshold
 *   6) score spectrum      — annotate the survivors with metacognition flags
 *   7) buffer put          — record final survivors for the next query in the session
 */

import type { SearchResult, SynapseRuntimeConfig } from "@massa-th0th/shared";
import {
  applyDiversityPenalty,
  applyTemporalInhibition,
  applyConfidenceGate,
  applyChainInhibition,
  prefilterByRawScore,
  DEFAULT_CHAIN_BOOSTS,
} from "./inhibition/index.js";
import { applyAttentionScore } from "./scoring/index.js";
import { analyzeSpectrum } from "./metacognition/index.js";
import { getSessionRegistry } from "./session/index.js";
import type {
  AgentSession,
  QueryIntent,
  SynapsePipelineResult,
} from "./types.js";

export interface ProcessOptions {
  sessionId?: string;
  now?: number;
}

/** Merge two result lists by id, keeping the highest score per id. */
function mergeById(a: SearchResult[], b: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();
  for (const r of a) map.set(r.id, r);
  for (const r of b) {
    const existing = map.get(r.id);
    if (!existing || r.score > existing.score) map.set(r.id, r);
  }
  return [...map.values()].sort((x, y) => y.score - x.score);
}

export class SynapseManager {
  constructor(private readonly config: SynapseRuntimeConfig) {}

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Run the full post-retrieval pipeline. A session is resolved lazily from
   * the in-memory SessionRegistry when `sessionId` is provided; otherwise
   * scoring signals that depend on the session degrade gracefully to 0
   * and the buffer is bypassed entirely.
   */
  process(
    results: SearchResult[],
    query: string,
    options: ProcessOptions = {},
  ): SynapsePipelineResult {
    const now = options.now ?? Date.now();
    const applied: string[] = [];

    if (!this.config.enabled) {
      return {
        results,
        flags: {
          lowConfidence: false,
          noStrongMatch: false,
          definitiveMatch: false,
          spread: 0,
          mean: 0,
          confidence: 0,
        },
        queryClass: "broad",
        appliedFilters: applied,
        intent: "general" as const,
      };
    }

    let stream = results;
    let intent: QueryIntent = "general";
    const session: AgentSession | null = options.sessionId
      ? getSessionRegistry().get(options.sessionId, now)
      : null;

    // 0) Buffer merge — pull warm hits from the session and fold them into the
    // fresh stream. Hits already carry hitBoost via the buffer.
    const buffer = this.config.buffer?.enabled ? session?.buffer : undefined;
    if (buffer) {
      const hot = buffer.get(query, now);
      if (hot.results.length > 0) {
        stream = mergeById(stream, hot.results);
        applied.push("buffer-hit");
      }
    }

    // 0.5) Pre-filter by raw vector score (IMP-16). Skips the expensive
    // attention/chain/diversity work for results that would be cut by the
    // final gate anyway. Only acts on results with a raw cosine attached;
    // results without raw scores continue through the pipeline untouched.
    const gateCfg = this.config.inhibition.confidenceGate;
    if (gateCfg.enabled) {
      const pre = prefilterByRawScore(stream, query, gateCfg);
      if (pre.cut > 0) {
        stream = pre.results;
        applied.push("pre-gate");
      }
    }

    const attention = this.config.scoring?.attention;
    if (attention?.enabled) {
      const out = applyAttentionScore(
        stream,
        {
          enabled: true,
          weights: attention.weights,
          rerankWindow: attention.rerankWindow,
          recencyHalfLifeMs: attention.recencyHalfLifeMs,
          semanticScale: attention.semanticScale,
        },
        session,
        now,
      );
      stream = out.results;
      applied.push("attention");
    }

    const chainCfg = this.config.inhibition.chainInhibition;
    if (chainCfg?.enabled) {
      const out = applyChainInhibition(stream, query, {
        enabled: true,
        boosts: chainCfg.boosts ?? DEFAULT_CHAIN_BOOSTS,
      });
      stream = out.results;
      intent = out.intent;
      applied.push("chain");
    }

    const diversity = this.config.inhibition.diversityPenalty;
    if (diversity.enabled) {
      stream = applyDiversityPenalty(stream, diversity);
      applied.push("diversity");
    }

    const temporal = this.config.inhibition.temporalInhibition;
    if (temporal.enabled) {
      stream = applyTemporalInhibition(stream, query, temporal, now);
      applied.push("temporal");
    }

    const gate = applyConfidenceGate(stream, query, this.config.inhibition.confidenceGate);
    if (this.config.inhibition.confidenceGate.enabled) applied.push("confidence-gate");

    const flags = analyzeSpectrum(
      gate.results.map((r) => r.score),
      gate.threshold,
      this.config.metacognition,
    );
    if (this.config.metacognition.enabled) applied.push("spectrum");

    // 7) Persist final survivors back into the buffer so the next query in
    // this session can see them. The buffer stores the *raw* (pre-pipeline)
    // score per id when available (via metadata._rrfRawVectorScore or the
    // original `results` input score) to prevent score drift on subsequent
    // hits (IMP-8).
    if (buffer && gate.results.length > 0) {
      const rawScores = new Map<string, number>();
      // Prefer the original input score (pre-modulation) over the post-
      // pipeline one — `results` is the parameter, untouched by us.
      for (const r of results) {
        const meta = r.metadata as Record<string, unknown> | undefined;
        const raw = meta?._rrfRawVectorScore as number | undefined;
        rawScores.set(r.id, typeof raw === "number" ? raw : r.score);
      }
      buffer.put(gate.results, query, now, rawScores);
      applied.push("buffer-put");
    }

    return {
      results: gate.results,
      flags,
      queryClass: gate.queryClass,
      appliedFilters: applied,
      intent,
    };
  }
}
