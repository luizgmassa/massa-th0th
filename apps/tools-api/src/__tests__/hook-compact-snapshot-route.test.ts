/**
 * Route-level compact-snapshot attribution coverage (M45/HAR-01, plan-critic
 * C4): the /api/v1/hook/compact-snapshot wire accepts the optional `cwd`
 * field (schema-level) without weakening existing validation.
 *
 * DB posture: persist is never requested here, so the tool never inserts;
 * when the store is unavailable the tool returns success:false INSIDE a 200 —
 * both outcomes prove the route + schema accepted `cwd`.
 */
import { describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { hookRoutes } from "../routes/hooks.js";

function app() {
  return new Elysia().use(hookRoutes);
}

describe("POST /api/v1/hook/compact-snapshot cwd wire field", () => {
  test("accepts optional cwd (no 422) and reaches the tool", async () => {
    const response = await app().handle(
      new Request("http://localhost/api/v1/hook/compact-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sessionId: "route-s", projectId: "junk", cwd: "/repo/sub" }),
      }),
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { success?: boolean; error?: string };
    expect(typeof body.success).toBe("boolean");
    if (body.success === false) {
      // Failure must come from the store/backend, never from schema validation.
      expect(body.error ?? "").not.toMatch(/cwd/i);
      expect(body.error ?? "").not.toMatch(/expected|validation|required/i);
    }
  });

  test("still rejects a missing sessionId (422) — validation not weakened", async () => {
    const response = await app().handle(
      new Request("http://localhost/api/v1/hook/compact-snapshot", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ projectId: "junk", cwd: "/repo" }),
      }),
    );
    expect(response.status).toBe(422);
  });
});
