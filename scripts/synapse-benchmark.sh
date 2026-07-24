#!/bin/bash
# Synapse benchmark — runs a battery of queries and dumps metrics.
# Usage: BATCH=A MINSCORE=0.001 scripts/synapse-benchmark.sh
set -euo pipefail

BATCH="${BATCH:-A}"
MINSCORE="${MINSCORE:-0.001}"
PROJECT="${PROJECT:@massa-ai}"
URL="${URL:-http://localhost:3333/api/v1/search/project}"
OUT="${OUT:-/tmp/synapse-bench-${BATCH}.jsonl}"

QUERIES=(
  "memory consolidation job decay rate strategy"
  "embedding provider configuration ollama setup"
  "vector store HNSW index initialization"
  "search analytics tracking duration metric"
  "session file cache chunk reference token"
  "ContextualSearchRLM hybrid search"
  "MemoryConsolidationJob decay fields"
  "applyDiversityPenalty MMR Jaccard tokens"
  "RedundancyFilter cosine similarity 0.95"
  "EmbeddingService configuration defaults"
  "why did we choose pgvector over chromadb"
  "why did we decide RRF over pure cosine"
  "rationale for hybrid vector keyword search"
  "trade-off between recency and importance"
  "how to fix ECONNREFUSED postgres connection"
  "how to resolve embedding provider error"
  "the build is broken cannot connect to db"
  "best practice for caching queries layer"
  "pattern for memory invalidation on git change"
  "idiomatic way to handle retry with backoff"
)

: > "$OUT"
for q in "${QUERIES[@]}"; do
  start=$(date +%s%N)
  resp=$(curl -sS -m 60 -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -d "{\"query\":\"$q\",\"projectId\":\"$PROJECT\",\"maxResults\":10,\"format\":\"json\",\"minScore\":$MINSCORE}")
  end=$(date +%s%N)
  dur_ms=$(( (end - start) / 1000000 ))

  jq -c --arg q "$q" --arg dur "$dur_ms" --arg batch "$BATCH" '{
    batch: $batch,
    query: $q,
    duration_ms: ($dur | tonumber),
    result_count: (.data.results | length),
    top1_score: (.data.results[0].score // 0),
    top5_scores: [.data.results[:5][].score],
    top10_files: [.data.results[:10][].filePath],
    unique_files_top5: ([.data.results[:5][].filePath] | unique | length),
    unique_files_top10: ([.data.results[:10][].filePath] | unique | length)
  }' <<< "$resp" >> "$OUT"
  printf "."
done
echo
echo "wrote $OUT"
