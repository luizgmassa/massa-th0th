import { logger } from "@massa-ai/shared";
import type { EmbeddingCacheStore } from "./embedding-cache-contract.js";
import { EmbeddingCachePg } from "./embedding-cache-pg.js";

/** Select the cache backend from the canonical application database setting. */
export function createEmbeddingCache(
  provider: string,
  model: string,
): EmbeddingCacheStore {
  logger.info("Using PostgreSQL embedding cache", { provider, model });
  return new EmbeddingCachePg(provider, model);
}
