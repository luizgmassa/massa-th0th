/**
 * Store Memory Tool
 *
 * Thin MCP tool layer — validates input and delegates to MemoryController.
 * All business logic lives in controllers/memory-controller.ts.
 */

import { IToolHandler, ToolResponse, MemoryType } from "@massa-ai/shared";
import { logger } from "@massa-ai/shared";
import { MemoryController } from "../controllers/memory-controller.js";
import { serializeToolResponse } from "./serialize.js";

interface StoreMemoryParams {
  content: string;
  type: MemoryType;
  userId?: string;
  sessionId?: string;
  projectId?: string;
  agentId?: string;
  importance?: number;
  tags?: string[];
  linkTo?: string[];
  format?: "json" | "toon";
  fields?: string[];
}

export class StoreMemoryTool implements IToolHandler {
  name = "store_memory";
  description = "Store memory in the hierarchical memory system (local PostgreSQL)";
  inputSchema = {
    type: "object",
    properties: {
      content: { type: "string", description: "Content to store" },
      type: {
        type: "string",
        enum: ["critical", "conversation", "code", "decision", "pattern"],
        description: "Type of memory",
      },
      userId: { type: "string", description: "User ID" },
      sessionId: { type: "string", description: "Session ID" },
      projectId: { type: "string", description: "Project ID" },
      agentId: {
        type: "string",
        description: "Agent ID (e.g., orchestrator, implementer, architect, optimizer)",
      },
      importance: {
        type: "number",
        description: "Importance score (0-1)",
        default: 0.5,
      },
      tags: {
        type: "array",
        items: { type: "string" },
        description: "Tags for categorization",
      },
      linkTo: {
        type: "array",
        items: { type: "string" },
        description: "Memory IDs to explicitly link this memory to (creates RELATES_TO edges)",
      },
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
    required: ["content", "type"],
  };

  private controller: MemoryController;

  constructor() {
    this.controller = MemoryController.getInstance();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      content,
      type,
      userId,
      sessionId,
      projectId,
      agentId,
      importance,
      tags,
      linkTo,
      format = "toon",
      fields,
    } = params as StoreMemoryParams;

    try {
      const result = await this.controller.store({
        content,
        type,
        userId,
        sessionId,
        projectId,
        agentId,
        importance,
        tags,
        linkTo,
      });

      return serializeToolResponse(result, { format, fields });
    } catch (error) {
      logger.error("Failed to store memory", error as Error, { type });
      return {
        success: false,
        error: `Failed to store memory: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
  }
}
