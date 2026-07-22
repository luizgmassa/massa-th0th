/**
 * Smart Chunker — dispatcher (Wave 6 N31, T16)
 *
 * Language/format-aware semantic chunking. All chunking logic extracted to
 * chunker/ modules. This file dispatches by extension and re-exports.
 */

import path from "path";

// ── Re-exports ──────────────────────────────────────────────────────────────
export type { Chunk, ChunkerConfig } from "./chunker/chunker-types.js";
export { DEFAULT_CONFIG } from "./chunker/chunker-types.js";
export { chunkMarkdown, chunkMarkdownByHeadings } from "./chunker/chunker-markdown.js";
export { chunkJSON, chunkYAML } from "./chunker/chunker-json-yaml.js";
export { chunkCode, findCodeBoundaries, netBraceDelta, extractFileImports, isCodeFile, CODE_EXTENSIONS } from "./chunker/chunker-code.js";
export type { CodeBoundary } from "./chunker/chunker-code.js";
export { postProcess, splitOversizedChunk, splitLineByChars, chunkFixed } from "./chunker/chunker-post.js";

// ── Imports ─────────────────────────────────────────────────────────────────
import type { Chunk, ChunkerConfig } from "./chunker/chunker-types.js";
import { DEFAULT_CONFIG } from "./chunker/chunker-types.js";
import { chunkMarkdown } from "./chunker/chunker-markdown.js";
import { chunkJSON, chunkYAML } from "./chunker/chunker-json-yaml.js";
import { chunkCode, isCodeFile, extractFileImports } from "./chunker/chunker-code.js";
import { postProcess } from "./chunker/chunker-post.js";
import { chunkFixed } from "./chunker/chunker-post.js";

// ── Dispatcher ──────────────────────────────────────────────────────────────

export function smartChunk(
  content: string,
  filePath: string,
  config: Partial<ChunkerConfig> = {},
): Chunk[] {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const ext = path.extname(filePath).toLowerCase();
  const relativePath = filePath;
  const fileImports = isCodeFile(ext) ? extractFileImports(content, ext) : undefined;

  let chunks: Chunk[];
  switch (ext) {
    case ".md":
    case ".mdx":
      chunks = chunkMarkdown(content, cfg); break;
    case ".json":
      chunks = chunkJSON(content, cfg); break;
    case ".yaml":
    case ".yml":
      chunks = chunkYAML(content, cfg); break;
    case ".py":
      chunks = chunkFallback(content, cfg); break;
    default:
      chunks = isCodeFile(ext) ? chunkCode(content, cfg) : chunkFallback(content, cfg);
  }

  const HEADER_BUDGET = 250;
  const postCfg = cfg.maxChunkChars > HEADER_BUDGET
    ? { ...cfg, maxChunkChars: cfg.maxChunkChars - HEADER_BUDGET } : cfg;
  chunks = postProcess(chunks, postCfg);

  const REPEAT_MIN_LINES = 5;
  if (cfg.addFileContext) {
    chunks = chunks.map((chunk) => {
      const lineCount = chunk.content.split("\n").length;
      const repeat = chunk.label && lineCount >= REPEAT_MIN_LINES;
      const labelHeader = chunk.label
        ? repeat ? `// Section: ${chunk.label}\n// ${chunk.label}\n// ${chunk.label}\n` : `// Section: ${chunk.label}\n`
        : "";
      return { ...chunk, content: `// File: ${relativePath}\n${labelHeader}${chunk.content}` };
    });
  }

  if (fileImports) {
    chunks = chunks.map((c) => ({ ...c, fileImports, parentSymbol: c.label ?? undefined }));
  }

  return chunks.filter((c) => c.content.trim().length > 0);
}

function chunkFallback(content: string, cfg: ChunkerConfig): Chunk[] {
  return chunkFixed(content, cfg);
}