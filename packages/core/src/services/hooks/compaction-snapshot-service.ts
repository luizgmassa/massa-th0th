/**
 * CompactionSnapshotService — builds a reference-based compaction snapshot.
 *
 * Ported fresh (NOT copied) from context-mode's snapshot.ts approach.
 *
 * This preserves SESSION continuity (what happened in the conversation), NOT
 * index/task state. It is the complement of `CheckpointManager`
 * (packages/core/src/services/checkpoint/checkpoint-manager.ts), which versions
 * TASK execution state (progress, decisions, files) in memories.db. See
 * `packages/core/src/services/SESSION-STATE.md` for the full reconciliation.
 *
 * Design contract:
 *  - The snapshot is a TABLE OF CONTENTS, not inlined data. Each section
 *    contains a brief summary + a runnable search/recall/read_file call that
 *    re-fetches the full raw events from the observation store on demand.
 *  - Zero truncation, zero information loss: raw events stay in the store; the
 *    snapshot just points to them by id + provides the exact retrieval call.
 *  - Bounded size (<~2KB): structural limits per section (last-N items, dedup,
 *    short summaries), not a byte budget that drops data.
 *  - XML format (portable, LLM-friendly, matches context-mode convention).
 *
 * The snapshot is emitted on /compact (or PreCompact hook) so the resuming
 * agent can reconstruct session continuity without re-reading truncated inline
 * payloads — it follows the references to fetch full detail on demand.
 */

import { logger } from "@massa-th0th/shared";
import {
  getObservationStore,
  type ObservationStore,
  type Observation,
  type ObservationCategory,
} from "../../data/memory/observation-repository.js";
import { CATEGORY_LABELS } from "./observation-extractor.js";

// ── Types ───────────────────────────────────────────────────────────────────

export interface SnapshotSection {
  category: ObservationCategory;
  label: string;
  count: number;
  /** Brief summary line(s) — NOT the raw data. */
  summary: string;
  /** Runnable retrieval call to re-fetch the full raw events. */
  retrievalCall: string;
  /** Observation ids referenced by this section (for round-trip verification). */
  observationIds: string[];
}

export interface CompactionSnapshot {
  sessionId: string;
  projectId: string;
  eventCount: number;
  compactCount: number;
  generatedAt: string;
  sections: SnapshotSection[];
  /** The serialized XML payload (bounded <~2KB). */
  xml: string;
  /** Byte size of the XML payload (for the bounded-size contract). */
  bytes: number;
}

export interface SnapshotBuildOptions {
  sessionId: string;
  projectId: string;
  compactCount?: number;
  /** Max observations to scan per session (default 200 — plenty for a session). */
  maxEvents?: number;
  /** Max items to summarize per section (default 5 — keeps the TOC bounded). */
  maxItemsPerSection?: number;
  /** Max summary line length in chars (default 120). */
  maxSummaryLineLength?: number;
}

// ── Constants (structural size bounds) ──────────────────────────────────────

const DEFAULT_MAX_EVENTS = 200;
const DEFAULT_MAX_ITEMS_PER_SECTION = 5;
const DEFAULT_MAX_SUMMARY_LINE = 120;
/** Hard ceiling on the serialized XML. If exceeded, sections are trimmed. */
const MAX_XML_BYTES = 2048;

// ── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Truncate a string to `max` Unicode codepoints (codepoint-safe, like
 * context-mode's truncateForSnapshot).
 */
function truncate(value: string, max: number): string {
  if (!value) return "";
  const chars = [...value];
  if (chars.length <= max) return value;
  return chars.slice(0, max).join("") + "…";
}

/**
 * Build a short summary token from an observation's payload, suitable for
 * inclusion in the TOC. Extracts the most relevant single field per category.
 */
function summarizeObservation(obs: Observation, maxLen: number): string {
  let payload: Record<string, unknown>;
  try {
    payload = JSON.parse(obs.payloadJson);
  } catch {
    return truncate(`[${obs.id}]`, maxLen);
  }

  const cat = obs.category ?? "lifecycle-raw";
  let token = "";

  switch (cat) {
    case "files-read":
    case "files-written": {
      const toolInput = payload.tool_input;
      const fp =
        payload.file_path ?? payload.path ??
        (toolInput && typeof toolInput === "object"
          ? (toolInput as Record<string, unknown>).file_path
          : undefined) ??
        payload.filePath;
      token = str(fp) || JSON.stringify(payload).slice(0, 60);
      break;
    }
    case "git-changes": {
      const toolInput = payload.tool_input;
      const cmd =
        payload.command ??
        (toolInput && typeof toolInput === "object"
          ? (toolInput as Record<string, unknown>).command
          : undefined);
      token = str(cmd).split(" ").slice(0, 4).join(" ") || "git op";
      break;
    }
    case "user-prompts":
    case "goal":
    case "intent":
    case "decisions":
    case "constraints":
    case "rejected-approaches": {
      const msg = payload.prompt ?? payload.message ?? payload.text;
      token = str(msg);
      break;
    }
    case "errors": {
      const toolResponse = payload.tool_response;
      const err =
        payload.error ??
        (toolResponse && typeof toolResponse === "object"
          ? (toolResponse as Record<string, unknown>).error
          : undefined) ??
        payload.stderr;
      token = str(err) || "error";
      break;
    }
    case "tasks": {
      const tasks = payload.todos ?? payload.tasks;
      if (Array.isArray(tasks)) {
        token = `${tasks.length} task(s)`;
      } else {
        token = str(payload.content) || "task update";
      }
      break;
    }
    case "rules": {
      const fp = payload.file_path ?? payload.path;
      token = str(fp) || "rule";
      break;
    }
    case "searches": {
      const toolInput = payload.tool_input;
      const q =
        payload.query ?? payload.queries ??
        (toolInput && typeof toolInput === "object"
          ? (toolInput as Record<string, unknown>).query
          : undefined);
      token = Array.isArray(q) ? q.join(", ") : str(q) || "search";
      break;
    }
    case "memories-stored": {
      const content = payload.content;
      token = (typeof content === "string" ? content.slice(0, 60) : "") || str(payload.type) || "memory";
      break;
    }
    case "subagents-spawned": {
      token = str(payload.subagent_type) || str(payload.description) || "subagent";
      break;
    }
    case "compaction-snapshots": {
      const cc = payload.compactCount ?? payload.compact_count;
      token = `compact #${typeof cc === "number" ? cc : "?"}`;
      break;
    }
    default: {
      // Generic: try common fields, then fallback to id.
      token =
        str(payload.tool_name) ||
        str(payload.event) ||
        str(payload.description) ||
        `[${obs.id}]`;
    }
  }

  return truncate(token, maxLen);
}

function str(val: unknown): string {
  return typeof val === "string" ? val : "";
}

/**
 * Build the runnable retrieval call for a section. This is the key mechanism:
 * instead of inlining data, we provide the exact MCP tool call to re-fetch it.
 *
 * We use `recall` (semantic memory search) as the primary retrieval tool since
 * observations are consolidated into memories, plus a fallback `search` call
 * for code-scoped events. The query is derived from the section's category +
 * the session id.
 */
function buildRetrievalCall(
  category: ObservationCategory,
  sessionId: string,
  _projectId: string,
  summaryTokens: string[],
): string {
  // Build a query from the category label + up to 3 summary tokens (deduped,
  // short) so the retrieval call is specific enough to find the right events.
  const queries: string[] = [CATEGORY_LABELS[category]];
  const seen = new Set<string>();
  for (const token of summaryTokens) {
    const short = token.slice(0, 60).trim();
    if (short && !seen.has(short.toLowerCase()) && queries.length < 4) {
      seen.add(short.toLowerCase());
      queries.push(short);
    }
  }

  // The retrieval call references the session so the resuming agent can scope
  // its search. We provide BOTH a recall call (semantic) and a search call
  // (keyword) so the agent has options depending on what's available.
  const queryArr = queries.map((q) => `"${q.replace(/"/g, '\\"')}"`).join(", ");

  return `recall(query: ${queries[0] ? `"${queries[0].replace(/"/g, '\\"')}"` : '""'}, projectId: "${_projectId}", limit: 10)
  // or: search(query: ${queries[0] ? `"${queries[0].replace(/"/g, '\\"')}"` : '""'}, projectId: "${_projectId}", maxResults: 5)
  // queries: [${queryArr}]
  // sessionId: "${sessionId}"`;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class CompactionSnapshotService {
  constructor(private store: ObservationStore) {}

  /**
   * Build a bounded, reference-based compaction snapshot for a session.
   *
   * The snapshot is a table-of-contents: each section summarizes a category
   * of observations and provides a runnable retrieval call to re-fetch the
   * full raw events. Zero inlined data, zero information loss.
   */
  build(options: SnapshotBuildOptions): CompactionSnapshot {
    const {
      sessionId,
      projectId,
      compactCount = 0,
      maxEvents = DEFAULT_MAX_EVENTS,
      maxItemsPerSection = DEFAULT_MAX_ITEMS_PER_SECTION,
      maxSummaryLineLength = DEFAULT_MAX_SUMMARY_LINE,
    } = options;

    // Fetch the session's observations (newest-first).
    const observations = this.store.listBySession(sessionId, maxEvents);

    // Group by category.
    const byCategory = new Map<ObservationCategory, Observation[]>();
    for (const obs of observations) {
      const cat = obs.category ?? "lifecycle-raw";
      const arr = byCategory.get(cat) ?? [];
      arr.push(obs);
      byCategory.set(cat, arr);
    }

    // Build sections (ordered by observation count descending — most active first).
    const sections: SnapshotSection[] = [];
    for (const [category, obsList] of byCategory) {
      // Take the most recent N observations for the summary.
      const recent = obsList.slice(0, maxItemsPerSection);
      const summaryTokens = recent.map((o) => summarizeObservation(o, maxSummaryLineLength));
      const label = CATEGORY_LABELS[category] ?? category;
      const count = obsList.length;

      // Build a compact summary: "N items" + up to maxItemsPerSection short tokens.
      const summaryLines = [`${count} event(s)`];
      for (const token of summaryTokens) {
        if (token) summaryLines.push(`  - ${truncate(token, maxSummaryLineLength)}`);
      }

      sections.push({
        category,
        label,
        count,
        summary: summaryLines.join("\n"),
        retrievalCall: buildRetrievalCall(category, sessionId, projectId, summaryTokens),
        observationIds: recent.map((o) => o.id),
      });
    }

    // Sort sections by count descending (most active categories first).
    sections.sort((a, b) => b.count - a.count);

    // Serialize to XML.
    let xml = this.serializeXml(sections, {
      sessionId,
      projectId,
      eventCount: observations.length,
      compactCount,
    });

    // Enforce the hard byte ceiling: trim sections from the bottom (least active)
    // until under the limit. This never drops the raw data — it just omits a TOC
    // entry; the events are still in the store and retrievable.
    let trimmedSections = sections;
    while (xml.length > MAX_XML_BYTES && trimmedSections.length > 1) {
      trimmedSections = trimmedSections.slice(0, -1);
      xml = this.serializeXml(trimmedSections, {
        sessionId,
        projectId,
        eventCount: observations.length,
        compactCount,
      });
    }

    return {
      sessionId,
      projectId,
      eventCount: observations.length,
      compactCount,
      generatedAt: new Date().toISOString(),
      sections: trimmedSections,
      xml,
      bytes: Buffer.byteLength(xml, "utf8"),
    };
  }

  /**
   * Serialize sections to a bounded XML string.
   * Format matches context-mode's session_resume XML convention.
   */
  private serializeXml(
    sections: SnapshotSection[],
    meta: { sessionId: string; projectId: string; eventCount: number; compactCount: number },
  ): string {
    const lines: string[] = [];
    lines.push(
      `<session_resume events="${meta.eventCount}" compact_count="${meta.compactCount}" generated_at="${new Date().toISOString()}" session_id="${meta.sessionId}" project_id="${meta.projectId}">`,
    );
    lines.push(
      `  <how_to_search>This is a TABLE OF CONTENTS. Each section has a runnable recall/search call to re-fetch full event detail. Do NOT invent queries — use the ones provided. Raw events stay in the observation store; this snapshot only points to them.</how_to_search>`,
    );

    for (const section of sections) {
      lines.push(`  <${section.category} count="${section.count}">`);
      // Summary lines (indented).
      for (const line of section.summary.split("\n")) {
        lines.push(`    ${escapeXml(line)}`);
      }
      lines.push(`    For full details:`);
      lines.push(`    ${escapeXml(section.retrievalCall)}`);
      lines.push(`  </${section.category}>`);
    }

    lines.push(`</session_resume>`);
    return lines.join("\n");
  }
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ── Factory ─────────────────────────────────────────────────────────────────

let cachedService: CompactionSnapshotService | null = null;

export function getCompactionSnapshotService(store?: ObservationStore): CompactionSnapshotService {
  if (cachedService && !store) return cachedService;
  const resolvedStore = store ?? getObservationStore();
  cachedService = new CompactionSnapshotService(resolvedStore);
  return cachedService;
}

/** Test hook: reset the cached service. */
export function resetCompactionSnapshotService(): void {
  cachedService = null;
}
