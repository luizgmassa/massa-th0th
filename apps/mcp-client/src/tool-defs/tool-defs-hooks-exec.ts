/**
 * Tool Definitions — Hooks / Handoff / Proposal / Executor tools
 *
 * Extracted from tool-definitions.ts (Wave 6 N31, T12).
 * Tools: hook_ingest, compact_snapshot, bootstrap, handoff_begin,
 *        handoff_accept, handoff_cancel, handoff_list_pending,
 *        list_proposals, approve_proposal, reject_proposal, execute,
 *        execute_file, batch_execute, fetch_and_index
 */

import type { ToolDefinition } from "../tool-definitions.js";

export const HOOKS_EXEC_TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    name: "hook_ingest",
    description:
      "Passively ingest a batch of lifecycle events (session-start, user-prompt, pre/post-tool-use, pre-compact, session-end) as Observations. Fire-and-forget; consolidated into memories later by the LLM bridge. Useful for non-Claude hosts.",
    apiEndpoint: "/api/v1/hook/batch",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        events: {
          type: "array",
          description: "Lifecycle events to ingest (validated atomically)",
          items: {
            type: "object",
            properties: {
              event: {
                type: "string",
                enum: [
                  "session-start",
                  "user-prompt",
                  "pre-tool-use",
                  "post-tool-use",
                  "pre-compact",
                  "session-end",
                ],
              },
              projectId: { type: "string" },
              sessionId: { type: "string" },
              payload: { type: "object", description: "Event-specific payload" },
              importance: { type: "number", minimum: 0, maximum: 1 },
              agentId: { type: "string" },
              ts: { type: "number", description: "Epoch ms (defaults to now)" },
            },
            required: ["event", "projectId", "payload"],
          },
        },
      },
      required: ["events"],
    },
  },
  {
    name: "compact_snapshot",
    description:
      "Build a reference-based compaction snapshot — bounded <~2KB table-of-contents with runnable recall/search calls for the current session's observations (SESSION continuity, not task state). Zero information loss — raw events stay in PostgreSQL; the snapshot points to them. Distinct from checkpoints (which version task progress). Optionally persists the snapshot as an observation of category 'compaction-snapshots'. Use on /compact or PreCompact for session continuity.",
    apiEndpoint: "/api/v1/hook/compact-snapshot",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        sessionId: {
          type: "string",
          description: "Session ID to build the snapshot for",
        },
        projectId: {
          type: "string",
          description: "Project ID (defaults to 'default')",
        },
        persist: {
          type: "boolean",
          default: false,
          description:
            "If true, persist the snapshot as an observation of category 'compaction-snapshots'",
        },
      },
      required: ["sessionId"],
    },
  },
  {
    name: "bootstrap",
    description:
      "Scan a project (git log, README, docs, package manifests, top central files from PageRank) and create LLM-summarized seed memories so an agent begins with usable context. Idempotent — skips if already bootstrapped unless force=true. LLM-off degrades silently to rule-based seeds. Never throws.",
    apiEndpoint: "/api/v1/bootstrap",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier" },
        projectPath: {
          type: "string",
          description: "Project root path (defaults to server cwd)",
        },
        force: {
          type: "boolean",
          default: false,
          description: "Refresh even if already bootstrapped",
        },
      },
      required: ["projectId"],
    },
  },
  {
    name: "handoff_begin",
    description:
      "Begin a cross-session handoff: leave a structured record (summary, open questions, next steps, files) for a later agent to discover on session start. The handoff is persisted in the Handoff table AND dual-written as a searchable memory (FTS-discoverable). Optional LLM summary-polish (default-off). Never throws.",
    apiEndpoint: "/api/v1/handoff/begin",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
        sourceSessionId: { type: "string", description: "Session leaving the handoff" },
        targetAgent: { type: "string", description: "Target agent name (omit = broadcast)" },
        summary: { type: "string", description: "Handoff summary (max 1024 chars; empty = auto-polish when LLM on)" },
        openQuestions: { type: "array", items: { type: "string" } },
        nextSteps: { type: "array", items: { type: "string" } },
        files: { type: "array", items: { type: "string" } },
      },
      required: ["projectId"],
    },
  },
  {
    name: "handoff_accept",
    description:
      "Accept an open handoff by id. Flips status open→accepted, sets accepted_at, emits handoff:accepted. Missing/expired/already-accepted/project-mismatch ids return a clear {ok:false, reason}. Never throws.",
    apiEndpoint: "/api/v1/handoff/accept",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Handoff id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
      },
      required: ["id"],
    },
  },
  {
    name: "handoff_cancel",
    description:
      "Cancel (expire) an open handoff by id. Flips status open→expired (no event). Same failure semantics as accept on missing/non-open/project-mismatch. Never throws.",
    apiEndpoint: "/api/v1/handoff/cancel",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Handoff id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
      },
      required: ["id"],
    },
  },
  {
    name: "handoff_list_pending",
    description:
      "List open handoffs for a project (optionally filtered by target agent), ordered oldest-first. The recall-path surfacing primitive for auto-inject on session start. Never throws.",
    apiEndpoint: "/api/v1/handoff/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
        targetAgent: { type: "string", description: "Optional target agent filter" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "list_proposals",
    description:
      "List pending auto-improvement proposals for a project (newest-first). The review-gate surfacing primitive: proposals are generated by the auto-improve loop from recurring patterns (repeated queries, hot files, common fixes). Never throws.",
    apiEndpoint: "/api/v1/proposal/list",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        projectId: { type: "string", description: "Project identifier (required)" },
      },
      required: ["projectId"],
    },
  },
  {
    name: "approve_proposal",
    description:
      "Approve a pending auto-improvement proposal by id. Applies the proposed memory edit, flips status pending→approved, and emits memory:auto-improved. Missing/non-pending/project-mismatch/apply-failed ids return a clear {ok:false, reason}. Never throws.",
    apiEndpoint: "/api/v1/proposal/approve",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Proposal id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
        source: {
          type: "string",
          enum: ["llm", "rule-based"],
          description: "Origin of the proposal (audit; default rule-based)",
        },
      },
      required: ["id"],
    },
  },
  {
    name: "reject_proposal",
    description:
      "Reject a pending auto-improvement proposal by id. Flips status pending→rejected (no memory edit applied, no event emitted). Same failure semantics as approve on missing/non-pending/project-mismatch. Never throws.",
    apiEndpoint: "/api/v1/proposal/reject",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Proposal id (required)" },
        projectId: { type: "string", description: "Optional project scope check" },
        reason: { type: "string", description: "Optional rejection reason (audit)" },
      },
      required: ["id"],
    },
  },
  {
    name: "execute",
    description:
      "Run code in a detected polyglot sandbox runtime (js/ts/python/shell/ruby/go/rust/php/perl/r). " +
      "Returns stdout/stderr. Local-dev trust model: code runs on the host as the current user — " +
      "no OS-level isolation. Timeout default 30s, cap 300s. Pass `intent` to trim large outputs.",
    apiEndpoint: "/api/v1/executor/execute",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        language: {
          type: "string",
          enum: ["javascript", "typescript", "python", "shell", "ruby", "go", "rust", "php", "perl", "r"],
          description: "Language/runtime to execute the code in.",
        },
        code: { type: "string", description: "Source code to execute." },
        timeout: { type: "number", description: "Max runtime in ms (default 30000, cap 300000)." },
        background: { type: "boolean", description: "Detach instead of killing on timeout (default false).", default: false },
        cwd: { type: "string", description: "Working directory (defaults to project root)." },
        intent: {
          type: "string",
          description: "Optional query. When output > ~5KB, only sections matching this intent are returned.",
        },
      },
      required: ["language", "code"],
    },
  },
  {
    name: "execute_file",
    description:
      "Read a file into a sandboxed FILE_CONTENT variable and run code over it. Only what your code " +
      "prints enters the conversation. Enforces project-root containment + a secrets deny-glob by default.",
    apiEndpoint: "/api/v1/executor/execute_file",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        path: { type: "string", description: "Project-relative (or absolute, under root) file path." },
        language: {
          type: "string",
          enum: ["javascript", "typescript", "python", "shell", "ruby", "go", "rust", "php", "perl", "r"],
          description: "Language/runtime to execute the code in.",
        },
        code: {
          type: "string",
          description: "Code to run over the file. FILE_CONTENT (text) and file_path (absolute) are in scope.",
        },
        timeout: { type: "number", description: "Max runtime in ms (default 30000, cap 300000)." },
        intent: { type: "string", description: "Optional intent query to trim large outputs." },
      },
      required: ["path", "language", "code"],
    },
  },
  {
    name: "batch_execute",
    description:
      "Run N shell commands in parallel via run-pool (order-preserving, concurrency-capped). " +
      "Returns per-command stdout/stderr/exitCode in input order. Default concurrency = cpu count; " +
      "failures do not abort siblings.",
    apiEndpoint: "/api/v1/executor/batch_execute",
    apiMethod: "POST",
    inputSchema: {
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
          description: "Optional queries to scope auto-indexing of outputs (reserved; currently a no-op stub).",
        },
        timeout: { type: "number", description: "Per-command timeout in ms (default 30000)." },
        concurrency: { type: "number", description: "Max in-flight commands (default = host cpu count)." },
        cwd: { type: "string", description: "Working directory (defaults to project root)." },
        query_scope: { type: "string", description: "Optional scope label for the batch (diagnostics only)." },
      },
      required: ["commands"],
    },
  },
  {
    name: "fetch_and_index",
    description:
      "Fetch URL(s), convert HTML to markdown (JSON → key-path chunks), and " +
      "index them for search. SSRF-guarded: loopback/private/link-local/IMDS " +
      "IPs are blocked, including redirect-to-internal and DNS-rebind. Parallel " +
      "fetch (run-pool, cpu-capped), serial per-URL indexing. TTL-cached (~24h).",
    apiEndpoint: "/api/v1/web/fetch_and_index",
    apiMethod: "POST",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "Single URL to fetch and index (single-shape).",
        },
        source: {
          type: "string",
          description: "Label for the indexed content when using single `url`.",
        },
        requests: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "URL to fetch." },
              source: {
                type: "string",
                description: "Label for this URL's indexed content.",
              },
            },
            required: ["url"],
          },
          description:
            "Batch shape: array of {url, source?}. Use with concurrency>1 for " +
            "parallel fetch. Output preserves input order.",
        },
        concurrency: {
          type: "number",
          description:
            "Max URLs fetched in parallel (1-8, default 1). Capped by cpu count.",
        },
        force: {
          type: "boolean",
          description: "Skip cache and re-fetch even if recently indexed.",
        },
        ttl: {
          type: "number",
          description:
            "Override cache freshness window in ms (0 bypasses cache like force).",
        },
      },
    },
  },
];