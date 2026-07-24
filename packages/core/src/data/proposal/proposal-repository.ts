import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PgProposalStore } from "./proposal-repository-pg.js";
export * from "./proposal-contract.js";
export { PgProposalStore } from "./proposal-repository-pg.js";
let store: PgProposalStore | null = null;
export function getProposalStore(): PgProposalStore { requirePostgresDatabaseUrl(); return store ??= new PgProposalStore(); }
export function resetProposalStore(): void { store = null; }
export function newProposalId(): string { return `proposal_${crypto.randomUUID()}`; }
