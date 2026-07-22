/**
 * AutoImproveJob — config (Wave 6 N31, T14)
 *
 * Extracted from auto-improve-job.ts. Thresholds, fallback config, and
 * config reader. Also VALID_MEMORY_TYPES for apply validation.
 */

import { config, MemoryType } from "@massa-th0th/shared";
import type { PatternThresholds } from "./auto-improve-job.js";

export const DEFAULT_THRESHOLDS: PatternThresholds = {
  minQueryHits: 3,
  minFileHits: 3,
  minFixHits: 2,
};

export const FALLBACK_AUTO_IMPROVE = {
  enabled: true,
  reviewGate: false,
  minObservations: 8,
  minIntervalMs: 5 * 60 * 1000,
  maxWindow: 16,
};

export function readAutoImproveConfig() {
  try {
    const c = (config.get("memory") as any)?.autoImprove;
    if (c && typeof c === "object") {
      return {
        enabled: c.enabled ?? FALLBACK_AUTO_IMPROVE.enabled,
        reviewGate: c.reviewGate ?? FALLBACK_AUTO_IMPROVE.reviewGate,
        minObservations: c.minObservations ?? FALLBACK_AUTO_IMPROVE.minObservations,
        minIntervalMs: c.minIntervalMs ?? FALLBACK_AUTO_IMPROVE.minIntervalMs,
        maxWindow: c.maxWindow ?? FALLBACK_AUTO_IMPROVE.maxWindow,
      };
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_AUTO_IMPROVE;
}

/** Set of valid MemoryType string values, for present-but-invalid checks. */
export const VALID_MEMORY_TYPES = new Set<string>(Object.values(MemoryType));