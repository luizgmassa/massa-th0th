/**
 * WebController — orchestration for `fetch_and_index`.
 *
 * Owns a single set of injected index deps (vector store + keyword search) and
 * drives the parallel-fetch / serial-index pipeline:
 *
 *   1. Build a `PoolJob` per request URL.
 *   2. runPool fetches them in parallel (concurrency from the caller, cpu-capped
 *      for batch). Each job runs fetchAndConvertOne, whose internal index drain
 *      is already SERIAL — so even when N fetches race, the per-URL indexing
 *      never overlaps with itself. Cross-URL overlap is acceptable for
 *      pgvector (row locks) but would contend on SQLite WAL; the per-URL
 *      serial drain keeps the worst case to N concurrent single-writers, which
 *      SQLite tolerates and pgvector handles trivially.
 *   3. Drain the allSettled-shaped results in input order and return per-URL
 *      status + chunk counts.
 *
 * The controller is the composition root that wires the real vector/keyword
 * stores into the fetcher's `WebIndexDeps`. Tests construct it with a captured
 * in-memory deps map instead.
 */

import type { IVectorStore, IKeywordSearch, VectorDocument } from "@massa-th0th/shared";
import { logger } from "@massa-th0th/shared";
import { runPool, type PoolJob } from "../executor/run-pool.js";
import {
  fetchAndConvertOne,
  type FetchOneResult,
  type IndexedChunk,
  type WebIndexDeps,
} from "./fetcher.js";

export interface FetchRequest {
  url: string;
  source?: string;
}

export interface FetchAndIndexParams {
  /** Single URL (legacy single shape). */
  url?: string;
  /** Label for the single-`url` case. */
  source?: string;
  /** Batch shape. Wins over `url` when both are provided. */
  requests?: FetchRequest[];
  /** Max URLs fetched in parallel (1-8, default 1). */
  concurrency?: number;
  /** Bypass the TTL cache. */
  force?: boolean;
  /** Per-call cache window override (ms). `0` bypasses like force. */
  ttl?: number;
  /** projectId scoping the indexed chunks. Defaults to "web". */
  projectId?: string;
}

export interface WebControllerDeps {
  vectorStore: IVectorStore;
  keywordSearch: IKeywordSearch;
}

/** In-memory TTL cache map (url-key → indexedAt ms). Process-local; not durable. */
type CacheMap = Map<string, number>;

/**
 * Maximum number of entries retained in the in-memory fetch cache. The cache is
 * process-local and not durable; without a cap a long-running process fetching
 * many distinct URLs grows memory without bound. Map preserves INSERTION order
 * in JS, so the oldest entry is evicted first when the cap is hit. Re-touching
 * an entry (re-mark) promotes it to most-recent via delete+set.
 */
const WEB_CACHE_MAX_ENTRIES = 512;

export class WebController {
  private static instance: WebController | null = null;
  private readonly deps: WebControllerDeps;
  private readonly cache: CacheMap = new Map();

  constructor(deps: WebControllerDeps) {
    this.deps = deps;
  }

  static getInstance(): WebController {
    if (!WebController.instance) {
      throw new Error(
        "WebController.getInstance() requires explicit deps — call " +
          "WebController.instantiate(deps) once at boot, or construct with deps directly.",
      );
    }
    return WebController.instance;
  }

  /**
   * Boot the singleton with real store deps. The Tools API route calls this lazily
   * on first request (after resolving the async vector store). Idempotent.
   */
  static instantiate(deps: WebControllerDeps): WebController {
    if (!WebController.instance) {
      WebController.instance = new WebController(deps);
    }
    return WebController.instance;
  }

  /** For tests: reset the singleton + clear the cache. */
  static resetInstance(): void {
    WebController.instance = null;
  }

  /** Build the WebIndexDeps seam from the real stores + the in-memory cache. */
  private indexDeps(projectId: string): WebIndexDeps {
    return {
      indexChunk: async (chunk: IndexedChunk) => {
        const doc: VectorDocument = {
          id: chunk.id,
          content: chunk.content,
          metadata: chunk.metadata,
        };
        // Parallel within ONE chunk: vector add + keyword index. Both stores
        // accept independent writes; a single chunk is the serial unit.
        await Promise.all([
          this.deps.vectorStore.addDocuments([doc]),
          this.deps.keywordSearch.index(chunk.id, chunk.content, chunk.metadata),
        ]);
      },
      getLastIndexedAt: (key) => {
        const ts = this.cache.get(key);
        if (ts === undefined) return null;
        // LRU touch: promote this key to most-recently-used so frequently-fetched
        // URLs survive eviction. Map preserves insertion order, so delete+set
        // reorders it to the end (newest).
        this.cache.delete(key);
        this.cache.set(key, ts);
        return ts;
      },
      markIndexed: (key, ts) => {
        // Replace any existing entry so the key's insertion order is refreshed.
        this.cache.delete(key);
        this.cache.set(key, ts);
        // Evict oldest (first-key) entries while over the cap.
        while (this.cache.size > WEB_CACHE_MAX_ENTRIES) {
          const oldest = this.cache.keys().next().value;
          if (oldest === undefined) break;
          this.cache.delete(oldest);
        }
      },
    };
  }

  async fetchAndIndex(params: FetchAndIndexParams): Promise<{
    success: boolean;
    results: FetchOneResult[];
    concurrency: number;
    capped: boolean;
  }> {
    const batch: FetchRequest[] = params.requests
      ? params.requests
      : params.url
        ? [{ url: params.url, source: params.source }]
        : [];

    if (batch.length === 0) {
      return { success: false, results: [], concurrency: 0, capped: false };
    }

    const requestedConcurrency = Math.min(
      Math.max(1, params.concurrency ?? 1),
      8,
    );
    const projectId = params.projectId ?? "web";

    const jobs: PoolJob<FetchOneResult>[] = batch.map((req) => ({
      run: () =>
        fetchAndConvertOne(req.url, this.indexDeps(projectId), {
          source: req.source,
          force: params.force,
          ttl: params.ttl,
          projectId,
        }),
    }));

    const { settled, effectiveConcurrency, capped } = await runPool(jobs, {
      concurrency: requestedConcurrency,
      capByCpuCount: batch.length > 1 && requestedConcurrency > 1,
    });

    // Map settled[i] → FetchOneResult (preserve input order). runPool guarantees
    // settled[i] corresponds to jobs[i]; rejected entries become error results.
    const results: FetchOneResult[] = settled.map((s, i) => {
      if (s.status === "fulfilled") return s.value;
      const msg =
        s.reason instanceof Error ? s.reason.message : String(s.reason);
      logger.error("fetch_and_index job rejected", s.reason as Error, {
        url: batch[i].url,
      });
      return { kind: "error", url: batch[i].url, error: msg };
    });

    const success = results.every(
      (r) => r.kind === "fetched" || r.kind === "cached",
    );

    return { success, results, concurrency: effectiveConcurrency, capped };
  }
}
