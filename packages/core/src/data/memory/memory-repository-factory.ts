import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { MemoryRepositoryPg } from "./memory-repository-pg.js";

/** Backend-neutral entry point. PostgreSQL is mandatory. */
export function getMemoryRepository(): MemoryRepositoryPg {
  requirePostgresDatabaseUrl();
  return MemoryRepositoryPg.getInstance();
}
