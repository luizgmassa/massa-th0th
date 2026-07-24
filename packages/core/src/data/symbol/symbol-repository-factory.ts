/**
 * Symbol Repository Factory
 *
 * Selects PostgreSQL only when DATABASE_URL points to Postgres.
 * Defaults to PostgreSQL for local-first mode.
 */

import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { SymbolRepositoryPg } from "./symbol-repository-pg.js";

export function getSymbolRepository(): SymbolRepositoryPg {
  requirePostgresDatabaseUrl();
  return SymbolRepositoryPg.getInstance();
}

export async function resetSymbolRepository(): Promise<void> {
  // No-op: connection managed by singleton PrismaClient
}
