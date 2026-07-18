/**
 * rlm-fusion — Reciprocal Rank Fusion + score explanation delegates for
 * ContextualSearchRLM.
 *
 * Split (M14 Phase 3, T3.3 safety valve) from rlm-search.ts so each module
 * stays under the ~600 LOC budget. Behavior is byte-preserved: bodies moved
 * verbatim with `this` → `rlm`.
 */

import { SearchResult, logger } from "@massa-th0th/shared";
import type { ContextualSearchRLM } from "./contextual-search-rlm.js";

/**
 * Reciprocal Rank Fusion (RRF) - Combines multiple result lists.
 *
 * Now includes intelligent boosting:
 * - Keywords get higher weight when query contains function/class names
 * - Exact matches in keyword results get additional boost
 */
export function fuseResultsImpl(
  rlm: ContextualSearchRLM,
  resultSets: SearchResult[][],
  query: string,
  explainScores: boolean = false,
): SearchResult[] {
  const scoreMap = new Map<
    string,
    {
      result: SearchResult;
      rrfScore: number;
      vectorRank?: number;
      keywordRank?: number;
      vectorScore?: number;
      keywordScore?: number;
      vectorRrfScore: number;
      lexicalRrfScore: number;
      memoryRrfScore: number;
    }
  >();

  // Detect if query contains code-specific patterns (functions, classes, etc.)
  const hasCodePattern = (text: string): boolean => {
    const codePatterns = [
      /\w+\(\)/, // function calls: cn(), useState()
      /\bfunction\b/i, // "function" keyword
      /\bclass\b/i, // "class" keyword
      /\binterface\b/i, // "interface" keyword
      /\benum\b/i, // "enum" keyword
      /\btype\b/i, // "type" keyword
      /\bconst\b/i, // "const" keyword
      /\bimport\b/i, // "import" keyword
      /\bexport\b/i, // "export" keyword
    ];
    return codePatterns.some((pattern) => pattern.test(text));
  };

  // Check if this is a code-focused query
  const isCodeQuery = hasCodePattern(query);

  // Keyword weight multiplier (higher = more weight to keyword results)
  // For code queries: 2.5x boost to keyword matches
  // For general queries: 1.0x (equal weight)
  const codeKeywordBoostRaw = Number(process.env.RRF_KEYWORD_BOOST ?? "2.5");
  const codeKeywordBoost = Number.isFinite(codeKeywordBoostRaw) && codeKeywordBoostRaw > 0 ? codeKeywordBoostRaw : 2.5;
  const KEYWORD_BOOST = isCodeQuery ? codeKeywordBoost : 1.0;

  logger.debug("RRF fusion parameters", {
    query,
    isCodeQuery,
    keywordBoost: KEYWORD_BOOST,
    vectorResults: resultSets[0]?.length || 0,
    keywordResults: resultSets[1]?.length || 0,
  });

  // Calculate RRF score for each result.
  // Stream roles: index 0 is always the vector stream (see search()). All
  // other streams are lexical (porter keyword, trigram, fuzzy) or memory
  // (graph). Lexical streams get the code-query keyword boost; the memory
  // graph stream gets neutral weight (1.0) since it surfaces context, not a
  // direct lexical match.
  for (let i = 0; i < resultSets.length; i++) {
    const results = resultSets[i];
    const isVector = i === 0;
    const isMemoryStream = results.some(
      (r) =>
        (r.source as string) === "memory" ||
        ((r.metadata as Record<string, unknown>)?.context as Record<string, unknown>)
          ?.graphNeighbor === true,
    );
    const boost = isVector ? 1.0 : isMemoryStream ? 1.0 : KEYWORD_BOOST;

    results.forEach((result, rank) => {
      const rrfScore = (1 / (rlm.RRF_K + rank + 1)) * boost;

      if (scoreMap.has(result.id)) {
        const existing = scoreMap.get(result.id)!;

        if (isVector) {
          existing.vectorRrfScore += rrfScore;
          existing.vectorRank = rank;
          existing.vectorScore = result.score;
        } else if (isMemoryStream) {
          existing.memoryRrfScore += rrfScore;
        } else {
          // Porter, trigram, and fuzzy are correlated lexical views of the
          // same document. Count the best lexical rank once so duplicate
          // matches cannot overwhelm a strong vector-only result.
          existing.lexicalRrfScore = Math.max(
            existing.lexicalRrfScore,
            rrfScore,
          );
          // Record the best lexical rank/score (porter/trigram/fuzzy).
          if (
            existing.keywordRank === undefined ||
            rank < existing.keywordRank
          ) {
            existing.keywordRank = rank;
            existing.keywordScore = result.score;
          }
        }
        existing.rrfScore =
          existing.vectorRrfScore +
          existing.lexicalRrfScore +
          existing.memoryRrfScore;
      } else {
        const vectorRrfScore = isVector ? rrfScore : 0;
        const lexicalRrfScore = !isVector && !isMemoryStream ? rrfScore : 0;
        const memoryRrfScore = isMemoryStream ? rrfScore : 0;
        scoreMap.set(result.id, {
          result: { ...result },
          rrfScore: vectorRrfScore + lexicalRrfScore + memoryRrfScore,
          vectorRrfScore,
          lexicalRrfScore,
          memoryRrfScore,
          vectorRank: isVector ? rank : undefined,
          keywordRank: !isVector && !isMemoryStream ? rank : undefined,
          vectorScore: isVector ? result.score : undefined,
          keywordScore: !isVector && !isMemoryStream ? result.score : undefined,
        });
      }
    });
  }

  // Convert to array and sort by RRF score
  const sorted = Array.from(scoreMap.values())
    .sort((a, b) => b.rrfScore - a.rrfScore);

  // Dynamic normalization: use the top RRF score as divisor so results
  // span the full [0, 1] range instead of being capped by a fixed constant.
  const maxRrfScore = sorted[0]?.rrfScore || 1;
  const vectorWeightRaw = Number(process.env.RRF_VECTOR_WEIGHT ?? "0.3");
  const vectorWeight = Number.isFinite(vectorWeightRaw) ? Math.min(1, Math.max(0, vectorWeightRaw)) : 0.3;

  return sorted
    .map(
      (
        {
          result,
          rrfScore,
          vectorRank,
          keywordRank,
          vectorScore,
          keywordScore,
          vectorRrfScore,
          lexicalRrfScore,
          memoryRrfScore,
        },
        index,
      ) => {
        const rrfNormalized = rrfScore / maxRrfScore;

        // Combine RRF score with vector similarity for better relevance measurement
        // Weight: 70% RRF (ranking-based) + 30% vector similarity (semantic)
        const vectorSimilarity = vectorScore || 0;
        const combinedScore = rrfNormalized * (1 - vectorWeight) + vectorSimilarity * vectorWeight;

        // Centrality boost: symbols with higher PageRank get a mild re-ranking bonus.
        // finalScore = combined_score * (1 + 0.2 * centralityScore)
        // centralityScore is in [0, 1]; clamped to [0, 1] after boost.
        const centralityScore =
          typeof (result.metadata as Record<string, unknown>)?.centralityScore === "number"
            ? ((result.metadata as Record<string, unknown>).centralityScore as number)
            : 0;
        const normalizedScore = Math.min(1, combinedScore * (1 + 0.2 * centralityScore));
        const memoryOnly =
          memoryRrfScore > 0 && vectorRrfScore === 0 && lexicalRrfScore === 0;

        // Generate explanation if requested
        const explanation = explainScores
          ? generateScoreExplanationImpl(
              normalizedScore,
              rrfScore,
              vectorScore,
              keywordScore,
              vectorRank,
              keywordRank,
              index,
            )
          : undefined;

        return {
          ...result,
          score: normalizedScore,
          explanation,
          // Internal field: raw cosine similarity from the vector store.
          // Used by search() to apply minScore as an absolute relevance gate
          // (normalized RRF score is always ~1.0 for the top result and
          // therefore cannot filter semantic noise). Stripped before caching.
          metadata: {
            ...(result.metadata as Record<string, unknown>),
            // Graph-only context has no direct query-relevance signal. Give
            // it an explicit zero for minScore gating so dynamic RRF
            // normalization cannot turn an unrelated neighbor into a 0.7
            // hit. A result also found by vector/lexical retrieval keeps its
            // direct relevance behavior.
            _rrfRawVectorScore: vectorScore ?? (memoryOnly ? 0 : undefined),
          } as typeof result.metadata,
        };
      },
    );
}

/**
 * Generate detailed score explanation
 */
export function generateScoreExplanationImpl(
  finalScore: number,
  rrfScore: number,
  vectorScore?: number,
  keywordScore?: number,
  vectorRank?: number,
  keywordRank?: number,
  combinedRank?: number,
): any {
  const parts: string[] = [];

  if (vectorScore != null && vectorRank != null) {
    parts.push(
      `Vector: ${(vectorScore * 100).toFixed(1)}% (rank #${vectorRank + 1})`,
    );
  }

  if (keywordScore != null && keywordRank != null) {
    parts.push(
      `Keyword: ${(keywordScore * 100).toFixed(1)}% (rank #${keywordRank + 1})`,
    );
  }

  const breakdown =
    parts.join(" + ") +
    ` → RRF: ${rrfScore.toFixed(4)} → Final: ${(finalScore * 100).toFixed(1)}%`;

  return {
    finalScore,
    vectorScore: vectorScore ?? undefined,
    keywordScore: keywordScore ?? undefined,
    rrfScore,
    vectorRank: vectorRank != null ? vectorRank + 1 : undefined,
    keywordRank: keywordRank != null ? keywordRank + 1 : undefined,
    combinedRank: combinedRank != null ? combinedRank + 1 : undefined,
    breakdown,
  };
}
