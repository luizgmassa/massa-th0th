import {
  grammarArtifactKey,
  type LoadedNativeGrammarSet,
  type NativeTree,
  type NativeTreeCursor,
  type NativeQueryCapture,
  type NativeQueryInstance,
} from "./grammar-loaders.js";
import {
  resolveStructuralParseLanguage,
  type HeaderLanguageEvidence,
} from "./language-manifest.js";
import {
  getValidatedNativeGrammarSet,
  validateAllGrammars,
} from "./parser-readiness.js";
import {
  ParserAcquireTimeoutError,
  StructuralParserPool,
  type ParserLease,
  type ParserPoolOptions,
} from "./parser-pool.js";
import {
  boundDiagnostics,
  classifyNativeFailure,
  diagnostic,
} from "./diagnostics.js";
import type {
  LanguageManifestEntry,
  NormalizedStructure,
  ParseDiagnostic,
  StructuralFailureKind,
  StructuralParseOutcome,
} from "./types.js";
import { executeStructuralQueryPack } from "./query-pack.js";
import { SourceIndex } from "./source-span.js";

export interface StructuralQueryContext {
  /** Every cursor created here is owned and deleted by the runtime. */
  createCursor(node?: StructuralSyntaxNode): NativeTreeCursor;
  /** Compile once per grammar/query source and execute against a node. */
  query(source: string, node?: StructuralSyntaxNode): readonly NativeQueryCapture[];
  /** Queue an exact host byte slice for parsing after native host resources are released. */
  collectEmbeddedSlice(slice: StructuralEmbeddedSlice): void;
}

export interface StructuralEmbeddedSlice {
  readonly extension: string;
  readonly startByte: number;
  readonly endByte: number;
  readonly scope: string;
}

/** Cursor creation is intentionally absent; use StructuralQueryContext. */
export interface StructuralSyntaxNode {
  readonly type: string;
  readonly hasError: boolean;
  readonly endIndex: number;
  readonly startIndex?: number;
  readonly namedChildren?: readonly StructuralSyntaxNode[];
  readonly children?: readonly StructuralSyntaxNode[];
  readonly parent?: StructuralSyntaxNode | null;
  childForFieldName?(fieldName: string): StructuralSyntaxNode | null;
}

export interface StructuralQueryTree {
  readonly rootNode: StructuralSyntaxNode;
}

export type StructuralQueryExecutor = (
  tree: StructuralQueryTree,
  source: Buffer,
  language: LanguageManifestEntry,
  context: StructuralQueryContext,
) => NormalizedStructure | Promise<NormalizedStructure>;

export interface StructuralParseRequest {
  extension: string;
  source: Buffer;
  queryExecutor?: StructuralQueryExecutor;
  headerEvidence?: HeaderLanguageEvidence;
}

export interface StructuralRuntimeOptions {
  parserPool?: StructuralParserPool;
  grammarSet?: () => LoadedNativeGrammarSet | Promise<LoadedNativeGrammarSet>;
  queryExecutor?: StructuralQueryExecutor;
  pool?: Omit<ParserPoolOptions, "createParser">;
}

let processParserPool: StructuralParserPool | null = null;
let processParserConstructor: LoadedNativeGrammarSet["Parser"] | null = null;
const queryCaches = new WeakMap<object, WeakMap<object, Map<string, NativeQueryInstance>>>();
export const STRUCTURAL_QUERY_MATCH_LIMIT = 4_096;

function byteNodeAdapter(source: Buffer) {
  const decoded = source.toString("utf8");
  // Build the utf16->byte offset table in ONE pass instead of lazily resolving
  // each distinct node offset via Buffer.byteLength(decoded.slice(0, n), "utf8"),
  // which re-scans and re-allocates the prefix string on every cache miss.
  // Every wrapped node's startIndex/endIndex reads through this table, so the
  // lazy path was O(distinct-offsets * offset) and allocated a transient prefix
  // string per miss. The table matches Buffer.byteLength exactly: a high
  // surrogate followed by a low surrogate encodes to 4 bytes; a lone surrogate
  // or any BMP code point above 0x7ff encodes to 2-3 bytes (Node replaces lone
  // surrogates with U+FFFD, also 3 bytes).
  const table = new Int32Array(decoded.length + 1);
  let bytes = 0;
  for (let i = 0; i < decoded.length; i += 1) {
    const unit = decoded.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = decoded.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
        table[i + 1] = bytes;
        continue;
      }
      bytes += 3;
    } else {
      bytes += unit < 0x80 ? 1 : unit < 0x800 ? 2 : 3;
    }
    table[i + 1] = bytes;
  }
  table[decoded.length] = source.length;
  const nativeToWrapped = new WeakMap<object, StructuralSyntaxNode>();
  const wrappedToNative = new WeakMap<object, StructuralSyntaxNode>();
  const byteOffset = (utf16Offset: number): number => table[utf16Offset];
  const wrap = (native: StructuralSyntaxNode): StructuralSyntaxNode => {
    const key = native as object;
    const cached = nativeToWrapped.get(key);
    if (cached) return cached;
    const wrapped: StructuralSyntaxNode = {
      get type() { return native.type; },
      get hasError() { return native.hasError; },
      get startIndex() { return byteOffset(native.startIndex ?? 0); },
      get endIndex() { return byteOffset(native.endIndex); },
      get namedChildren() { return native.namedChildren?.map(wrap); },
      get children() { return native.children?.map(wrap); },
      get parent() { return native.parent ? wrap(native.parent) : native.parent; },
      childForFieldName(name) {
        const child = native.childForFieldName?.(name);
        return child ? wrap(child) : null;
      },
    };
    nativeToWrapped.set(key, wrapped);
    wrappedToNative.set(wrapped as object, native);
    return wrapped;
  };
  return {
    wrap,
    unwrap(node: StructuralSyntaxNode): StructuralSyntaxNode {
      return wrappedToNative.get(node as object) ?? node;
    },
  };
}

export function executeBoundedNativeQuery(
  query: NativeQueryInstance,
  node: Parameters<NativeQueryInstance["matches"]>[0],
): readonly NativeQueryCapture[] {
  const matches = query.matches(node, { matchLimit: STRUCTURAL_QUERY_MATCH_LIMIT });
  if (query.didExceedMatchLimit()) {
    throw new Error(`structural_query_match_limit_exceeded:${STRUCTURAL_QUERY_MATCH_LIMIT}`);
  }
  return Object.freeze(matches.flatMap((match) => match.captures));
}

function compiledQuery(
  loaded: LoadedNativeGrammarSet,
  grammar: unknown,
  source: string,
): NativeQueryInstance {
  if ((typeof grammar !== "object" || grammar === null) && typeof grammar !== "function") {
    throw new Error("Validated grammar cannot own a compiled query cache");
  }
  const owner = grammar as object;
  const Query = loaded.Parser.Query;
  if (!Query) throw new Error("structural_query_executor_unavailable");
  let constructorCaches = queryCaches.get(owner);
  if (!constructorCaches) {
    constructorCaches = new WeakMap();
    queryCaches.set(owner, constructorCaches);
  }
  let cache = constructorCaches.get(Query as object);
  if (!cache) {
    cache = new Map();
    constructorCaches.set(Query as object, cache);
  }
  let query = cache.get(source);
  if (!query) {
    query = new Query(grammar, source);
    cache.set(source, query);
  }
  return query;
}

function processPoolFor(loaded: LoadedNativeGrammarSet): StructuralParserPool {
  if (!processParserPool) {
    processParserConstructor = loaded.Parser;
    processParserPool = new StructuralParserPool({
      createParser: () => new loaded.Parser(),
    });
  } else if (processParserConstructor !== loaded.Parser) {
    throw new Error("Validated native parser constructor changed after process pool creation");
  }
  return processParserPool;
}

async function startupGrammarSet(): Promise<LoadedNativeGrammarSet> {
  await validateAllGrammars();
  return getValidatedNativeGrammarSet();
}

function parserKey(entry: LanguageManifestEntry): string {
  return `${entry.language}:${entry.dialect}`;
}

function failed(
  failureKind: StructuralFailureKind,
  diagnostics: readonly ParseDiagnostic[],
): StructuralParseOutcome {
  return {
    status: "failed",
    failureKind,
    diagnosticCount: diagnostics.length,
    diagnostics: boundDiagnostics(diagnostics),
  };
}

/** Owns parser leases and all native tree/cursor lifetime for one parse. */
export class StructuralRuntime {
  readonly #configuredPool?: StructuralParserPool;
  readonly #poolOptions: Omit<ParserPoolOptions, "createParser">;
  readonly #grammarSet: () => LoadedNativeGrammarSet | Promise<LoadedNativeGrammarSet>;
  readonly #queryExecutor: StructuralQueryExecutor;
  readonly #usesProcessPool: boolean;
  #defaultPool: StructuralParserPool | null = null;
  #poolParserConstructor: LoadedNativeGrammarSet["Parser"] | null = null;

  constructor(options: StructuralRuntimeOptions = {}) {
    this.#configuredPool = options.parserPool;
    this.#poolOptions = options.pool ?? {};
    this.#grammarSet = options.grammarSet ?? startupGrammarSet;
    this.#queryExecutor = options.queryExecutor ?? executeStructuralQueryPack;
    this.#usesProcessPool =
      options.parserPool === undefined &&
      options.grammarSet === undefined &&
      options.pool === undefined;
  }

  async parse(request: StructuralParseRequest): Promise<StructuralParseOutcome> {
    return this.#parse(request, 0);
  }

  async #parse(request: StructuralParseRequest, depth: number): Promise<StructuralParseOutcome> {
    if (!Buffer.isBuffer(request.source)) {
      return failed("infrastructure", [
        diagnostic("invalid_structural_source", "error", "Structural source must be a Buffer"),
      ]);
    }

    const resolution = resolveStructuralParseLanguage(request.extension, request.headerEvidence);
    if (resolution.status === "semantic_only") {
      return {
        status: "unsupported",
        diagnosticCount: 1,
        diagnostics: Object.freeze([resolution.diagnostic]),
      };
    }

    const details: ParseDiagnostic[] = [];
    const cursors: NativeTreeCursor[] = [];
    const embeddedSlices: StructuralEmbeddedSlice[] = [];
    let lease: ParserLease | undefined;
    let tree: NativeTree | undefined;
    let result: StructuralParseOutcome | undefined;
    let stage: "readiness" | "grammar" | "acquire" | "parse" | "query" = "readiness";

    try {
      const loaded = await this.#grammarSet();
      stage = "grammar";
      const grammar = loaded.grammars.get(
        grammarArtifactKey(resolution.entry.grammarArtifact),
      );
      if (!grammar) {
        throw new Error(
          `Validated grammar set lacks ${grammarArtifactKey(resolution.entry.grammarArtifact)}`,
        );
      }

      stage = "acquire";
      const pool = this.#poolFor(loaded);
      lease = await pool.acquire(parserKey(resolution.entry), grammar);

      stage = "parse";
      const parsedTree = lease.parse(request.source);
      tree = parsedTree;
      const recovered = parsedTree.rootNode.hasError;
      if (recovered) {
        details.push(
          diagnostic(
            "recovered_syntax_error",
            "recovered",
            `Tree-sitter recovered while parsing ${request.extension}`,
          ),
        );
      }

      stage = "query";
      const queryExecutor = request.queryExecutor ?? this.#queryExecutor;
      const byteNodes = byteNodeAdapter(request.source);
      const queryTree = { rootNode: byteNodes.wrap(parsedTree.rootNode as StructuralSyntaxNode) };
      const structure = await queryExecutor(
        queryTree,
        request.source,
        resolution.entry,
        {
          createCursor(node = queryTree.rootNode) {
            const nativeNode = byteNodes.unwrap(node) as StructuralSyntaxNode & { walk?: () => NativeTreeCursor };
            if (typeof nativeNode.walk !== "function") {
              throw new Error("Native syntax node does not expose walk()");
            }
            const cursor = nativeNode.walk();
            cursors.push(cursor);
            return cursor;
          },
          query(querySource, node = queryTree.rootNode) {
            return executeBoundedNativeQuery(compiledQuery(loaded, grammar, querySource),
              byteNodes.unwrap(node) as Parameters<NativeQueryInstance["matches"]>[0],
            ).map((capture) => Object.freeze({ ...capture, node: byteNodes.wrap(capture.node as unknown as StructuralSyntaxNode) as NativeQueryCapture["node"] }));
          },
          collectEmbeddedSlice(slice) {
            const index = new SourceIndex(request.source);
            index.span(slice.startByte, slice.endByte);
            embeddedSlices.push(Object.freeze({ ...slice }));
          },
        },
      );
      result = {
        status: recovered ? "recovered" : "ok",
        structure,
        diagnosticCount: details.length,
        diagnostics: boundDiagnostics(details),
      };
    } catch (error) {
      const timeout = error instanceof ParserAcquireTimeoutError;
      const failureKind: StructuralFailureKind =
        stage === "query"
          ? "query"
          : timeout
            ? "infrastructure"
            : classifyNativeFailure(error);
      details.push(
        diagnostic(
          timeout
            ? "parser_acquire_timeout"
            : stage === "query"
              ? error instanceof Error && error.message === "structural_query_executor_unavailable"
                ? "structural_query_executor_unavailable"
                : "structural_query_failed"
              : stage === "readiness"
                ? "parser_not_ready"
                : "native_parse_failed",
          "error",
          error,
        ),
      );
      result = failed(failureKind, details);
    } finally {
      // Native cursors retain their tree. Delete all cursors before the tree,
      // then release the parser only after native cleanup has completed.
      for (let index = cursors.length - 1; index >= 0; index -= 1) {
        try {
          cursors[index]!.delete();
        } catch (error) {
          details.push(diagnostic("cursor_cleanup_failed", "error", error));
        }
      }
      if (tree) {
        try {
          tree.delete();
        } catch (error) {
          details.push(diagnostic("tree_cleanup_failed", "error", error));
        }
      }
      if (lease) {
        try {
          lease.release();
        } catch (error) {
          details.push(diagnostic("parser_release_failed", "error", error));
        }
      }
    }

    const cleanupFailed = details.some((item) => item.code.endsWith("_cleanup_failed") || item.code === "parser_release_failed");
    if (cleanupFailed && result?.status !== "failed") {
      return failed("infrastructure", details);
    }
    if (result?.status === "failed") {
      return failed(result.failureKind, details);
    }
    if (!result) {
      return failed("infrastructure", [
        ...details,
        diagnostic("structural_runtime_no_outcome", "error", "Structural runtime produced no outcome"),
      ]);
    }
    let finalResult: StructuralParseOutcome = {
      ...result,
      diagnosticCount: details.length,
      diagnostics: boundDiagnostics(details),
    };
    if ((finalResult.status === "ok" || finalResult.status === "recovered") && embeddedSlices.length > 0) {
      finalResult = await this.#mergeEmbedded(finalResult, request.source, embeddedSlices, depth);
    }
    return finalResult;
  }

  async #mergeEmbedded(
    host: Extract<StructuralParseOutcome, { status: "ok" | "recovered" }>,
    source: Buffer,
    slices: readonly StructuralEmbeddedSlice[],
    depth: number,
  ): Promise<StructuralParseOutcome> {
    const index = new SourceIndex(source);
    const symbols = [...host.structure.symbols];
    const edges = [...host.structure.edges];
    const imports = [...host.structure.imports];
    const details = [...host.diagnostics];
    let total = host.diagnosticCount;
    const locatedDiagnostic = (code: string, severity: ParseDiagnostic["severity"], message: string, slice: StructuralEmbeddedSlice): ParseDiagnostic =>
      Object.freeze({ ...diagnostic(code, severity, message), span: index.span(slice.startByte, slice.endByte) });
    for (const slice of slices) {
      if (depth >= 2) {
        total += 1;
        details.push(locatedDiagnostic("embedded_recursion_limit", "recovered", `Embedded scope ${slice.scope} exceeds depth 2`, slice));
        continue;
      }
      const childSource = source.subarray(slice.startByte, slice.endByte);
      const child = await this.#parse({ extension: slice.extension, source: childSource }, depth + 1);
      if (child.status === "unsupported") {
        total += 1;
        details.push(locatedDiagnostic("unsupported_structural_language", "recovered", `Embedded scope ${slice.scope} uses unsupported language ${slice.extension}`, slice));
        continue;
      }
      total += child.diagnosticCount;
      details.push(...child.diagnostics.map((item) => item.span ? Object.freeze({ ...item, span: index.remapChildSpan(index.span(slice.startByte, slice.endByte), item.span) }) : item));
      if (child.status === "failed") {
        total += 1;
        details.push(locatedDiagnostic("embedded_parse_failed", "error", `Embedded scope ${slice.scope} failed structurally`, slice));
        return {
          status: "failed",
          failureKind: child.failureKind,
          diagnosticCount: total,
          diagnostics: boundDiagnostics(details),
        };
      }
      const hostSlice = index.span(slice.startByte, slice.endByte);
      const remap = <T extends { span: import("./types.js").SourceSpan }>(value: T): T => Object.freeze({ ...value, span: index.remapChildSpan(hostSlice, value.span) });
      symbols.push(...child.structure.symbols.map((symbol) => Object.freeze({
        ...remap(symbol), qualifiedName: `${slice.scope}.${symbol.qualifiedName}`,
        ...(symbol.selectionSpan ? { selectionSpan: index.remapChildSpan(hostSlice, symbol.selectionSpan) } : {}),
      })));
      edges.push(...child.structure.edges.map(remap));
      imports.push(...child.structure.imports.map(remap));
    }
    const dedupe = <T>(values: readonly T[], key: (value: T) => string) => Object.freeze(values.filter((value, offset) => values.findIndex((candidate) => key(candidate) === key(value)) === offset));
    return {
      status: host.status === "recovered" || total > 0 ? "recovered" : "ok",
      structure: Object.freeze({
        symbols: dedupe(symbols, (s) => `${s.kind}\0${s.qualifiedName}\0${s.span.startByte}\0${s.span.endByte}`),
        edges: dedupe(edges, (e) => `${e.kind}\0${e.span.startByte}\0${e.span.endByte}\0${JSON.stringify(e.target)}`),
        imports: dedupe(imports, (i) => `${i.form}\0${i.specifier}\0${i.span.startByte}\0${i.span.endByte}`),
      }),
      diagnosticCount: total,
      diagnostics: boundDiagnostics(details),
    };
  }

  #poolFor(loaded: LoadedNativeGrammarSet): StructuralParserPool {
    if (this.#configuredPool) return this.#configuredPool;
    if (this.#usesProcessPool) return processPoolFor(loaded);
    if (!this.#defaultPool) {
      this.#poolParserConstructor = loaded.Parser;
      this.#defaultPool = new StructuralParserPool({
        ...this.#poolOptions,
        createParser: () => new loaded.Parser(),
      });
    } else if (this.#poolParserConstructor !== loaded.Parser) {
      throw new Error("Validated native parser constructor changed after pool creation");
    }
    return this.#defaultPool;
  }
}

export const structuralRuntime = new StructuralRuntime();
