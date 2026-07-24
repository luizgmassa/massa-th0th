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
import { config, logger, DEFAULT_LLM_MODEL } from "@massa-ai/shared";
import { z } from "zod";

/**
 * Which model role a call targets. `"instruct"` (default) selects the
 * NL/instruction model (`config.llm.model`); `"code"` selects the coder model
 * (`config.llm.codeModel`) for code-oriented sites (bootstrap, reranker,
 * compression). This is the per-task routing knob (COVERAGE #1/#5/#7).
 */
export type LlmModelRole = "instruct" | "code";

export interface LlmCompleteOptions {
  /** Optional system prompt. */
  system?: string;
  /** Per-call timeout override (ms). Defaults to `config.llm.timeoutMs`. */
  timeoutMs?: number;
  /** Model role: `"instruct"` (default) or `"code"`. */
  modelRole?: LlmModelRole;
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

// ── json_schema constrained decoding (W7-07) ─────────────────────────────

/**
 * Cached Ollama json_schema support flag. `null` = not yet checked.
 * Ollama >= 0.5.0 supports `format: { type: "json_schema", json_schema: {...} }`
 * for constrained decoding. Older versions only support `json_object`.
 */
let _jsonSchemaSupported: boolean | null = null;

/**
 * Check whether the configured Ollama instance supports `json_schema` format
 * (requires Ollama >= 0.5.0). Caches the result for the process lifetime.
 * On any error (Ollama down, unparseable version), returns `false` (safe
 * fallback to the current json_object path).
 * @internal
 */
export async function _checkJsonSchemaSupport(): Promise<boolean> {
  if (_jsonSchemaSupported !== null) return _jsonSchemaSupported;
  try {
    const llm = getLlmConfig();
    // Ollama's version endpoint is at /api/version (no /v1 prefix).
    const versionUrl = llm.baseUrl.replace(/\/v1\/?$/, "") + "/api/version";
    const res = await fetch(versionUrl, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) {
      _jsonSchemaSupported = false;
      logger.warn("json_schema: Ollama version check failed", { status: res.status });
      return false;
    }
    const body = (await res.json()) as { version?: string };
    const version = body.version ?? "";
    const match = version.match(/^(\d+)\.(\d+)\.(\d+)/);
    if (!match) {
      _jsonSchemaSupported = false;
      logger.warn("json_schema: could not parse Ollama version", { version });
      return false;
    }
    const major = parseInt(match[1], 10);
    const minor = parseInt(match[2], 10);
    const supported = major > 0 || (major === 0 && minor >= 5);
    _jsonSchemaSupported = supported;
    logger.info("json_schema: Ollama version detected", { version, supported });
    return supported;
  } catch (e) {
    _jsonSchemaSupported = false;
    logger.warn("json_schema: version check error — falling back to json_object", {
      error: (e as Error).message,
    });
    return false;
  }
}

/**
 * Test seam: force the json_schema support flag without hitting Ollama.
 * Pass `null` to clear the cache.
 * @internal
 */
export function _setJsonSchemaSupportedForTesting(flag: boolean | null): void {
  _jsonSchemaSupported = flag;
}

// ── end json_schema section ──────────────────────────────────────────────

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
 * with other test files that mock `@massa-ai/shared`). Pass `null` to clear.
 * @internal
 */
let testEnabledOverride: boolean | null = null;
export function _setLlmEnabledForTesting(flag: boolean | null): void {
  testEnabledOverride = flag;
}

/**
 * qwen3 (and other "thinking" models) emit their answer on the **reasoning**
 * channel; the content channel can come back empty (`text === ""`) when
 * thinking consumes the token budget, leaving `finishReason === "length"` (and
 * sometimes `"stop"` with empty content too). Without recovery every
 * structured/free-text LLM call silently degrades to the non-LLM path.
 *
 * Two mitigations live here:
 *   (1) `disableThink` (default on) asks Ollama to stop thinking by injecting a
 *       top-level `think:false` into the OpenAI-compat request body, and requests
 *       `response_format: json_object` for structured calls. Both are
 *       best-effort — they help on easy prompts but the model may still think.
 *   (2) reasoning-channel fallback: when `result.text` / `result.object` is
 *       empty/invalid, recover the answer from the reasoning channel the SDK
 *       exposes (`result.reasoning`). This is the load-bearing protection.
 *
 * Config: `RLM_LLM_DISABLE_THINK` (default `"1"`). When disabled, behavior
 * regresses to today's (content-only) path exactly.
 */

/** Read the llm config block with safe defaults (defensive against partial/missing config). */
function getLlmConfig(opts?: { modelRole?: LlmModelRole }) {
  const cfg = config.get("llm");
  const role = opts?.modelRole ?? "instruct";
  // Resolve the per-call model. Instruct → `model`, code → `codeModel`. The
  // instruct fallback uses the shared DEFAULT_LLM_MODEL constant (no bare literal).
  const model =
    role === "code"
      ? cfg?.codeModel ?? cfg?.model ?? DEFAULT_LLM_MODEL
      : cfg?.model ?? DEFAULT_LLM_MODEL;
  return {
    baseUrl: cfg?.baseUrl ?? "http://localhost:11434/v1",
    apiKey: cfg?.apiKey ?? "ollama",
    model,
    temperature: cfg?.temperature ?? 0.2,
    maxOutputTokens: cfg?.maxOutputTokens ?? 8000,
    timeoutMs: cfg?.timeoutMs ?? 90000,
    disableThink: cfg?.disableThink ?? true,
  };
}

/**
 * Best-effort `think:false` injection. Ollama's OpenAI-compat layer honors a
 * top-level `think` field for qwen3. Wrapped fetch keeps the SDK contract
 * intact and only mutates the JSON body for chat/completion POSTs.
 *
 * Typed loosely (input/init as unknown) and cast on return so it satisfies the
 * SDK's `FetchFunction` (Bun's fetch type includes a `preconnect` method that a
 * plain wrapper does not carry) without forcing callers to replicate it.
 * @internal
 */
export function _wrapFetchDisableThink(
  baseFetch: typeof globalThis.fetch,
): typeof globalThis.fetch {
  const wrapped = async (input: any, init?: any): Promise<Response> => {
    try {
      if (init?.body && typeof init.body === "string") {
        const parsed = JSON.parse(init.body);
        if (parsed && typeof parsed === "object" && !("think" in parsed)) {
          parsed.think = false;
          init = { ...init, body: JSON.stringify(parsed) };
        }
      }
    } catch {
      // Not JSON or unparseable — leave the request untouched.
    }
    return baseFetch(input as any, init as any);
  };
  return wrapped as unknown as typeof globalThis.fetch;
}

function buildProvider(llm: ReturnType<typeof getLlmConfig>) {
  // Ollama exposes an OpenAI-compatible API at /v1; createOpenAI over baseURL
  // is sufficient (no special compatibility flag in @ai-sdk/openai v3).
  const openai = createOpenAI({
    baseURL: llm.baseUrl,
    apiKey: llm.apiKey,
    ...(llm.disableThink ? { fetch: _wrapFetchDisableThink(globalThis.fetch) } : {}),
  });
  return openai(llm.model);
}

/**
 * Normalize the reasoning channel exposed by the AI SDK (v5+) into a single
 * string. Handles: array of `{type:"reasoning", text}` parts, a raw string,
 * `providerMetadata.openai.reasoningText`, and the Responses-API error shape
 * (`response.body.output[].summary[].text`). Returns "" when absent.
 *
 * Accepts either a successful `result` or a thrown `AI_NoObjectGeneratedError`
 * (which carries `response.body.output`).
 * @internal
 */
export function _reasoningToText(result: any): string {
  if (!result) return "";
  const rea = result.reasoning;
  if (Array.isArray(rea)) {
    return rea
      .map((x: any) => (x && typeof x.text === "string" ? x.text : ""))
      .join("\n")
      .trim();
  }
  if (typeof rea === "string") return rea.trim();
  const pm = result.providerMetadata?.openai;
  if (pm && typeof pm.reasoningText === "string") return pm.reasoningText.trim();
  // Responses-API shape (thrown AI_NoObjectGeneratedError carries this on
  // e.response.body.output): collect reasoning summaries + message content.
  const output = result?.response?.body?.output;
  if (Array.isArray(output)) {
    const parts: string[] = [];
    for (const part of output) {
      if (!part || typeof part !== "object") continue;
      if (part.type === "reasoning" && Array.isArray(part.summary)) {
        for (const s of part.summary) {
          if (s && typeof s.text === "string") parts.push(s.text);
        }
      } else if (part.type === "message" && Array.isArray(part.content)) {
        for (const s of part.content) {
          if (s && typeof s.text === "string") parts.push(s.text);
        }
      }
    }
    if (parts.length > 0) return parts.join("\n").trim();
  }
  return "";
}

/**
 * Best-effort extraction of the first balanced JSON object from a free-text
 * (typically reasoning) string. Strips ```json fences first. Returns the
 * parsed object or `undefined` on any failure. Pure; safe to unit-test.
 * @internal
 */
export function _extractJsonObject(text: string): unknown | undefined {
  if (!text) return undefined;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  if (start < 0) return undefined;
  let depth = 0;
  let inStr = false;
  let esc = false;
  let end = -1;
  for (let i = start; i < t.length; i++) {
    const c = t[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') {
      inStr = true;
    } else if (c === "{") {
      depth++;
    } else if (c === "}") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  if (end < 0) return undefined;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch {
    return undefined;
  }
}

function timeoutSignal(timeoutMs: number): AbortSignal {
  // AbortSignal.timeout is supported in Bun and Node >= 17.3.
  return AbortSignal.timeout(timeoutMs);
}

/**
 * Generate a free-form text completion. Returns `{ ok: false }` (never throws)
 * when the LLM is disabled, times out, or errors. When the content channel is
 * empty (qwen3 thinking-model failure mode), falls back to the reasoning
 * channel before degrading.
 */
export async function llmComplete(
  prompt: string,
  opts: LlmCompleteOptions = {},
): Promise<LlmResult<string>> {
  if (!isLlmEnabled()) {
    return { ok: false, error: "llm disabled" };
  }
  const llm = getLlmConfig({ modelRole: opts.modelRole });
  const timeoutMs = opts.timeoutMs ?? llm.timeoutMs;
  try {
    const result = await generateText({
      model: buildProvider(llm),
      prompt,
      system: opts.system,
      temperature: llm.temperature,
      maxOutputTokens: llm.maxOutputTokens,
      abortSignal: timeoutSignal(timeoutMs),
    });
    const text = (result as any).text ?? "";
    if (text.length > 0) return { ok: true, value: text };
    // Empty content — try to recover from the reasoning channel.
    if (llm.disableThink) {
      const reasoning = _reasoningToText(result);
      if (reasoning.length > 0) {
        logger.warn("llmComplete: empty content — recovered from reasoning channel", {
          reasoningLen: reasoning.length,
        });
        return { ok: true, value: reasoning };
      }
      // #7 safety net: reasoning recovery yielded nothing. With the pure-instruct
      // default this branch should be dormant (no reasoning channel); a hit here
      // signals an Ollama shape shift or an env override back to a thinking model.
      logger.warn("llm reasoning-recovery empty", {
        hasReasoning: false,
        finishReason: (result as any)?.finishReason ?? null,
      });
    }
    logger.warn("llmComplete: empty content and no reasoning — degrading", {});
    return { ok: false, error: "empty content (thinking model)" };
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
 * an invalid object, or errors. When the content channel is empty or the
 * schema fails (qwen3 thinking-model failure mode), attempts to recover JSON
 * from the reasoning channel before degrading.
 */
export async function llmObject<T>(
  prompt: string,
  schema: z.ZodSchema<T>,
  opts: LlmObjectOptions = {},
): Promise<LlmResult<T>> {
  if (!isLlmEnabled()) {
    return { ok: false, error: "llm disabled" };
  }
  const llm = getLlmConfig({ modelRole: opts.modelRole });
  const timeoutMs = opts.timeoutMs ?? llm.timeoutMs;
  let result: any = null;
  try {
    // json_schema constrained decoding (W7-07): when Ollama >= 0.5.0,
    // generateObject passes the Zod schema as json_schema to Ollama for
    // constrained decoding (the SDK maps responseFormat.type="json" + schema
    // to json_schema). When Ollama < 0.5.0 (or version check fails), fall
    // back to json_object (no schema) and validate manually afterward.
    const useJsonSchema = llm.disableThink && (await _checkJsonSchemaSupport());

    if (useJsonSchema) {
      // json_schema path: SDK sends format=json_schema with the compiled schema.
      // schemaName provides additional LLM guidance. No providerOptions needed.
      result = await generateObject({
        model: buildProvider(llm),
        prompt,
        system: opts.system,
        schema,
        schemaName: "response",
        temperature: llm.temperature,
        maxOutputTokens: llm.maxOutputTokens,
        abortSignal: timeoutSignal(timeoutMs),
      });
      logger.info("json_schema: constrained decoding used", {});
      return { ok: true, value: result.object };
    }

    // Fallback path (Ollama < 0.5.0 or disableThink off): use no-schema output
    // so the SDK sends json_object (no json_schema) to avoid version errors,
    // then validate the returned object against the Zod schema manually.
    result = await generateObject({
      model: buildProvider(llm),
      prompt,
      system: opts.system,
      output: "no-schema",
      temperature: llm.temperature,
      maxOutputTokens: llm.maxOutputTokens,
      abortSignal: timeoutSignal(timeoutMs),
    });
    const validated = schema.safeParse(result.object);
    if (validated.success) {
      logger.info("json_schema: fallback to json_object — validated", {});
      return { ok: true, value: validated.data };
    }
    // Manual validation failed — try reasoning-channel recovery before degrading.
    if (llm.disableThink) {
      const reasoning = _reasoningToText(result);
      if (reasoning.length > 0) {
        const parsed = _extractJsonObject(reasoning);
        if (parsed !== undefined) {
          const recovered = schema.safeParse(parsed);
          if (recovered.success) {
            logger.warn("llmObject: recovered object from reasoning channel (fallback path)", {
              reasoningLen: reasoning.length,
            });
            return { ok: true, value: recovered.data };
          }
        }
      }
    }
    logger.warn("llmObject: fallback validation failed", {
      zodError: validated.error.issues.map((i) => i.message).join("; "),
    });
    return { ok: false, error: "schema validation failed (fallback path)" };
  } catch (e) {
    // generateObject throws AI_NoObjectGeneratedError on schema mismatch / empty
    // parse — the thrown error carries the raw response (with reasoning). The
    // successful-but-empty case is covered by `result` above; here recover from
    // the error itself before degrading.
    if (llm.disableThink) {
      const reasoning =
        _reasoningToText(result).length > 0 ? _reasoningToText(result) : _reasoningToText(e);
      if (reasoning.length > 0) {
        const parsed = _extractJsonObject(reasoning);
        if (parsed !== undefined) {
          const validated = schema.safeParse(parsed);
          if (validated.success) {
            logger.warn("llmObject: recovered object from reasoning channel", {
              reasoningLen: reasoning.length,
            });
            return { ok: true, value: validated.data };
          }
        }
      }
      // #7 safety net: reasoning recovery yielded nothing. Dormant with the
      // pure-instruct default; a hit signals a shape shift / thinking-model override.
      logger.warn("llm reasoning-recovery empty", {
        hasReasoning: false,
        finishReason: (e as any)?.finishReason ?? null,
      });
    }
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
