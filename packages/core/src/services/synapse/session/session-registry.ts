/**
 * SessionRegistry — in-memory store of agent sessions.
 *
 * Kept deliberately simple: a Map keyed by sessionId with lazy TTL eviction.
 * Persistence is out of scope; sessions are by definition ephemeral context
 * windows for an agent working on a task right now.
 */

import type { AgentSession } from "../types.js";
import {
  WorkingMemoryBuffer,
  type WorkingMemoryBufferConfig,
} from "../buffer/working-memory-buffer.js";
import type { SessionStore } from "./session-store.js";
import { logger } from "@massa-ai/shared";

const TOKEN_RE = /[a-z0-9_]{2,}/g;

function tokenize(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const match of text.toLowerCase().matchAll(TOKEN_RE)) {
    tokens.add(match[0]);
  }
  return tokens;
}

export interface CreateSessionInput {
  sessionId: string;
  agentId: string;
  workspaceId?: string;
  taskContext?: string;
  taskEmbedding?: Float32Array | number[];
  ttlMs?: number;
  /** Provide a buffer config to attach a WorkingMemoryBuffer to this session. */
  bufferConfig?: WorkingMemoryBufferConfig;
  /**
   * Maximum entries in accessHistory before LRU eviction kicks in (IMP-11).
   * Defaults to 1000 — large enough for any single agent run, small enough
   * to keep memory predictable.
   */
  accessHistoryMaxEntries?: number;
}

const DEFAULT_ACCESS_HISTORY_LIMIT = 1000;

export class SessionRegistry {
  private sessions = new Map<string, AgentSession>();
  private defaultTtlMs: number;
  private readonly store?: SessionStore;

  constructor(defaultTtlMs: number = 3_600_000, store?: SessionStore) {
    this.defaultTtlMs = defaultTtlMs;
    this.store = store;
  }

  create(input: CreateSessionInput, now: number = Date.now()): AgentSession {
    if (this.sessions.has(input.sessionId)) {
      throw new Error(`Session already exists: ${input.sessionId}`);
    }
    const ttl = input.ttlMs ?? this.defaultTtlMs;
    const session: AgentSession = {
      sessionId: input.sessionId,
      ttlMs: ttl,
      agentId: input.agentId,
      workspaceId: input.workspaceId,
      taskContext: input.taskContext,
      taskTokens: input.taskContext ? tokenize(input.taskContext) : undefined,
      taskEmbedding: input.taskEmbedding,
      createdAt: now,
      expiresAt: now + ttl,
      accessHistory: new Map(),
      accessHistoryLimit: input.accessHistoryMaxEntries ?? DEFAULT_ACCESS_HISTORY_LIMIT,
      buffer: input.bufferConfig ? new WorkingMemoryBuffer(input.bufferConfig) : undefined,
    };
    this.sessions.set(session.sessionId, session);
    // Phase 1: write-through (best-effort).
    try { this.store?.save(session); } catch (error) { logger.warn("[SessionRegistry] store save failed:", { error: (error as Error).message }); }
    return session;
  }

  /**
   * Await backend readiness before a read (hydration race fix, #18).
   *
   * Sync backends (PostgreSQL, Memory) resolve immediately. The PG backend awaits
   * its in-memory mirror hydration so a session resume immediately after a
   * process restart observes PG-persisted sessions. Call this before the first
   * `get()` of a resume flow; the sync `get()` used by the modulation pipeline
   * stays synchronous.
   */
  async ensureReady(): Promise<void> {
    try {
      await this.store?.ensureReady();
    } catch (error) {
      logger.warn("[SessionRegistry] store ensureReady failed:", { error: (error as Error).message });
    }
  }

  /**
   * Async resume path: await backend hydration, then return the session via the
   * sync `get()`. Use this for session-resume entry points (REST/MCP) where a
   * caller must observe a persisted session immediately after a process
   * restart. The hot-path `process()` pipeline continues to use the sync
   * `get()`. Project search uses this path before session-aware modulation.
   */
  async getAsync(sessionId: string, now: number = Date.now()): Promise<AgentSession | null> {
    await this.ensureReady();
    return this.get(sessionId, now);
  }

  /**
   * Retrieve a live session. IMP-10: an active `get()` slides the TTL
   * forward so a session in use does not silently expire mid-task.
   * The slide is bounded to defaultTtlMs from `now` — accessing a session
   * never extends it beyond what a fresh `create()` would give.
   *
   * NOTE: this is the sync hot path. For backends with an async-warmed read
   * mirror (PG), the very first call after a process restart may return null
   * until hydration settles (<100ms). Resume entry points should use
   * `getAsync()` / `ensureReady()` first.
   */
  get(sessionId: string, now: number = Date.now()): AgentSession | null {
    let session = this.sessions.get(sessionId);
    // Phase 1: lazy-load on a hot-cache miss.
    if (!session && this.store) {
      try {
        const loaded = this.store.load(sessionId);
        if (loaded) {
          // Respect TTL on load; an expired persisted session is discarded.
          if (loaded.expiresAt <= now) {
            this.store.delete(sessionId);
            return null;
          }
          this.sessions.set(sessionId, loaded);
          session = loaded;
        }
      } catch (error) { logger.warn("[SessionRegistry] store load failed:", { error: (error as Error).message }); }
    }
    if (!session) return null;
    if (session.expiresAt <= now) {
      this.sessions.delete(sessionId);
      try { this.store?.delete(sessionId); } catch (error) { logger.warn("[SessionRegistry] store delete (expired) failed:", { error: (error as Error).message }); }
      return null;
    }
    const refreshed = now + (session.ttlMs ?? this.defaultTtlMs);
    if (refreshed > session.expiresAt) {
      session.expiresAt = refreshed;
    }
    return session;
  }

  /**
   * Update the task context for an existing session and refresh its TTL.
   */
  updateTaskContext(
    sessionId: string,
    taskContext: string,
    taskEmbedding?: Float32Array | number[],
    now: number = Date.now(),
  ): AgentSession | null {
    const session = this.get(sessionId, now);
    if (!session) return null;
    session.taskContext = taskContext;
    session.taskTokens = tokenize(taskContext);
    if (taskEmbedding) session.taskEmbedding = taskEmbedding;
    session.expiresAt = now + (session.ttlMs ?? this.defaultTtlMs);
    try { this.store?.save(session); } catch (error) { logger.warn("[SessionRegistry] store save (updateTaskContext) failed:", { error: (error as Error).message }); }
    return session;
  }

  /**
   * Record that the agent accessed a memory inside this session.
   * Used by agent-affinity scoring.
   *
   * IMP-11: the Map is bounded by `accessHistoryLimit`. Re-recording an
   * existing key refreshes its recency (delete-then-set), keeping the LRU
   * intuition exact even with the small overhead.
   */
  recordAccess(sessionId: string, memoryId: string, now: number = Date.now()): void {
    const session = this.get(sessionId, now);
    if (!session) return;
    const history = session.accessHistory;
    let nextCount = 1;
    if (history.has(memoryId)) {
      const current = history.get(memoryId)!;
      nextCount = current + 1;
      history.delete(memoryId);
      history.set(memoryId, nextCount);
    } else {
      history.set(memoryId, 1);
    }
    while (history.size > session.accessHistoryLimit) {
      const oldest = history.keys().next().value;
      if (oldest === undefined) break;
      history.delete(oldest);
    }
    // Phase 1: write-through the access touch (best-effort, LRU recency).
    try { this.store?.recordAccess(sessionId, memoryId, nextCount); } catch (error) { logger.warn("[SessionRegistry] store recordAccess failed:", { error: (error as Error).message }); }
  }

  delete(sessionId: string): boolean {
    const removed = this.sessions.delete(sessionId);
    try { this.store?.delete(sessionId); } catch (error) { logger.warn("[SessionRegistry] store delete failed:", { error: (error as Error).message }); }
    return removed;
  }

  /** Evict expired sessions. Called opportunistically. */
  evictExpired(now: number = Date.now()): number {
    let evicted = 0;
    for (const [id, session] of this.sessions) {
      if (session.expiresAt <= now) {
        this.sessions.delete(id);
        evicted++;
      }
    }
    return evicted;
  }

  size(): number {
    return this.sessions.size;
  }

  /** Test hook. */
  clear(): void {
    this.sessions.clear();
  }
}

let registry: SessionRegistry | null = null;

export function getSessionRegistry(): SessionRegistry {
  if (!registry) {
    // Phase 1: wire the durable PostgreSQL store with an ephemeral fallback.
    let store: SessionStore;
    try {
      // Lazy require to avoid importing legacy local database at module-eval.
      const { getSessionStore } = require("./session-store.js") as {
        getSessionStore: () => SessionStore;
      };
      store = getSessionStore();
    } catch (error) {
      logger.warn("[SessionRegistry] store init failed, falling back to MemorySessionStore:", { error: (error as Error).message });
      const { MemorySessionStore } = require("./session-store.js") as {
        MemorySessionStore: new () => SessionStore;
      };
      store = new MemorySessionStore();
    }
    registry = new SessionRegistry(3_600_000, store);
  }
  return registry;
}

export function resetSessionRegistry(): void {
  registry = null;
}
