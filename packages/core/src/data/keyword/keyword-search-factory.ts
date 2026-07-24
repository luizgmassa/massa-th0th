/**
 * Keyword Search Factory
 *
 * Provides unified keyword search implementation based on database configuration.
 */

import { KeywordSearchPg } from "./keyword-search-pg.js";
import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";

let cachedSearch: KeywordSearchPg | null = null;

export function getKeywordSearch(): KeywordSearchPg {
  if (cachedSearch) return cachedSearch;
  requirePostgresDatabaseUrl();
  return cachedSearch = new KeywordSearchPg();
}

export async function resetKeywordSearch(): Promise<void> {
  if (cachedSearch) {
    if ('close' in cachedSearch) {
      await cachedSearch.close();
    }
    cachedSearch = null;
  }
}
