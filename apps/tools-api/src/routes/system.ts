/**
 * System Routes
 *
 * GET /api/v1/system/info         - System information
 * GET /api/v1/system/status       - Required service status
 * GET /api/v1/system/metrics      - Aggregate metrics
 * GET /api/v1/system/health/local - PostgreSQL/pgvector and local-service health
 * GET /api/v1/system/ollama       - Ollama status and available models
 */

import { Elysia } from "elysia";
import { config } from "@massa-ai/shared";
import { getHealthChecker } from "@massa-ai/core";
import path from "path";
import fs from "fs";
import os from "os";

interface DatabaseInfo {
  backend: "postgres";
  database: string;
  host: string;
  port: number;
  sizeBytes: number | null;
}

function databaseUrlParts(): Omit<DatabaseInfo, "backend" | "sizeBytes"> {
  const url = new URL(process.env.DATABASE_URL!);
  return {
    database: decodeURIComponent(url.pathname.slice(1)),
    host: url.hostname,
    port: url.port ? Number(url.port) : 5432,
  };
}

/**
 * Return safe database metadata only. Credentials and query parameters never
 * leave the process, even when the size query cannot be completed.
 */
async function getDatabaseInfo(): Promise<DatabaseInfo> {
  const parts = databaseUrlParts();
  const status = await getHealthChecker().checkPostgres();
  const details = status.details as { sizeBytes?: unknown } | undefined;
  const size = Number(details?.sizeBytes);
  const sizeBytes = Number.isFinite(size) ? size : null;

  return { backend: "postgres", ...parts, sizeBytes };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + " " + sizes[i];
}

export const systemRoutes = new Elysia({ prefix: "/api/v1/system" })
  .get(
    "/info",
    async () => {
      const database = await getDatabaseInfo();

      return {
        version: "1.0.0",
        service: "massa-ai-tools-api",
        node: process.version,
        platform: os.platform(),
        arch: os.arch(),
        uptime: process.uptime(),
        memory: {
          total: os.totalmem(),
          free: os.freemem(),
          used: os.totalmem() - os.freemem(),
          process: process.memoryUsage(),
        },
        dataDir: config.get("dataDir"),
        databases: database,
        timestamp: new Date().toISOString(),
      };
    },
    {
      detail: {
        tags: ["system"],
        summary: "Get system information",
        description: "Get system details and redacted PostgreSQL metadata",
      },
    },
  )
  .get(
    "/status",
    async () => {
      const report = await getHealthChecker().checkAll();
      const services = report.services as Record<string, { available: boolean }>;
      const databaseDetails = report.services.vectorStore.details as
        | { pgvector?: unknown }
        | undefined;
      const requiredServices = {
        postgresql: services.vectorStore?.available ?? false,
        pgvector:
          services.vectorStore?.available === true &&
          databaseDetails?.pgvector === true,
        ollama: services.ollama?.available ?? false,
        dataDirectory: services.dataDirectory?.available ?? false,
      };
      const allHealthy = Object.values(requiredServices).every(Boolean);

      return {
        status: allHealthy ? "healthy" : "degraded",
        services: requiredServices,
        timestamp: new Date().toISOString(),
      };
    },
    {
      detail: {
        tags: ["system"],
        summary: "Get system status",
        description: "Check PostgreSQL, pgvector, Ollama, and local artifact directory health",
      },
    },
  )
  .get(
    "/metrics",
    async () => {
      const metricsPath = path.join(process.cwd(), "data", "metrics.json");

      let metrics = {};
      if (fs.existsSync(metricsPath)) {
        try {
          metrics = JSON.parse(fs.readFileSync(metricsPath, "utf-8"));
        } catch {
          // Metrics file might be empty or corrupted.
        }
      }

      const database = await getDatabaseInfo();

      return {
        ...metrics,
        system: {
          databaseSize: database.sizeBytes === null ? null : formatBytes(database.sizeBytes),
          databaseSizeBytes: database.sizeBytes,
          uptime: process.uptime(),
          memory: {
            heapUsed: formatBytes(process.memoryUsage().heapUsed),
            heapTotal: formatBytes(process.memoryUsage().heapTotal),
            rss: formatBytes(process.memoryUsage().rss),
          },
        },
        timestamp: new Date().toISOString(),
      };
    },
    {
      detail: {
        tags: ["system"],
        summary: "Get system metrics",
        description: "Get aggregate metrics including PostgreSQL database size",
      },
    },
  )
  .get(
    "/health/local",
    async () => getHealthChecker().checkAll(),
    {
      detail: {
        tags: ["system"],
        summary: "Local service health check",
        description:
          "Comprehensive PostgreSQL/pgvector, Ollama, and local artifact-directory health check.",
      },
    },
  )
  .get(
    "/ollama",
    async () => {
      const checker = getHealthChecker();
      const ollamaStatus = await checker.checkOllama();
      const models = await checker.getOllamaModels();

      return {
        ...ollamaStatus,
        models,
        configuredModel:
          process.env.OLLAMA_EMBEDDING_MODEL || "qwen3-embedding:8b",
        baseUrl: process.env.OLLAMA_BASE_URL || "http://localhost:11434",
      };
    },
    {
      detail: {
        tags: ["system"],
        summary: "Ollama status",
        description:
          "Check Ollama availability, list installed models, and verify embedding model configuration.",
      },
    },
  );
