/**
 * LLM-Judge Reranker (Phase 7a, plan item 7a).
 *
 * Re-scores the top-K (`search.rerank.rerankWindow`, default 50) results of a
 * fused/centrality-boosted list via a single `llmObject` call with a strict zod
 * schema. The returned `rankedIds` is a permutation guide:
 *   - ids present in both verdict + window → placed in LLM order.
 *   - ids missing from the verdict → appended in their original order.
 *   - duplicate ids in the verdict → first occurrence wins, rest dropped.
 *
 * Contract (cross-cutting §1 + spec R7A-02):
 *   - Default-off via `config.search.rerank.enabled`.
 *   - Silent degradation: on `!isLlmEnabled()`, `{ok:false}`, or any throw,
 *     returns the input list VERBATIM (no re-order, no drop). Never throws to
 *     the caller (SearchController). Logged at warn.
 *   - Only the top-K window is re-ordered; the tail (rank > window) is
 *     concatenated unchanged. Final list length == input length (rerank never
 *     drops results).
 *
 * Pure over inputs + the injected LLM surface, so tests inject fakes without
 * touching config or network (design.md §7).
 */

import { z } from "zod";
import { config, logger } from "@massa-ai/shared";
import type { SearchResult } from "@massa-ai/shared";
import type { QueryLlmSurface } from "./query-understanding.js";
import { llm as defaultLlmHandle } from "../memory/llm-client.js";

// ─── Zod schema ────────────────────────────────────────────────────────────────

/** The LLM returns an ordered id list. Non-empty array of strings. */
export const RerankVerdictSchema = z.object({
  rankedIds: z.array(z.string().min(1)).min(1),
});

export type RerankVerdict = z.infer<typeof RerankVerdictSchema>;

// ─── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_RERANK_WINDOW = 50;
/** Truncate each candidate's content in the prompt to bound prompt size. */
const CONTENT_TRUNCATE_CHARS = 500;

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * LLM-judge reranker. Stateless; the `llm` surface is injectable for tests.
 */
export class LLMJudgeReranker {
  constructor(private readonly llm: QueryLlmSurface = defaultLlmHandle) {}

  /**
   * Re-order the top-K (`window`) of `results` per the LLM verdict.
   *
   * - When `!isLlmEnabled()` OR the feature is off OR `window <= 0`, returns
   *   `results` verbatim.
   * - On `{ok:false}` or throw, returns `results` verbatim (logged at warn).
   * - Empty input → empty output (no-op).
   *
   * `window` defaults to `config.search.rerank.rerankWindow` (50). Callers may
   * pass an explicit value for tests / tighter budgets.
   */
  async rerank(
    query: string,
    results: SearchResult[],
    window?: number,
  ): Promise<SearchResult[]> {
    // Degradation: empty list or disabled → verbatim.
    if (results.length === 0) return results;

    const searchCfg = config.get("search");
    const rerankCfg = (searchCfg as { rerank?: { enabled?: boolean } }).rerank;
    if (!rerankCfg?.enabled) return results;

    if (!this.llm.isEnabled()) return results;

    const win = Math.max(
      1,
      window ?? rerankWindowFromConfig() ?? DEFAULT_RERANK_WINDOW,
    );

    // If window >= list, the whole list is the re-order scope.
    const k = Math.min(win, results.length);
    const head = results.slice(0, k);
    const tail = results.slice(k);

    const prompt = buildPrompt(query, head);

    let verdict: RerankVerdict | null;
    try {
      const res = await this.llm.object(prompt, RerankVerdictSchema, { modelRole: "code" });
      verdict = res.ok ? (res.value ?? null) : null;
    } catch (e) {
      logger.warn("LLMJudgeReranker threw — degrading to input order", {
        query,
        error: (e as Error).message,
      });
      return results;
    }

    if (!verdict) {
      logger.warn("LLMJudgeReranker got {ok:false} — degrading to input order", {
        query,
      });
      return results;
    }

    const reorderedHead = applyVerdict(head, verdict.rankedIds);
    return [...reorderedHead, ...tail];
  }
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function rerankWindowFromConfig(): number | undefined {
  const searchCfg = config.get("search") as {
    rerank?: { rerankWindow?: number };
  };
  const w = searchCfg.rerank?.rerankWindow;
  return typeof w === "number" && Number.isFinite(w) ? w : undefined;
}

/**
 * Build the judge prompt: the query + the top-K candidates
 * `{id, content (truncated), score}`. Asks for a strict re-order.
 */
function buildPrompt(query: string, head: SearchResult[]): string {
  const candidates = head
    .map((r, i) => {
      const content = (r.content ?? "").slice(0, CONTENT_TRUNCATE_CHARS);
      const score = typeof r.score === "number" ? r.score.toFixed(4) : "?";
      return `${i + 1}. id=${r.id} score=${score}\n${content}`;
    })
    .join("\n\n");

  return [
    "You are a retrieval reranker. Re-order the candidate code snippets by",
    "relevance to the user's query. Return ONLY a JSON object",
    '{"rankedIds": [string, ...]} listing the candidate ids best-first.',
    "Every candidate id must appear exactly once. Do not invent ids.",
    "",
    `Query: ${query}`,
    "",
    "Candidates:",
    candidates,
  ].join("\n");
}

/**
 * Apply the verdict permutation to the head:
 *   - ids in the verdict AND in head → placed in verdict order.
 *   - ids in the verdict but NOT in head → ignored.
 *   - duplicate ids in the verdict → first occurrence wins.
 *   - head ids missing from the verdict → appended in original order.
 * Result length == head.length (no drops, no additions).
 */
export function applyVerdict(head: SearchResult[], rankedIds: string[]): SearchResult[] {
  const byId = new Map<string, SearchResult>();
  for (const r of head) if (!byId.has(r.id)) byId.set(r.id, r);

  const out: SearchResult[] = [];
  const seen = new Set<string>();
  for (const id of rankedIds) {
    if (seen.has(id)) continue; // dedup: first occurrence wins
    const r = byId.get(id);
    if (!r) continue; // verdict id not in head → ignore
    out.push(r);
    seen.add(id);
  }
  // Append any head ids the verdict omitted, in original head order.
  for (const r of head) {
    if (!seen.has(r.id)) {
      out.push(r);
      seen.add(r.id);
    }
  }
  return out;
}
