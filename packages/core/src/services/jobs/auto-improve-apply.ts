/**
 * AutoImproveJob — apply logic (Wave 6 N31, T14)
 *
 * Extracted from auto-improve-job.ts. ApplyProposal, readTargetForApply,
 * validateCreatePayload, buildUpdatePatch, ApplyRejection.
 *
 * M14 delegate pattern: module functions receive the job instance as param
 * so they can access `this.memoryRepo`.
 */

import { randomUUID } from "crypto";
import { MemoryLevel, MemoryType } from "@massa-ai/shared";
import type { InsertMemoryInput, MemoryRow, UpdateMemoryPatch } from "../../data/memory/memory-repository.js";
import type { ProposalRecord } from "../../data/proposal/proposal-repository.js";
import type { AutoImproveJob, MemoryApplySeam } from "./auto-improve-job.js";
import { VALID_MEMORY_TYPES } from "./auto-improve-config.js";

// ── Apply-rejection + payload validation (M40 fail-closed) ──────────────────

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

/**
 * Fail-closed validation for `memory.create` payloads.
 */
export function validateCreatePayload(p: Record<string, unknown>): void {
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
 * Build an UpdateMemoryPatch from a `memory.update` payload.
 */
export function buildUpdatePatch(p: Record<string, unknown>): UpdateMemoryPatch {
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

// ── Apply + readTarget (delegate functions receiving the job instance) ─────

export async function applyProposal(
  job: { memoryRepo: MemoryApplySeam },
  record: ProposalRecord,
): Promise<string | null> {
  const memId =
    record.targetMemoryId ??
    `proposal-mem-${record.id}-${randomUUID().slice(0, 8)}`;
  const p = record.payload as Record<string, unknown>;

  if (record.kind === "memory.create") {
    validateCreatePayload(p);
    await Promise.resolve(
      job.memoryRepo.insert({
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
    const target = await readTargetForApply(job, record.targetMemoryId);
    const patch = buildUpdatePatch(p);
    job.memoryRepo.update(target.id, patch);
    return target.id;
  }

  if (record.kind === "memory.tag") {
    if (!record.targetMemoryId) return null;
    const target = await readTargetForApply(job, record.targetMemoryId);
    if (!Array.isArray(p.tags)) {
      throw new ApplyRejection("malformed-payload");
    }
    const tags = (p.tags as string[]).filter(
      (t) => typeof t === "string" && t.length > 0,
    );
    job.memoryRepo.update(target.id, { tags });
    return target.id;
  }

  return null;
}

export async function readTargetForApply(
  job: { memoryRepo: MemoryApplySeam },
  targetMemoryId: string,
): Promise<MemoryRow> {
  let row: MemoryRow | null;
  try {
    row = await Promise.resolve(job.memoryRepo.getById(targetMemoryId));
  } catch (e) {
    throw new ApplyRejection(
      "unreadable_target",
      `getById threw: ${(e as Error).message}`,
    );
  }
  if (!row) {
    throw new ApplyRejection("unreadable_target", "target memory not found");
  }
  const pinned = row.pinned as unknown as number | boolean;
  if (pinned === 1 || pinned === true) {
    throw new ApplyRejection(
      "pinned",
      `target ${targetMemoryId} is pinned; auto-improve cannot rewrite it`,
    );
  }
  return row;
}