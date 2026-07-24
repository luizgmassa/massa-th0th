/**
 * Synapse test corpus — categorical fixtures used by the IR-style tests.
 *
 * Each result mimics a real search hit: an id, a content snippet, a base
 * (post-RRF) score, a filePath, and any other metadata Synapse modulates on.
 * The intent is to have *enough variety* that the pipeline exercises every
 * filter rather than a single happy path.
 *
 * Categories follow the benchmark v2 query taxonomy so test outcomes can be
 * read against the same buckets used in production benchmarks.
 */

import type { SearchResult } from "@massa-ai/shared";
import { SearchSource } from "@massa-ai/shared";

export type Category =
  | "architecture"
  | "configuration"
  | "storage"
  | "implementation"
  | "ranking"
  | "decision"
  | "tradeoff"
  | "troubleshooting"
  | "best_practice";

export interface CorpusItem {
  id: string;
  category: Category;
  filePath: string;
  content: string;
  /** Raw post-RRF score (what the search returns). */
  score: number;
  /** Optional raw vector cosine (used by IMP-5). */
  rrfRawVectorScore?: number;
  /** Optional Memory.type (only memory-search results have this in real data). */
  type?: string;
  /** Optional epoch-ms creation timestamp. */
  createdAt?: number;
  /** Optional access counter. */
  accessCount?: number;
}

export function toResult(item: CorpusItem): SearchResult {
  const meta: Record<string, unknown> = { filePath: item.filePath };
  if (item.rrfRawVectorScore != null) meta._rrfRawVectorScore = item.rrfRawVectorScore;
  if (item.type != null) meta.type = item.type;
  if (item.createdAt != null) meta.createdAt = item.createdAt;
  if (item.accessCount != null) meta.accessCount = item.accessCount;
  return {
    id: item.id,
    content: item.content,
    score: item.score,
    source: SearchSource.VECTOR,
    metadata: meta as any,
  };
}

export const CORPUS: CorpusItem[] = [
  // --- architecture / decisions ---
  {
    id: "arch-1",
    category: "decision",
    filePath: "docs/decisions/001-pgvector.md",
    content: "We chose pgvector over chromadb because of operational simplicity and HNSW support",
    score: 0.85,
    rrfRawVectorScore: 0.72,
  },
  {
    id: "arch-2",
    category: "decision",
    filePath: "docs/decisions/002-rrf.md",
    content: "RRF was selected over pure cosine because it combines vector and keyword rankings",
    score: 0.83,
    rrfRawVectorScore: 0.71,
  },

  // --- implementation chunks (multiple from same file → test diversity) ---
  {
    id: "impl-1a",
    category: "implementation",
    filePath: "packages/core/src/services/search/contextual-search-rlm.ts",
    content: "class ContextualSearchRLM implementing hybrid search",
    score: 0.88,
    rrfRawVectorScore: 0.78,
  },
  {
    id: "impl-1b",
    category: "implementation",
    filePath: "packages/core/src/services/search/contextual-search-rlm.ts",
    content: "fuseResults applies reciprocal rank fusion over vector and keyword results",
    score: 0.86,
    rrfRawVectorScore: 0.74,
  },
  {
    id: "impl-1c",
    category: "implementation",
    filePath: "packages/core/src/services/search/contextual-search-rlm.ts",
    content: "applies pattern filters to fused results and respects minScore",
    score: 0.82,
    rrfRawVectorScore: 0.69,
  },

  // --- ranking implementation ---
  {
    id: "rank-1",
    category: "ranking",
    filePath: "packages/core/src/services/synapse/inhibition/diversity-penalty.ts",
    content: "applyDiversityPenalty MMR-style penalty using Jaccard over content tokens",
    score: 0.84,
    rrfRawVectorScore: 0.73,
  },
  {
    id: "rank-2",
    category: "ranking",
    filePath: "packages/core/src/services/memory/redundancy-filter.ts",
    content: "RedundancyFilter merges near-duplicate memories above 0.95 cosine similarity",
    score: 0.80,
    rrfRawVectorScore: 0.66,
  },

  // --- test files (should be demoted for symbol queries) ---
  {
    id: "test-1",
    category: "implementation",
    filePath: "packages/core/src/__tests__/contextual-search.test.ts",
    content: "tests for ContextualSearchRLM hybrid search behaviour",
    score: 0.78,
    rrfRawVectorScore: 0.64,
  },
  {
    id: "test-2",
    category: "implementation",
    filePath: "packages/core/src/__tests__/diversity-penalty.test.ts",
    content: "tests for applyDiversityPenalty with various corpora",
    score: 0.75,
    rrfRawVectorScore: 0.62,
  },

  // --- troubleshooting / configuration ---
  {
    id: "config-1",
    category: "configuration",
    filePath: "packages/core/src/services/embeddings/config.ts",
    content: "embedding provider config for ollama and friends",
    score: 0.81,
    rrfRawVectorScore: 0.70,
  },
  {
    id: "tshoot-1",
    category: "troubleshooting",
    filePath: "docs/troubleshooting.md",
    content: "common ECONNREFUSED postgres errors and their fixes",
    score: 0.77,
    rrfRawVectorScore: 0.63,
  },

  // --- weak / noisy results ---
  {
    id: "noise-1",
    category: "implementation",
    filePath: "packages/core/src/scripts/random.ts",
    content: "unrelated utility script",
    score: 0.62, // RRF inflated; raw cosine is much lower
    rrfRawVectorScore: 0.15,
  },
  {
    id: "noise-2",
    category: "implementation",
    filePath: "packages/core/src/legacy/old.ts",
    content: "deprecated legacy code path",
    score: 0.55,
    rrfRawVectorScore: 0.10,
  },
];

/**
 * Golden expectations — for each test query, which corpus item ids are
 * considered relevant. Used by the relevance-style tests.
 */
export const GOLDEN: Record<string, string[]> = {
  "why did we choose pgvector over chromadb": ["arch-1"],
  "why did we decide RRF over pure cosine": ["arch-2"],
  "ContextualSearchRLM hybrid search": ["impl-1a", "impl-1b", "impl-1c"],
  "applyDiversityPenalty MMR Jaccard tokens": ["rank-1"],
  "RedundancyFilter cosine similarity 0.95": ["rank-2"],
  "embedding provider configuration ollama setup": ["config-1"],
  "how to fix ECONNREFUSED postgres connection": ["tshoot-1"],
};
