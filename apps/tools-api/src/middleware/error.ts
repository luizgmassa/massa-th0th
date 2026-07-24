/**
 * Error Handler Middleware
 *
 * Captura erros não tratados e retorna JSON padronizado.
 */

import { Elysia } from "elysia";
import { SearchServiceError } from "@massa-ai/core";

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  ({ code, error, set }) => {
    console.error("[massa-ai-api] Request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
      code,
    });

    if (error instanceof SearchServiceError) {
      set.status = error.statusCode;
      return {
        success: false,
        error: {
          code: error.code,
          message: error.message,
          component: error.component,
        },
      };
    }

    // Elysia body/query/param validation + parse failures (framework code,
    // 422-ish). Return a typed, sanitized envelope — never INTERNAL_ERROR for
    // a client mistake, never TypeBox internals (spec req 9 pattern).
    if (code === "VALIDATION" || code === "PARSE") {
      set.status = 400;
      return {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "The request failed validation",
        },
      };
    }

    // Default to 500 if no status set
    if (!set.status || set.status === 200) {
      set.status = 500;
    }

    return {
      success: false,
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    };
  },
).as("global");
