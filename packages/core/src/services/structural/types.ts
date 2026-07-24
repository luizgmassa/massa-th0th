/** Canonical transport taxonomy. Additive changes require a version bump. */
export {
  STRUCTURAL_SYMBOL_KINDS,
  type StructuralSymbolKind,
} from "@massa-ai/shared";
import type { StructuralSymbolKind } from "@massa-ai/shared";

/** Canonical structural edge taxonomy. Additive changes require a version bump. */
export const STRUCTURAL_EDGE_KINDS = [
  "call",
  "data_flow",
  "type_ref",
  "extend",
  "implement",
  "import",
  "http_call",
  "emit",
  "listen",
] as const;

export type StructuralEdgeKind = (typeof STRUCTURAL_EDGE_KINDS)[number];

export const STRUCTURAL_TAXONOMY_VERSION = "1.0.0";
export const SOURCE_SPAN_SCHEMA_VERSION = "1.0.0";
export const STRUCTURAL_FQN_SCHEMA_VERSION = "1.0.0";

/** Zero-based Tree-sitter coordinate. Columns and byte offsets are UTF-8 based. */
export interface SourcePoint {
  row: number;
  column: number;
}

/** End-exclusive source range. Offsets address the original UTF-8 source bytes. */
export interface SourceSpan {
  startByte: number;
  endByte: number;
  start: SourcePoint;
  end: SourcePoint;
}

export interface NormalizedStructuralSymbol {
  kind: StructuralSymbolKind;
  name: string;
  qualifiedName: string;
  span: SourceSpan;
  selectionSpan?: SourceSpan;
  exported: boolean;
  /** True only for the declaration selected by an `export default` wrapper. */
  defaultExport: boolean;
  documentation?: string;
  signature?: string;
  /** Syntax-owned inputs consumed by the FQN codec after native trees are deleted. */
  signatureMaterial: Readonly<{
    readonly arity: number;
    readonly typeTokens: readonly string[];
    readonly modifiers: readonly string[];
  }>;
}

export interface UnresolvedStructuralTarget {
  status: "unresolved";
  name: string;
  qualifier?: string;
}

export interface ResolvedStructuralTarget {
  status: "resolved";
  fqn: string;
}

export type StructuralTarget =
  | ResolvedStructuralTarget
  | UnresolvedStructuralTarget;

export interface NormalizedStructuralEdge {
  kind: StructuralEdgeKind;
  span: SourceSpan;
  sourceFqn?: string;
  target: StructuralTarget;
  paramIndex?: number;
  metadata?: Readonly<Record<string, unknown>>;
}

export interface NormalizedStructuralImport {
  form: "esm_import" | "esm_re_export" | "commonjs_require" | "dynamic_import" |
    "python_import" | "ruby_require" | "php_use" | "lua_require" |
    "c_include" | "cpp_include" | "go_import" | "rust_use" | "zig_import" |
    "java_import" | "java_static_import" | "kotlin_import" | "scala_import" | "csharp_using" | "swift_import" | "dart_import" |
    "elixir_alias" | "elixir_import" | "elixir_require" | "elixir_use" | "erlang_import" |
    "clojure_require" | "clojure_import" | "ocaml_open" | "ocaml_include" | "ocaml_module_alias" | "haskell_import";
  specifier: string;
  span: SourceSpan;
  bindings: readonly Readonly<{
    readonly imported: string;
    readonly local: string;
    readonly typeOnly: boolean;
    readonly arity?: number;
  }>[];
  /** Compatibility projection containing local binding names only. */
  names: readonly string[];
  typeOnly: boolean;
}

export interface NormalizedStructure {
  symbols: readonly NormalizedStructuralSymbol[];
  edges: readonly NormalizedStructuralEdge[];
  imports: readonly NormalizedStructuralImport[];
}

export const STRUCTURAL_CAPABILITIES = [
  "declarations",
  "documentation",
  "imports",
  "type_relations",
  "calls",
  "data_flow",
  "specialized_edges",
] as const;

export type StructuralCapability = (typeof STRUCTURAL_CAPABILITIES)[number];
export type StructuralCapabilityRequirement =
  | "required"
  | "forbidden"
  | "unsupported";
export type StructuralCapabilityTier = "structure" | "dependencies" | "flow";
export type MixedLanguagePolicy = "none" | "vue" | "markdown";

export interface GrammarArtifact {
  packageName: string;
  version: string;
  /** Named export, or `default` when the package requires ESM default interop. */
  exportName?: string;
}

export interface LanguageManifestEntry {
  extension: string;
  language: string;
  dialect: string;
  grammarArtifact: GrammarArtifact;
  queryPackVersion: string;
  resolverVersion: string;
  capabilityTier: StructuralCapabilityTier;
  capabilities: Readonly<
    Record<StructuralCapability, StructuralCapabilityRequirement>
  >;
  mixedLanguagePolicy: MixedLanguagePolicy;
  /** Alternate grammar used only when deterministic importer/build evidence selects it. */
  alternateGrammarArtifact?: GrammarArtifact;
}

export type ParseDiagnosticSeverity = "recovered" | "error";
export type StructuralFailureKind =
  | "grammar"
  | "query"
  | "abi"
  | "infrastructure";

export interface ParseDiagnostic {
  code: string;
  severity: ParseDiagnosticSeverity;
  message: string;
  span?: SourceSpan;
}

export type StructuralParseOutcome =
  | {
      status: "ok" | "recovered";
      structure: NormalizedStructure;
      diagnosticCount: number;
      diagnostics: readonly ParseDiagnostic[];
    }
  | {
      status: "unsupported";
      diagnosticCount: number;
      diagnostics: readonly ParseDiagnostic[];
    }
  | {
      status: "failed";
      failureKind: StructuralFailureKind;
      diagnosticCount: number;
      diagnostics: readonly ParseDiagnostic[];
    };

export interface SemanticOnlyStructuralLanguage {
  status: "semantic_only";
  extension: string;
  requiredForReadiness: false;
  diagnostic: ParseDiagnostic & { code: "unsupported_structural_language" };
}

export interface SupportedStructuralLanguage {
  status: "supported";
  requiredForReadiness: true;
  entry: LanguageManifestEntry;
}

export type StructuralLanguageResolution =
  | SupportedStructuralLanguage
  | SemanticOnlyStructuralLanguage;
