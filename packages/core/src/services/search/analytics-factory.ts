/**
 * Search Analytics Factory
 *
 * Provides unified analytics implementation based on database configuration.
 */

import { SearchAnalyticsPg } from "./search-analytics-pg.js";
import { logger } from "@massa-ai/shared";

let cachedAnalytics: SearchAnalyticsPg | null = null;

export function getSearchAnalytics(): SearchAnalyticsPg {
  if (cachedAnalytics) return cachedAnalytics;

  cachedAnalytics = new SearchAnalyticsPg();
  logger.info('Using PostgreSQL search analytics');
  
  return cachedAnalytics;
}

export async function resetSearchAnalytics(): Promise<void> {
  if (cachedAnalytics) {
    if ('close' in cachedAnalytics) {
      await cachedAnalytics.close();
    }
    cachedAnalytics = null;
  }
}
