/**
 * Task Alignment signal.
 *
 * Measures how relevant a candidate is to the *task* the agent is doing —
 * not just to the query string. The query asks "what?"; the task says "why?".
 * Two strategies:
 *   - Embedding cosine when both session and result carry embeddings (best).
 *   - Token-overlap Jaccard as a cheap fallback that works with what we have today.
 */

import type { SearchResult } from "@massa-ai/shared";
import type { AgentSession } from "../types.js";

const TOKEN_RE = /[a-z0-9_]{2,}/g;

function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    out.add(match[0]);
  }
  return out;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  const [smaller, larger] = a.size <= b.size ? [a, b] : [b, a];
  for (const t of smaller) if (larger.has(t)) intersection++;
  const union = a.size + b.size - intersection;
  return union === 0 ? 0 : intersection / union;
}

function cosineFloat(a: number[] | Float32Array, b: number[] | Float32Array): number {
  if (a.length !== b.length) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const av = a[i];
    const bv = b[i];
    dot += av * bv;
    na += av * av;
    nb += bv * bv;
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Compute a [0,1] alignment between a result and the session task.
 * Returns 0 when there is no taskContext.
 *
 * Optional `resultEmbedding` enables the embedding-cosine path; otherwise
 * the function falls back to token-overlap over `result.content`.
 */
export function computeTaskAlignment(
  result: SearchResult,
  session: AgentSession,
  resultEmbedding?: number[] | Float32Array,
): number {
  if (!session.taskContext) return 0;

  if (resultEmbedding && session.taskEmbedding) {
    const cos = cosineFloat(resultEmbedding, session.taskEmbedding);
    // Clamp into [0,1]; cosine on normalized embeddings is in [-1,1].
    return Math.max(0, Math.min(1, (cos + 1) / 2));
  }

  const tokens = session.taskTokens ?? tokenize(session.taskContext);
  const candTokens = tokenize(result.content || "");
  return jaccard(tokens, candTokens);
}
