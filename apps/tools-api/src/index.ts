#!/usr/bin/env bun
/**
 * massa-th0th Tools API
 *
 * API REST com ElysiaJS que expõe todas as ferramentas do massa-th0th.
 * Separada do protocolo MCP para permitir múltiplos clientes.
 *
 * Local-First: Funciona 100% offline com Ollama + SQLite.
 */

import "@massa-th0th/shared/config";
import { assertDedicatedDbAllowed, parsePositiveIntEnv } from "@massa-th0th/shared/config";

// Fail fast if a DEDICATE-flagged process would bind the shared production DB.
// Must run AFTER env loading and BEFORE any DB/client initialization. No-op
// unless MASSA_TH0TH_DEDICATED=1, so the normal :3333 shared stack is unaffected.
assertDedicatedDbAllowed();

import { Elysia } from "elysia";
import { node } from "@elysiajs/node";
import { swagger } from "@elysiajs/swagger";
import { cors } from "@elysiajs/cors";
import { searchRoutes } from "./routes/search.js";
import { memoryRoutes } from "./routes/memory.js";
import { checkpointRoutes } from "./routes/checkpoints.js";
import { projectRoutes } from "./routes/project.js";
import { contextRoutes } from "./routes/context.js";
import { analyticsRoutes } from "./routes/analytics.js";
import { systemRoutes } from "./routes/system.js";
import { eventsRoutes } from "./routes/events.js";
import { workspaceRoutes } from "./routes/workspace.js";
import { fileRoutes } from "./routes/file.js";
import { synapseRoutes } from "./routes/synapse.js";
import { hookRoutes } from "./routes/hooks.js";
import { bootstrapRoutes } from "./routes/bootstrap.js";
import { handoffRoutes } from "./routes/handoff.js";
import { proposalRoutes } from "./routes/proposals.js";
import { webUiRoutes } from "./routes/web-ui.js";
import { authMiddleware } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { getHealthChecker, searchSessionHook, coRetrievalHook } from "@massa-th0th/core";
import { indexJobTracker } from "@massa-th0th/core/services";

const PORT = process.env.MASSA_TH0TH_API_PORT || 3333;

// Stale-job reaper config. A job whose heartbeat hasn't been refreshed within
// this window is flipped to `failed` by the in-process reaper interval below.
// Generous default (5 min): healthy indexes emit progress far more often than
// that, and a real index finishes well within the window. `0`/negative/garbage
// are floored to the default (a 0ms stale-window would flip everything to
// failed instantly; a 0ms interval would be a tight loop).
const JOB_STALE_MS = parsePositiveIntEnv(process.env.MASSA_TH0TH_JOB_STALE_MS, 300_000);
const JOB_REAPER_INTERVAL_MS = parsePositiveIntEnv(
  process.env.MASSA_TH0TH_JOB_REAPER_INTERVAL_MS,
  60_000,
);

const app = new Elysia({ adapter: node() })
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "massa-th0th Tools API",
          version: "1.0.0",
          description:
            "Semantic context, memory, and code search tooling API. Consumed by the MCP Client and other clients.",
        },
        tags: [
          { name: "search", description: "Semantic and keyword search" },
          { name: "memory", description: "Memory storage and retrieval" },
          { name: "checkpoint", description: "Task checkpoint save and restore" },
          { name: "project", description: "Project indexing" },
          {
            name: "context",
            description: "Context compression and optimization",
          },
          { name: "analytics", description: "Metrics and analytics" },
          { name: "system", description: "System health checks and metrics" },
          { name: "workspace", description: "Workspace management and Symbol Graph" },
          { name: "symbol", description: "Code navigation: definitions and references" },
          { name: "events", description: "SSE for real-time indexing progress" },
          { name: "file", description: "Optimized file reading with automatic compression" },
          { name: "synapse", description: "Cognitive modulation layer: session, buffer, priming" },
          { name: "hooks", description: "Passive lifecycle capture (observation ingestion)" },
          { name: "handoffs", description: "Cross-session handoff begin/accept/cancel" },
          { name: "proposals", description: "Auto-improvement proposal list/approve/reject" },
          { name: "webUi", description: "Read-only memory/search web browser (Phase 8)" },
        ],
        components: {
          securitySchemes: {
            ApiKeyAuth: {
              type: "apiKey",
              in: "header",
              name: "x-api-key",
              description: "API key — set MASSA_TH0TH_API_KEY on the server. Omit when running locally without a key configured.",
            },
          },
        },
        security: [{ ApiKeyAuth: [] }],
      },
    }),
  )
  .use(errorHandler)
  .use(authMiddleware)
  .use(searchRoutes)
  .use(memoryRoutes)
  .use(checkpointRoutes)
  .use(projectRoutes)
  .use(contextRoutes)
  .use(analyticsRoutes)
  .use(systemRoutes)
  .use(eventsRoutes)
  .use(workspaceRoutes)
  .use(fileRoutes)
  .use(synapseRoutes)
  .use(hookRoutes)
  .use(bootstrapRoutes)
  .use(handoffRoutes)
  .use(proposalRoutes)
  .use(webUiRoutes)
  .get("/health", () => ({
    status: "ok",
    service: "massa-th0th-tools-api",
    version: "1.0.0",
    timestamp: new Date().toISOString(),
  }))
  .listen(PORT);

searchSessionHook.register();
coRetrievalHook.register(); // active only when MASSA_TH0TH_CO_RETRIEVAL_HOOK=true

console.log(`massa-th0th Tools API running at http://localhost:${PORT}`);
console.log(`Swagger docs at http://localhost:${PORT}/swagger`);

// Stale-job reaper: periodically flip any `running` job whose heartbeat is
// older than JOB_STALE_MS to `failed`. This covers the case where an indexing
// job hangs (e.g. an Ollama stall) or crashes mid-flight while the server keeps
// running — without it, the job row would stay pinned at `running` for the
// lifetime of this process (the existing restart-time recovery only fires on
// the NEXT process start). Healthy jobs keep heartbeating via progress emits,
// so they are never reaped.
const jobReaperTimer = setInterval(() => {
  try {
    const reaped = indexJobTracker.reapStaleJobs(JOB_STALE_MS);
    if (reaped > 0) {
      console.log(`[job-reaper] reaped ${reaped} stale running job(s) (staleMs=${JOB_STALE_MS})`);
    }
  } catch (err) {
    console.error(`[job-reaper] error:`, err instanceof Error ? err.message : err);
  }
}, JOB_REAPER_INTERVAL_MS);
jobReaperTimer.unref?.(); // never keep the event loop alive solely for the reaper

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down gracefully...`);
    clearInterval(jobReaperTimer);
    try {
      const { disconnectPrisma } = await import('@massa-th0th/core/services');
      await disconnectPrisma();
    } catch {}
    process.exit(0);
  });
}

// Run local health check on startup (non-blocking)
(async () => {
  try {
    const checker = getHealthChecker();
    const report = await checker.checkAll();

    if (report.status === "healthy") {
      console.log(`Local-first health: ALL SERVICES HEALTHY`);
    } else {
      console.log(`Local-first health: ${report.status.toUpperCase()}`);
      for (const rec of report.recommendations) {
        console.log(`  -> ${rec}`);
      }
    }
  } catch (error) {
    console.error(
      "Health check failed:",
      error instanceof Error ? error.message : error,
    );
  }
})();

export type App = typeof app;
