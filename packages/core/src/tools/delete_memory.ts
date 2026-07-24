/**
 * Delete Memory Tool
 *
 * Thin MCP tool layer — delegates to MemoryController.
 * Hard-deletes the memory and severs its graph edges. Soft-delete is a
 * Phase 1 concern (needs a deleted_at column + recall filtering).
 */

import { IToolHandler, ToolResponse } from "@massa-ai/shared";
import { logger } from "@massa-ai/shared";
import { MemoryController } from "../controllers/memory-controller.js";
import { serializeToolResponse } from "./serialize.js";

interface DeleteMemoryParams {
  id: string;
  format?: "json" | "toon";
  fields?: string[];
}

export class DeleteMemoryTool implements IToolHandler {
  name = "delete_memory";
  description =
    "Delete a memory by id (hard delete). Also removes its graph edges.";
  inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "ID of the memory to delete" },
      format: {
        type: "string",
        enum: ["json", "toon"],
        description: "Output format (json or toon)",
        default: "toon",
      },
      fields: {
        type: "array",
        items: { type: "string" },
        description:
          "Projection — keep only these keys (dotted paths supported, e.g. ['nodes.symbol']). Absent/empty → full data.",
      },
    },
    required: ["id"],
  };

  private controller: MemoryController;

  constructor() {
    this.controller = MemoryController.getInstance();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const { id, format = "toon", fields } = params as DeleteMemoryParams;

    try {
      const result = await this.controller.delete(id);

      return serializeToolResponse(result, { format, fields });
    } catch (error) {
      logger.error("Failed to delete memory", error as Error, { id });
      return {
        success: false,
        error: `Failed to delete memory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
