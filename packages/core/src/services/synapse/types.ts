/**
 * Synapse — shared types for the cognitive modulation layer.
 *
 * Synapse is an interceptor layer over the existing retrieval pipeline.
 * It does not replace search; it modulates which results survive and in what order.
 */

import type { SearchResult } from "@massa-th0th/shared";
import type { WorkingMemoryBuffer } from "./buffer/working-memory-buffer.js";

/**
 * Classification of a query, used by the adaptive confidence gate.
 */
export type QueryClass = "specific" | "focused" | "broad";

/**
 * Metacognition flags surfaced to callers when Synapse analyzes its own confidence.
 */
export interface SpectrumFlags {
  lowConfidence: boolean;
  noStrongMatch: boolean;
  definitiveMatch: boolean;
  spread: number;
  mean: number;
  confidence: number;
}

/**
 * Result of running the full post-retrieval Synapse pipeline.
 */
export interface SynapsePipelineResult {
  results: SearchResult[];
  flags: SpectrumFlags;
  queryClass: QueryClass;
  appliedFilters: string[];
  intent: QueryIntent;
}

/**
 * Agent session — ephemeral context for a single agent working on a task.
 * Kept in-memory; persistence is intentionally out of scope here.
 */
export interface AgentSession {
  sessionId: string;
  agentId: string;
  workspaceId?: string;
  taskContext?: string;
  taskTokens?: Set<string>; // pre-tokenized taskContext for fast Jaccard
  taskEmbedding?: Float32Array | number[]; // optional: only when caller provides
  ttlMs: number;
  createdAt: number;
  expiresAt: number;
  /**
   * memoryId -> number of accesses by this agent inside the session.
   *
   * The Map is bounded — when it exceeds `accessHistoryLimit`, the LEAST
   * RECENTLY recorded entry is evicted (IMP-11). This relies on the JS Map's
   * insertion-order iteration: re-recording an existing key requires a
   * delete-then-set to refresh recency.
   */
  accessHistory: Map<string, number>;
  /** Hard cap on accessHistory.size; new entries past this evict the oldest. */
  accessHistoryLimit: number;
  /** Optional working-memory buffer; populated when buffer is enabled in config. */
  buffer?: WorkingMemoryBuffer;
}

/**
 * Mapping of detected query intent to memory chain weights.
 * Values multiply the score of a result whose `metadata.type` matches the chain.
 */
export type QueryIntent =
  | "decision"
  | "debug"
  | "pattern"
  | "symbol"
  | "general";

export interface ChainBoostMap {
  decision?: number;
  code?: number;
  /** Synthetic chain inferred from filePath when source is a test file. */
  "code-test"?: number;
  pattern?: number;
  conversation?: number;
  preference?: number;
  critical?: number;
  /** Synthetic chain inferred from filePath when source is a doc/README. */
  documentation?: number;
}
