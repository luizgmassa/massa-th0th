/**
 * Tool Definitions for MCP Client — facade (Wave 6 N31).
 * All tool defs extracted to tool-defs/ modules; this file concatenates
 * them in the canonical order pinned by the T02 characterization test.
 */

import { SEARCH_TOOL_DEFINITIONS } from "./tool-defs/tool-defs-search.js";
import { MEMORY_TOOL_DEFINITIONS } from "./tool-defs/tool-defs-memory.js";
import { SYNAPSE_TOOL_DEFINITIONS } from "./tool-defs/tool-defs-synapse.js";
import { PROJECT_TOOL_DEFINITIONS } from "./tool-defs/tool-defs-project.js";
import { HOOKS_EXEC_TOOL_DEFINITIONS } from "./tool-defs/tool-defs-hooks-exec.js";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  apiEndpoint: string;
  apiMethod: "GET" | "POST" | "PATCH" | "DELETE";
}

const BY_NAME = new Map(
  [...PROJECT_TOOL_DEFINITIONS, ...SEARCH_TOOL_DEFINITIONS, ...MEMORY_TOOL_DEFINITIONS, ...SYNAPSE_TOOL_DEFINITIONS, ...HOOKS_EXEC_TOOL_DEFINITIONS].map((t) => [t.name, t] as const),
);
const CANONICAL_ORDER = ["index","index_status","search","remember","recall","memory_update","memory_delete","list_checkpoints","create_checkpoint","restore_checkpoint","compress","optimized_context","analytics","list_projects","project_map","get_architecture","search_definitions","get_references","go_to_definition","trace_path","impact_analysis","reset_project","read_file","synapse_session","synapse_get","synapse_update","synapse_end","synapse_prime","synapse_access","synapse_prefetch","synapse_list","synapse_task_begin","synapse_task_end","symbol_snippet","memory_list","reindex","hook_ingest","compact_snapshot","bootstrap","handoff_begin","handoff_accept","handoff_cancel","handoff_list_pending","list_proposals","approve_proposal","reject_proposal","execute","execute_file","batch_execute","fetch_and_index","rename_project","merge_projects"] as const;

export const TOOL_DEFINITIONS: ToolDefinition[] = CANONICAL_ORDER.map((name) => BY_NAME.get(name)!);
export function getToolDefinition(name: string): ToolDefinition | undefined {
  return TOOL_DEFINITIONS.find((t) => t.name === name);
}