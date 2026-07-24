/**
 * Web fetcher + indexer for `fetch_and_index`.
 *
 * Flow (single URL):
 *   1. SSRF guard: assertUrlSafe resolves + classifies the hostname's IPs.
 *   2. TTL cache check: if a fresh entry exists for this (source, url) key,
 *      return a cache-hit result WITHOUT fetching or indexing.
 *   3. fetchWithSsrfGuard: manual redirect walk — each hop re-resolved + classified.
 *   4. Content-Length + read byte cap (MAX_FETCH_BYTES) — reject oversized before
 *      slurping the body into the long-running process heap.
 *   5. Convert: HTML → markdown (turndown+gfm), JSON → key-path chunks,
 *      everything else → plain text.
 *   6. Index SERIALY via the injected `indexChunk` seam (single-writer safety —
 *      the underlying PostgreSQL FTS5 / pgvector stores are not safe under
 *      concurrent writers, and even pgvector embeddings serialize better one
 *      doc at a time). The PARALLEL phase is the fetch (run-pool in the
 *      controller); the SERIAL phase is always this drain.
 *
 * The indexing layer is injected (`WebIndexDeps`) so unit tests can capture
 * indexed chunks against an in-memory map instead of the real vector store.
 */

import { createHash } from "node:crypto";
import { logger } from "@massa-ai/shared";
import {
  fetchWithSsrfGuard,
  SsrfBlockedError,
  type FetchGuardOptions,
} from "./ssrf.js";
import { htmlToMarkdown, jsonToKeyPathChunks } from "./html-to-md.js";

/** Hard cap on fetched body size (50 MB). Checked against Content-Length AND
 *  the actual bytes read (defense-in-depth: a lying Content-Length or chunked
 *  transfer can still slip past the header check). */
export const MAX_FETCH_BYTES = 50 * 1024 * 1024;

/** Default TTL for the fetch cache (24h). */
export const DEFAULT_FETCH_TTL_MS = 24 * 60 * 60 * 1000;

export type FetchContentType = "html" | "json" | "text";

/** A single indexed chunk produced from a fetch. */
export interface IndexedChunk {
  /** Stable id: projectId:url-hash:idx — unique per (url, position). */
  id: string;
  content: string;
  metadata: Record<string, unknown>;
}

/** Per-fetch result returned to the controller. */
export type FetchOneResult =
  | {
      kind: "cached";
      url: string;
      source: string;
      chunkCount: number;
      ageMs: number;
    }
  | {
      kind: "fetched";
      url: string;
      source: string;
      contentType: FetchContentType;
      chunks: IndexedChunk[];
      bytes: number;
    }
  | {
      kind: "error";
      url: string;
      error: string;
    };

/**
 * Indexing seams injected by the controller. Keeping these as an interface (not
 * a hard dependency on the vector/keyword stores) lets tests assert indexed
 * chunks without a DB, and lets the controller compose vector+keyword writes.
 */
export interface WebIndexDeps {
  /**
   * Index one chunk into BOTH stores. Called SERIALY by the fetcher (caller
   * awaits each call). Implementations typically do:
   *   await Promise.all([
   *     vectorStore.addDocuments([doc]),
   *     keywordSearch.index(doc.id, doc.content, doc.metadata),
   *   ]);
   */
  indexChunk(chunk: IndexedChunk): Promise<void>;
  /**
   * Return the timestamp (ms since epoch) this (source,url) was last indexed,
   * or `null` if unknown / stale-beyond-repair. Used for TTL cache hits.
   */
  getLastIndexedAt?(cacheKey: string): number | null;
  /** Record that indexing just finished for this cacheKey (post-write). */
  markIndexed?(cacheKey: string, ts: number): void;
}

/** Hash the (source, url) tuple into a stable cache/storage key. */
export function composeFetchCacheKey(source: string | undefined, url: string): string {
  const label = source && source.trim() ? source.trim() : url;
  const h = createHash("sha256").update(url).digest("hex").slice(0, 16);
  return `${label}#${h}`;
}

/** Internal: what content-type bucket does a response fall into? */
function classifyContentType(
  contentTypeHeader: string,
): FetchContentType {
  const ct = contentTypeHeader.toLowerCase();
  if (ct.includes("application/json") || ct.includes("+json")) return "json";
  if (ct.includes("text/html") || ct.includes("application/xhtml")) return "html";
  return "text";
}

/**
 * Read the response body with a hard byte ceiling. Checks Content-Length first
 * (cheap, before any buffering) and then caps the actual streamed read so a
 * lying header or chunked encoding can't exhaust memory.
 */
async function readCappedBody(resp: Response): Promise<string> {
  const cl = parseInt(resp.headers.get("content-length") || "0", 10);
  if (cl && cl > MAX_FETCH_BYTES) {
    throw new Error(
      `Content-Length ${cl} exceeds cap ${MAX_FETCH_BYTES}`,
    );
  }
  // Read in chunks so we can abort mid-stream if the body exceeds the cap.
  const reader = resp.body?.getReader();
  if (!reader) {
    // No streaming body (e.g. some redirect responses already drained) — fall
    // back to .text(). Already bounded by Content-Length above when present.
    const text = await resp.text();
    if (text.length > MAX_FETCH_BYTES) {
      throw new Error(`body ${text.length} bytes exceeds cap ${MAX_FETCH_BYTES}`);
    }
    return text;
  }
  const decoder = new TextDecoder("utf-8");
  let received = 0;
  let out = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_FETCH_BYTES) {
      try {
        await reader.cancel();
      } catch {
        /* ignore */
      }
      throw new Error(
        `streamed body exceeded cap ${MAX_FETCH_BYTES} (read ${received} bytes)`,
      );
    }
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode(); // flush
  return out;
}

export interface FetchOneOptions extends FetchGuardOptions {
  source?: string;
  /** Skip cache and re-fetch. */
  force?: boolean;
  /** Override cache window for this call (ms). `0` bypasses cache like force. */
  ttl?: number;
  /** projectId scoping the indexed chunks. Defaults to a synthetic web pid. */
  projectId?: string;
}

/**
 * Fetch + convert + index a single URL. Safe to run in PARALLEL on the fetch
 * phase; the indexing drain inside is SERIAL (awaits indexChunk per chunk).
 *
 * `projectId` defaults to `"web"` so fetched content lives in its own scope
 * unless the caller namespaces it. Tests should pass a throwaway pid to avoid
 * polluting any shared index.
 */
export async function fetchAndConvertOne(
  url: string,
  deps: WebIndexDeps,
  opts: FetchOneOptions = {},
): Promise<FetchOneResult> {
  const { source, force, ttl, projectId = "web", timeoutMs, signal, _compose } = opts;
  const cacheKey = composeFetchCacheKey(source, url);

  // TTL cache hit — skip both fetch and index. `force` or `ttl: 0` bypass.
  if (!force && ttl !== 0 && deps.getLastIndexedAt) {
    const last = deps.getLastIndexedAt(cacheKey);
    if (last !== null && last !== undefined) {
      const ageMs = Date.now() - last;
      const windowMs = ttl ?? DEFAULT_FETCH_TTL_MS;
      if (ageMs < windowMs) {
        // chunkCount 0 in the public result: the chunks are NOT re-returned on a
        // cache hit (they were indexed on the original fetch). The earlier
        // internal sentinel (-1) leaked into tool output; 0 reads correctly to
        // callers as "no chunks in this response."
        return { kind: "cached", url, source: source || url, chunkCount: 0, ageMs };
      }
    }
  }

  let resp: Response;
  try {
    resp = await fetchWithSsrfGuard(url, { timeoutMs, signal, _compose });
  } catch (err) {
    if (err instanceof SsrfBlockedError) {
      return { kind: "error", url, error: err.message };
    }
    const msg = err instanceof Error ? err.message : String(err);
    logger.warn?.("fetch_and_index fetch failed", { url, error: msg });
    return { kind: "error", url, error: `fetch failed: ${msg}` };
  }

  if (!resp.ok) {
    await resp.body?.cancel().catch(() => {});
    return { kind: "error", url, error: `HTTP ${resp.status} ${resp.statusText}` };
  }

  const contentType = classifyContentType(
    resp.headers.get("content-type") || "",
  );

  let bodyText: string;
  try {
    bodyText = await readCappedBody(resp);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { kind: "error", url, error: msg };
  } finally {
    await resp.body?.cancel().catch(() => {});
  }

  if (!bodyText.trim()) {
    return { kind: "error", url, error: "empty body" };
  }

  // Build the chunk set based on content type.
  const chunks = buildChunks(
    bodyText,
    contentType,
    url,
    source,
    projectId,
    cacheKey,
  );

  // SERIAL index drain — single writer. Fetches raced in the controller's
  // run-pool; this drain is the part that must not parallelize.
  for (const chunk of chunks) {
    try {
      await deps.indexChunk(chunk);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("fetch_and_index indexChunk failed", err as Error, {
        url,
        chunkId: chunk.id,
      });
      return {
        kind: "error",
        url,
        error: `indexing failed at chunk ${chunk.id}: ${msg}`,
      };
    }
  }

  deps.markIndexed?.(cacheKey, Date.now());

  return {
    kind: "fetched",
    url,
    source: source || url,
    contentType,
    chunks,
    bytes: Buffer.byteLength(bodyText, "utf-8"),
  };
}

/**
 * Convert a fetched body into IndexedChunk[] based on its content-type bucket.
 * HTML → markdown (then one chunk per ~chunk-size slice); JSON → one chunk per
 * leaf key-path; text → a single chunk. Every chunk's metadata carries the
 * source url, cacheKey, and projectId so `search` can filter them back out.
 */
function buildChunks(
  body: string,
  contentType: FetchContentType,
  url: string,
  source: string | undefined,
  projectId: string,
  cacheKey: string,
): IndexedChunk[] {
  const baseMeta = {
    projectId,
    source: source || url,
    url,
    cacheKey,
    fetchedAt: new Date().toISOString(),
  };
  const urlHash = createHash("sha256").update(url).digest("hex").slice(0, 12);

  if (contentType === "json") {
    let parsed: unknown = body;
    try {
      parsed = JSON.parse(body);
    } catch {
      // Not valid JSON despite the header — treat as text.
      parsed = body;
    }
    if (typeof parsed === "string" || typeof parsed === "number" || typeof parsed === "boolean") {
      return [
        {
          id: `${projectId}:web:${urlHash}:0`,
          content: `**$** = \`${String(parsed)}\`\n\n_source: ${url}_`,
          metadata: { ...baseMeta, type: "json_leaf", label: "$" },
        },
      ];
    }
    const jc = jsonToKeyPathChunks(parsed);
    if (jc.length === 0) {
      return [
        {
          id: `${projectId}:web:${urlHash}:0`,
          content: body.slice(0, 7500),
          metadata: { ...baseMeta, type: "json_text" },
        },
      ];
    }
    return jc.map((c, i) => ({
      id: `${projectId}:web:${urlHash}:${i}`,
      content: `${c.content}\n\n_source: ${url}_`,
      metadata: { ...baseMeta, type: "json_key", label: c.path, path: c.path },
    }));
  }

  if (contentType === "html") {
    const md = htmlToMarkdown(body);
    if (!md) return [];
    // Slice oversized markdown into ~7500-char chunks (matches the chunker's
    // maxChunkChars cap) so no single doc overflows the embedding model.
    return sliceMarkdown(md, 7500).map((slice, i) => ({
      id: `${projectId}:web:${urlHash}:${i}`,
      content: `_source: ${url}_\n\n${slice}`,
      metadata: { ...baseMeta, type: "web_html", chunkIndex: i },
    }));
  }

  // Plain text / CSV / XML / etc.
  return [
    {
      id: `${projectId}:web:${urlHash}:0`,
      content: `_source: ${url}_\n\n${body.slice(0, 7500)}`,
      metadata: { ...baseMeta, type: "web_text" },
    },
  ];
}

/** Split markdown on paragraph boundaries near every `size` chars. */
function sliceMarkdown(md: string, size: number): string[] {
  if (md.length <= size) return [md];
  const out: string[] = [];
  let start = 0;
  while (start < md.length) {
    let end = Math.min(start + size, md.length);
    if (end < md.length) {
      // Try to break on a blank line within the last 500 chars of the window.
      const breakRegion = md.lastIndexOf("\n\n", end);
      if (breakRegion > start + size * 0.5) end = breakRegion + 2;
    }
    out.push(md.slice(start, end));
    start = end;
  }
  return out.filter((s) => s.trim().length > 0);
}
