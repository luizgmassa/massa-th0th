/**
 * DEDICATED-stack DB guard.
 *
 * Operational footgun: `bun` auto-loads the repo-root `.env`, which sets
 * `DATABASE_URL=postgresql://massa_ai:...@localhost:5432/massa_ai` (the
 * SHARED production DB). Any tools-api launched from the repo root silently
 * binds the shared DB unless `DATABASE_URL` is overridden. A prior verify agent
 * tripped this exact failure mode.
 *
 * The guard below makes that mistake loud: a process that declares
 * `MASSA_AI_DEDICATED=1` (i.e. it expects to run against an isolated,
 * disposable DB) refuses to bind the shared DB name and fails fast at startup.
 * Processes without the flag are unaffected — normal `:3333` shared-stack boots
 * no-op.
 */

/** Canonical name of the shared/live PostgreSQL database. */
export const SHARED_DB_NAME = "massa_ai";

/**
 * Return a usable PostgreSQL connection URL or fail before a pool/store is
 * initialized. DATABASE_URL is the sole runtime database connection source.
 */
export function requirePostgresDatabaseUrl(databaseUrl = process.env.DATABASE_URL): string {
  if (!databaseUrl?.trim()) {
    throw new Error("DATABASE_URL is required and must be a PostgreSQL URL");
  }

  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL URL");
  }

  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    throw new Error("DATABASE_URL must use postgres:// or postgresql://");
  }

  if (!url.hostname || !url.pathname || url.pathname === "/") {
    throw new Error("DATABASE_URL must include a database name");
  }

  return databaseUrl;
}

/**
 * Extract the DB name (path segment after the last `/`, query stripped) from a
 * postgres-style URL. Lowercased so callers can compare case-insensitively.
 * Returns `null` when the URL is unset or the path cannot be parsed.
 */
export function getDbName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const u = new URL(databaseUrl);
    // pathname like "/massa_ai" (or "/" for default-less URLs)
    const path = u.pathname;
    if (!path || path === "/") return null;
    const name = path.split("/").filter(Boolean).pop();
    return name ? decodeURIComponent(name).toLowerCase() : null;
  } catch {
    return null;
  }
}

/** True iff the resolved `databaseUrl` points at the shared DB name. */
export function isSharedDb(databaseUrl: string | undefined): boolean {
  return getDbName(databaseUrl) === SHARED_DB_NAME.toLowerCase();
}

/**
 * Fail fast if a DEDICATE-flagged process would bind the shared production DB.
 * No-op unless `MASSA_AI_DEDICATED=1` is set. Call this immediately after
 * env loading (e.g. right after `import "@massa-ai/shared/config"`) and
 * BEFORE any DB/client initialization.
 *
 * Uses DATABASE_URL for every database concern, including pgvector.
 */
export function assertDedicatedDbAllowed(): void {
  if (process.env.MASSA_AI_DEDICATED !== "1") return; // guard only active in dedicated mode
  const url = requirePostgresDatabaseUrl();
  if (isSharedDb(url)) {
    throw new Error(
      `MASSA_AI_DEDICATED=1 refuses to bind the shared DB "${SHARED_DB_NAME}" ` +
        `(DATABASE_URL=${url}). Set DATABASE_URL to an isolated DB ` +
        `(e.g. massa_ai_dedicated) for dedicated stacks.`,
    );
  }
}
