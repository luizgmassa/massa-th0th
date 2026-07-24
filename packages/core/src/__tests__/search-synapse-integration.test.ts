import { describe, expect, test } from "bun:test";
import { SearchSource, type SearchResult } from "@massa-ai/shared";
import { ContextualSearchRLM } from "../services/search/contextual-search-rlm.js";
import type { AgentSession } from "../services/synapse/types.js";

function result(id: string, projectId: string, score: number): SearchResult {
  return {
    id,
    content: `${id} content`,
    score,
    source: SearchSource.VECTOR,
    metadata: { projectId, filePath: `${id}.ts` },
  };
}

function session(workspaceId?: string): AgentSession {
  return {
    sessionId: "syn-search",
    agentId: "test-agent",
    workspaceId,
    createdAt: 1,
    expiresAt: Number.MAX_SAFE_INTEGER,
    accessHistory: new Map(),
    accessHistoryLimit: 100,
  };
}

function harness(resolvedSession: AgentSession | null) {
  const processCalls: Array<Record<string, unknown>> = [];
  const synapseManager = {
    process: (baseResults: SearchResult[], _query: string, options: object) => {
      processCalls.push(options as Record<string, unknown>);
      return {
        results: baseResults,
        flags: {
          lowConfidence: false,
          noStrongMatch: false,
          definitiveMatch: false,
          spread: 0,
          mean: 0,
          confidence: 0,
        },
        queryClass: "broad" as const,
        appliedFilters: [],
        intent: "general" as const,
      };
    },
  };
  const search = new ContextualSearchRLM({
    sessionRegistry: {
      getAsync: async () => resolvedSession,
    },
    synapseManager,
  });
  return { search, processCalls, synapseManager };
}

describe("ContextualSearchRLM — Synapse project-search contract", () => {
  test("missing sessionId returns the exact stateless results", async () => {
    const base = [result("base-a", "project-a", 0.8)];
    const { search, processCalls } = harness(session("project-a"));

    const actual = await (search as any).applySynapseState(
      base,
      "query",
      "project-a",
      undefined,
    );

    expect(actual).toBe(base);
    expect(processCalls).toHaveLength(0);
  });

  test("unknown or expired session returns the exact stateless results", async () => {
    const base = [result("base-a", "project-a", 0.8)];
    const { search, processCalls } = harness(null);

    const actual = await (search as any).applySynapseState(
      base,
      "query",
      "project-a",
      "missing-session",
    );

    expect(actual).toBe(base);
    expect(processCalls).toHaveLength(0);
  });

  test("workspace mismatch returns the exact stateless results", async () => {
    const base = [result("base-a", "project-a", 0.8)];
    const { search, processCalls } = harness(session("project-b"));

    const actual = await (search as any).applySynapseState(
      base,
      "query",
      "project-a",
      "mismatched-session",
    );

    expect(actual).toBe(base);
    expect(processCalls).toHaveLength(0);
  });

  test("matching workspace enables buffer injection and removes cross-project candidates", async () => {
    const base = [result("base-a", "project-a", 0.8)];
    const matchingSession = session("project-a");
    const { search, processCalls, synapseManager } = harness(matchingSession);
    synapseManager.process = (
      baseResults: SearchResult[],
      _query: string,
      options: Record<string, unknown>,
    ) => {
      processCalls.push(options);
      return {
        results: [
          result("injected-a", "project-a", 0.95),
          result("malicious-b", "project-b", 0.99),
          ...baseResults,
        ],
        flags: {},
        queryClass: "broad",
        appliedFilters: ["buffer-hit"],
        intent: "general",
      };
    };

    const actual = await (search as any).applySynapseState(
      base,
      "query",
      "project-a",
      "matching-session",
    );

    expect(actual.map((entry: SearchResult) => entry.id)).toEqual([
      "injected-a",
      "base-a",
    ]);
    expect(processCalls[0].session).toBe(matchingSession);
    expect(processCalls[0].projectId).toBe("project-a");
    expect(processCalls[0].allowBufferInjection).toBe(true);
  });

  test("valid unscoped session modulates base ranking without buffer injection", async () => {
    const base = [
      result("base-a", "project-a", 0.8),
      result("base-b", "project-a", 0.7),
    ];
    const unscopedSession = session();
    const { search, processCalls, synapseManager } = harness(unscopedSession);
    synapseManager.process = (
      baseResults: SearchResult[],
      _query: string,
      options: Record<string, unknown>,
    ) => {
      processCalls.push(options);
      return {
        results: [...baseResults].reverse(),
        flags: {},
        queryClass: "broad",
        appliedFilters: ["attention"],
        intent: "general",
      };
    };

    const actual = await (search as any).applySynapseState(
      base,
      "query",
      "project-a",
      "unscoped-session",
    );

    expect(actual.map((entry: SearchResult) => entry.id)).toEqual([
      "base-b",
      "base-a",
    ]);
    expect(processCalls[0].session).toBe(unscopedSession);
    expect(processCalls[0].allowBufferInjection).toBe(false);
  });
});
