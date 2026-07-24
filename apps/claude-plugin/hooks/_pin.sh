#!/bin/sh
# Shared helper: per-session project id pinning for massa-ai hook scripts.
#
# Source this AFTER stdin capture (single-read constraint — plan-critic C3),
# never before: this helper runs no stdin reads, but callers must have already
# consumed the hook payload so the POST body stays intact.
#
#   massa_ai_pin_project_id <session_id> <cwd>
#
# echoes the pinned project id. First event of a session computes the id
# (MASSA_AI_PROJECT_ID env override > git toplevel basename > cwd basename)
# and writes the pin file; later events of the same session read it back, so a
# hook fired from a subdirectory keeps the session's original attribution.
# Without a session id there is nothing to key on — the computed id is echoed
# without any pin I/O. Silent-degrade: git absence or pin-file failure falls
# back to the computed id; this helper never fails the caller.
#
# Pin files live under ${TMPDIR:-/tmp}/massa-ai-hooks/<sanitized-session_id>.

massa_ai_pin_project_id() {
  _mpin_session="$1"
  _mpin_cwd="$2"

  # Existing pin wins: read it back without recomputing. Sanitization is a
  # lossy but filesystem-safe encoding (distinct ids can collide; real Claude
  # session ids are UUIDs, so this is accepted). "." / ".." are skipped: they
  # name directories, never valid pin files.
  if [ -n "$_mpin_session" ]; then
    _mpin_dir="${TMPDIR:-/tmp}/massa-ai-hooks"
    _mpin_safe=$(printf '%s' "$_mpin_session" | tr -c 'A-Za-z0-9._-' '_')
    case "$_mpin_safe" in
      .|..) _mpin_file="" ;;
      *) _mpin_file="$_mpin_dir/$_mpin_safe" ;;
    esac
    if [ -n "$_mpin_file" ] && [ -f "$_mpin_file" ]; then
      _mpin_pinned=$(cat "$_mpin_file" 2>/dev/null)
      if [ -n "$_mpin_pinned" ]; then
        printf '%s' "$_mpin_pinned"
        return 0
      fi
    fi
  fi

  # Compute the candidate id: env override > git toplevel basename > cwd basename.
  _mpin_computed="${MASSA_AI_PROJECT_ID:-}"
  if [ -z "$_mpin_computed" ]; then
    _mpin_root=$(git -C "$_mpin_cwd" rev-parse --show-toplevel 2>/dev/null) || _mpin_root=""
    if [ -n "$_mpin_root" ]; then
      _mpin_computed=$(basename "$_mpin_root")
    else
      _mpin_computed=$(basename "$_mpin_cwd")
    fi
  fi

  # Pin for later events of this session (best effort). stderr is redirected
  # before stdout so a redirect-open failure (e.g. unwritable dir) stays silent.
  if [ -n "$_mpin_session" ] && [ -n "$_mpin_file" ]; then
    mkdir -p "$_mpin_dir" 2>/dev/null || true
    printf '%s' "$_mpin_computed" 2>/dev/null > "$_mpin_file" || true
  fi

  printf '%s' "$_mpin_computed"
  return 0
}
