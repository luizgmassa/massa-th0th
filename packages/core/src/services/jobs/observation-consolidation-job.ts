/**
 * ObservationConsolidationJob — Phase 3 consolidation bridge.
 *
 * Summarizes windows of raw observations (per projectId, by recency) into a
 * structured memory using the Phase-1 llm-client + consolidator. Reuses
 * MemoryRepository.insert for the output memory.
 *
 * Contract (spec.md R7):
 *  - Trigger-driven with a debounce (every minObservations OR minIntervalMs),
 *    fired from the HookService writer turn. Fire-and-forget; never throws.
 *  - Silent degradation: when !isLlmEnabled(), or consolidateWindow returns
 *    null (LLM {ok:false}/timeout/empty), the bridge is a no-op. Observations
 *    are ALWAYS retained (the bridge never deletes them).
 *
 * Observations are not memory rows, so the SUPERSEDES edge targets a memory
 * (the freshly stored summary) only when a prior summary exists for the same
 * project; sourceIds in the event payload are observation ids (informational).
 */

import { logger, MemoryLevel, MemoryType } from "@massa-th0th/shared";
import { randomUUID } from "crypto";
import { config } from "@massa-th0th/shared";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import { eventBus } from "../events/event-bus.js";
import {
  ConsolidatedBatchSchema,
  type ConsolidatedBatch,
  type LlmSurface,
} from "../memory/consolidator.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { ObservationStore, Observation } from "../../data/memory/observation-repository.js";
import { getObservationStore } from "../../data/memory/observation-repository.js";

export interface ObservationConsolidationResult {
  consolidated: boolean;
  batchesCreated: number;
}

export interface ObservationConsolidationJobOptions {
  llm?: LlmSurface;
  store?: ObservationStore;
  /** Override the memory repository (tests). Defaults to getMemoryRepository(). */
  memoryRepo?: { insert(input: unknown): void | Promise<void> };
  /** Override config (tests). */
  minObservations?: number;
  minIntervalMs?: number;
  maxWindow?: number;
}

// Defensive config (mirrors Phase-2 QueryUnderstandingService): real config
// always has the hooks.bridge block; some test files mock shared config
// process-wide and omit it. Fall back to spec defaults.
const FALLBACK_BRIDGE = {
  enabled: true,
  minObservations: 8,
  minIntervalMs: 5 * 60 * 1000,
  maxWindow: 8,
};

function readBridgeConfig() {
  try {
    const c = (config.get("hooks") as any)?.bridge;
    if (c && typeof c === "object") {
      return {
        enabled: c.enabled ?? FALLBACK_BRIDGE.enabled,
        minObservations: c.minObservations ?? FALLBACK_BRIDGE.minObservations,
        minIntervalMs: c.minIntervalMs ?? FALLBACK_BRIDGE.minIntervalMs,
        maxWindow: c.maxWindow ?? FALLBACK_BRIDGE.maxWindow,
      };
    }
  } catch {
    /* fall through */
  }
  return FALLBACK_BRIDGE;
}

export class ObservationConsolidationJob {
  private readonly llm: LlmSurface;
  private readonly store: ObservationStore;
  private readonly memoryRepo: { insert(input: unknown): void | Promise<void> };
  private readonly minObservations: number;
  private readonly minIntervalMs: number;
  private readonly maxWindow: number;

  private lastRunAt = 0;
  private newSinceRun = 0;
  /** Calls observed by tests. */
  public runCalls = 0;

  constructor(opts: ObservationConsolidationJobOptions = {}) {
    this.llm = opts.llm ?? defaultLlmSurface;
    this.store = opts.store ?? getObservationStore();
    // Lazy getter so the repo is resolved at run-time (not ctor time), unless
    // a test injects one. This avoids touching the process-wide singleton
    // during construction (test isolation).
    const injected = opts.memoryRepo;
    this.memoryRepo = injected ?? ({ insert: (i: unknown) => getMemoryRepository().insert(i as any) } as any);
    const cfg = readBridgeConfig();
    this.minObservations = opts.minObservations ?? cfg.minObservations;
    this.minIntervalMs = opts.minIntervalMs ?? cfg.minIntervalMs;
    this.maxWindow = opts.maxWindow ?? cfg.maxWindow;
  }

  /**
   * Debounce-gated trigger from the ingest path. Never awaits; never throws.
   * Resets counters and fires `runOnce` (fire-and-forget) when either threshold
   * is crossed.
   */
  maybeRun(projectId: string): void {
    try {
      const cfg = readBridgeConfig();
      if (!cfg.enabled) return;
      this.newSinceRun++;
      const now = Date.now();
      // Fire when EITHER threshold is crossed:
      //   - enough new observations since last run, OR
      //   - enough time elapsed since last run (only meaningful after the
      //     first run — lastRunAt=0 means "never run", so the interval gate is
      //     not considered satisfied just because (now - 0) is large).
      const countThresholdMet = this.newSinceRun >= this.minObservations;
      const intervalThresholdMet =
        this.lastRunAt !== 0 && now - this.lastRunAt >= this.minIntervalMs;
      if (!countThresholdMet && !intervalThresholdMet) {
        return;
      }
      this.newSinceRun = 0;
      this.lastRunAt = now;
      void this.runOnce(projectId).catch((e) => {
        logger.warn("observation consolidation: runOnce failed (silent)", {
          projectId,
          error: (e as Error).message,
        });
      });
    } catch (e) {
      logger.warn("observation consolidation: maybeRun swallowed", {
        projectId,
        error: (e as Error).message,
      });
    }
  }

  /**
   * Run one consolidation pass for `projectId`. Silent-skip when LLM off or the
   * window returns no batch. Never throws.
   */
  async runOnce(projectId: string): Promise<ObservationConsolidationResult> {
    this.runCalls++;
    const noop: ObservationConsolidationResult = {
      consolidated: false,
      batchesCreated: 0,
    };

    // R7 silent-skip: trust the injected surface's enabled flag. The default
    // surface reads the real config (llm.enabled / RLM_LLM_ENABLED); a test
    // injects a fake surface whose isEnabled() is authoritative. This avoids
    // depending on the process-wide shared-config singleton (test-isolation).
    let llmOn = false;
    try {
      llmOn = this.llm.isEnabled();
    } catch {
      llmOn = false;
    }
    if (!llmOn) return noop;

    let observations: Observation[] = [];
    try {
      observations = this.store.listRecent(projectId, this.maxWindow);
    } catch (e) {
      logger.warn("observation consolidation: listRecent failed", {
        projectId,
        error: (e as Error).message,
      });
      return noop;
    }
    if (observations.length < 2) return noop;

    // Observations have no embeddings (they are raw telemetry, not semantic
    // content), so the cosine-based `consolidateWindow` prefilter cannot seed
    // a cluster. Instead build a recency window (most-recent N) and call the
    // LLM object surface directly with the SAME zod schema the memory
    // consolidator uses (ConsolidatedBatchSchema), reusing the LlmSurface
    // contract. This keeps the bridge LLM-only (no embedding dependency) and
    // consistent with the Phase-1 batch shape.
    const window = observations.slice(0, this.maxWindow);
    const batchId = `obs-batch-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const prompt = buildObservationPrompt(window);

    let batch: ConsolidatedBatch | null;
    try {
      const res = await this.llm.object(prompt, ConsolidatedBatchSchema);
      if (!res.ok || !res.value) {
        return noop; // {ok:false} / timeout / invalid → silent skip
      }
      const v = res.value;
      batch = {
        id: batchId,
        sourceIds: v.sourceIds,
        summary: v.summary,
        type: v.type,
        level: v.level,
        rationale: v.rationale,
      };
    } catch (e) {
      logger.warn("observation consolidation: llm.object threw (silent)", {
        projectId,
        error: (e as Error).message,
      });
      return noop;
    }
    if (!batch) return noop;

    // Store the summary as a memory. Reuse the polymorphic repository.
    const newId = `mem-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const importance = Math.min(1, Math.max(0.5, 0.7));
    try {
      await Promise.resolve(
        this.memoryRepo.insert({
          id: newId,
          content: batch.summary,
          type: batch.type as MemoryType,
          level: batch.level as MemoryLevel,
          projectId,
          importance,
          tags: ["observation-consolidated"],
          embedding: [],
          metadata: {
            batchId: batch.id,
            consolidated: true,
            source: "observations",
            rationale: batch.rationale,
            sourceObservationIds: batch.sourceIds,
          },
        }),
      );
    } catch (e) {
      logger.warn("observation consolidation: summary insert failed", {
        batchId: batch.id,
        error: (e as Error).message,
      });
      return noop;
    }

    eventBus.publish("memory:consolidated", {
      batchId: batch.id,
      sourceIds: batch.sourceIds,
      newMemoryId: newId,
      projectId: projectId ?? undefined,
      stats: { merged: batch.sourceIds.length, batchesCreated: 1 },
    });

    return { consolidated: true, batchesCreated: 1 };
  }
}

/** Singleton. Tests construct a fresh instance with injected deps. */
export const observationConsolidationJob = new ObservationConsolidationJob();

// ── Prompt builder ──────────────────────────────────────────────────────────

/**
 * Build the LLM prompt for an observation-consolidation window. Reuses the
 * Phase-1 ConsolidatedBatchSchema (same {summary,type,level,rationale,sourceIds}
 * shape) so downstream consumers are uniform. Observations carry their payload
 * JSON (capped at ingestion) as the only content signal.
 */
function buildObservationPrompt(window: Observation[]): string {
  const items = window
    .map(
      (o, i) =>
        `[${i}] id=${o.id} source=${o.source} importance=${o.importance.toFixed(2)}\n${o.payloadJson}`,
    )
    .join("\n");
  return [
    "You are consolidating a window of passive lifecycle observations (agent telemetry)",
    "into one structured summary memory. Identify the common theme/work and produce a",
    "single memory that subsumes the sources. The new memory's type and level must be",
    "one of the allowed enum values. sourceIds MUST be exactly the provided ids.",
    "",
    "Observations:",
    items,
    "",
    "Return JSON: { summary, type, level, rationale, sourceIds }.",
  ].join("\n");
}
