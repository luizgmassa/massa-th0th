import { describe, expect, test } from "bun:test";
import { SearchServiceError } from "@massa-ai/core";
import { Elysia } from "elysia";
import { errorHandler } from "../middleware/error.js";
import { rethrowCanonicalHandoffError } from "../routes/handoff.js";

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
    })
    .get("/handoff-corruption", () => {
      rethrowCanonicalHandoffError(
        new SearchServiceError("STORE_CORRUPTION", "handoff.open_questions_json", {
          cause: new Error("corrupt payload secret"),
          statusCode: 500,
        }),
      );
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

  test("handoff corruption retains the canonical typed envelope", async () => {
    const response = await testApp().handle(
      new Request("http://localhost/handoff-corruption"),
    );
    const body = await response.json();

    expect(response.status).toBe(500);
    expect(body).toEqual({
      success: false,
      error: {
        code: "STORE_CORRUPTION",
        message: "Stored data is invalid",
        component: "handoff.open_questions_json",
      },
    });
    expect(JSON.stringify(body)).not.toContain("secret");
  });
});
