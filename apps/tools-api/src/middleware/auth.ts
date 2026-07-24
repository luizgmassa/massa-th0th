/**
 * Authentication Middleware
 *
 * Valida API Key no header X-API-Key.
 * Rotas /health e /swagger são públicas.
 *
 * M8 — also derives a minimal `ActorContext` (stable identity seam) from
 * the request for audit-log attribution. Auth is API-key-only today, so the
 * actor is `actorType="api_key"` with `actorId` drawn from the optional
 * `x-actor-id` header (a non-secret identifier) when present, else
 * "unknown". Future identity sources (JWT subject, signed-in user, MCP
 * agent id) replace `deriveActor` without touching call sites — every
 * destructive op already takes `ActorContext` from the request.
 */

import { Elysia } from "elysia";
import type { ActorContext } from "@massa-ai/core";

const PUBLIC_PATHS = ["/health", "/swagger", "/swagger/json"];

/**
 * Derive the actor responsible for a request. Pure function — no I/O, no
 * secrets. Reads the optional `x-actor-id` header (callers may set a
 * non-secret identifier like an agent name or user id). When absent,
 * returns "unknown" so the audit row still records that *something*
 * performed the op.
 *
 * This is the single seam future identity work replaces: swap the body to
 * decode a JWT / session cookie / MCP agent header and every call site
 * picks up the richer identity for free.
 */
export function deriveActor(headers: Record<string, string | string | undefined>): ActorContext {
  const raw = headers["x-actor-id"];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const actorId = typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, 256)
    : "unknown";
  return { actorType: "api_key", actorId };
}

export const authMiddleware = new Elysia({ name: "auth" })
  .onBeforeHandle(
    { as: "global" },
    ({ headers, path, set }) => {
      // Skip auth for public routes
      if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
        return;
      }

      const apiKey = process.env.MASSA_AI_API_KEY;

      // If no API key configured, allow all requests (dev mode)
      if (!apiKey) {
        return;
      }

      const providedKey = headers["x-api-key"];

      if (!providedKey || providedKey !== apiKey) {
        set.status = 401;
        return {
          success: false,
          error: "Unauthorized: Invalid or missing API key",
        };
      }

      // Auth successful
      return;
    },
  )
  // Expose the derived ActorContext on every request so destructive routes
  // can pass it straight into recordOperation without re-parsing headers.
  .derive(({ headers }) => ({ actor: deriveActor(headers as Record<string, string>) }));
