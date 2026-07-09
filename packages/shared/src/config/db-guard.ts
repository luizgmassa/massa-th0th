/**
 * DEDICATED-stack DB guard.
 *
 * Operational footgun: `bun` auto-loads the repo-root `.env`, which sets
 * `DATABASE_URL=postgresql://massa_th0th:...@localhost:5432/massa_th0th` (the
 * SHARED production DB). Any tools-api launched from the repo root silently
 * binds the shared DB unless `DATABASE_URL` is overridden. A prior verify agent
 * tripped this exact failure mode.
 *
 * The guard below makes that mistake loud: a process that declares
 * `MASSA_TH0TH_DEDICATED=1` (i.e. it expects to run against an isolated,
 * disposable DB) refuses to bind the shared DB name and fails fast at startup.
 * Processes without the flag are unaffected — normal `:3333` shared-stack boots
 * no-op.
 */

/** Canonical name of the shared/live PostgreSQL database. */
export const SHARED_DB_NAME = "massa_th0th";

/**
 * Extract the DB name (path segment after the last `/`, query stripped) from a
 * postgres-style URL. Lowercased so callers can compare case-insensitively.
 * Returns `null` when the URL is unset or the path cannot be parsed.
 */
export function getDbName(databaseUrl: string | undefined): string | null {
  if (!databaseUrl) return null;
  try {
    const u = new URL(databaseUrl);
    // pathname like "/massa_th0th" (or "/" for default-less URLs)
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
 * No-op unless `MASSA_TH0TH_DEDICATED=1` is set. Call this immediately after
 * env loading (e.g. right after `import "@massa-th0th/shared/config"`) and
 * BEFORE any DB/client initialization.
 *
 * Checks BOTH `DATABASE_URL` and the effective vector-store URL
 * (`POSTGRES_VECTOR_URL || DATABASE_URL`): the pgvector store falls back to
 * `DATABASE_URL` when `POSTGRES_VECTOR_URL` is unset (see
 * `vector-store-factory.ts`), so a dedicated process with an isolated
 * `DATABASE_URL` but a shared `POSTGRES_VECTOR_URL` would still bind the
 * shared DB through the vector connection and must be refused.
 */
export function assertDedicatedDbAllowed(): void {
  if (process.env.MASSA_TH0TH_DEDICATED !== "1") return; // guard only active in dedicated mode
  const url = process.env.DATABASE_URL;
  if (isSharedDb(url)) {
    throw new Error(
      `MASSA_TH0TH_DEDICATED=1 refuses to bind the shared DB "${SHARED_DB_NAME}" ` +
        `(DATABASE_URL=${url}). Set DATABASE_URL to an isolated DB ` +
        `(e.g. massa_th0th_dedicated) for dedicated stacks.`,
    );
  }
  // Effective vector URL: POSTGRES_VECTOR_URL if set, else falls back to DATABASE_URL.
  const vectorUrl = process.env.POSTGRES_VECTOR_URL || process.env.DATABASE_URL;
  if (isSharedDb(vectorUrl)) {
    throw new Error(
      `MASSA_TH0TH_DEDICATED=1 refuses to bind the shared DB "${SHARED_DB_NAME}" ` +
        `(POSTGRES_VECTOR_URL=${vectorUrl}). The pgvector store uses ` +
        `POSTGRES_VECTOR_URL (falling back to DATABASE_URL) as its connection, ` +
        `so it must also point at an isolated DB for dedicated stacks.`,
    );
  }
}
