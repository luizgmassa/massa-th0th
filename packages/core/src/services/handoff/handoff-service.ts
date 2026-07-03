/**
 * HandoffService — Phase 6 cross-session handoffs (G2).
 *
 * Lets an agent (session A) leave a structured handoff for a later agent
 * (session B). The handoff is persisted in the Handoff table AND
 * dual-written as a searchable `conversation` memory (FTS-discoverable
 * independently of the Handoff table).
 *
 * Contract (spec.md R1–R7, NF1–NF5):
 *  - State machine: open → accepted | expired (both terminal).
 *  - accept/cancel only valid on an `open` row; everything else is a
 *    clear `{ok:false, reason}` failure (never a silent no-op).
 *  - Silent degradation: optional LLM summary-polish is default-off and
 *    best-effort; store/memory insert failures become `{ok:false}`
 *    results. NEVER throws to the caller.
 *  - Backend-polymorphic via the HandoffStore factory (no
 *    `isPostgresEnabled()` short-circuit).
 *
 * Test-isolation (mirrors Phase-4 BootstrapService): the ctor accepts
 * injectable `store`, `memoryRepo`, `llm`, and `idFactory` seams.
 * Defaults resolve lazily at run time so the closed-MemoryRepository
 * landmine (memory-crud.test.ts) does not poison handoff tests.
 */

import { randomUUID } from "crypto";
import { z } from "zod";
import { MemoryLevel, MemoryType } from "@massa-th0th/shared";
import {
  getHandoffStore,
  newHandoffId,
  type HandoffRecord,
  type HandoffStore,
} from "../../data/handoff/handoff-repository.js";
import { getMemoryRepository } from "../../data/memory/memory-repository-factory.js";
import type { InsertMemoryInput } from "../../data/memory/memory-repository.js";
import { eventBus } from "../events/event-bus.js";
import { llm as defaultLlmSurface } from "../memory/llm-client.js";
import type { LlmSurface } from "../memory/consolidator.js";

// ── Public types ────────────────────────────────────────────────────────────

export interface BeginHandoffInput {
  projectId: string;
  sourceSessionId?: string;
  targetAgent?: string;
  summary?: string;
  openQuestions?: string[];
  nextSteps?: string[];
  files?: string[];
}

export interface BeginResult {
  ok: boolean;
  id?: string;
  status?: "open";
  memoryId?: string | null;
  reason?: string;
}

export interface AcceptCancelResult {
  ok: boolean;
  handoff?: HandoffRecord;
  reason?: string;
}

/**
 * Injectable memory-repository seam. The default implementation resolves
 * getMemoryRepository() lazily inside each method (test-isolation).
 */
export interface HandoffMemorySeam {
  insert(input: InsertMemoryInput): void | Promise<void>;
}

export interface HandoffDeps {
  store?: HandoffStore;
  memoryRepo?: HandoffMemorySeam;
  llm?: LlmSurface;
  idFactory?: () => string;
}

// ── Constants ───────────────────────────────────────────────────────────────

const MAX_SUMMARY_CHARS = 1024;
const HANDOFF_IMPORTANCE = 0.7;

// ── LLM schema (R7 optional polish) ─────────────────────────────────────────

const HandoffSummarySchema = z.object({
  summary: z.string().min(1).max(MAX_SUMMARY_CHARS),
});

// ── Service ─────────────────────────────────────────────────────────────────

export class HandoffService {
  private readonly store: HandoffStore;
  private readonly memoryRepo: HandoffMemorySeam;
  private readonly llm: LlmSurface;
  private readonly idFactory: () => string;

  constructor(deps: HandoffDeps = {}) {
    this.store = deps.store ?? getHandoffStore();
    this.llm = deps.llm ?? defaultLlmSurface;
    this.idFactory = deps.idFactory ?? (() => newHandoffId());
    // Lazy resolver so the memory repo is touched at run time (not ctor
    // time) unless a test injects one. Mirrors bootstrap-service.ts.
    const injectedRepo = deps.memoryRepo;
    this.memoryRepo =
      injectedRepo ??
      ({
        insert: (i: InsertMemoryInput) => getMemoryRepository().insert(i),
      } as HandoffMemorySeam);
  }

  // ── begin (R1, R2, R5, R7) ────────────────────────────────────────────────

  async begin(input: BeginHandoffInput): Promise<BeginResult> {
    if (!input || !input.projectId || !String(input.projectId).trim()) {
      return { ok: false, reason: "missing-project" };
    }

    let summary = truncate(input.summary ?? "", MAX_SUMMARY_CHARS);

    // R7 optional LLM polish: only when LLM is enabled AND summary is empty.
    // Best-effort; never blocks begin.
    if (!summary) {
      try {
        if (this.llm.isEnabled()) {
          const polished = await polishSummary(this.llm, input);
          if (polished) summary = truncate(polished, MAX_SUMMARY_CHARS);
        }
      } catch {
        /* fall through with empty/auto summary */
      }
    }

    const id = this.idFactory();
    const now = Date.now();
    const record: HandoffRecord = {
      id,
      projectId: input.projectId.trim(),
      sourceSessionId: input.sourceSessionId ?? null,
      targetAgent: input.targetAgent ?? null,
      summary,
      openQuestions: dedupStrings(input.openQuestions),
      nextSteps: dedupStrings(input.nextSteps),
      files: dedupStrings(input.files),
      status: "open",
      createdAt: now,
      acceptedAt: null,
    };

    try {
      this.store.insert(record);
    } catch {
      return { ok: false, reason: "store-failed" };
    }

    // R5 dual-write: best-effort searchable memory.
    let memoryId: string | null = null;
    try {
      memoryId = await this.dualWrite(record);
    } catch {
      memoryId = null;
    }

    return { ok: true, id, status: "open", memoryId };
  }

  private async dualWrite(record: HandoffRecord): Promise<string | null> {
    const memId = `handoff-mem-${record.id}-${randomUUID().slice(0, 8)}`;
    const input = buildHandoffMemoryInput(memId, record);
    await Promise.resolve(this.memoryRepo.insert(input));
    return memId;
  }

  // ── accept (R1, R2, R6) ───────────────────────────────────────────────────

  async accept(params: {
    id: string;
    projectId?: string;
  }): Promise<AcceptCancelResult> {
    return this.terminate(params, "accepted");
  }

  // ── cancel (R1, R2) ───────────────────────────────────────────────────────

  async cancel(params: {
    id: string;
    projectId?: string;
  }): Promise<AcceptCancelResult> {
    return this.terminate(params, "expired");
  }

  private async terminate(
    params: { id: string; projectId?: string },
    target: "accepted" | "expired",
  ): Promise<AcceptCancelResult> {
    if (!params || !params.id) {
      return { ok: false, reason: "missing-id" };
    }

    let row: HandoffRecord | null;
    try {
      row = this.store.getById(params.id);
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!row) return { ok: false, reason: "not-found" };

    if (params.projectId && row.projectId !== params.projectId) {
      return { ok: false, reason: "project-mismatch" };
    }
    if (row.status !== "open") {
      return { ok: false, reason: "not-open" };
    }

    const acceptedAt = target === "accepted" ? Date.now() : undefined;
    let updated: HandoffRecord | null;
    try {
      updated = this.store.setStatus(params.id, target, acceptedAt);
    } catch {
      return { ok: false, reason: "store-failed" };
    }
    if (!updated) return { ok: false, reason: "store-failed" };
    if (updated.status !== target) return { ok: false, reason: "not-open" };

    // R6 emit (only on accept).
    if (target === "accepted") {
      eventBus.publish("handoff:accepted", {
        handoffId: updated.id,
        projectId: updated.projectId,
        sourceSessionId: updated.sourceSessionId ?? undefined,
        targetAgent: updated.targetAgent ?? undefined,
        acceptedAt: updated.acceptedAt ?? Date.now(),
      });
    }

    return { ok: true, handoff: updated };
  }

  // ── listPending (R3 surfacing) ────────────────────────────────────────────

  listPending(projectId: string, targetAgent?: string | null): HandoffRecord[] {
    try {
      return this.store.listPending(projectId, targetAgent ?? undefined);
    } catch {
      return [];
    }
  }
}

// ── Pure helpers ────────────────────────────────────────────────────────────

export function buildHandoffMemoryInput(
  memId: string,
  record: HandoffRecord,
): InsertMemoryInput {
  const content = formatMemoryContent(record);
  return {
    id: memId,
    content,
    type: MemoryType.CONVERSATION,
    level: MemoryLevel.PROJECT,
    projectId: record.projectId,
    importance: HANDOFF_IMPORTANCE,
    tags: ["handoff", `handoff:${record.id}`, `handoff:${record.projectId}`],
    embedding: [],
    metadata: {
      source: "handoff",
      handoffId: record.id,
      targetAgent: record.targetAgent,
      sourceSessionId: record.sourceSessionId,
    },
    pinned: false,
  };
}

export function formatMemoryContent(record: HandoffRecord): string {
  const parts: string[] = [`Handoff: ${record.summary || "(no summary)"}`];
  if (record.openQuestions.length > 0) {
    parts.push("Open questions: " + record.openQuestions.join("; "));
  }
  if (record.nextSteps.length > 0) {
    parts.push("Next steps: " + record.nextSteps.join("; "));
  }
  if (record.files.length > 0) {
    parts.push("Files: " + record.files.join(", "));
  }
  return truncate(parts.join("\n"), 2048);
}

async function polishSummary(
  surface: LlmSurface,
  input: BeginHandoffInput,
): Promise<string | null> {
  const prompt = buildPolishPrompt(input);
  const res = await surface.object(prompt, HandoffSummarySchema);
  if (!res.ok || !res.value || !res.value.summary) return null;
  return res.value.summary;
}

function buildPolishPrompt(input: BeginHandoffInput): string {
  const parts: string[] = [
    "You are drafting a cross-session handoff summary for a software agent.",
    "Synthesize a concise summary (max 1024 chars) from the open questions and",
    "next steps below. Return JSON: { summary: string }.",
  ];
  if (input.openQuestions && input.openQuestions.length > 0) {
    parts.push("Open questions:\n" + input.openQuestions.map((q) => "- " + q).join("\n"));
  }
  if (input.nextSteps && input.nextSteps.length > 0) {
    parts.push("Next steps:\n" + input.nextSteps.map((s) => "- " + s).join("\n"));
  }
  return parts.join("\n");
}

function dedupStrings(arr?: string[]): string[] {
  if (!arr || !Array.isArray(arr)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of arr) {
    const v = String(s).trim();
    if (!v) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}

// ── Singleton ───────────────────────────────────────────────────────────────

let cachedService: HandoffService | null = null;

export function getHandoffService(): HandoffService {
  if (!cachedService) cachedService = new HandoffService();
  return cachedService;
}

export function resetHandoffService(): void {
  cachedService = null;
}
