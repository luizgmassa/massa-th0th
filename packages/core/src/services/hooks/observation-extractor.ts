/**
 * ObservationExtractor — derives a semantic `category` from (source, payload).
 *
 * Ported fresh (NOT copied) from context-mode's extract.ts approach: a set of
 * pure, side-effect-free classifier functions dispatched off the lifecycle
 * `source` + the payload shape. Each classifier inspects the payload for
 * tool-name / field-shape signals and returns an `ObservationCategory`.
 *
 * Design:
 *  - Pure: (source, payload) → category. No IO, no state, never throws.
 *  - Graceful: unknown payloads fall back to "lifecycle-raw".
 *  - Backward-compatible: the 6 lifecycle `source` kinds are unchanged; the
 *    category is an additive derived field.
 *  - The category drives the compaction snapshot's table-of-contents sections.
 */

import type { LifecycleEventKind } from "../../data/memory/observation-repository.js";
import type { ObservationCategory } from "../../data/memory/observation-repository.js";

// ── Tool-name normalization ─────────────────────────────────────────────────
// Different hosts emit different tool names for the same action. Normalize to
// a canonical set so classifiers match regardless of source.

const TOOL_NAME_NORMALIZE: Record<string, string> = {
  // Claude Code canonical
  Read: "Read",
  Write: "Write",
  Edit: "Edit",
  MultiEdit: "MultiEdit",
  Glob: "Glob",
  Grep: "Grep",
  Bash: "Bash",
  Task: "Task",
  TodoWrite: "TodoWrite",
  WebFetch: "WebFetch",
  WebSearch: "WebSearch",
  // OpenCode / other hosts
  run_shell_command: "Bash",
  shell: "Bash",
  write_file: "Write",
  edit_file: "Edit",
  list_files: "Glob",
  search_files: "Grep",
  grep: "Grep",
  glob: "Glob",
  // massa-th0th MCP tools (note: read_file is ambiguous — Claude Code's Read
  // and massa-th0th's read_file tool. We normalize to "Read" for extraction
  // purposes since both are file-read operations.)
  search: "th0th_search",
  recall: "th0th_recall",
  store_memory: "th0th_store",
  search_definitions: "th0th_search_def",
  get_references: "th0th_get_refs",
  read_file: "Read",
  compact_snapshot: "th0th_compact_snapshot",
};

function normalizeToolName(raw: unknown): string {
  if (typeof raw !== "string" || !raw) return "";
  return TOOL_NAME_NORMALIZE[raw] ?? raw;
}

// ── Payload field extractors (safe accessors) ───────────────────────────────

function str(val: unknown): string {
  return typeof val === "string" ? val : "";
}

function lower(val: unknown): string {
  return str(val).toLowerCase();
}

/** Safely extract a field from a payload object. */
function field(payload: Record<string, unknown>, key: string): unknown {
  return payload?.[key];
}

// ── Category classifiers ────────────────────────────────────────────────────
// Each returns an ObservationCategory or null (no match). The first match wins.

type Classifier = (
  source: LifecycleEventKind,
  payload: Record<string, unknown>,
) => ObservationCategory | null;

/**
 * Classify a post-tool-use / pre-tool-use payload by its tool name.
 * This is the primary classifier — most observations come from tool calls.
 */
const classifyToolCall: Classifier = (_source, payload) => {
  const toolName = normalizeToolName(
    field(payload, "tool_name") ?? field(payload, "toolName"),
  );

  switch (toolName) {
    case "Read":
    case "th0th_read_file":
      return "files-read";
    case "Write":
    case "Edit":
    case "MultiEdit":
      return "files-written";
    case "Glob":
    case "list_files":
      return "file-search";
    case "Grep":
    case "search_files":
    case "grep":
      return "file-search";
    case "Bash": {
      const toolInput = field(payload, "tool_input");
      const cmdRaw = field(payload, "command") ??
        (toolInput && typeof toolInput === "object" ? (toolInput as Record<string, unknown>).command : undefined);
      const cmd = lower(cmdRaw);
      if (cmd.startsWith("git ") || cmd.includes(" git ")) {
        if (cmd.includes("commit") || cmd.includes("merge") || cmd.includes("rebase")) {
          return "git-changes";
        }
        return "git-changes";
      }
      return "tool-calls";
    }
    case "TodoWrite":
    case "Task":
      return "tasks";
    case "WebFetch":
      return "web-fetch";
    case "WebSearch":
      return "searches";
    case "th0th_search":
    case "th0th_search_def":
    case "th0th_get_refs":
      return "searches";
    case "th0th_recall":
      return "searches";
    case "th0th_store":
      return "memories-stored";
    case "th0th_compact_snapshot":
      return "compaction-snapshots";
    case "Task": // subagent spawn
      return "subagents-spawned";
    default:
      // MCP tool calls (namespaced like "mcp__server__tool")
      if (toolName.startsWith("mcp__")) return "mcp-calls";
      return null;
  }
};

/**
 * Classify a user-prompt payload for decision/intent/goal/constraint signals.
 * Ported from context-mode's UserPromptSubmit classifiers.
 */
const classifyUserPrompt: Classifier = (source, payload) => {
  if (source !== "user-prompt") return null;

  const prompt = str(
    field(payload, "prompt") ?? field(payload, "message") ?? field(payload, "text"),
  );
  const lowerPrompt = prompt.toLowerCase();

  // Goal marker
  if (lowerPrompt.startsWith("/goal") || lowerPrompt.startsWith("goal:") || lowerPrompt.startsWith("objective:")) {
    return "goal";
  }
  // Plan marker
  if (lowerPrompt.startsWith("/plan")) {
    return "plan-changes";
  }
  // Decision signals
  if (
    lowerPrompt.includes("let's go with") ||
    lowerPrompt.includes("decide on") ||
    lowerPrompt.includes("decision:") ||
    lowerPrompt.includes("we'll use") ||
    lowerPrompt.includes("chosen approach")
  ) {
    return "decisions";
  }
  // Constraint signals
  if (
    lowerPrompt.includes("must not") ||
    lowerPrompt.includes("constraint:") ||
    lowerPrompt.includes("don't touch") ||
    lowerPrompt.includes("never ") ||
    lowerPrompt.includes("avoid ")
  ) {
    return "constraints";
  }
  // Rejected approach
  if (
    lowerPrompt.includes("not that") ||
    lowerPrompt.includes("rejected") ||
    lowerPrompt.includes("don't do") ||
    lowerPrompt.includes("instead of")
  ) {
    return "rejected-approaches";
  }
  // Blocked-on
  if (
    lowerPrompt.includes("blocked on") ||
    lowerPrompt.includes("waiting on") ||
    lowerPrompt.includes("can't proceed") ||
    lowerPrompt.includes("stuck on")
  ) {
    return "blocked-on";
  }
  // Role / persona
  if (
    lowerPrompt.startsWith("/persona") ||
    lowerPrompt.startsWith("act as") ||
    lowerPrompt.startsWith("you are a")
  ) {
    return "role";
  }

  return "user-prompts";
};

/**
 * Classify session-start for env / settings / cwd.
 */
const classifySessionStart: Classifier = (source, payload) => {
  if (source !== "session-start") return null;
  const hasCwd = !!field(payload, "cwd") || !!field(payload, "workingDirectory");
  const hasEnv = !!field(payload, "env") || !!field(payload, "environment");
  const hasSettings = !!field(payload, "settings") || !!field(payload, "model");

  if (hasSettings) return "session-settings";
  if (hasCwd) return "cwd-changes";
  if (hasEnv) return "env-changes";
  return "session-settings";
};

/**
 * Classify pre-compact as compaction-snapshots.
 */
const classifyPreCompact: Classifier = (source) => {
  if (source === "pre-compact") return "compaction-snapshots";
  return null;
};

/**
 * Classify post-tool-use errors from tool_response.
 */
const classifyError: Classifier = (source, payload) => {
  if (source !== "post-tool-use") return null;
  const response = field(payload, "tool_response") ?? field(payload, "toolResponse");
  if (response && typeof response === "object") {
    const respObj = response as Record<string, unknown>;
    const isError = respObj.is_error;
    const error = respObj.error;
    if (isError === true || error) return "errors";
  }
  const stdout = str(field(payload, "stdout"));
  if (stdout.toLowerCase().includes("error:") || stdout.toLowerCase().includes("failed:")) {
    return "errors";
  }
  return null;
};

/**
 * Classify CLAUDE.md / rules file reads.
 */
const classifyRuleFile: Classifier = (_source, payload) => {
  const toolName = normalizeToolName(field(payload, "tool_name"));
  if (toolName !== "Read" && toolName !== "th0th_read_file") return null;

  const toolInput = field(payload, "tool_input");
  const filePath = lower(
    field(payload, "file_path") ??
      field(payload, "path") ??
      (toolInput && typeof toolInput === "object"
        ? (toolInput as Record<string, unknown>).file_path
        : undefined),
  );
  if (!filePath) return null;

  if (
    filePath.endsWith("claude.md") ||
    filePath.endsWith("agents.md") ||
    filePath.endsWith("cursorrules") ||
    filePath.endsWith(".clinerules") ||
    filePath.includes("claudemd") ||
    filePath.endsWith("rtk.md")
  ) {
    return "rules";
  }
  return null;
};

/**
 * Classify skill invocations from tool calls.
 */
const classifySkill: Classifier = (_source, payload) => {
  const toolName = normalizeToolName(field(payload, "tool_name"));
  if (toolName === "Skill" || toolName === "skill") return "skills-invoked";
  // Also detect skill mentions in user prompts
  return null;
};

/**
 * Classify git operations from the payload directly (not just Bash).
 */
const classifyGitPayload: Classifier = (_source, payload) => {
  const cmd = lower(field(payload, "command"));
  if (cmd.startsWith("git ")) {
    if (cmd.includes("commit") || cmd.includes("merge") || cmd.includes("rebase") || cmd.includes("checkout") || cmd.includes("reset")) {
      return "git-changes";
    }
  }
  // Git diff / status in payload
  const diff = field(payload, "diff") ?? field(payload, "git_diff");
  if (diff) return "git-changes";
  return null;
};

// Ordered classifier pipeline — first match wins.
const CLASSIFIERS: Classifier[] = [
  classifyRuleFile, // rules before files-read (CLAUDE.md reads)
  classifyError, // errors before generic tool-calls
  classifyGitPayload, // git before generic tool-calls
  classifySkill, // skills before generic tool-calls
  classifyToolCall, // primary tool-call classifier
  classifyUserPrompt, // user-prompt-derived categories
  classifySessionStart, // session-start-derived categories
  classifyPreCompact, // pre-compact → compaction-snapshots
];

// ── Public API ──────────────────────────────────────────────────────────────

/**
 * Derive an `ObservationCategory` from (source, payload).
 *
 * Pure, never throws. Returns "lifecycle-raw" when no classifier matches
 * (backward-compatible fallback for legacy/unknown payloads).
 */
export function extractCategory(
  source: LifecycleEventKind,
  payload: Record<string, unknown>,
): ObservationCategory {
  if (!payload || typeof payload !== "object") return "lifecycle-raw";

  for (const classifier of CLASSIFIERS) {
    try {
      const result = classifier(source, payload);
      if (result) return result;
    } catch {
      // Classifiers must never throw; defend anyway.
      continue;
    }
  }

  // Source-based fallbacks for events with no payload-specific match.
  switch (source) {
    case "session-start":
      return "session-settings";
    case "session-end":
      return "lifecycle-raw";
    case "pre-compact":
      return "compaction-snapshots";
    default:
      return "lifecycle-raw";
  }
}

/**
 * Human-readable label for a category (ported from context-mode analytics.ts).
 * Used by the compaction snapshot's section headers.
 */
export const CATEGORY_LABELS: Record<ObservationCategory, string> = {
  "files-read": "Files read",
  "files-written": "Files written",
  "file-search": "File searches",
  "tool-calls": "Tool calls",
  "git-changes": "Git operations",
  tasks: "Tasks in progress",
  "plan-changes": "Plan changes",
  errors: "Errors caught",
  "error-resolution": "Errors resolved",
  "iteration-loop": "Retry loops detected",
  decisions: "Decisions made",
  constraints: "Constraints set",
  "rejected-approaches": "Approaches rejected",
  "user-prompts": "Your messages",
  intent: "Session intent",
  goal: "Session goal",
  role: "Behavior rules",
  "blocked-on": "Blockers logged",
  rules: "Project rules (CLAUDE.md)",
  "skills-invoked": "Skills used",
  "subagents-spawned": "Delegated work",
  "env-changes": "Environment changes",
  "cwd-changes": "Working directory",
  "session-settings": "Session settings",
  "external-refs": "External references",
  "web-fetch": "Web pages fetched",
  searches: "Searches performed",
  "memories-stored": "Memories stored",
  "compaction-snapshots": "Compaction snapshots",
  "mcp-calls": "MCP tool calls",
  "agent-findings": "Agent findings",
  "cost-telemetry": "Cost telemetry",
  "lifecycle-raw": "Lifecycle events",
};
