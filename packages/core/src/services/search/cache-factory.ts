/**
 * Cache Factory
 *
 * Provides unified cache implementation based on database configuration.
 */

import { SearchCachePg } from './search-cache-pg.js';
import { logger } from '@massa-ai/shared';

let cachedCache: SearchCachePg | null = null;

export function getSearchCache(): SearchCachePg {
  if (cachedCache) return cachedCache;

  cachedCache = new SearchCachePg();
  logger.info('Using PostgreSQL search cache');
  
  return cachedCache;
}

export async function resetSearchCache(): Promise<void> {
  if (cachedCache) {
    await cachedCache.clear();
    cachedCache = null;
  }
}
