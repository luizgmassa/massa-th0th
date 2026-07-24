# Installer Config Regeneration — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/update-install-setup-local-script-to-eventual-goose.md` — “Installer: config backup+override, mode reorder, source clone-path prompt”.

## Intent and scope

Plan claimed to make local setup and installer configuration regeneration explicit and recoverable: back up existing `.env` and `config.json` files before rewriting them, remove the prior in-place `DATABASE_URL` patch, put source installation first with Enter selecting it, and prompt source users for a validated clone directory. Scope named `scripts/setup-local-first.sh`, `install.sh`, and `.gitignore`; Docker/build clone-directory behavior was explicitly unchanged.

## Implemented outcome

Verified commit evidence shows the planned three-file change landed. `setup-local-first.sh` gained `backup_if_exists` and now regenerates its `.env` and config file after creating adjacent `.bak` copies; the existing `sed -i.bak` `DATABASE_URL` update branch was removed. `install.sh` now backs up and rewrites an existing generated `.env`, presents From source as menu option 1/default, and resolves a source-mode clone path through `prompt_install_dir`. `.gitignore` ignores `*.bak`.

`prompt_install_dir` honors `MASSA_AI_DIR`, otherwise reads from `/dev/tty`, normalizes tilde, trailing slash, and relative paths, requires a writable existing parent, and asks before accepting an existing non-empty non-git directory. `main` invokes it only for source mode.

## Commit evidence

### Assigned-range implementation

- `62281b1cdc11c01e7fe29ba8058b50d8d9fc215c` — `feat(install): regenerate configs with backups, reorder modes, source clone-path prompt`
  - Modified only `.gitignore`, `install.sh`, and `scripts/setup-local-first.sh` for this plan’s stated scope.
  - Added `*.bak` ignore coverage.
  - Replaced skip-or-patch behavior with backup then regenerate behavior for the affected environment/config writers.
  - Remapped interactive menu choice `1` to source and choice `2` to Docker build; unrecognized or empty input resolves to source.
  - Added and wired source-only clone-path prompting and validation.

No other commit in `c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4` changed the three planned files after this implementation commit.

## Spec and acceptance facts worth preserving

- Existing local setup `.env` and config files are backed up as `<file>.bak` before regeneration; the config path remains the configured `CONFIG_FILE` under the user configuration directory.
- `install.sh`'s generated `.env` is backed up as `${env_file}.bak` before it is rewritten.
- Source is interactive default. `MASSA_AI_DIR` retains non-interactive precedence for source mode.
- Path validation accepts an existing non-empty Git directory, requires confirmation for a non-empty non-Git directory, and rejects a missing or non-writable parent.
- Docker/build mode was not wired to the new prompt; it continues using prior install-directory behavior.

## Deviations or unresolved gaps

- Commit evidence supports the code changes but contains no recorded `shellcheck`, repeated setup run, interactive installer scenario, or `write_env` smoke-test result. Do not infer the source plan’s runtime verification checklist passed.
- The source plan described a compact `Clone path [~/.massa-ai]:` prompt. Implemented code uses a two-line explanatory prompt followed by `Path [<default>]:`; behavior matches the stated default/path-selection intent, but wording differs.
- This record maps the specified commit range and does not execute installer flows or inspect user-home backup artifacts.

## Cross-references to existing specs

- `.specs/features/installer-environment-hooks-and-web-ui/design.md`
- `.specs/features/qwen-model-defaults/design.md`
- `.specs/features/installer-llm-search-quality-toggles/design.md`

## Verification evidence

- Read source plan in full.
- Inspected `git log` for the assigned range filtered to `install.sh`, `scripts/setup-local-first.sh`, and `.gitignore`.
- Inspected full diff and metadata for `62281b1cdc11c01e7fe29ba8058b50d8d9fc215c`.
- Documentation-artifact checks: non-empty file and `git diff --check`.
