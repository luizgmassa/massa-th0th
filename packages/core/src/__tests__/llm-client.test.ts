/**
 * Unit tests for the shared LLM client (Phase 1, P1-LLMCLIENT).
 *
 * Asserts the three contract guarantees:
 *   (a) respects timeoutMs / disabled gate,
 *   (b) degrades silently ({ ok:false }) on failure — never throws,
 *   (c) default-off.
 *
 * Isolation: this file deliberately does NOT `mock.module("@massa-th0th/shared")`.
 * bun's mock.module is process-wide, and another test file (memory-crud.test.ts)
 * already mocks shared config for dataDir isolation; a second mock here would
 * collide (last-writer-wins) and break one of the two files. Instead the
 * enabled-flag is toggled via the `_setLlmEnabledForTesting` seam, and only
 * `ai` / `@ai-sdk/openai` (the network layer) are mocked.
 */

import { describe, test, expect, beforeEach, mock } from "bun:test";

let generateShouldThrow: string | null = null;
let generateObjectShouldThrow: string | null = null;
let lastCall: any = null;

mock.module("ai", () => ({
  generateText: async (opts: any) => {
    lastCall = opts;
    if (generateShouldThrow) throw new Error(generateShouldThrow);
    return { text: "mocked completion" };
  },
  generateObject: async (opts: any) => {
    lastCall = opts;
    if (generateObjectShouldThrow) throw new Error(generateObjectShouldThrow);
    return { object: { summary: "mocked summary", type: "pattern", level: 2, rationale: "because", sourceIds: ["a", "b"] } };
  },
}));

mock.module("@ai-sdk/openai", () => ({
  createOpenAI: (_opts: any) => (model: string) => ({ model, __mock: true }),
}));

import {
  llmComplete,
  llmObject,
  isLlmEnabled,
  _setLlmEnabledForTesting,
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
  _setLlmEnabledForTesting(false);
  generateShouldThrow = null;
  generateObjectShouldThrow = null;
  lastCall = null;
});

describe("llm-client — default-off gate (P1-LLMCLIENT-03)", () => {
  test("disabled by default: isLlmEnabled() is false", () => {
    expect(isLlmEnabled()).toBe(false);
  });

  test("llmComplete returns {ok:false} without contacting the provider when disabled", async () => {
    const res = await llmComplete("hello");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/disabled/);
    expect(lastCall).toBeNull(); // provider never invoked
  });

  test("llmObject returns {ok:false} without contacting the provider when disabled", async () => {
    const res = await llmObject("hello", sampleSchema);
    expect(res.ok).toBe(false);
    expect(lastCall).toBeNull();
  });
});

describe("llm-client — silent degradation (P1-LLMCLIENT-04)", () => {
  beforeEach(() => { _setLlmEnabledForTesting(true); });

  test("llmComplete swallows a throw and returns {ok:false} (no throw to caller)", async () => {
    generateShouldThrow = "connection refused";
    const res = await llmComplete("hello");
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/connection refused/);
  });

  test("llmObject swallows a throw and returns {ok:false} (no throw to caller)", async () => {
    generateObjectShouldThrow = "timeout";
    const res = await llmObject("hello", sampleSchema);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/timeout/);
  });

  test("a zod-invalid LLM response is treated as failure (degrade path)", async () => {
    generateObjectShouldThrow = "Response did not match schema";
    const res = await llmObject("hello", sampleSchema);
    expect(res.ok).toBe(false);
  });
});

describe("llm-client — success path (P1-LLMCLIENT-02)", () => {
  beforeEach(() => { _setLlmEnabledForTesting(true); });

  test("llmComplete returns {ok:true, value} when the provider succeeds", async () => {
    const res = await llmComplete("hello");
    expect(res.ok).toBe(true);
    expect(res.value).toBe("mocked completion");
  });

  test("llmObject returns {ok:true, value} parsed against the schema", async () => {
    const res = await llmObject("hello", sampleSchema);
    expect(res.ok).toBe(true);
    expect(res.value?.summary).toBe("mocked summary");
    expect(res.value?.type).toBe("pattern");
  });

  test("abortSignal is forwarded (timeoutMs respected)", async () => {
    await llmComplete("hello", { timeoutMs: 1234 });
    expect(lastCall.abortSignal).toBeDefined();
  });
});
