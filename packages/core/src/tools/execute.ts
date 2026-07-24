/**
 * execute tool (ctx_execute) — run code in a detected runtime.
 *
 * Thin MCP handler: schema + delegation to the ExecutorController. The
 * controller owns the PolyglotExecutor instance and applies the intent
 * progressive-disclosure pass on large outputs.
 */

import type { ToolResponse, IToolHandler } from "@massa-ai/shared";
import type { Language } from "../services/executor/runtime.js";

export interface ExecuteParams {
  language: Language;
  code: string;
  timeout?: number;
  background?: boolean;
  cwd?: string;
  intent?: string;
}

export class ExecuteTool implements IToolHandler {
  name = "execute";
  description =
    "Run code in a detected polyglot sandbox runtime (js/ts/python/shell/" +
    "ruby/go/rust/php/perl/r). Returns stdout/stderr. Local-dev trust model: " +
    "code runs on the host as the current user — no OS-level isolation. " +
    "Timeout default 30s, cap 300s. Pass `intent` to trim large outputs to " +
    "only the sections matching your query.";

  inputSchema = {
    type: "object",
    properties: {
      language: {
        type: "string",
        enum: [
          "javascript",
          "typescript",
          "python",
          "shell",
          "ruby",
          "go",
          "rust",
          "php",
          "perl",
          "r",
        ],
        description: "Language/runtime to execute the code in.",
      },
      code: { type: "string", description: "Source code to execute." },
      timeout: {
        type: "number",
        description: "Max runtime in ms (default 30000, hard cap 300000).",
      },
      background: {
        type: "boolean",
        description: "Detach instead of killing on timeout (default false).",
        default: false,
      },
      cwd: {
        type: "string",
        description: "Working directory (defaults to project root).",
      },
      intent: {
        type: "string",
        description:
          "Optional query. When output > ~5KB, only sections matching this " +
          "intent are returned (plus vocabulary hints). Absent = verbatim output.",
      },
    },
    required: ["language", "code"],
  };

  private run: (params: ExecuteParams) => Promise<ToolResponse>;

  constructor(run: (params: ExecuteParams) => Promise<ToolResponse>) {
    this.run = run;
  }

  async handle(params: unknown): Promise<ToolResponse> {
    return this.run(params as ExecuteParams);
  }
}
