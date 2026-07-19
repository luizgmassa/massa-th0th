/**
 * AutoImproveJob — Phase 5 auto-improvement loop (G7).
 *
 * Reviews recent observations for a project, detects recurring patterns
 * (repeated queries, frequently-referenced files, common fixes), and
 * proposes memory edits as `pending` proposals with an audit trail.
 *
 * Contract (spec.md R1–R8):
 *  - Trigger-driven with a debounce (every minObservations OR minIntervalMs),
 *    fired from the observation-ingest path. Optional enrichment degrades;
 *    canonical proposal persistence failures remain fail-loud.
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
import type { InsertMemoryInput, MemoryRow, UpdateMemoryPatch } from "../../data/memory/memory-repository.js";
import { eventBus } from "../events/event-bus.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { LlmSurface } from "../memory/consolidator.js";
import { SearchServiceError } from "../search/search-diagnostics.js";

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
 *
 * `getById` is the read seam used by applyProposal to enforce the pinned-memory
 * invariant (M40): the auto-improve apply path must NEVER rewrite a pinned
 * memory and must FAIL CLOSED on unreadable/missing targets. Mirrors the
 * exemption already honored by memory-consolidation-job.
 */
export interface MemoryApplySeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
  update(id: string, patch: UpdateMemoryPatch): boolean;
  getById(
    id: string,
  ): MemoryRow | null | Promise<MemoryRow | null>;
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

// ── Apply-rejection + payload validation (M40 fail-closed) ──────────────────

/**
 * Apply-phase rejection with a structured reason. approve() surfaces
 * `reason` verbatim so callers distinguish the pinned-memory invariant
 * (`pinned`), an unreadable/missing target (`unreadable_target`), and a
 * malformed proposal payload (`malformed-payload`) from generic apply-failed.
 */
export type ApplyRejectionReason =
  | "pinned"
  | "unreadable_target"
  | "malformed-payload";

export class ApplyRejection extends Error {
  readonly reason: ApplyRejectionReason;
  constructor(reason: ApplyRejectionReason, message?: string) {
    super(message ?? reason);
    this.name = "ApplyRejection";
    this.reason = reason;
  }
}

/** Set of valid MemoryType string values, for present-but-invalid checks. */
const VALID_MEMORY_TYPES = new Set<string>(Object.values(MemoryType));

/**
 * Fail-closed validation for `memory.create` payloads. Genuinely-optional
 * fields (no key present) may keep their defaults; a PRESENT-but-invalid
 * required field is rejected instead of silently coerced. Never throws a bare
 * Error — throws ApplyRejection("malformed-payload") so approve() surfaces it.
 */
function validateCreatePayload(p: Record<string, unknown>): void {
  if ("type" in p && p.type !== undefined && p.type !== null) {
    if (typeof p.type !== "string" || !VALID_MEMORY_TYPES.has(p.type)) {
      throw new ApplyRejection(
        "malformed-payload",
        `invalid memory type: ${JSON.stringify(p.type)}`,
      );
    }
  }
  if ("importance" in p && p.importance !== undefined && p.importance !== null) {
    if (
      typeof p.importance !== "number" ||
      !Number.isFinite(p.importance) ||
      p.importance < 0 ||
      p.importance > 1
    ) {
      throw new ApplyRejection(
        "malformed-payload",
        `invalid importance: ${JSON.stringify(p.importance)}`,
      );
    }
  }
  if ("tags" in p && p.tags !== undefined && p.tags !== null) {
    if (!Array.isArray(p.tags) || !p.tags.every((t) => typeof t === "string")) {
      throw new ApplyRejection("malformed-payload", "invalid tags");
    }
  }
}

/**
 * Build an UpdateMemoryPatch from a `memory.update` payload, validating each
 * present field fail-closed. A present-but-invalid field → ApplyRejection.
 * Optional-absent fields are skipped (behavior-preserving).
 */
function buildUpdatePatch(p: Record<string, unknown>): UpdateMemoryPatch {
  const patch: UpdateMemoryPatch = {};
  if ("content" in p && p.content !== undefined && p.content !== null) {
    if (typeof p.content !== "string") {
      throw new ApplyRejection("malformed-payload", "invalid content");
    }
    patch.content = p.content;
  }
  if ("importance" in p && p.importance !== undefined && p.importance !== null) {
    if (
      typeof p.importance !== "number" ||
      !Number.isFinite(p.importance) ||
      p.importance < 0 ||
      p.importance > 1
    ) {
      throw new ApplyRejection(
        "malformed-payload",
        `invalid importance: ${JSON.stringify(p.importance)}`,
      );
    }
    patch.importance = p.importance;
  }
  if ("tags" in p && p.tags !== undefined && p.tags !== null) {
    if (!Array.isArray(p.tags) || !p.tags.every((t) => typeof t === "string")) {
      throw new ApplyRejection("malformed-payload", "invalid tags");
    }
    patch.tags = p.tags as string[];
  }
  return patch;
}

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
        getById: (id: string) => getMemoryRepository().getById(id),
      } as unknown as MemoryApplySeam);

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
   * Optional analysis failures degrade, but durable proposal persistence
   * failures propagate so callers cannot mistake a lost write for success.
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
      await this.proposalStore.insert(record);
      created.push(record);
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
          if (e instanceof SearchServiceError) throw e;
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
      row = await this.proposalStore.getById(id);
    } catch (error) {
      if (error instanceof SearchServiceError) throw error;
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
      // Surface ApplyRejection reasons verbatim so callers can distinguish the
      // pinned invariant (pinned), an unreadable target (unreadable_target),
      // and a malformed payload (malformed-payload) from a generic apply-failed.
      const reason =
        e instanceof ApplyRejection ? e.reason : "apply-failed";
      logger.warn("proposal:apply-failed", {
        id,
        projectId: row.projectId,
        reason,
        error: (e as Error).message,
      });
      return { ok: false, reason };
    }

    // Flip status → approved.
    let updated: ProposalRecord | null;
    try {
      updated = await this.proposalStore.setStatus(id, "approved");
    } catch (error) {
      if (error instanceof SearchServiceError) throw error;
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
      row = await this.proposalStore.getById(id);
    } catch (error) {
      if (error instanceof SearchServiceError) throw error;
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
      updated = await this.proposalStore.setStatus(id, "rejected");
    } catch (error) {
      if (error instanceof SearchServiceError) throw error;
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
   * (caller catches → apply-failed, or the specific ApplyRejection.reason).
   *
   * Pinned-memory invariant (M40): the `memory.update` / `memory.tag` branches
   * read the target row BEFORE mutating. If the target is unreadable/missing
   * the apply FAILS CLOSED (`unreadable_target`, no mutation); if the target is
   * pinned it is rejected with `pinned` and NO mutation, mirroring the
   * exemption consolidation already honors. The common unpinned+well-formed
   * case is behavior-preserving.
   *
   * The payload is a loose union; we dispatch on `kind` and treat the payload
   * as a plain record within each branch. Malformed-but-present required fields
   * are rejected (fail-closed) rather than silently coerced, so a bad proposal
   * surfaces loudly instead of papering over the bad value with a default.
   */
  private async applyProposal(record: ProposalRecord): Promise<string | null> {
    const memId =
      record.targetMemoryId ??
      `proposal-mem-${record.id}-${randomUUID().slice(0, 8)}`;
    const p = record.payload as Record<string, unknown>;

    if (record.kind === "memory.create") {
      // Fail-closed payload validation: a present-but-invalid `type` or
      // `importance` is rejected rather than silently defaulted away.
      validateCreatePayload(p);
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
      // Pinned-memory invariant: read the target before any mutation.
      const target = await this.readTargetForApply(record.targetMemoryId);
      // Fail-closed payload validation on the patch shape.
      const patch = buildUpdatePatch(p);
      this.memoryRepo.update(target.id, patch);
      return target.id;
    }

    if (record.kind === "memory.tag") {
      if (!record.targetMemoryId) return null;
      // Pinned-memory invariant: read the target before any mutation.
      const target = await this.readTargetForApply(record.targetMemoryId);
      // Tag merge: append unique tags. Read-then-write is acceptable for the
      // low-contention proposal path (mirrors bootstrap/handoff best-effort).
      if (!Array.isArray(p.tags)) {
        // A malformed tag proposal has no usable tag set → reject closed.
        throw new ApplyRejection("malformed-payload");
      }
      const tags = (p.tags as string[]).filter(
        (t) => typeof t === "string" && t.length > 0,
      );
      this.memoryRepo.update(target.id, { tags });
      return target.id;
    }

    return null;
  }

  /**
   * Read the target memory row for an apply, enforcing the pinned invariant.
   * Returns the row when it exists and is NOT pinned. Throws ApplyRejection
   * with reason `unreadable_target` (missing/unreadable) or `pinned` (immu)
   * so approve() surfaces the specific reason instead of generic apply-failed.
   *
   * The pinned truthy check mirrors decay.ts (`pinned === 1 || pinned === true`).
   */
  private async readTargetForApply(targetMemoryId: string): Promise<MemoryRow> {
    let row: MemoryRow | null;
    try {
      row = await Promise.resolve(this.memoryRepo.getById(targetMemoryId));
    } catch (e) {
      throw new ApplyRejection(
        "unreadable_target",
        `getById threw: ${(e as Error).message}`,
      );
    }
    if (!row) {
      throw new ApplyRejection("unreadable_target", "target memory not found");
    }
    // Match decay.ts's exact truthy check for pinned (0/1 from the row, or
    // bool). Cast through unknown so TS keeps both arms of the comparison
    // without narrowing away the boolean case; the runtime check is identical
    // to decay.ts (`pinned === 1 || pinned === true`).
    const pinned = row.pinned as unknown as number | boolean;
    if (pinned === 1 || pinned === true) {
      throw new ApplyRejection(
        "pinned",
        `target ${targetMemoryId} is pinned; auto-improve cannot rewrite it`,
      );
    }
    return row;
  }

  // ── listPending (surfacing) ──────────────────────────────────────────────

  async listPending(projectId: string): Promise<ProposalRecord[]> {
    return this.proposalStore.listPending(projectId);
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
