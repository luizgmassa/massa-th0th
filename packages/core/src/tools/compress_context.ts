/**
 * Compress Context Tool
 *
 * Comprime contexto usando compressão semântica com LLM.
 * Mantém estrutura essencial, remove detalhes, economiza tokens.
 */

import { IToolHandler } from "@massa-ai/shared";
import { ToolResponse } from "@massa-ai/shared";
import { CodeCompressor } from "../services/compression/code-compressor.js";
import { logger } from "@massa-ai/shared";
import { estimateTokens } from "@massa-ai/shared";
import { validateEnum } from "./enum-validation.js";

interface CompressContextParams {
  content: string;
  strategy?:
    | "code_structure"
    | "conversation_summary"
    | "semantic_dedup"
    | "hierarchical";
  language?: string;
  targetRatio?: number;
}

export class CompressContextTool implements IToolHandler {
  name = "compress_context";
  description =
    "Compress context using semantic compression (keeps structure, removes details)";
  inputSchema = {
    type: "object",
    properties: {
      content: {
        type: "string",
        description: "Content to compress",
      },
      strategy: {
        type: "string",
        enum: [
          "code_structure",
          "conversation_summary",
          "semantic_dedup",
          "hierarchical",
        ],
        description: "Compression strategy",
        default: "code_structure",
      },
      language: {
        type: "string",
        description: "Programming language (for code compression)",
      },
      targetRatio: {
        type: "number",
        description:
          "Target compression ratio (0-1, e.g., 0.7 = 70% reduction)",
        default: 0.7,
      },
    },
    required: ["content"],
  };

  private compressor: CodeCompressor;

  constructor() {
    this.compressor = new CodeCompressor();
  }

  async handle(params: unknown): Promise<ToolResponse> {
    const {
      content,
      language,
      targetRatio = 0.7,
    } = params as CompressContextParams;
    const strategy = validateEnum<
      "code_structure" | "conversation_summary" | "semantic_dedup" | "hierarchical"
    >(
      "strategy",
      (params as CompressContextParams).strategy ?? "code_structure",
      [
        "code_structure",
        "conversation_summary",
        "semantic_dedup",
        "hierarchical",
      ] as const,
    );

    try {
      const originalTokens = estimateTokens(content, (language as 'code' | 'text') || "code");

      logger.info("Compressing context", {
        originalTokens,
        strategy,
        targetRatio,
      });

      // Perform compression
      const result = await this.compressor.compress(content, strategy as any);

      const compressedTokens = estimateTokens(result.compressed, (language as 'code' | 'text') || "code");
      const actualRatio = 1 - compressedTokens / originalTokens;
      const tokensSaved = originalTokens - compressedTokens;

      logger.info("Context compressed", {
        originalTokens,
        compressedTokens,
        tokensSaved,
        actualRatio: actualRatio.toFixed(2),
        targetRatio,
      });

      return {
        success: true,
        data: {
          compressed: result.compressed,
          originalLength: content.length,
          compressedLength: result.compressed.length,
          originalTokens,
          compressedTokens,
          strategy,
        },
        metadata: {
          tokensSaved,
          compressionRatio: actualRatio,
        },
      };
    } catch (error) {
      logger.error("Failed to compress context", error as Error, {
        strategy,
        contentLength: content.length,
      });

      return {
        success: false,
        error: `Failed to compress context: ${(error as Error).message}`,
      };
    }
  }
}
