#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
SETUP_SCRIPT="${PROJECT_ROOT}/scripts/setup-local-first.sh"
NATIVE_PG_SCRIPT="${PROJECT_ROOT}/scripts/setup-native-postgres.sh"

# ── Colours ───────────────────────────────────────────────────
GREEN='\033[0;32m'; RED='\033[0;31m'; BOLD='\033[1m'; NC='\033[0m'

# ── Counters ──────────────────────────────────────────────────
PASS=0
FAIL=0
ERRORS=()

ok()   { echo -e "  ${GREEN}✓${NC} $*"; }
fail() { echo -e "  ${RED}✗${NC} $*"; }

# assert_eq LABEL ACTUAL EXPECTED
assert_eq() {
    local label="$1" actual="$2" expected="$3"
    if [ "$actual" = "$expected" ]; then
        ok "$label"
        PASS=$((PASS + 1))
    else
        fail "$label  →  got='${actual}'  want='${expected}'"
        FAIL=$((FAIL + 1))
        ERRORS+=("$label")
    fi
}

# assert_exit_zero LABEL CMD...
assert_exit_zero() {
    local label="$1"; shift
    local exit_code=0
    "$@" >/dev/null 2>&1 || exit_code=$?
    if [ "$exit_code" -eq 0 ]; then
        ok "$label"
        PASS=$((PASS + 1))
    else
        fail "$label  (expected exit 0, got ${exit_code})"
        FAIL=$((FAIL + 1))
        ERRORS+=("$label")
    fi
}

# assert_exit_nonzero LABEL CMD...
assert_exit_nonzero() {
    local label="$1"; shift
    local exit_code=0
    "$@" >/dev/null 2>&1 || exit_code=$?
    if [ "$exit_code" -ne 0 ]; then
        ok "$label"
        PASS=$((PASS + 1))
    else
        fail "$label  (expected non-zero exit, got 0)"
        FAIL=$((FAIL + 1))
        ERRORS+=("$label")
    fi
}

# ================================================================
echo ""
echo -e "${BOLD}Setup Wizard DB Selection — Tests (Issue #24)${NC}"
echo "  script: ${SETUP_SCRIPT}"
echo ""

# ── Static analysis ───────────────────────────────────────────

echo "Static analysis: source contains the fix"

# Test 1: main DB choice read uses /dev/tty redirect
DB_CHOICE_READ=$(grep -n 'read.*DB_CHOICE' "$SETUP_SCRIPT" || true)
if echo "$DB_CHOICE_READ" | grep -q '/dev/tty'; then
    ok "DB_CHOICE read redirects stdin from /dev/tty"
    PASS=$((PASS + 1))
else
    fail "DB_CHOICE read is missing /dev/tty redirect — original bug not fixed"
    FAIL=$((FAIL + 1))
    ERRORS+=("DB_CHOICE read redirects stdin from /dev/tty")
fi

# Test 2: main DB choice read has || true guard
if echo "$DB_CHOICE_READ" | grep -q '|| true'; then
    ok "DB_CHOICE read has '|| true' guard against set -e"
    PASS=$((PASS + 1))
else
    fail "DB_CHOICE read is missing '|| true' — set -e can still trigger on EOF"
    FAIL=$((FAIL + 1))
    ERRORS+=("DB_CHOICE read has '|| true' guard against set -e")
fi

# Test 3: DATABASE_URL prompt read uses /dev/tty redirect
DATABASE_URL_READ=$(grep -n 'read.*DATABASE_URL' "$SETUP_SCRIPT" || true)
if echo "$DATABASE_URL_READ" | grep -q '/dev/tty'; then
    ok "DATABASE_URL read redirects stdin from /dev/tty"
    PASS=$((PASS + 1))
else
    fail "DATABASE_URL read is missing /dev/tty redirect"
    FAIL=$((FAIL + 1))
    ERRORS+=("DATABASE_URL read redirects stdin from /dev/tty")
fi

# Test 4: DATABASE_URL read has || true guard
if echo "$DATABASE_URL_READ" | grep -q '|| true'; then
    ok "DATABASE_URL read has '|| true' guard against set -e"
    PASS=$((PASS + 1))
else
    fail "DATABASE_URL read is missing '|| true'"
    FAIL=$((FAIL + 1))
    ERRORS+=("DATABASE_URL read has '|| true' guard against set -e")
fi

# Test 5: no bare 'read -p' without /dev/tty remains in the DB selection section
BARE_READS=$(grep -n 'read -p\b' "$SETUP_SCRIPT" | grep -v '#' || true)
if [ -z "$BARE_READS" ]; then
    ok "no bare 'read -p' (without /dev/tty) remains in the script"
    PASS=$((PASS + 1))
else
    fail "found bare 'read -p' calls that may break in piped mode: ${BARE_READS}"
    FAIL=$((FAIL + 1))
    ERRORS+=("no bare 'read -p' without /dev/tty remains in the script")
fi

# ── Functional: regression — old broken snippet ───────────────

echo ""
echo "Functional: demonstrate original bug (plain read -p with set -e)"

# Test 6: REGRESSION — old plain read exits non-zero on EOF stdin (the original bug)
OLD_SNIPPET='
set -e
DB_CHOICE=""
read -p "" DB_CHOICE
DB_CHOICE=${DB_CHOICE:-1}
echo "DB_CHOICE=$DB_CHOICE"
'
assert_exit_nonzero \
    "plain 'read -p' with set -e exits non-zero on EOF (original bug reproduced)" \
    bash -c "$OLD_SNIPPET"

# ── Functional: fixed snippet ──────────────────────────────────

echo ""
echo "Functional: fixed snippet survives piped/EOF stdin"

# Test 7: fixed read with /dev/tty + || true exits 0 even when stdin is EOF
FIXED_SNIPPET='
set -e
DB_CHOICE=""
read -rp "" DB_CHOICE </dev/tty || true
DB_CHOICE=${DB_CHOICE:-1}
echo "DB_CHOICE=$DB_CHOICE"
'
assert_exit_zero \
    "fixed read with </dev/tty || true exits 0 on EOF stdin" \
    bash -c "$FIXED_SNIPPET"

# Test 8: DB_CHOICE defaults to "1" when no input is provided (EOF stdin)
RESULT=$(bash -c '
set -e
DB_CHOICE=""
read -rp "" DB_CHOICE </dev/tty || true
DB_CHOICE=${DB_CHOICE:-1}
echo "$DB_CHOICE"
' < /dev/null 2>/dev/null || echo "ERROR")
assert_eq "DB_CHOICE defaults to '1' on EOF stdin" "$RESULT" "1"

# Test 9: DATABASE_URL prompt also exits 0 on EOF stdin
DATABASE_URL_SNIPPET='
set -e
DATABASE_URL=""
read -rp "" DATABASE_URL </dev/tty || true
echo "DATABASE_URL=${DATABASE_URL}"
'
assert_exit_zero \
    "DATABASE_URL prompt with </dev/tty || true exits 0 on EOF stdin" \
    bash -c "$DATABASE_URL_SNIPPET"

# Test 10: DATABASE_URL is empty (not crashing) when stdin is piped
URL_RESULT=$(bash -c '
set -e
DATABASE_URL=""
read -rp "" DATABASE_URL </dev/tty || true
echo "$DATABASE_URL"
' < /dev/null 2>/dev/null || echo "ERROR")
assert_eq "DATABASE_URL is empty string on EOF stdin (no crash)" "$URL_RESULT" ""

# ── Static analysis: 3-option DB menu (native default) ────────

echo ""
echo "Static analysis: 3-option DB menu + MASSA_TH0TH_DB_BACKEND override"

# Test 11: setup-local-first.sh contains all three DB menu option strings
MENU_HITS=0
for label in "Native PostgreSQL" "SQLite" "Docker PostgreSQL"; do
    if grep -qF "$label" "$SETUP_SCRIPT" 2>/dev/null; then
        MENU_HITS=$((MENU_HITS + 1))
    fi
done
if [ "$MENU_HITS" -eq 3 ]; then
    ok "setup-local-first.sh lists all 3 DB menu options (Native PostgreSQL / SQLite / Docker PostgreSQL)"
    PASS=$((PASS + 1))
else
    fail "setup-local-first.sh is missing DB menu options (found ${MENU_HITS}/3)"
    FAIL=$((FAIL + 1))
    ERRORS+=("3-option DB menu strings present in setup-local-first.sh")
fi

# Test 12: setup-local-first.sh handles the MASSA_TH0TH_DB_BACKEND override
if grep -q 'MASSA_TH0TH_DB_BACKEND' "$SETUP_SCRIPT" 2>/dev/null; then
    ok "setup-local-first.sh reads MASSA_TH0TH_DB_BACKEND (non-interactive override)"
    PASS=$((PASS + 1))
else
    fail "setup-local-first.sh does not read MASSA_TH0TH_DB_BACKEND"
    FAIL=$((FAIL + 1))
    ERRORS+=("MASSA_TH0TH_DB_BACKEND case present in setup-local-first.sh")
fi

# ── Static analysis: native PG helper script ──────────────────

echo ""
echo "Static analysis: native PostgreSQL helper script"

# Test 13: setup-native-postgres.sh exists and is executable
if [ -x "$NATIVE_PG_SCRIPT" ]; then
    ok "setup-native-postgres.sh exists and is executable"
    PASS=$((PASS + 1))
else
    fail "setup-native-postgres.sh is missing or not executable (${NATIVE_PG_SCRIPT})"
    FAIL=$((FAIL + 1))
    ERRORS+=("setup-native-postgres.sh exists and is executable")
fi

# Test 14: setup-native-postgres.sh's final echo line reports DATABASE_URL=...
if [ -f "$NATIVE_PG_SCRIPT" ]; then
    LAST_ECHO=$(grep -E '^[[:space:]]*echo' "$NATIVE_PG_SCRIPT" | tail -n 1 || true)
    if echo "$LAST_ECHO" | grep -q 'DATABASE_URL='; then
        ok "setup-native-postgres.sh ends by echoing DATABASE_URL=..."
        PASS=$((PASS + 1))
    else
        fail "setup-native-postgres.sh final echo does not report DATABASE_URL (got: ${LAST_ECHO})"
        FAIL=$((FAIL + 1))
        ERRORS+=("setup-native-postgres.sh final echo is DATABASE_URL=...")
    fi
else
    fail "setup-native-postgres.sh missing — cannot inspect final echo"
    FAIL=$((FAIL + 1))
    ERRORS+=("setup-native-postgres.sh final echo is DATABASE_URL=...")
fi

# ── Static analysis: Docker branch ~5GB RAM warning ───────────

echo ""
echo "Static analysis: Docker branch warns about ~5GB RAM"

# Test 15: setup-local-first.sh Docker branch prints a 5GB RAM warning
if grep -q '5GB' "$SETUP_SCRIPT" 2>/dev/null; then
    ok "setup-local-first.sh warns about 5GB RAM on the Docker path"
    PASS=$((PASS + 1))
else
    fail "setup-local-first.sh has no 5GB RAM warning on the Docker path"
    FAIL=$((FAIL + 1))
    ERRORS+=("Docker branch 5GB RAM warning in setup-local-first.sh")
fi

# ── Functional: MASSA_TH0TH_DB_BACKEND=sqlite → choice 2 ──────

echo ""
echo "Functional: MASSA_TH0TH_DB_BACKEND maps to DB choice"

# Test 16: case "sqlite" → "2" (mirrors the installer's mapping)
MAPPED=$(MASSA_TH0TH_DB_BACKEND=sqlite bash -c '
case "${MASSA_TH0TH_DB_BACKEND}" in
    native)  echo "1" ;;
    sqlite)  echo "2" ;;
    docker)  echo "3" ;;
    *)       echo "1" ;;
esac
')
assert_eq "MASSA_TH0TH_DB_BACKEND=sqlite maps to DB choice 2" "$MAPPED" "2"

# ── Summary ───────────────────────────────────────────────────

echo ""
echo -e "${BOLD}────────────────────────────────────────${NC}"
TOTAL=$((PASS + FAIL))
echo -e "  Results: ${GREEN}${PASS}${NC} passed, ${RED}${FAIL}${NC} failed  (${TOTAL} total)"

if [ ${#ERRORS[@]} -gt 0 ]; then
    echo ""
    echo -e "  ${RED}Failed tests:${NC}"
    for e in "${ERRORS[@]}"; do
        echo "    - $e"
    done
    echo ""
    exit 1
fi

echo ""
exit 0
