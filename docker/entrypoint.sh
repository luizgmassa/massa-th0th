#!/bin/sh
# ============================================
# massa-ai API - Container Entrypoint
# ============================================
# Runs Prisma migrations before starting the API.
# Safe to run on every startup: migrate deploy is idempotent.
# ============================================

set -e

# PostgreSQL is mandatory. Validate before migrations or API startup without
# printing credentials in failures.
bun -e '
const raw = process.env.DATABASE_URL;
if (!raw) throw new Error("DATABASE_URL is required");
let url;
try { url = new URL(raw); } catch { throw new Error("DATABASE_URL must be a valid PostgreSQL URL"); }
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use postgres:// or postgresql://");
}
if (!url.hostname || !url.pathname || url.pathname === "/") {
  throw new Error("DATABASE_URL must include a host and database name");
}
'

echo "[entrypoint] Running database migrations..."
(cd /app/packages/core && bunx prisma migrate deploy)
echo "[entrypoint] Migrations complete."

echo "[entrypoint] Starting massa-ai API..."
exec "$@"
