/**
 * fetch_and_index tool — SSRF-guarded web fetch + HTML→md conversion + index.
 *
 * Thin handler (mirrors BatchExecuteTool's shape): validates nothing itself and
 * delegates to an injected `run` function. The Tools API route binds `run` to
 * `WebController.fetchAndIndex` after resolving the async vector store; tests
 * bind it to a captured stub.
 *
 * Params (single OR batch):
 *   - url + source         → single fetch
 *   - requests[]           → batch (wins over url when both supplied)
 *   - concurrency (1-8)    → parallel fetch phase (cpu-capped for batch)
 *   - force                → bypass TTL cache
 *   - ttl                  → per-call cache window override (ms; 0 = bypass)
 *
 * Indexing is always SERIAL per URL (single-writer safety) even when fetches
 * race in the run-pool. Returns per-URL status + chunk counts.
 */

import type { ToolResponse, IToolHandler } from "@massa-ai/shared";
import type { FetchAndIndexParams } from "../services/web/web-controller.js";

export class FetchAndIndexTool implements IToolHandler {
  name = "fetch_and_index";
  description =
    "Fetch URL(s), convert HTML to markdown (JSON → key-path chunks), and " +
    "index them for search. SSRF-guarded: loopback/private/link-local/IMDS " +
    "IPs are blocked, including redirect-to-internal. Parallel fetch, serial " +
    "index. TTL-cached (~24h).";

  inputSchema = {
    type: "object",
    properties: {
      url: {
        type: "string",
        description: "Single URL to fetch and index (single-shape).",
      },
      source: {
        type: "string",
        description: "Label for the indexed content when using single `url`.",
      },
      requests: {
        type: "array",
        items: {
          type: "object",
          properties: {
            url: { type: "string", description: "URL to fetch." },
            source: {
              type: "string",
              description: "Label for this URL's indexed content.",
            },
          },
          required: ["url"],
        },
        description:
          "Batch shape: array of {url, source?}. Use with concurrency>1 for " +
          "parallel fetch. Output preserves input order.",
      },
      concurrency: {
        type: "number",
        description:
          "Max URLs fetched in parallel (1-8, default 1). Capped by cpu count.",
      },
      force: {
        type: "boolean",
        description: "Skip cache and re-fetch even if recently indexed.",
      },
      ttl: {
        type: "number",
        description:
          "Override cache freshness window (ms). 0 bypasses cache like force.",
      },
    },
  };

  private run: (params: FetchAndIndexParams) => Promise<ToolResponse>;

  constructor(run: (params: FetchAndIndexParams) => Promise<ToolResponse>) {
    this.run = run;
  }

  async handle(params: unknown): Promise<ToolResponse> {
    return this.run(params as FetchAndIndexParams);
  }
}
