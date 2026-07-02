/**
 * Event Bus
 *
 * Typed EventEmitter singleton for broadcasting ETL progress events
 * to SSE subscribers and internal listeners (WorkspaceManager, etc.).
 */

import { EventEmitter } from "events";

// ─── Event map ────────────────────────────────────────────────────────────────

export interface EventMap {
  "indexing:started": {
    jobId: string;
    projectId: string;
    projectPath: string;
    totalFiles?: number;
  };
  "indexing:progress": {
    jobId: string;
    projectId: string;
    stage: string;
    current: number;
    total: number;
    percentage: number;
  };
  "indexing:file": {
    jobId: string;
    projectId: string;
    filePath: string;
    stage: string;
    status: "ok" | "error";
    error?: string;
  };
  "indexing:completed": {
    jobId: string;
    projectId: string;
    filesIndexed: number;
    chunksIndexed: number;
    symbolsIndexed: number;
    durationMs: number;
  };
  "indexing:failed": {
    jobId: string;
    projectId: string;
    error: string;
    durationMs: number;
  };
  "workspace:updated": {
    projectId: string;
    status: "pending" | "indexing" | "indexed" | "error";
    filesCount?: number;
    symbolsCount?: number;
  };
  "search:completed": {
    query: string;
    projectId: string;
    sessionId?: string;
    results: Array<{ filePath: string; score: number; lineStart?: number; lineEnd?: number }>;
    durationMs: number;
    resultCount: number;
  };
  /** Emitted by SearchSessionHook after a session memory is persisted. */
  "memory:session-stored": {
    memoryId: string;
    projectId?: string;
    sessionId?: string;
    query: string;
  };
  /** Phase 1: emitted after a consolidation batch produces a merged memory. */
  "memory:consolidated": {
    batchId: string;
    sourceIds: string[];
    newMemoryId: string;
    projectId?: string;
    stats: { merged: number; batchesCreated: number };
  };
  /** Phase 2: emitted after a successful query rewrite (LLM on, valid output). */
  "search:query-rewritten": {
    query: string;
    projectId: string;
    expansions: string[];
    keywords: string[];
    hydeUsed: boolean;
  };
  /** Phase 2: emitted after fusing the expanded streams (vector + keyword + HyDE).
   * Phase 7a: `source` is optional ("rrf" pre-7a, "llm-judge" when 7a reranks). */
  "search:reranked": {
    query: string;
    projectId: string;
    streamCount: number;
    resultCount: number;
    source?: "rrf" | "llm-judge";
  };
  /** Phase 3: emitted after an observation is persisted (hook ingestion). */
  "observation:ingested": {
    observationId: string;
    projectId: string;
    sessionId?: string;
    source: string;
    importance: number;
  };
  /** Phase 4: emitted after a successful bootstrap stores ≥1 seed memory. */
  "bootstrap:completed": {
    projectId: string;
    bootstrapId: string;
    seedMemoryIds: string[];
    source: "llm" | "rule-based";
    signalCount: number;
    memoryCount: number;
  };
  /** Phase 6: emitted after a handoff is accepted (status open→accepted). */
  "handoff:accepted": {
    handoffId: string;
    projectId?: string;
    sourceSessionId?: string;
    targetAgent?: string;
    acceptedAt: number;
  };
  /** Phase 5: emitted after an auto-improve proposal is applied (status pending→approved). */
  "memory:auto-improved": {
    proposalId: string;
    projectId?: string;
    kind: "memory.create" | "memory.update" | "memory.tag";
    targetMemoryId?: string;
    status: "approved";
    appliedAt: number;
    source: "llm" | "rule-based";
  };
}

export type EventName = keyof EventMap;

// ─── Typed EventBus ───────────────────────────────────────────────────────────

class TypedEventBus extends EventEmitter {
  private static instance: TypedEventBus | null = null;

  private constructor() {
    super();
    // Increase listener limit for SSE — many concurrent clients
    this.setMaxListeners(200);
  }

  static getInstance(): TypedEventBus {
    if (!TypedEventBus.instance) {
      TypedEventBus.instance = new TypedEventBus();
    }
    return TypedEventBus.instance;
  }

  publish<K extends EventName>(event: K, payload: EventMap[K]): void {
    this.emit(event, payload);
  }

  subscribe<K extends EventName>(event: K, listener: (payload: EventMap[K]) => void): () => void {
    this.on(event, listener as (payload: unknown) => void);
    return () => this.off(event, listener as (payload: unknown) => void);
  }
}

export const eventBus = TypedEventBus.getInstance();
export { TypedEventBus as EventBus };
