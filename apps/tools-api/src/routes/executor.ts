/**
 * Executor Routes
 *
 * POST /api/v1/executor/execute       - Run code in a detected runtime
 * POST /api/v1/executor/execute_file  - Run code over a file (sandboxed var)
 * POST /api/v1/executor/batch_execute - Run N shell commands via run-pool
 *
 * These endpoints run USER-SUPPLIED code on the host. They are intended for
 * local-dev use only; do not expose the Tools API to untrusted clients.
 */

import { Elysia, t } from "elysia";
import { ExecutorController } from "@massa-ai/core";

let controller: ExecutorController | null = null;
function getController(): ExecutorController {
  if (!controller) controller = ExecutorController.getInstance();
  return controller;
}

const LANGUAGE_ENUM = t.Union(
  [
    t.Literal("javascript"),
    t.Literal("typescript"),
    t.Literal("python"),
    t.Literal("shell"),
    t.Literal("ruby"),
    t.Literal("go"),
    t.Literal("rust"),
    t.Literal("php"),
    t.Literal("perl"),
    t.Literal("r"),
  ],
  { description: "Language/runtime to execute the code in." },
);

export const executorRoutes = new Elysia({ prefix: "/api/v1/executor" })
  .post(
    "/execute",
    async ({ body }) => {
      return await getController().execute(body);
    },
    {
      body: t.Object({
        language: LANGUAGE_ENUM,
        code: t.String({ description: "Source code to execute." }),
        timeout: t.Optional(
          t.Number({
            description: "Max runtime in ms (default 30000, cap 300000).",
          }),
        ),
        background: t.Optional(
          t.Boolean({ default: false, description: "Detach on timeout." }),
        ),
        cwd: t.Optional(t.String({ description: "Working directory." })),
        intent: t.Optional(
          t.String({
            description: "Trim large outputs to matching sections.",
          }),
        ),
      }),
      detail: {
        summary: "Run code in a polyglot sandbox runtime",
        description:
          "Runs user-supplied code in a detected runtime (js/ts/python/...). " +
          "Local-dev trust model: code runs on the host as the current user. " +
          "Timeout default 30s, cap 300s.",
        tags: ["executor"],
      },
    },
  )
  .post(
    "/execute_file",
    async ({ body }) => {
      return await getController().executeFile(body);
    },
    {
      body: t.Object({
        path: t.String({ description: "Project-relative file path." }),
        language: LANGUAGE_ENUM,
        code: t.String({ description: "Code to run over FILE_CONTENT." }),
        timeout: t.Optional(t.Number()),
        intent: t.Optional(t.String()),
      }),
      detail: {
        summary: "Run code over a file (sandboxed FILE_CONTENT var)",
        description:
          "Reads a file into a sandboxed variable and runs code over it. " +
          "Enforces project-root containment + a secrets deny-glob.",
        tags: ["executor"],
      },
    },
  )
  .post(
    "/batch_execute",
    async ({ body }) => {
      return await getController().batchExecute(body);
    },
    {
      body: t.Object({
        commands: t.Array(t.String(), {
          description: "Shell commands to run (order preserved in results).",
        }),
        queries: t.Optional(t.Array(t.String())),
        timeout: t.Optional(t.Number()),
        concurrency: t.Optional(t.Number()),
        cwd: t.Optional(t.String()),
        query_scope: t.Optional(t.String()),
      }),
      detail: {
        summary: "Run N shell commands in parallel (run-pool)",
        description:
          "Order-preserving, concurrency-capped parallel shell execution. " +
          "A failing command never aborts its siblings.",
        tags: ["executor"],
      },
    },
  );
