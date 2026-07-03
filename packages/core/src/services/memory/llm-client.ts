/**
 * Shared local-first LLM client (Phase 1, cross-cutting §1).
 *
 * Wraps the Vercel AI SDK (`generateText` / `generateObject`) over an
 * OpenAI-compatible provider configured from the top-level `config.llm` block.
 * Default backend is a local Ollama instance (http://localhost:11434/v1).
 *
 * Contract (cross-cutting §1):
 *   (a) respect `timeoutMs` (via AbortSignal.timeout),
 *   (b) degrade silently to a non-LLM path on any failure — never throw,
 *   (c) be config-gated default-off (`config.llm.enabled`, env RLM_LLM_ENABLED).
 *
 * Consumers (Phase 1: consolidator; Phase 2: query-understanding; Phase 4:
 * bootstrap; Phase 5: auto-improve; Phase 7: compression) MUST treat a
 * `{ ok: false }` result as "fall through to the non-LLM path".
 */

import { generateText, generateObject } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { config, logger } from "@massa-th0th/shared";
import type { z } from "zod";

export interface LlmCompleteOptions {
  /** Optional system prompt. */
  system?: string;
  /** Per-call timeout override (ms). Defaults to `config.llm.timeoutMs`. */
  timeoutMs?: number;
}

export interface LlmObjectOptions extends LlmCompleteOptions {
  // schema is a required positional arg of llmObject; no extra opts yet.
}

export interface LlmResult<T = string> {
  ok: boolean;
  value?: T;
  /** Present when ok === false. */
  error?: string;
}

/** Whether the LLM is enabled at the current config. Cheap, side-effect-free. */
export function isLlmEnabled(): boolean {
  if (testEnabledOverride !== null) return testEnabledOverride;
  try {
    return config.get("llm").enabled === true;
  } catch {
    return false;
  }
}

/**
 * Test seam: force the enabled flag without touching config (avoids colliding
 * with other test files that mock `@massa-th0th/shared`). Pass `null` to clear.
 * @internal
 */
let testEnabledOverride: boolean | null = null;
export function _setLlmEnabledForTesting(flag: boolean | null): void {
  testEnabledOverride = flag;
}

/** Read the llm config block with safe defaults (defensive against partial/missing config). */
function getLlmConfig() {
  const cfg = config.get("llm");
  return {
    baseUrl: cfg?.baseUrl ?? "http://localhost:11434/v1",
    apiKey: cfg?.apiKey ?? "ollama",
    model: cfg?.model ?? "qwen2.5-coder:7b",
    temperature: cfg?.temperature ?? 0.2,
    maxOutputTokens: cfg?.maxOutputTokens ?? 2000,
    timeoutMs: cfg?.timeoutMs ?? 30000,
  };
}

function buildProvider() {
  const llm = getLlmConfig();
  // Ollama exposes an OpenAI-compatible API at /v1; createOpenAI over baseURL
  // is sufficient (no special compatibility flag in @ai-sdk/openai v3).
  const openai = createOpenAI({
    baseURL: llm.baseUrl,
    apiKey: llm.apiKey,
  });
  return openai(llm.model);
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  // AbortSignal.timeout is supported in Bun and Node >= 17.3.
  return AbortSignal.timeout(timeoutMs);
}

/**
 * Generate a free-form text completion. Returns `{ ok: false }` (never throws)
 * when the LLM is disabled, times out, or errors.
 */
export async function llmComplete(
  prompt: string,
  opts: LlmCompleteOptions = {},
): Promise<LlmResult<string>> {
  if (!isLlmEnabled()) {
    return { ok: false, error: "llm disabled" };
  }
  const llm = getLlmConfig();
  const timeoutMs = opts.timeoutMs ?? llm.timeoutMs;
  try {
    const result = await generateText({
      model: buildProvider(),
      prompt,
      system: opts.system,
      temperature: llm.temperature,
      maxOutputTokens: llm.maxOutputTokens,
      abortSignal: timeoutSignal(timeoutMs),
    });
    return { ok: true, value: result.text };
  } catch (e) {
    logger.warn("llmComplete failed — degrading to non-LLM path", {
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Generate a structured object validated against a zod schema. Returns
 * `{ ok: false }` (never throws) when the LLM is disabled, times out, returns
 * an invalid object, or errors.
 */
export async function llmObject<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts: LlmObjectOptions = {},
): Promise<LlmResult<T>> {
  if (!isLlmEnabled()) {
    return { ok: false, error: "llm disabled" };
  }
  const llm = getLlmConfig();
  const timeoutMs = opts.timeoutMs ?? llm.timeoutMs;
  try {
    const result = await generateObject({
      model: buildProvider(),
      prompt,
      system: opts.system,
      schema,
      temperature: llm.temperature,
      maxOutputTokens: llm.maxOutputTokens,
      abortSignal: timeoutSignal(timeoutMs),
    });
    return { ok: true, value: result.object };
  } catch (e) {
    logger.warn("llmObject failed — degrading to non-LLM path", {
      error: (e as Error).message,
    });
    return { ok: false, error: (e as Error).message };
  }
}

/**
 * Injectable handle bundling both calls, so callers (consolidator, etc.) can
 * be tested with a fake LLM without touching config or network.
 */
export const llm = {
  complete: llmComplete,
  object: llmObject,
  isEnabled: isLlmEnabled,
};
