#!/bin/bash
# ============================================
# massa-th0th - Native PostgreSQL setup (macOS / Homebrew)
# ============================================
# Boots a local PostgreSQL + pgvector for massa-th0th WITHOUT Docker/colima
# (~100MB RAM vs ~5GB for the Docker path). Idempotent and detect-first: if a
# PostgreSQL is already reachable, it is reused instead of reinstalled.
#
# Emits the resolved connection string on the last line:
#     DATABASE_URL=postgresql://massa_th0th:...@localhost:5432/massa_th0th
#
# Invoked by scripts/setup-local-first.sh (DB backend option 1) and documented
# in the README for manual use. macOS-only — on Linux/WSL install postgresql +
# pgvector via your distro's package manager, or use Docker.
# ============================================
set -euo pipefail

# ── Config (env-overridable) ──────────────────────────────────
PG_VERSION="${MASSA_TH0TH_PG_VERSION:-postgresql@17}"
PG_ROLE="${MASSA_TH0TH_PG_ROLE:-massa_th0th}"
PG_PASSWORD="${POSTGRES_PASSWORD:-massa_th0th_password}"
PG_DB="${MASSA_TH0TH_PG_DB:-massa_th0th}"
PG_PORT="${MASSA_TH0TH_POSTGRES_PORT:-5432}"

# ── Colours / helpers ─────────────────────────────────────────
GREEN='\033[0;32m'; YELLOW='\033[0;33m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "  ${BOLD}$*${NC}"; }
ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
warn() { echo -e "  ${YELLOW}⚠${NC} $*"; }
die()  { echo -e "  ${RED}✗${NC} $*" >&2; exit 1; }

# ── Preflight: macOS + Homebrew ───────────────────────────────
[ "$(uname -s)" = "Darwin" ] || die "Native PostgreSQL setup is macOS-only (Homebrew).
      On Linux/WSL: install postgresql + pgvector via your package manager, or use Docker.
      Aborting."
command -v brew >/dev/null 2>&1 || die "Homebrew not found. Install it first: https://brew.sh
      Aborting."

# Resolve the PostgreSQL bin dir (prefer an already-installed PG on PATH, then
# any Homebrew PG — covers keg-only versions like postgresql@16 not on PATH).
resolve_pg_bin() {
  if command -v pg_isready >/dev/null 2>&1; then
    dirname "$(command -v pg_isready)"
    return
  fi
  local v prefix
  for v in "${PG_VERSION}" postgresql@17 postgresql@16 postgresql@15 postgresql@14; do
    for prefix in /opt/homebrew /usr/local; do
      if [ -x "${prefix}/opt/${v}/bin/pg_isready" ]; then
        echo "${prefix}/opt/${v}/bin"
        return
      fi
    done
  done
}

PG_BIN="$(resolve_pg_bin)"
REUSE=false

# ── Detect an existing reachable PostgreSQL (socket auth, no password) ──
if [ -n "${PG_BIN}" ] && "${PG_BIN}/pg_isready" -q -p "${PG_PORT}" >/dev/null 2>&1; then
  if "${PG_BIN}/psql" -p "${PG_PORT}" -d postgres -tAc "SELECT 1" >/dev/null 2>&1; then
    ok "Existing PostgreSQL already running on port ${PG_PORT} — reusing (no reinstall)"
    REUSE=true
  fi
fi

# ── Install + start if nothing reusable found ─────────────────
if [ "$REUSE" = "false" ]; then
  # Refuse to install/start on top of an unknown process already holding the port.
  if (exec 3<>/dev/tcp/localhost/"${PG_PORT}") 2>/dev/null; then
    exec 3>&- 3<&- 2>/dev/null || true
    die "Something is already listening on port ${PG_PORT}, but no psql/pg_isready was found on PATH or Homebrew. Reuse it by adding its bin to PATH (and re-run), or set MASSA_TH0TH_POSTGRES_PORT to a free port. Aborting (will not install ${PG_VERSION} on top of it)."
  fi
  info "Installing ${PG_VERSION} + pgvector via Homebrew (skips if already installed)..."
  brew install "${PG_VERSION}" pgvector

  PG_BIN="/opt/homebrew/opt/${PG_VERSION}/bin"
  [ -x "${PG_BIN}/postgres" ] || PG_BIN="/usr/local/opt/${PG_VERSION}/bin"
  export PATH="${PG_BIN}:${PATH}"

  if ! "${PG_BIN}/pg_isready" -q -p "${PG_PORT}" >/dev/null 2>&1; then
    info "Starting ${PG_VERSION} as a background service..."
    brew services start "${PG_VERSION}" || die "Failed to start ${PG_VERSION}.
      Try: brew services start ${PG_VERSION}"
    for _ in $(seq 1 30); do
      "${PG_BIN}/pg_isready" -q -p "${PG_PORT}" >/dev/null 2>&1 && break
      sleep 1
    done
    "${PG_BIN}/pg_isready" -q -p "${PG_PORT}" >/dev/null 2>&1 \
      || die "PostgreSQL did not become ready on port ${PG_PORT}."
  fi
  ok "${PG_VERSION} running on port ${PG_PORT}"
fi

PSQL="${PG_BIN}/psql"
CREATEDB="${PG_BIN}/createdb"

# ── Role + database + pgvector extension (idempotent) ─────────
# Run as the cluster superuser (brew default = $USER) over the local socket.
info "Ensuring role '${PG_ROLE}', database '${PG_DB}', pgvector extension..."
"${PSQL}" -p "${PG_PORT}" -d postgres -v ON_ERROR_STOP=1 >/dev/null -c \
  "DO \$\$ BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='${PG_ROLE}') THEN
       CREATE ROLE \"${PG_ROLE}\" LOGIN PASSWORD '${PG_PASSWORD}';
     END IF;
   END \$\$;"

if ! "${PSQL}" -p "${PG_PORT}" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${PG_DB}'" | grep -q 1; then
  "${CREATEDB}" -p "${PG_PORT}" -O "${PG_ROLE}" "${PG_DB}"
fi

if ! "${PSQL}" -p "${PG_PORT}" -d "${PG_DB}" -v ON_ERROR_STOP=1 -c "CREATE EXTENSION IF NOT EXISTS vector;" >/dev/null 2>&1; then
  die "pgvector extension is not available for this PostgreSQL.
      Build it from source:
        git clone --depth 1 -b v0.8.4 https://github.com/pgvector/pgvector /tmp/pgvector
        cd /tmp/pgvector && make PG_CONFIG=${PG_BIN}/pg_config install
      then re-run this script."
fi
PGV="$("${PSQL}" -p "${PG_PORT}" -d "${PG_DB}" -tAc "SELECT extversion FROM pg_extension WHERE extname='vector'" 2>/dev/null || true)"
ok "pgvector ${PGV} installed in database '${PG_DB}'"

DATABASE_URL="postgresql://${PG_ROLE}:${PG_PASSWORD}@localhost:${PG_PORT}/${PG_DB}"
echo ""
ok "Native PostgreSQL ready (~100MB RAM, no Docker/colima)"
echo "DATABASE_URL=${DATABASE_URL}"
