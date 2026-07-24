#!/usr/bin/env bash
# ============================================================
#  massa-ai - Shared CLI utilities
#  Source this file from other scripts — do not run directly.
#
#  Usage:
#    source "$(dirname "${BASH_SOURCE[0]}")/banner.sh"
#    massa_ai_banner
# ============================================================

# ── Colours ──────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'
NC='\033[0m'

# ── Helpers ───────────────────────────────────────────────────
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✗${NC} $*" >&2; }
info() { echo -e "  ${BLUE}•${NC} $*"; }
die()  { err "$*"; exit 1; }

# ── Version detection ─────────────────────────────────────────
# Resolves project root from the location of this file (scripts/).
_MASSA_AI_BANNER_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd 2>/dev/null)"

_massa_ai_detect_version() {
  [ -n "${MASSA_AI_VERSION:-}" ] && return
  local pkg="${_MASSA_AI_BANNER_ROOT}/package.json"
  if [ -f "$pkg" ]; then
    if command -v node &>/dev/null; then
      MASSA_AI_VERSION="$(node -e "process.stdout.write(require('${pkg}').version)" 2>/dev/null)"
    elif command -v python3 &>/dev/null; then
      MASSA_AI_VERSION="$(python3 -c "import json; print(json.load(open('${pkg}'))['version'],end='')" 2>/dev/null)"
    elif command -v jq &>/dev/null; then
      MASSA_AI_VERSION="$(jq -r .version "${pkg}" 2>/dev/null)"
    fi
  fi
  MASSA_AI_VERSION="${MASSA_AI_VERSION:-?}"
}

# ── Banner ────────────────────────────────────────────────────
massa_ai_banner() {
  _massa_ai_detect_version
  cat << EOF

              ██             ██████               ██
    ███       ██          ███    ██     ███       ██
   ░████      ██  ██      ███      █    ████      ██  ██
  ███████     ████████   ███       █  ███████     ████████
    ███       ██   ███   ███       █    ███       ██   ███
    ███       ██    ██   ███      ██    ███       ██    ██
    ███   █   ██    ██    ████   ███    ███   █   ██    ██
    ███████  ███   ████    ████████     ███████░ ████  ████
     ░████  █████  █████    █████         ████   ████░ █████

   Context, memory and cross-agent management.  v${MASSA_AI_VERSION}
   https://github.com/luizgmassa/massa-ai

EOF
}
