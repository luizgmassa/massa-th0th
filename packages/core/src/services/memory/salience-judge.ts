/**
 * Salience Judge (Phase 7b, plan item 7b).
 *
 * Scores the importance/salience (∈ [0,1]) of a memory's content + type, for
 * the `MemoryController.store` path when the caller omits `importance`. The
 * scored value IS the `salience` input to Phase-1 `decayScore` (the memories
 * table `importance` column already drives decay).
 *
 * Contract (cross-cutting §1 + spec R7B-01..04):
 *   - Default-off via `config.memory.autoImportance.enabled`.
 *   - Silent degradation: on `!isLlmEnabled()`, `{ok:false}`, or any throw,
 *     returns the neutral default 0.5. Never throws to the caller (store()).
 *   - Embedding-independence: scores from content only — the Phase-4/5/6 FTS-only
 *     seed memories (embedding:[]) are scored identically.
 *   - Truncates very-long content to the LLM context budget before scoring.
 *
 * Pure over inputs + the injected LLM surface, so tests inject fakes without
 * touching config or network (design.md §7).
 */

import { z } from "zod";
import { config, logger } from "@massa-th0th/shared";
import type { MemoryType } from "@massa-th0th/shared";
import type { QueryLlmSurface } from "../search/query-understanding.js";
import { llm as defaultLlmHandle } from "./llm-client.js";

// ─── Zod schema ────────────────────────────────────────────────────────────────

export const SalienceSchema = z.object({
  importance: z.number().min(0).max(1),
});

export type Salience = z.infer<typeof SalienceSchema>;

// ─── Defaults ──────────────────────────────────────────────────────────────────

/** Neutral default returned on every degradation path. */
export const NEUTRAL_SALIENCE = 0.5;
/** Truncate content before the LLM call to bound prompt size. */
const CONTENT_TRUNCATE_CHARS = 2000;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Stateful handle bundling scoreSalience. Stateless; the `llm` surface is
 * injectable for tests.
 */
export class SalienceJudge {
  constructor(private readonly llm: QueryLlmSurface = defaultLlmHandle) {}

  /**
   * Score salience ∈ [0,1] for the given content + memory type.
   *
   * - When `!isLlmEnabled()` OR `autoImportance.enabled` is false OR `{ok:false}`
   *   OR throw → returns `NEUTRAL_SALIENCE` (0.5). Logged at warn on failure.
   * - Empty/whitespace content → neutral (no signal to score).
   */
  async scoreSalience(
    content: string,
    type: MemoryType,
  ): Promise<{ salience: number; source: "llm" | "default" }> {
    const memCfg = config.get("memory") as { autoImportance?: { enabled?: boolean } };
    if (!memCfg.autoImportance?.enabled) {
      return { salience: NEUTRAL_SALIENCE, source: "default" };
    }
    if (!this.llm.isEnabled()) {
      return { salience: NEUTRAL_SALIENCE, source: "default" };
    }
    const trimmed = (content ?? "").trim();
    if (trimmed.length === 0) {
      return { salience: NEUTRAL_SALIENCE, source: "default" };
    }

    const prompt = buildPrompt(trimmed, type);

    let verdict: Salience | null;
    try {
      const res = await this.llm.object(prompt, SalienceSchema);
      verdict = res.ok ? (res.value ?? null) : null;
    } catch (e) {
      logger.warn("SalienceJudge threw — degrading to neutral default", {
        type,
        error: (e as Error).message,
      });
      return { salience: NEUTRAL_SALIENCE, source: "default" };
    }

    if (!verdict) {
      logger.warn("SalienceJudge got {ok:false} — degrading to neutral default", {
        type,
      });
      return { salience: NEUTRAL_SALIENCE, source: "default" };
    }

    // Clamp defensively (zod already bounds 0..1, but be robust to {value} cast).
    const clamped = Math.max(0, Math.min(1, verdict.importance));
    return { salience: clamped, source: "llm" };
  }
}

/**
 * Module-level convenience wrapper for the default-configured judge. Kept thin
 * so MemoryController can swap a fake via ctor DI in tests.
 */
let activeJudge: SalienceJudge | null = null;
export function getSalienceJudge(): SalienceJudge {
  if (!activeJudge) activeJudge = new SalienceJudge();
  return activeJudge;
}
/** Test seam: override the module-level judge. */
export function _setSalienceJudgeForTesting(judge: SalienceJudge | null): void {
  activeJudge = judge;
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function buildPrompt(content: string, type: MemoryType): string {
  const slice = content.slice(0, CONTENT_TRUNCATE_CHARS);
  return [
    "You are scoring memory salience for a long-term memory system.",
    "Score the importance of the following memory on a 0..1 scale, where 1 is",
    "highly reusable/critical and 0 is trivial/ephemeral. Consider decision-impact,",
    "reusability across future tasks, and rarity of the information.",
    "Return ONLY a JSON object {\"importance\": number} with importance in [0,1].",
    "",
    `Memory type: ${type}`,
    "",
    "Content:",
    slice,
  ].join("\n");
}
