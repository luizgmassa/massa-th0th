#!/bin/sh
# Claude Code PreCompact hook → massa-th0th compaction snapshot.
#
# Emits a `pre-compact` lifecycle observation AND triggers the compact_snapshot
# endpoint to build a bounded, reference-based table-of-contents snapshot of
# the current session's observations. The snapshot provides zero-loss session
# continuity: raw events stay in the store; the snapshot just points to them.
#
# Claude Code passes the session id in the hook payload JSON on stdin.
# Silent-degrade: never blocks the agent (exit 0, no stdout).

_massa_th0th_base="${MASSA_TH0TH_API_BASE:-http://localhost:3333}"
_massa_th0th_project="${MASSA_TH0TH_PROJECT_ID:-$(basename "$PWD")}"

# Read the Claude Code hook payload from stdin (JSON) — may be empty.
_massa_th0th_stdin=""
if [ -t 0 ]; then
  _massa_th0th_stdin="{}"
else
  _massa_th0th_stdin=$(cat)
fi
[ -z "$_massa_th0th_stdin" ] && _massa_th0th_stdin="{}"

# Extract session id from the payload (Claude Code provides "session_id").
# Use a tiny sed/grep fallback if jq is unavailable.
_massa_th0th_session=""
if command -v jq >/dev/null 2>&1; then
  _massa_th0th_session=$(printf '%s' "$_massa_th0th_stdin" | jq -r '.session_id // .sessionId // ""' 2>/dev/null)
else
  _massa_th0th_session=$(printf '%s' "$_massa_th0th_stdin" | sed -n 's/.*"session_id"[: ]*"*\([^",}]*\).*/\1/p' 2>/dev/null)
fi
[ -z "$_massa_th0th_session" ] && _massa_th0th_session="unknown"

# 1. Emit the pre-compact lifecycle observation (backward-compatible with the
#    existing hook ingestion pipeline).
_massa_th0th_obs_body=$(printf '{"event":"pre-compact","projectId":"%s","sessionId":"%s","payload":%s}' \
  "$_massa_th0th_project" "$_massa_th0th_session" "$_massa_th0th_stdin")

command -v curl >/dev/null 2>&1 || exit 0
curl -sS -m 3 -o /dev/null \
  -H "Content-Type: application/json" \
  ${MASSA_TH0TH_API_KEY:+-H "x-api-key: $MASSA_TH0TH_API_KEY"} \
  -X POST "$_massa_th0th_base/api/v1/hook" \
  --data "$_massa_th0th_obs_body" >/dev/null 2>&1 || true

# 2. Trigger the compact_snapshot endpoint to build + persist the snapshot.
_massa_th0th_snap_body=$(printf '{"sessionId":"%s","projectId":"%s","persist":true}' \
  "$_massa_th0th_session" "$_massa_th0th_project")

curl -sS -m 5 -o /dev/null \
  -H "Content-Type: application/json" \
  ${MASSA_TH0TH_API_KEY:+-H "x-api-key: $MASSA_TH0TH_API_KEY"} \
  -X POST "$_massa_th0th_base/api/v1/hook/compact-snapshot" \
  --data "$_massa_th0th_snap_body" >/dev/null 2>&1 || true

exit 0
