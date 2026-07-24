#!/bin/sh
# Shared helper: POST a lifecycle observation to the massa-ai hook endpoint.
# Source this from the per-hook scripts after setting:
#   EVENT  — the lifecycle event kind
#   PROJECT_ID — the projectId (from env or cwd basename)
# The Claude Code hook payload is read from stdin as JSON and forwarded as the
# observation `payload`. The session id is lifted from the payload to the
# top-level `sessionId` field so rows are session-scoped (NULL when absent).
# Silent-degrade: never blocks the agent (exit 0, no stdout).
#
# Env:
#   MASSA_AI_API_BASE  — API base URL (default http://localhost:3333)
#   MASSA_AI_API_KEY   — optional API key (x-api-key header)
#   MASSA_AI_PROJECT_ID — optional explicit projectId (else git toplevel
#                             basename, else cwd basename; pinned per session)

_massa_ai_base="${MASSA_AI_API_BASE:-http://localhost:3333}"
_massa_ai_url="$_massa_ai_base/api/v1/hook"

# Read the Claude Code hook payload from stdin (JSON) — may be empty.
_massa_ai_raw=""
if [ -t 0 ]; then
  _massa_ai_raw=""
else
  _massa_ai_raw=$(cat)
fi

# Lift the session id to the top-level `sessionId` field. Claude Code sends
# "session_id"; accept "sessionId" too. jq preferred, sed fallback otherwise.
_massa_ai_session=""
if [ -n "$_massa_ai_raw" ] && command -v jq >/dev/null 2>&1; then
  _massa_ai_session=$(printf '%s' "$_massa_ai_raw" | jq -r '.session_id // .sessionId // ""' 2>/dev/null)
elif [ -n "$_massa_ai_raw" ]; then
  _massa_ai_session=$(printf '%s' "$_massa_ai_raw" | sed -n 's/.*"session_id"[: ]*"*\([^",}]*\).*/\1/p' 2>/dev/null)
fi

# Whitespace-stripped copy for the emptiness check + payload embed. When there
# is no payload (interactive TTY, empty stdin, or whitespace only), skip the
# POST entirely: the server rejects an empty payload object
# ("payload must be a non-empty object" → 400), and a fire-and-forget hook
# has nothing useful to record without one. Exit 0 so the agent is never blocked.
_massa_ai_stdin=$(printf '%s' "$_massa_ai_raw" | tr -d '[:space:]')
[ -z "$_massa_ai_stdin" ] && exit 0

# Resolve the project id through the per-session pin (M45/HAR-04). This runs
# AFTER the stdin capture above — the pin helper never touches stdin, and the
# POST body must stay intact (single-read constraint). A missing helper falls
# back to today's env/basename behavior so silent-degrade is preserved.
_massa_ai_pin_lib="$(dirname "$0")/_pin.sh"
if [ -f "$_massa_ai_pin_lib" ]; then
  . "$_massa_ai_pin_lib"
  _massa_ai_project=$(massa_ai_pin_project_id "$_massa_ai_session" "$PWD")
else
  _massa_ai_project="${MASSA_AI_PROJECT_ID:-$(basename "$PWD")}"
fi

# Conditionally include the top-level sessionId field. Omit it entirely when
# absent so the server stores NULL (preserves prior behavior for payloads
# without a session id, rather than storing an empty string).
_massa_ai_session_field=""
if [ -n "$_massa_ai_session" ]; then
  _massa_ai_session_field=$(printf ',"sessionId":"%s"' "$_massa_ai_session")
fi

# Build the observation body. We trust the host payload is already valid JSON
# (Claude Code emits JSON), so we only need to drop it verbatim into payload.
_massa_ai_body=$(printf '{"event":"%s","projectId":"%s"%s,"payload":%s}' \
  "$EVENT" "$_massa_ai_project" "$_massa_ai_session_field" "$_massa_ai_stdin")

# Silent-degrade: if curl is missing or the endpoint is down, just exit 0.
command -v curl >/dev/null 2>&1 || exit 0
curl -sS -m 2 -o /dev/null \
  -H "Content-Type: application/json" \
  ${MASSA_AI_API_KEY:+-H "x-api-key: $MASSA_AI_API_KEY"} \
  -X POST "$_massa_ai_url" \
  --data "$_massa_ai_body" >/dev/null 2>&1 || true
exit 0
