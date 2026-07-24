#!/usr/bin/env bun
/**
 * massa-ai Tools API
 *
 * API REST com ElysiaJS que expõe todas as ferramentas do massa-ai.
 * Separada do protocolo MCP para permitir múltiplos clientes.
 *
 * Local-first: PostgreSQL/pgvector persistence with local Ollama embeddings.
 */

import "@massa-ai/shared/config";
import { parsePositiveIntEnv } from "@massa-ai/shared/config";
import { validateApiStartup } from "./startup-config.js";

// Fail fast if a DEDICATE-flagged process would bind the shared production DB.
// Must run AFTER env loading and BEFORE any DB/client initialization. No-op
// unless MASSA_AI_DEDICATED=1, so the normal :3333 shared stack is unaffected.
validateApiStartup();

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
import { executorRoutes } from "./routes/executor.js";
import { webRoutes } from "./routes/web.js";
import { webUiRoutes } from "./routes/web-ui.js";
import { architectureRoutes } from "./routes/architecture.js";
import { dashboardRoutes } from "./routes/dashboard.js";
import { authMiddleware } from "./middleware/auth.js";
import { adminPreservationMiddleware } from "./middleware/admin-preservation.js";
import { errorHandler } from "./middleware/error.js";
import { getHealthChecker, searchSessionHook, coRetrievalHook } from "@massa-ai/core";
import { installProjectIdentityGuardsFromPool } from "@massa-ai/core";
import {
  getParserReadiness,
  indexJobTracker,
  getScheduler,
  registerDefaultJobs,
  validateAllGrammars,
} from "@massa-ai/core/services";
import { buildHealthResponse, listenAfterParserValidation } from "./health.js";

const PORT = process.env.MASSA_AI_API_PORT || 3333;

// Stale-job reaper config. A job whose heartbeat hasn't been refreshed within
// this window is flipped to `failed` by the in-process reaper interval below.
// Generous default (5 min): healthy indexes emit progress far more often than
// that, and a real index finishes well within the window. `0`/negative/garbage
// are floored to the default (a 0ms stale-window would flip everything to
// failed instantly; a 0ms interval would be a tight loop).
const JOB_STALE_MS = parsePositiveIntEnv(process.env.MASSA_AI_JOB_STALE_MS, 300_000);
const JOB_REAPER_INTERVAL_MS = parsePositiveIntEnv(
  process.env.MASSA_AI_JOB_REAPER_INTERVAL_MS,
  60_000,
);

const app = new Elysia({ adapter: node() })
  .use(cors())
  .use(
    swagger({
      documentation: {
        info: {
          title: "massa-ai Tools API",
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
          { name: "executor", description: "Polyglot sandbox: execute code, run code over files, batch shell commands" },
          { name: "web", description: "SSRF-guarded web fetch + HTML→md + index (fetch_and_index)" },
          { name: "webUi", description: "Read-only memory/search web browser (Phase 8)" },
        ],
        components: {
          securitySchemes: {
            ApiKeyAuth: {
              type: "apiKey",
              in: "header",
              name: "x-api-key",
              description: "API key — set MASSA_AI_API_KEY on the server. Omit when running locally without a key configured.",
            },
          },
        },
        security: [{ ApiKeyAuth: [] }],
      },
    }),
  )
  .use(errorHandler)
  .use(authMiddleware)
  .use(adminPreservationMiddleware)
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
  .use(executorRoutes)
  .use(webRoutes)
  .use(webUiRoutes)
  .use(architectureRoutes)
  .use(dashboardRoutes)
  .get("/health", () => buildHealthResponse(getParserReadiness()));

await listenAfterParserValidation({
  validate: validateAllGrammars,
  listen: () => {
    app.listen(PORT);
  },
  onValidationFailure: (error) => {
    console.error(
      "Structural parser readiness failed; indexing is unavailable:",
      error instanceof Error ? error.message : error,
    );
  },
});

// Install project-identity guard triggers on every mutable direct store +
// existing runtime vector_documents* table. Bounded one-time pass before hook
// registration; per-table failures are warn-logged with sanitized codes and
// never abort startup (spec req 8). Tables created LATER at runtime
// (keyword_documents, search_cache, search_analytics, search_events, new
// vector_documents_<dim>d) install their own guard at their create sites.
await installProjectIdentityGuardsFromPool()
  .then((report) => {
    if (report.failures.length > 0) {
      console.warn("[project-identity] guard install finished with sanitized per-table failures", {
        failures: report.failures,
      });
    }
  })
  .catch((error) => {
    console.warn(
      "[project-identity] guard install failed at startup; continuing (sanitized).",
      error instanceof Error ? { name: error.name } : error,
    );
  });

searchSessionHook.register();
coRetrievalHook.register(); // active only when MASSA_AI_CO_RETRIEVAL_HOOK=true

console.log(`massa-ai Tools API running at http://localhost:${PORT}`);
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

// In-process scheduler (Phase 3, C2): runs periodic jobs on a clock alongside
// the existing event-debounce triggers. Default OFF — a deployment opts in via
// MASSA_AI_SCHEDULER_ENABLED=true + per-kind enable env vars. The scheduler
// only fires memory/decay/consolidation/auto-improve/observation jobs (NEVER
// indexing jobs — OOM risk). registerDefaultJobs is idempotent and preserves
// nextRunAt/lastRunAt across restarts so the schedule resumes on boot.
const scheduler = getScheduler();
try {
  registerDefaultJobs(scheduler);
  // Wave 5 FR-13: catch-up missed jobs at boot. Fires ONE tick per missed job
  // (next_run_at < now() AND enabled=true), non-overlapping per kind. Not a
  // full backfill. Called after registerDefaultJobs (jobs are persisted) and
  // before start() (the tick loop takes over from here).
  const catchUp = scheduler.catchUpMissedJobs();
  if (catchUp.caughtUp > 0) {
    console.log(`[scheduler] catch-up: ${catchUp.caughtUp} missed job(s) fired`);
  }
  scheduler.start();
} catch (err) {
  console.error(`[scheduler] init error:`, err instanceof Error ? err.message : err);
}

// Graceful shutdown
for (const signal of ['SIGTERM', 'SIGINT'] as const) {
  process.on(signal, async () => {
    console.log(`${signal} received, shutting down gracefully...`);
    clearInterval(jobReaperTimer);
    try { scheduler.stop(); } catch {}
    try {
      const { disconnectPrisma } = await import('@massa-ai/core/services');
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
