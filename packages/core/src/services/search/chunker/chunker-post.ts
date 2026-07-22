/**
 * SmartChunker — post-processing + fixed chunker (Wave 6 N31, T16)
 *
 * Extracted from smart-chunker.ts. postProcess, splitOversizedChunk,
 * splitLineByChars, chunkFixed.
 */

import type { Chunk, ChunkerConfig } from "./chunker-types.js";

export function postProcess(chunks: Chunk[], cfg: ChunkerConfig): Chunk[] {
  if (chunks.length === 0) return chunks;

  const result: Chunk[] = [];

  for (const chunk of chunks) {
    const lineCount = chunk.content.split("\n").length;
    const charCount = chunk.content.length;

    const lineLimit =
      chunk.type === "code_block" ? cfg.codeChunkTarget : cfg.maxChunkLines;

    if (lineCount > lineLimit || charCount > cfg.maxChunkChars) {
      const subChunks = splitOversizedChunk(
        chunk,
        chunk.type === "code_block"
          ? { ...cfg, maxChunkLines: cfg.codeChunkTarget }
          : cfg,
      );
      result.push(...subChunks);
      continue;
    }

    if (chunk.label && chunk.type === "code_block") {
      result.push(chunk);
      continue;
    }
    if (
      lineCount < cfg.minChunkLines &&
      result.length > 0
    ) {
      const prev = result[result.length - 1];
      const prevLineCount = prev.content.split("\n").length;
      const prevCharCount = prev.content.length;
      if (
        prevLineCount + lineCount <= cfg.maxChunkLines &&
        prevCharCount + charCount + 1 <= cfg.maxChunkChars
      ) {
        prev.content += "\n" + chunk.content;
        prev.lineEnd = chunk.lineEnd;
        continue;
      }
    }

    result.push(chunk);
  }

  return result;
}

export function splitOversizedChunk(chunk: Chunk, cfg: ChunkerConfig): Chunk[] {
  const lines = chunk.content.split("\n");
  const targetLines = cfg.maxChunkLines;
  const maxChars = cfg.maxChunkChars;
  const subChunks: Chunk[] = [];

  const pushSub = (subLines: string[], startIdx: number, endIdx: number) => {
    if (!subLines.some((l) => l.trim())) return;
    subChunks.push({
      content: subLines.join("\n"),
      lineStart: chunk.lineStart + startIdx,
      lineEnd: chunk.lineStart + endIdx - 1,
      type: chunk.type,
      label: chunk.label
        ? `${chunk.label} (part ${subChunks.length + 1})`
        : undefined,
    });
  };

  let start = 0;
  while (start < lines.length) {
    if (lines[start].length > maxChars) {
      const parts = splitLineByChars(lines[start], maxChars);
      for (const part of parts) {
        subChunks.push({
          content: part,
          lineStart: chunk.lineStart + start,
          lineEnd: chunk.lineStart + start,
          type: chunk.type,
          label: chunk.label
            ? `${chunk.label} (part ${subChunks.length + 1})`
            : undefined,
        });
      }
      start += 1;
      continue;
    }

    let end = Math.min(start + targetLines, lines.length);

    while (end > start + 1) {
      const sliceLen = lines.slice(start, end).reduce((s, l) => s + l.length + 1, -1);
      if (sliceLen <= maxChars) break;
      end--;
    }

    if (end < lines.length) {
      const minBreak = start + Math.max(1, Math.floor((end - start) * 0.5));
      for (let i = end; i > minBreak; i--) {
        if (lines[i]?.trim() === "") {
          end = i;
          break;
        }
      }
    }

    pushSub(lines.slice(start, end), start, end);

    start = end === start ? start + 1 : end;
  }

  return subChunks;
}

export function splitLineByChars(line: string, maxChars: number): string[] {
  const parts: string[] = [];
  let remaining = line;
  while (remaining.length > maxChars) {
    const windowStart = Math.floor(maxChars * 0.8);
    const window = remaining.substring(windowStart, maxChars);
    let breakAt = -1;
    for (const sep of [";", ",", "}", " "]) {
      const idx = window.lastIndexOf(sep);
      if (idx >= 0) {
        breakAt = windowStart + idx + 1;
        break;
      }
    }
    if (breakAt < 0) breakAt = maxChars;
    parts.push(remaining.substring(0, breakAt));
    remaining = remaining.substring(breakAt);
  }
  if (remaining) parts.push(remaining);
  return parts;
}

export function chunkFixed(content: string, cfg: ChunkerConfig): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];
  const size = cfg.fixedChunkSize;

  for (let i = 0; i < lines.length; i += size) {
    const chunkLines = lines.slice(i, Math.min(i + size, lines.length));
    if (chunkLines.some((l) => l.trim())) {
      chunks.push({
        content: chunkLines.join("\n"),
        lineStart: i + 1,
        lineEnd: Math.min(i + size, lines.length),
        type: "fixed",
      });
    }
  }

  return chunks;
}