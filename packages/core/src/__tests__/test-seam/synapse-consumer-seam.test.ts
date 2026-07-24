/**
 * Synapse consumer seam test (Wave 6 N21, T26)
 *
 * Feeds the frozen search-response fixture to the Synapse WorkingMemoryBuffer
 * and asserts consumption is correct. Mutates the fixture shape → test fails
 * (drift detection).
 *
 * The test-seam pattern: frozen real responses feed the consumer. If the
 * response shape drifts (SearchResult schema changes), the test fails —
 * forcing an intentional fixture update, not a silent break.
 */

import { describe, test, expect } from "bun:test";
import {
  WorkingMemoryBuffer,
  DEFAULT_BUFFER_CONFIG,
} from "../../services/synapse/buffer/working-memory-buffer.js";
import type { SearchResult } from "@massa-ai/shared";
import searchResponseFixture from "./fixtures/search-response.json" with { type: "json" };

/** Extract SearchResult[] from the frozen search response fixture. */
function extractResults(fixture: typeof searchResponseFixture): SearchResult[] {
  const data = (fixture as any).data;
  if (!data || !Array.isArray(data.results)) {
    throw new Error("Fixture shape drift: data.results is not an array");
  }
  return data.results as SearchResult[];
}

describe("Synapse consumer seam (T26)", () => {
  test("frozen search response → buffer.prime() consumes results correctly", () => {
    const results = extractResults(searchResponseFixture);
    expect(results.length).toBe(3);

    const buffer = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      maxSize: 20,
      ttlMs: 60000,
      hitBoost: 1.3,
      matchThreshold: 0.3,
    });

    // Prime the buffer with the frozen results
    buffer.prime(results);

    // Buffer should have all 3 entries
    expect(buffer.size()).toBe(3);

    // Each entry should be present
    expect(buffer.has("chunk-001-deterministic")).toBe(true);
    expect(buffer.has("chunk-002-deterministic")).toBe(true);
    expect(buffer.has("chunk-003-deterministic")).toBe(true);
  });

  test("frozen search response → buffer.get() returns matching results for related query", () => {
    const results = extractResults(searchResponseFixture);

    const buffer = new WorkingMemoryBuffer({
      ...DEFAULT_BUFFER_CONFIG,
      maxSize: 20,
      ttlMs: 60000,
      hitBoost: 1.3,
      matchThreshold: 0.05, // low threshold to ensure content-token Jaccard matches
    });

    buffer.prime(results);

    // Query with overlapping tokens to the primed content
    const hot = buffer.get("search project tool implementation");
    // Primed entries match via content tokens (Jaccard), so we expect hits
    expect(hot.results.length).toBeGreaterThan(0);
    expect(hot.appliedBoost).toBe(true);
  });

  test("mutate search response: remove results array → extractResults throws (drift detection)", () => {
    const mutated = JSON.parse(JSON.stringify(searchResponseFixture));
    delete (mutated as any).data.results;

    expect(() => extractResults(mutated)).toThrow("Fixture shape drift");
  });

  test("mutate search response: empty results array → buffer.prime() with 0 entries", () => {
    const mutated = JSON.parse(JSON.stringify(searchResponseFixture));
    (mutated as any).data.results = [];

    const results = extractResults(mutated);
    expect(results.length).toBe(0);

    const buffer = new WorkingMemoryBuffer(DEFAULT_BUFFER_CONFIG);
    buffer.prime(results);

    expect(buffer.size()).toBe(0);
  });

  test("frozen search response results have required SearchResult fields", () => {
    const results = extractResults(searchResponseFixture);

    for (const result of results) {
      expect(typeof result.id).toBe("string");
      expect(result.id.length).toBeGreaterThan(0);
      expect(typeof result.content).toBe("string");
      expect(typeof result.score).toBe("number");
      expect(result.source).toBeDefined();
      expect(typeof result.metadata).toBe("object");
    }
  });

  test("frozen search response results have deterministic IDs (no random/UUID)", () => {
    const results = extractResults(searchResponseFixture);

    for (const result of results) {
      // Deterministic IDs should not contain UUID-like patterns
      expect(result.id).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
      // Should end with "-deterministic"
      expect(result.id).toContain("deterministic");
    }
  });
});