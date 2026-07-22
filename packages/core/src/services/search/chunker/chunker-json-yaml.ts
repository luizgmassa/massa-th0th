/**
 * SmartChunker — JSON/YAML chunker (Wave 6 N31, T15)
 *
 * Extracted from smart-chunker.ts. chunkJSON + chunkYAML.
 */

import type { Chunk, ChunkerConfig } from "./chunker-types.js";
import { chunkFixed } from "./chunker-post.js";

export function chunkJSON(content: string, cfg: ChunkerConfig): Chunk[] {
  try {
    const parsed = JSON.parse(content);

    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      return chunkFixed(content, cfg);
    }

    const chunks: Chunk[] = [];
    const keys = Object.keys(parsed);

    if (keys.length < 5) {
      const lines = content.split("\n");
      return [
        {
          content,
          lineStart: 1,
          lineEnd: lines.length,
          type: "json_key",
          label: `{${keys.join(", ")}}`,
        },
      ];
    }

    const lines = content.split("\n");

    for (const key of keys) {
      const value = parsed[key];
      const serialized = JSON.stringify({ [key]: value }, null, 2);
      const serializedLines = serialized.split("\n");

      const keyPattern = new RegExp(
        `^\\s*"${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"\\s*:`,
      );
      let startLine = 1;
      for (let i = 0; i < lines.length; i++) {
        if (keyPattern.test(lines[i])) {
          startLine = i + 1;
          break;
        }
      }

      chunks.push({
        content: serialized,
        lineStart: startLine,
        lineEnd: startLine + serializedLines.length - 1,
        type: "json_key",
        label: key,
      });
    }

    return chunks;
  } catch {
    return chunkFixed(content, cfg);
  }
}

export function chunkYAML(content: string, cfg: ChunkerConfig): Chunk[] {
  const lines = content.split("\n");

  const docSeparators: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() === "---") {
      docSeparators.push(i);
    }
  }

  if (docSeparators.length > 1) {
    const chunks: Chunk[] = [];
    for (let d = 0; d < docSeparators.length; d++) {
      const start = docSeparators[d];
      const end = d + 1 < docSeparators.length ? docSeparators[d + 1] : lines.length;
      const docLines = lines.slice(start, end);

      if (docLines.some((l) => l.trim() && l.trim() !== "---")) {
        chunks.push({
          content: docLines.join("\n"),
          lineStart: start + 1,
          lineEnd: end,
          type: "yaml_block",
          label: `document ${d + 1}`,
        });
      }
    }
    if (chunks.length > 0) return chunks;
  }

  const chunks: Chunk[] = [];
  let currentLines: string[] = [];
  let currentStart = 1;
  let currentLabel = "";

  const topLevelKey = /^[a-zA-Z_][a-zA-Z0-9_.-]*\s*:/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (line.trim() === "---" || line.trim() === "...") {
      currentLines.push(line);
      continue;
    }

    if (topLevelKey.test(line) && currentLines.length > 0) {
      if (currentLines.some((l) => l.trim() && l.trim() !== "---")) {
        chunks.push({
          content: currentLines.join("\n"),
          lineStart: currentStart,
          lineEnd: i,
          type: "yaml_block",
          label: currentLabel || "header",
        });
      }
      currentLines = [line];
      currentStart = i + 1;
      currentLabel = line.split(":")[0].trim();
    } else {
      currentLines.push(line);
      if (!currentLabel && topLevelKey.test(line)) {
        currentLabel = line.split(":")[0].trim();
      }
    }
  }

  if (currentLines.length > 0 && currentLines.some((l) => l.trim())) {
    chunks.push({
      content: currentLines.join("\n"),
      lineStart: currentStart,
      lineEnd: lines.length,
      type: "yaml_block",
      label: currentLabel || "content",
    });
  }

  return chunks.length > 0 ? chunks : chunkFixed(content, cfg);
}