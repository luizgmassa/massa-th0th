#!/usr/bin/env bash
# ============================================================
#  massa-th0th - Installer
#  https://github.com/luizgmassa/massa-th0th
#
#  Usage:
#    curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-th0th/main/install.sh | bash
#
#  Environment overrides (export before piping):
#    MASSA_TH0TH_MODE=docker|build|source   Installation mode (default: source)
#    MASSA_TH0TH_DIR=/path/to/install        Where to install (default: ~/.massa-th0th)
#    MASSA_TH0TH_API_PORT=3333               API port
#    MASSA_TH0TH_POSTGRES_PORT=5432          PostgreSQL port
#    POSTGRES_PASSWORD=<pass>          DB password (default: massa_th0th_password)
#    OLLAMA_BASE_URL=http://...        Override Ollama URL
#    MASSA_TH0TH_BRANCH=main                 Git branch (source/build mode)
#    MASSA_TH0TH_NO_START=1                  Skip starting services after install
# ============================================================

set -e

# ── Colours ──────────────────────────────────────────────────
BOLD='\033[1m'; DIM='\033[2m'
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BLUE='\033[0;34m'; CYAN='\033[0;36m'
NC='\033[0m'
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC}  $*"; }
err()  { echo -e "  ${RED}✗${NC} $*" >&2; }
info() { echo -e "  ${BLUE}•${NC} $*"; }
die()  { err "$*"; exit 1; }

# ── Version detection ─────────────────────────────────────────
# Fetches version from GitHub (non-blocking — shows "latest" on failure).
# install.sh runs before any local clone exists, so we can't source banner.sh.
_MASSA_TH0TH_INSTALLER_VERSION="$(curl -fsSL --max-time 3 \
  "https://raw.githubusercontent.com/${GITHUB_REPO:-luizgmassa/massa-th0th}/main/package.json" \
  2>/dev/null \
  | grep '"version"' | head -1 \
  | sed 's/.*"version"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/' \
  || echo "latest")"

# ── Banner ────────────────────────────────────────────────────
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

   Context, memory and cross-agent management.  v${_MASSA_TH0TH_INSTALLER_VERSION}
   https://github.com/luizgmassa/massa-th0th

EOF

# ── Constants ─────────────────────────────────────────────────
GITHUB_REPO="luizgmassa/massa-th0th"
GITHUB_RAW="https://raw.githubusercontent.com/${GITHUB_REPO}"
GITHUB_URL="https://github.com/${GITHUB_REPO}"
# Docker Hub org is the lowercase GitHub owner (Docker requires lowercase).
_DOCKER_ORG=$(echo "${GITHUB_REPO%%/*}" | tr '[:upper:]' '[:lower:]')
DOCKER_API_IMAGE="${_DOCKER_ORG}/massa-th0th:api-latest"
DOCKER_MCP_IMAGE="${_DOCKER_ORG}/massa-th0th:mcp-latest"

# ── Config (overridable via env) ──────────────────────────────
MODE="${MASSA_TH0TH_MODE:-}"
INSTALL_DIR="${MASSA_TH0TH_DIR:-$HOME/.massa-th0th}"
API_PORT="${MASSA_TH0TH_API_PORT:-3333}"
POSTGRES_PORT="${MASSA_TH0TH_POSTGRES_PORT:-5432}"
DB_PASS="${POSTGRES_PASSWORD:-massa_th0th_password}"
BRANCH="${MASSA_TH0TH_BRANCH:-main}"
NO_START="${MASSA_TH0TH_NO_START:-0}"
OLLAMA_URL="${OLLAMA_BASE_URL:-}"  # auto-detected below if empty

# ── Helpers ───────────────────────────────────────────────────
require_cmd() {
  command -v "$1" &>/dev/null || die "'$1' is required but not installed. $2"
}

port_available() {
  ! (ss -tuln 2>/dev/null | grep -q ":$1 ") && \
  ! (netstat -tuln 2>/dev/null | grep -q ":$1 ")
}

find_free_port() {
  local port="$1"
  while ! port_available "$port"; do
    port=$((port + 1))
  done
  echo "$port"
}

detect_os() {
  case "$(uname -s)" in
    Linux*)
      if grep -qi microsoft /proc/version 2>/dev/null; then echo "wsl"
      else echo "linux"; fi ;;
    Darwin*) echo "macos" ;;
    *)       echo "unknown" ;;
  esac
}

detect_ollama_url() {
  # Already set via env
  [ -n "$OLLAMA_URL" ] && { echo "$OLLAMA_URL"; return; }

  local candidates=()
  local os; os=$(detect_os)

  # Docker: use host gateway
  if [ "$1" = "docker" ]; then
    candidates+=("http://host.docker.internal:11434")
  fi

  # WSL: try Windows host IP first.
  # Prefer the eth0 default gateway (always the WSL2→Windows bridge) over the
  # /etc/resolv.conf nameserver, which Docker can rewrite to its own bridge IP.
  if [ "$os" = "wsl" ]; then
    local eth0_gw; eth0_gw=$(ip route show 2>/dev/null \
        | awk '/^default/ && $5 == "eth0" {print $3; exit}')
    if [ -n "$eth0_gw" ]; then
      candidates+=("http://${eth0_gw}:11434")
    fi
    # Also add the resolv.conf nameserver as a secondary candidate.
    local resolv_ip; resolv_ip=$(grep nameserver /etc/resolv.conf 2>/dev/null \
        | awk '{print $2}' | head -1)
    [ -n "$resolv_ip" ] && [ "$resolv_ip" != "$eth0_gw" ] \
        && candidates+=("http://${resolv_ip}:11434")
  fi

  # Local fallback
  candidates+=("http://localhost:11434")

  for url in "${candidates[@]}"; do
    if curl -sf --connect-timeout 2 "${url}/api/tags" &>/dev/null; then
      echo "$url"; return
    fi
  done

  echo "http://localhost:11434"  # best guess
}

# ── Mode selection ────────────────────────────────────────────
select_mode() {
  echo -e "${BOLD}Installation mode:${NC}"                               >&2
  echo ""                                                                 >&2
  # Option 1 (Docker pull) is intentionally hidden — code preserved below.
  # echo -e "  ${CYAN}1)${NC} ${BOLD}Docker${NC} ${DIM}(recommended)${NC}" >&2
  # echo -e "     Pull pre-built images from DockerHub. Requires Docker only." >&2
  # echo ""                                                                 >&2
  echo -e "  ${CYAN}1)${NC} ${BOLD}From source${NC}"                     >&2
  echo -e "     Clone the repo and run with Bun. Pick Native PostgreSQL (~100MB) or Docker PostgreSQL at setup." >&2
  echo ""                                                                 >&2
  echo -e "  ${CYAN}2)${NC} ${BOLD}Docker build${NC}"                    >&2
  echo -e "     Clone the repo and build Docker images locally (PostgreSQL via Docker/colima, ~5GB RAM)." >&2
  echo ""                                                                 >&2
  read -rp "  Enter your choice [1]: " choice <>/dev/tty
  case "${choice:-1}" in
    1) echo "source" ;;
    2) echo "build"  ;;
    *) echo "source" ;;
  esac
}

# ── Install directory prompt (source mode) ────────────────────
# Lets the user pick where massa-th0th is cloned. Honours MASSA_TH0TH_DIR
# (already in $INSTALL_DIR) as a non-interactive override; otherwise prompts
# with a default and validates the path before proceeding.
prompt_install_dir() {
  if [ -n "${MASSA_TH0TH_DIR:-}" ]; then
    ok "Using install dir from MASSA_TH0TH_DIR: ${INSTALL_DIR}"
    echo "$INSTALL_DIR"
    return
  fi

  local default="$HOME/.massa-th0th"
  local input parent confirm
  while true; do
    echo -e "${BOLD}Clone path:${NC}" >&2
    echo -e "  ${DIM}Where to clone massa-th0th. Press ENTER for: ${default}${NC}" >&2
    read -rp "  Path [${default}]: " input <>/dev/tty
    input="${input:-$default}"

    # Normalize: expand a leading ~, strip trailing slash, absolutize relative paths.
    input="${input/#\~/$HOME}"
    input="${input%/}"
    case "$input" in
      /*) ;;
      *) input="$PWD/$input" ;;
    esac

    # Parent directory must exist and be writable (so the target can be created).
    parent="$(dirname "$input")"
    if [ ! -d "$parent" ] || [ ! -w "$parent" ]; then
      err "Parent directory '${parent}' does not exist or is not writable."
      continue
    fi

    # An existing non-empty target is fine if it's a git repo (we'll pull);
    # otherwise confirm before reusing it.
    if [ -d "$input" ] && [ -n "$(ls -A "$input" 2>/dev/null)" ]; then
      if [ -d "$input/.git" ]; then
        ok "Existing git repo at ${input} — will pull latest"
      else
        warn "'${input}' exists and is not empty (not a git repo)."
        read -rp "  Use this path anyway? [y/N]: " confirm <>/dev/tty
        case "${confirm:-n}" in y|Y) ;; *) continue ;; esac
      fi
    fi

    echo "$input"
    return
  done
}

# ── Preflight ─────────────────────────────────────────────────
preflight_docker() {
  require_cmd docker  "Install Docker: https://docs.docker.com/get-docker/"
  docker info &>/dev/null || die "Docker daemon is not running. Start Docker and retry."
  ok "Docker $(docker --version | awk '{print $3}' | tr -d ',')"
  warn "Docker mode runs PostgreSQL through colima + Docker (~5GB RAM). For a lighter native PostgreSQL, use Source mode + Native PostgreSQL."
}

preflight_bun() {
  if ! command -v bun &>/dev/null; then
    warn "Bun not found — installing..."
    curl -fsSL https://bun.sh/install | bash
    export PATH="$HOME/.bun/bin:$PATH"
  fi
  ok "Bun $(bun --version)"
}

preflight_git() {
  require_cmd git "Install git: https://git-scm.com/"
  ok "Git $(git --version | awk '{print $3}')"
}

check_ollama() {
  local url="$1"
  if curl -sf --connect-timeout 2 "${url}/api/tags" &>/dev/null; then
    ok "Ollama reachable at ${url}"
    return 0
  else
    warn "Ollama not reachable at ${url}"
    warn "Start Ollama before using massa-th0th, or set OLLAMA_BASE_URL."
    return 1
  fi
}

# Echo success (0) iff $1 (model tag) is present in Ollama's /api/tags at $2.
# Used to auto-enable LLM-gated features only when the model is actually pulled,
# not merely when the server is reachable.
ollama_has_model() {
  local model="$1" url="$2"
  [ -z "$url" ] && return 1
  local esc_model="${model//./\\.}"
  curl -sf --connect-timeout 2 "${url}/api/tags" 2>/dev/null \
    | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"${esc_model}\""
}

# Interactively offer the LLM search-quality toggles. Both run synchronously on
# every search, so they stay opt-in. Only prompts when the install is
# interactive (NO_START != 1) AND the LLM model is present (llm_on=true);
# otherwise keeps defaults false. Sets globals SEARCH_QU_ENABLED and
# SEARCH_RERANK_ENABLED. <>/dev/tty is required because install runs under
# `curl | bash`, where stdin is the curl pipe.
prompt_search_quality_flags() {
  local llm_on="$1"
  SEARCH_QU_ENABLED=false
  SEARCH_RERANK_ENABLED=false
  [ "$NO_START" = "1" ] && return
  [ "$llm_on" != "true" ] && return

  echo ""
  echo -e "${BOLD}LLM search-quality features (optional, off by default)${NC}"
  echo -e "${DIM}Both run synchronously on every search and add LLM latency.${NC}"
  echo ""

  echo -e "  ${BOLD}Query understanding${NC} — rewrites your query (+ HyDE) before retrieval for"
  echo -e "  ${DIM}better recall. Risk: +1-2 LLM calls per unique query (2-10s on a local CPU);${NC}"
  echo -e "  ${DIM}a bad rewrite can reduce recall. Cached 5min/256 entries.${NC}"
  read -rp "  Enable query understanding? [y/N]: " _qu <>/dev/tty
  case "${_qu:-n}" in y|Y|yes|YES) SEARCH_QU_ENABLED=true ;; esac
  echo ""

  echo -e "  ${BOLD}Rerank${NC} — re-orders the top 50 results by LLM relevance after retrieval."
  echo -e "  ${DIM}Risk: +1 LLM call per search (~1-5s local); subjective reorder of the same${NC}"
  echo -e "  ${DIM}result set (tail preserved).${NC}"
  read -rp "  Enable rerank? [y/N]: " _rr <>/dev/tty
  case "${_rr:-n}" in y|Y|yes|YES) SEARCH_RERANK_ENABLED=true ;; esac
  echo ""
}

# ── .env writer ───────────────────────────────────────────────
load_installer_env_transaction() {
  local dir="$1"
  local helper="${dir}/scripts/lib/installer-env-transaction.sh"
  local fetched_helper=""
  if ! declare -F installer_env_publish >/dev/null 2>&1; then
    if [ -r "$helper" ]; then
      # shellcheck source=scripts/lib/installer-env-transaction.sh
      source "$helper"
    else
      fetched_helper="$(mktemp "${dir}/.installer-env-transaction.XXXXXX")"
      curl -fsSL "${GITHUB_RAW}/${BRANCH}/scripts/lib/installer-env-transaction.sh" \
        -o "$fetched_helper" || {
          rm -f "$fetched_helper"
          die "Failed to load race-safe .env transaction helper"
        }
      # shellcheck source=/dev/null
      source "$fetched_helper"
      rm -f "$fetched_helper"
    fi
  fi
}

write_env() {
  local dir="$1"
  local ollama_url="$2"
  local db_url="$3"
  # Optional: override image names (default to Docker Hub constants)
  local api_image="${4:-$DOCKER_API_IMAGE}"
  local mcp_image="${5:-$DOCKER_MCP_IMAGE}"
  local env_file="${dir}/.env"
  local had_env=false
  if [ -e "$env_file" ] || [ -L "$env_file" ]; then
    had_env=true
  fi
  load_installer_env_transaction "$dir"

  # Auto-enable LLM-gated features only when the configured model is actually
  # pulled in Ollama. Reachable-but-missing-model would make consolidation and
  # auto-importance call a 404 instead of taking the rule-based silent-degrade
  # path (which only applies when the flag is false). Search rerank and query
  # understanding stay off — they're latency-sensitive and a separate opt-in.
  local llm_model="qwen2.5:7b-instruct"
  local llm_code_model="qwen2.5-coder:7b"
  local llm_enabled=false
  if ollama_has_model "$llm_model" "$ollama_url"; then
    llm_enabled=true
    ok "LLM consolidation + auto-importance auto-enabled (${llm_model} detected at ${ollama_url})"
  else
    info "LLM features off — pull the model to enable: ollama pull ${llm_model}"
  fi
  if ! ollama_has_model "$llm_code_model" "$ollama_url"; then
    info "Code-oriented LLM sites off — pull the model to enable: ollama pull ${llm_code_model}"
  else
    ok "Code-oriented LLM sites available (${llm_code_model} detected at ${ollama_url})"
  fi

  prompt_search_quality_flags "$llm_enabled"
  local qu_enabled="${SEARCH_QU_ENABLED:-false}"
  local rerank_enabled="${SEARCH_RERANK_ENABLED:-false}"

  installer_env_publish "$env_file" << ENVEOF
# massa-th0th - generated by install.sh
# Edit this file to customise your installation.

# ── API ──────────────────────────────────────────────────────
MASSA_TH0TH_API_PORT=${API_PORT}
MASSA_TH0TH_API_IMAGE=${api_image}
MASSA_TH0TH_MCP_IMAGE=${mcp_image}
NODE_ENV=production

# ── Database ─────────────────────────────────────────────────
POSTGRES_PASSWORD=${DB_PASS}
MASSA_TH0TH_POSTGRES_PORT=${POSTGRES_PORT}
DATABASE_URL=${db_url}

# ── Embeddings (Ollama - local, free) ────────────────────────
OLLAMA_BASE_URL=${ollama_url}
OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b
OLLAMA_EMBEDDING_DIMENSIONS=4096

# ── Optional: Cloud embedding providers ─────────────────────
#EMBEDDING_PROVIDER=google
#GOOGLE_GENERATIVE_AI_API_KEY=your_key_here
#MISTRAL_API_KEY=your_key_here

# ── Logging ──────────────────────────────────────────────────
LOG_LEVEL=info
ENABLE_METRICS=true

# ── Local-first LLM (Ollama); default OFF, silent degrade ──
# Auto-set ON by install.sh only when qwen2.5:7b-instruct is pulled in Ollama.
RLM_LLM_ENABLED=${llm_enabled}
RLM_LLM_BASE_URL=http://localhost:11434/v1
RLM_LLM_API_KEY=ollama
RLM_LLM_MODEL=${llm_model}
RLM_LLM_CODE_MODEL=${llm_code_model}
RLM_LLM_TEMPERATURE=0.2
RLM_LLM_MAX_OUTPUT_TOKENS=8000
RLM_LLM_TIMEOUT_MS=90000

# ── Passive capture ───────────────────────────────────────────
HOOKS_ENABLED=true
HOOKS_MAX_PAYLOAD_BYTES=65536
HOOKS_QUEUE_MAX_PENDING=256
HOOKS_BRIDGE_ENABLED=true
HOOKS_BRIDGE_MIN_OBS=8
HOOKS_BRIDGE_MIN_INTERVAL_MS=300000
HOOKS_BRIDGE_MAX_WINDOW=8

# ── Cross-session handoffs ────────────────────────────────────
HANDOFFS_ENABLED=true

# ── Project bootstrap ─────────────────────────────────────────
BOOTSTRAP_ENABLED=true
BOOTSTRAP_MAX_SEED_MEMORIES=8
BOOTSTRAP_CENTRALITY_LIMIT=10
BOOTSTRAP_GIT_LOG_LIMIT=20
BOOTSTRAP_REFRESH_ENABLED=true

# ── Auto-improvement (reviewGate=false = auto-approve) ────────
AUTO_IMPROVE_ENABLED=true
AUTO_IMPROVE_REVIEW_GATE=false
AUTO_IMPROVE_MIN_OBS=8
AUTO_IMPROVE_MIN_INTERVAL_MS=300000
AUTO_IMPROVE_MAX_WINDOW=16
AUTO_IMPROVE_MIN_QUERY_HITS=3
AUTO_IMPROVE_MIN_FILE_HITS=3
AUTO_IMPROVE_MIN_FIX_HITS=2

# ── Auto importance/salience (LLM) ────────────────────────────
# Auto-set ON by install.sh only when qwen2.5:7b-instruct is pulled in Ollama.
AUTO_IMPORTANCE_ENABLED=${llm_enabled}

# ── Search quality knobs ──────────────────────────────────────
# Query understanding + rerank are chosen interactively at install (off unless
# the LLM model is present and you opt in); both add latency on every search.
SEARCH_QUERY_UNDERSTANDING_ENABLED=${qu_enabled}
SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED=true
SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS=300000
SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE=256
SEARCH_RERANK_ENABLED=${rerank_enabled}
SEARCH_RERANK_WINDOW=50
AUTOREINDEX_MAX_FILES=200

# ── Web UI (served by Tools API at /ui) ───────────────────────
WEB_UI_ENABLED=true
ENVEOF

  if [ "$had_env" = "true" ]; then
    warn "Backed up existing .env → ${env_file}.bak (regenerating)"
  fi
  ok "Created .env at ${env_file}"
}

# ── docker-compose.yml downloader ────────────────────────────
fetch_compose() {
  local dir="$1"
  local compose_file="${dir}/docker-compose.yml"

  if [ -f "$compose_file" ]; then
    ok "docker-compose.yml already exists"
    return
  fi

  echo -e "  Downloading docker-compose.yml..."
  curl -fsSL "${GITHUB_RAW}/${BRANCH}/docker-compose.yml" -o "$compose_file" \
    || die "Failed to download docker-compose.yml from ${GITHUB_URL}"
  ok "docker-compose.yml downloaded"
}

# ── Port conflict resolution ──────────────────────────────────
resolve_ports() {
  if ! port_available "$API_PORT"; then
    warn "Port ${API_PORT} is in use — finding next available..."
    API_PORT=$(find_free_port $((API_PORT + 1)))
    info "Using API port: ${API_PORT}"
  fi
  if ! port_available "$POSTGRES_PORT"; then
    warn "Port ${POSTGRES_PORT} is in use — finding next available..."
    POSTGRES_PORT=$(find_free_port $((POSTGRES_PORT + 1)))
    info "Using PostgreSQL port: ${POSTGRES_PORT}"
  fi
}

# ── Post-install optional setup scripts ──────────────────────
# Prints (never auto-writes) the passive-capture hooks guide for Claude Code,
# Codex, and Cursor. Printing avoids clobbering the user's existing hook config
# (.claude/settings.json, ~/.codex/hooks.json, ~/.cursor/hooks.json). The 5 hook
# scripts are platform-neutral shells that POST observations to the API; only the
# config wrapper differs per platform.
print_hooks_guide() {
  local mode="$1"
  local install_dir="$2"
  local hooks_dir="${install_dir}/apps/claude-plugin/hooks"

  echo ""
  echo -e "${BOLD}Passive-capture hooks (Claude Code · Codex · Cursor)${NC}"
  echo -e "${DIM}Fire-and-forget scripts POST observations to the API with a 2s timeout${NC}"
  echo -e "${DIM}and always exit 0 — they never block the agent. The same 5 shell scripts${NC}"
  echo -e "${DIM}serve all 3 platforms; only the config wrapper differs.${NC}"
  echo ""

  if [ "$mode" = "docker" ]; then
    # Docker mode may not have cloned the repo locally, so point at GitHub raw
    # URLs and the platform-neutral batch endpoint.
    echo -e "  ${BOLD}Hook scripts (raw, any platform):${NC}"
    for s in session-start.sh user-prompt-submit.sh post-tool-use.sh stop.sh pre-compact.sh; do
      echo -e "    ${GITHUB_RAW}/${BRANCH}/apps/claude-plugin/hooks/${s}"
    done
    echo ""
    echo -e "  ${DIM}Or skip the scripts and POST directly (works from any platform hook):${NC}"
    echo -e "    curl -X POST ${MASSA_TH0TH_API_BASE:-http://localhost:3333}/api/v1/hook/batch \\"
    echo -e "      -H 'Content-Type: application/json' \\"
    echo -e "      -d '{\"events\":[{\"event\":\"user-prompt\",\"projectId\":\"my-proj\",\"payload\":{}}]}'"
    echo ""
    return
  fi

  # source/build: repo is cloned locally — emit per-platform config blocks with
  # absolute script paths. Paths are inner-quoted so install dirs containing
  # spaces still exec cleanly.
  echo -e "  ${DIM}Scripts live at: ${hooks_dir}/${NC}"
  echo ""

  # ── Claude Code (nested matcher-group + hooks[] form) ──
  echo -e "  ${BOLD}Claude Code — merge into .claude/settings.json (or ~/.claude/settings.json):${NC}"
  echo ""
  echo -e '  {'
  echo -e '    "hooks": {'
  echo -e "      \"SessionStart\":     [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/session-start.sh\\\"\" }] }],"
  echo -e "      \"UserPromptSubmit\": [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/user-prompt-submit.sh\\\"\" }] }],"
  echo -e "      \"PostToolUse\":      [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/post-tool-use.sh\\\"\" }] }],"
  echo -e "      \"Stop\":             [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/stop.sh\\\"\" }] }],"
  echo -e "      \"PreCompact\":       [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/pre-compact.sh\\\"\" }] }]"
  echo -e '    }'
  echo -e '  }'
  echo ""

  # ── Codex (same nested form; supports UserPromptSubmit too) ──
  echo -e "  ${BOLD}Codex — save as ~/.codex/hooks.json (or inline [hooks] in ~/.codex/config.toml):${NC}"
  echo ""
  echo -e '  {'
  echo -e '    "hooks": {'
  echo -e "      \"SessionStart\":     [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/session-start.sh\\\"\" }] }],"
  echo -e "      \"UserPromptSubmit\": [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/user-prompt-submit.sh\\\"\" }] }],"
  echo -e "      \"PostToolUse\":      [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/post-tool-use.sh\\\"\" }] }],"
  echo -e "      \"Stop\":             [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/stop.sh\\\"\" }] }],"
  echo -e "      \"PreCompact\":       [{ \"hooks\": [{ \"type\": \"command\", \"command\": \"\\\"${hooks_dir}/pre-compact.sh\\\"\" }] }]"
  echo -e '    }'
  echo -e '  }'
  echo -e "  ${DIM}Then run /hooks in Codex to review and trust each hook — non-managed hooks${NC}"
  echo -e "  ${DIM}are skipped until trusted.${NC}"
  echo ""

  # ── Cursor (flat, camelCase; beta) ──
  echo -e "  ${BOLD}Cursor — save as ~/.cursor/hooks.json (or project .cursor/hooks.json):${NC}"
  echo ""
  echo -e "  ${DIM}Cursor now supports 7 events (sessionStart, sessionEnd, beforeSubmitPrompt,${NC}"
  echo -e "  ${DIM}preToolUse, postToolUse, preCompact, stop). The canonical path is the plugin${NC}"
  echo -e "  ${DIM}installer, which auto-wires all 7:${NC}"
  echo -e "    ${CYAN}bash ${install_dir}/apps/cursor-plugin/install.sh --user${NC}  (or --project)"
  echo ""
  echo -e "  ${DIM}Manual hooks.json shape (commands point at the shared binary; the plugin${NC}"
  echo -e "  ${DIM}installer generates this for you with absolute paths):${NC}"
  echo -e '  {'
  echo -e '    "version": 1,'
  echo -e '    "hooks": {'
  echo -e "      \"sessionStart\":         [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook session-start\\\"\" }],"
  echo -e "      \"sessionEnd\":           [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook stop\\\"\" }],"
  echo -e "      \"beforeSubmitPrompt\":   [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook user-prompt-submit\\\"\" }],"
  echo -e "      \"preToolUse\":           [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook pre-tool-use\\\"\" }],"
  echo -e "      \"postToolUse\":          [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook post-tool-use\\\"\" }],"
  echo -e "      \"preCompact\":           [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook pre-compact\\\"\" }],"
  echo -e "      \"stop\":                 [{ \"command\": \"\\\"${hooks_dir}/massa-th0th-hook stop\\\"\" }]"
  echo -e '    }'
  echo -e '  }'
  echo ""

  echo -e "  ${BOLD}Env vars (set in your shell or .env; all platforms):${NC}"
  echo -e "    ${CYAN}MASSA_TH0TH_API_BASE${NC}   default http://localhost:3333"
  echo -e "    ${CYAN}MASSA_TH0TH_API_KEY${NC}    optional (x-api-key header)"
  echo -e "    ${CYAN}MASSA_TH0TH_PROJECT_ID${NC} optional (defaults to cwd basename)"
  echo ""
  echo -e "  ${DIM}Observations are stored in PostgreSQL and consolidated into${NC}"
  echo -e "  ${DIM}memories only when RLM_LLM_ENABLED=true (otherwise stored raw).${NC}"
  echo ""
}

post_install() {
  local mode="$1"
  local install_dir="$2"

  [ "$NO_START" = "1" ] && return  # services not running — skip interactive steps

  local scripts_dir="${install_dir}/scripts"
  local wsl_script="${install_dir}/apps/tools-api/setup-ollama-wsl.sh"

  # Docker mode: only docker-compose.yml was downloaded; fetch scripts from GitHub
  if [ "$mode" = "docker" ]; then
    mkdir -p "${scripts_dir}" "${install_dir}/apps/tools-api"
    local need_fetch=false
    for s in banner.sh setup-vscode.sh validate-vscode-integration.sh; do
      [ -f "${scripts_dir}/${s}" ] || need_fetch=true && break
    done
    if [ "$need_fetch" = true ]; then
      info "Fetching setup scripts from GitHub..."
      for s in banner.sh setup-vscode.sh validate-vscode-integration.sh; do
        curl -fsSL --silent "${GITHUB_RAW}/${BRANCH}/scripts/${s}" \
          -o "${scripts_dir}/${s}" 2>/dev/null || true
      done
      curl -fsSL --silent \
        "${GITHUB_RAW}/${BRANCH}/apps/tools-api/setup-ollama-wsl.sh" \
        -o "$wsl_script" 2>/dev/null || true
      chmod +x "${scripts_dir}"/*.sh "$wsl_script" 2>/dev/null || true
    fi
  fi

  local os; os=$(detect_os)

  while true; do
    echo ""
    echo -e "${BOLD}Optional setup steps:${NC}"
    echo ""
    if [ "$os" = "wsl" ] && [ -f "$wsl_script" ]; then
      echo -e "  ${CYAN}w)${NC} Setup Ollama for WSL (Windows host connectivity)"
    fi
    if [ -f "${scripts_dir}/setup-vscode.sh" ]; then
      echo -e "  ${CYAN}v)${NC} Configure VSCode / Antigravity MCP integration"
    fi
    if [ -f "${scripts_dir}/validate-vscode-integration.sh" ]; then
      echo -e "  ${CYAN}t)${NC} Run integration tests"
    fi
    echo -e "  ${CYAN}c)${NC} Configure passive-capture hooks (Claude Code, Codex, Cursor)"
    echo -e "  ${CYAN}p)${NC} Install massa-th0th plugins (Claude, Codex, Cursor, OpenCode)"
    echo -e "  ${CYAN}s)${NC} Skip (finish)"
    echo ""

    read -rp "  Choice [s]: " _post_choice <>/dev/tty
    case "${_post_choice:-s}" in
      w|W)
        [ -f "$wsl_script" ] && bash "$wsl_script" || warn "WSL setup script not found" ;;
      v|V)
        [ -f "${scripts_dir}/setup-vscode.sh" ] \
          && bash "${scripts_dir}/setup-vscode.sh" \
          || warn "VSCode setup script not found" ;;
      t|T)
        [ -f "${scripts_dir}/validate-vscode-integration.sh" ] \
          && bash "${scripts_dir}/validate-vscode-integration.sh" \
          || warn "Validation script not found" ;;
      c|C)
        print_hooks_guide "$mode" "$install_dir" ;;
      p|P)
        install_plugins_menu "$install_dir" ;;
      s|S|"") return ;;
      *) warn "Unknown choice. Enter w, v, t, c, p, or s." ;;
      # NOTE: prompt text kept stable for existing root-install-menu test.
    esac
  done
}

# ── massa-th0th plugin installer sub-menu (four-plugin parity) ───────────────
# The per-plugin installers source scripts/banner.sh relative to their own
# location, so invoke them as bash <path> --user. Default to --user because the
# root install.sh doesn't track whether the user installed at project scope.
# OpenCode is an npm plugin (no install.sh) — its option prints install + config
# instructions instead of invoking a script.
install_plugins_menu() {
  local install_dir="$1"
  local claude_installer="${install_dir}/apps/claude-plugin/install.sh"
  local codex_installer="${install_dir}/apps/codex-plugin/install.sh"
  local cursor_installer="${install_dir}/apps/cursor-plugin/install.sh"

  while true; do
    echo ""
    echo -e "${BOLD}Install massa-th0th plugins (skills + hooks + MCP bundles):${NC}"
    echo -e "  ${CYAN}1)${NC} Claude Code plugin (skills + commands + hooks auto-write)"
    echo -e "  ${CYAN}2)${NC} Codex plugin (6 skills, 6 hook events, MCP)"
    echo -e "  ${CYAN}3)${NC} Cursor plugin (6 skills, 7 hook events, MCP, agents)"
    echo -e "  ${CYAN}4)${NC} OpenCode plugin (npm install + config snippet)"
    echo -e "  ${CYAN}5)${NC} All four (Claude, Codex, Cursor, OpenCode)"
    echo -e "  ${CYAN}s)${NC} Back"
    echo ""
    read -rp "  Choice [s]: " _plugin_choice <>/dev/tty
    case "${_plugin_choice:-s}" in
      1)
        if [ -f "$claude_installer" ]; then
          bash "$claude_installer" --user
        else
          warn "Claude Code plugin installer not found at $claude_installer"
        fi
        ;;
      2)
        if [ -f "$codex_installer" ]; then
          bash "$codex_installer" --user
        else
          warn "Codex plugin installer not found at $codex_installer"
        fi
        ;;
      3)
        if [ -f "$cursor_installer" ]; then
          bash "$cursor_installer" --user
        else
          warn "Cursor plugin installer not found at $cursor_installer"
        fi
        ;;
      4)
        print_opencode_plugin_instructions
        ;;
      5)
        if [ -f "$claude_installer" ]; then
          bash "$claude_installer" --user
        else
          warn "Claude Code plugin installer not found at $claude_installer"
        fi
        if [ -f "$codex_installer" ]; then
          bash "$codex_installer" --user
        else
          warn "Codex plugin installer not found at $codex_installer"
        fi
        if [ -f "$cursor_installer" ]; then
          bash "$cursor_installer" --user
        else
          warn "Cursor plugin installer not found at $cursor_installer"
        fi
        print_opencode_plugin_instructions
        ;;
      s|S|"") return ;;
      *) warn "Unknown choice. Enter 1, 2, 3, 4, 5, or s." ;;
    esac
  done
}

# OpenCode plugin is an npm package (@massa-th0th/opencode-plugin), not a
# script-copy bundle. Print the install command + opencode.json config snippet.
print_opencode_plugin_instructions() {
  echo ""
  echo -e "${BOLD}OpenCode plugin install (npm package):${NC}"
  echo ""
  echo -e "  1. Install the package:"
  echo -e "     ${CYAN}npm install @massa-th0th/opencode-plugin${NC}"
  echo -e "     (or from source: ${CYAN}bun add @massa-th0th/opencode-plugin${NC})"
  echo ""
  echo -e "  2. Add to ~/.config/opencode/opencode.json:"
  echo ""
  echo -e "  {"
  echo -e '    "plugin": ["@massa-th0th/opencode-plugin"],'
  echo -e '    "mcp": {'
  echo -e '      "massa-th0th": {'
  echo -e '        "type": "local",'
  echo -e '        "command": ["bunx", "@massa-th0th/mcp-client"],'
  echo -e '        "environment": { "MASSA_TH0TH_API_URL": "http://localhost:3333" },'
  echo -e '        "enabled": true'
  echo -e '      }'
  echo -e '    }'
  echo -e "  }"
  echo ""
  echo -e "  OpenCode hooks are in-process (no hooks.json to merge)."
  echo -e "  Prerequisite: the Tools API must be running (bun run dev:api)."
}

# ── Show MCP integration instructions ────────────────────────
show_integration() {
  local mode="$1"
  local api_port="$2"
  local install_dir="$3"

  echo ""
  echo -e "${BOLD}╔═══════════════════════════════════════════════════════╗${NC}"
  echo -e "${BOLD}║              massa-th0th is ready!                          ║${NC}"
  echo -e "${BOLD}╚═══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${GREEN}API:${NC}     http://localhost:${api_port}"
  echo -e "  ${GREEN}Health:${NC}  curl http://localhost:${api_port}/health"
  echo -e "  ${GREEN}Swagger:${NC} http://localhost:${api_port}/swagger"
  if [ "${WEB_UI_ENABLED:-true}" != "false" ] && [ "${WEB_UI_ENABLED:-true}" != "0" ]; then
    echo -e "  ${GREEN}Web UI:${NC}  http://localhost:${api_port}/ui"
  fi
  echo ""
  echo -e "${BOLD}  Connect to Claude / OpenCode:${NC}"
  echo ""

  if [ "$mode" = "docker" ] || [ "$mode" = "build" ]; then
    echo -e "  ${CYAN}Option A — Docker MCP (recommended):${NC}"
    echo -e '  Add to ~/.config/opencode/opencode.json or Claude Desktop config:'
    echo ""
    echo -e '  {'
    echo -e '    "mcpServers": {'
    echo -e '      "massa-th0th": {'
    echo -e '        "type": "local",'
    echo -e "        \"command\": [\"docker\", \"compose\", \"-f\", \"${install_dir}/docker-compose.yml\", \"run\", \"--rm\", \"-i\", \"mcp\"],"
    echo -e '        "enabled": true'
    echo -e '      }'
    echo -e '    }'
    echo -e '  }'
    echo ""
    echo -e "  ${CYAN}Option B — npm MCP (no Docker required for MCP):${NC}"
  fi

  echo -e '  {'
  echo -e '    "mcpServers": {'
  echo -e '      "massa-th0th": {'
  echo -e '        "type": "local",'
  echo -e '        "command": ["npx", "@massa-th0th/mcp-client"],'
  echo -e "        \"env\": { \"MASSA_TH0TH_API_URL\": \"http://localhost:${api_port}\" },"
  echo -e '        "enabled": true'
  echo -e '      }'
  echo -e '    }'
  echo -e '  }'
  echo ""
  echo -e "  ${BOLD}Manage services:${NC}"
  echo -e "    docker compose -f ${install_dir}/docker-compose.yml up -d"
  echo -e "    docker compose -f ${install_dir}/docker-compose.yml down"
  echo -e "    docker compose -f ${install_dir}/docker-compose.yml logs -f api"
  echo ""
  echo -e "  ${BOLD}Diagnose:${NC}"
  if [ "$mode" = "source" ] || [ "$mode" = "build" ]; then
    echo -e "    cd ${install_dir} && bun run diagnose"
  else
    echo -e "    curl -s http://localhost:${api_port}/health | jq"
  fi
  echo ""
  echo -e "  ${DIM}For Ollama completion features (consolidation, rerank, query understanding):${NC}"
  echo -e "  ${DIM}set RLM_LLM_ENABLED=true — see .env.example and README §Local-first LLM.${NC}"
  echo ""
}

# ══════════════════════════════════════════════════════════════
#  MODES
# ══════════════════════════════════════════════════════════════

install_docker() {
  echo -e "${BOLD}[1/4] Checking prerequisites...${NC}"
  preflight_docker
  echo ""

  echo -e "${BOLD}[2/4] Resolving ports & configuration...${NC}"
  resolve_ports
  mkdir -p "$INSTALL_DIR"

  local ollama_url; ollama_url=$(detect_ollama_url "docker")
  check_ollama "$ollama_url" || true

  local db_url="postgresql://massa_th0th:${DB_PASS}@localhost:${POSTGRES_PORT}/massa_th0th"
  fetch_compose "$INSTALL_DIR"
  write_env "$INSTALL_DIR" "$ollama_url" "$db_url"
  echo ""

  echo -e "${BOLD}[3/4] Pulling Docker images...${NC}"
  (cd "$INSTALL_DIR" && \
    env MASSA_TH0TH_API_PORT="$API_PORT" MASSA_TH0TH_POSTGRES_PORT="$POSTGRES_PORT" \
        POSTGRES_PASSWORD="$DB_PASS" OLLAMA_BASE_URL="$ollama_url" \
    docker compose pull)
  ok "Images pulled"
  echo ""

  if [ "$NO_START" != "1" ]; then
    echo -e "${BOLD}[4/4] Starting services...${NC}"
    (cd "$INSTALL_DIR" && \
      env MASSA_TH0TH_API_PORT="$API_PORT" MASSA_TH0TH_POSTGRES_PORT="$POSTGRES_PORT" \
          POSTGRES_PASSWORD="$DB_PASS" OLLAMA_BASE_URL="$ollama_url" \
      docker compose up -d postgres)
    ok "PostgreSQL started"

    info "Waiting for database to be ready..."
    local tries=0
    until (cd "$INSTALL_DIR" && docker compose exec -T postgres pg_isready -U massa_th0th &>/dev/null) \
          || [ $tries -ge 15 ]; do
      sleep 2; tries=$((tries + 1))
    done

    (cd "$INSTALL_DIR" && \
      env MASSA_TH0TH_API_PORT="$API_PORT" MASSA_TH0TH_POSTGRES_PORT="$POSTGRES_PORT" \
          POSTGRES_PASSWORD="$DB_PASS" OLLAMA_BASE_URL="$ollama_url" \
      docker compose up -d api)
    ok "API started (migrations run automatically on first boot)"
    echo ""
  fi

  show_integration "docker" "$API_PORT" "$INSTALL_DIR"
  post_install "docker" "$INSTALL_DIR"
}

# ──────────────────────────────────────────────────────────────

install_build() {
  echo -e "${BOLD}[1/5] Checking prerequisites...${NC}"
  preflight_docker
  preflight_git
  preflight_bun
  echo ""

  echo -e "${BOLD}[2/5] Cloning repository...${NC}"
  if [ -d "${INSTALL_DIR}/.git" ]; then
    ok "Repo already cloned at ${INSTALL_DIR} — pulling latest"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone --depth=1 --branch "$BRANCH" "${GITHUB_URL}.git" "$INSTALL_DIR"
    ok "Cloned ${GITHUB_URL} → ${INSTALL_DIR}"
  fi
  echo ""

  echo -e "${BOLD}[3/5] Resolving ports & configuration...${NC}"
  resolve_ports
  local ollama_url; ollama_url=$(detect_ollama_url "docker")
  check_ollama "$ollama_url" || true
  local db_url="postgresql://massa_th0th:${DB_PASS}@localhost:${POSTGRES_PORT}/massa_th0th"
  # Pass local image names so the .env points at what was actually built,
  # not the Docker Hub constants (which may not exist or be stale).
  write_env "$INSTALL_DIR" "$ollama_url" "$db_url" "massa-th0th-api:local" "massa-th0th-mcp:local"
  echo ""

  echo -e "${BOLD}[4/5] Building Docker images...${NC}"
  (cd "$INSTALL_DIR" && docker build --target api -t massa-th0th-api:local .)
  (cd "$INSTALL_DIR" && docker build --target mcp -t massa-th0th-mcp:local .)
  ok "Images built"
  export MASSA_TH0TH_API_IMAGE="massa-th0th-api:local"
  export MASSA_TH0TH_MCP_IMAGE="massa-th0th-mcp:local"
  echo ""

  if [ "$NO_START" != "1" ]; then
    echo -e "${BOLD}[5/5] Starting services...${NC}"
    (cd "$INSTALL_DIR" && \
      env MASSA_TH0TH_API_PORT="$API_PORT" MASSA_TH0TH_POSTGRES_PORT="$POSTGRES_PORT" \
          POSTGRES_PASSWORD="$DB_PASS" OLLAMA_BASE_URL="$ollama_url" \
          MASSA_TH0TH_API_IMAGE="massa-th0th-api:local" MASSA_TH0TH_MCP_IMAGE="massa-th0th-mcp:local" \
      docker compose up -d postgres api)
    ok "Services started"
    echo ""
  fi

  show_integration "build" "$API_PORT" "$INSTALL_DIR"
  post_install "build" "$INSTALL_DIR"
}

# ──────────────────────────────────────────────────────────────

install_source() {
  echo -e "${BOLD}[1/4] Checking prerequisites...${NC}"
  preflight_git
  preflight_bun
  echo ""

  echo -e "${BOLD}[2/4] Cloning repository...${NC}"
  if [ -d "${INSTALL_DIR}/.git" ]; then
    ok "Repo already cloned at ${INSTALL_DIR} — pulling latest"
    git -C "$INSTALL_DIR" pull --ff-only
  else
    git clone --depth=1 --branch "$BRANCH" "${GITHUB_URL}.git" "$INSTALL_DIR"
    ok "Cloned ${GITHUB_URL} → ${INSTALL_DIR}"
  fi
  echo ""

  echo -e "${BOLD}[3/4] Installing dependencies & building...${NC}"
  (cd "$INSTALL_DIR" && bun install)
  (cd "$INSTALL_DIR" && bun run build)
  ok "Build complete"
  echo ""

  echo -e "${BOLD}[4/4] Running local setup wizard...${NC}"
  bash "${INSTALL_DIR}/scripts/setup-local-first.sh"

  show_integration "source" "$API_PORT" "$INSTALL_DIR"
  post_install "source" "$INSTALL_DIR"
}

# ══════════════════════════════════════════════════════════════
#  MAIN
# ══════════════════════════════════════════════════════════════

main() {
  echo ""
  echo -e "${BOLD}Installation directory:${NC} ${INSTALL_DIR}"
  echo ""

  # Select mode interactively if not set via env
  if [ -z "$MODE" ]; then
    MODE=$(select_mode)
  fi

  # Source mode: let the user pick (and validate) the clone path.
  if [ "$MODE" = "source" ]; then
    INSTALL_DIR="$(prompt_install_dir)"
    echo ""
    echo -e "${BOLD}Installation directory:${NC} ${INSTALL_DIR}"
  fi

  echo ""
  echo -e "${BOLD}Mode: ${CYAN}${MODE}${NC}"
  echo ""

  case "$MODE" in
    docker) install_docker ;;
    build)  install_build  ;;
    source) install_source ;;
    *)      die "Unknown mode '${MODE}'. Valid: docker, build, source" ;;
  esac
}

main "$@"
