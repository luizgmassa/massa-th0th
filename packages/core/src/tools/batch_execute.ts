/**
 * batch_execute tool (ctx_batch_execute) — run N shell commands via run-pool.
 *
 * Order-preserving (results[i] ↔ commands[i]) and concurrency-capped. The
 * controller delegates to runPool with the requested concurrency (default
 * clamped by cpu count). Auto-indexing of outputs is optional and currently
 * a no-op stub — the core value is parallel gather.
 */

import type { ToolResponse, IToolHandler } from "@massa-ai/shared";

export interface BatchCommand {
  command: string;
}

export interface BatchExecuteParams {
  commands: string[];
  queries?: string[];
  timeout?: number;
  concurrency?: number;
  cwd?: string;
  query_scope?: string;
}

export class BatchExecuteTool implements IToolHandler {
  name = "batch_execute";
  description =
    "Run N shell commands in parallel via run-pool (order-preserving, " +
    "concurrency-capped). Returns per-command stdout/stderr/exitCode in input " +
    "order. Default concurrency = cpu count; failures do not abort siblings.";

  inputSchema = {
    type: "object",
    properties: {
      commands: {
        type: "array",
        items: { type: "string" },
        description: "Shell commands to run (order is preserved in results).",
      },
      queries: {
        type: "array",
        items: { type: "string" },
        description:
          "Optional queries to scope auto-indexing of outputs (reserved; " +
          "currently a no-op stub).",
      },
      timeout: {
        type: "number",
        description: "Per-command timeout in ms (default 30000).",
      },
      concurrency: {
        type: "number",
        description: "Max in-flight commands (default = host cpu count).",
      },
      cwd: {
        type: "string",
        description: "Working directory (defaults to project root).",
      },
      query_scope: {
        type: "string",
        description: "Optional scope label for the batch (diagnostics only).",
      },
    },
    required: ["commands"],
  };

  private run: (params: BatchExecuteParams) => Promise<ToolResponse>;

  constructor(run: (params: BatchExecuteParams) => Promise<ToolResponse>) {
    this.run = run;
  }

  async handle(params: unknown): Promise<ToolResponse> {
    return this.run(params as BatchExecuteParams);
  }
}
