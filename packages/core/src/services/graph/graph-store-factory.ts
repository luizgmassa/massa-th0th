/**
 * Graph Store Factory
 *
 * Provides a unified `IGraphStore` implementation based on database
 * configuration. Consumers call `getGraphStore()` and receive a
 * backend-agnostic store — they never depend on the concrete PostgreSQL or
 * PostgreSQL class (structural gap #14).
 */

import { GraphStorePg } from "./graph-store-pg.js";
import type { IGraphStore } from "./types.js";
import { logger } from "@massa-ai/shared";

let cachedStore: IGraphStore | null = null;

export function getGraphStore(): IGraphStore {
  if (cachedStore) return cachedStore;

  cachedStore = GraphStorePg.getInstance();
  logger.info('Using PostgreSQL graph store');

  return cachedStore;
}

export async function resetGraphStore(): Promise<void> {
  if (cachedStore) {
    try {
      await cachedStore.clear();
    } catch {
      // Defensive: never block a reset on a clear failure.
    }
    cachedStore = null;
  }
}
