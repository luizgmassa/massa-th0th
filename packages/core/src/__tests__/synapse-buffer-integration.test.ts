import { describe, test, expect } from "bun:test";
import { SynapseManager } from "../services/synapse/synapse-manager.js";
import {
  SessionRegistry,
  resetSessionRegistry,
} from "../services/synapse/session/session-registry.js";
import { DEFAULT_BUFFER_CONFIG } from "../services/synapse/buffer/working-memory-buffer.js";
import type { SynapseRuntimeConfig, SearchResult } from "@massa-th0th/shared";
import { SearchSource } from "@massa-th0th/shared";

// Patch the global session registry singleton for these tests by injecting
// our own instance through the module's getSessionRegistry pathway.
import * as session from "../services/synapse/session/session-registry.js";

const ORIGINAL_GET = session.getSessionRegistry;
let registry: SessionRegistry;

function r(id: string, content: string, score: number): SearchResult {
  return {
    id,
    content,
    score,
    source: SearchSource.VECTOR,
    metadata: {},
  };
}

function makeConfig(): SynapseRuntimeConfig {
  return {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: false, threshold: 0.85, lambda: 0.4 },
      temporalInhibition: { enabled: false, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: {
        enabled: false,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
      chainInhibition: { enabled: false },
    },
    scoring: {
      attention: {
        enabled: false,
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: {
          semantic: 0.25,
          recency: 0.15,
          accessHeat: 0.15,
          taskAlign: 0.2,
          agentAffinity: 0.1,
          confidence: 0.15,
        },
      },
    },
    metacognition: {
      enabled: false,
      lowConfidenceThreshold: 0.1,
      definitiveTopScore: 0.8,
      definitiveGap: 0.4,
    },
    buffer: {
      enabled: true,
      maxSize: 20,
      ttlMs: 900_000,
      hitBoost: 1.3,
      matchThreshold: 0.3,
    },
  };
}

describe("SynapseManager + WorkingMemoryBuffer", () => {
  test("subsequent query merges buffer hits with fresh results", () => {
    resetSessionRegistry();
    registry = ORIGINAL_GET();
    registry.create({
      sessionId: "s1",
      agentId: "claude",
      bufferConfig: { ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.3 },
    });
    const mgr = new SynapseManager(makeConfig());

    // First query: results land in the buffer.
    const r1 = [
      r("a", "auth middleware setup", 0.7),
      r("b", "auth middleware tests", 0.5),
    ];
    const out1 = mgr.process(r1, "auth middleware", { sessionId: "s1" });
    expect(out1.appliedFilters).toContain("buffer-put");

    // Second query overlaps but the search returns a different set; the buffer
    // should still surface "a" and "b" with the hit boost applied.
    const r2 = [r("c", "session storage flow", 0.6)];
    const out2 = mgr.process(r2, "auth middleware timeout", { sessionId: "s1" });
    expect(out2.appliedFilters).toContain("buffer-hit");
    const ids = out2.results.map((x) => x.id);
    expect(ids).toContain("a");
    expect(ids).toContain("b");
    expect(ids).toContain("c");
  });

  test("buffer is bypassed when no session is provided", () => {
    const mgr = new SynapseManager(makeConfig());
    const r1 = [r("a", "x", 0.5)];
    const out = mgr.process(r1, "anything", {});
    expect(out.appliedFilters).not.toContain("buffer-hit");
    expect(out.appliedFilters).not.toContain("buffer-put");
  });

  test("primed entries surface when their content matches the query (IMP-9)", () => {
    resetSessionRegistry();
    registry = ORIGINAL_GET();
    const session = registry.create({
      sessionId: "s2",
      agentId: "claude",
      bufferConfig: { ...DEFAULT_BUFFER_CONFIG, matchThreshold: 0.3 },
    });
    // Primed content shares tokens with the upcoming query.
    session.buffer!.prime([r("primed", "auth middleware token decision", 0.9)]);

    const mgr = new SynapseManager(makeConfig());
    const out = mgr.process(
      [r("fresh", "totally unrelated topic", 0.6)],
      "auth middleware behavior",
      { sessionId: "s2" },
    );
    const ids = out.results.map((x) => x.id);
    expect(ids).toContain("primed");
    expect(ids).toContain("fresh");
  });
});
