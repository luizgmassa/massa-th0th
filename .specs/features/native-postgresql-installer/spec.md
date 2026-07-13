# Native PostgreSQL Installer Specification

Slug: `native-postgresql-installer`. Source: `change-the-installers-to-cozy-scroll.md`.

## Requirements

- macOS/Homebrew users can select native PostgreSQL/pgvector; SQLite and Docker PostgreSQL remain supported.
- `MASSA_TH0TH_DB_BACKEND` supports non-interactive `native`, `sqlite`, and `docker` modes.
- Docker/Colima selection communicates approximate ~5GB cost; native-helper failure yields a manual URL path.
- Native/Docker PostgreSQL uses `DATABASE_URL` and existing migration flow.

## Out of Scope

Linux/WSL native support beyond package/Docker guidance and unverified Brew bootstrap behavior.

## Verification Approach

Historical commits `c730076` and `3f6bfa3`; no fresh installer, Brew, migration, or diagnose execution was run.
