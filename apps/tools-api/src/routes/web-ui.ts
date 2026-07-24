/**
 * Web UI Routes (Phase 8 — read-only memory/search browser, G5).
 *
 * GET /ui/         - Serve the index.html shell
 * GET /ui/<asset>  - Serve a static asset (styles.css, app.js, ...)
 * GET /ui/<path>   - Unknown paths fall back to index.html
 *
 * Reads files verbatim from apps/web-ui/src/static/. Returns 404 for the whole
 * prefix when WEB_UI_ENABLED=false. Path traversal is guarded. No new core
 * logic; the UI consumes existing /api/v1/* read routes at runtime.
 */

import { Elysia } from "elysia";
import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";

const STATIC_DIR_CANDIDATES = (() => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates: string[] = [];
  // source layout: apps/tools-api/src/routes/  ->  ../../web-ui/src/static
  candidates.push(path.resolve(here, "../../web-ui/src/static"));
  // dist layout fallback: apps/tools-api/dist/  ->  ../web-ui/src/static
  candidates.push(path.resolve(here, "../web-ui/src/static"));
  // Walk up from cwd looking for apps/web-ui/src/static (robust to test-runner
  // cwd being the package dir, the monorepo root, or a parent).
  let dir = process.cwd();
  for (let i = 0; i < 8; i++) {
    candidates.push(path.resolve(dir, "apps/web-ui/src/static"));
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return candidates;
})();

async function resolveStaticDir(): Promise<string | null> {
  for (const dir of STATIC_DIR_CANDIDATES) {
    try {
      const st = await fs.stat(dir);
      if (st.isDirectory()) return dir;
    } catch {
      // try next candidate
    }
  }
  return null;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

function webUiDisabled(): boolean {
  const env = process.env.WEB_UI_ENABLED;
  if (env === "false" || env === "0") return true;
  return false;
}

/**
 * Resolve `/<sub>` against the static dir, rejecting traversal. Returns the
 * absolute file path or null if it escapes the static root / doesn't exist.
 */
async function resolveSafePath(
  staticDir: string,
  sub: string,
): Promise<{ abs: string; exists: boolean } | null> {
  const cleaned = sub.replace(/^\/+/, "");
  const abs = path.resolve(staticDir, cleaned);
  const rel = path.relative(staticDir, abs);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    return null; // traversal attempt
  }
  try {
    await fs.stat(abs);
    return { abs, exists: true };
  } catch {
    return { abs, exists: false };
  }
}

export const webUiRoutes = new Elysia()
  .get(
    "/ui",
    async ({ set }) => {
      if (webUiDisabled()) {
        set.status = 404;
        return { status: 404, error: "web ui disabled" };
      }
      const dir = await resolveStaticDir();
      if (!dir) {
        set.status = 500;
        return { status: 500, error: "web ui static dir not found" };
      }
      const indexPath = path.join(dir, "index.html");
      try {
        const body = await fs.readFile(indexPath);
        set.headers["content-type"] = contentTypeFor(indexPath);
        return body;
      } catch {
        set.status = 500;
        return { status: 500, error: "index.html missing" };
      }
    },
    {
      detail: {
        tags: ["webUi"],
        summary: "Web UI shell (read-only memory/search browser)",
        description:
          "Serves the massa-ai read-only web UI index.html. The UI consumes /api/v1/* read routes. Disable with WEB_UI_ENABLED=false.",
      },
    },
  )
  .get(
    "/ui/*",
    async ({ params, set }) => {
      if (webUiDisabled()) {
        set.status = 404;
        return { status: 404, error: "web ui disabled" };
      }
      const dir = await resolveStaticDir();
      if (!dir) {
        set.status = 500;
        return { status: 500, error: "web ui static dir not found" };
      }
      // Elysia `*` wildcard captures the rest of the path in params["*"].
      const sub = (params as { "*": string })["*"] ?? "";
      const resolved = await resolveSafePath(dir, sub);
      if (!resolved) {
        set.status = 400;
        return { status: 400, error: "invalid path" };
      }
      if (resolved.exists) {
        try {
          const body = await fs.readFile(resolved.abs);
          set.headers["content-type"] = contentTypeFor(resolved.abs);
          return body;
        } catch {
          set.status = 500;
          return { status: 500, error: "read failed" };
        }
      }
      // SPA-style fallback: unknown (non-traversal) path -> index.html
      try {
        const body = await fs.readFile(path.join(dir, "index.html"));
        set.headers["content-type"] = "text/html; charset=utf-8";
        return body;
      } catch {
        set.status = 404;
        return { status: 404, error: "not found" };
      }
    },
    {
      detail: {
        tags: ["webUi"],
        summary: "Web UI static asset (or index.html fallback)",
        description:
          "Serves a static asset (styles.css, app.js, ...) from the web-ui bundle. Unknown non-traversal paths fall back to index.html.",
      },
    },
  );
