/**
 * Web ingestion service — SSRF-guarded fetch + HTML→md + index.
 *
 * Public surface:
 *   - classifyIp / assertUrlSafe / fetchWithSsrfGuard / SsrfBlockedError (ssrf)
 *   - htmlToMarkdown / jsonToKeyPathChunks (html-to-md)
 *   - fetchAndConvertOne / composeFetchCacheKey / MAX_FETCH_BYTES /
 *     DEFAULT_FETCH_TTL_MS + types (fetcher)
 *   - WebController (orchestration)
 */

export {
  classifyIp,
  assertUrlSafe,
  fetchWithSsrfGuard,
  SsrfBlockedError,
  setDnsResolver,
  MAX_REDIRECTS,
  type IpClass,
  type FetchGuardOptions,
  type DnsResolver,
  type UrlSafetyResult,
} from "./ssrf.js";

export {
  htmlToMarkdown,
  jsonToKeyPathChunks,
  type JsonChunk,
} from "./html-to-md.js";

export {
  fetchAndConvertOne,
  composeFetchCacheKey,
  MAX_FETCH_BYTES,
  DEFAULT_FETCH_TTL_MS,
  type FetchContentType,
  type FetchOneResult,
  type FetchOneOptions,
  type IndexedChunk,
  type WebIndexDeps,
} from "./fetcher.js";

export {
  WebController,
  type FetchRequest,
  type FetchAndIndexParams,
  type WebControllerDeps,
} from "./web-controller.js";
