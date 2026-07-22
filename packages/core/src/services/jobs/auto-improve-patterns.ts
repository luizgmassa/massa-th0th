/**
 * AutoImproveJob — pattern detection (Wave 6 N31, T13)
 *
 * Extracted from auto-improve-job.ts. Pure rule-based pattern detection
 * that never requires the LLM. Returns PatternCandidate[] from observation
 * frequency analysis.
 */

import { MemoryLevel, MemoryType } from "@massa-th0th/shared";
import type { Observation } from "../../data/memory/observation-repository.js";
import type { PatternCandidate, PatternThresholds } from "./auto-improve-job.js";
import { DEFAULT_THRESHOLDS } from "./auto-improve-config.js";

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

export function extractQuery(payload: any): string | null {
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

export function extractFilePath(payload: any): string | null {
  const raw =
    payload?.filePath ??
    payload?.file_path ??
    payload?.tool_input?.file_path ??
    payload?.tool_input?.path ??
    payload?.path;
  if (typeof raw !== "string" || !raw.trim()) return null;
  return raw.replace(/^\.\/+/, "").trim();
}

export function extractFixSignature(payload: any): string | null {
  const tool = typeof payload?.tool === "string" ? payload.tool : payload?.tool_name;
  if (typeof tool !== "string" || !tool.trim()) return null;
  const fp = extractFilePath(payload) ?? "";
  const bucket = fp ? pathBucket(fp) : "unknown";
  return `${tool}:${bucket}`;
}

export function pathBucket(p: string): string {
  const parts = p.split("/");
  if (parts.length <= 1) return "root";
  return parts.slice(0, -1).join("/");
}

export const STOPWORDS = new Set([
  "the","a","an","is","are","was","were","be","been","being","to","of","in","on",
  "for","and","or","how","do","i","what","why","when","where","with","this","that",
  "it","my","me","please","can","you","into","from","at","as","by","if","so",
]);

export function normalizeSignature(text: string): string {
  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t && !STOPWORDS.has(t));
  if (tokens.length === 0) {
    return text.toLowerCase().replace(/\s+/g, " ").trim().slice(0, 60);
  }
  return [...tokens]
    .sort((a, b) => b.length - a.length)
    .slice(0, 3)
    .sort()
    .join(" ");
}

export function truncate(s: string, max: number): string {
  if (!s) return s;
  return s.length <= max ? s : s.slice(0, max - 1) + "…";
}