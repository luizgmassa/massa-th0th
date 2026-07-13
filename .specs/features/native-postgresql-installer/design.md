# Native PostgreSQL Installer — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/change-the-installers-to-cozy-scroll.md`.

## Intent and scope

The plan proposed a macOS/Homebrew native PostgreSQL (`postgresql@17` +
`pgvector`) path as the recommended setup default, while retaining SQLite and
Docker PostgreSQL. It also proposed an explicit Docker/colima ~5GB RAM warning,
non-interactive backend selection, matching installer documentation, and a
wizard test update.

## Implemented outcome

Full-history commit inspection within
`c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`
shows the feature landed in `c730076`, then received a subprocess-PATH repair in
`3f6bfa3`. Later commits retained or documented its DB knobs; they did not
replace the three-backend design.

Verified from the diffs:

- `scripts/setup-native-postgres.sh` was added as a macOS/Homebrew helper. It
  detects a reachable PostgreSQL, otherwise installs/starts `postgresql@17`,
  creates the configured role/database, enables `vector`, and prints a
  `DATABASE_URL`.
- `scripts/setup-local-first.sh` gained native (default), SQLite, and Docker
  choices plus `MASSA_TH0TH_DB_BACKEND=native|sqlite|docker`. Its Docker branch
  prints the ~5GB warning; native-helper failure falls back to a manual URL.
- `install.sh`, `.env.example`, `README.md`, and
  `skills/massa-th0th-memory/SKILL.md` received native-vs-Docker guidance and
  database-setting documentation.
- `scripts/tests/test-setup-wizard-db-selection.sh` was extended with menu,
  helper-presence, Docker-warning, and backend-mapping assertions.

## Commit evidence

### Direct implementation

- `c7300766d44f2c1293004787a9ca2919912b93b7` — `feat(install): native PostgreSQL option + Docker/colima ~5GB RAM warning`
  - Added the native helper and wizard test; changed the five installer and
    documentation surfaces named above.
  - Diff evidence establishes the three-option menu, default-native mapping,
    Docker warning, environment knob, and documentation updates.

- `3f6bfa3f49068b17b32db866112329765dabeed7` — `fix(install): make native PG helper robust as a subprocess`
  - Prepended standard Homebrew locations to `PATH` safely under `set -e` and
    added a native-helper self-diagnosis hint in the wizard.
  - Its commit message reports fresh-install/migration/diagnostic success; that
    execution result is a commit claim, not independently rerun for this record.

### Follow-up preservation

- `62281b1cdc11c01e7fe29ba8058b50d8d9fc215c` — `feat(install): regenerate configs with backups, reorder modes, source clone-path prompt`
  - Kept source setup as the route that offers SQLite, native PostgreSQL, or
    Docker, while changing config-regeneration and top-level mode behavior.

- `0455084fd9c5f5e1c93c566cd50023325116d701` — `feat(llm): per-task model routing (qwen2.5 swap) + read_file cache/abs-path fixes`
  - Retained README native-PostgreSQL guidance and the database environment
    rows while updating unrelated LLM documentation.

- `614bf91e5c72cf25c76f465846768bc7351c18f1` — `docs: add operational knobs + e2e/observation notes`
  - Preserved README rows for `DATABASE_URL`, `VECTOR_STORE_TYPE`,
    `POSTGRES_PASSWORD`, `MASSA_TH0TH_POSTGRES_PORT`, and
    `MASSA_TH0TH_DB_BACKEND`; the commit's new material was operational-knob
    documentation, not installer behavior.

## Spec and acceptance facts worth preserving

- Native PostgreSQL is macOS/Homebrew-specific; Linux/WSL guidance remains
  distro packages or Docker.
- Both native and Docker modes use PostgreSQL/pgvector through `DATABASE_URL`;
  the wizard's existing PostgreSQL migration path is reused when PostgreSQL is
  selected.
- Docker warning text distinguishes the approximate ~5GB Docker/colima cost
  from the plan/commit's ~100MB native estimate.
- `MASSA_TH0TH_DB_BACKEND` provides non-interactive `native`, `sqlite`, or
  `docker` selection.

## Deviations and unresolved gaps

- The source plan asked for a test that stubs/mocks Brew and proves native-branch
  invocation. The added shell test is primarily static inspection plus an
  isolated mapping case; inspected diff does not establish a mocked Brew/native
  bootstrap execution.
- The plan prescribed manual runtime checks for the helper, wizard, Docker
  warning, source install, and `bun run diagnose`. This record did not rerun
  them; `c730076` and `3f6bfa3` commit messages report verification, but those
  are not fresh verification evidence.
- `62281b1` materially changed installer defaults/config regeneration after the
  feature. Its diff preserves the backend choices but requires separate review
  if exact original wizard behavior matters.

## Cross-references

- `.specs/features/qwen-model-defaults/design.md` identifies `c730076` as
  bundled native-PostgreSQL installer work outside its model-default scope.
- `.specs/HANDOFF.md` records later native PostgreSQL/pgvector test-harness
  evidence, but does not verify this installer workflow.

## Verification evidence

- Inspected source plan and full-history path commits in the requested range.
- Used `git show` on `c730076`, `3f6bfa3`, `62281b1`, `0455084`, and `614bf91`.
- Local completion checks after this write: target non-empty-file check and
  whitespace-diff check.
