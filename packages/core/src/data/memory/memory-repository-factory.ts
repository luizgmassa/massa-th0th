/**
 * Memory Repository Factory
 *
 * Seleciona PostgreSQL apenas quando DATABASE_URL aponta para Postgres.
 * No modo local-first, usa SQLite.
 */

import { logger } from "@massa-th0th/shared";
import { MemoryRepositoryPg } from "./memory-repository-pg.js";
import { MemoryRepository } from "./memory-repository.js";

export function getMemoryRepository(): MemoryRepositoryPg | MemoryRepository {
  const databaseUrl = process.env.DATABASE_URL;
  const isPostgres =
    databaseUrl?.startsWith("postgresql://") ||
    databaseUrl?.startsWith("postgres://");

  if (isPostgres) {
    logger.info("Using PostgreSQL MemoryRepository");
    return MemoryRepositoryPg.getInstance();
  }

  logger.info("Using SQLite MemoryRepository");
  return MemoryRepository.getInstance();
}
