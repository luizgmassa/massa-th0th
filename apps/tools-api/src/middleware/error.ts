/**
 * Error Handler Middleware
 *
 * Captura erros não tratados e retorna JSON padronizado.
 */

import { Elysia } from "elysia";
import { SearchServiceError } from "@massa-th0th/core";

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  ({ error, set }) => {
    console.error("[massa-th0th-api] Request failed", {
      name: error instanceof Error ? error.name : "UnknownError",
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
