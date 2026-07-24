/**
 * AutoImproveJob — run/approve/reject operations (Wave 6 N31, T14)
 *
 * Extracted from auto-improve-job.ts class methods. M14 delegate pattern:
 * functions receive the job instance as first param.
 */

import { logger } from "@massa-ai/shared";
import type { ProposalRecord } from "../../data/proposal/proposal-repository.js";
import type { Observation } from "../../data/memory/observation-repository.js";
import { eventBus } from "../events/event-bus.js";
import { SearchServiceError } from "../search/search-diagnostics.js";
import { detectPatterns } from "./auto-improve-patterns.js";
import { enrichWithLlm } from "./auto-improve-llm.js";
import { applyProposal, ApplyRejection } from "./auto-improve-apply.js";
import { readAutoImproveConfig } from "./auto-improve-config.js";
import type { AutoImproveJob, AutoImproveResult, ApproveRejectResult } from "./auto-improve-job.js";

export async function runOnce(job: AutoImproveJob, projectId: string): Promise<AutoImproveResult> {
  job.runCalls++;
  const noop: AutoImproveResult = {
    improved: false, proposalsCreated: 0, proposalsApplied: 0, source: "rule-based",
  };

  let observations: Observation[] = [];
  try {
    observations = job.observationStore.listRecent(projectId, job.maxWindow);
  } catch (e) {
    logger.warn("auto-improve: listRecent failed", { projectId, error: (e as Error).message });
    return noop;
  }
  if (observations.length < 2) return noop;

  let candidates = detectPatterns(observations, job.thresholds);
  if (candidates.length === 0) return noop;

  let source: "llm" | "rule-based" = "rule-based";
  try {
    const res = await enrichWithLlm(candidates, observations, job.llm);
    candidates = res.candidates;
    if (res.used) source = "llm";
  } catch (e) {
    logger.warn("auto-improve: enrichWithLlm threw (silent)", { projectId, error: (e as Error).message });
  }

  const seen = new Set<string>();
  const unique = candidates.filter((c) => {
    if (seen.has(c.signalKey)) return false;
    seen.add(c.signalKey);
    return true;
  });

  const created: ProposalRecord[] = [];
  for (const c of unique) {
    const id = job.idFactory();
    const record: ProposalRecord = {
      id, projectId, kind: c.kind, targetMemoryId: c.targetMemoryId,
      payload: c.payload, rationale: c.rationale, status: "pending",
      createdAt: Date.now(), decidedAt: null,
    };
    await job.proposalStore.insert(record);
    created.push(record);
  }
  if (created.length === 0) return noop;

  const result: AutoImproveResult = {
    improved: true, proposalsCreated: created.length, proposalsApplied: 0, source,
  };

  if (!job.reviewGate()) {
    let applied = 0;
    for (const r of created) {
      try {
        const res = await approve(job, r.id, projectId, source);
        if (res.ok) {
          applied++;
          logger.info("proposal:auto-approved", { id: r.id, projectId, kind: r.kind });
        } else {
          logger.warn("proposal:auto-approved:skipped", { id: r.id, projectId, reason: res.reason });
        }
      } catch (e) {
        if (e instanceof SearchServiceError) throw e;
        logger.warn("proposal:auto-approved:threw", { id: r.id, projectId, error: (e as Error).message });
      }
    }
    result.proposalsApplied = applied;
  }

  return result;
}

export async function approve(
  job: AutoImproveJob,
  id: string,
  projectId?: string,
  source: "llm" | "rule-based" = "rule-based",
): Promise<ApproveRejectResult> {
  if (!id) return { ok: false, reason: "missing-id" };

  let row: ProposalRecord | null;
  try {
    row = await job.proposalStore.getById(id);
  } catch (error) {
    if (error instanceof SearchServiceError) throw error;
    return { ok: false, reason: "store-failed" };
  }
  if (!row) return { ok: false, reason: "not-found" };

  if (projectId && row.projectId !== projectId) return { ok: false, reason: "project-mismatch" };
  if (row.status !== "pending") return { ok: false, reason: "not-pending" };

  let appliedMemoryId: string | null = null;
  try {
    appliedMemoryId = await applyProposal(job, row);
  } catch (e) {
    const reason = e instanceof ApplyRejection ? e.reason : "apply-failed";
    logger.warn("proposal:apply-failed", { id, projectId: row.projectId, reason, error: (e as Error).message });
    return { ok: false, reason };
  }

  let updated: ProposalRecord | null;
  try {
    updated = await job.proposalStore.setStatus(id, "approved");
  } catch (error) {
    if (error instanceof SearchServiceError) throw error;
    return { ok: false, reason: "store-failed" };
  }
  if (!updated) return { ok: false, reason: "store-failed" };
  if (updated.status !== "approved") return { ok: false, reason: "not-pending" };

  if (appliedMemoryId && !updated.targetMemoryId) {
    updated = { ...updated, targetMemoryId: appliedMemoryId };
  }

  eventBus.publish("memory:auto-improved", {
    proposalId: updated.id, projectId: updated.projectId, kind: updated.kind,
    targetMemoryId: updated.targetMemoryId ?? undefined, status: "approved",
    appliedAt: updated.decidedAt ?? Date.now(), source,
  });

  return { ok: true, proposal: updated };
}

export async function reject(
  job: AutoImproveJob,
  id: string,
  projectId?: string,
): Promise<ApproveRejectResult> {
  if (!id) return { ok: false, reason: "missing-id" };

  let row: ProposalRecord | null;
  try {
    row = await job.proposalStore.getById(id);
  } catch (error) {
    if (error instanceof SearchServiceError) throw error;
      return { ok: false, reason: "store-failed" };
    }
    if (!row) return { ok: false, reason: "not-found" };

    if (projectId && row.projectId !== projectId) return { ok: false, reason: "project-mismatch" };
    if (row.status !== "pending") return { ok: false, reason: "not-pending" };

    let updated: ProposalRecord | null;
    try {
      updated = await job.proposalStore.setStatus(id, "rejected");
    } catch (error) {
      if (error instanceof SearchServiceError) throw error;
      return { ok: false, reason: "store-failed" };
    }
    if (!updated) return { ok: false, reason: "store-failed" };
    if (updated.status !== "rejected") return { ok: false, reason: "not-pending" };

    return { ok: true, proposal: updated };
}