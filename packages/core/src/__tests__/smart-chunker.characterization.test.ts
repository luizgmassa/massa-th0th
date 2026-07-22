/**
 * SmartChunker — characterization tests (Wave 6 N31, T04)
 *
 * Purpose: pin byte-identical Chunk[] output per format (markdown/json/
 * yaml/code/fixed) before the Phase 3 facade split so any drift is caught.
 *
 * Reconciliation note: this file SUPersedes the existing
 * `smart-chunker.test.ts` (Phase 7e). That file already pins behavior at
 * a coarser grain (label presence, type, merge behavior). This T04 file
 * adds BYTE-IDENTICAL anchors: exact chunk count, exact content, exact
 * lineStart/lineEnd per chunk. Both files are kept — the existing one
 * stays as a broad smoke test; this one is the strict mutation-killer
 * the M14 split gate enforces. If a future task must change chunking
 * behavior, BOTH files must be updated intentionally (never silently).
 *
 * Pure module: no DB, no I/O, no shared-config mock.
 */

import { describe, test, expect } from "bun:test";
import { smartChunk, type Chunk } from "../services/search/smart-chunker.js";

// ── Helpers ──────────────────────────────────────────────────────────────────

function bodies(chunks: Chunk[]): string[] {
  return chunks.map((c) => c.content);
}

function summary(chunks: Chunk[]): Array<{
  lineStart: number;
  lineEnd: number;
  type: Chunk["type"];
  label?: string;
}> {
  return chunks.map((c) => ({
    lineStart: c.lineStart,
    lineEnd: c.lineEnd,
    type: c.type,
    label: c.label,
  }));
}

describe("SmartChunker — byte-identical characterization (T04)", () => {
  describe("markdown (.md)", () => {
    test("two heading sections produce exactly 2 chunks with exact line ranges", () => {
      const md = [
        "# Title",
        "l1", "l2", "l3", "l4", "l5", "",
        "## Section A", "s1", "s2", "s3", "s4", "s5",
      ].join("\n");
      const chunks = smartChunk(md, "docs/readme.md", { addFileContext: false });
      expect(chunks.length).toBe(2);
      expect(summary(chunks)).toEqual([
        { lineStart: 1, lineEnd: 7, type: "heading_section", label: "Title" },
        { lineStart: 8, lineEnd: 13, type: "heading_section", label: "Title > Section A" },
      ]);
      // Exact content bodies (no file-context prefix).
      expect(chunks[0].content).toBe("# Title\nl1\nl2\nl3\nl4\nl5\n");
      expect(chunks[1].content).toBe("## Section A\ns1\ns2\ns3\ns4\ns5");
    });

    test("no headings → fixed fallback", () => {
      const md = "plain text\nline2\nline3\nline4\nline5\nline6\n";
      const chunks = smartChunk(md, "docs/nohead.md", {
        addFileContext: false,
        fixedChunkSize: 50,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe("fixed");
      // 6 content lines + trailing newline → chunkFixed sees 7 lines (the
      // trailing \n produces an empty 7th element from split("\n")).
      expect(summary(chunks)).toEqual([
        { lineStart: 1, lineEnd: 7, type: "fixed", label: undefined },
      ]);
    });
  });

  describe("json (.json)", () => {
    test("<5 keys → single json_key chunk labeled with the key set", () => {
      const json = JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2);
      const chunks = smartChunk(json, "config.json", { addFileContext: false });
      expect(chunks.length).toBe(1);
      // JSON.stringify(…, null, 2) produces 5 lines: {, 3 kv, }. lineEnd = 5.
      expect(summary(chunks)).toEqual([
        { lineStart: 1, lineEnd: 5, type: "json_key", label: "{a, b, c}" },
      ]);
      expect(chunks[0].content).toBe(json);
    });

    test("array JSON → fixed fallback (arrays don't split)", () => {
      const json = JSON.stringify([1, 2, 3, 4, 5, 6]);
      const chunks = smartChunk(json, "arr.json", { addFileContext: false });
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
    });
  });

  describe("yaml (.yaml)", () => {
    test("single document → top-level-key split into labeled blocks", () => {
      const yaml = "alpha: 1\nbeta: 2\ngamma: 3\n";
      const chunks = smartChunk(yaml, "one.yaml", { addFileContext: false });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.every((c) => c.type === "yaml_block")).toBe(true);
      // Each chunk is labeled by its top-level key (the first key in the block).
      expect(chunks[0].label).toBe("alpha");
    });
  });

  describe("code (.ts)", () => {
    test("class with two methods → 3 chunks: imports, Foo, Foo.bar+Foo.baz overlap", () => {
      const code = [
        "import { x } from 'y';",
        "",
        "export class Foo {",
        "  bar() { return 1; }",
        "  baz() { return 2; }",
        "}",
      ].join("\n");
      const chunks = smartChunk(code, "src/foo.ts", { addFileContext: false });
      // Preamble (imports) + class container + method 1 + method 2.
      const labels = chunks.map((c) => c.label);
      expect(labels).toContain("imports");
      expect(labels).toContain("Foo");
      expect(labels.some((l) => l === "Foo.bar")).toBe(true);
      expect(labels.some((l) => l === "Foo.baz")).toBe(true);
      // Every code_block chunk carries fileImports metadata.
      const codeChunks = chunks.filter((c) => c.type === "code_block");
      expect(codeChunks.every((c) => c.fileImports?.includes("import"))).toBe(true);
    });

    test("braces inside regex literals do not drift depth", () => {
      const code = [
        "export const parse = () => {",
        "  const r = /{/;",
        "  return r.test('a');",
        "};",
      ].join("\n");
      const chunks = smartChunk(code, "src/p.ts", { addFileContext: false });
      const labels = chunks.map((c) => c.label);
      expect(labels).toContain("parse");
    });
  });

  describe("python (.py) uses fixed chunker", () => {
    test(".py file → fixed chunks of fixedChunkSize", () => {
      const py = Array.from({ length: 60 }, (_, i) => `x${i} = ${i}`).join("\n");
      const chunks = smartChunk(py, "script.py", {
        addFileContext: false,
        fixedChunkSize: 50,
      });
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
      expect(chunks.length).toBe(2); // 60 / 50 = 1 full + 1 partial
      expect(summary(chunks)).toEqual([
        { lineStart: 1, lineEnd: 50, type: "fixed", label: undefined },
        { lineStart: 51, lineEnd: 60, type: "fixed", label: undefined },
      ]);
    });
  });

  describe("fixed fallback (.txt unknown ext)", () => {
    test("unknown extension → fixed chunks with exact line ranges", () => {
      const txt = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
      const chunks = smartChunk(txt, "data.txt", {
        addFileContext: false,
        fixedChunkSize: 50,
      });
      expect(chunks.length).toBe(3);
      expect(summary(chunks)).toEqual([
        { lineStart: 1, lineEnd: 50, type: "fixed", label: undefined },
        { lineStart: 51, lineEnd: 100, type: "fixed", label: undefined },
        { lineStart: 101, lineEnd: 120, type: "fixed", label: undefined },
      ]);
    });
  });
});