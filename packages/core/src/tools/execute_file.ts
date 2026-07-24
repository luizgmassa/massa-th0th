/**
 * execute_file tool (ctx_execute_file) — read a file into a sandboxed var and
 * run code over it.
 *
 * Enforces project-boundary containment + a deny-glob guard (the controller
 * performs these checks before delegating to the executor). Only what the code
 * prints enters the conversation; the file bytes stay in the sandbox process.
 */

import type { ToolResponse, IToolHandler } from "@massa-ai/shared";
import type { Language } from "../services/executor/runtime.js";

export interface ExecuteFileParams {
  path: string;
  language: Language;
  code: string;
  timeout?: number;
  intent?: string;
}

export class ExecuteFileTool implements IToolHandler {
  name = "execute_file";
  description =
    "Read a file into a sandboxed FILE_CONTENT variable and run code over it. " +
    "Only what your code prints enters the conversation. Enforces project-root " +
    "containment + a secrets deny-glob by default.";

  inputSchema = {
    type: "object",
    properties: {
      path: {
        type: "string",
        description: "Project-relative (or absolute, under root) file path.",
      },
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
      code: {
        type: "string",
        description:
          "Code to run over the file. FILE_CONTENT (text) and file_path " +
          "(absolute path) are in scope.",
      },
      timeout: {
        type: "number",
        description: "Max runtime in ms (default 30000, hard cap 300000).",
      },
      intent: {
        type: "string",
        description: "Optional intent query to trim large outputs.",
      },
    },
    required: ["path", "language", "code"],
  };

  private run: (params: ExecuteFileParams) => Promise<ToolResponse>;

  constructor(run: (params: ExecuteFileParams) => Promise<ToolResponse>) {
    this.run = run;
  }

  async handle(params: unknown): Promise<ToolResponse> {
    return this.run(params as ExecuteFileParams);
  }
}
