import { describe, expect, test } from "bun:test";
import { SearchServiceError } from "@massa-th0th/core";
import { Elysia } from "elysia";
import { errorHandler } from "../middleware/error.js";

function testApp() {
  return new Elysia()
    .use(errorHandler)
    .get("/typed", () => {
      throw new SearchServiceError("SEARCH_BACKEND_UNAVAILABLE", "keyword_search", {
        cause: new Error("postgres://user:secret@example.invalid/search"),
      });
    })
    .get("/generic", () => {
      throw new Error("internal password=secret");
    });
}

describe("search failure HTTP envelope", () => {
  test("returns a sanitized typed 5xx envelope", async () => {
    const response = await testApp().handle(new Request("http://localhost/typed"));
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body).toEqual({
      success: false,
      error: {
        code: "SEARCH_BACKEND_UNAVAILABLE",
        message: "A required search backend is unavailable",
        component: "keyword_search",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });

  test("does not leak untyped error details", async () => {
    const response = await testApp().handle(new Request("http://localhost/generic"));
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: { code: "INTERNAL_ERROR", message: "Internal server error" },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
