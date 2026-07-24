/**
 * Code Compressor
 * 
 * Semantic compression for source code
 * Strategy: Keep structure, remove implementation details
 */

import { ICompressor } from '@massa-ai/shared';
import { CompressedContent, CompressionStrategy } from '@massa-ai/shared';
import { CompressedContent as CompressedContentModel } from '../../models/CompressedContent.js';
import { config, logger } from '@massa-ai/shared';
import { MetricsCollector } from '@massa-ai/shared';
import { llmComplete, isLlmEnabled, type LlmResult } from '../memory/llm-client.js';

/**
 * Injectable LLM-complete surface (mirrors the real `llmComplete` signature).
 * Tests inject a fake; production uses the default export.
 */
export type CompressLlmComplete = (
  prompt: string,
  opts?: { system?: string; timeoutMs?: number; modelRole?: "instruct" | "code" },
) => Promise<LlmResult<string>>;

/**
 * Code structure patterns to preserve
 */
interface CodeStructure {
  imports: string[];
  interfaces: string[];
  classes: string[];
  functions: string[];
  exports: string[];
}

export class CodeCompressor implements ICompressor {
  private strategy: CompressionStrategy = CompressionStrategy.CODE_STRUCTURE;
  private languageCache: Map<string, string> = new Map();
  private readonly llmCompleteFn: CompressLlmComplete;

  /**
   * @param llmCompleteFn Optional injectable LLM-complete surface for tests.
   *   Production callers omit it; the real `llmComplete` is used. The LLM path
   *   is gated on `config.get("llm").enabled` and silent-degrades to the regex
   *   path on LLM off / {ok:false} / throw / over-long / empty output.
   */
  constructor(llmCompleteFn: CompressLlmComplete = llmComplete) {
    this.llmCompleteFn = llmCompleteFn;
  }

  /**
   * Compress source code
   */
  async compress(
    content: string,
    strategy?: CompressionStrategy
  ): Promise<CompressedContent> {
    const useStrategy = strategy || this.strategy;

    try {
      logger.debug('Compressing code', { 
        strategy: useStrategy,
        originalLength: content.length 
      });

      let compressed: string;
      let preservedElements: string[] = [];

      switch (useStrategy) {
        case CompressionStrategy.CODE_STRUCTURE: {
          // Phase 7d: regex output is ALWAYS computed first (cheap) so the
          // fallback is instant. Then, if the LLM is enabled, try to improve on
          // it toward config.compression.targetCompressionRatio.
          const result = await this.compressStructure(content);
          compressed = result.compressed;
          preservedElements = result.preserved;
          let compressionSource: "regex" | "llm" = "regex";

          // Phase 7d: LLM path gated on isLlmEnabled() (which honors the test
          // seam + reads config defensively). No separate config.get("llm")
          // gate, so the LLM-off/feature-off path is test-seam-driven and
          // immune to process-wide mock.module config collisions.
          if (isLlmEnabled() && content.trim().length > 0) {
            const language = this.getCachedLanguage(content);
            let targetRatio = 0.7;
            let timeoutMs: number | undefined;
            try {
              targetRatio = config.get("compression").targetCompressionRatio ?? 0.7;
            } catch {
              targetRatio = 0.7;
            }
            try {
              timeoutMs = config.get("llm").timeoutMs;
            } catch {
              timeoutMs = undefined;
            }
            const prompt = buildLlmCompressPrompt(
              content,
              language,
              targetRatio,
              preservedElements,
            );
            try {
              const res = await this.llmCompleteFn(prompt, { timeoutMs, modelRole: "code" });
              if (
                res.ok &&
                typeof res.value === "string" &&
                res.value.trim().length > 0 &&
                res.value.length <= content.length
              ) {
                compressed = res.value;
                compressionSource = "llm";
              } else if (!res.ok) {
                logger.debug("LLM compression {ok:false} — using regex output");
              }
            } catch (e) {
              logger.debug("LLM compression threw — using regex output", {
                error: (e as Error).message,
              });
            }
          }

          const language = this.getCachedLanguage(content);
          const compressedContent = CompressedContentModel.create(
            content,
            compressed,
            useStrategy,
            language || 'unknown',
            preservedElements,
            compressionSource
          );

          MetricsCollector.recordCompression(
            compressedContent.metadata.originalTokens,
            compressedContent.metadata.compressedTokens
          );
          logger.info('Code compressed', {
            ratio: compressedContent.compressionRatio,
            tokensSaved: compressedContent.tokensSaved,
            language,
            compressionSource,
          });
          return compressedContent;
        }

        case CompressionStrategy.SEMANTIC_DEDUP:
          compressed = await this.deduplicateSemantics(content);
          break;

        default:
          compressed = content;
      }

      // Detect language (with caching)
      const language = this.getCachedLanguage(content);

      const compressedContent = CompressedContentModel.create(
        content,
        compressed,
        useStrategy,
        language || 'unknown',
        preservedElements
      );

      // Record metrics for optimization tracking
      MetricsCollector.recordCompression(
        compressedContent.metadata.originalTokens,
        compressedContent.metadata.compressedTokens
      );

      logger.info('Code compressed', {
        ratio: compressedContent.compressionRatio,
        tokensSaved: compressedContent.tokensSaved,
        language
      });

      return compressedContent;

    } catch (error) {
      logger.error('Code compression failed', error as Error);
      return CompressedContentModel.identity(content);
    }
  }

  /**
   * Decompress (return original)
   */
  async decompress(compressed: CompressedContent): Promise<string> {
    return compressed.original;
  }

  /**
   * Estimate compression ratio
   */
  async estimateCompression(content: string): Promise<number> {
    const structure = this.extractStructure(content);
    const structureText = this.structureToText(structure);
    
    return CompressedContentModel.calculateRatio(
      CompressedContentModel.estimateTokens(content),
      CompressedContentModel.estimateTokens(structureText)
    );
  }

  getStrategy(): CompressionStrategy {
    return this.strategy;
  }

  /**
   * Compress by extracting structure only
   */
  private async compressStructure(
    content: string
  ): Promise<{ compressed: string; preserved: string[] }> {
    const structure = this.extractStructure(content);
    const compressed = this.structureToText(structure);
    
    const preserved = [
      ...structure.imports,
      ...structure.interfaces,
      ...structure.classes,
      ...structure.functions,
      ...structure.exports
    ];

    return { compressed, preserved };
  }

  /**
   * Extract code structure (signatures only)
   */
  private extractStructure(content: string): CodeStructure {
    const lines = content.split('\n');
    const structure: CodeStructure = {
      imports: [],
      interfaces: [],
      classes: [],
      functions: [],
      exports: []
    };

    let inMultilineComment = false;
    let inInterface = false;
    let inClass = false;
    let braceDepth = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();

      // Skip empty lines
      if (!line) continue;

      // Handle multi-line comments
      if (line.includes('/*')) inMultilineComment = true;
      if (line.includes('*/')) {
        inMultilineComment = false;
        continue;
      }
      if (inMultilineComment) continue;

      // Skip single-line comments (but preserve JSDoc)
      if (line.startsWith('//') && !line.startsWith('/**')) continue;

      // Track brace depth
      braceDepth += (line.match(/{/g) || []).length;
      braceDepth -= (line.match(/}/g) || []).length;

      // Imports
      if (line.startsWith('import ')) {
        structure.imports.push(line);
        continue;
      }

      // Exports
      if (line.startsWith('export ')) {
        // Handle export declarations
        if (line.includes('class ') || line.includes('interface ') || 
            line.includes('function ') || line.includes('const ')) {
          structure.exports.push(line.split('{')[0].trim());
        }
      }

      // Interfaces
      if (line.includes('interface ')) {
        inInterface = true;
        const signature = this.extractSignature(line);
        structure.interfaces.push(signature);
        continue;
      }

      // Classes
      if (line.includes('class ')) {
        inClass = true;
        const signature = this.extractSignature(line);
        structure.classes.push(signature);
        continue;
      }

      // Functions/Methods
      if (this.isFunctionDeclaration(line)) {
        const signature = this.extractSignature(line);
        structure.functions.push(signature);
        continue;
      }

      // End of interface/class
      if (braceDepth === 0) {
        inInterface = false;
        inClass = false;
      }
    }

    return structure;
  }

  /**
   * Check if line is a function declaration
   */
  private isFunctionDeclaration(line: string): boolean {
    return (
      line.includes('function ') ||
      line.includes('=>') ||
      /^(public|private|protected|async)?\s*\w+\s*\(/.test(line) ||
      /^(static\s+)?(?:Future(?:<[^>]+>)?|void|int|double|String|bool|dynamic|num|[A-Z]\w*(?:<[^>]+>)?)\s+\w+\s*\(/.test(line)
    );
  }

  /**
   * Extract signature from line (remove implementation)
   */
  private extractSignature(line: string): string {
    // Remove implementation (everything after opening brace)
    const signature = line.split('{')[0].trim();
    
    // Remove inline comments
    return signature.replace(/\/\/.*$/, '').trim();
  }

  /**
   * Convert structure to compressed text
   */
  private structureToText(structure: CodeStructure): string {
    const parts: string[] = [];

    if (structure.imports.length > 0) {
      parts.push('// Imports');
      parts.push(...structure.imports.slice(0, 5)); // Limit to top 5
      if (structure.imports.length > 5) {
        parts.push(`// ... ${structure.imports.length - 5} more imports`);
      }
      parts.push('');
    }

    if (structure.interfaces.length > 0) {
      parts.push('// Interfaces');
      parts.push(...structure.interfaces);
      parts.push('');
    }

    if (structure.classes.length > 0) {
      parts.push('// Classes');
      parts.push(...structure.classes);
      parts.push('');
    }

    if (structure.functions.length > 0) {
      parts.push('// Functions');
      parts.push(...structure.functions);
      parts.push('');
    }

    if (structure.exports.length > 0) {
      parts.push('// Exports');
      parts.push(...structure.exports);
    }

    return parts.join('\n');
  }

  /**
   * Remove semantically duplicate code
   */
  private async deduplicateSemantics(content: string): Promise<string> {
    const lines = content.split('\n');
    const seen = new Set<string>();
    const deduplicated: string[] = [];

    for (const line of lines) {
      const normalized = line.trim().toLowerCase();
      
      // Skip empty lines
      if (!normalized) {
        deduplicated.push(line);
        continue;
      }

      // Check for semantic duplicates
      if (!seen.has(normalized)) {
        seen.add(normalized);
        deduplicated.push(line);
      }
    }

    return deduplicated.join('\n');
  }

  /**
   * Detect programming language from content
   */
  private detectLanguage(content: string): string {
    // Kotlin (check before Dart — both use import-without-from, but Kotlin has `fun`/`val`/`var`/`package`)
    const hasKtFun = /\bfun\s+\w+\s*\(/.test(content);
    const hasKtValVar = /\b(?:val|var)\s+\w+\s*(?::\s*\w+[?*<>]*\s*)?(?:=)/.test(content);
    const hasKtPackage = /^package\s+[\w.]+/m.test(content);
    const hasKtImport = /^import\s+[\w.]+\.\w+/m.test(content);
    const hasKtClassLike = /\b(?:data\s+class|sealed\s+class|object\s+\w+|companion\s+object|expect\s+(?:class|fun)|actual\s+(?:class|fun))\b/.test(content);

    if (
      (hasKtFun || hasKtValVar || hasKtClassLike) &&
      (hasKtPackage || hasKtImport)
    ) {
      return "kotlin";
    }

    if (hasKtFun && !content.includes("import ") && !content.includes("from ")) {
      return "kotlin";
    }

    const hasDartOnlyDirective = /(\blibrary\s+[a-zA-Z_][\w.]*\s*;|\bpart\s+of\s+[a-zA-Z_][\w.]*\s*;)/.test(content);
    const hasDartType = /\b(class|enum|mixin|extension)\s+\w+/.test(content);
    const hasDartMain = /\bvoid\s+main\s*\(/.test(content);
    const hasPartOfQuoted = /\bpart\s+of\s+['"][^'"]+['"]\s*;/.test(content);
    const hasDartImport = /\bimport\s+['"](dart:|package:)[^'"]+['"]\s*;/.test(content);
    const hasDartMixin = /\bmixin\s+\w+/.test(content);

    if (
      hasDartMain ||
      hasPartOfQuoted ||
      hasDartImport ||
      (hasDartOnlyDirective && hasDartType) ||
      (hasDartMixin && hasDartType)
    ) {
      return 'dart';
    }

    if (content.includes('import ') && content.includes('from ')) {
      if (content.includes(': ') || content.includes('interface ')) {
        return 'typescript';
      }
      return 'javascript';
    }
    
    if (content.includes('def ') && content.includes(':')) {
      return 'python';
    }
    
    if (content.includes('fn ') && content.includes('->')) {
      return 'rust';
    }
    
    if (content.includes('package ') && content.includes('func ')) {
      return 'go';
    }

    return 'unknown';
  }

  /**
   * Get cached language detection
   */
  private getCachedLanguage(content: string): string {
    // Use content hash as cache key (simple approach)
    const hash = content.slice(0, 100); // First 100 chars as pseudo-hash
    
    if (!this.languageCache.has(hash)) {
      const language = this.detectLanguage(content);
      this.languageCache.set(hash, language);
      
      // Limit cache size
      if (this.languageCache.size > 100) {
        const firstKey = this.languageCache.keys().next().value;
        if (firstKey) {
          this.languageCache.delete(firstKey);
        }
      }
    }
    
    return this.languageCache.get(hash)!;
  }
}

// ─── Phase 7d: LLM compress prompt builder ────────────────────────────────────

/** Cap content fed to the LLM to bound prompt size. */
const LLM_COMPRESS_CONTENT_CAP = 6000;

/**
 * Build the LLM compression prompt. Targets `targetRatio` and lists the
 * regex-extracted `preservedSignatures` as "must preserve" so the LLM output
 * keeps the same load-bearing structure the regex path would have surfaced.
 */
function buildLlmCompressPrompt(
  content: string,
  language: string,
  targetRatio: number,
  preservedSignatures: string[],
): string {
  const slice = content.slice(0, LLM_COMPRESS_CONTENT_CAP);
  const sigs =
    preservedSignatures.length > 0
      ? preservedSignatures.slice(0, 30).join("\n")
      : "(none detected)";
  return [
    `Compress the following ${language || "source"} code to ~${Math.round(
      targetRatio * 100,
    )}% of its length while preserving every public signature (imports, exported functions, classes, interfaces) and the overall structure.`,
    "Remove comments, blank lines, and implementation bodies; keep signatures and type info.",
    "Output ONLY the compressed code, no prose.",
    "",
    "Must-preserve signatures:",
    sigs,
    "",
    "Code:",
    slice,
  ].join("\n");
}

