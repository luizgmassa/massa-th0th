import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PgObservationStore } from "./observation-repository-pg.js";
export * from "./observation-contract.js";
export { PgObservationStore } from "./observation-repository-pg.js";
let store: PgObservationStore | null = null;
export function getObservationStore(): PgObservationStore { requirePostgresDatabaseUrl(); return store ??= new PgObservationStore(); }
export function resetObservationStore(): void { store = null; }
