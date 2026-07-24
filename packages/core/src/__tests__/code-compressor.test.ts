/**
 * Phase 7e — Characterization tests for CodeCompressor (regex path).
 *
 * Asserts ACTUAL current behavior of the structure-extraction compressor. The
 * LLM branch is added in Phase-7d; this file is EXTENDED there to cover both
 * paths. No shared-config mock.
 *
 * NOTE on language detection: the per-instance language cache is keyed by the
 * first 100 chars of the content. Across the full bun suite (one process),
 * unrelated test files can compress content that shares a leading prefix with
 * these fixtures, so strict per-language assertions are flaky in-suite. We
 * therefore assert the deterministic structural properties (the load-bearing
 * behavior) and treat language as "detected to a non-empty known string" for
 * the structural case, with one isolated detection spot-check.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { CompressionStrategy } from "@massa-ai/shared";
import { CodeCompressor, type CompressLlmComplete } from "../services/compression/code-compressor.js";
import { _setLlmEnabledForTesting } from "../services/memory/llm-client.js";
import type { LlmResult } from "../services/memory/llm-client.js";

describe("CodeCompressor — characterization (regex path)", () => {
  let compressor: CodeCompressor;

  beforeEach(() => {
    compressor = new CodeCompressor();
  });

  test("default strategy is CODE_STRUCTURE", () => {
    expect(compressor.getStrategy()).toBe(CompressionStrategy.CODE_STRUCTURE);
  });

  test("compress() extracts structure (imports/interfaces/classes/functions)", async () => {
    const code = [
      "import { foo } from 'bar';",
      "",
      "interface Iface { x: number; }",
      "",
      "export class Cls {",
      "  method() { return 1; }",
      "}",
      "",
      "export function fn() { return 2; }",
    ].join("\n");
    const result = await compressor.compress(code);
    expect(result.strategy).toBe(CompressionStrategy.CODE_STRUCTURE);
    // The compressed output is the structure skeleton. For tiny inputs the
    // skeleton can be LONGER than the original (headers + repeated signatures),
    // so we only assert it is a non-empty, finite string.
    expect(typeof result.compressed).toBe("string");
    expect(result.compressed.length).toBeGreaterThan(0);
    // language is detected (non-empty, from the known set)
    expect(typeof result.metadata.language).toBe("string");
    expect(result.metadata.language.length).toBeGreaterThan(0);
    // preserved elements carry the extracted signatures
    const preserved = result.metadata.preservedElements;
    expect(preserved.some((s) => s.includes("import"))).toBe(true);
    expect(preserved.some((s) => s.includes("interface"))).toBe(true);
    expect(preserved.some((s) => s.includes("class"))).toBe(true);
    // compressionRatio is NOT clamped to [0,1] — for tiny inputs where the
    // skeleton is longer, the ratio can be negative (characterization).
    expect(typeof result.compressionRatio).toBe("number");
    expect(Number.isFinite(result.compressionRatio)).toBe(true);
  });

  test("SEMANTIC_DEDUP removes duplicate lines", async () => {
    const code = "const a = 1;\nconst a = 1;\nconst b = 2;\n";
    const result = await compressor.compress(code, CompressionStrategy.SEMANTIC_DEDUP);
    expect(result.strategy).toBe(CompressionStrategy.SEMANTIC_DEDUP);
    // the duplicate `const a = 1;` line should appear once
    const occurrences = (result.compressed.match(/const a = 1;/g) || []).length;
    expect(occurrences).toBe(1);
  });

  test("decompress returns the original content", async () => {
    const code = "export const x = 42;\n";
    const compressed = await compressor.compress(code);
    const decompressed = await compressor.decompress(compressed);
    expect(decompressed).toBe(code);
  });

  test("estimateCompression returns a finite number (not clamped)", async () => {
    const code = [
      "import { a } from 'b';",
      "export function long() {",
      "  // many",
      "  // lines",
      "  // of body",
      "}",
    ].join("\n");
    const ratio = await compressor.estimateCompression(code);
    expect(typeof ratio).toBe("number");
    expect(Number.isFinite(ratio)).toBe(true);
  });

  test("null input propagates a TypeError (identity fallback itself throws)", async () => {
    // Characterization: compress() catches the inner error and calls
    // CompressedContent.identity(content), but identity() calls .length on the
    // content — so null surfaces a TypeError from inside the catch.
    expect(compressor.compress(null as unknown as string)).rejects.toThrow();
  });

  test("language detection recognizes a typescript file (isolated)", async () => {
    // Fresh instance + a distinctive prefix that won't collide with other
    // suite files → deterministic typescript detection.
    const fresh = new CodeCompressor();
    const ts = [
      "// unique-marker-tsp7e",
      "import { something } from 'y';",
      "interface Widget { value: number; }",
      "class Impl implements Widget { value = 1; }",
    ].join("\n");
    const result = await fresh.compress(ts);
    expect(result.metadata.language).toBe("typescript");
  });
});

// ─── Phase 7d: LLM branch ────────────────────────────────────────────────────

describe("CodeCompressor — 7d LLM branch", () => {
  beforeEach(() => {
    _setLlmEnabledForTesting(true);
  });

  afterEach(() => {
    _setLlmEnabledForTesting(null);
  });

  function fakeComplete(
    value: string | null,
    opts: { throws?: boolean } = {},
  ): CompressLlmComplete {
    return async () => {
      if (opts.throws) throw new Error("llm boom");
      if (value == null) return { ok: false, error: "disabled" } as LlmResult<string>;
      return { ok: true, value } as LlmResult<string>;
    };
  }

  test("LLM-on path uses the LLM output when valid + shorter (source=llm)", async () => {
    const original = [
      "import { a } from 'b';",
      "export function longBody() {",
      "  // comment one",
      "  // comment two",
      "  // comment three",
      "  return 42;",
      "}",
    ].join("\n");
    const llmOut = "import { a } from 'b';\nexport function longBody() { /* ... */ }";
    const compressor = new CodeCompressor(fakeComplete(llmOut));
    const result = await compressor.compress(original);
    expect(result.compressed).toBe(llmOut);
    expect(result.metadata.compressionSource).toBe("llm");
    expect(result.compressed.length).toBeLessThan(original.length);
  });

  test("LLM-off path uses the regex output (source=regex)", async () => {
    _setLlmEnabledForTesting(false);
    const original = "export function f() { return 1; }\n";
    // Even with a valid LLM return, LLM-off → regex path + source=regex.
    const compressor = new CodeCompressor(fakeComplete("SHOULD NOT BE USED"));
    const result = await compressor.compress(original);
    expect(result.metadata.compressionSource).toBe("regex");
    expect(result.compressed).not.toContain("SHOULD NOT BE USED");
  });

  test("LLM returns {ok:false} → regex fallback (source=regex)", async () => {
    const original = "export function f() { return 1; }\n";
    const compressor = new CodeCompressor(fakeComplete(null));
    const result = await compressor.compress(original);
    expect(result.metadata.compressionSource).toBe("regex");
  });

  test("LLM throws → regex fallback (source=regex)", async () => {
    const original = "export function f() { return 1; }\n";
    const compressor = new CodeCompressor(fakeComplete("x", { throws: true }));
    const result = await compressor.compress(original);
    expect(result.metadata.compressionSource).toBe("regex");
  });

  test("LLM returns output longer than original → regex fallback", async () => {
    const original = "export function f() { return 1; }\n";
    const tooLong = original + "\n".repeat(50) + "x".repeat(200);
    const compressor = new CodeCompressor(fakeComplete(tooLong));
    const result = await compressor.compress(original);
    // Over-long LLM output violates the target ratio → fallback to regex.
    expect(result.metadata.compressionSource).toBe("regex");
    expect(result.compressed).not.toBe(tooLong);
  });

  test("LLM returns empty → regex fallback", async () => {
    const original = "export function f() { return 1; }\n";
    const compressor = new CodeCompressor(fakeComplete("   "));
    const result = await compressor.compress(original);
    expect(result.metadata.compressionSource).toBe("regex");
  });

  // Discrimination sensor: if the {ok:false} guard were removed, source would
  // be "llm" or the compressed text would be the (absent) LLM value. This test
  // pins the guard as load-bearing.
  test("discrimination sensor — {ok:false} guard is load-bearing", async () => {
    const original = "export function f() { return 1; }\n";
    const compressor = new CodeCompressor(fakeComplete(null));
    const result = await compressor.compress(original);
    expect(result.metadata.compressionSource).toBe("regex");
  });
});
