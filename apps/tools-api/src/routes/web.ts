/**
 * Web Routes
 *
 * POST /api/v1/web/fetch_and_index - SSRF-guarded fetch + HTML→md + index
 *
 * Resolves the async vector store + keyword search once (lazily, on first
 * request) and binds them into a WebController singleton, then delegates each
 * request to FetchAndIndexTool → WebController.fetchAndIndex.
 */

import { Elysia, t } from "elysia";
import {
  FetchAndIndexTool,
  WebController,
  getVectorStore,
  getKeywordSearch,
} from "@massa-ai/core";

let tool: FetchAndIndexTool | null = null;
let initPromise: Promise<FetchAndIndexTool> | null = null;

/**
 * Lazily resolve the real stores and bind them into the WebController + tool.
 * Serialized via initPromise so concurrent first-requests don't double-init.
 */
function getTool(): Promise<FetchAndIndexTool> {
  if (tool) return Promise.resolve(tool);
  if (initPromise) return initPromise;
  initPromise = (async () => {
    const [vectorStore, keywordSearch] = await Promise.all([
      getVectorStore(),
      Promise.resolve(getKeywordSearch()),
    ]);
    WebController.instantiate({ vectorStore, keywordSearch });
    const controller = WebController.getInstance();
    tool = new FetchAndIndexTool((params) => controller.fetchAndIndex(params));
    return tool;
  })().finally(() => {
    initPromise = null;
  });
  return initPromise;
}

export const webRoutes = new Elysia({ prefix: "/api/v1/web" }).post(
  "/fetch_and_index",
  async ({ body }) => {
    const t = await getTool();
    return await t.handle(body);
  },
  {
    body: t.Object({
      url: t.Optional(t.String({ description: "Single URL to fetch and index." })),
      source: t.Optional(
        t.String({ description: "Label for the indexed content (single url)." }),
      ),
      requests: t.Optional(
        t.Array(
          t.Object({
            url: t.String({ description: "URL to fetch." }),
            source: t.Optional(t.String({ description: "Label for this URL." })),
          }),
        ),
      ),
      concurrency: t.Optional(
        t.Number({
          description: "Max URLs fetched in parallel (1-8, default 1).",
        }),
      ),
      force: t.Optional(t.Boolean({ description: "Bypass TTL cache." })),
      ttl: t.Optional(
        t.Number({
          description: "Per-call cache window override in ms (0 = bypass).",
        }),
      ),
    }),
    detail: {
      summary: "Fetch URL(s), convert HTML→md, and index for search",
      description:
        "SSRF-guarded web fetch: blocks loopback/private/link-local/IMDS IPs " +
        "(including redirect-to-internal and DNS-rebind). HTML → markdown via " +
        "turndown+gfm; JSON → key-path chunks. Parallel fetch (run-pool, " +
        "cpu-capped), serial per-URL indexing. TTL-cached (~24h).",
      tags: ["web"],
    },
  },
);
