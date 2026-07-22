/**
 * SmartChunker — types (Wave 6 N31, T15)
 *
 * Extracted from smart-chunker.ts. Chunk, ChunkerConfig, DEFAULT_CONFIG.
 */

export interface Chunk {
  /** The text content of the chunk */
  content: string;
  /** 1-indexed start line in the original file */
  lineStart: number;
  /** 1-indexed end line in the original file */
  lineEnd: number;
  /** Chunk type for metadata */
  type: "heading_section" | "json_key" | "yaml_block" | "code_block" | "fixed";
  /** Optional label (heading text, JSON key, etc.) */
  label?: string;
  fileImports?: string;
  parentSymbol?: string;
}

export interface ChunkerConfig {
  /** Max lines for a single chunk before splitting further */
  maxChunkLines: number;
  /** Min lines for a chunk (smaller gets merged with previous) */
  minChunkLines: number;
  /** For code: target chunk size in lines */
  codeChunkTarget: number;
  /** For fixed fallback: chunk size in lines */
  fixedChunkSize: number;
  /** Whether to add file-path context prefix to each chunk */
  addFileContext: boolean;
  /**
   * Max characters per chunk. Takes precedence over line count for files with
   * very long lines (minified JS, single-line JSON, i18n files). Should stay
   * below the embedding provider's maxChars to avoid truncation.
   */
  maxChunkChars: number;
  /**
   * Number of lines of overlap between adjacent code chunks.
   */
  chunkOverlapLines: number;
}

export const DEFAULT_CONFIG: ChunkerConfig = {
  maxChunkLines: 200,
  minChunkLines: 5,
  codeChunkTarget: 100,
  fixedChunkSize: 50,
  addFileContext: true,
  maxChunkChars: 7500,
  chunkOverlapLines: 6,
};