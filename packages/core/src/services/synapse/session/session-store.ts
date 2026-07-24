import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import type { AgentSession } from "../types.js";
import type { WorkingMemoryBufferConfig } from "../buffer/working-memory-buffer.js";
import { PgSynapseSessionStore } from "./session-store-pg.js";
export interface SessionStore { save(session: AgentSession): void; load(sessionId: string): AgentSession | null; delete(sessionId: string): void; recordAccess(sessionId: string, memoryId: string, count: number): void; ensureReady(): Promise<void>; }
/** Test double; production always instantiates PgSynapseSessionStore. */
export class MemorySessionStore implements SessionStore { save(): void {} load(): AgentSession | null { return null; } delete(): void {} recordAccess(): void {} ensureReady(): Promise<void> { return Promise.resolve(); } }
let store: PgSynapseSessionStore | null = null;
export function getSessionStore(): PgSynapseSessionStore { requirePostgresDatabaseUrl(); return store ??= new PgSynapseSessionStore(); }
export function resetSessionStore(): void { store = null; }
export type { WorkingMemoryBufferConfig };
export function tokenize(text: string): Set<string> { return new Set(text.toLowerCase().match(/[a-z0-9_]{2,}/g) ?? []); }
