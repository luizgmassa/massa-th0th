/**
 * AutoImproveJob — Phase 5 auto-improvement loop (G7).
 *
 * Reviews recent observations for a project, detects recurring patterns
 * (repeated queries, frequently-referenced files, common fixes), and
 * proposes memory edits as `pending` proposals with an audit trail.
 *
 * Contract (spec.md R1–R8):
 *  - Trigger-driven with a debounce (every minObservations OR minIntervalMs),
 *    fired from the observation-ingest path. Fire-and-forget; never throws.
 *  - Pattern detection is RULE-BASED and never requires the LLM. LLM
 *    enrichment is optional (only when `llm.isEnabled()`), best-effort, and
 *    silent-degrades to the rule-based candidates on `{ok:false}`/throw.
 *  - Review gate (`memory.autoImprove.reviewGate`, default false = auto-approve):
 *    when false, each generated proposal is auto-applied in the same run
 *    (apply via memoryRepo + flip status → approved + emit memory:auto-improved
 *    + log). When true, proposals stay pending for surfacing via tools.
 *  - apply/reject state machine: pending → approved | rejected (both terminal).
 *    Missing / non-pending / project-mismatch / apply-throw → {ok:false, reason}.
 *
 * Test-isolation (mirrors Phase-3/4/6): the ctor accepts injectable
 * `observationStore`, `proposalStore`, `memoryRepo`, `llm`, and `idFactory`
 * seams. Defaults resolve lazily at run time so the closed-MemoryRepository
 * landmine (memory-crud.test.ts) does not poison auto-improve tests.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { logger, MemoryLevel, MemoryType } from "@massa-th0th/shared";
import { config } from "@massa-th0th/shared";
import {
  getProposalStore,
  newProposalId,
  type ProposalKind,
  type ProposalRecord,
  type ProposalStore,
} from "../../data/proposal/proposal-repository.js";
import {
  getObservationStore,
  type Observation,
  type ObservationStore,
} from "../../data/memory/observation-repository.js";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import type { InsertMemoryInput, UpdateMemoryPatch } from "../../data/memory/memory-repository.js";
import { eventBus } from "../events/event-bus.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { LlmSurface } from "../memory/consolidator.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface PatternThresholds {
  minQueryHits: number;
  minFileHits: number;
  minFixHits: number;
}

export interface PatternCandidate {
  kind: ProposalKind;
  targetMemoryId: string | null;
  payload: ProposalRecord["payload"];
  rationale: string;
  /** Dedup key within a single run (stable signature of the signal). */
  signalKey: string;
  /** Origin of the candidate content draft. */
  source: "rule-based" | "llm";
}

export interface AutoImproveResult {
  improved: boolean;
  proposalsCreated: number;
  proposalsApplied: number;
  /** "llm" when the LLM enriched ≥1 candidate, else "rule-based". */
  source: "llm" | "rule-based";
}

export interface ApproveRejectResult {
  ok: boolean;
  proposal?: ProposalRecord;
  reason?: string;
}

/**
 * Injectable memory-apply seam. The default implementation resolves
 * getMemoryRepository() lazily inside each method (test-isolation).
 */
export interface MemoryApplySeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
  update(id: string, patch: UpdateMemoryPatch): boolean;
}

export interface AutoImproveJobOptions {
  llm?: LlmSurface;
  observationStore?: ObservationStore;
  proposalStore?: ProposalStore;
  memoryRepo?: MemoryApplySeam;
  minObservations?: number;
  minIntervalMs?: number;
  maxWindow?: number;
  thresholds?: Partial<PatternThresholds>;
  /** Override the review-gate flag (else read from config). */
  reviewGate?: boolean;
  idFactory?: () => string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const DEFAULT_THRESHOLDS: PatternThresholds = {
  minQueryHits: 3,
  minFileHits: 3,
  minFixHits: 2,
};

// Defensive config (mirrors Phase-3 readBridgeConfig): real config always has
// the memory.autoImprove block; some test files mock shared config process-wide
// and omit it. Fall back to spec defaults.
const FALLBACK_AUTO_IMPROVE = {
  enabled: true,
  reviewGate: false,
  minObservations: 8,
  minIntervalMs: 5 * 60 * 1000,
  maxWindow: 16,
};

function readAutoImproveConfig() {
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

// ── LLM enrichment schema ───────────────────────────────────────────────────

const ProposalEnrichmentItemSchema = z.object({
  signalKey: z.string(),
  content: z.string(),
  rationale: z.string(),
});
export const ProposalEnrichmentSchema = z.object({
  items: z.array(ProposalEnrichmentItemSchema),
});
export type ProposalEnrichment = z.infer<typeof ProposalEnrichmentSchema>;

// ── Pattern detection (pure) ────────────────────────────────────────────────

/**
 * Count frequency signals from observation payloads. Pure + total: bad/missing
 * payload fields are skipped, never thrown. Returns one candidate per distinct
 * signal that meets its threshold.
 */
export function detectPatterns(
  observations: Observation[],
  thresholds: PatternThresholds,
): PatternCandidate[] {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const queryCounts = new Map<string, number>();
  const fileCounts = new Map<string, number>();
  const fixCounts = new Map<string, number>();

  for (const obs of observations) {
    let payload: any = null;
    try {
      payload = JSON.parse(obs.payloadJson);
    } catch {
      continue;
    }
    if (!payload || typeof payload !== "object") continue;

    if (obs.source === "user-prompt") {
      const q = extractQuery(payload);
      if (q) queryCounts.set(q, (queryCounts.get(q) ?? 0) + 1);
    } else if (obs.source === "post-tool-use") {
      const f = extractFilePath(payload);
      if (f) fileCounts.set(f, (fileCounts.get(f) ?? 0) + 1);
      const fix = extractFixSignature(payload);
      if (fix) fixCounts.set(fix, (fixCounts.get(fix) ?? 0) + 1);
    }
  }

  const candidates: PatternCandidate[] = [];

  for (const [q, n] of queryCounts) {
    if (n >= t.minQueryHits) {
      const sig = `query::${q}`;
      candidates.push({
        kind: "memory.create",
        targetMemoryId: null,
        payload: {
          content: `Recurring question: "${q}" (observed ${n} times). Capture the canonical answer as a project memory.`,
          type: MemoryType.PATTERN,
          level: MemoryLevel.PROJECT,
          importance: 0.7,
          tags: ["auto-improve", "recurring-query"],
        },
        rationale: `Query "${truncate(q, 80)}" recurred ${n} times across observations.`,
        signalKey: sig,
        source: "rule-based",
      });
    }
  }

  for (const [f, n] of fileCounts) {
    if (n >= t.minFileHits) {
      const sig = `file::${f}`;
      candidates.push({
        kind: "memory.create",
        targetMemoryId: null,
        payload: {
          content: `Hot file: ${f} (referenced ${n} times in tool use). Consider documenting its role and key symbols.`,
          type: MemoryType.CODE,
          level: MemoryLevel.PROJECT,
          importance: 0.65,
          tags: ["auto-improve", "hot-file"],
        },
        rationale: `File "${truncate(f, 80)}" referenced ${n} times in post-tool-use observations.`,
        signalKey: sig,
        source: "rule-based",
      });
    }
  }

  for (const [fix, n] of fixCounts) {
    if (n >= t.minFixHits) {
      const sig = `fix::${fix}`;
      candidates.push({
        kind: "memory.create",
        targetMemoryId: null,
        payload: {
          content: `Recurring edit pattern: ${fix} (applied ${n} times). Capture as a reusable pattern memory.`,
          type: MemoryType.PATTERN,
          level: MemoryLevel.PROJECT,
          importance: 0.6,
          tags: ["auto-improve", "recurring-fix"],
        },
        rationale: `Edit signature "${truncate(fix, 80)}" recurred ${n} times.`,
        signalKey: sig,
        source: "rule-based",
      });
    }
  }

  return candidates;
}

/** Extract a normalized query signature from a user-prompt payload. */
function extractQuery(payload: any): string | null {
  const raw =
    typeof payload?.prompt === "string"
      ? payload.prompt
      : typeof payload?.query === "string"
        ? payload.query
        : typeof payload?.text === "string"
          ? payload.text
          : null;
  if (!raw) return null;
  return normalizeSignature(raw);
}

/** Extract a normalized repo-relative file path from a post-tool-use payload. */
function extractFilePath(payload: any): string | null {
  const raw =
    payload?.filePath ??
    payload?.file_path ??
    payload?.tool_input?.file_path ??
    payload?.tool_input?.path ??
    payload?.path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.replace(/^\.\/+/, "").trim();
}

/** Extract a stable edit/tool signature from a post-tool-use payload. */
function extractFixSignature(payload: any): string | null {
  const tool = typeof payload?.tool === "string" ? payload.tool : payload?.tool_name;
  if (typeof tool !== "string" || !tool.trim()) return null;
  // Bundle the tool with a coarse path bucket so repeated edits to nearby
  // files still cluster into a useful "fix" signal.
  const fp = extractFilePath(payload) ?? "";
  const bucket = fp ? pathBucket(fp) : "unknown";
  return `${tool}:${bucket}`;
}

/** Reduce a file path to its containing directory (coarse bucket). */
function pathBucket(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 1) return "root";
  return parts.slice(0, -1).join("/");
}

/**
 * Normalize a free-text query to a stable signature: lowercase, collapse
 * whitespace, strip simple stopwords, take the top-3 longest non-stopword
 * tokens (sorted) so paraphrases of the same question cluster. Deterministic.
 */
const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","to","of","in","on",
  "for","and","or","how","do","i","what","why","when","where","with","this","that",
  "it","my","me","please","can","you","into","from","at","as","by","if","so",
]);
function normalizeSignature(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  if (tokens.length === 0) {
    // Fall back to the raw lowercased text if it was all stopwords/punct.
    return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  }
  // Top-3 longest tokens, sorted alphabetically for determinism.
  return [...tokens]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .sort()
    .join(" ");
}

// ── LLM enrichment ──────────────────────────────────────────────────────────

/**
 * Refine candidate content + rationale via a single LLM call. Silent-degrade:
 * on `{ok:false}`/throw/invalid → return the rule-based candidates verbatim.
 * Never throws.
 */
export async function enrichWithLlm(
  candidates: PatternCandidate[],
  observations: Observation[],
  surface: LlmSurface,
): Promise<{ candidates: PatternCandidate[]; used: boolean }> {
  if (candidates.length === 0) return { candidates, used: false };
  let llmOn = false;
  try {
    llmOn = surface.isEnabled();
  } catch {
    llmOn = false;
  }
  if (!llmOn) return { candidates, used: false };

  const prompt = buildEnrichmentPrompt(candidates, observations);
  let enrichment: ProposalEnrichment | null = null;
  try {
    const res = await surface.object(prompt, ProposalEnrichmentSchema);
    if (!res.ok || !res.value || !Array.isArray(res.value.items)) {
      return { candidates, used: false };
    }
    enrichment = res.value;
  } catch {
    return { candidates, used: false };
  }
  if (!enrichment) return { candidates, used: false };

  // Index enrichment items by signalKey; only valid kinds survive.
  const byKey = new Map<string, { content: string; rationale: string }>();
  for (const item of enrichment.items) {
    if (item && item.signalKey && typeof item.content === "string") {
      byKey.set(item.signalKey, { content: item.content, rationale: item.rationale ?? "" });
    }
  }
  if (byKey.size === 0) return { candidates, used: false };

  const refined = candidates.map((c) => {
    const e = byKey.get(c.signalKey);
    if (!e) return c;
    const payload = { ...(c.payload as any) };
    if (e.content) payload.content = e.content;
    return {
      ...c,
      payload,
      rationale: e.rationale || c.rationale,
      source: "llm" as const,
    };
  });
  return { candidates: refined, used: true };
}

function buildEnrichmentPrompt(
  candidates: PatternCandidate[],
  observations: Observation[],
): string {
  const candLines = candidates
    .map(
      (c, i) =>
        `[${i}] signalKey=${c.signalKey} kind=${c.kind}\n  draft: ${c.rationale}`,
    )
    .join("\n");
  const obsLines = observations
    .slice(0, 16)
    .map(
      (o, i) =>
        `[${i}] source=${o.source}\n  ${truncate(o.payloadJson, 240)}`,
    )
    .join("\n");
  return [
    "You are refining auto-improvement proposal drafts for an agent memory system.",
    "For each candidate signal below, produce a cleaner content draft + rationale.",
    "Keep signalKey verbatim. Return JSON: { items: [{ signalKey, content, rationale }] }.",
    "",
    "Candidates:",
    candLines,
    "",
    "Recent observations (context):",
    obsLines,
  ].join("\n");
}

// ── Job ─────────────────────────────────────────────────────────────────────

export class AutoImproveJob {
  private readonly llm: LlmSurface;
  private readonly observationStore: ObservationStore;
  private readonly proposalStore: ProposalStore;
  private readonly memoryRepo: MemoryApplySeam;
  private readonly thresholds: PatternThresholds;
  private readonly minObservations: number;
  private readonly minIntervalMs: number;
  private readonly maxWindow: number;
  private readonly reviewGateOverride: boolean | undefined;
  private readonly idFactory: () => string;

  private lastRunAt = 0;
  private newSinceRun = 0;
  /** Calls observed by tests. */
  public runCalls = 0;

  constructor(opts: AutoImproveJobOptions = {}) {
    this.llm = opts.llm ?? defaultLlmSurface;
    this.observationStore = opts.observationStore ?? getObservationStore();
    this.proposalStore = opts.proposalStore ?? getProposalStore();
    this.thresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) };
    this.reviewGateOverride = opts.reviewGate;
    this.idFactory = opts.idFactory ?? (() => newProposalId());
    // Lazy getter so the repo is resolved at run-time (not ctor time).
    const injected = opts.memoryRepo;
    this.memoryRepo =
      injected ??
      ({
        insert: (i: InsertMemoryInput) => getMemoryRepository().insert(i),
        update: (id: string, p: UpdateMemoryPatch) => getMemoryRepository().update(id, p),
      } as MemoryApplySeam);

    const cfg = readAutoImproveConfig();
    this.minObservations = opts.minObservations ?? cfg.minObservations;
    this.minIntervalMs = opts.minIntervalMs ?? cfg.minIntervalMs;
    this.maxWindow = opts.maxWindow ?? cfg.maxWindow;
  }

  private reviewGate(): boolean {
    if (this.reviewGateOverride !== undefined) return this.reviewGateOverride;
    return readAutoImproveConfig().reviewGate;
  }

  /**
   * Debounce-gated trigger from the observation-ingest path. Never awaits;
   * never throws. Resets counters and fires `runOnce` (fire-and-forget) when
   * either threshold is crossed.
   */
  maybeRun(projectId: string): void {
    try {
      const cfg = readAutoImproveConfig();
      if (!cfg.enabled) return;
      this.newSinceRun++;
      const now = Date.now();
      const countThresholdMet = this.newSinceRun >= this.minObservations;
      const intervalThresholdMet =
        this.lastRunAt !== 0 && now - this.lastRunAt >= this.minIntervalMs;
      if (!countThresholdMet && !intervalThresholdMet) return;
      this.newSinceRun = 0;
      this.lastRunAt = now;
      void this.runOnce(projectId).catch((e) => {
        logger.warn("auto-improve: runOnce failed (silent)", {
          projectId,
          error: (e as Error).message,
        });
      });
    } catch (e) {
      logger.warn("auto-improve: maybeRun swallowed", {
        projectId,
        error: (e as Error).message,
      });
    }
  }

  /**
   * Run one auto-improve pass for `projectId`. Detects patterns, persists
   * pending proposals, and (when reviewGate is false) auto-applies them.
   * Never throws.
   */
  async runOnce(projectId: string): Promise<AutoImproveResult> {
    this.runCalls++;
    const noop: AutoImproveResult = {
      improved: false,
      proposalsCreated: 0,
      proposalsApplied: 0,
      source: "rule-based",
    };

    let observations: Observation[] = [];
    try {
      observations = this.observationStore.listRecent(projectId, this.maxWindow);
    } catch (e) {
      logger.warn("auto-improve: listRecent failed", {
        projectId,
        error: (e as Error).message,
      });
      return noop;
    }
    if (observations.length < 2) return noop;

    // Rule-based detection (never requires the LLM).
    let candidates = detectPatterns(observations, this.thresholds);
    if (candidates.length === 0) return noop;

    // Optional LLM enrichment (silent degrade).
    let source: "llm" | "rule-based" = "rule-based";
    try {
      const res = await enrichWithLlm(candidates, observations, this.llm);
      candidates = res.candidates;
      if (res.used) source = "llm";
    } catch (e) {
      logger.warn("auto-improve: enrichWithLlm threw (silent)", {
        projectId,
        error: (e as Error).message,
      });
    }

    // Dedup candidates by signalKey within this run.
    const seen = new Set<string>();
    const unique = candidates.filter((c) => {
      if (seen.has(c.signalKey)) return false;
      seen.add(c.signalKey);
      return true;
    });

    // Persist as pending proposals.
    const created: ProposalRecord[] = [];
    for (const c of unique) {
      const id = this.idFactory();
      const record: ProposalRecord = {
        id,
        projectId,
        kind: c.kind,
        targetMemoryId: c.targetMemoryId,
        payload: c.payload,
        rationale: c.rationale,
        status: "pending",
        createdAt: Date.now(),
        decidedAt: null,
      };
      try {
        this.proposalStore.insert(record);
        created.push(record);
      } catch (e) {
        logger.warn("auto-improve: proposal insert failed (skip)", {
          projectId,
          signalKey: c.signalKey,
          error: (e as Error).message,
        });
      }
    }
    if (created.length === 0) return noop;

    const result: AutoImproveResult = {
      improved: true,
      proposalsCreated: created.length,
      proposalsApplied: 0,
      source,
    };

    // Auto-approve path (default). Reuse approve() so the state machine +
    // event emission is identical to explicit approval.
    if (!this.reviewGate()) {
      let applied = 0;
      for (const r of created) {
        try {
          const res = await this.approve(r.id, projectId, source);
          if (res.ok) {
            applied++;
            logger.info("proposal:auto-approved", {
              id: r.id,
              projectId,
              kind: r.kind,
            });
          } else {
            logger.warn("proposal:auto-approved:skipped", {
              id: r.id,
              projectId,
              reason: res.reason,
            });
          }
        } catch (e) {
          logger.warn("proposal:auto-approved:threw", {
            id: r.id,
            projectId,
            error: (e as Error).message,
          });
        }
      }
      result.proposalsApplied = applied;
    }

    return result;
  }

  // ── approve / reject (R5 state machine) ──────────────────────────────────

  async approve(
    id: string,
    projectId?: string,
    source: "llm" | "rule-based" = "rule-based",
  ): Promise<ApproveRejectResult> {
    if (!id) return { ok: false, reason: "missing-id" };

    let row: ProposalRecord | null;
    try {
      row = this.proposalStore.getById(id);
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!row) return { ok: false, reason: "not-found" };

    if (projectId && row.projectId !== projectId) {
      return { ok: false, reason: "project-mismatch" };
    }
    if (row.status !== "pending") {
      return { ok: false, reason: "not-pending" };
    }

    // Apply the edit. Capture the affected memory id (fresh for create,
    // existing for update/tag) so the event + returned record carry it even
    // though the proposal row's `targetMemoryId` column may not have been
    // persisted with the freshly-assigned id.
    let appliedMemoryId: string | null = null;
    try {
      appliedMemoryId = await this.applyProposal(row);
    } catch (e) {
      logger.warn("proposal:apply-failed", {
        id,
        projectId: row.projectId,
        error: (e as Error).message,
      });
      return { ok: false, reason: "apply-failed" };
    }

    // Flip status → approved.
    let updated: ProposalRecord | null;
    try {
      updated = this.proposalStore.setStatus(id, "approved");
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!updated) return { ok: false, reason: "store-failed" };
    if (updated.status !== "approved") return { ok: false, reason: "not-pending" };

    // If a fresh memory id was assigned on apply, surface it on the returned
    // record + event payload (the store row keeps the original targetMemoryId).
    if (appliedMemoryId && !updated.targetMemoryId) {
      updated = { ...updated, targetMemoryId: appliedMemoryId };
    }

    // Emit (only on approve).
    eventBus.publish("memory:auto-improved", {
      proposalId: updated.id,
      projectId: updated.projectId,
      kind: updated.kind,
      targetMemoryId: updated.targetMemoryId ?? undefined,
      status: "approved",
      appliedAt: updated.decidedAt ?? Date.now(),
      source,
    });

    return { ok: true, proposal: updated };
  }

  async reject(
    id: string,
    projectId?: string,
    _reason?: string,
  ): Promise<ApproveRejectResult> {
    if (!id) return { ok: false, reason: "missing-id" };

    let row: ProposalRecord | null;
    try {
      row = this.proposalStore.getById(id);
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!row) return { ok: false, reason: "not-found" };

    if (projectId && row.projectId !== projectId) {
      return { ok: false, reason: "project-mismatch" };
    }
    if (row.status !== "pending") {
      return { ok: false, reason: "not-pending" };
    }

    let updated: ProposalRecord | null;
    try {
      updated = this.proposalStore.setStatus(id, "rejected");
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!updated) return { ok: false, reason: "store-failed" };
    if (updated.status !== "rejected") return { ok: false, reason: "not-pending" };

    // No apply, no event.
    return { ok: true, proposal: updated };
  }

  /**
   * Apply a proposal's edit to the memory store. Returns the affected memory
   * id (fresh for create, existing for update/tag). Throws on failure
   * (caller catches → apply-failed).
   *
   * The payload is a loose union; we dispatch on `kind` and treat the payload
   * as a plain record within each branch (defensive reads, never throws to
   * the caller — the outer approve() catches).
   */
  private async applyProposal(record: ProposalRecord): Promise<string | null> {
    const memId =
      record.targetMemoryId ??
      `proposal-mem-${record.id}-${randomUUID().slice(0, 8)}`;
    const p = record.payload as Record<string, unknown>;

    if (record.kind === "memory.create") {
      await Promise.resolve(
        this.memoryRepo.insert({
          id: memId,
          content: typeof p.content === "string" ? p.content : "",
          type: (p.type as MemoryType) ?? MemoryType.PATTERN,
          level: (p.level as MemoryLevel) ?? MemoryLevel.PROJECT,
          projectId: record.projectId,
          importance: typeof p.importance === "number" ? p.importance : 0.7,
          tags: Array.isArray(p.tags) ? (p.tags as string[]) : ["auto-improve"],
          embedding: [],
          metadata: {
            source: "auto-improve",
            proposalId: record.id,
            rationale: record.rationale,
          },
          pinned: false,
        }),
      );
      return memId;
    }

    if (record.kind === "memory.update") {
      if (!record.targetMemoryId) return null;
      const patch: UpdateMemoryPatch = {};
      if (typeof p.content === "string") patch.content = p.content;
      if (typeof p.importance === "number") patch.importance = p.importance;
      if (Array.isArray(p.tags)) patch.tags = p.tags as string[];
      this.memoryRepo.update(record.targetMemoryId, patch);
      return record.targetMemoryId;
    }

    if (record.kind === "memory.tag") {
      if (!record.targetMemoryId) return null;
      // Tag merge: append unique tags. Read-then-write is acceptable for the
      // low-contention proposal path (mirrors bootstrap/handoff best-effort).
      const tags = Array.isArray(p.tags) ? (p.tags as string[]) : [];
      this.memoryRepo.update(record.targetMemoryId, { tags });
      return record.targetMemoryId;
    }

    return null;
  }

  // ── listPending (surfacing) ──────────────────────────────────────────────

  listPending(projectId: string): ProposalRecord[] {
    try {
      return this.proposalStore.listPending(projectId);
    } catch {
      return [];
    }
  }
}

// ── Singleton ───────────────────────────────────────────────────────────────

let cachedJob: AutoImproveJob | null = null;

export function getAutoImproveJob(): AutoImproveJob {
  if (!cachedJob) cachedJob = new AutoImproveJob();
  return cachedJob;
}

export function resetAutoImproveJob(): void {
  cachedJob = null;
}

export const autoImproveJob = new AutoImproveJob();

// ── Helpers ─────────────────────────────────────────────────────────────────

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}
