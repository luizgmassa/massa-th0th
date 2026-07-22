/**
 * AutoImproveJob — LLM enrichment (Wave 6 N31, T13)
 *
 * Extracted from auto-improve-job.ts. Optional LLM-based refinement of
 * pattern candidates. Silent-degrade: on failure/invalid → return the
 * rule-based candidates verbatim. Never throws.
 */

import { z } from "zod";
import type { Observation } from "../../data/memory/observation-repository.js";
import type { LlmSurface } from "../memory/consolidator.js";
import type { PatternCandidate } from "./auto-improve-job.js";
import { truncate } from "./auto-improve-patterns.js";

const ProposalEnrichmentItemSchema = z.object({
  signalKey: z.string(),
  content: z.string(),
  rationale: z.string(),
});

export const ProposalEnrichmentSchema = z.object({
  items: z.array(ProposalEnrichmentItemSchema),
});

export type ProposalEnrichment = z.infer<typeof ProposalEnrichmentSchema>;

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

export function buildEnrichmentPrompt(
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