/**
 * AutoImproveJob — Phase 5 auto-improvement loop (G7). Facade (Wave 6 N31).
 *
 * Reviews recent observations for a project, detects recurring patterns,
 * and proposes memory edits as `pending` proposals with an audit trail.
 *
 * Decomposed into modules:
 *   - auto-improve-patterns.ts — detectPatterns + extract helpers
 *   - auto-improve-llm.ts — enrichWithLlm + buildEnrichmentPrompt
 *   - auto-improve-apply.ts — applyProposal + readTargetForApply + validation
 *   - auto-improve-config.ts — thresholds + config reader
 *   - auto-improve-ops.ts — runOnce + approve + reject operations
 */

import { logger } from "@massa-th0th/shared";
import {
  getProposalStore, newProposalId,
  type ProposalKind, type ProposalRecord, type ProposalStore,
} from "../../data/proposal/proposal-repository.js";
import {
  getObservationStore,
  type Observation, type ObservationStore,
} from "../../data/memory/observation-repository.js";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import type { InsertMemoryInput, MemoryRow, UpdateMemoryPatch } from "../../data/memory/memory-repository.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { LlmSurface } from "../memory/consolidator.js";

import { readAutoImproveConfig, DEFAULT_THRESHOLDS } from "./auto-improve-config.js";
import { runOnce as _runOnce, approve as _approve, reject as _reject } from "./auto-improve-ops.js";

// ── Re-exports (barrel) ─────────────────────────────────────────────────────
export { detectPatterns } from "./auto-improve-patterns.js";
export { enrichWithLlm, buildEnrichmentPrompt } from "./auto-improve-llm.js";
export { applyProposal, readTargetForApply, ApplyRejection, type ApplyRejectionReason } from "./auto-improve-apply.js";
export { ProposalEnrichmentSchema, type ProposalEnrichment } from "./auto-improve-llm.js";
export { DEFAULT_THRESHOLDS, readAutoImproveConfig } from "./auto-improve-config.js";

// ── Public types ────────────────────────────────────────────────────────────
export interface PatternThresholds { minQueryHits: number; minFileHits: number; minFixHits: number; }
export interface PatternCandidate { kind: ProposalKind; targetMemoryId: string | null; payload: ProposalRecord["payload"]; rationale: string; signalKey: string; source: "rule-based" | "llm"; }
export interface AutoImproveResult { improved: boolean; proposalsCreated: number; proposalsApplied: number; source: "llm" | "rule-based"; }
export interface ApproveRejectResult { ok: boolean; proposal?: ProposalRecord; reason?: string; }
export interface MemoryApplySeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
  update(id: string, patch: UpdateMemoryPatch): boolean;
  getById(id: string): MemoryRow | null | Promise<MemoryRow | null>;
}
export interface AutoImproveJobOptions {
  llm?: LlmSurface; observationStore?: ObservationStore; proposalStore?: ProposalStore;
  memoryRepo?: MemoryApplySeam; minObservations?: number; minIntervalMs?: number;
  maxWindow?: number; thresholds?: Partial<PatternThresholds>; reviewGate?: boolean; idFactory?: () => string;
}

// ── Job (facade with 1-line delegates) ─────────────────────────────────────
export class AutoImproveJob {
  public readonly llm: LlmSurface;
  public readonly observationStore: ObservationStore;
  public readonly proposalStore: ProposalStore;
  public readonly memoryRepo: MemoryApplySeam;
  public readonly thresholds: PatternThresholds;
  public readonly minObservations: number;
  public readonly minIntervalMs: number;
  public readonly maxWindow: number;
  private readonly reviewGateOverride: boolean | undefined;
  public readonly idFactory: () => string;
  private lastRunAt = 0;
  private newSinceRun = 0;
  public runCalls = 0;

  constructor(opts: AutoImproveJobOptions = {}) {
    this.llm = opts.llm ?? defaultLlmSurface;
    this.observationStore = opts.observationStore ?? getObservationStore();
    this.proposalStore = opts.proposalStore ?? getProposalStore();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
    this.reviewGateOverride = opts.reviewGate;
    this.idFactory = opts.idFactory ?? (() => newProposalId());
    const injected = opts.memoryRepo;
    this.memoryRepo = injected ?? ({
      insert: (i: InsertMemoryInput) => getMemoryRepository().insert(i),
      update: (id: string, p: UpdateMemoryPatch) => getMemoryRepository().update(id, p),
      getById: (id: string) => getMemoryRepository().getById(id),
    } as unknown as MemoryApplySeam);
    const cfg = readAutoImproveConfig();
    this.minObservations = opts.minObservations ?? cfg.minObservations;
    this.minIntervalMs = opts.minIntervalMs ?? cfg.minIntervalMs;
    this.maxWindow = opts.maxWindow ?? cfg.maxWindow;
  }

  public reviewGate(): boolean {
    if (this.reviewGateOverride !== undefined) return this.reviewGateOverride;
    return readAutoImproveConfig().reviewGate;
  }

  maybeRun(projectId: string): void {
    try {
      const cfg = readAutoImproveConfig();
      if (!cfg.enabled) return;
      this.newSinceRun++;
      const now = Date.now();
      if (this.newSinceRun < this.minObservations && (this.lastRunAt === 0 || now - this.lastRunAt < this.minIntervalMs)) return;
      this.newSinceRun = 0;
      this.lastRunAt = now;
      void this.runOnce(projectId).catch((e) => logger.warn("auto-improve: runOnce failed (silent)", { projectId, error: (e as Error).message }));
    } catch (e) {
      logger.warn("auto-improve: maybeRun swallowed", { projectId, error: (e as Error).message });
    }
  }

  async runOnce(projectId: string): Promise<AutoImproveResult> { return _runOnce(this, projectId); }
  async approve(id: string, projectId?: string, source: "llm" | "rule-based" = "rule-based"): Promise<ApproveRejectResult> { return _approve(this, id, projectId, source); }
  async reject(id: string, projectId?: string, _reason?: string): Promise<ApproveRejectResult> { return _reject(this, id, projectId); }
  async listPending(projectId: string): Promise<ProposalRecord[]> { return this.proposalStore.listPending(projectId); }
}

// ── Singleton ───────────────────────────────────────────────────────────────
let cachedJob: AutoImproveJob | null = null;
export function getAutoImproveJob(): AutoImproveJob { if (!cachedJob) cachedJob = new AutoImproveJob(); return cachedJob; }
export function resetAutoImproveJob(): void { cachedJob = null; }
export const autoImproveJob = new AutoImproveJob();