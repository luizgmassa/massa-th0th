#!/bin/sh
# Shared helper: POST a lifecycle observation to the massa-th0th hook endpoint.
# Source this from the per-hook scripts after setting:
#   EVENT  — the lifecycle event kind
#   PROJECT_ID — the projectId (from env or cwd basename)
# The Claude Code hook payload is read from stdin as JSON and forwarded as the
# observation `payload`. Silent-degrade: never blocks the agent (exit 0, no
# stdout).
#
# Env:
#   MASSA_TH0TH_API_BASE  — API base URL (default http://localhost:3333)
#   MASSA_TH0TH_API_KEY   — optional API key (x-api-key header)
#   MASSA_TH0TH_PROJECT_ID — optional explicit projectId (else cwd basename)

_massa_th0th_base="${MASSA_TH0TH_API_BASE:-http://localhost:3333}"
_massa_th0th_url="$_massa_th0th_base/api/v1/hook"

# Read the Claude Code hook payload from stdin (JSON) — may be empty.
_massa_th0th_stdin=""
if [ -t 0 ]; then
  _massa_th0th_stdin="{}"
else
  _massa_th0th_stdin=$(cat)
fi
# If empty, use a minimal object.
[ -z "$_massa_th0th_stdin" ] && _massa_th0th_stdin="{}"

_massa_th0th_project="${MASSA_TH0TH_PROJECT_ID:-$(basename "$PWD")}"

# Build the observation body. Use a heredoc + a tiny jq-free JSON escape: we
# trust the host payload is already valid JSON (Claude Code emits JSON), so we
# only need to drop it verbatim into payload.
_massa_th0th_body=$(printf '{"event":"%s","projectId":"%s","payload":%s}' \
  "$EVENT" "$_massa_th0th_project" "$_massa_th0th_stdin")

# Silent-degrade: if curl is missing or the endpoint is down, just exit 0.
command -v curl >/dev/null 2>&1 || exit 0
curl -sS -m 2 -o /dev/null \
  -H "Content-Type: application/json" \
  ${MASSA_TH0TH_API_KEY:+-H "x-api-key: $MASSA_TH0TH_API_KEY"} \
  -X POST "$_massa_th0th_url" \
  --data "$_massa_th0th_body" >/dev/null 2>&1 || true
exit 0
