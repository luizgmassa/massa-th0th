# M19 — Installer Race Safety Validation

**Date**: 2026-07-19
**Diff range**: `4ffe39d..3cbf184`
**Verifier**: independent sub-agent (author ≠ verifier)
**Verdict**: BLOCKED — code PASS on native macOS; mandatory Debian 12 amd64 evidence unavailable

## Task Completion

| Task | Status | Evidence |
| --- | --- | --- |
| TASK-M19-1 | Done | commits `4a2f0f3`, `3cbf184`; macOS harness 22/22 |
| TASK-M19-2 | Blocked | native Debian 12 amd64 AC7 not run |

## Acceptance Evidence

| AC | Test evidence | Result |
| --- | --- | --- |
| AC1 | `scripts/tests/test-installer-env-race-safety.sh:58` concurrent publishers; lines 69-78 assert complete target/backup and cleanup | PASS macOS |
| AC2 | lines 80-109 assert content and inode replacement abort with external bytes preserved | PASS macOS |
| AC3 | lines 111-162 assert initial/swapped symlink and non-regular target/backup rejection | PASS macOS |
| AC4 | owner PID, live timeout, SIGKILL, and proven-dead reclaim blocks | PASS macOS |
| AC5 | exact `cmp` assertions across dead-lock, backup staging, and published-backup recovery | PASS macOS |
| AC6 | TERM acquisition/transaction cleanup and foreign-token lock preservation blocks | PASS macOS |
| AC7 | unchanged harness on native Debian 12 amd64 | BLOCKED — runner unavailable |
| AC8 | candidate mutation plus ownerless, staging, and published-backup kill/retry blocks | PASS macOS |

## Gate Evidence

- Native macOS focused harness: 22 passed, 0 failed.
- `shellcheck` for new helper/harness: 2 files passed.
- Bash syntax: both installers, helper, and harness passed.
- `git diff --check`: passed.
- Existing `scripts/tests/test-setup-wizard-db-selection.sh`: pre-existing 10/11 failure (`migrations fail closed` matcher); untouched and outside M19 gate.
- UAT: not applicable; installer transaction is covered by deterministic shell sensors.

## Discrimination Sensor

Three scratch-only mutations were killed: candidate-digest bypass, snapshot-equality bypass, and ownership-token bypass. Scratch artifacts were removed. No mutation touched the real worktree.

## Integrity And Risk

Tests, specs, fixtures, snapshots, schemas, public contracts, and validator checks were not weakened. Same-filesystem rename gives atomic visibility; power-loss durability is out of scope because portable Bash cannot guarantee file/directory fsync ordering on both targets. Remaining blocker: unchanged harness must pass on true/native Debian 12 amd64.
