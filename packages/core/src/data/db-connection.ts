/** PostgreSQL connection pool shared by persistence services. */

import { Pool, type PoolConfig } from "pg";
import { logger } from "@massa-ai/shared";
import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";

export interface DbConfig {
  connectionString: string;
  poolSize: number;
}

let pgPool: Pool | null = null;

export function getDbConfig(): DbConfig {
  return {
    connectionString: requirePostgresDatabaseUrl(),
    poolSize: Number.parseInt(process.env.DB_POOL_SIZE || "10", 10),
  };
}

export async function getPgPool(): Promise<Pool> {
  if (pgPool) return pgPool;
  const config = getDbConfig();
  const poolConfig: PoolConfig = {
    connectionString: config.connectionString,
    max: Number.isFinite(config.poolSize) && config.poolSize > 0 ? config.poolSize : 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
  };
  pgPool = new Pool(poolConfig);
  logger.info("PostgreSQL pool initialized", { poolSize: poolConfig.max });
  return pgPool;
}

export async function closeConnections(): Promise<void> {
  if (!pgPool) return;
  await pgPool.end();
  pgPool = null;
  logger.info("PostgreSQL pool closed");
}
