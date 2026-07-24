/**
 * Agent Affinity signal.
 *
 * "I remember what I wrote and what I keep coming back to."
 *
 * The signal sums two parts:
 *   - authorship: 0.6 when this memory was created by the current agent.
 *   - usage:      up to 0.4 based on how often the agent has accessed it
 *                 within the current session.
 *
 * Result is clamped to [0, 1].
 */

import type { SearchResult } from "@massa-ai/shared";
import type { AgentSession } from "../types.js";

const USAGE_CAP = 10;
const AUTHORSHIP_WEIGHT = 0.6;
const USAGE_WEIGHT = 0.4;

function extractAuthorAgentId(result: SearchResult): string | null {
  const meta = result.metadata as Record<string, unknown> | undefined;
  if (!meta) return null;
  const direct = meta.agentId;
  if (typeof direct === "string") return direct;
  const context = meta.context as Record<string, unknown> | undefined;
  if (context && typeof context.agentId === "string") return context.agentId;
  return null;
}

export function computeAgentAffinity(
  result: SearchResult,
  session: AgentSession,
): number {
  let affinity = 0;

  const author = extractAuthorAgentId(result);
  if (author && author === session.agentId) {
    affinity += AUTHORSHIP_WEIGHT;
  }

  const accesses = session.accessHistory.get(result.id) ?? 0;
  if (accesses > 0) {
    affinity += USAGE_WEIGHT * Math.min(accesses / USAGE_CAP, 1);
  }

  return Math.min(1, affinity);
}
