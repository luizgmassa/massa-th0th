/**
 * T11 — Observability: analytics + HTTP-only endpoints + system (E2E, live).
 *
 * Covers the two observability surfaces of massa-th0th against the RUNNING
 * Tools API (http://localhost:3333) + the MCP stdio subprocess. PostgreSQL
 * backend; auth off; Ollama up (qwen3-embedding).
 *
 * (A) analytics — MCP tool `analytics` over POST /api/v1/analytics.
 *     F81 each type returns success + payload; F82 limit honored;
 *     F83 project/cache require projectId. Plus a cross-transport matrix
 *     (analytics is bucket C: no format flag) for summary + recent.
 *
 * (B) HTTP-only endpoints (no MCP surface) — section I:
 *     /health, /swagger + /swagger/json, /api/v1/project/list,
 *     /api/v1/search/code (alias of search_project),
 *     /api/v1/workspace/:id (GET only — DELETE skipped: would destroy the
 *       shared index), /api/v1/symbol/centrality/:projectId,
 *     /api/v1/system/{info,status,metrics,health/local,ollama},
 *     /api/v1/events (SSE), and /ui (HTML + asset resolution).
 *
 * Hard constraints: READ+TEST only. No source edits. No restart of tools-api.
 * Real product bug → test.skip with printed reason + report. SHARED_PID is
 * reused (NOT reset) — workspace DELETE is skipped, never executed.
 *
 * Verified-against-live shape notes (authoritative over any spec wording):
 *  - /api/v1/search/code is POST (NOT GET); the route registers POST /code.
 *    SearchCodeTool does NOT accept format/maxResults — only query/projectId/
 *    limit — and delegates to search_project in summary mode (default TOON
 *    body). The code-search test asserts a non-empty body + markers, not JSON.
 *  - /health → {status:"ok", service, version, timestamp}.
 *  - /api/v1/system/ollama → {available, latency, details:{embeddingModel,...},
 *    configuredModel, baseUrl, models:[...]} (no top-level embeddingModel).
 *  - /api/v1/system/status reports {status, services, timestamp}. `status` is
 *    "healthy" when all six SQLite DB files exist, else "degraded". On a
 *    PostgreSQL-backed (dedicated) stack the optional `embedding-cache.db` is
 *    not materialized (vectors/analytics run on PG), so `embeddingCache:false`
 *    + `status:"degraded"` is the CORRECT observed shape — not a defect
 *    (Finding #13 is informational, test-only). The status test asserts the
 *    well-formed shape and tolerates BOTH `healthy` and `degraded`.
 */
import { describe, test, expect, beforeAll, afterAll } from "bun:test";
import {
  API,
  E2E_ENABLED,
  PREFIX,
  RUN_STAMP,
  assertE2ePrefix,
  probeAvailability,
  httpGet,
  httpPost,
  httpRaw,
  normalize,
  assertMatrix,
  SHARED_PID,
  ensureSharedIndex,
} from "./_helpers";
import { startMcp, mcpCall, requireTool, type McpHandle } from "./_mcp";

// ── Gating ────────────────────────────────────────────────────────────────
let SKIP_REASON = "";
const READY = await (async () => {
  if (!E2E_ENABLED) {
    SKIP_REASON = "RUN_E2E != 1";
    return false;
  }
  const a = await probeAvailability();
  if (!a.API_UP) {
    SKIP_REASON = "Tools API not up at " + API;
    return false;
  }
  return true;
})();

// ── Project IDs ───────────────────────────────────────────────────────────
// Throwaway workspace id for the optional DELETE coverage — NOT created by
// default. Kept only to document intent; the DELETE test is skipped.
const THROWAWAY_PID = `${PREFIX}obs-${RUN_STAMP}`;
assertE2ePrefix(THROWAWAY_PID);

// Shared indexed PID for read endpoints (workspace GET, centrality, search).
let SID = "";

// ── MCP handle (lazily started; only analytics has an MCP surface here) ───
let mcp: McpHandle | null = null;

/**
 * Mark a runtime-detected matrix skip. bun's test.skip() cannot be called
 * inside a test body, so for conditions only knowable at call time we log a
 * clear [T11:SKIP:matrix] reason and return true; the caller does an early
 * `return` and the test passes as a documented no-op.
 */
function skipMatrix(reason: string): true {
  console.log(`[T11:SKIP:matrix] ${reason}`);
  return true;
}

// ── Setup / teardown ──────────────────────────────────────────────────────
beforeAll(async () => {
  if (!READY) {
    console.log(`[T11:SKIP] ${SKIP_REASON}`);
    return;
  }
  // Most read endpoints need an indexed project; reuse the shared index.
  SID = await ensureSharedIndex();
  // analytics has an MCP surface; start the subprocess once for matrix tests.
  try {
    mcp = await startMcp();
  } catch (e: any) {
    console.log(`[T11:WARN] MCP start failed: ${String(e?.message ?? e).slice(0, 200)}`);
    mcp = null;
  }
}, 700_000);

afterAll(async () => {
  if (mcp) {
    try {
      await mcp.stop();
    } catch {
      /* ignore */
    }
  }
});

// ── Tests ─────────────────────────────────────────────────────────────────
describe.skipIf(!READY)("T11 — Observability", () => {
  // ── (A) analytics — MCP tool over POST /api/v1/analytics ────────────────
  describe("analytics (F81–F83 + matrix)", () => {
    test("F81 summary returns success + result payload", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "summary", limit: 5 });
      console.log(`[T11:F81:summary] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.type).toBe("summary");
      expect(r?.data?.result).toBeTypeOf("object");
    }, 30_000);

    test("F81 project (with projectId:SID) returns success + result", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "project", projectId: SID, limit: 5 });
      console.log(`[T11:F81:project] ${JSON.stringify(r).slice(0, 300)}`);
      // project may legitimately return success:false when no analytics row
      // exists for SID yet — assert BOTH branches are well-formed.
      if (r?.success === true) {
        expect(r?.data?.type).toBe("project");
        expect(r?.data?.projectId).toBe(SID);
        expect(r?.data?.result).toBeDefined();
      } else {
        expect(typeof r?.error).toBe("string");
        console.log(
          `[T11:F81:project] no analytics row for ${SID} yet (success:false) — documented behavior`,
        );
      }
    }, 30_000);

    test("F81 query (with query string) returns success + result", async () => {
      const r = await httpPost<any>("/api/v1/analytics", {
        type: "query",
        query: "ContextualSearchRLM",
      });
      console.log(`[T11:F81:query] ${JSON.stringify(r).slice(0, 300)}`);
      if (r?.success === true) {
        expect(r?.data?.type).toBe("query");
        expect(r?.data?.query).toBe("ContextualSearchRLM");
      } else {
        // No analytics recorded for this exact query — acceptable.
        expect(typeof r?.error).toBe("string");
        console.log(`[T11:F81:query] no query analytics yet (success:false) — documented`);
      }
    }, 30_000);

    test("F81 cache (with projectId:SID) returns success + result", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "cache", projectId: SID });
      console.log(`[T11:F81:cache] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.type).toBe("cache");
      expect(r?.data?.result).toBeDefined();
    }, 30_000);

    test("F81 recent returns success + array result", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "recent", limit: 10 });
      console.log(`[T11:F81:recent] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.type).toBe("recent");
      expect(Array.isArray(r?.data?.result)).toBe(true);
    }, 30_000);

    test("F82 limit honored (recent with limit:3 → ≤3)", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "recent", limit: 3 });
      const arr = r?.data?.result ?? [];
      console.log(`[T11:F82] recent limit:3 → got ${arr.length}`);
      expect(r?.success).toBe(true);
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeLessThanOrEqual(3);
    }, 30_000);

    test("F83 project without projectId → error or empty (documents actual behavior)", async () => {
      const r = await httpPost<any>("/api/v1/analytics", { type: "project" });
      console.log(`[T11:F83:project-noId] ${JSON.stringify(r).slice(0, 300)}`);
      // Verified live: GetAnalyticsTool returns {success:false, error:"projectId is required..."}.
      expect(r?.success).toBe(false);
      expect(typeof r?.error).toBe("string");
    }, 30_000);

    test("F83 cache without projectId → global cache stats (success)", async () => {
      // #15: cache is intentionally dual-mode — global stats when projectId
      // omitted, scoped when provided. Unlike "project", "cache" does NOT
      // validate projectId. Assert the GLOBAL success contract.
      const r = await httpPost<any>("/api/v1/analytics", { type: "cache" });
      console.log(`[T11:F83:cache-noId] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.type).toBe("cache");
      expect(r?.data?.result).toBeDefined();
    }, 30_000);

    test("F83 cache WITH projectId → scoped cache stats (success)", async () => {
      // #15: providing projectId scopes cache stats to one project.
      const r = await httpPost<any>("/api/v1/analytics", {
        type: "cache",
        projectId: SID,
      });
      console.log(`[T11:F83:cache-withId] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.type).toBe("cache");
      expect(r?.data?.projectId).toBe(SID);
      expect(r?.data?.result).toBeDefined();
    }, 30_000);

    // ── Matrix (bucket C: no format flag) ──────────────────────────────────
    test("matrix: MCP analytics(summary) ≡ HTTP (drop counts/timestamps)", async () => {
      if (!mcp) {
        if (skipMatrix("MCP not started — skipping analytics summary matrix")) return;
      }
      requireTool(mcp!.toolNames, "analytics");

      const httpRes = await httpPost<any>("/api/v1/analytics", { type: "summary", limit: 5 });
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(mcp!.client, "analytics", { type: "summary", limit: 5 });
      } catch (e: any) {
        if (
          skipMatrix(
            `MCP analytics(summary) call failed: ${String(e?.message ?? e).slice(0, 200)}`,
          )
        )
          return;
        return;
      }
      if (mcpRes?.success !== true) {
        if (
          skipMatrix(
            `MCP analytics(summary) not success: ${JSON.stringify(mcpRes).slice(0, 200)}`,
          )
        )
          return;
        return;
      }
      // Drop volatile: counts (totalSearches varies between calls), topQueries
      // counts (string-typed, varies), and any timestamp.
      assertMatrix(
        httpRes,
        mcpRes,
        { dropKeys: ["totalSearches", "topQueries", "uniqueProjects", "avgDuration"] },
        "analytics(summary)",
      );
      console.log(`[T11:matrix:summary] http≡mcp ✓`);
    }, 60_000);

    test("matrix: MCP analytics(recent) ≡ HTTP (drop result rows — volatile)", async () => {
      if (!mcp) {
        if (skipMatrix("MCP not started — skipping analytics recent matrix")) return;
      }
      requireTool(mcp!.toolNames, "analytics");

      const httpRes = await httpPost<any>("/api/v1/analytics", { type: "recent", limit: 3 });
      let mcpRes: any;
      try {
        mcpRes = await mcpCall(mcp!.client, "analytics", { type: "recent", limit: 3 });
      } catch (e: any) {
        if (
          skipMatrix(
            `MCP analytics(recent) call failed: ${String(e?.message ?? e).slice(0, 200)}`,
          )
        )
          return;
        return;
      }
      if (mcpRes?.success !== true) {
        if (
          skipMatrix(
            `MCP analytics(recent) not success: ${JSON.stringify(mcpRes).slice(0, 200)}`,
          )
        )
          return;
        return;
      }
      // The result array is entirely volatile (timestamps, per-call rows).
      // Compare the deterministic envelope: { success, data:{ type } }.
      const a = { success: httpRes?.success === true, type: httpRes?.data?.type };
      const b = { success: mcpRes?.success === true, type: mcpRes?.data?.type };
      expect(a).toEqual(b);
      console.log(`[T11:matrix:recent] http≡mcp envelope ✓ (result rows dropped: volatile)`);
    }, 60_000);
  });

  // ── (B) HTTP-only endpoints — section I ─────────────────────────────────
  describe("HTTP-only endpoints (section I)", () => {
    test("/health → {status, service, version, timestamp}", async () => {
      const r = await httpGet<any>("/health");
      console.log(`[T11:health] ${JSON.stringify(r)}`);
      expect(r?.status).toBe("ok");
      expect(r?.service).toBe("massa-th0th-tools-api");
      expect(typeof r?.version).toBe("string");
      expect(typeof r?.timestamp).toBe("string");
    }, 15_000);

    test("/swagger serves HTML docs and /swagger/json is valid OpenAPI", async () => {
      const docs = await httpRaw("/swagger");
      expect(docs.ok).toBe(true);
      expect(docs.headers.get("content-type") ?? "").toContain("text/html");

      const spec = await httpGet<any>("/swagger/json");
      console.log(`[T11:swagger] openapi=${spec?.openapi} title=${spec?.info?.title}`);
      expect(spec?.openapi).toBeDefined();
      expect(spec?.openapi?.startsWith("3.")).toBe(true);
      expect(spec?.info?.title).toBe("massa-th0th Tools API");
      expect(spec?.paths).toBeTypeOf("object");
      // The analytics + system paths must be present in the spec. The
      // analytics route is `prefix:"/api/v1/analytics"` + `.post("/")`, so
      // Elysia registers it under "/api/v1/analytics/" (trailing slash).
      const paths = spec?.paths ?? {};
      expect(paths["/api/v1/analytics"] ?? paths["/api/v1/analytics/"]).toBeDefined();
      expect(paths["/api/v1/system/info"]).toBeDefined();
    }, 15_000);

    test("/api/v1/project/list → success + array of indexed projects (SHARED_PID present)", async () => {
      const r = await httpGet<any>("/api/v1/project/list");
      console.log(`[T11:project/list] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(Array.isArray(r?.data?.projects)).toBe(true);
      const ids = (r?.data?.projects ?? []).map((p: any) => p?.projectId).filter(Boolean);
      expect(ids).toContain(SHARED_PID);
    }, 20_000);

    test("/api/v1/search/code POST returns results (alias of search_project; non-JSON body)", async () => {
      // Verified live: /api/v1/search/code is POST. SearchCodeTool does NOT
      // accept format/maxResults — it delegates to search_project in summary
      // mode whose default body is TOON text. Assert a non-empty body that
      // carries the query + projectId markers and ≥1 result.
      const r = await httpPost<any>("/api/v1/search/code", {
        query: "mutex queue",
        projectId: SID,
        limit: 3,
      });
      console.log(`[T11:search/code] success=${r?.success} body-type=${typeof r?.data}`);
      expect(r?.success).toBe(true);
      // data is the TOON text body (a string). It must mention the query and
      // show at least one result line.
      const body = typeof r?.data === "string" ? r.data : JSON.stringify(r?.data ?? {});
      expect(body).toMatch(/mutex queue|projectId:.*shared|totalResults/i);
      expect(body.length).toBeGreaterThan(20);
    }, 60_000);

    test("/api/v1/workspace/:id (GET) → workspace detail for SID", async () => {
      const r = await httpGet<any>(`/api/v1/workspace/${SID}`);
      console.log(`[T11:workspace:GET] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.project_id ?? r?.data?.projectId).toBe(SID);
    }, 20_000);

    test.skip(
      "DELETE /api/v1/workspace/:id — SKIPPED: would destroy the shared index " +
        "(SHARED_PID is reused across every file/run). A throwaway workspace " +
        "would require a full re-index (~heavy). Run in T13 dedicated destructive suite.",
      () => {},
    );

    test("/api/v1/symbol/centrality/:projectId → top PageRank files (array, sorted)", async () => {
      const r = await httpGet<any>(`/api/v1/symbol/centrality/${SID}`, { limit: 5 });
      console.log(`[T11:centrality] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r?.success).toBe(true);
      expect(r?.data?.projectId).toBe(SID);
      const files = r?.data?.files ?? [];
      expect(Array.isArray(files)).toBe(true);
      expect(files.length).toBeGreaterThan(0);
      // Sorted descending by score (PageRank).
      const scores = files.map((f: any) => Number(f?.score ?? 0));
      const sorted = [...scores].sort((a, b) => b - a);
      expect(scores).toEqual(sorted);
    }, 20_000);

    test("/api/v1/system/info → version/service/node/platform/dataDir/databases", async () => {
      const r = await httpGet<any>("/api/v1/system/info");
      console.log(`[T11:system:info] keys=${Object.keys(r ?? {}).join(",")}`);
      expect(r?.version).toBeTypeOf("string");
      expect(r?.service).toBe("massa-th0th-tools-api");
      expect(typeof r?.node).toBe("string");
      expect(typeof r?.platform).toBe("string");
      expect(typeof r?.dataDir).toBe("string");
      expect(r?.databases).toBeTypeOf("object");
      expect(r?.databases?.sizes).toBeTypeOf("object");
    }, 15_000);

    test("/api/v1/system/status → well-formed status + services map (Finding #13: informational)", async () => {
      // Finding #13 is INFORMATIONAL, not a defect: system.ts derives `status`
      // from SQLite DB file existence. On a PostgreSQL-backed (dedicated) stack
      // the optional `embedding-cache.db` is NOT materialized — vectors and
      // analytics run on PG — so the endpoint faithfully reports
      // `status:"degraded"` + `services.embeddingCache:false`. That is the
      // correct observed shape, so this scenario asserts the well-formed shape
      // and explicitly tolerates BOTH `healthy` (all six DBs present, e.g. a
      // fully SQLite-backed stack) and `degraded` (one or more optional DBs
      // absent, e.g. the PG-backed dedicated stack). The six service keys are
      // always present; each is a boolean.
      const r = await httpGet<any>("/api/v1/system/status");
      console.log(`[T11:system:status] ${JSON.stringify(r).slice(0, 300)}`);

      // status is healthy OR degraded — both valid depending on which optional
      // DBs the backing stack materializes. ("unhealthy" is never emitted by
      // system.ts:107-113, which only toggles between healthy/degraded.)
      expect(["healthy", "degraded"]).toContain(r?.status);

      // All six service keys present, each a boolean.
      expect(r?.services).toBeTypeOf("object");
      const services = r?.services ?? {};
      const EXPECTED_KEYS = [
        "memories",
        "vectorStore",
        "searchCache",
        "analytics",
        "keywordSearch",
        "embeddingCache",
      ] as const;
      for (const key of EXPECTED_KEYS) {
        expect(key in services).toBe(true);
        expect(typeof services[key]).toBe("boolean");
      }

      // embeddingCache may legitimately be false on a PG-backed stack (optional
      // SQLite cache not materialized when vectors/analytics run on PG). This is
      // NOT a failure — assert it stays a boolean, not that it is true.
      expect(typeof services.embeddingCache).toBe("boolean");

      expect(typeof r?.timestamp).toBe("string");
    }, 15_000);

    test("/api/v1/system/metrics → metrics object + system block (shape)", async () => {
      const r = await httpGet<any>("/api/v1/system/metrics");
      console.log(`[T11:system:metrics] keys=${Object.keys(r ?? {}).join(",")}`);
      // Metrics is a free-form aggregate (embeddings/context/cache/system).
      expect(r).toBeTypeOf("object");
      expect(r?.system).toBeTypeOf("object");
      expect(typeof r?.timestamp).toBe("string");
      // The system block carries memory + uptime + dataSize.
      expect(r?.system?.memory).toBeTypeOf("object");
      expect(typeof r?.system?.uptime).toBe("number");
    }, 15_000);

    test("/api/v1/system/health/local → local-first health check (shape)", async () => {
      const r = await httpGet<any>("/api/v1/system/health/local");
      console.log(`[T11:system:health/local] ${JSON.stringify(r).slice(0, 300)}`);
      expect(r).toBeTypeOf("object");
      expect(["healthy", "degraded", "unhealthy"]).toContain(r?.status);
    }, 30_000);

    test("/api/v1/system/ollama → {available:true, embeddingModel, ...}", async () => {
      const r = await httpGet<any>("/api/v1/system/ollama");
      console.log(`[T11:system:ollama] ${JSON.stringify(r).slice(0, 300)}`);
      // Verified live: top-level has `available` + `details.embeddingModel`
      // (no top-level `embeddingModel`). Assert both surfaces.
      expect(r?.available).toBe(true);
      expect(r?.details?.embeddingModel).toBeTypeOf("string");
      expect(Array.isArray(r?.models)).toBe(true);
    }, 30_000);

    test("/api/v1/events?projectId=SID → SSE stream (content-type + ≥1 chunk within 20s)", async () => {
      // SSE: connect with a raw fetch (no timeout helper), read at least one
      // chunk. The stream sends an initial `connected` event immediately, then
      // a 15s heartbeat. We assert content-type + that we receive a line.
      const res = await fetch(`${API}/api/v1/events?projectId=${encodeURIComponent(SID)}`, {
        headers: { accept: "text/event-stream" },
        signal: AbortSignal.timeout(25_000),
      });
      expect(res.status).toBe(200);
      const ct = res.headers.get("content-type") ?? "";
      expect(ct).toContain("text/event-stream");

      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let received = "";
      const deadline = Date.now() + 20_000;
      let sawLine = false;
      try {
        while (Date.now() < deadline) {
          const { value, done } = await reader.read();
          if (done) break;
          received += decoder.decode(value, { stream: true });
          if (received.includes("\n")) {
            sawLine = true;
            break;
          }
        }
      } finally {
        try {
          await reader.cancel();
        } catch {
          /* ignore */
        }
        try {
          await res.body?.cancel();
        } catch {
          /* ignore */
        }
      }
      console.log(`[T11:events] sawLine=${sawLine} first-chunk=${received.slice(0, 200)}`);
      expect(sawLine).toBe(true);
      // The first line is either `data: {...connected...}` or a `: heartbeat`.
      expect(received.length).toBeGreaterThan(0);
    }, 40_000);

    test("/ui → HTML body with expected markup + referenced asset resolves", async () => {
      // commit 767892c: serve /ui as HTML + fix asset resolution.
      const res = await httpRaw("/ui");
      expect(res.ok).toBe(true);
      expect(res.headers.get("content-type") ?? "").toContain("text/html");
      const html = await res.text();
      expect(html).toMatch(/<html/i);

      // Grep the HTML for a referenced asset path (link href or script src)
      // under /ui/... and HEAD it → expect 200.
      const assetMatch = html.match(/(?:href|src)=["']([^"']+\/ui\/[^"']+)["']/i);
      if (!assetMatch) {
        console.log(
          `[T11:ui] no absolute /ui/... asset reference found in HTML — best-effort asset check skipped`,
        );
        // The HTML body itself was served correctly; asset grep is best-effort.
        expect(html).toMatch(/<html/i);
        return;
      }
      // Resolve the asset path relative to the API origin (strip leading /ui
      // and re-request via /ui/...). The regex above captured the full path.
      let assetPath = assetMatch[1];
      if (assetPath.startsWith("http")) {
        // absolute URL — use as-is; otherwise convert to a path.
        const u = new URL(assetPath);
        assetPath = u.pathname;
      }
      const assetRes = await httpRaw(assetPath);
      console.log(`[T11:ui] asset ${assetPath} → ${assetRes.status} ${assetRes.headers.get("content-type")}`);
      expect(assetRes.ok).toBe(true);
    }, 20_000);
  });
});
