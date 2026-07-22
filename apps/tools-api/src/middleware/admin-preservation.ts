/**
 * N19 — Admin access preservation middleware.
 *
 * Four-rung auth ladder:
 *   0 users  → admin endpoints open (no auth required) — first-run bootstrap
 *   1+ users → admin endpoints require auth (API key or future JWT)
 *
 * Minimal preservation logic, NOT a full auth system. The user-count function
 * is a seam: today it returns 0 (no User model exists yet). When auth grows,
 * replace `getUserCount` with a real database query. The middleware contract
 * stays the same.
 *
 * "Ready when auth grows": the middleware is wired but inert until a User
 * model is added. It documents the preservation contract so the first user
 * creation event automatically locks admin endpoints.
 */

import { Elysia } from "elysia";

/**
 * Count registered users. Returns 0 today (no User model in the schema).
 * When auth is implemented, replace this with a real `prisma.user.count()`.
 *
 * This is the single seam future auth work replaces.
 */
export async function getUserCount(): Promise<number> {
  // No User model exists yet. When one is added, implement:
  //   const prisma = getPrismaClient();
  //   return await prisma.user.count();
  return 0;
}

/**
 * Admin endpoints that are gated by the preservation ladder.
 * When 0 users exist, these are open (bootstrap). When 1+ users exist,
 * they require auth (API key or future JWT).
 */
export const ADMIN_ENDPOINTS = [
  "/api/v1/project/reset",
  "/api/v1/project/index",
  "/api/v1/project/upload-and-index",
  "/api/v1/bootstrap",
  "/api/v1/project/rename",
  "/api/v1/project/merge",
];

/**
 * Check if a path matches an admin endpoint pattern.
 * Handles simple patterns and `:param` placeholders.
 */
export function isAdminEndpoint(path: string): boolean {
  // Strip query string
  const cleanPath = path.split("?")[0]!;
  return ADMIN_ENDPOINTS.some((pattern) => {
    if (!pattern.includes(":")) {
      return cleanPath === pattern || cleanPath.startsWith(pattern + "/");
    }
    // Convert :param to a regex segment
    const regex = new RegExp(
      "^" + pattern.replace(/:[^/]+/g, "[^/]+") + "(/.*)?$",
    );
    return regex.test(cleanPath);
  });
}

/**
 * Admin preservation middleware. Runs AFTER the existing auth middleware.
 *
 * - If the request hits an admin endpoint AND there are 0 users → allow (open)
 * - If the request hits an admin endpoint AND there are 1+ users → defer to
 *   the existing API-key auth (auth middleware already ran; if it passed,
 *   the request is authenticated)
 * - Non-admin endpoints → pass through (no preservation check)
 *
 * The middleware caches the user count for a short window to avoid a DB
 * query on every request.
 */
let cachedUserCount: number | null = null;
let cacheExpiry = 0;
const CACHE_TTL_MS = 10_000; // 10 seconds

async function getCachedUserCount(): Promise<number> {
  const now = Date.now();
  if (cachedUserCount !== null && now < cacheExpiry) {
    return cachedUserCount;
  }
  cachedUserCount = await getUserCount();
  cacheExpiry = now + CACHE_TTL_MS;
  return cachedUserCount;
}

/**
 * Reset the user-count cache. Call this after a user is created to ensure
 * the preservation ladder flips immediately.
 */
export function resetUserCountCache(): void {
  cachedUserCount = null;
  cacheExpiry = 0;
}

export const adminPreservationMiddleware = new Elysia({
  name: "admin-preservation",
})
  .onBeforeHandle(
    { as: "global" },
    async ({ path, set }) => {
      if (!isAdminEndpoint(path)) return;

      const userCount = await getCachedUserCount();

      // 0 users → admin endpoints open (bootstrap mode)
      if (userCount === 0) {
        return; // Allow — no auth required
      }

      // 1+ users → defer to existing auth middleware (already ran).
      // If auth middleware already rejected, we never get here.
      // If auth middleware passed, the request is authenticated.
      return;
    },
  );