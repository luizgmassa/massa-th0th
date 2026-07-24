import { describe, test, expect } from "bun:test";
import { computeTaskAlignment } from "../services/synapse/scoring/task-alignment.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

function r(content: string): SearchResult {
  return {
    id: content.slice(0, 12),
    content,
    score: 0.5,
    source: SearchSource.VECTOR,
    metadata: {},
  };
}

describe("computeTaskAlignment", () => {
  test("returns 0 when session has no task", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    const out = computeTaskAlignment(r("anything goes here"), session);
    expect(out).toBe(0);
  });

  test("high alignment when content overlaps task tokens", () => {
    const reg = new SessionRegistry();
    const session = reg.create({
      sessionId: "s1",
      agentId: "claude",
      taskContext: "debugging auth middleware timeout in production",
    });
    const result = r("auth middleware timeout configuration with retry logic");
    const out = computeTaskAlignment(result, session);
    expect(out).toBeGreaterThan(0.2);
  });

  test("low alignment when content is unrelated", () => {
    const reg = new SessionRegistry();
    const session = reg.create({
      sessionId: "s1",
      agentId: "claude",
      taskContext: "debugging auth middleware",
    });
    const result = r("database migration rollback strategy");
    const out = computeTaskAlignment(result, session);
    expect(out).toBeLessThan(0.15);
  });

  test("uses embedding cosine when both sides provide embeddings", () => {
    const reg = new SessionRegistry();
    const taskEmbed = [1, 0, 0, 0];
    const session = reg.create({
      sessionId: "s1",
      agentId: "claude",
      taskContext: "any text",
      taskEmbedding: taskEmbed,
    });
    const alignedResult = r("unrelated content tokens");
    const out = computeTaskAlignment(alignedResult, session, [1, 0, 0, 0]);
    expect(out).toBeCloseTo(1, 5); // cos=1 -> (1+1)/2 = 1
  });

  test("embedding cosine is 0.5 for orthogonal vectors", () => {
    const reg = new SessionRegistry();
    const session = reg.create({
      sessionId: "s1",
      agentId: "claude",
      taskContext: "x",
      taskEmbedding: [1, 0],
    });
    const out = computeTaskAlignment(r("anything"), session, [0, 1]);
    expect(out).toBeCloseTo(0.5, 5);
  });
});
