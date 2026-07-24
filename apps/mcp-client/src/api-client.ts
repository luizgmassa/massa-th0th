/**
 * API Client
 *
 * HTTP client para comunicação com a Tools API.
 * Implementa retry, timeout e error handling.
 */

import { parsePositiveIntEnv } from "@massa-ai/shared/config";

export interface ApiClientConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs?: number;
  maxRetries?: number;
}

export class ApiHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly body: Record<string, unknown>,
  ) {
    super(`Tools API request failed with status ${status}`);
    this.name = "ApiHttpError";
  }
}

export class ApiClient {
  private baseUrl: string;
  private apiKey: string;
  private timeoutMs: number;
  private maxRetries: number;

  constructor(config?: Partial<ApiClientConfig>) {
    this.baseUrl =
      config?.baseUrl || process.env.MASSA_AI_API_URL || "http://localhost:3333";
    this.apiKey = config?.apiKey || process.env.MASSA_AI_API_KEY || "";
    // Proxy timeout: an explicit `config.timeoutMs` (incl. 0 = disable) wins.
    // Otherwise parse MASSA_AI_PROXY_TIMEOUT_MS with allowZero so `=0`
    // means "no timeout" rather than silently becoming 120000ms. Unset /
    // garbage / negative fall back to 120000.
    this.timeoutMs =
      typeof config?.timeoutMs === "number"
        ? config.timeoutMs
        : parsePositiveIntEnv(
            process.env.MASSA_AI_PROXY_TIMEOUT_MS,
            120000,
            { allowZero: true },
          );
    this.maxRetries = config?.maxRetries || 2;
  }

  /** POST request to Tools API */
  async post(endpoint: string, body: unknown, timeoutMs?: number): Promise<unknown> {
    return this.request("POST", endpoint, body, timeoutMs);
  }

  /** PATCH request to Tools API */
  async patch(endpoint: string, body: unknown): Promise<unknown> {
    return this.request("PATCH", endpoint, body);
  }

  /** DELETE request to Tools API */
  async delete(endpoint: string, body?: unknown): Promise<unknown> {
    return this.request("DELETE", endpoint, body);
  }

  /** GET request to Tools API with optional query parameters */
  async get(endpoint: string, queryParams?: Record<string, unknown>): Promise<unknown> {
    let url = endpoint;
    if (queryParams && Object.keys(queryParams).length > 0) {
      const qs = new URLSearchParams(
        Object.entries(queryParams)
          .filter(([, v]) => v !== undefined && v !== null && v !== "")
          .map(([k, v]) => [k, String(v)] as [string, string])
      ).toString();
      if (qs) url = `${endpoint}?${qs}`;
    }
    return this.request("GET", url);
  }

  /** Generic HTTP request to Tools API */
  private async request(
    method: "GET" | "POST" | "PATCH" | "DELETE",
    endpoint: string,
    body?: unknown,
    timeoutMs = this.timeoutMs,
  ): Promise<unknown> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), timeoutMs);

        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        if (this.apiKey) {
          headers["X-API-Key"] = this.apiKey;
        }

        const response = await fetch(`${this.baseUrl}${endpoint}`, {
          method,
          headers,
          body: body ? JSON.stringify(body) : undefined,
          signal: controller.signal,
        });

        clearTimeout(timeout);

        if (!response.ok) {
          const errorText = await response.text();
          let errorBody: Record<string, unknown> = {
            success: false,
            error: "Upstream API request failed",
          };
          try {
            const parsedBody: unknown = JSON.parse(errorText);
            if (parsedBody !== null && typeof parsedBody === "object" && !Array.isArray(parsedBody)) {
              errorBody = parsedBody as Record<string, unknown>;
            }
          } catch {
            // Keep the generic envelope; raw non-JSON upstream bodies may contain secrets.
          }
          throw new ApiHttpError(response.status, errorBody);
        }

        return await response.json();
      } catch (error) {
        lastError = error as Error;

        // Don't retry on client errors (4xx)
        if (
          lastError instanceof ApiHttpError &&
          lastError.status >= 400 &&
          lastError.status < 500
        ) {
          throw lastError;
        }

        // Wait before retry (exponential backoff)
        if (attempt < this.maxRetries) {
          await new Promise((resolve) =>
            setTimeout(resolve, Math.pow(2, attempt) * 500),
          );
        }
      }
    }

    throw lastError || new Error("Unknown API error");
  }

  /** Upload local files and trigger indexing on the remote API */
  uploadAndIndex(params: {
    projectPath: string;
    projectId?: string;
    forceReindex?: boolean;
    warmCache?: boolean;
    warmupQueries?: string[];
    files: Array<{ relativePath: string; content: string }>;
  }): Promise<unknown> {
    return this.post("/api/v1/project/upload-and-index", params, 300_000);
  }

  /**
   * Health check da Tools API
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }
}
