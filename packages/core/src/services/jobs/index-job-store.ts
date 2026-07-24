import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PgJobStore } from "./index-job-store-pg.js";
export * from "./index-job-store-contract.js";
let store: PgJobStore | null = null;
export function getJobStore(): PgJobStore { requirePostgresDatabaseUrl(); return store ??= new PgJobStore(); }
export function resetJobStore(): void { store = null; }
