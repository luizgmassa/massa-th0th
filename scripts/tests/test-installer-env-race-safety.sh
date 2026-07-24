#!/usr/bin/env bash
set -u

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "${SCRIPT_DIR}/../.." && pwd)"
# shellcheck source=scripts/lib/installer-env-transaction.sh
source "${PROJECT_ROOT}/scripts/lib/installer-env-transaction.sh"

PASS=0
FAIL=0
TEST_ROOT="$(mktemp -d "${TMPDIR:-/tmp}/massa-ai-installer-race.XXXXXX")"
trap 'rm -rf "$TEST_ROOT"' EXIT

ok() { printf '  ok - %s\n' "$*"; PASS=$((PASS + 1)); }
fail() { printf '  not ok - %s\n' "$*"; FAIL=$((FAIL + 1)); }

assert() {
    local label="$1"
    shift
    if "$@"; then ok "$label"; else fail "$label"; fi
}

wait_for_file() {
    local path="$1" attempts=0
    while [ ! -e "$path" ] && [ "$attempts" -lt 100 ]; do
        sleep 0.1
        attempts=$((attempts + 1))
    done
    [ -e "$path" ]
}

require_barrier() {
    local path="$1" pid="$2"
    if ! wait_for_file "$path"; then
        fail "publisher reached barrier ${path}"
        kill -TERM "$pid" 2>/dev/null || true
        wait "$pid" 2>/dev/null || true
        echo "Results: ${PASS} passed, ${FAIL} failed"
        exit 1
    fi
}

publish_text() {
    local target="$1" content="$2"
    printf '%s' "$content" | installer_env_publish "$target"
}

no_transaction_artifacts() {
    local target="$1"
    ! find "$(dirname "$target")" -maxdepth 1 \
        \( -name "$(basename "$target").candidate.*" \
        -o -name "$(basename "$target").bak.tmp.*" \
        -o -name "$(basename "$target").owner.*.tmp" \
        -o -name "$(basename "$target").install.lock*" \) | grep -q .
}

echo "Installer .env race-safety tests ($(uname -s))"

# AC1 + AC5: concurrent complete candidates serialize; backup remains a whole prior file.
case_dir="${TEST_ROOT}/concurrent writers with spaces"
mkdir -p "$case_dir"
target="${case_dir}/.env"
printf 'old-value\n' > "$target"
publish_text "$target" 'candidate-one
' >/dev/null 2>&1 & p1=$!
publish_text "$target" 'candidate-two
' >/dev/null 2>&1 & p2=$!
wait "$p1"; r1=$?
wait "$p2"; r2=$?
if { [ "$r1" -eq 0 ] || [ "$r2" -eq 0 ]; } &&
    { cmp -s "$target" <(printf 'candidate-one\n') || cmp -s "$target" <(printf 'candidate-two\n'); } &&
    { cmp -s "${target}.bak" <(printf 'old-value\n') ||
      cmp -s "${target}.bak" <(printf 'candidate-one\n') ||
      cmp -s "${target}.bak" <(printf 'candidate-two\n'); } &&
    no_transaction_artifacts "$target"; then
    ok "concurrent writers publish only complete env and backup files in spaced path"
else
    fail "concurrent writers publish only complete env and backup files in spaced path"
fi

# AC2: same-inode edit between snapshot and lock aborts without replacing edit.
case_dir="${TEST_ROOT}/content-edit"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'original\n' > "$target"
MASSA_AI_INSTALLER_TEST_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & pid=$!
require_barrier "${barrier}/candidate.ready" "$pid"
printf 'external-edit\n' > "$target"
: > "${barrier}/candidate.continue"
wait "$pid"; rc=$?
if [ "$rc" -ne 0 ] && cmp -s "$target" <(printf 'external-edit\n') && no_transaction_artifacts "$target"; then
    ok "external content edit aborts and remains untouched"
else
    fail "external content edit aborts and remains untouched"
fi

# AC2: inode replacement between snapshot and lock aborts without replacing replacement.
case_dir="${TEST_ROOT}/inode-edit"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'original\n' > "$target"
MASSA_AI_INSTALLER_TEST_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & pid=$!
require_barrier "${barrier}/candidate.ready" "$pid"
printf 'replacement\n' > "${case_dir}/replacement"
mv "${case_dir}/replacement" "$target"
: > "${barrier}/candidate.continue"
wait "$pid"; rc=$?
if [ "$rc" -ne 0 ] && cmp -s "$target" <(printf 'replacement\n') && no_transaction_artifacts "$target"; then
    ok "external inode replacement aborts and remains untouched"
else
    fail "external inode replacement aborts and remains untouched"
fi

# AC3: initial symlink and non-regular target/backup are rejected.
case_dir="${TEST_ROOT}/initial-types"; mkdir -p "$case_dir"
printf 'victim\n' > "${case_dir}/victim"
ln -s "${case_dir}/victim" "${case_dir}/.env"
if ! publish_text "${case_dir}/.env" 'candidate
' >/dev/null 2>&1 && cmp -s "${case_dir}/victim" <(printf 'victim\n'); then
    ok "initial env symlink is rejected"
else
    fail "initial env symlink is rejected"
fi
rm "${case_dir}/.env"; mkdir "${case_dir}/.env"
if publish_text "${case_dir}/.env" 'candidate
' >/dev/null 2>&1; then fail "publisher rejects non-regular env"; else ok "publisher rejects non-regular env"; fi
rm -rf "${case_dir}/.env" "${case_dir}/.env.bak"; printf 'old\n' > "${case_dir}/.env"; mkdir "${case_dir}/.env.bak"
if publish_text "${case_dir}/.env" 'candidate
' >/dev/null 2>&1; then fail "publisher rejects non-regular backup"; else ok "publisher rejects non-regular backup"; fi
rm -rf "${case_dir}/.env.bak"; ln -s "${case_dir}/victim" "${case_dir}/.env.bak"
if ! publish_text "${case_dir}/.env" 'candidate
' >/dev/null 2>&1 && cmp -s "${case_dir}/victim" <(printf 'victim\n'); then
    ok "initial backup symlink is rejected"
else
    fail "initial backup symlink is rejected"
fi

# AC3: target and backup swapped after lock acquisition are rejected.
case_dir="${TEST_ROOT}/swapped-target"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"; printf 'victim\n' > "${case_dir}/victim"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & pid=$!
require_barrier "${barrier}/locked.ready" "$pid"
mv "$target" "${case_dir}/original"; ln -s "${case_dir}/victim" "$target"
: > "${barrier}/locked.continue"; wait "$pid"; rc=$?
if [ "$rc" -ne 0 ] && [ -L "$target" ] && cmp -s "${case_dir}/victim" <(printf 'victim\n') &&
    cmp -s "${case_dir}/original" <(printf 'old\n'); then
    ok "lock-time env symlink swap is rejected"
else
    fail "lock-time env symlink swap is rejected"
fi

case_dir="${TEST_ROOT}/swapped-backup"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"; printf 'prior\n' > "${target}.bak"; printf 'victim\n' > "${case_dir}/victim"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & pid=$!
require_barrier "${barrier}/locked.ready" "$pid"
rm "${target}.bak"; ln -s "${case_dir}/victim" "${target}.bak"
: > "${barrier}/locked.continue"; wait "$pid"; rc=$?
if [ "$rc" -ne 0 ] && cmp -s "$target" <(printf 'old\n') &&
    cmp -s "${case_dir}/victim" <(printf 'victim\n'); then
    ok "lock-time backup symlink swap is rejected"
else
    fail "lock-time backup symlink swap is rejected"
fi

# Candidate digest is revalidated while holding the lock.
case_dir="${TEST_ROOT}/candidate-mutation"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & pid=$!
require_barrier "${barrier}/locked.ready" "$pid"
candidate_file="$(find "$case_dir" -maxdepth 1 -name '.env.candidate.*' -print | head -1)"
printf 'tampered\n' > "$candidate_file"
: > "${barrier}/locked.continue"; wait "$pid"; rc=$?
if [ "$rc" -ne 0 ] && cmp -s "$target" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "candidate mutation aborts before env replacement"
else
    fail "candidate mutation aborts before env replacement"
fi

# Ownership metadata is prepared before mkdir; TERM closes the empty-lock gap.
case_dir="${TEST_ROOT}/acquisition-gap-term"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_MKDIR_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & publisher_wrapper=$!
require_barrier "${barrier}/mkdir.ready" "$publisher_wrapper"
prepared_owner="$(find "$case_dir" -maxdepth 1 -name '.env.owner.*.tmp' -print | head -1)"
owner_pid="$(cut -d'|' -f2 "$prepared_owner")"
if kill -0 "$owner_pid" 2>/dev/null && [ "$owner_pid" != "$$" ] && [ "$owner_pid" != "$publisher_wrapper" ] &&
    [ ! -e "${target}.install.lock/owner" ]; then
    ok "prepared owner PID is live transaction, not harness or caller wrapper"
else
    fail "prepared owner PID is live transaction, not harness or caller wrapper"
fi
kill -TERM "$owner_pid"; wait "$publisher_wrapper" 2>/dev/null
if cmp -s "$target" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "TERM during mkdir-owner gap removes empty owned lock and temporaries"
else
    fail "TERM during mkdir-owner gap removes empty owned lock and temporaries"
fi

# An ownerless SIGKILL gap is deliberately unprovable and must time out.
case_dir="${TEST_ROOT}/acquisition-gap-kill"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_MKDIR_BARRIER_DIR="$barrier" publish_text "$target" 'candidate
' >/dev/null 2>&1 & publisher_wrapper=$!
require_barrier "${barrier}/mkdir.ready" "$publisher_wrapper"
prepared_owner="$(find "$case_dir" -maxdepth 1 -name '.env.owner.*.tmp' -print | head -1)"
owner_pid="$(cut -d'|' -f2 "$prepared_owner")"
kill -KILL "$owner_pid"; wait "$publisher_wrapper" 2>/dev/null
MASSA_AI_INSTALLER_STALE_LOCK_SECONDS=0 MASSA_AI_INSTALLER_LOCK_TIMEOUT_SECONDS=1 \
    publish_text "$target" 'must-not-publish
' >/dev/null 2>&1; unknown_rc=$?
if [ "$unknown_rc" -ne 0 ] && [ -d "${target}.install.lock" ] &&
    [ ! -e "${target}.install.lock/owner" ] && cmp -s "$target" <(printf 'old\n'); then
    ok "ownerless SIGKILL lock times out without unsafe reclamation"
else
    fail "ownerless SIGKILL lock times out without unsafe reclamation"
fi
rm -f "$case_dir"/.env.candidate.* "$case_dir"/.env.owner.*.tmp
rmdir "${target}.install.lock"

# AC4: live lock cannot be reclaimed, even with zero stale-age threshold.
case_dir="${TEST_ROOT}/live-lock"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'holder
' >/dev/null 2>&1 & holder=$!
require_barrier "${barrier}/locked.ready" "$holder"
MASSA_AI_INSTALLER_STALE_LOCK_SECONDS=0 MASSA_AI_INSTALLER_LOCK_TIMEOUT_SECONDS=1 \
    publish_text "$target" 'contender
' >/dev/null 2>&1; contender_rc=$?
if [ "$contender_rc" -ne 0 ] && [ -d "${target}.install.lock" ]; then
    ok "live owner lock times out without reclamation"
else
    fail "live owner lock times out without reclamation"
fi
: > "${barrier}/locked.continue"; wait "$holder"

# AC4 + AC6: SIGKILL leaves proof-bearing lock; retry reclaims lock and candidate.
case_dir="${TEST_ROOT}/dead-lock"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'killed
' >/dev/null 2>&1 & killed=$!
require_barrier "${barrier}/locked.ready" "$killed"
owner_pid="$(cut -d'|' -f2 "${target}.install.lock/owner")"
kill -KILL "$owner_pid"; wait "$killed" 2>/dev/null
if [ -d "${target}.install.lock" ]; then ok "SIGKILL leaves owner metadata for proof"; else fail "SIGKILL leaves owner metadata for proof"; fi
MASSA_AI_INSTALLER_STALE_LOCK_SECONDS=0 publish_text "$target" 'recovered
' >/dev/null 2>&1; retry_rc=$?
if [ "$retry_rc" -eq 0 ] && cmp -s "$target" <(printf 'recovered\n') &&
    cmp -s "${target}.bak" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "proven-dead lock is reclaimed with stale candidate cleanup"
else
    fail "proven-dead lock is reclaimed with stale candidate cleanup"
fi

# SIGKILL after backup-temp creation is recoverable without publishing candidate.
case_dir="${TEST_ROOT}/dead-backup-temp"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_BACKUP_BARRIER_DIR="$barrier" publish_text "$target" 'killed
' >/dev/null 2>&1 & killed=$!
require_barrier "${barrier}/backup.ready" "$killed"
owner_pid="$(cut -d'|' -f2 "${target}.install.lock/owner")"
kill -KILL "$owner_pid"; wait "$killed" 2>/dev/null
if cmp -s "$target" <(printf 'old\n') && find "$case_dir" -maxdepth 1 -name '.env.bak.tmp.*' | grep -q .; then
    ok "SIGKILL after backup staging leaves env unchanged"
else
    fail "SIGKILL after backup staging leaves env unchanged"
fi
MASSA_AI_INSTALLER_STALE_LOCK_SECONDS=0 publish_text "$target" 'recovered
' >/dev/null 2>&1; retry_rc=$?
if [ "$retry_rc" -eq 0 ] && cmp -s "$target" <(printf 'recovered\n') &&
    cmp -s "${target}.bak" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "retry removes dead owner backup temp and publishes exact backup"
else
    fail "retry removes dead owner backup temp and publishes exact backup"
fi

# SIGKILL after atomic backup publication must leave target and backup exact.
case_dir="${TEST_ROOT}/dead-after-backup-publish"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_BACKUP_PUBLISH_BARRIER_DIR="$barrier" publish_text "$target" 'killed
' >/dev/null 2>&1 & killed=$!
require_barrier "${barrier}/backup-published.ready" "$killed"
owner_pid="$(cut -d'|' -f2 "${target}.install.lock/owner")"
kill -KILL "$owner_pid"; wait "$killed" 2>/dev/null
if cmp -s "$target" <(printf 'old\n') && cmp -s "${target}.bak" <(printf 'old\n'); then
    ok "SIGKILL after backup publication preserves old target and exact backup"
else
    fail "SIGKILL after backup publication preserves old target and exact backup"
fi
MASSA_AI_INSTALLER_STALE_LOCK_SECONDS=0 publish_text "$target" 'recovered
' >/dev/null 2>&1; retry_rc=$?
if [ "$retry_rc" -eq 0 ] && cmp -s "$target" <(printf 'recovered\n') &&
    cmp -s "${target}.bak" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "retry after published-backup SIGKILL cleans stale state"
else
    fail "retry after published-backup SIGKILL cleans stale state"
fi

# AC6: TERM cleans owned files; changed owner token preserves foreign lock.
case_dir="${TEST_ROOT}/term-cleanup"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'term
' >/dev/null 2>&1 & term_pid=$!
require_barrier "${barrier}/locked.ready" "$term_pid"
owner_pid="$(cut -d'|' -f2 "${target}.install.lock/owner")"
kill -TERM "$owner_pid"; wait "$term_pid" 2>/dev/null
if cmp -s "$target" <(printf 'old\n') && no_transaction_artifacts "$target"; then
    ok "TERM removes owned candidate and lock while preserving env"
else
    fail "TERM removes owned candidate and lock while preserving env"
fi

case_dir="${TEST_ROOT}/foreign-lock"; barrier="${case_dir}/barrier"; mkdir -p "$case_dir"
target="${case_dir}/.env"; printf 'old\n' > "$target"
MASSA_AI_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR="$barrier" publish_text "$target" 'term
' >/dev/null 2>&1 & term_pid=$!
require_barrier "${barrier}/locked.ready" "$term_pid"
owner="${target}.install.lock/owner"
IFS='|' read -r oh op os _old_token ots oc ob < "$owner"
printf '%s|%s|%s|%s|%s|%s|%s\n' "$oh" "$op" "$os" "foreign-token" "$ots" "$oc" "$ob" > "$owner"
kill -TERM "$op"; wait "$term_pid" 2>/dev/null
if [ -d "${target}.install.lock" ] && cmp -s "$target" <(printf 'old\n') &&
    ! find "$case_dir" -maxdepth 1 -name '.env.candidate.*' | grep -q .; then
    ok "TERM cleanup preserves lock after ownership token changes"
else
    fail "TERM cleanup preserves lock after ownership token changes"
fi
rm -f "$owner"; rmdir "${target}.install.lock"

echo "Results: ${PASS} passed, ${FAIL} failed"
[ "$FAIL" -eq 0 ]
