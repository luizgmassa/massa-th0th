import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PgHandoffStore } from "./handoff-repository-pg.js";
export * from "./handoff-contract.js";
export { PgHandoffStore } from "./handoff-repository-pg.js";
let store: PgHandoffStore | null = null;
export function getHandoffStore(): PgHandoffStore { requirePostgresDatabaseUrl(); return store ??= new PgHandoffStore(); }
export function resetHandoffStore(): void { store = null; }
export function newHandoffId(): string { return `handoff_${crypto.randomUUID()}`; }
