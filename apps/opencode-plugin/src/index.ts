import type { Plugin, PluginInput } from "@opencode-ai/plugin"
import { tool, type ToolContext } from "@opencode-ai/plugin"
import { configExists, initConfig, loadConfig } from "@massa-ai/shared/config"
import {
  ObservationEmitter,
  makeDefaultDeps,
  buildToolPayload,
  buildPromptPayload,
  buildSessionPayload,
} from "./observation-emitter"
import {
  SessionProjectPin,
  computePluginProjectId,
  gitToplevelSafe,
  agentIdOf,
} from "./session-project-pin"

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const MASSA_AI_API_URL = process.env.MASSA_AI_API_URL || "http://localhost:3333"
const FETCH_TIMEOUT_MS = 5_000
const REINDEX_DEBOUNCE_MS = 60_000
const REINDEX_FILE_THRESHOLD = 15
const MAX_EDITED_FILES_TRACKED = 200

// ---------------------------------------------------------------------------
// Auto-configuration
// ---------------------------------------------------------------------------

function ensureConfig(): void {
  if (!configExists()) {
    initConfig()
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║  massa-ai initialized with default configuration                  ║
║                                                                ║
║  Config: ~/.config/massa-ai/config.json                           ║
║  Provider: Ollama (local, free)                                ║
║                                                                ║
║  To change provider:                                           ║
║    npx massa-ai-config use mistral --api-key YOUR_KEY             ║
║    npx massa-ai-config use openai --api-key YOUR_KEY              ║
╚═══════════════════════════════════════════════════════════════╝
`)
  }
}

// ---------------------------------------------------------------------------
// HTTP client with timeout + abort
// ---------------------------------------------------------------------------

async function th0thFetch<T = unknown>(
  endpoint: string,
  body: Record<string, unknown>,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${MASSA_AI_API_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`massa-ai ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function th0thGet<T = unknown>(
  endpoint: string,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(`${MASSA_AI_API_URL}${endpoint}`, {
      method: "GET",
      signal: controller.signal,
    })
    if (!res.ok) {
      const text = await res.text().catch(() => "")
      throw new Error(`massa-ai ${res.status}: ${text.slice(0, 200)}`)
    }
    return res.json()
  } finally {
    clearTimeout(timer)
  }
}

async function th0thGetWithQuery<T = unknown>(
  endpoint: string,
  params: Record<string, string | number | boolean | undefined>,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<T> {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null) qs.set(k, String(v))
  }
  const sep = endpoint.includes("?") ? "&" : "?"
  return th0thGet<T>(`${endpoint}${sep}${qs.toString()}`, timeoutMs)
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export const MassaAiPlugin: Plugin = async ({ project, directory, worktree, client }: PluginInput) => {
  // Auto-configure on first run
  ensureConfig()
  
  const config = loadConfig()
  
  const projectPath = worktree || directory

  // Per-session project id memo (M45/HAR-04): the first event of a session
  // computes the id (project?.id > git toplevel basename > directory basename
  // > "default"); later events of that session reuse it even from subdirectory
  // contexts. `projectId` (no session) keeps the same computed value for the
  // request/response tools below.
  const projectPins = new SessionProjectPin({
    computeProjectId: () =>
      computePluginProjectId({
        projectId: project?.id,
        directory,
        gitToplevel: gitToplevelSafe,
      }),
  })
  const projectId = projectPins.for(undefined)

  // Per-plugin-instance state
  const editedFiles = new Set<string>()
  let reindexTimer: ReturnType<typeof setTimeout> | null = null
  let reindexInFlight = false
  let apiAvailable = true

  // Lifecycle observation emitter (SG-7/#21). Non-blocking, batched, debounced.
  // Mirrors apps/claude-plugin/hooks: emits raw host events to
  // POST /api/v1/hook/batch; the server classifies into the 33-category taxonomy.
  const observations = new ObservationEmitter({
    deps: makeDefaultDeps({
      apiUrl: MASSA_AI_API_URL,
      log,
      enabled: () => apiAvailable,
    }),
  })

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  function log(level: "debug" | "info" | "warn" | "error", message: string, extra?: Record<string, unknown>) {
    client.app.log({
      body: { service: "massa-ai", level, message, extra },
    }).catch(() => {})
  }

  function toast(message: string, variant: "success" | "error" | "info" = "info") {
    client.tui.showToast({
      body: { message: `[massa-ai] ${message}`, variant },
    }).catch(() => {})
  }

  function fireAndForget(endpoint: string, body: Record<string, unknown>, label: string) {
    th0thFetch(endpoint, body).catch((err) => {
      log("warn", `${label} failed`, { error: err instanceof Error ? err.message : String(err) })
    })
  }

  function scheduleReindex() {
    if (!apiAvailable || reindexInFlight) return
    if (reindexTimer) clearTimeout(reindexTimer)

    reindexTimer = setTimeout(async () => {
      if (reindexInFlight) return
      reindexInFlight = true
      const count = editedFiles.size
      try {
        await th0thFetch("/api/v1/project/index", {
          projectPath,
          projectId,
          forceReindex: false,
          warmCache: false,
        })
        editedFiles.clear()
        log("info", `Incremental reindex completed (${count} files changed)`)
      } catch (err) {
        log("warn", "Reindex failed", { error: err instanceof Error ? err.message : String(err) })
      } finally {
        reindexInFlight = false
        reindexTimer = null
      }
    }, REINDEX_DEBOUNCE_MS)
  }

  function trackFile(filePath: string | undefined) {
    if (!filePath || typeof filePath !== "string") return
    if (editedFiles.size >= MAX_EDITED_FILES_TRACKED) return
    editedFiles.add(filePath)
    if (editedFiles.size >= REINDEX_FILE_THRESHOLD) {
      scheduleReindex()
    }
  }

  // ---------------------------------------------------------------------------
  // Tools
  // ---------------------------------------------------------------------------

  return {
    tool: {
      "search": tool({
        description:
          "Semantic code search in indexed project. Uses hybrid vector + keyword search with RRF ranking. Returns relevant code snippets with file paths and line numbers.",
        args: {
          query: tool.schema.string().describe("Search query (natural language or keywords)"),
          projectId: tool.schema.string().optional().describe("Project ID to search in (defaults to current project)"),
          maxResults: tool.schema.number().optional().default(10).describe("Max results to return"),
          minScore: tool.schema.number().optional().default(0.3).describe("Minimum relevance score (0-1)"),
          include: tool.schema.array(tool.schema.string()).optional().describe("Glob patterns to include"),
          exclude: tool.schema.array(tool.schema.string()).optional().describe("Glob patterns to exclude"),
          format: tool.schema.enum(["json", "toon"]).optional().default("toon").describe("Output format"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thFetch("/api/v1/search/project", {
            query: args.query,
            projectId: args.projectId || projectId,
            projectPath: ctx.worktree || projectPath,
            maxResults: args.maxResults ?? 10,
            minScore: args.minScore ?? 0.3,
            responseMode: "summary",
            autoReindex: true,
            include: args.include,
            exclude: args.exclude,
            format: args.format ?? "toon",
          })
          return JSON.stringify(result)
        },
      }),

      "remember": tool({
        description:
          "Store important information in massa-ai memory. Persists across sessions. Use for: user criticals, architectural decisions, discovered patterns.",
        args: {
          content: tool.schema.string().describe("Content to store"),
          type: tool.schema.enum(["critical", "conversation", "code", "decision", "pattern"]).describe("Memory type"),
          tags: tool.schema.array(tool.schema.string()).optional().describe("Tags for categorization"),
          importance: tool.schema.number().min(0).max(1).optional().default(0.5).describe("Importance 0-1"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thFetch("/api/v1/memory/store", {
            content: args.content,
            type: args.type,
            projectId,
            sessionId: ctx.sessionID,
            agentId: ctx.agent,
            tags: args.tags,
            importance: args.importance ?? 0.5,
            format: "toon",
          })
          return JSON.stringify(result)
        },
      }),

      "recall": tool({
        description:
          "Search stored memories from previous sessions. Recovers decisions, patterns, and context.",
        args: {
          query: tool.schema.string().describe("What to remember"),
          types: tool.schema.array(tool.schema.enum(["critical", "conversation", "code", "decision", "pattern"])).optional().describe("Filter by type"),
          limit: tool.schema.number().optional().default(10).describe("Max results"),
          minImportance: tool.schema.number().optional().default(0.3).describe("Minimum importance"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thFetch("/api/v1/memory/search", {
            query: args.query,
            projectId,
            sessionId: ctx.sessionID,
            types: args.types,
            limit: args.limit ?? 10,
            minImportance: args.minImportance ?? 0.3,
            includePersistent: true,
            format: "toon",
          })
          return JSON.stringify(result)
        },
      }),

      "index": tool({
        description:
          "Index the current project for semantic search. Async - returns jobId.",
        args: {
          forceReindex: tool.schema.boolean().optional().default(false).describe("Force full reindex"),
          warmCache: tool.schema.boolean().optional().default(true).describe("Pre-cache common queries"),
        },
        async execute(args, ctx: ToolContext) {
          toast("Indexing project...", "info")
          const result = await th0thFetch("/api/v1/project/index", {
            projectPath: ctx.worktree || projectPath,
            projectId,
            forceReindex: args.forceReindex ?? false,
            warmCache: args.warmCache ?? true,
          }, 15_000)
          toast("Indexing started", "success")
          return JSON.stringify(result)
        },
      }),

      "compress": tool({
        description:
          "Compress context using semantic compression. Keeps structure, removes details. 70-98% token reduction.",
        args: {
          content: tool.schema.string().describe("Content to compress"),
          strategy: tool.schema.enum(["code_structure", "conversation_summary", "semantic_dedup", "hierarchical"]).optional().default("code_structure"),
          targetRatio: tool.schema.number().min(0).max(1).optional().default(0.7).describe("Compression ratio (0.7 = 70% reduction)"),
          language: tool.schema.string().optional().describe("Programming language"),
        },
        async execute(args) {
          const result = await th0thFetch("/api/v1/context/compress", {
            content: args.content,
            strategy: args.strategy ?? "code_structure",
            targetRatio: args.targetRatio ?? 0.7,
            language: args.language,
          }, 10_000)
          return JSON.stringify(result)
        },
      }),

      "optimized_context": tool({
        description:
          "Search + compress in one call. Maximum token efficiency for limited context budgets.",
        args: {
          query: tool.schema.string().describe("Search query"),
          maxTokens: tool.schema.number().optional().default(4000).describe("Max tokens in result"),
          maxResults: tool.schema.number().optional().default(5).describe("Max search results"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thFetch("/api/v1/context/optimized", {
            query: args.query,
            projectId,
            projectPath: ctx.worktree || projectPath,
            maxTokens: args.maxTokens ?? 4000,
            maxResults: args.maxResults ?? 5,
          }, 10_000)
          return JSON.stringify(result)
        },
      }),

      "read": tool({
        description:
          "Read file with automatic compression, caching, and symbol metadata. Use with search results for 60% token savings.",
        args: {
          filePath: tool.schema.string().describe("File path (absolute or relative to project root)"),
          projectId: tool.schema.string().optional().describe("Project ID for symbol metadata"),
          offset: tool.schema.number().optional().describe("Start line number (1-indexed)"),
          limit: tool.schema.number().optional().describe("Number of lines to read"),
          lineStart: tool.schema.number().optional().describe("Start line (alternative to offset)"),
          lineEnd: tool.schema.number().optional().describe("End line (alternative to limit)"),
          compress: tool.schema.boolean().optional().default(true).describe("Auto-compress content > 100 lines"),
          targetRatio: tool.schema.number().min(0).max(1).optional().default(0.3).describe("Compression target ratio (0.3 = 70% reduction)"),
          format: tool.schema.enum(["json", "toon"]).optional().default("json").describe("Output format"),
          includeSymbols: tool.schema.boolean().optional().default(true).describe("Include symbol metadata from graph"),
          includeImports: tool.schema.boolean().optional().default(true).describe("Extract and show import statements"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thFetch("/api/v1/file/read", {
            filePath: args.filePath,
            projectId: args.projectId || projectId,
            offset: args.offset,
            limit: args.limit,
            lineStart: args.lineStart,
            lineEnd: args.lineEnd,
            compress: args.compress ?? true,
            targetRatio: args.targetRatio ?? 0.3,
            format: args.format ?? "json",
            includeSymbols: args.includeSymbols ?? true,
            includeImports: args.includeImports ?? true,
          }, 10_000)
          return JSON.stringify(result)
        },
      }),

      "index_status": tool({
        description:
          "Check the status and progress of an async indexing job. Use the jobId returned by index.",
        args: {
          jobId: tool.schema.string().describe("Job ID returned by index"),
        },
        async execute(args) {
          const result = await th0thGet(`/api/v1/project/index/status/${encodeURIComponent(args.jobId)}`)
          return JSON.stringify(result)
        },
      }),

      "analytics": tool({
        description: "Get massa-ai usage analytics and performance metrics.",
        args: {
          type: tool.schema.enum(["summary", "project", "cache", "recent"]).optional().default("summary"),
          limit: tool.schema.number().optional().default(10),
        },
        async execute(args) {
          const result = await th0thFetch("/api/v1/analytics/", {
            type: args.type ?? "summary",
            projectId,
            limit: args.limit ?? 10,
          })
          return JSON.stringify(result)
        },
      }),

      // ── Symbol Graph tools ────────────────────────────────────────────────

      "list_projects": tool({
        description:
          "List all indexed projects with their status (pending/indexing/indexed/error), file counts, symbol counts, and last indexed time.",
        args: {
          status: tool.schema
            .enum(["pending", "indexing", "indexed", "error", "all"])
            .optional()
            .default("all")
            .describe("Filter by workspace status. Defaults to 'all'."),
        },
        async execute(args) {
          const result = await th0thGetWithQuery("/api/v1/workspace/list", {
            status: args.status ?? "all",
          })
          return JSON.stringify(result)
        },
      }),

      "search_definitions": tool({
        description:
          "Search for symbol definitions (functions, classes, variables, types, interfaces) in an indexed project. Returns name, kind, file location, and doc comments.",
        args: {
          query: tool.schema
            .string()
            .optional()
            .describe("Substring search on symbol name (case-insensitive)"),
          kind: tool.schema
            .array(tool.schema.enum(["function", "class", "variable", "type", "interface", "export"]))
            .optional()
            .describe("Filter by symbol kind"),
          file: tool.schema
            .string()
            .optional()
            .describe("Filter by file path (relative to project root)"),
          exportedOnly: tool.schema
            .boolean()
            .optional()
            .default(false)
            .describe("Return only exported symbols"),
          maxResults: tool.schema
            .number()
            .optional()
            .default(20)
            .describe("Maximum number of results to return (default: 20)"),
        },
        async execute(args, ctx: ToolContext) {
          const result = await th0thGetWithQuery("/api/v1/symbol/definitions", {
            projectId,
            search: args.query,
            kind: args.kind?.join(","),
            file: args.file,
            exportedOnly: args.exportedOnly ?? false,
            limit: args.maxResults ?? 20,
          })
          return JSON.stringify(result)
        },
      }),

      "get_references": tool({
        description:
          "Find all references (usages) of a symbol in the project. Returns file paths, line numbers, reference kinds (call/import/type_ref/extend/implement), and code context.",
        args: {
          symbolName: tool.schema
            .string()
            .describe("Name of the symbol to find references for"),
          fqn: tool.schema
            .string()
            .optional()
            .describe(
              "Fully-qualified name (e.g. 'services/search/rlm.ts#ContextualSearchRLM') to disambiguate when multiple definitions share the same name",
            ),
          maxResults: tool.schema
            .number()
            .optional()
            .default(50)
            .describe("Maximum references to return (default: 50)"),
        },
        async execute(args) {
          const result = await th0thGetWithQuery("/api/v1/symbol/references", {
            projectId,
            symbolName: args.symbolName,
            fqn: args.fqn,
            limit: args.maxResults ?? 50,
          })
          return JSON.stringify(result)
        },
      }),

      "go_to_definition": tool({
        description:
          "Find the definition of a symbol (function, class, variable, type, etc.) in the project. Disambiguates by calling file context. Returns file location, line numbers, doc comment, and code snippet.",
        args: {
          symbolName: tool.schema
            .string()
            .describe("Name of the symbol to find the definition for"),
          fromFile: tool.schema
            .string()
            .optional()
            .describe(
              "Relative path of the file where the symbol is used. Helps prioritize the correct definition when multiple exist.",
            ),
        },
        async execute(args) {
          const result = await th0thGetWithQuery("/api/v1/symbol/definition", {
            projectId,
            symbolName: args.symbolName,
            fromFile: args.fromFile,
          })
          return JSON.stringify(result)
        },
      }),
    },

    // -----------------------------------------------------------------------
    // Events - typed to real Hooks interface
    // -----------------------------------------------------------------------

    // Health check + auto-index on session start
    "session.created": async () => {
      try {
        const controller = new AbortController()
        const timer = setTimeout(() => controller.abort(), 3_000)
        const res = await fetch(`${MASSA_AI_API_URL}/health`, { signal: controller.signal })
        clearTimeout(timer)
        apiAvailable = res.ok
        if (apiAvailable) {
          log("info", `Connected to massa-ai API at ${MASSA_AI_API_URL}`)
        } else {
          toast("massa-ai API unhealthy", "error")
        }
      } catch {
        apiAvailable = false
        log("warn", `massa-ai API unreachable at ${MASSA_AI_API_URL}`)
      }
      // Emit session-start observation (best-effort, non-blocking).
      observations.emit({
        event: "session-start",
        projectId,
        payload: buildSessionPayload({ cwd: projectPath }),
      })
    },

    // Capture git operations after bash execution
    // Hooks interface: tool.execute.after(input: { tool, sessionID, callID, args }, output: { title, output, metadata })
    "tool.execute.after": async (input, output) => {
      if (!apiAvailable) return

      // Emit a post-tool-use observation for EVERY tool (SG-7/#21). The server
      // classifies via payload.tool_name (Read/Write/Bash/Edit/etc.). We pass
      // OpenCode tool names raw; TOOL_NAME_NORMALIZE maps them. Non-blocking.
      observations.emit({
        event: "post-tool-use",
        projectId: projectPins.for(input.sessionID),
        sessionId: input.sessionID,
        agentId: agentIdOf(input),
        payload: buildToolPayload({
          tool: input.tool,
          args: input.args,
          output: output.output,
          cwd: projectPath,
          sessionId: input.sessionID,
        }),
      })

      if (input.tool !== "bash") return

      const cmd = String(input.args?.command || "")
      if (!cmd.includes("git commit") && !cmd.includes("git merge") && !cmd.includes("git rebase")) return

      const result = String(output.output || "").slice(0, 300)
      fireAndForget("/api/v1/memory/store", {
        content: `Git: ${cmd.slice(0, 200)}\nResult: ${result}`,
        type: "code",
        projectId: projectPins.for(input.sessionID),
        sessionId: input.sessionID,
        tags: ["git"],
        importance: 0.6,
        format: "toon",
      }, "git-capture")
    },

    // Compaction: fetch real memories and inject as context, + build snapshot
    // Hooks interface: experimental.session.compacting(input: { sessionID }, output: { context: string[], prompt?: string })
    "experimental.session.compacting": async (input, output) => {
      if (!apiAvailable) return

      try {
        const memories = await th0thFetch<{ success: boolean; data?: { memories?: Array<{ content: string }> } }>(
          "/api/v1/memory/search",
          {
            query: `project ${projectId} critical decisions patterns`,
            projectId,
            sessionId: input.sessionID,
            limit: 5,
            minImportance: 0.5,
            includePersistent: true,
            format: "json",
          },
          3_000,
        )

        if (memories?.data?.memories?.length) {
          const memoryText = memories.data.memories
            .map((m, i) => `${i + 1}. ${m.content}`)
            .join("\n")
          output.context.push(`## massa-ai - Persistent Memories\n${memoryText}`)
        }
      } catch (err) {
        log("debug", "Failed to fetch memories for compaction", {
          error: err instanceof Error ? err.message : String(err),
        })
      }

      // Build + persist a reference-based compaction snapshot (Phase 3 C1).
      // Fire-and-forget: the snapshot is a bounded TOC with runnable search
      // calls — zero information loss, raw events stay in the observation store.
      try {
        await th0thFetch(
          "/api/v1/hook/compact-snapshot",
          {
            sessionId: input.sessionID,
            projectId: projectPins.for(input.sessionID),
            persist: true,
          },
          5_000,
        )
      } catch (err) {
        log("debug", "Failed to build compaction snapshot", {
          error: err instanceof Error ? err.message : String(err),
        })
      }
    },

    // Inject massa-ai env vars into shell
    // Hooks interface: shell.env(input: { cwd, sessionID?, callID? }, output: { env })
    "shell.env": async (input, output) => {
      output.env.MASSA_AI_PROJECT_ID = projectPins.for(input.sessionID)
      output.env.MASSA_AI_PROJECT_PATH = projectPath
      output.env.MASSA_AI_API_URL = MASSA_AI_API_URL
    },

    // Unified event handler for file tracking + LSP diagnostics + observations
    event: async ({ event }) => {
      // Track file edits for incremental reindex
      if (event.type === "file.edited") {
        trackFile(event.properties.file)
        // fall through — also emit nothing here (file.edited has no lifecycle kind)
        return
      }
      if (event.type === "file.watcher.updated") {
        trackFile(event.properties.file)
        return
      }

      // ── Lifecycle observations (SG-7/#21) ──────────────────────────────
      // OpenCode has no dedicated session-start/stop or user-prompt-submit
      // hooks (unlike Claude Code). The closest lifecycle signals flow through
      // the generic `event` hook:
      //  - command.executed       → user-prompt (typed command / slash cmd)
      //  - message.part.updated   → post-tool-use for tool parts reaching
      //                              completed/error (covers MCP + agent tools
      //                              that bypass tool.execute.after)
      //  - session.idle/deleted   → session-end
      if (apiAvailable && event.type === "command.executed") {
        const p = event.properties as { arguments?: string; name?: string; sessionID?: string }
        const text = [p.name, p.arguments].filter(Boolean).join(" ").trim()
        if (text) {
          observations.emit({
            event: "user-prompt",
            projectId: projectPins.for(p.sessionID),
            sessionId: p.sessionID,
            agentId: agentIdOf(p),
            payload: buildPromptPayload({ prompt: text, cwd: projectPath }),
          })
        }
      }

      if (apiAvailable && event.type === "message.part.updated") {
        const part = (event.properties as { part?: { type?: string; tool?: string; state?: { status?: string; error?: string; output?: string; input?: unknown }; sessionID?: string; messageID?: string } }).part
        if (part?.type === "tool" && part.tool && part.state) {
          const status = part.state.status
          if (status === "completed" || status === "error") {
            observations.emit({
              event: "post-tool-use",
              projectId: projectPins.for(part.sessionID),
              sessionId: part.sessionID,
              agentId: agentIdOf(part),
              payload: buildToolPayload({
                tool: part.tool,
                args: part.state.input,
                output: status === "error" ? part.state.error : part.state.output,
                cwd: projectPath,
                sessionId: part.sessionID,
              }),
              importance: status === "error" ? 0.7 : undefined,
            })
          }
        }
      }

      if (apiAvailable && (event.type === "session.idle" || event.type === "session.deleted")) {
        const p = event.properties as { sessionID?: string }
        observations.emit({
          event: "session-end",
          projectId: projectPins.for(p.sessionID),
          sessionId: p.sessionID,
          agentId: agentIdOf(p),
          payload: buildSessionPayload({ cwd: projectPath }),
        })
        // On session.idle, also best-effort flush buffered observations so a
        // short session doesn't lose events to the debounce window.
        if (event.type === "session.idle") void observations.flush()
      }

      // LSP diagnostics: track persistent errors
      if (!apiAvailable) return
      if (event.type !== "lsp.client.diagnostics") return

      const props = event.properties as { path?: string; diagnostics?: Array<{ severity?: number; message?: string }> }
      const errors = props.diagnostics?.filter(d => d.severity === 1) || []
      if (errors.length === 0) return

      // Only track files with 3+ errors (persistent problems)
      if (errors.length >= 3) {
        const file = props.path || "unknown"
        const messages = errors.slice(0, 3).map(e => e.message).join("; ")
        fireAndForget("/api/v1/memory/store", {
          content: `LSP errors in ${file}: ${messages} (${errors.length} total)`,
          type: "pattern",
          projectId,
          tags: ["lsp", "error", "diagnostics"],
          importance: 0.4,
          format: "toon",
        }, "lsp-diagnostics")
      }
    },

    // Best-effort flush on plugin teardown.
    dispose: async () => {
      try {
        await observations.dispose()
      } catch {
        // swallow — dispose must never throw
      }
    },
  }
}

export default MassaAiPlugin
