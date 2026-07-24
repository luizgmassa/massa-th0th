/**
 * ETL Stage 2 — Parse
 *
 * For each DiscoveredFile that needsReparse=true:
 *   1. Reads file content
 *   2. Runs smart-chunker for semantic embedding chunks
 *   3. Extracts normalized symbols, imports, and edges through the exact
 *      manifest-owned native structural runtime
 *   4. Leaves unsupported extensions on the existing semantic-only path
 *
 * Files with needsReparse=false are passed through with empty symbols/chunks.
 */

import path from "path";
import fs from "fs/promises";
import { logger } from "@massa-ai/shared";
import { smartChunk, type Chunk } from "../../search/smart-chunker.js";
import { structuralRuntime, type StructuralRuntime } from "../../structural/structural-runtime.js";
import { LANGUAGE_MANIFEST } from "../../structural/language-manifest.js";
import { deriveLegacyLineRange } from "../../structural/source-span.js";
import type { NormalizedStructure, ParseDiagnostic } from "../../structural/types.js";
import type {
  EtlStageContext,
  DiscoveredFile,
  ParsedFile,
  RawSymbol,
  RawImport,
  RawEdge,
} from "../stage-context.js";

const BATCH_SIZE = 20;
const STRUCTURAL_EXTENSIONS = new Set(
  LANGUAGE_MANIFEST.map((entry) => entry.extension),
);

export class StructuralEtlParseError extends Error {
  constructor(
    readonly filePath: string,
    readonly failureKind: string,
    message: string,
    readonly diagnosticCount = 1,
    readonly diagnostics: readonly ParseDiagnostic[] = [],
  ) {
    super(message);
    this.name = "StructuralEtlParseError";
  }
}

function resolveChunkerMaxChars(): number | undefined {
  // Global override takes highest precedence
  const global = Number(process.env.EMBEDDING_MAX_CHARS);
  if (Number.isFinite(global) && global > 0) return Math.floor(global * 0.9);

  // Provider-specific override (OLLAMA_, VERCEL_, LITELLM_, CUSTOM_, GOOGLE_, MISTRAL_, …)
  const provider = (process.env.EMBEDDING_PROVIDER || "ollama").toUpperCase();
  const providerVal = Number(process.env[`${provider}_EMBEDDING_MAX_CHARS`]);
  if (Number.isFinite(providerVal) && providerVal > 0) return Math.floor(providerVal * 0.9);

  return undefined; // fall back to DEFAULT_CONFIG.maxChunkChars in smart-chunker
}

export class ParseStage {
  constructor(private readonly runtime: Pick<StructuralRuntime, "parse"> = structuralRuntime) {}

  async run(ctx: EtlStageContext, files: DiscoveredFile[]): Promise<ParsedFile[]> {
    const t0 = performance.now();

    ctx.emit({
      type: "stage_start",
      stage: "parse",
      payload: { total: files.length, toProcess: files.filter((f) => f.needsReparse).length },
      timestamp: Date.now(),
    });

    const results = new Map<string, ParsedFile>();
    let processed = 0;
    // Importers must be parsed before ambiguous `.h` files so header evidence
    // comes from native preprocessor captures, never source-text heuristics.
    const phases = [
      files.filter((file) => path.extname(file.relativePath).toLowerCase() !== ".h"),
      files.filter((file) => path.extname(file.relativePath).toLowerCase() === ".h"),
    ];
    const batches = phases.flatMap((phase) => Array.from(
      { length: Math.ceil(phase.length / BATCH_SIZE) },
      (_, index) => phase.slice(index * BATCH_SIZE, (index + 1) * BATCH_SIZE),
    ));

    for (const batch of batches) {
      if (ctx.abortSignal?.aborted) throw ctx.abortSignal.reason;
      const batchResults = await Promise.all(
        batch.map((file) => this.parseFile(ctx, file)),
      );
      for (const result of batchResults) results.set(result.file.relativePath, result);
      this.recordHeaderImporterEvidence(ctx, files, batchResults);
      processed += batch.length;

      ctx.emit({
        type: "progress",
        stage: "parse",
        payload: { current: processed, total: files.length, percentage: Math.round((processed / files.length) * 100) },
        timestamp: Date.now(),
      });
    }

    const durationMs = Math.round(performance.now() - t0);

    ctx.emit({
      type: "stage_end",
      stage: "parse",
      payload: {
        parsed: [...results.values()].filter((f) => f.file.needsReparse).length,
        totalSymbols: [...results.values()].reduce((s, f) => s + f.symbols.length, 0),
        totalChunks: [...results.values()].reduce((s, f) => s + f.chunks.length, 0),
        durationMs,
      },
      timestamp: Date.now(),
    });

    logger.info("ETL Parse complete", {
      projectId: ctx.projectId,
      parsed: [...results.values()].filter((f) => f.file.needsReparse).length,
      durationMs,
    });

    return files.map((file) => results.get(file.relativePath)!);
  }

  private recordHeaderImporterEvidence(
    ctx: EtlStageContext,
    files: readonly DiscoveredFile[],
    parsedFiles: readonly ParsedFile[],
  ): void {
    const knownHeaders = new Set(files.filter((file) => path.extname(file.relativePath).toLowerCase() === ".h")
      .map((file) => path.posix.normalize(file.relativePath)));
    const mutable: Record<string, { cImporters?: readonly string[]; cppImporters?: readonly string[]; buildLanguage?: "c" | "cpp" | "conflict" }> = {
      ...(ctx.structuralHeaderEvidenceByFile ?? {}),
    };
    for (const parsed of parsedFiles) {
      const extension = path.extname(parsed.file.relativePath).toLowerCase();
      const key = extension === ".c" ? "cImporters" : [".cpp", ".hpp"].includes(extension) ? "cppImporters" : undefined;
      if (!key) continue;
      for (const imported of parsed.rawImports) {
        if (!(["c_include", "cpp_include"] as const).includes(imported.form as "c_include" | "cpp_include") || imported.specifier.startsWith("<")) continue;
        const header = path.posix.normalize(path.posix.join(path.posix.dirname(parsed.file.relativePath), imported.specifier));
        if (!knownHeaders.has(header)) continue;
        const existing = mutable[header] ?? {};
        mutable[header] = { ...existing, [key]: Object.freeze([...new Set([...(existing[key] ?? []), parsed.file.relativePath])].sort()) };
      }
    }
    ctx.structuralHeaderEvidenceByFile = Object.freeze(Object.fromEntries(Object.entries(mutable).sort(([a], [b]) => a.localeCompare(b))));
  }

  private async parseFile(ctx: EtlStageContext, file: DiscoveredFile): Promise<ParsedFile> {
    if (!file.needsReparse) {
      const extension = path.extname(file.relativePath).toLowerCase();
      if ([".c", ".cpp", ".hpp"].includes(extension)) {
        const content = file.snapshotContent ?? await fs.readFile(file.absolutePath, "utf8");
        const outcome = await this.runtime.parse({ extension, source: Buffer.from(content) });
        if (outcome.status === "failed") throw new StructuralEtlParseError(
          file.relativePath, outcome.failureKind, `Structural evidence parse failed (${outcome.failureKind})`,
          outcome.diagnosticCount, outcome.diagnostics.slice(0, 10),
        );
        if (outcome.status === "ok" || outcome.status === "recovered") {
          const { rawImports } = this.projectStructuralResult(outcome.structure);
          // Evidence-only parse: retain imports for header selection while the
          // cached file remains excluded from semantic/graph output.
          return { file, chunks: [], symbols: [], rawImports, rawEdges: [] };
        }
      }
      // Fingerprint cache hit — pass through with empty collections
      return { file, chunks: [], symbols: [], rawImports: [], rawEdges: [] };
    }

    try {
      const content = file.snapshotContent ?? await fs.readFile(file.absolutePath, "utf-8");
      const ext = path.extname(file.relativePath).toLowerCase();

      const chunkerMaxChars = resolveChunkerMaxChars();
      const chunks = smartChunk(
        content,
        file.relativePath,
        chunkerMaxChars ? { maxChunkChars: chunkerMaxChars } : {},
      );
      let symbols: RawSymbol[];
      let rawImports: RawImport[];
      let rawEdges: RawEdge[];
      let structure: NormalizedStructure | undefined;
      let structuralDiagnostics;
      let structuralDiagnosticCount = 0;
      let structuralRecovered = false;
      if (STRUCTURAL_EXTENSIONS.has(ext)) {
        let outcome;
        try {
          outcome = await this.runtime.parse({
            extension: ext,
            source: Buffer.from(content),
            ...(ext === ".h" ? { headerEvidence: ctx.structuralHeaderEvidenceByFile?.[file.relativePath] } : {}),
          });
        } catch (error) {
          throw new StructuralEtlParseError(
            file.relativePath,
            "infrastructure",
            `Structural runtime threw: ${error instanceof Error ? error.message : String(error)}`,
            1,
            [],
          );
        }
        if (outcome.status === "failed") {
          throw new StructuralEtlParseError(
            file.relativePath,
            outcome.failureKind,
            `Structural parse failed (${outcome.failureKind}): ${outcome.diagnostics.map((item) => item.message).join("; ")}`,
            outcome.diagnosticCount,
            outcome.diagnostics.slice(0, 10),
          );
        }
        if (outcome.status === "unsupported") {
          throw new StructuralEtlParseError(file.relativePath, "infrastructure", `Structural runtime rejected supported extension ${ext}`);
        }
        structure = outcome.structure;
        structuralDiagnostics = outcome.diagnostics;
        structuralDiagnosticCount = outcome.diagnosticCount;
        structuralRecovered = outcome.status === "recovered";
        ({ symbols, rawImports, rawEdges } = this.projectStructuralResult(structure));
      } else {
        symbols = this.extractSymbols(content, ext);
        rawImports = this.extractImports(content, ext);
        rawEdges = [];
      }

      ctx.emit({
        type: "file_processed",
        stage: "parse",
        payload: {
          filePath: file.relativePath,
          symbols: symbols.length,
          chunks: chunks.length,
          imports: rawImports.length,
          edges: rawEdges.length,
          status: "ok",
        },
        timestamp: Date.now(),
      });

      return {
        file, chunks, symbols, rawImports, rawEdges,
        ...(structure ? { structure, structuralDiagnostics, structuralDiagnosticCount, structuralRecovered } : {}),
      };
    } catch (err) {
      ctx.emit({
        type: "file_error",
        stage: "parse",
        payload: { filePath: file.relativePath, error: (err as Error).message },
        timestamp: Date.now(),
      });
      logger.warn("ParseStage: failed to parse file", {
        filePath: file.relativePath,
        error: (err as Error).message,
      });
      // Native, query, ABI, and structural infrastructure failures invalidate
      // the whole build. Never convert them into an empty successful file.
      if (err instanceof StructuralEtlParseError) throw err;
      return { file, chunks: [], symbols: [], rawImports: [], rawEdges: [] };
    }
  }

  private projectStructuralResult(structure: NormalizedStructure): {
    symbols: RawSymbol[];
    rawImports: RawImport[];
    rawEdges: RawEdge[];
  } {
    const symbols = structure.symbols.map((symbol) => ({
      kind: symbol.kind,
      name: symbol.name,
      ...deriveLegacyLineRange(symbol.span),
      exported: symbol.exported,
      ...(symbol.documentation ? { docComment: symbol.documentation } : {}),
      span: symbol.span,
    }));
    const rawImports = structure.imports.map((item) => ({
      specifier: item.specifier,
      names: [...item.names],
      isTypeOnly: item.typeOnly,
      form: item.form,
      span: item.span,
      bindings: item.bindings,
    }));
    const rawEdges = structure.edges.filter((edge) => edge.kind !== "import").map((edge) => {
      const target = edge.target.status === "resolved"
        ? { symbolName: edge.target.fqn }
        : {
            symbolName: edge.target.name,
            ...(edge.target.qualifier ? { qualifier: edge.target.qualifier } : {}),
          };
      const owner = structure.symbols.filter((symbol) =>
        symbol.span.startByte <= edge.span.startByte && symbol.span.endByte >= edge.span.endByte
      ).sort((left, right) =>
        (left.span.endByte - left.span.startByte) - (right.span.endByte - right.span.startByte)
      )[0];
      return {
        kind: edge.kind,
        line: deriveLegacyLineRange(edge.span).lineStart,
        symbolName: target.symbolName,
        ...(owner ? { callerSymbol: owner.name } : {}),
        span: edge.span,
        meta: {
          ...(edge.metadata ?? {}),
          ...(edge.paramIndex !== undefined ? { paramIndex: edge.paramIndex } : {}),
          ...(target.qualifier ? { qualifier: target.qualifier } : {}),
          sourceSpan: edge.span,
        },
      } satisfies RawEdge;
    });
    return { symbols, rawImports, rawEdges };
  }

  // ─── Symbol extraction ─────────────────────────────────────────────────────

  private extractSymbols(content: string, ext: string): RawSymbol[] {
    switch (ext) {
      case ".py":
        return this.extractPySymbols(content);
      case ".dart":
        return this.extractDartSymbols(content);
      case ".kt":
      case ".kts":
        return this.extractKtSymbols(content);
      default:
        return [];
    }
  }

  private extractPySymbols(content: string): RawSymbol[] {
    const lines = content.split("\n");
    const symbols: RawSymbol[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const indent = line.length - trimmed.length;

      // Only top-level (indent 0) or class-level (indent 4)
      if (indent > 4) continue;

      const fnMatch = /^(?:async\s+)?def\s+(\w+)/.exec(trimmed);
      if (fnMatch) {
        const name = fnMatch[1];
        const exported = !name.startsWith("_");
        const lineEnd = this.findPyBlockEnd(lines, i);
        symbols.push({ kind: "function", name, lineStart: i + 1, lineEnd, exported });
        continue;
      }

      const clsMatch = /^class\s+(\w+)/.exec(trimmed);
      if (clsMatch) {
        const name = clsMatch[1];
        const lineEnd = this.findPyBlockEnd(lines, i);
        symbols.push({ kind: "class", name, lineStart: i + 1, lineEnd, exported: true });
      }
    }

    return symbols;
  }

  private extractDartSymbols(content: string): RawSymbol[] {
    const lines = content.split("\n");
    const symbols: RawSymbol[] = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimStart();

      const clsMatch = /^(?:abstract\s+)?class\s+(\w+)/.exec(line);
      if (clsMatch) {
        const lineEnd = this.findBlockEnd(lines, i);
        symbols.push({ kind: "class", name: clsMatch[1], lineStart: i + 1, lineEnd, exported: true });
        continue;
      }

      // Dart top-level functions: returnType name(...)
      const fnMatch = /^(?:\w+\s+)+(\w+)\s*\(/.exec(line);
      if (fnMatch && !line.includes("=") && !["if", "while", "for", "switch"].includes(fnMatch[1])) {
        const lineEnd = this.findBlockEnd(lines, i);
        symbols.push({ kind: "function", name: fnMatch[1], lineStart: i + 1, lineEnd, exported: true });
      }
    }

    return symbols;
  }

  /**
   * Kotlin symbol extractor.
   *
   * Covers standard Kotlin, Android, and KMP (expect/actual) declarations.
   * Uses regex + brace tracking like the JS extractor — no kotlin-compiler dependency.
   */
  private extractKtSymbols(content: string): RawSymbol[] {
    const lines = content.split("\n");
    const symbols: RawSymbol[] = [];

    // Visibility/annotation/modifier prefixes (optional, not captured).
    const modPrefix =
      /^(?:(?:public|private|protected|internal)\s+)?(?:expect\s+|actual\s+)?(?:abstract\s+|open\s+|data\s+|sealed\s+|inner\s+|enum\s+|companion\s+)?(?:suspend\s+|inline\s+|operator\s+|infix\s+|tailrec\s+|override\s+|external\s+)?/;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trimStart();

      // fun name(...) — covers suspend, inline, expect, actual, etc.
      const fnMatch = new RegExp(`^${modPrefix.source}fun\\s+(\\w+)\\s*[(<]`).exec(line);
      if (fnMatch && !["if", "when", "for", "while"].includes(fnMatch[1])) {
        const lineEnd = this.findBlockEnd(lines, i);
        symbols.push({
          kind: "function",
          name: fnMatch[1],
          lineStart: i + 1,
          lineEnd,
          exported: !line.startsWith("private"),
        });
        continue;
      }

      // class / data class / sealed class / abstract class / open class / enum class
      // Also: expect class / actual class (KMP)
      const clsMatch = new RegExp(
        `^${modPrefix.source}(?:class|enum\\s+class)\\s+(\\w+)`,
      ).exec(line);
      if (clsMatch) {
        const lineEnd = this.findBlockEnd(lines, i);
        symbols.push({
          kind: "class",
          name: clsMatch[1],
          lineStart: i + 1,
          lineEnd,
          exported: !line.startsWith("private"),
        });
        continue;
      }

      // interface Name
      const ifaceMatch = new RegExp(
        `^${modPrefix.source}interface\\s+(\\w+)`,
      ).exec(line);
      if (ifaceMatch) {
        const lineEnd = this.findBlockEnd(lines, i);
        symbols.push({
          kind: "interface",
          name: ifaceMatch[1],
          lineStart: i + 1,
          lineEnd,
          exported: !line.startsWith("private"),
        });
        continue;
      }

      // object Name (Kotlin singleton) — but NOT companion object (class-level only)
      const objMatch = /^(?:public\s+|private\s+|protected\s+|internal\s+)?object\s+(\w+)/.exec(line);
      if (objMatch && !line.includes("companion")) {
        symbols.push({
          kind: "class",
          name: objMatch[1],
          lineStart: i + 1,
          lineEnd: this.findBlockEnd(lines, i),
          exported: !line.startsWith("private"),
        });
        continue;
      }

      // Top-level val/var/const val (constants and properties)
      // Match: val/var/const val name (optionally with type annotation and =)
      const propMatch =
        /^(?:(?:public|private|protected|internal)\s+)?(?:expect\s+|actual\s+)?(?:const\s+)?(?:val|var)\s+(\w+)\s*(?::[^=]+)?\s*=/.exec(
          line,
        );
      if (propMatch && !line.includes("(")) {
        symbols.push({
          kind: "variable",
          name: propMatch[1],
          lineStart: i + 1,
          lineEnd: i + 1,
          exported: !line.startsWith("private"),
        });
        continue;
      }

      // typealias Name = ...
      const taMatch =
        /^(?:(?:public|private|protected|internal)\s+)?typealias\s+(\w+)\s*=/.exec(line);
      if (taMatch) {
        symbols.push({
          kind: "type",
          name: taMatch[1],
          lineStart: i + 1,
          lineEnd: i + 1,
          exported: !line.startsWith("private"),
        });
      }
    }

    return symbols;
  }

  // ─── Import extraction ────────────────────────────────────────────────────

  private extractImports(content: string, ext: string): RawImport[] {
    switch (ext) {
      case ".py":
        return this.extractPyImports(content);
      case ".kt":
      case ".kts":
        return this.extractKtImports(content);
      default:
        return [];
    }
  }

  private extractPyImports(content: string): RawImport[] {
    const imports: RawImport[] = [];

    // from module import A, B
    const fromRe = /^from\s+([\w.]+)\s+import\s+(.+)$/gm;
    let m: RegExpExecArray | null;
    while ((m = fromRe.exec(content)) !== null) {
      const names = m[2].split(",").map((n) => n.trim()).filter(Boolean);
      imports.push({ specifier: m[1].replace(/\./g, "/"), names, isTypeOnly: false });
    }

    // import module
    const importRe = /^import\s+([\w.,\s]+)$/gm;
    while ((m = importRe.exec(content)) !== null) {
      const names = m[1].split(",").map((n) => n.trim()).filter(Boolean);
      for (const n of names) {
        imports.push({ specifier: n.replace(/\./g, "/"), names: ["*"], isTypeOnly: false });
      }
    }

    return imports;
  }

  /**
   * Kotlin import extraction.
   *
   * Handles:
   *   import com.example.Foo          → specifier "com.example", names ["Foo"]
   *   import com.example.*            → specifier "com.example", names ["*"]
   *   import com.example.Foo as Bar   → specifier "com.example", names ["Bar"]
   */
  private extractKtImports(content: string): RawImport[] {
    const imports: RawImport[] = [];

    // import package.name.ClassName (with optional 'as Alias')
    // Also matches: import package.name.*
    const importRe = /^import\s+([\w.]+)\.(\*|\w+)(?:\s+as\s+(\w+))?/gm;
    let m: RegExpExecArray | null;
    while ((m = importRe.exec(content)) !== null) {
      const specifier = m[1];
      const rawName = m[2];
      const alias = m[3];
      const name = alias ?? rawName;
      imports.push({
        specifier,
        names: [name],
        isTypeOnly: false,
      });
    }

    return imports;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  /** Tracks brace depth to find the closing line of a JS/TS block. */
  private findBlockEnd(lines: string[], startLine: number): number {
    let depth = 0;
    let found = false;

    // Scan to EOF. The old 500-line ceiling silently collapsed a valid block
    // longer than 500 lines to its declaration line, which in turn prevented
    // typed-edge extraction from associating calls with the enclosing class.
    // This parser already visits every source line, and declarations are
    // sparse relative to file size, so correctness is preferable to an
    // arbitrary per-block cutoff.
    for (let i = startLine; i < lines.length; i++) {
      for (const ch of lines[i]) {
        if (ch === "{") { depth++; found = true; }
        if (ch === "}") { depth--; }
      }
      if (found && depth <= 0) return i + 1;
    }

    return startLine + 1;
  }

  /** Find end of a Python block by indentation. */
  private findPyBlockEnd(lines: string[], startLine: number): number {
    const baseIndent = lines[startLine].length - lines[startLine].trimStart().length;

    for (let i = startLine + 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.trim() === "") continue;
      const indent = line.length - line.trimStart().length;
      if (indent <= baseIndent) return i;
    }

    return lines.length;
  }

  /** Extract JSDoc/TSDoc comment lines immediately before the given line. */
  private extractDocComment(lines: string[], lineIndex: number): string | undefined {
    const commentLines: string[] = [];
    let i = lineIndex - 1;

    while (i >= 0) {
      const trimmed = lines[i].trim();
      if (trimmed.startsWith("*") || trimmed.startsWith("/**") || trimmed.startsWith("*/")) {
        commentLines.unshift(trimmed);
        i--;
      } else if (trimmed.startsWith("//")) {
        commentLines.unshift(trimmed.slice(2).trim());
        i--;
      } else {
        break;
      }
    }

    if (commentLines.length === 0) return undefined;
    return commentLines.join(" ").replace(/\/\*\*?|\*\//g, "").replace(/\s*\*\s*/g, " ").trim();
  }
}
