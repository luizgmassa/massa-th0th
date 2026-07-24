#!/usr/bin/env bash
# Synapse benchmark v2 — repeated, randomized, failure-aware benchmark runner.
# Usage examples:
#   BATCH=A REPEATS=5 scripts/synapse-benchmark-v2.sh
#   BATCH=B QUERY_FILE=./bench-queries.tsv OUT=/tmp/synapse-bench-B.jsonl scripts/synapse-benchmark-v2.sh
#
# QUERY_FILE format: TSV with "category<TAB>query". Lines starting with # are ignored.
set -euo pipefail

BATCH="${BATCH:-A}"
PROJECT="${PROJECT:@massa-ai}"
URL="${URL:-http://localhost:3333/api/v1/search/project}"
OUT="${OUT:-/tmp/synapse-bench-${BATCH}.jsonl}"
QUERY_FILE="${QUERY_FILE:-}"
MINSCORE="${MINSCORE:-0.001}"
MAXRESULTS="${MAXRESULTS:-10}"
REPEATS="${REPEATS:-5}"
WARMUP="${WARMUP:-1}"
SHUFFLE="${SHUFFLE:-1}"
TIMEOUT="${TIMEOUT:-60}"
RUN_ID="${RUN_ID:-$(date -u +%Y%m%dT%H%M%SZ)-$$}"

need() {
  command -v "$1" >/dev/null 2>&1 || {
    echo "Missing dependency: $1" >&2
    exit 2
  }
}
need curl
need jq
need awk

TMPDIR_BENCH="$(mktemp -d)"
trap 'rm -rf "$TMPDIR_BENCH"' EXIT

DEFAULT_QUERIES="$TMPDIR_BENCH/queries.tsv"
cat > "$DEFAULT_QUERIES" <<'EOF'
architecture	memory consolidation job decay rate strategy
configuration	embedding provider configuration ollama setup
storage	vector store HNSW index initialization
analytics	search analytics tracking duration metric
cache	session file cache chunk reference token
implementation	ContextualSearchRLM hybrid search
implementation	MemoryConsolidationJob decay fields
ranking	applyDiversityPenalty MMR Jaccard tokens
ranking	RedundancyFilter cosine similarity 0.95
configuration	EmbeddingService configuration defaults
decision	why did we choose pgvector over chromadb
decision	why did we decide RRF over pure cosine
decision	rationale for hybrid vector keyword search
tradeoff	trade-off between recency and importance
troubleshooting	how to fix ECONNREFUSED postgres connection
troubleshooting	how to resolve embedding provider error
troubleshooting	the build is broken cannot connect to db
best_practice	best practice for caching queries layer
best_practice	pattern for memory invalidation on git change
best_practice	idiomatic way to handle retry with backoff
EOF

SRC_QUERIES="${QUERY_FILE:-$DEFAULT_QUERIES}"
if [ ! -f "$SRC_QUERIES" ]; then
  echo "QUERY_FILE not found: $SRC_QUERIES" >&2
  exit 2
fi

query_order() {
  if [ "$SHUFFLE" = "1" ] && command -v shuf >/dev/null 2>&1; then
    shuf "$SRC_QUERIES"
  else
    cat "$SRC_QUERIES"
  fi
}

make_payload() {
  local query="$1"
  jq -cn \
    --arg query "$query" \
    --arg projectId "$PROJECT" \
    --argjson maxResults "$MAXRESULTS" \
    --argjson minScore "$MINSCORE" \
    '{query:$query, projectId:$projectId, maxResults:$maxResults, format:"json", minScore:$minScore}'
}

emit_failure() {
  local category="$1" query="$2" repeat="$3" http_code="$4" curl_exit="$5" curl_time_ms="$6" wall_ms="$7" body="$8" err="$9"
  local body_sample curl_error
  body_sample="$(head -c 800 "$body" 2>/dev/null | tr '\n\r' '  ')"
  curl_error="$(head -c 800 "$err" 2>/dev/null | tr '\n\r' '  ')"
  jq -cn \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg batch "$BATCH" \
    --arg run_id "$RUN_ID" \
    --arg project "$PROJECT" \
    --arg url "$URL" \
    --arg category "$category" \
    --arg query "$query" \
    --arg body_sample "$body_sample" \
    --arg curl_error "$curl_error" \
    --argjson repeat "$repeat" \
    --argjson min_score "$MINSCORE" \
    --argjson max_results "$MAXRESULTS" \
    --argjson timeout_sec "$TIMEOUT" \
    --argjson http_code "$http_code" \
    --argjson curl_exit "$curl_exit" \
    --argjson curl_time_ms "$curl_time_ms" \
    --argjson wall_ms "$wall_ms" \
    '{timestamp:$timestamp,batch:$batch,run_id:$run_id,project:$project,url:$url,category:$category,query:$query,repeat:$repeat,
      min_score:$min_score,max_results:$max_results,timeout_sec:$timeout_sec,http_code:$http_code,curl_exit:$curl_exit,
      curl_time_ms:$curl_time_ms,wall_ms:$wall_ms,duration_ms:$wall_ms,ok:false,result_count:0,top1_score:0,
      top5_scores:[],top10_scores:[],top5_files:[],top10_files:[],top10:[],unique_files_top5:0,unique_files_top10:0,
      error:{curl_error:$curl_error,body_sample:$body_sample}}' >> "$OUT"
}

emit_success_or_server_error() {
  local category="$1" query="$2" repeat="$3" http_code="$4" curl_exit="$5" curl_time_ms="$6" wall_ms="$7" body="$8" ok="$9"
  jq -c \
    --arg timestamp "$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
    --arg batch "$BATCH" \
    --arg run_id "$RUN_ID" \
    --arg project "$PROJECT" \
    --arg url "$URL" \
    --arg category "$category" \
    --arg query "$query" \
    --arg ok "$ok" \
    --argjson repeat "$repeat" \
    --argjson min_score "$MINSCORE" \
    --argjson max_results "$MAXRESULTS" \
    --argjson timeout_sec "$TIMEOUT" \
    --argjson http_code "$http_code" \
    --argjson curl_exit "$curl_exit" \
    --argjson curl_time_ms "$curl_time_ms" \
    --argjson wall_ms "$wall_ms" \
    '(.data.results // []) as $r |
      ([$r[:5][] | .filePath // empty]) as $top5_files |
      ([$r[:10][] | .filePath // empty]) as $top10_files |
      {timestamp:$timestamp,batch:$batch,run_id:$run_id,project:$project,url:$url,category:$category,query:$query,repeat:$repeat,
       min_score:$min_score,max_results:$max_results,timeout_sec:$timeout_sec,http_code:$http_code,curl_exit:$curl_exit,
       curl_time_ms:$curl_time_ms,wall_ms:$wall_ms,duration_ms:$wall_ms,ok:($ok == "true"),
       result_count:($r|length),
       top1_score:($r[0].score // 0),
       top5_scores:[$r[:5][] | .score // null],
       top10_scores:[$r[:10][] | .score // null],
       top5_files:$top5_files,
       top10_files:$top10_files,
       unique_files_top5:($top5_files | unique | length),
       unique_files_top10:($top10_files | unique | length),
       duplicate_files_top5:(($top5_files | length) - ($top5_files | unique | length)),
       duplicate_files_top10:(($top10_files | length) - ($top10_files | unique | length)),
       top10:[$r[:10][] | {
         score:(.score // null),
         filePath:(.filePath // null),
         id:(.id // .chunkId // .memoryId // null),
         startLine:(.startLine // .lineStart // null),
         endLine:(.endLine // .lineEnd // null),
         title:(.title // null)
       }],
       response_error:(.error.message // .message // null)}' "$body" >> "$OUT"
}

run_one() {
  local category="$1" query="$2" repeat="$3" record="$4"
  local body err payload status_line curl_exit start_ns end_ns wall_ms http_code time_total size_download http_num curl_time_ms ok
  body="$TMPDIR_BENCH/body-${repeat}-$$.json"
  err="$TMPDIR_BENCH/curl-${repeat}-$$.err"
  payload="$(make_payload "$query")"

  start_ns="$(date +%s%N)"
  set +e
  status_line="$(curl -sS -o "$body" -w '%{http_code}\t%{time_total}\t%{size_download}' -m "$TIMEOUT" \
    -X POST "$URL" \
    -H 'Content-Type: application/json' \
    -d "$payload" 2>"$err")"
  curl_exit=$?
  set -e
  end_ns="$(date +%s%N)"
  wall_ms=$(( (end_ns - start_ns) / 1000000 ))

  IFS=$'\t' read -r http_code time_total size_download <<< "${status_line:-000\t0\t0}"
  http_num="$(awk -v c="${http_code:-0}" 'BEGIN{if (c ~ /^[0-9]+$/) print c+0; else print 0}')"
  curl_time_ms="$(awk -v t="${time_total:-0}" 'BEGIN{printf "%d", t*1000}')"

  if [ "$record" != "1" ]; then
    return 0
  fi

  ok="false"
  if [ "$curl_exit" -eq 0 ] && [ "$http_num" -ge 200 ] && [ "$http_num" -lt 300 ] && jq -e '(.data.results // []) | type == "array"' "$body" >/dev/null 2>&1; then
    ok="true"
  fi

  if jq -e . "$body" >/dev/null 2>&1; then
    emit_success_or_server_error "$category" "$query" "$repeat" "$http_num" "$curl_exit" "$curl_time_ms" "$wall_ms" "$body" "$ok"
  else
    emit_failure "$category" "$query" "$repeat" "$http_num" "$curl_exit" "$curl_time_ms" "$wall_ms" "$body" "$err"
  fi

  if [ "$ok" = "true" ]; then
    printf "." >&2
  else
    printf "F" >&2
  fi
}

run_all_queries_once() {
  local repeat="$1" record="$2" category query rest
  while IFS=$'\t' read -r category query rest || [ -n "${category:-}" ]; do
    case "${category:-}" in
      ''|'#'*) continue ;;
    esac
    if [ -z "${query:-}" ]; then
      query="$category"
      category="uncategorized"
    elif [ -n "${rest:-}" ]; then
      query="$query	$rest"
    fi
    run_one "$category" "$query" "$repeat" "$record"
  done < <(query_order)
}

: > "$OUT"

if [ "$WARMUP" = "1" ]; then
  echo "warm-up: one unrecorded pass" >&2
  run_all_queries_once 0 0
fi

for repeat in $(seq 1 "$REPEATS"); do
  echo "run $repeat/$REPEATS batch=$BATCH" >&2
  run_all_queries_once "$repeat" 1
  echo >&2
done

echo "wrote $OUT" >&2
