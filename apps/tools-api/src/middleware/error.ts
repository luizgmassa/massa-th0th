/**
 * Error Handler Middleware
 *
 * Captura erros não tratados e retorna JSON padronizado.
 */

import { Elysia } from "elysia";

export const errorHandler = new Elysia({ name: "error-handler" }).onError(
  ({ error, set }) => {
    console.error("[massa-th0th-api] Error:", error);

    // Default to 500 if no status set
    if (!set.status || set.status === 200) {
      set.status = 500;
    }

    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString(),
    };
  },
);
