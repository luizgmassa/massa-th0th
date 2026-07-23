#!/bin/bash
set -e

# ========================================
# massa-th0th - Local-First Setup Script
# ========================================
# Sets up massa-th0th to work 100% offline
# with no dependency on external services.
#
# Usage: ./scripts/setup-local-first.sh
# ========================================

# shellcheck source=scripts/banner.sh
source "$(dirname "${BASH_SOURCE[0]}")/banner.sh"
# shellcheck source=scripts/lib/installer-env-transaction.sh
source "$(dirname "${BASH_SOURCE[0]}")/lib/installer-env-transaction.sh"
massa_th0th_banner

# Back up an existing config file to <file>.bak before it gets regenerated.
backup_if_exists() {
    [ -f "$1" ] || return 0
    cp "$1" "$1.bak"
    echo -e "  ${YELLOW}⚠${NC} Backed up existing $1 → $1.bak"
}

die() {
    echo -e "  ${RED}✗${NC} $*" >&2
    exit 1
}

require_postgres_database_url() {
    local database_url="$1"
    case "$database_url" in
        postgres://*|postgresql://*) ;;
        *) die "DATABASE_URL must use postgres:// or postgresql://." ;;
    esac

    local without_query="${database_url%%\?*}"
    case "$without_query" in
        *://*/*) ;;
        *) die "DATABASE_URL must include a database name." ;;
    esac
    local authority_and_path="${without_query#*://}"
    local authority="${authority_and_path%%/*}"
    local database_name="${authority_and_path#*/}"
    [ -n "$authority" ] && [ -n "$database_name" ] || die "DATABASE_URL must include a host and database name."
}

# ---- Step 1: Check Ollama ----
echo -e "${BOLD}[1/5] Checking Ollama...${NC}"

OLLAMA_URL="${OLLAMA_HOST:-http://localhost:11434}"
OLLAMA_HAS_CLI=false
OLLAMA_API_REACHABLE=false

# Check if Ollama CLI is available
if command -v ollama &> /dev/null; then
    OLLAMA_HAS_CLI=true
    echo -e "  ${GREEN}✓${NC} Ollama CLI is installed"
fi

# Check if Ollama API is reachable (covers WSL -> Windows host, remote, etc.)
if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    OLLAMA_API_REACHABLE=true
    OLLAMA_VERSION=$(curl -s "${OLLAMA_URL}/api/version" 2>/dev/null | python3 -c "import sys,json; print(json.load(sys.stdin).get('version','unknown'))" 2>/dev/null || echo "unknown")
    echo -e "  ${GREEN}✓${NC} Ollama API reachable at ${OLLAMA_URL} (v${OLLAMA_VERSION})"
fi

if [ "$OLLAMA_HAS_CLI" = false ] && [ "$OLLAMA_API_REACHABLE" = false ]; then
    # Neither CLI nor API available - try to install
    echo -e "  ${YELLOW}⚠${NC} Ollama not found. Installing..."
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        curl -fsSL https://ollama.com/install.sh | sh
        OLLAMA_HAS_CLI=true
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        echo -e "  ${YELLOW}⚠${NC} On macOS, install Ollama first:"
        echo -e "      brew install ollama   (then: brew services start ollama)"
        echo -e "      or download from https://ollama.com/download"
        echo -e "  ${YELLOW}⚠${NC} Then re-run this script."
        exit 1
    else
        echo -e "  ${RED}✗${NC} Unsupported OS. Install Ollama manually: https://ollama.com"
        exit 1
    fi
elif [ "$OLLAMA_HAS_CLI" = false ] && [ "$OLLAMA_API_REACHABLE" = true ]; then
    # API reachable but no CLI (e.g. WSL with Ollama on Windows host)
    echo -e "  ${GREEN}✓${NC} Using remote Ollama API (no local CLI needed)"
fi

# If API is not reachable yet, try to start it
if [ "$OLLAMA_API_REACHABLE" = false ]; then
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        echo -e "  ${YELLOW}⚠${NC} Ollama API not responding. Starting..."
        nohup ollama serve > /dev/null 2>&1 &
        sleep 2

        if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
            OLLAMA_API_REACHABLE=true
            echo -e "  ${GREEN}✓${NC} Ollama started successfully"
        else
            echo -e "  ${RED}✗${NC} Failed to start Ollama. Please start it manually: ollama serve"
            exit 1
        fi
    else
        echo -e "  ${RED}✗${NC} Ollama API not reachable at ${OLLAMA_URL}"
        echo -e "      Set OLLAMA_HOST to point to your Ollama instance."
        exit 1
    fi
fi

# Detect whether a named Ollama model is already pulled, without silently
# returning "no" (which would trigger a multi-GB re-pull). Preference order:
#   1. `ollama list` CLI (no python3 dependency, works offline once pulled)
#   2. /api/tags parsed with python3 (if python3 is present)
#   3. /api/tags body scanned with grep (last-resort, no python3)
# Each branch prints exactly "yes" or "no".
ollama_model_exists() {
    local model="$1" search="${1%%:*}" body
    # 1. CLI
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        if ollama list 2>/dev/null | grep -Eq "(^|[[:space:]])${search}(:|[[:space:]])"; then
            echo "yes"; return 0
        fi
    fi
    # Fetch the tags payload once for the fallbacks.
    body="$(curl -s "${OLLAMA_URL}/api/tags" 2>/dev/null || true)"
    if [ -z "$body" ]; then echo "no"; return 0; fi
    # 2. python3 JSON parse
    if command -v python3 >/dev/null 2>&1; then
        printf '%s' "$body" | python3 -c "
import sys, json
try:
    data = json.load(sys.stdin)
except Exception:
    print('no'); sys.exit(0)
models = [m.get('name','') for m in data.get('models', [])]
search = '${search}'
print('yes' if any(search in m for m in models) else 'no')
" 2>/dev/null && return 0
    fi
    # 3. grep fallback: match \"name\":\"qwen3-embedding...
    if printf '%s' "$body" | grep -Eq "\"name\"[[:space:]]*:[[:space:]]*\"${search}"; then
        echo "yes"
    else
        echo "no"
    fi
}

# ---- Step 2: Pull embedding models ----
echo ""
echo -e "${BOLD}[2/5] Pulling embedding models...${NC}"

EMBEDDING_MODEL="${OLLAMA_EMBEDDING_MODEL:-qwen3-embedding:8b}"

# Check if model is already available
MODEL_EXISTS="$(ollama_model_exists "$EMBEDDING_MODEL")"

if [ "$MODEL_EXISTS" = "yes" ]; then
    echo -e "  ${GREEN}✓${NC} Model ${EMBEDDING_MODEL} already available"
else
    echo -e "  Pulling ${EMBEDDING_MODEL}..."
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        ollama pull "$EMBEDDING_MODEL"
    else
        # Pull via API (works for remote/WSL scenarios)
        curl -s "${OLLAMA_URL}/api/pull" -d "{\"name\": \"${EMBEDDING_MODEL}\"}" | while IFS= read -r line; do
            STATUS=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
            if [ -n "$STATUS" ]; then
                printf "\r  %s" "$STATUS"
            fi
        done
        echo ""
    fi
    echo -e "  ${GREEN}✓${NC} Model ${EMBEDDING_MODEL} pulled"
fi

# Pull the local-first LLM model (consolidation, salience, query rewrite, HyDE).
LLM_MODEL="${RLM_LLM_MODEL:-qwen2.5:7b-instruct}"
LLM_EXISTS="$(ollama_model_exists "$LLM_MODEL")"

if [ "$LLM_EXISTS" = "yes" ]; then
    echo -e "  ${GREEN}✓${NC} Model ${LLM_MODEL} already available"
else
    echo -e "  Pulling ${LLM_MODEL} (instruct model, ~4.7GB)..."
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        ollama pull "$LLM_MODEL"
    else
        # Pull via API (works for remote/WSL scenarios)
        curl -s "${OLLAMA_URL}/api/pull" -d "{\"name\": \"${LLM_MODEL}\"}" | while IFS= read -r line; do
            STATUS=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
            if [ -n "$STATUS" ]; then
                printf "\r  %s" "$STATUS"
            fi
        done
        echo ""
    fi
    echo -e "  ${GREEN}✓${NC} Model ${LLM_MODEL} pulled"
fi

# Pull the code-oriented LLM model (bootstrap seed, reranker, code compression).
CODE_MODEL="${RLM_LLM_CODE_MODEL:-qwen2.5-coder:7b}"
CODE_EXISTS="$(ollama_model_exists "$CODE_MODEL")"

if [ "$CODE_EXISTS" = "yes" ]; then
    echo -e "  ${GREEN}✓${NC} Model ${CODE_MODEL} already available"
else
    echo -e "  Pulling ${CODE_MODEL} (code-oriented LLM, ~4.7GB)..."
    if [ "$OLLAMA_HAS_CLI" = true ]; then
        ollama pull "$CODE_MODEL"
    else
        # Pull via API (works for remote/WSL scenarios)
        curl -s "${OLLAMA_URL}/api/pull" -d "{\"name\": \"${CODE_MODEL}\"}" | while IFS= read -r line; do
            STATUS=$(echo "$line" | python3 -c "import sys,json; print(json.load(sys.stdin).get('status',''))" 2>/dev/null || true)
            if [ -n "$STATUS" ]; then
                printf "\r  %s" "$STATUS"
            fi
        done
        echo ""
    fi
    echo -e "  ${GREEN}✓${NC} Model ${CODE_MODEL} pulled"
fi

# ---- Step 3: Database selection ----
echo ""
echo -e "${BOLD}[3/5] Database selection...${NC}"
echo ""
echo -e "  Choose your database backend:"
echo -e "    ${BLUE}1)${NC} Native PostgreSQL  (recommended, ~100MB RAM, no Docker)"
echo -e "    ${BLUE}2)${NC} Docker PostgreSQL  (colima + Docker, ~5GB RAM)"
echo ""
# Non-interactive override (mirrors MASSA_TH0TH_MODE in install.sh)
case "${MASSA_TH0TH_DB_BACKEND:-}" in
    native) DB_CHOICE=1 ;;
    docker) DB_CHOICE=2 ;;
    sqlite) die "MASSA_TH0TH_DB_BACKEND=sqlite is not supported. Choose native or docker." ;;
    "")
        read -rp "  Enter your choice [1]: " DB_CHOICE </dev/tty || true
        DB_CHOICE=${DB_CHOICE:-1}
        ;;
    *)
        die "Invalid MASSA_TH0TH_DB_BACKEND. Choose native or docker."
        ;;
esac

DATABASE_URL=""

if [ "$DB_CHOICE" = "1" ]; then
    # ---- Native PostgreSQL (macOS / Homebrew) ----
    echo ""
    NATIVE_HELPER="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)/setup-native-postgres.sh"
    if [ -x "$NATIVE_HELPER" ]; then
        if NATIVE_OUTPUT="$("$NATIVE_HELPER" 2>&1)"; then
            echo "$NATIVE_OUTPUT"
            DATABASE_URL="$(printf '%s\n' "$NATIVE_OUTPUT" | sed -n 's/^DATABASE_URL=//p' | head -1)"
            echo -e "  ${GREEN}✓${NC} Native PostgreSQL ready"
        else
            echo "$NATIVE_OUTPUT" >&2
            die "Native PostgreSQL setup failed. Fix it and re-run: bash \"$NATIVE_HELPER\""
        fi
    else
        die "Native PostgreSQL helper not found: $NATIVE_HELPER"
    fi
elif [ "$DB_CHOICE" = "2" ]; then
    # ---- Docker PostgreSQL (colima + Docker) ----
    echo ""
    echo -e "  ${YELLOW}⚠${NC} Docker PostgreSQL runs via colima + Docker and reserves ~5GB RAM."
    echo -e "  ${YELLOW}⚠${NC} For a lighter native PostgreSQL (~100MB, no Docker), re-run and choose option 1."
    echo ""
    
    # Check if docker is available
    if command -v docker &> /dev/null; then
        echo -e "  ${GREEN}✓${NC} Docker is installed"
        
        # Find available port starting from 5432
        POSTGRES_PORT=5432
        while netstat -tuln 2>/dev/null | grep -q ":${POSTGRES_PORT} " || ss -tuln 2>/dev/null | grep -q ":${POSTGRES_PORT} "; do
            echo -e "  ${YELLOW}⚠${NC} Port ${POSTGRES_PORT} is already in use"
            POSTGRES_PORT=$((POSTGRES_PORT + 1))
        done
        
        if [ "$POSTGRES_PORT" != "5432" ]; then
            echo -e "  ${GREEN}✓${NC} Using alternative port: ${POSTGRES_PORT}"
        fi
        
        # Check if postgres container is running
        if docker ps --format '{{.Names}}' | grep -q "massa-th0th-postgres"; then
            echo -e "  ${GREEN}✓${NC} PostgreSQL container already running"
            
            # Get the port from running container
            RUNNING_PORT=$(docker port massa-th0th-postgres 5432 2>/dev/null | cut -d: -f2)
            if [ -n "$RUNNING_PORT" ]; then
                POSTGRES_PORT=$RUNNING_PORT
                echo -e "  ${GREEN}✓${NC} Using existing container port: ${POSTGRES_PORT}"
            fi
        else
            echo -e "  ${YELLOW}⚠${NC} Starting PostgreSQL with Docker..."
            
            # Get project root
            SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
            PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
            
            # Export port for docker-compose
            export MASSA_TH0TH_POSTGRES_PORT=$POSTGRES_PORT
            
            cd "$PROJECT_ROOT"
            docker compose up -d postgres
            
            if [ $? -eq 0 ]; then
                echo -e "  ${GREEN}✓${NC} PostgreSQL started successfully on port ${POSTGRES_PORT}"
                sleep 3  # Wait for postgres to be ready
            else
                echo -e "  ${RED}✗${NC} Failed to start PostgreSQL"
                echo -e "      Try manually: cd ${PROJECT_ROOT} && MASSA_TH0TH_POSTGRES_PORT=${POSTGRES_PORT} docker compose up -d postgres"
                exit 1
            fi
        fi
        
        DATABASE_URL="postgresql://massa_th0th:massa_th0th_password@localhost:${POSTGRES_PORT}/massa_th0th"
        echo -e "  ${GREEN}✓${NC} Database URL: ${DATABASE_URL}"
    else
        die "Docker not found. Install/start Docker and re-run, or choose native PostgreSQL."
    fi
else
    die "Invalid database selection. Choose 1 for native PostgreSQL or 2 for Docker PostgreSQL."
fi

require_postgres_database_url "$DATABASE_URL"

# ---- Step 4: Create directories and config ----
echo ""
echo -e "${BOLD}[4/5] Creating directories and config...${NC}"

# Data directory — unified under the XDG config home so config + data live in
# one place (~/.config/massa-th0th/). The legacy ~/.massa-th0th-data/ location
# is migrated idempotently if present and the new path does not yet exist.
DATA_DIR="${HOME}/.config/massa-th0th/data"
LEGACY_DATA_DIR="${HOME}/.massa-th0th-data"
if [ -d "$LEGACY_DATA_DIR" ] && [ ! -d "$DATA_DIR" ]; then
    mkdir -p "${HOME}/.config/massa-th0th"
    if mv "$LEGACY_DATA_DIR" "$DATA_DIR" 2>/dev/null; then
        echo -e "  ${GREEN}✓${NC} Migrated data directory: ${LEGACY_DATA_DIR} -> ${DATA_DIR}"
    else
        echo -e "  ${YELLOW}⚠${NC} Could not move ${LEGACY_DATA_DIR} -> ${DATA_DIR} (cross-volume?). Move it manually."
    fi
fi
mkdir -p "$DATA_DIR"
echo -e "  ${GREEN}✓${NC} Data directory: ${DATA_DIR}"

# Config directory
CONFIG_DIR="${HOME}/.config/massa-th0th"
mkdir -p "$CONFIG_DIR"
CONFIG_FILE="${CONFIG_DIR}/config.json"

# Get project root (assuming script is in scripts/ directory)
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"
ENV_FILE="${PROJECT_ROOT}/.env"

# Search-quality toggle defaults (reused by the summary; overridden by the
# interactive prompt below when .env is freshly created).
SEARCH_QU_ENABLED=false
SEARCH_RERANK_ENABLED=false

# Regenerate the .env file, backing up any existing copy transactionally.
ENV_FILE_EXISTED=false
if [ -e "$ENV_FILE" ] || [ -L "$ENV_FILE" ]; then
    ENV_FILE_EXISTED=true
fi
    # Interactively offer the LLM search-quality toggles (off by default; both
    # run synchronously on every search and add LLM latency). Only prompt on the
    # first run — re-running setup should not re-ask when .env/config.json already
    # exist; config.json is the runtime source of truth for these tunables.
    if [ "$ENV_FILE_EXISTED" = false ]; then
        echo ""
        echo -e "${BOLD}LLM search-quality features (optional, off by default)${NC}"
        echo -e "${DIM}Both run synchronously on every search and add LLM latency.${NC}"
        echo ""
        echo -e "  ${BOLD}Query understanding${NC} — rewrites your query (+ HyDE) before retrieval for"
        echo -e "  ${DIM}better recall. Risk: +1-2 LLM calls per unique query (2-10s on a local CPU);${NC}"
        echo -e "  ${DIM}a bad rewrite can reduce recall. Cached 5min/256 entries.${NC}"
        read -rp "  Enable query understanding? [y/N]: " _qu </dev/tty || true
        case "${_qu:-n}" in y|Y|yes|YES) SEARCH_QU_ENABLED=true ;; esac
        echo ""
        echo -e "  ${BOLD}Rerank${NC} — re-orders the top 50 results by LLM relevance after retrieval."
        echo -e "  ${DIM}Risk: +1 LLM call per search (~1-5s local); subjective reorder of the same${NC}"
        echo -e "  ${DIM}result set (tail preserved).${NC}"
        read -rp "  Enable rerank? [y/N]: " _rr </dev/tty || true
        case "${_rr:-n}" in y|Y|yes|YES) SEARCH_RERANK_ENABLED=true ;; esac
        echo ""
    else
        echo -e "${DIM}LLM search-quality prompt skipped (.env already exists — re-run config.json to change tunables).${NC}"
    fi

    installer_env_publish "$ENV_FILE" << ENVEOF
# MCP MASSA_TH0TH - Auto-generated by setup-local-first.sh
#
# NOTE: config.json (${CONFIG_FILE}) is now the RUNTIME source of truth for
# all tunables (llm, embedding, cache, search, memory, hooks, compression,
# logging) AND for DATABASE_URL. This .env is intentionally thin: it only
# keeps DATABASE_URL for tooling that reads the environment directly, and as a
# legacy override path (explicit env vars still override config.json).

# Database Configuration (also written to config.json -> database.url)
DATABASE_URL=${DATABASE_URL}
ENVEOF

    if [ "$ENV_FILE_EXISTED" = true ]; then
        echo -e "  ${YELLOW}⚠${NC} Backed up existing $ENV_FILE → $ENV_FILE.bak"
    fi
    echo -e "  ${GREEN}✓${NC} Created thin .env file: ${ENV_FILE} (config.json is the runtime source)"

# Regenerate the config file, backing up any existing copy first.
backup_if_exists "$CONFIG_FILE"
    cat > "$CONFIG_FILE" << EOF
{
  "database": {
    "url": "${DATABASE_URL}"
  },
  "embedding": {
    "provider": "ollama",
    "model": "${EMBEDDING_MODEL}",
    "baseURL": "${OLLAMA_URL}",
    "dimensions": 4096
  },
  "llm": {
    "enabled": true,
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "ollama",
    "model": "${LLM_MODEL}",
    "codeModel": "${CODE_MODEL}",
    "temperature": 0.2,
    "maxOutputTokens": 8000,
    "timeoutMs": 90000,
    "disableThink": true
  },
  "compression": {
    "defaultStrategy": "code_structure",
    "minTokensForCompression": 100,
    "targetCompressionRatio": 0.7
  },
  "cache": {
    "enabled": true,
    "l1MaxSizeMB": 100,
    "l2MaxSizeMB": 500,
    "defaultTTLSeconds": 3600
  },
  "search": {
    "autoReindexMaxFiles": 200,
    "queryUnderstanding": {
      "enabled": ${SEARCH_QU_ENABLED:-false},
      "hydeEnabled": true,
      "cacheTtlMs": 300000,
      "cacheMaxSize": 256
    },
    "rerank": {
      "enabled": ${SEARCH_RERANK_ENABLED:-false},
      "rerankWindow": 50
    }
  },
  "memory": {
    "decay": {
      "lambda": 0.02,
      "sigma": 0.6,
      "mu": 0.04,
      "coldThreshold": 0.2
    },
    "bootstrap": {
      "enabled": true,
      "maxSeedMemories": 8,
      "centralityLimit": 10,
      "gitLogLimit": 20,
      "refreshEnabled": true
    },
    "autoImprove": {
      "enabled": true,
      "reviewGate": false,
      "minObservations": 8,
      "minIntervalMs": 300000,
      "maxWindow": 16,
      "minQueryHits": 3,
      "minFileHits": 3,
      "minFixHits": 2
    },
    "autoImportance": {
      "enabled": true
    }
  },
  "hooks": {
    "enabled": true,
    "maxPayloadBytes": 65536,
    "queue": {
      "maxPending": 256
    },
    "bridge": {
      "enabled": true,
      "minObservations": 8,
      "minIntervalMs": 300000,
      "maxWindow": 8
    }
  },
  "dataDir": "${DATA_DIR}",
  "logging": {
    "level": "info",
    "enableMetrics": false
  }
}
EOF
    # config.json now contains DATABASE_URL (a secret) — restrict to owner.
    chmod 600 "$CONFIG_FILE"
    echo -e "  ${GREEN}✓${NC} Created config: ${CONFIG_FILE} (chmod 600)"

# Run Prisma migrations unconditionally. A connection, pgvector, or migration
# failure stops setup before final configuration is reported as usable.
echo ""
echo -e "  ${YELLOW}⚠${NC} Running database migrations..."
command -v bun &> /dev/null || die "Bun is required to run PostgreSQL migrations."
export DATABASE_URL
cd "${PROJECT_ROOT}/packages/core"
# Ensure pgvector exists before migrating (Prisma schema depends on it). The
# native helper already does this, but the Docker path or a reused cluster may
# not have it yet. CREATE EXTENSION is idempotent.
if command -v psql &> /dev/null; then
    psql "${DATABASE_URL}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1 \
        || echo -e "  ${YELLOW}⚠${NC} Could not pre-create pgvector extension (it may already be present, or the role lacks superuser)."
fi
bunx prisma migrate deploy \
    || die "PostgreSQL migrations failed. Setup stopped.
      Verify: (1) Postgres is running and DATABASE_URL is reachable,
      (2) pgvector is installed in the target database (CREATE EXTENSION vector),
      (3) packages/core/prisma/migrations exists. Then re-run this script."

# ---- Step 5: Verify setup ----
echo ""
echo -e "${BOLD}[5/5] Verifying setup...${NC}"

# Check Ollama health
if curl -s "${OLLAMA_URL}/api/tags" > /dev/null 2>&1; then
    MODELS=$(curl -s "${OLLAMA_URL}/api/tags" | python3 -c "import sys,json; data=json.load(sys.stdin); print(len(data.get('models',[])))" 2>/dev/null || echo "?")
    echo -e "  ${GREEN}✓${NC} Ollama: healthy at ${OLLAMA_URL} (${MODELS} models)"
else
    echo -e "  ${RED}✗${NC} Ollama: not responding"
fi

# Check data directory
if [ -d "$DATA_DIR" ] && [ -w "$DATA_DIR" ]; then
    echo -e "  ${GREEN}✓${NC} Data directory: ${DATA_DIR}"
else
    echo -e "  ${RED}✗${NC} Data directory: not writable"
fi

# Check config
if [ -f "$CONFIG_FILE" ]; then
    echo -e "  ${GREEN}✓${NC} Config: ${CONFIG_FILE}"
else
    echo -e "  ${RED}✗${NC} Config: not found"
fi

# Verify reachability and pgvector after migrations. Attempt to self-heal by
# (re)creating the extension before declaring failure; distinguish a connection
# problem from a missing-extension problem in the error message.
verify_pgvector() {
    local psql_cmd="$1"          # e.g. "psql \"${DATABASE_URL}\"" or "docker exec ... psql ..."
    eval "$psql_cmd -v ON_ERROR_STOP=1 -c \"CREATE EXTENSION IF NOT EXISTS vector;\"" >/dev/null 2>&1
    eval "$psql_cmd -tAc \"SELECT 1 FROM pg_extension WHERE extname = 'vector'\"" 2>/dev/null | grep -qx "1"
}
if command -v psql &> /dev/null; then
    if psql "${DATABASE_URL}" -tAc "SELECT 1" >/dev/null 2>&1; then
        verify_pgvector "psql \"${DATABASE_URL}\"" \
            || die "Connected to PostgreSQL, but pgvector is unavailable. Install it (brew install pgvector) and re-run, or run: psql \"${DATABASE_URL}\" -c \"CREATE EXTENSION vector;\""
    else
        die "Cannot connect to PostgreSQL at ${DATABASE_URL}. Ensure the server is running and the URL is correct. Setup stopped."
    fi
elif command -v docker &> /dev/null && docker ps --format '{{.Names}}' | grep -qx "massa-th0th-postgres"; then
    verify_pgvector "docker exec massa-th0th-postgres psql -U massa_th0th -d massa_th0th" \
        || die "PostgreSQL container is up but pgvector verification failed. Run: docker exec massa-th0th-postgres psql -U massa_th0th -d massa_th0th -c \"CREATE EXTENSION vector;\""
else
    die "Cannot verify PostgreSQL reachability and pgvector: neither psql nor the massa-th0th-postgres container is available. Setup stopped."
fi
echo -e "  ${GREEN}✓${NC} PostgreSQL + pgvector: connected"

# ---- Summary ----
echo ""
echo -e "${BOLD}╔═══════════════════════════════════════════════════════════════╗${NC}"
echo -e "${BOLD}║                    Setup Complete                             ║${NC}"
echo -e "${BOLD}╚═══════════════════════════════════════════════════════════════╝${NC}"
echo ""
echo -e "  ${GREEN}Local-First Configuration:${NC}"
echo -e "    ${BLUE}•${NC} Embeddings: Ollama (${EMBEDDING_MODEL})"
echo -e "    ${BLUE}•${NC} LLM: Ollama (${LLM_MODEL}) — consolidation + auto-importance on"
echo -e "    ${BLUE}•${NC} Search: query understanding ${SEARCH_QU_ENABLED}, rerank ${SEARCH_RERANK_ENABLED}"
echo -e "    ${BLUE}•${NC} Cache: PostgreSQL"
echo -e "    ${BLUE}•${NC} Database: PostgreSQL + pgvector"
echo -e "    ${BLUE}•${NC} Vector DB: PostgreSQL pgvector"
echo -e "    ${BLUE}•${NC} Cost: ${GREEN}\$0${NC}"
echo ""
echo -e "  ${BOLD}Config file:${NC}     ${CONFIG_FILE}"
echo -e "  ${BOLD}Data directory:${NC}  ${DATA_DIR}"
echo -e "  ${BOLD}Database URL:${NC}    ${DATABASE_URL}"
echo ""
echo -e "  ${BOLD}To change provider:${NC}"
echo -e "    npx massa-th0th-config use mistral --api-key YOUR_KEY"
echo -e "    npx massa-th0th-config use openai --api-key YOUR_KEY"
echo ""
echo -e "  ${BOLD}Next steps (from source):${NC}"
echo -e "    1. ${BLUE}bun install${NC}"
echo -e "    2. ${BLUE}bun run build${NC}"
echo -e "    3. ${BLUE}bun run start:api${NC}"
echo ""

# ---- Run diagnose to validate the full stack ----
if command -v bun &> /dev/null && [ -f "${SCRIPT_DIR}/../scripts/diagnose.ts" 2>/dev/null ] || [ -f "${PROJECT_ROOT}/scripts/diagnose.ts" ]; then
    echo -e "  ${BOLD}Running stack validation (bun run diagnose)...${NC}"
    echo ""
    cd "${PROJECT_ROOT}"
    bun run diagnose || echo -e "  ${YELLOW}⚠${NC}  Some checks failed — review the output above before starting."
    echo ""
fi

echo -e "  ${BOLD}Or use with OpenCode:${NC}"
echo -e '    Add to ~/.config/opencode/opencode.json:'
echo ""
echo -e '    {'
echo -e '      "mcpServers": {'
echo -e '        "massa-th0th": {'
echo -e '          "type": "local",'
echo -e '          "command": ["npx", "@massa-th0th/mcp-client"],'
echo -e '          "enabled": true'
echo -e '        }'
echo -e '      }'
echo -e '    }'
echo ""
