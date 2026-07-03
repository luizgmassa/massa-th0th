/**
 * Update Memory Tool
 *
 * Thin MCP tool layer — validates input and delegates to MemoryController.
 * Supports partial updates: content (re-embedded), importance, and tags
 * (replace or merge). All business logic lives in controllers/memory-controller.ts.
 */

import { IToolHandler, ToolResponse } from "@massa-th0th/shared";
import { logger } from "@massa-th0th/shared";
import { encode as toTOON } from "@toon-format/toon";
import { MemoryController } from "../controllers/memory-controller.js";

interface UpdateMemoryParams {
  id: string;
  content?: string;
  importance?: number;
  tags?: string[];
  mergeTags?: boolean;
  format?: "json" | "toon";
}

export class UpdateMemoryTool implements IToolHandler {
  name = "update_memory";
  description =
    "Update an existing memory by id (content, importance, or tags). Content changes are re-embedded.";
  inputSchema = {
    type: "object",
    properties: {
      id: { type: "string", description: "ID of the memory to update" },
      content: { type: "string", description: "New content (re-embedded when set)" },
      importance: {
        type: "number",
        description: "New importance score (0-1)",
        minimum: 0,
        maximum: 1,
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags (replace existing unless mergeTags is true)",
      },
      mergeTags: {
        type: "boolean",
        description: "Union tags with existing instead of replacing",
        default: false,
      },
      format: {
        type: "string",
        enum: ["json", "toon"],
        description: "Output format (json or toon)",
        default: "toon",
      },
    },
    required: ["id"],
  };

  private controller: MemoryController;

  constructor() {
    this.controller = MemoryController.getInstance();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const { id, content, importance, tags, mergeTags, format = "toon" } =
      params as UpdateMemoryParams;

    try {
      const result = await this.controller.update({
        id,
        content,
        importance,
        tags,
        mergeTags,
      });

      return format === "toon"
        ? { success: true, data: toTOON(result) }
        : { success: true, data: result };
    } catch (error) {
      logger.error("Failed to update memory", error as Error, { id });
      return {
        success: false,
        error: `Failed to update memory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
