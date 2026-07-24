/** Backend-neutral vector-store factory backed exclusively by PostgreSQL. */

import type { IVectorStore } from "@massa-ai/shared";
import { logger } from "@massa-ai/shared";
import { parsePositiveIntEnv, requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PostgresVectorStore, type PostgresConfig } from "./postgres-vector-store.js";

export interface VectorStoreConfig {
  postgres?: Partial<PostgresConfig>;
}

let cachedStore: IVectorStore | null = null;
let initializationPromise: Promise<IVectorStore> | null = null;

export async function getVectorStore(config?: VectorStoreConfig): Promise<IVectorStore> {
  if (cachedStore) return cachedStore;
  if (initializationPromise) return initializationPromise;

  initializationPromise = (async () => {
    const connectionString = config?.postgres?.connectionString ?? requirePostgresDatabaseUrl();
    const hnswM = parsePositiveIntEnv(process.env.POSTGRES_HNSW_M, 0);
    const hnswEfConstruction = parsePositiveIntEnv(process.env.POSTGRES_HNSW_EF_CONSTRUCTION, 0);
    const ivfflatLists = parsePositiveIntEnv(process.env.POSTGRES_IVFFLAT_LISTS, 0);
    const indexParams = {
      ...(hnswM ? { m: hnswM } : {}),
      ...(hnswEfConstruction ? { efConstruction: hnswEfConstruction } : {}),
      ...(ivfflatLists ? { lists: ivfflatLists } : {}),
    };
    const store = new PostgresVectorStore({
      connectionString,
      poolSize: Number.parseInt(process.env.POSTGRES_VECTOR_POOL_SIZE || "10", 10),
      indexType: (process.env.POSTGRES_VECTOR_INDEX as "ivfflat" | "hnsw") || "hnsw",
      ...(Object.keys(indexParams).length ? { indexParams } : {}),
      ...config?.postgres,
    });
    await store.ensureInitialized();
    if (!await Promise.race([store.healthCheck(), new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5_000))])) {
      await store.close().catch(() => undefined);
      throw new Error("PostgreSQL vector store health check failed");
    }
    cachedStore = store;
    logger.info("PostgreSQL vector store initialized");
    return store;
  })().finally(() => { initializationPromise = null; });
  return initializationPromise;
}

export async function resetVectorStore(): Promise<void> {
  if (!cachedStore) return;
  await cachedStore.close();
  cachedStore = null;
}
