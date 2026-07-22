/**
 * SmartChunker — code chunker (Wave 6 N31, T16)
 *
 * Extracted from smart-chunker.ts. chunkCode, findCodeBoundaries,
 * CodeBoundary, RESERVED_KEYWORDS, regex consts, netBraceDelta,
 * extractFileImports, CODE_EXTENSIONS, isCodeFile.
 */

import type { Chunk, ChunkerConfig } from "./chunker-types.js";
import { chunkFixed } from "./chunker-post.js";

export interface CodeBoundary {
  /** 0-indexed line where the declaration starts */
  line: number;
  /** Symbol name (e.g. "ParseStage", "extractJsSymbols") */
  label: string;
  /** Outer container name when this boundary is a method */
  container?: string;
}

export const RESERVED_KEYWORDS = new Set([
  "if", "for", "while", "switch", "return", "throw", "catch",
  "do", "try", "else", "case", "with", "yield", "await",
]);

/** Top-level container declarations (class/interface/enum/namespace/trait/impl) */
const CONTAINER_RE =
  /^(?:export\s+(?:default\s+)?)?(?:abstract\s+)?(?:class|interface|enum|namespace|trait|impl)\s+(\w+)/;

/** Top-level non-container declarations (function/const/let/var/type/struct/fn/def/func) */
const TOP_LEVEL_RE =
  /^(?:export\s+(?:default\s+)?)?(?:async\s+)?(?:function|const|let|var|type|struct|fn|def|func)\s+(\w+)/;

/** Method-like declarations inside a class body: identifier followed by `(` or `<` */
const METHOD_RE =
  /^(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|override\s+|async\s+|abstract\s+|get\s+|set\s+)*(\w+)\s*[(<]/;

export function chunkCode(content: string, cfg: ChunkerConfig): Chunk[] {
  const lines = content.split("\n");
  const boundaries = findCodeBoundaries(lines);

  if (boundaries.length === 0) return chunkFixed(content, cfg);

  const realStarts: number[] = [];
  for (let b = 0; b < boundaries.length; b++) {
    const limit = b > 0 ? boundaries[b - 1].line + 1 : 0;
    let s = boundaries[b].line;
    while (s > limit) {
      const prev = lines[s - 1].trimStart();
      const isDoc =
        prev.startsWith("//") ||
        prev.startsWith("/*") ||
        prev.startsWith("*") ||
        prev.startsWith("///") ||
        prev.startsWith("@") ||
        prev.startsWith('"""');
      if (isDoc) s--;
      else break;
    }
    realStarts.push(s);
  }

  const chunks: Chunk[] = [];

  if (realStarts[0] > 0) {
    const preamble = lines.slice(0, realStarts[0]);
    if (preamble.some((l) => l.trim())) {
      chunks.push({
        content: preamble.join("\n"),
        lineStart: 1,
        lineEnd: realStarts[0],
        type: "code_block",
        label: "imports",
      });
    }
  }

  for (let b = 0; b < boundaries.length; b++) {
    const start = realStarts[b];
    let end: number;
    if (b + 1 < realStarts.length) {
      const nextBoundaryLine = boundaries[b + 1].line;
      const overlapCeiling = Math.min(nextBoundaryLine, lines.length);
      end = Math.min(realStarts[b + 1] + cfg.chunkOverlapLines, overlapCeiling, lines.length);
    } else {
      end = lines.length;
    }
    const slice = lines.slice(start, end);
    if (!slice.some((l) => l.trim())) continue;
    const label = boundaries[b].container
      ? `${boundaries[b].container}.${boundaries[b].label}`
      : boundaries[b].label;
    chunks.push({
      content: slice.join("\n"),
      lineStart: start + 1,
      lineEnd: end,
      type: "code_block",
      label,
    });
  }

  return chunks;
}

export function findCodeBoundaries(lines: string[]): CodeBoundary[] {
  const boundaries: CodeBoundary[] = [];
  const containerStack: { name: string; openDepth: number }[] = [];
  let depth = 0;
  let inBlockComment = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trimStart();

    if (inBlockComment) {
      if (line.includes("*/")) inBlockComment = false;
      continue;
    }
    if (trimmed.startsWith("/*") && !trimmed.includes("*/")) {
      inBlockComment = true;
      continue;
    }
    if (
      !trimmed ||
      trimmed.startsWith("//") ||
      trimmed.startsWith("///") ||
      trimmed.startsWith("*")
    ) {
      continue;
    }

    if (depth === 0) {
      const c = CONTAINER_RE.exec(trimmed);
      if (c) {
        boundaries.push({ line: i, label: c[1] });
        containerStack.push({ name: c[1], openDepth: 0 });
      } else {
        const t = TOP_LEVEL_RE.exec(trimmed);
        if (t) boundaries.push({ line: i, label: t[1] });
      }
    } else if (
      containerStack.length > 0 &&
      depth === containerStack[containerStack.length - 1].openDepth + 1
    ) {
      const m = METHOD_RE.exec(trimmed);
      if (m && !RESERVED_KEYWORDS.has(m[1])) {
        boundaries.push({
          line: i,
          label: m[1],
          container: containerStack[containerStack.length - 1].name,
        });
      }
    }

    depth += netBraceDelta(line);

    while (
      containerStack.length > 0 &&
      depth <= containerStack[containerStack.length - 1].openDepth
    ) {
      containerStack.pop();
    }
  }

  return boundaries;
}

export function netBraceDelta(line: string): number {
  const stripped = line
    .replace(/\/\*.*?\*\//g, "")
    .replace(/\/\/.*$/, "")
    .replace(/'(?:\\.|[^'\\])*'/g, "''")
    .replace(/"(?:\\.|[^"\\])*"/g, '""')
    .replace(/`(?:\\.|[^`\\])*`/g, "``")
    .replace(/\/(?:\\.|[^/\\\n])+\/[gimsuy]*/g, "//");
  return (stripped.match(/\{/g) || []).length - (stripped.match(/\}/g) || []).length;
}

export function extractFileImports(content: string, ext: string): string | undefined {
  const lines = content.split("\n");
  const importLines: string[] = [];

  if (ext === ".py") {
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("import ") || t.startsWith("from ")) {
        importLines.push(t);
      }
    }
  } else {
    for (const line of lines) {
      const t = line.trim();
      if (t.startsWith("import ") || t.startsWith("const {") || t.startsWith("require(")) {
        importLines.push(t);
      } else if (importLines.length > 0 && t === "") {
        break;
      }
    }
  }

  if (importLines.length === 0) return undefined;
  return importLines.join("\n");
}

export const CODE_EXTENSIONS = new Set([
  ".ts",".js",".tsx",".jsx",".vue",".dart",".py",".php",".java",".go",
  ".rs",".cpp",".c",".h",".md",".json",".yaml",".yml",".hpp",".cs",".rb",
  ".swift",".kt",".kts",".scala",".lua",".zig",".ex",".exs",".erl",".clj",
  ".ml",".hs",
]);

export function isCodeFile(ext: string): boolean {
  return CODE_EXTENSIONS.has(ext);
}