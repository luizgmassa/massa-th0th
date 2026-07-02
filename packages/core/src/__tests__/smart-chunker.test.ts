/**
 * Phase 7e — Characterization tests for the Smart Chunker.
 *
 * Asserts ACTUAL current behavior (not aspirational). Pure module, no DB / no
 * shared-config mock. Covers the load-bearing chunking paths that were
 * previously untested. Behavior verified by probing the real module before
 * writing these assertions.
 */

import { describe, test, expect } from "bun:test";
import { smartChunk } from "../services/search/smart-chunker.js";

describe("SmartChunker — characterization", () => {
  describe("markdown", () => {
    test("splits by headings when sections are ≥ minChunkLines", () => {
      // Sections with ≥5 body lines survive post-process (no tiny-merge).
      const md = [
        "# Title", "l1", "l2", "l3", "l4", "l5", "",
        "## Section A", "s1", "s2", "s3", "s4", "s5",
      ].join("\n");
      const chunks = smartChunk(md, "docs/readme.md", { addFileContext: false });
      expect(chunks.length).toBe(2);
      expect(chunks.every((c) => c.type === "heading_section")).toBe(true);
      // hierarchy chain label on the deeper section
      expect(chunks[1].label).toBe("Title > Section A");
      expect(chunks[0].label).toBe("Title");
    });

    test("tiny heading sections merge into the previous chunk", () => {
      // <5-line sections get merged (post-process: tiny unlabeled-or-non-code
      // chunks merge into previous). The merged label is the first chunk's.
      const md = ["# Title", "intro", "", "## Sub", "tiny"].join("\n");
      const chunks = smartChunk(md, "docs/x.md", { addFileContext: false });
      expect(chunks.length).toBe(1);
      expect(chunks[0].label).toBe("Title");
    });

    test("falls back to fixed chunks when there are no headings", () => {
      const md = "plain text\nline2\nline3\nline4\nline5\nline6\n";
      const chunks = smartChunk(md, "docs/nohead.md", { addFileContext: false });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
    });

    test("code fences are opaque — headings inside ``` are ignored", () => {
      const md = ["# Real", "t1", "t2", "t3", "t4", "```", "# NotAHeading", "code", "```"].join("\n");
      const chunks = smartChunk(md, "docs/x.md", { addFileContext: false });
      const allLabels = chunks.map((c) => c.label).join("|");
      expect(allLabels).not.toContain("NotAHeading");
    });
  });

  describe("JSON", () => {
    test("<5 keys → single chunk labeled with the key set", () => {
      const json = JSON.stringify({ a: 1, b: 2, c: 3 }, null, 2);
      const chunks = smartChunk(json, "config.json", { addFileContext: false });
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe("json_key");
      expect(chunks[0].label).toBe("{a, b, c}");
    });

    test("≥5 small keys → per-key chunks merge into one (tiny-merge)", () => {
      // Each key→value is tiny; json_key chunks are NOT protected by the
      // code_block label guard, so post-process merges them. Characterization.
      const obj: Record<string, number> = {};
      for (let i = 0; i < 6; i++) obj[`k${i}`] = i;
      const chunks = smartChunk(JSON.stringify(obj, null, 2), "big.json", {
        addFileContext: false,
      });
      expect(chunks.length).toBe(1);
      expect(chunks[0].type).toBe("json_key");
    });

    test("array JSON → fixed fallback (only objects split)", () => {
      const json = JSON.stringify([1, 2, 3, 4, 5, 6]);
      const chunks = smartChunk(json, "arr.json", { addFileContext: false });
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
    });
  });

  describe("YAML", () => {
    test("single document → top-level-key split", () => {
      const yaml = "alpha: 1\nbeta: 2\ngamma: 3\n";
      const chunks = smartChunk(yaml, "one.yaml", { addFileContext: false });
      expect(chunks.length).toBeGreaterThanOrEqual(1);
      expect(chunks.every((c) => c.type === "yaml_block")).toBe(true);
    });
  });

  describe("code (TS)", () => {
    test("class boundary + method labels are `Class.method`", () => {
      const code = [
        "import { x } from 'y';",
        "",
        "export class Foo {",
        "  bar() { return 1; }",
        "  baz() { return 2; }",
        "}",
      ].join("\n");
      const chunks = smartChunk(code, "src/foo.ts", { addFileContext: false });
      const labels = chunks.map((c) => c.label);
      expect(labels).toContain("imports");
      expect(labels).toContain("Foo");
      expect(labels.some((l) => l === "Foo.bar")).toBe(true);
      expect(labels.some((l) => l === "Foo.baz")).toBe(true);
      // code chunks carry fileImports metadata
      const codeChunks = chunks.filter((c) => c.type === "code_block");
      expect(codeChunks.length).toBeGreaterThan(0);
      expect(codeChunks.every((c) => c.fileImports?.includes("import"))).toBe(true);
    });

    test("braces inside regex literals do not drift depth", () => {
      // netBraceDelta strips regex literals so `/{/` doesn't open a block.
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

  describe("fixed fallback + limits", () => {
    test("unknown extension → fixed chunks", () => {
      const txt = Array.from({ length: 120 }, (_, i) => `line ${i}`).join("\n");
      const chunks = smartChunk(txt, "data.txt", {
        addFileContext: false,
        fixedChunkSize: 50,
      });
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
      expect(chunks.length).toBe(3); // 120 / 50
    });

    test("maxChunkChars splits a single over-long line", () => {
      const longLine = "a".repeat(2000);
      const chunks = smartChunk(longLine + "\n", "min.js", {
        addFileContext: false,
        maxChunkChars: 500,
        fixedChunkSize: 50,
      });
      for (const c of chunks) expect(c.content.length).toBeLessThanOrEqual(500);
      expect(chunks.length).toBeGreaterThanOrEqual(4);
    });
  });

  describe("post-processing + context header", () => {
    test("file-context prefix is added when addFileContext=true", () => {
      const md = "# H\nbody text line one\nbody text line two\n";
      const chunks = smartChunk(md, "docs/a.md");
      expect(chunks[0].content.startsWith("// File: docs/a.md")).toBe(true);
    });

    test("label is repeated 3x for chunks ≥5 lines (embedding bias)", () => {
      // A method with ≥5 body lines triggers the 3x repeat header.
      const code = [
        "export class Big {",
        "  longMethod() {",
        "    const a = 1;",
        "    const b = 2;",
        "    const c = 3;",
        "    const d = 4;",
        "    return a + b + c + d;",
        "  }",
        "}",
      ].join("\n");
      const chunks = smartChunk(code, "src/big.ts");
      const m = chunks.find((c) => c.label === "Big.longMethod");
      expect(m).toBeDefined();
      // Header = `// File:…`, `// Section: Big.longMethod`, `// Big.longMethod`,
      // `// Big.longMethod` → the label appears 3 times across the 3 label lines.
      const header = m!.content.split("\n").slice(0, 4).join("\n");
      expect((header.match(/Big\.longMethod/g) || []).length).toBe(3);
    });

    test("label is NOT repeated for tiny chunks (<5 lines)", () => {
      const code = "export const REINDEX_FILE_THRESHOLD = 15;\n";
      const chunks = smartChunk(code, "src/cfg.ts");
      const cfg = chunks.find((c) => c.label === "REINDEX_FILE_THRESHOLD");
      expect(cfg).toBeDefined();
      const header = cfg!.content.split("\n")[1] ?? "";
      expect((header.match(/REINDEX_FILE_THRESHOLD/g) || []).length).toBe(1);
    });

    test("empty chunks are filtered out", () => {
      const content = "\n\n\n  \n";
      const chunks = smartChunk(content, "empty.ts", { addFileContext: false });
      expect(chunks.length).toBe(0);
    });
  });

  describe("python uses fixed chunker (indentation, not braces)", () => {
    test(".py file → fixed chunks", () => {
      const py = Array.from({ length: 60 }, (_, i) => `x${i} = ${i}`).join("\n");
      const chunks = smartChunk(py, "script.py", {
        addFileContext: false,
        fixedChunkSize: 50,
      });
      expect(chunks.every((c) => c.type === "fixed")).toBe(true);
    });
  });
});
