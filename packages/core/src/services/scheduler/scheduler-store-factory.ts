/**
 * ScheduledJobStore factory — selects PostgreSQL or PG backend, mirroring
 * getJobStore() / getMemoryRepository().
 *
 * Dispatch rule (one-backend rule): if DATABASE_URL is postgres, use
 * PgScheduledJobStore; otherwise PgScheduledJobStore (local-first default).
 * On failure, fall back to a no-op store so the scheduler never crashes the
 * host process on a store init error.
 */

import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import type { ScheduledJobStore } from "./scheduler-store.js";

let cachedStore: ScheduledJobStore | null = null;

export function getScheduledJobStore(): ScheduledJobStore {
  if (cachedStore) return cachedStore;
  requirePostgresDatabaseUrl();
  const { PgScheduledJobStore } = require("./scheduler-store-pg.js") as { PgScheduledJobStore: new () => ScheduledJobStore };
  cachedStore = new PgScheduledJobStore();
  return cachedStore;
}

export function resetScheduledJobStore(): void {
  cachedStore = null;
}
