/**
 * Executor Controller — orchestration for execute / execute_file / batch_execute.
 *
 * Owns a single PolyglotExecutor instance and applies the intent progressive-
 * disclosure pass (B3) on large outputs. The tool handlers are thin shims that
 * delegate here; this layer composes the executor service + intent search.
 *
 * Trust model (re-stated because it is load-bearing): the executor runs
 * USER-SUPPLIED code on the HOST as the current user. There is no OS-level
 * sandbox. Timeouts, the env denylist, and execute_file's boundary/deny-glob
 * guard are best-effort containment, NOT isolation.
 */

import type { ToolResponse } from "@massa-th0th/shared";
import { logger } from "@massa-th0th/shared";
import { cpus } from "node:os";
import {
  PolyglotExecutor,
  intentSearch,
  renderIntentResult,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
  runPool,
  type Language,
  type ExecResult,
} from "../services/executor/index.js";
import type { ExecuteParams } from "../tools/execute.js";
import type { ExecuteFileParams } from "../tools/execute_file.js";
import type { BatchExecuteParams } from "../tools/batch_execute.js";

/**
 * Hard cap on the number of commands a single batch_execute call may run.
 * Without it, a 100k-command payload would spin up 100k temp dirs upfront
 * (each shell command gets its own sandbox tmp dir) and exhaust /tmp / fds.
 * 256 is generous for real gather passes (typically <50) while bounding abuse.
 */
const MAX_BATCH_COMMANDS = 256;

/**
 * Apply intent progressive disclosure to an ExecResult's stdout. When `intent`
 * is set AND stdout exceeds the threshold, replace stdout with the trimmed
 * intent summary + keep the raw output under a `truncated` field for audit.
 * Otherwise return the result untouched.
 */
function applyIntent(result: ExecResult, intent?: string): ExecResult {
  if (!intent || !result.stdout) return result;
  const ir = intentSearch(result.stdout, intent);
  if (!ir.searched) return result;
  const rendered = renderIntentResult(ir, intent);
  return {
    ...result,
    // Keep a bounded tail of the raw output so the agent isn't fully blind to
    // the end of the run, but lead with the intent summary.
    stdout: `${rendered}\n\n--- tail (last 512 chars) ---\n${result.stdout.slice(-512)}`,
  };
}

export class ExecutorController {
  private static instance: ExecutorController | null = null;
  private readonly executor: PolyglotExecutor;

  constructor(executor?: PolyglotExecutor) {
    this.executor = executor ?? new PolyglotExecutor();
  }

  static getInstance(): ExecutorController {
    if (!ExecutorController.instance) {
      ExecutorController.instance = new ExecutorController();
    }
    return ExecutorController.instance;
  }

  /** For tests: reset the singleton (cleans up backgrounded processes). */
  static resetInstance(): void {
    ExecutorController.instance?.executor.cleanupBackgrounded();
    ExecutorController.instance = null;
  }

  get runtimes() {
    return this.executor.runtimes;
  }

  /** execute (ctx_execute). */
  async execute(params: ExecuteParams): Promise<ToolResponse> {
    try {
      const result = await this.executor.execute({
        language: params.language as Language,
        code: params.code,
        timeout: params.timeout,
        background: params.background,
        cwd: params.cwd,
      });
      const finalResult = applyIntent(result, params.intent);
      const ok = !finalResult.timedOut && finalResult.exitCode === 0;
      return {
        success: ok,
        data: {
          stdout: finalResult.stdout,
          stderr: finalResult.stderr,
          exitCode: finalResult.exitCode,
          timedOut: finalResult.timedOut,
          backgrounded: finalResult.backgrounded ?? false,
          command: finalResult.command,
          cwd: finalResult.cwd,
        },
      };
    } catch (error) {
      logger.error("execute failed", error as Error, {
        language: params.language,
      });
      return {
        success: false,
        error: `execute failed: ${(error as Error).message}`,
      };
    }
  }

  /** execute_file (ctx_execute_file). */
  async executeFile(params: ExecuteFileParams): Promise<ToolResponse> {
    try {
      const result = await this.executor.executeFile({
        path: params.path,
        language: params.language as Language,
        code: params.code,
        timeout: params.timeout,
      });
      // Boundary/deny-glob blocks come back as a result (not a throw) so the
      // tool response stays success:false with a clear stderr.
      const blocked = result.stderr?.startsWith("Blocked:");
      if (blocked) {
        return { success: false, error: result.stderr };
      }
      const finalResult = applyIntent(result, params.intent);
      const ok = !finalResult.timedOut && finalResult.exitCode === 0;
      return {
        success: ok,
        data: {
          stdout: finalResult.stdout,
          stderr: finalResult.stderr,
          exitCode: finalResult.exitCode,
          timedOut: finalResult.timedOut,
          command: finalResult.command,
          cwd: finalResult.cwd,
        },
      };
    } catch (error) {
      logger.error("execute_file failed", error as Error, {
        path: params.path,
        language: params.language,
      });
      return {
        success: false,
        error: `execute_file failed: ${(error as Error).message}`,
      };
    }
  }

  /**
   * batch_execute (ctx_batch_execute) — run N shell commands via run-pool.
   * Order is preserved (results[i] ↔ commands[i]); a failing command becomes a
   * `rejected` entry, never aborting its siblings.
   *
   * Each command is itself run through the executor's `shell` language so it
   * inherits the same timeout/env-denylist/byte-cap containment as `execute`.
   */
  async batchExecute(params: BatchExecuteParams): Promise<ToolResponse> {
    const { commands, concurrency, cwd, timeout } = params;
    if (!Array.isArray(commands) || commands.length === 0) {
      return { success: false, error: "commands must be a non-empty array." };
    }
    if (commands.length > MAX_BATCH_COMMANDS) {
      return {
        success: false,
        error: `batch_execute accepts at most ${MAX_BATCH_COMMANDS} commands; received ${commands.length}. Split the batch or reduce the payload.`,
      };
    }

    const effectiveConcurrency =
      concurrency && concurrency > 0 ? concurrency : Math.max(1, cpus().length);
    const perTimeout = timeout ?? DEFAULT_TIMEOUT_MS;

    try {
      const poolResult = await runPool(
        commands.map((cmd) => ({
          run: () =>
            this.executor.execute({
              language: "shell",
              code: cmd,
              timeout: perTimeout,
              cwd,
            }),
        })),
        { concurrency: effectiveConcurrency },
      );

      const results = poolResult.settled.map((s, i) => {
        if (s.status === "fulfilled") {
          const r = s.value as ExecResult;
          return {
            command: commands[i],
            stdout: r.stdout,
            stderr: r.stderr,
            exitCode: r.exitCode,
            timedOut: r.timedOut,
          };
        }
        return {
          command: commands[i],
          stdout: "",
          stderr: String(s.reason ?? "unknown error"),
          exitCode: null,
          timedOut: false,
        };
      });

      const anyFailed = results.some(
        (r) => r.exitCode !== 0 || r.timedOut,
      );
      // Auto-indexing of outputs (queries/query_scope) is a stub: the core
      // value of this tool is parallel gather. A later task can index the
      // combined stdout into the keyword/vector store if desired.
      return {
        success: !anyFailed,
        data: {
          results,
          concurrency: poolResult.effectiveConcurrency,
          capped: poolResult.capped,
        },
      };
    } catch (error) {
      logger.error("batch_execute failed", error as Error);
      return {
        success: false,
        error: `batch_execute failed: ${(error as Error).message}`,
      };
    }
  }

  /** Bound export for the controller layer. */
  static get MAX_TIMEOUT_MS(): number {
    return MAX_TIMEOUT_MS;
  }
}
