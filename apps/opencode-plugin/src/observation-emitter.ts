/**
 * ObservationEmitter — batches lifecycle observations and POSTs them to the
 * massa-ai hook ingest endpoint (`POST /api/v1/hook/batch`).
 *
 * This mirrors the claude-plugin hook scripts (see apps/claude-plugin/hooks/):
 * the plugin emits raw host events with a `event` kind + a verbatim `payload`,
 * and the server-side `ObservationExtractor` (packages/core) classifies them
 * into the 33-category taxonomy by inspecting `payload.tool_name` / field
 * shapes. The plugin does NOT classify.
 *
 * Contract (from apps/tools-api/src/routes/hooks.ts + hook-service.ts):
 *   POST /api/v1/hook/batch
 *   { events: [ { event, projectId, sessionId?, payload, importance?, agentId?, ts? } ] }
 *
 * Requirements honored:
 *  - Non-blocking: every public method is fire-and-forget; network failures are
 *    swallowed + logged and never reject. The plugin's primary function (memory
 *    store / compaction / tools) is never affected.
 *  - Batched + debounced: events accumulate up to `maxBatch` or `flushMs`,
 *    whichever comes first, to avoid flooding the endpoint.
 *  - Gated: no-op when `enabled()` returns false (e.g. API unavailable).
 *
 * The mapping from OpenCode host events → the 6 lifecycle kinds is in
 * `mapOpenCodeEvent`. OpenCode tool names are passed through raw inside
 * `payload.tool_name`; the server's TOOL_NAME_NORMALIZE table already maps
 * OpenCode names (run_shell_command→Bash, write_file→Write, etc.).
 */

// ---------------------------------------------------------------------------
// Types — minimal, host-agnostic. The plugin builds HookEvent objects from the
// concrete OpenCode hook payloads (see mapOpenCodeEvent).
// ---------------------------------------------------------------------------

/** The 6 lifecycle event kinds the server recognises (case-insensitive). */
export type LifecycleEventKind =
  | "session-start"
  | "user-prompt"
  | "pre-tool-use"
  | "post-tool-use"
  | "pre-compact"
  | "session-end";

/** A single observation event ready for the batch payload. */
export interface HookEvent {
  /** Lifecycle kind. Must be one of the 6 above (server lower-cases). */
  event: LifecycleEventKind;
  /** Project id (non-empty). */
  projectId: string;
  /** Optional session id. */
  sessionId?: string;
  /**
   * Raw host payload. Must be a non-empty object. For tool calls the server
   * classifier reads snake_case keys: tool_name, tool_input, tool_response,
   * cwd, command, prompt, file_path. We emit those so classification works.
   */
  payload: Record<string, unknown>;
  /** Optional importance 0..1 (default 0.5 server-side). */
  importance?: number;
  /** Optional agent id. */
  agentId?: string;
  /** Optional epoch-ms timestamp (defaults to now server-side). */
  ts?: number;
}

/** Wire shape for POST /api/v1/hook/batch. */
export interface HookBatchBody {
  events: HookEvent[];
}

/** Injectable dependencies so the emitter is unit-testable without a server. */
export interface EmitterDeps {
  /** POST fn; defaults to global fetch. Returns ok flag (res.ok). */
  post: (url: string, body: HookBatchBody, timeoutMs: number) => Promise<boolean>;
  /** Base API URL. */
  apiUrl: string;
  /** Logger; defaults to no-op. */
  log: (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void;
  /** Whether emission is currently enabled (e.g. API healthy + hooks on). */
  enabled: () => boolean;
  /** now() for deterministic tests. */
  now: () => number;
  /** setTimeout hook for deterministic tests. */
  setTimer: (fn: () => void, ms: number) => ReturnType<typeof setTimeout>;
  /** clearTimeout hook for deterministic tests. */
  clearTimer: (id: ReturnType<typeof setTimeout>) => void;
}

// ---------------------------------------------------------------------------
// OpenCode host event → HookEvent mapping
// ---------------------------------------------------------------------------

/**
 * Map an OpenCode tool name (as seen on tool.execute.after / ToolPart.tool)
 * into the snake_case `tool_name` the server classifier reads. OpenCode names
 * are passed through verbatim — the server's TOOL_NAME_NORMALIZE table maps
 * run_shell_command→Bash, write_file→Write, edit_file→Edit, list_files→Glob,
 * search_files/grep→Grep, glob→Glob. We keep the raw name so unknown/new tools
 * still classify via the "anything else → source fallback" path.
 */
export function buildToolPayload(params: {
  tool: string;
  args?: unknown;
  output?: unknown;
  cwd?: string;
  sessionId?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { tool_name: params.tool };
  if (params.args !== undefined) payload.tool_input = params.args;
  if (params.output !== undefined) payload.tool_response = params.output;
  if (params.cwd) payload.cwd = params.cwd;
  if (params.sessionId) payload.session_id = params.sessionId;
  return payload;
}

/**
 * Build a user-prompt payload. The server's classifyUserPrompt scans the text
 * for /goal, /plan, "decide on", "must not", etc., to derive decisions /
 * constraints / rejected-approaches / intent.
 */
export function buildPromptPayload(params: {
  prompt: string;
  sessionId?: string;
  cwd?: string;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = { prompt: params.prompt };
  // Also include `message` + `text` aliases the classifier accepts.
  if (params.prompt) {
    payload.message = params.prompt;
    payload.text = params.prompt;
  }
  if (params.sessionId) payload.session_id = params.sessionId;
  if (params.cwd) payload.cwd = params.cwd;
  return payload;
}

/** Build a session-start / session-end payload. */
export function buildSessionPayload(params: {
  cwd?: string;
  sessionId?: string;
  model?: string;
  settings?: Record<string, unknown>;
  env?: Record<string, string>;
}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (params.cwd) payload.cwd = params.cwd;
  if (params.sessionId) payload.session_id = params.sessionId;
  if (params.model) payload.model = params.model;
  if (params.settings) payload.settings = params.settings;
  if (params.env) payload.env = params.env;
  return payload;
}

// ---------------------------------------------------------------------------
// Emitter
// ---------------------------------------------------------------------------

export const DEFAULT_MAX_BATCH = 20;
export const DEFAULT_FLUSH_MS = 2_000;
export const DEFAULT_TIMEOUT_MS = 3_000;

export class ObservationEmitter {
  private readonly deps: EmitterDeps;
  private readonly maxBatch: number;
  private readonly flushMs: number;
  private readonly timeoutMs: number;

  private buffer: HookEvent[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private flushing = false;

  constructor(opts: {
    deps: EmitterDeps;
    maxBatch?: number;
    flushMs?: number;
    timeoutMs?: number;
  }) {
    this.deps = opts.deps;
    this.maxBatch = opts.maxBatch ?? DEFAULT_MAX_BATCH;
    this.flushMs = opts.flushMs ?? DEFAULT_FLUSH_MS;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  /**
   * Enqueue an event. Non-blocking: schedules (or triggers) an async flush and
   * returns immediately. Network failures are swallowed inside flush().
   */
  emit(ev: HookEvent): void {
    if (!this.deps.enabled()) return;
    // Basic client-side guard so a malformed event can't poison the batch
    // (the server would reject the whole batch otherwise).
    if (!ev || typeof ev.event !== "string" || !ev.event) return;
    if (typeof ev.projectId !== "string" || !ev.projectId.trim()) return;
    if (!ev.payload || typeof ev.payload !== "object" || Array.isArray(ev.payload)) return;
    if (Object.keys(ev.payload).length === 0) return;

    this.buffer.push({ ts: ev.ts ?? this.deps.now(), ...ev });
    if (this.buffer.length >= this.maxBatch) {
      this.scheduleFlush(0);
    } else {
      this.scheduleFlush(this.flushMs);
    }
  }

  /** Flush any buffered events immediately (e.g. on session end / dispose). */
  async flush(): Promise<void> {
    if (this.flushing) return;
    if (this.buffer.length === 0) return;
    if (this.timer) {
      this.deps.clearTimer(this.timer);
      this.timer = null;
    }
    const batch = this.buffer.splice(0, this.buffer.length);
    await this.send(batch);
  }

  /** Dispose: stop timers + best-effort flush. Safe to call multiple times. */
  async dispose(): Promise<void> {
    try {
      await this.flush();
    } catch {
      // swallow — dispose must never throw
    } finally {
      if (this.timer) {
        this.deps.clearTimer(this.timer);
        this.timer = null;
      }
    }
  }

  private scheduleFlush(ms: number): void {
    // (Re)start the debounce timer so a burst collapses into one flush.
    if (this.timer) this.deps.clearTimer(this.timer);
    this.timer = this.deps.setTimer(() => {
      this.timer = null;
      void this.flush();
    }, ms);
  }

  private async send(batch: HookEvent[]): Promise<void> {
    this.flushing = true;
    try {
      const ok = await this.deps.post(
        `${this.deps.apiUrl}/api/v1/hook/batch`,
        { events: batch },
        this.timeoutMs,
      );
      if (!ok) {
        this.deps.log("warn", "hook batch ingest non-ok", { count: batch.length });
      }
    } catch (err) {
      // Non-blocking: observation emission must never break the plugin's
      // primary function. Swallow + log.
      this.deps.log("warn", "hook batch ingest failed", {
        error: err instanceof Error ? err.message : String(err),
        count: batch.length,
      });
    } finally {
      this.flushing = false;
    }
  }
}

/**
 * Build a default EmitterDeps against the running environment. The plugin
 * wires this with its own log() + apiAvailable flag + project context.
 */
export function makeDefaultDeps(params: {
  apiUrl: string;
  log: (level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) => void;
  enabled: () => boolean;
}): EmitterDeps {
  return {
    apiUrl: params.apiUrl,
    log: params.log,
    enabled: params.enabled,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (id) => clearTimeout(id),
    post: async (url, body, timeoutMs) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        });
        // Drain the body so the connection can be reused.
        await res.text().catch(() => "");
        return res.ok;
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
