#!/usr/bin/env bash

# Sourceable Bash 3.2-compatible transaction for installer-owned .env files.
# Usage: installer_env_publish /path/to/.env <<EOF
#        ...candidate content...
#        EOF

installer_env_error() {
    printf 'installer env: %s\n' "$*" >&2
}

installer_env_sha256() {
    if command -v shasum >/dev/null 2>&1; then
        shasum -a 256 "$1" | awk '{print $1}'
    elif command -v sha256sum >/dev/null 2>&1; then
        sha256sum "$1" | awk '{print $1}'
    else
        installer_env_error "SHA-256 tool unavailable (need shasum or sha256sum)"
        return 1
    fi
}

installer_env_stat() {
    case "$(uname -s)" in
        Darwin) stat -f '%d|%i|%HT|%z|%m' "$1" ;;
        *) stat -c '%d|%i|%F|%s|%Y' "$1" ;;
    esac
}

installer_env_validate_target() {
    local path="$1" label="$2"
    if [ -L "$path" ]; then
        installer_env_error "${label} must not be a symlink: ${path}"
        return 1
    fi
    if [ -e "$path" ] && [ ! -f "$path" ]; then
        installer_env_error "${label} must be a regular file: ${path}"
        return 1
    fi
}

installer_env_snapshot() {
    local path="$1" metadata digest
    installer_env_validate_target "$path" ".env" || return 1
    if [ ! -e "$path" ]; then
        printf 'missing'
        return 0
    fi
    metadata="$(installer_env_stat "$path")" || return 1
    digest="$(installer_env_sha256 "$path")" || return 1
    printf 'regular|%s|symlink=0|sha256=%s' "$metadata" "$digest"
}

installer_env_process_start() {
    ps -p "$1" -o lstart= 2>/dev/null | sed 's/^[[:space:]]*//;s/[[:space:]]*$//'
}

installer_env_random_token() {
    local token
    token="$(od -An -N16 -tx1 /dev/urandom 2>/dev/null | tr -d '[:space:]')"
    [ -n "$token" ] || return 1
    printf '%s' "$token"
}

installer_env_read_owner() {
    local owner_file="$1"
    [ -f "$owner_file" ] && [ ! -L "$owner_file" ] || return 1
    IFS='|' read -r INSTALLER_OWNER_HOST INSTALLER_OWNER_PID \
        INSTALLER_OWNER_START INSTALLER_OWNER_TOKEN INSTALLER_OWNER_TIMESTAMP \
        INSTALLER_OWNER_CANDIDATE INSTALLER_OWNER_BACKUP_TEMP < "$owner_file" || return 1
    [ -n "$INSTALLER_OWNER_HOST" ] &&
        [ -n "$INSTALLER_OWNER_PID" ] &&
        [ -n "$INSTALLER_OWNER_START" ] &&
        [ -n "$INSTALLER_OWNER_TOKEN" ] &&
        [ -n "$INSTALLER_OWNER_TIMESTAMP" ] || return 1
    case "$INSTALLER_OWNER_PID:$INSTALLER_OWNER_TIMESTAMP" in
        *[!0-9:]*|:*|*:) return 1 ;;
    esac
}

installer_env_release_lock() {
    local lock_dir="$1" token="$2" owner_file="${1}/owner"
    installer_env_read_owner "$owner_file" || return 0
    [ "$INSTALLER_OWNER_TOKEN" = "$token" ] || return 0
    rm -f "$owner_file"
    rmdir "$lock_dir" 2>/dev/null || true
}

installer_env_lock_owner_is_proven_dead() {
    local owner_file="$1" stale_after="$2" expected_token="$3"
    local now age current_start local_host
    installer_env_read_owner "$owner_file" || return 1
    [ "$INSTALLER_OWNER_TOKEN" = "$expected_token" ] || return 1
    local_host="$(hostname 2>/dev/null || uname -n)"
    [ "$INSTALLER_OWNER_HOST" = "$local_host" ] || return 1
    now="$(date +%s)"
    age=$((now - INSTALLER_OWNER_TIMESTAMP))
    [ "$age" -ge "$stale_after" ] || return 1
    current_start="$(installer_env_process_start "$INSTALLER_OWNER_PID")"
    [ -z "$current_start" ] || [ "$current_start" != "$INSTALLER_OWNER_START" ]
}

installer_env_try_reclaim_lock() {
    local lock_dir="$1" stale_after="$2" base="$3" observed_token
    local reclaim_dir stale_candidate stale_backup_temp child_count
    installer_env_read_owner "${lock_dir}/owner" || return 1
    observed_token="$INSTALLER_OWNER_TOKEN"
    installer_env_lock_owner_is_proven_dead "${lock_dir}/owner" "$stale_after" "$observed_token" || return 1
    child_count="$(find "$lock_dir" -mindepth 1 -maxdepth 1 -print 2>/dev/null | wc -l | tr -d '[:space:]')"
    [ "$child_count" = "1" ] || return 1
    installer_env_read_owner "${lock_dir}/owner" || return 1
    [ "$INSTALLER_OWNER_TOKEN" = "$observed_token" ] || return 1
    stale_candidate="$INSTALLER_OWNER_CANDIDATE"
    stale_backup_temp="$INSTALLER_OWNER_BACKUP_TEMP"
    reclaim_dir="${lock_dir}.reclaim.${observed_token}"
    mv "$lock_dir" "$reclaim_dir" 2>/dev/null || return 1
    rm -f "${reclaim_dir}/owner"
    rmdir "$reclaim_dir" 2>/dev/null || return 1
    case "$stale_candidate" in
        "${base}.candidate."*)
            if [ -f "$stale_candidate" ] && [ ! -L "$stale_candidate" ]; then
                rm -f "$stale_candidate"
            fi
            ;;
    esac
    if [ "$stale_backup_temp" = "${base}.bak.tmp.${observed_token}" ] &&
        [ -f "$stale_backup_temp" ] && [ ! -L "$stale_backup_temp" ]; then
        rm -f "$stale_backup_temp"
    fi
    return 0
}

installer_env_test_barrier() {
    local barrier_dir="$1" phase="$2" waited=0 limit
    [ -n "$barrier_dir" ] || return 0
    limit="${MASSA_TH0TH_INSTALLER_TEST_BARRIER_TIMEOUT:-15}"
    mkdir -p "$barrier_dir"
    : > "${barrier_dir}/${phase}.ready"
    while [ ! -e "${barrier_dir}/${phase}.continue" ]; do
        [ "$waited" -lt "$limit" ] || {
            installer_env_error "test barrier timed out: ${phase}"
            return 1
        }
        sleep 1
        waited=$((waited + 1))
    done
}

installer_env_publish() (
    set -e

    local target="$1" target_dir base backup lock_dir candidate backup_temp
    local initial_snapshot candidate_digest current_snapshot token host process_start timestamp owner_pid
    local lock_timeout stale_after started owner_temp acquired=0
    target_dir="$(dirname "$target")"
    base="$(basename "$target")"
    backup="${target}.bak"
    lock_dir="${target}.install.lock"
    candidate=""
    backup_temp=""
    owner_temp=""
    token=""

    # shellcheck disable=SC2329 # Invoked indirectly by EXIT trap below.
    installer_env_cleanup_transaction() {
        [ -z "$candidate" ] || rm -f "$candidate"
        [ -z "$backup_temp" ] || rm -f "$backup_temp"
        [ -z "$owner_temp" ] || rm -f "$owner_temp"
        if [ "$acquired" = "1" ] && [ -n "$token" ]; then
            installer_env_release_lock "$lock_dir" "$token"
        fi
    }
    trap installer_env_cleanup_transaction EXIT
    trap 'exit 129' HUP
    trap 'exit 130' INT
    trap 'exit 143' TERM

    [ -d "$target_dir" ] || {
        installer_env_error "target directory does not exist: ${target_dir}"
        exit 1
    }
    installer_env_validate_target "$target" ".env" || exit 1
    installer_env_validate_target "$backup" ".env.bak" || exit 1
    initial_snapshot="$(installer_env_snapshot "$target")" || exit 1

    candidate="$(mktemp "${target}.candidate.XXXXXX")" || exit 1
    cat > "$candidate" || exit 1
    candidate_digest="$(installer_env_sha256 "$candidate")" || exit 1
    installer_env_test_barrier "${MASSA_TH0TH_INSTALLER_TEST_BARRIER_DIR:-}" "candidate" || exit 1

    token="$(installer_env_random_token)" || {
        installer_env_error "could not create lock token"
        exit 1
    }
    host="$(hostname 2>/dev/null || uname -n)"
    backup_temp="${backup}.tmp.${token}"
    lock_timeout="${MASSA_TH0TH_INSTALLER_LOCK_TIMEOUT_SECONDS:-30}"
    stale_after="${MASSA_TH0TH_INSTALLER_STALE_LOCK_SECONDS:-300}"
    started="$(date +%s)"

    while ! mkdir "$lock_dir" 2>/dev/null; do
        installer_env_read_owner "${lock_dir}/owner" 2>/dev/null || true
        if [ -n "${INSTALLER_OWNER_TOKEN:-}" ]; then
            installer_env_try_reclaim_lock "$lock_dir" "$stale_after" "$target" || true
        fi
        [ $(( $(date +%s) - started )) -lt "$lock_timeout" ] || {
            installer_env_error "timed out waiting for installer lock: ${lock_dir}"
            exit 1
        }
        sleep 1
    done
    acquired=1
    owner_temp="${lock_dir}/owner.${token}.tmp"
    sh -c 'printf %s "$PPID"' > "$owner_temp" || exit 1
    owner_pid="$(sed -n '1p' "$owner_temp")" || exit 1
    process_start="$(installer_env_process_start "$owner_pid")" || exit 1
    [ -n "$process_start" ] || {
        installer_env_error "could not determine installer process identity"
        exit 1
    }
    timestamp="$(date +%s)"
    printf '%s|%s|%s|%s|%s|%s|%s\n' \
        "$host" "$owner_pid" "$process_start" "$token" "$timestamp" "$candidate" "$backup_temp" > "$owner_temp" || exit 1
    mv "$owner_temp" "${lock_dir}/owner" || exit 1
    owner_temp=""

    installer_env_test_barrier "${MASSA_TH0TH_INSTALLER_TEST_AFTER_LOCK_BARRIER_DIR:-}" "locked" || exit 1
    installer_env_validate_target "$target" ".env" || exit 1
    installer_env_validate_target "$backup" ".env.bak" || exit 1
    [ "$(installer_env_sha256 "$candidate")" = "$candidate_digest" ] || {
        installer_env_error "candidate changed before publish: ${candidate}"
        exit 1
    }
    current_snapshot="$(installer_env_snapshot "$target")" || exit 1
    [ "$current_snapshot" = "$initial_snapshot" ] || {
        installer_env_error ".env changed before publish: ${target}"
        exit 1
    }

    if [ "$initial_snapshot" != "missing" ]; then
        (umask 077; set -C; : > "$backup_temp") || {
            installer_env_error "could not create backup temporary: ${backup_temp}"
            exit 1
        }
        cp "$target" "$backup_temp" || exit 1
        [ "$(installer_env_sha256 "$backup_temp")" = "$(installer_env_sha256 "$target")" ] || {
            installer_env_error "backup verification failed: ${backup_temp}"
            exit 1
        }
        installer_env_test_barrier "${MASSA_TH0TH_INSTALLER_TEST_AFTER_BACKUP_BARRIER_DIR:-}" "backup" || exit 1
        mv "$backup_temp" "$backup" || exit 1
        backup_temp=""
        [ "$(installer_env_sha256 "$backup")" = "$(installer_env_sha256 "$target")" ] || {
            installer_env_error "published backup verification failed: ${backup}"
            exit 1
        }
    fi

    current_snapshot="$(installer_env_snapshot "$target")" || exit 1
    [ "$current_snapshot" = "$initial_snapshot" ] || {
        installer_env_error ".env changed during backup publication: ${target}"
        exit 1
    }
    mv "$candidate" "$target" || exit 1
    candidate=""
)
