/** Shared PostgreSQL Prisma client. */
import { logger } from "@massa-ai/shared";
import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PrismaClient } from "../../generated/prisma/index.js";

let prismaInstance: PrismaClient | null = null;
let prismaPool: import("pg").Pool | null = null;

/** @internal test seam for adapter-load failures. */
export const _adapters = {
  loadPg(): typeof import("pg") { return require("pg") as typeof import("pg"); },
  loadPrismaPg(): typeof import("@prisma/adapter-pg") { return require("@prisma/adapter-pg") as typeof import("@prisma/adapter-pg"); },
};

export function _resetPrismaForTesting(): void { prismaInstance = null; prismaPool = null; }

export function getPrismaClient(): PrismaClient {
  if (prismaInstance) return prismaInstance;
  const databaseUrl = requirePostgresDatabaseUrl();
  try {
    const pg = _adapters.loadPg();
    const { PrismaPg } = _adapters.loadPrismaPg();
    const pool = new pg.Pool({ connectionString: databaseUrl, max: 10, idleTimeoutMillis: 30_000, connectionTimeoutMillis: 5_000 });
    pool.on("error", (error) => logger.error("Unexpected PG pool error", error as Error));
    prismaPool = pool;
    prismaInstance = new PrismaClient({ adapter: new PrismaPg(pool as any) as any });
    logger.info("Prisma Client initialized with PostgreSQL");
    return prismaInstance;
  } catch (error) {
    throw new Error(`pg and @prisma/adapter-pg are required for PostgreSQL: ${(error as Error).message}`);
  }
}

export async function disconnectPrisma(): Promise<void> {
  await prismaInstance?.$disconnect(); prismaInstance = null;
  await prismaPool?.end(); prismaPool = null;
}
