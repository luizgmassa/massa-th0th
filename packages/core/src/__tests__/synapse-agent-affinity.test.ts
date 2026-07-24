import { describe, test, expect } from "bun:test";
import { computeAgentAffinity } from "../services/synapse/scoring/agent-affinity.js";
import { SessionRegistry } from "../services/synapse/session/session-registry.js";
import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

function r(id: string, agentId?: string): SearchResult {
  return {
    id,
    content: id,
    score: 0.5,
    source: SearchSource.VECTOR,
    metadata: agentId ? ({ agentId } as any) : {},
  };
}

describe("computeAgentAffinity", () => {
  test("returns 0 when no authorship and no usage history", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    expect(computeAgentAffinity(r("mem1"), session)).toBe(0);
  });

  test("authorship by same agent yields 0.6", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    expect(computeAgentAffinity(r("mem1", "claude"), session)).toBeCloseTo(0.6, 5);
  });

  test("authorship by different agent yields 0", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    expect(computeAgentAffinity(r("mem1", "cursor"), session)).toBe(0);
  });

  test("usage adds up to 0.4 with cap at 10 accesses", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    // simulate 5 accesses
    for (let i = 0; i < 5; i++) reg.recordAccess("s1", "mem1");
    const refreshed = reg.get("s1")!;
    expect(computeAgentAffinity(r("mem1"), refreshed)).toBeCloseTo(0.2, 5); // 0.4 * 0.5
  });

  test("authorship + heavy usage saturates at 1.0", () => {
    const reg = new SessionRegistry();
    const session = reg.create({ sessionId: "s1", agentId: "claude" });
    for (let i = 0; i < 15; i++) reg.recordAccess("s1", "mem1");
    const refreshed = reg.get("s1")!;
    const out = computeAgentAffinity(r("mem1", "claude"), refreshed);
    expect(out).toBeCloseTo(1.0, 5);
  });
});
