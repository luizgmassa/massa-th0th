# Installer Config Regeneration Specification

Slug: `installer-config-regeneration`. Source: `update-install-setup-local-script-to-eventual-goose.md`.

## Requirements

- Regenerating local setup `.env`, config, or generated installer `.env` first creates an adjacent `.bak` copy.
- Source installation is the interactive default; `MASSA_AI_DIR` remains non-interactive precedence.
- Source clone paths normalize common input forms, require writable existing parents, accept non-empty Git directories, and require confirmation for non-Git populated directories.
- Docker/build mode retains its prior install-directory behavior.

## Out of Scope

Changing Docker clone behavior or claiming shellcheck/interactive setup results without a current run.

## Verification Approach

Historical direct commit `62281b1`; wording deviation and runtime gaps are recorded in `design.md`.
