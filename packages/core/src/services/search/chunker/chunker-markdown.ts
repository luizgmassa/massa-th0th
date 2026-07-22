/**
 * SmartChunker — markdown chunker (Wave 6 N31, T15)
 *
 * Extracted from smart-chunker.ts. chunkMarkdown + chunkMarkdownByHeadings.
 */

import type { Chunk, ChunkerConfig } from "./chunker-types.js";
import { chunkFixed } from "./chunker-post.js";

export function chunkMarkdown(content: string, cfg: ChunkerConfig): Chunk[] {
  const hasHeading = /^\s*#{1,6}\s+/m.test(content);
  if (!hasHeading) return chunkFixed(content, cfg);
  return chunkMarkdownByHeadings(content, cfg);
}

export function chunkMarkdownByHeadings(content: string, _cfg: ChunkerConfig): Chunk[] {
  const lines = content.split("\n");
  const chunks: Chunk[] = [];

  const headingStack: (string | undefined)[] = [];
  let currentLines: string[] = [];
  let currentStart = 1;
  let currentLabel = "";
  let inCodeBlock = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      currentLines.push(line);
      continue;
    }

    if (inCodeBlock) {
      currentLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,6})\s+(.+)/);

    if (headingMatch) {
      if (currentLines.length > 0 && currentLines.some((l) => l.trim())) {
        chunks.push({
          content: currentLines.join("\n"),
          lineStart: currentStart,
          lineEnd: i,
          type: "heading_section",
          label: currentLabel || "preamble",
        });
      }

      const level = headingMatch[1].length;
      const headingText = headingMatch[2].trim();

      headingStack[level - 1] = headingText;
      for (let j = level; j < 6; j++) {
        headingStack[j] = undefined;
      }

      currentLabel = headingStack
        .filter((h): h is string => h !== undefined)
        .join(" > ");

      currentLines = [line];
      currentStart = i + 1;
    } else {
      currentLines.push(line);
    }
  }

  if (currentLines.length > 0 && currentLines.some((l) => l.trim())) {
    chunks.push({
      content: currentLines.join("\n"),
      lineStart: currentStart,
      lineEnd: lines.length,
      type: "heading_section",
      label: currentLabel || "preamble",
    });
  }

  return chunks;
}