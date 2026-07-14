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

export interface StructuralQueryContext {
  /** Every cursor created here is owned and deleted by the runtime. */
  createCursor(node?: StructuralSyntaxNode): NativeTreeCursor;
  /** Compile once per grammar/query source and execute against a node. */
  query(source: string, node?: StructuralSyntaxNode): readonly NativeQueryCapture[];
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
      const structure = await queryExecutor(
        parsedTree,
        request.source,
        resolution.entry,
        {
          createCursor(node = parsedTree.rootNode) {
            const nativeNode = node as StructuralSyntaxNode & { walk?: () => NativeTreeCursor };
            if (typeof nativeNode.walk !== "function") {
              throw new Error("Native syntax node does not expose walk()");
            }
            const cursor = nativeNode.walk();
            cursors.push(cursor);
            return cursor;
          },
          query(querySource, node = parsedTree.rootNode) {
            return executeBoundedNativeQuery(compiledQuery(loaded, grammar, querySource),
              node as Parameters<NativeQueryInstance["matches"]>[0],
            );
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
    return {
      ...result,
      diagnosticCount: details.length,
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
