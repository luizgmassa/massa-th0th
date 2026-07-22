/**
 * Unit tests for json_schema constrained decoding (W7-07, T11).
 *
 * Tests derive from spec ACs:
 *   1. When Ollama supports json_schema, llmObject passes schemaName (SDK
 *      maps to format=json_schema with the compiled schema).
 *   2. When Ollama does NOT support json_schema, llmObject falls back to
 *      no-schema output (json_object) and validates manually (graceful
 *      degradation).
 *   3. When json_schema path is used, response is valid JSON matching schema.
 *   4. Observability: logs when json_schema is used vs fallback (F3).
 *   5. Graceful degradation on schema compilation error.
 *
 * Isolation: mocks `ai` and `@ai-sdk/openai` (network layer). Uses
 * `_setJsonSchemaSupportedForTesting` to control the version-gate without
 * hitting Ollama.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";

let lastCall: any = null;
let generateObjectShouldThrow: string | null = null;
let generateObjectReturn: any = null;

mock.module("ai", () => ({
  generateText: async () => ({ text: "mocked" }),
  generateObject: async (opts: any) => {
    lastCall = opts;
    if (generateObjectShouldThrow) throw new Error(generateObjectShouldThrow);
    return generateObjectReturn ?? { object: { summary: "mocked", type: "pattern", level: 1, rationale: "because", sourceIds: ["a"] } };
  },
}));

mock.module("@ai-sdk/openai", () => ({
  createOpenAI: () => (model: string) => ({ model, __mock: true }),
}));

import {
  llmObject,
  _setLlmEnabledForTesting,
  _setJsonSchemaSupportedForTesting,
  _checkJsonSchemaSupport,
} from "../services/memory/llm-client.js";
import { z } from "zod";

const sampleSchema = z.object({
  summary: z.string(),
  type: z.enum(["decision", "pattern", "code", "conversation", "critical"]),
  level: z.number(),
  rationale: z.string(),
  sourceIds: z.array(z.string()),
});

beforeEach(() => {
  _setLlmEnabledForTesting(true);
  _setJsonSchemaSupportedForTesting(null);
  lastCall = null;
  generateObjectShouldThrow = null;
  generateObjectReturn = null;
});

describe("json_schema constrained decoding (W7-07)", () => {
  test("json_schema supported: passes schemaName, uses default output (schema path)", async () => {
    _setJsonSchemaSupportedForTesting(true);
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(true);
    expect(lastCall.schemaName).toBe("response");
    expect(lastCall.output).toBeUndefined();
    expect(lastCall.schema).toBeDefined();
  });

  test("json_schema unsupported: uses no-schema output (json_object fallback)", async () => {
    _setJsonSchemaSupportedForTesting(false);
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(true);
    expect(lastCall.output).toBe("no-schema");
    expect(lastCall.schemaName).toBeUndefined();
  });

  test("json_schema unsupported: validates returned object against schema manually", async () => {
    _setJsonSchemaSupportedForTesting(false);
    generateObjectReturn = { object: { summary: "test", type: "code", level: 3, rationale: "r", sourceIds: ["x", "y"] } };
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(true);
    expect(res.value?.summary).toBe("test");
    expect(res.value?.type).toBe("code");
    expect(res.value?.level).toBe(3);
  });

  test("json_schema unsupported: returns {ok:false} when returned object fails schema validation", async () => {
    _setJsonSchemaSupportedForTesting(false);
    generateObjectReturn = { object: { summary: "test", type: "invalid_type", level: 1 } };
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/schema validation failed/);
  });

  test("graceful degradation: generateObject throw returns {ok:false}", async () => {
    _setJsonSchemaSupportedForTesting(true);
    generateObjectShouldThrow = "AI_NoObjectGeneratedError: schema mismatch";
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/schema mismatch/);
  });

  test("json_schema unsupported + generateObject throw: reasoning recovery still applies", async () => {
    _setJsonSchemaSupportedForTesting(false);
    generateObjectShouldThrow = "parse error";
    const res = await llmObject("test prompt", sampleSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/parse error/);
  });

  test("default (version not checked): falls back to no-schema when version check fails", async () => {
    // _jsonSchemaSupported is null → _checkJsonSchemaSupport will try fetch.
    // Mock fetch to simulate an unreachable Ollama (connection refused).
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () => { throw new Error("connection refused"); };
    try {
      const res = await llmObject("test prompt", sampleSchema);
      expect(res.ok).toBe(true);
      expect(lastCall.output).toBe("no-schema");
    } finally {
      globalThis.fetch = origFetch;
      _setJsonSchemaSupportedForTesting(null);
    }
  });
});

describe("json_schema version parser (discrimination)", () => {
  // These tests call _checkJsonSchemaSupport directly, exercising the
  // version parser (not the _setJsonSchemaSupportedForTesting bypass).
  // This kills the mutant where `minor >= 5` is changed to `minor >= 99`.

  afterEach(() => {
    globalThis.fetch = globalThis.fetch; // restore handled by individual tests
    _setJsonSchemaSupportedForTesting(false); // prevent outer beforeEach from triggering real fetch
  });

  test("Ollama 0.5.0 → json_schema supported (boundary: exactly 0.5)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ version: "0.5.0" }), { status: 200 });
    _setJsonSchemaSupportedForTesting(null);
    try {
      const supported = await _checkJsonSchemaSupport();
      expect(supported).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("Ollama 0.4.9 → json_schema NOT supported (just below 0.5)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ version: "0.4.9" }), { status: 200 });
    _setJsonSchemaSupportedForTesting(null);
    try {
      const supported = await _checkJsonSchemaSupport();
      expect(supported).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("Ollama 1.0.0 → json_schema supported (major >= 1)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ version: "1.0.0" }), { status: 200 });
    _setJsonSchemaSupportedForTesting(null);
    try {
      const supported = await _checkJsonSchemaSupport();
      expect(supported).toBe(true);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("Ollama 0.3.0 → json_schema NOT supported (old version)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ version: "0.3.0" }), { status: 200 });
    _setJsonSchemaSupportedForTesting(null);
    try {
      const supported = await _checkJsonSchemaSupport();
      expect(supported).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  test("unparseable version → NOT supported (safe fallback)", async () => {
    const origFetch = globalThis.fetch;
    (globalThis as any).fetch = async () =>
      new Response(JSON.stringify({ version: "unknown" }), { status: 200 });
    _setJsonSchemaSupportedForTesting(null);
    try {
      const supported = await _checkJsonSchemaSupport();
      expect(supported).toBe(false);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});