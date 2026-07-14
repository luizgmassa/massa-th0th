import { DEFAULT_ALLOWED_EXTENSIONS } from "@massa-th0th/shared/config";
import type {
  GrammarArtifact,
  LanguageManifestEntry,
  StructuralCapability,
  StructuralCapabilityRequirement,
  StructuralLanguageResolution,
} from "./types.js";
import {
  SOURCE_SPAN_SCHEMA_VERSION,
  STRUCTURAL_FQN_SCHEMA_VERSION,
  STRUCTURAL_TAXONOMY_VERSION,
} from "./types.js";

export const LANGUAGE_MANIFEST_VERSION = "1.0.0";
export const INITIAL_QUERY_PACK_VERSION = "1.0.0";
export const INITIAL_RESOLVER_VERSION = "1.0.0";
export const TREE_SITTER_RUNTIME_VERSION = "0.25.0";
export const TREE_SITTER_NATIVE_MODULE_ABI = 137;
export const STRUCTURAL_BUN_VERSION = "1.3.0";
export const TREE_SITTER_PATCH_SHA256 =
  "b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a";

const STRUCTURE_CAPABILITIES = Object.freeze({
  declarations: "required",
  documentation: "required",
  imports: "unsupported",
  type_relations: "unsupported",
  calls: "unsupported",
  data_flow: "unsupported",
  specialized_edges: "unsupported",
} satisfies Record<StructuralCapability, StructuralCapabilityRequirement>);

const FLOW_CAPABILITIES = Object.freeze({
  declarations: "required",
  documentation: "required",
  imports: "required",
  type_relations: "required",
  calls: "required",
  data_flow: "required",
  specialized_edges: "required",
} satisfies Record<StructuralCapability, StructuralCapabilityRequirement>);

function grammar(
  packageName: string,
  version: string,
  exportName?: string
): GrammarArtifact {
  return Object.freeze({
    packageName,
    version,
    ...(exportName ? { exportName } : {}),
  });
}

const G = Object.freeze({
  javascript: grammar("tree-sitter-javascript", "0.25.0"),
  typescript: grammar("tree-sitter-typescript", "0.23.2", "typescript"),
  tsx: grammar("tree-sitter-typescript", "0.23.2", "tsx"),
  html: grammar("tree-sitter-html", "0.23.2"),
  dart: grammar(
    "tree-sitter-dart",
    "github:UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934"
  ),
  python: grammar("tree-sitter-python", "0.25.0"),
  php: grammar("tree-sitter-php", "0.24.2", "php"),
  java: grammar("tree-sitter-java", "0.23.5"),
  go: grammar("tree-sitter-go", "0.25.0"),
  rust: grammar("tree-sitter-rust", "0.24.0"),
  cpp: grammar("tree-sitter-cpp", "0.23.4"),
  c: grammar("tree-sitter-c", "0.24.1"),
  markdown: grammar("@tree-sitter-grammars/tree-sitter-markdown", "0.3.2"),
  json: grammar("tree-sitter-json", "0.24.8"),
  yaml: grammar("@tree-sitter-grammars/tree-sitter-yaml", "0.7.1"),
  csharp: grammar("tree-sitter-c-sharp", "0.23.5", "default"),
  ruby: grammar("tree-sitter-ruby", "0.23.1"),
  swift: grammar("tree-sitter-swift", "0.7.1"),
  kotlin: grammar("@tree-sitter-grammars/tree-sitter-kotlin", "1.1.0"),
  scala: grammar("tree-sitter-scala", "0.24.0"),
  lua: grammar("@tree-sitter-grammars/tree-sitter-lua", "0.4.1", "default"),
  zig: grammar("@tree-sitter-grammars/tree-sitter-zig", "1.1.2"),
  elixir: grammar("tree-sitter-elixir", "0.3.5"),
  erlang: grammar(
    "tree-sitter-erlang",
    "github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870"
  ),
  clojure: grammar("tree-sitter-clojure-orchard", "0.2.5"),
  ocaml: grammar("tree-sitter-ocaml", "0.24.2", "ocaml"),
  haskell: grammar("tree-sitter-haskell", "0.23.1"),
});

type EntryOptions = Omit<
  LanguageManifestEntry,
  "extension" | "queryPackVersion" | "resolverVersion" | "capabilities"
>;

function entry(
  extension: string,
  options: EntryOptions
): LanguageManifestEntry {
  const capabilities =
    options.capabilityTier === "structure"
      ? STRUCTURE_CAPABILITIES
      : FLOW_CAPABILITIES;
  return Object.freeze({
    extension,
    ...options,
    queryPackVersion: INITIAL_QUERY_PACK_VERSION,
    resolverVersion: INITIAL_RESOLVER_VERSION,
    capabilities,
  });
}

/** Ordered exactly like DEFAULT_ALLOWED_EXTENSIONS; each extension has one entry. */
export const LANGUAGE_MANIFEST: readonly LanguageManifestEntry[] =
  Object.freeze([
    entry(".ts", {
      language: "TypeScript",
      dialect: "typescript",
      grammarArtifact: G.typescript,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".js", {
      language: "JavaScript",
      dialect: "javascript",
      grammarArtifact: G.javascript,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".tsx", {
      language: "TypeScript",
      dialect: "tsx",
      grammarArtifact: G.tsx,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".jsx", {
      language: "JavaScript",
      dialect: "jsx",
      grammarArtifact: G.javascript,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".vue", {
      language: "Vue",
      dialect: "sfc",
      grammarArtifact: G.html,
      capabilityTier: "flow",
      mixedLanguagePolicy: "vue",
    }),
    entry(".dart", {
      language: "Dart",
      dialect: "dart",
      grammarArtifact: G.dart,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".py", {
      language: "Python",
      dialect: "python",
      grammarArtifact: G.python,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".php", {
      language: "PHP",
      dialect: "php",
      grammarArtifact: G.php,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".java", {
      language: "Java",
      dialect: "java",
      grammarArtifact: G.java,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".go", {
      language: "Go",
      dialect: "go",
      grammarArtifact: G.go,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".rs", {
      language: "Rust",
      dialect: "rust",
      grammarArtifact: G.rust,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".cpp", {
      language: "C++",
      dialect: "cpp",
      grammarArtifact: G.cpp,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".c", {
      language: "C",
      dialect: "c",
      grammarArtifact: G.c,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".h", {
      language: "C",
      dialect: "header-default-c",
      grammarArtifact: G.c,
      alternateGrammarArtifact: G.cpp,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".md", {
      language: "Markdown",
      dialect: "commonmark-gfm",
      grammarArtifact: G.markdown,
      capabilityTier: "structure",
      mixedLanguagePolicy: "markdown",
    }),
    entry(".json", {
      language: "JSON",
      dialect: "json",
      grammarArtifact: G.json,
      capabilityTier: "structure",
      mixedLanguagePolicy: "none",
    }),
    entry(".yaml", {
      language: "YAML",
      dialect: "yaml",
      grammarArtifact: G.yaml,
      capabilityTier: "structure",
      mixedLanguagePolicy: "none",
    }),
    entry(".yml", {
      language: "YAML",
      dialect: "yaml",
      grammarArtifact: G.yaml,
      capabilityTier: "structure",
      mixedLanguagePolicy: "none",
    }),
    entry(".hpp", {
      language: "C++",
      dialect: "header",
      grammarArtifact: G.cpp,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".cs", {
      language: "C#",
      dialect: "csharp",
      grammarArtifact: G.csharp,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".rb", {
      language: "Ruby",
      dialect: "ruby",
      grammarArtifact: G.ruby,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".swift", {
      language: "Swift",
      dialect: "swift",
      grammarArtifact: G.swift,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".kt", {
      language: "Kotlin",
      dialect: "kotlin",
      grammarArtifact: G.kotlin,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".kts", {
      language: "Kotlin",
      dialect: "kotlin-script",
      grammarArtifact: G.kotlin,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".scala", {
      language: "Scala",
      dialect: "scala",
      grammarArtifact: G.scala,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".lua", {
      language: "Lua",
      dialect: "lua-luajit",
      grammarArtifact: G.lua,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".zig", {
      language: "Zig",
      dialect: "zig",
      grammarArtifact: G.zig,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".ex", {
      language: "Elixir",
      dialect: "elixir",
      grammarArtifact: G.elixir,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".exs", {
      language: "Elixir",
      dialect: "elixir-script",
      grammarArtifact: G.elixir,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".erl", {
      language: "Erlang",
      dialect: "erlang",
      grammarArtifact: G.erlang,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".clj", {
      language: "Clojure",
      dialect: "clojure",
      grammarArtifact: G.clojure,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".ml", {
      language: "OCaml",
      dialect: "ocaml",
      grammarArtifact: G.ocaml,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
    entry(".hs", {
      language: "Haskell",
      dialect: "haskell",
      grammarArtifact: G.haskell,
      capabilityTier: "flow",
      mixedLanguagePolicy: "none",
    }),
  ]);

const MANIFEST_BY_EXTENSION = new Map(
  LANGUAGE_MANIFEST.map((item) => [item.extension, item])
);

export interface ManifestExhaustivenessReport {
  expectedCount: number;
  actualCount: number;
  missing: readonly string[];
  extra: readonly string[];
  duplicates: readonly string[];
  ordered: boolean;
  exhaustive: boolean;
}

export function inspectLanguageManifest(
  expected: readonly string[] = DEFAULT_ALLOWED_EXTENSIONS
): ManifestExhaustivenessReport {
  const actual = LANGUAGE_MANIFEST.map((item) => item.extension);
  const counts = new Map<string, number>();
  for (const extension of actual)
    counts.set(extension, (counts.get(extension) ?? 0) + 1);
  const duplicates = [...counts]
    .filter(([, count]) => count > 1)
    .map(([extension]) => extension)
    .sort();
  const expectedSet = new Set(expected);
  const actualSet = new Set(actual);
  const missing = expected.filter((extension) => !actualSet.has(extension));
  const extra = actual.filter((extension) => !expectedSet.has(extension));
  const ordered =
    actual.length === expected.length &&
    actual.every((extension, index) => extension === expected[index]);
  return Object.freeze({
    expectedCount: new Set(expected).size,
    actualCount: actual.length,
    missing: Object.freeze(missing),
    extra: Object.freeze(extra),
    duplicates: Object.freeze(duplicates),
    ordered,
    exhaustive:
      missing.length === 0 &&
      extra.length === 0 &&
      duplicates.length === 0 &&
      ordered,
  });
}

export function assertLanguageManifestExhaustive(
  expected: readonly string[] = DEFAULT_ALLOWED_EXTENSIONS
): void {
  const report = inspectLanguageManifest(expected);
  if (!report.exhaustive) {
    throw new Error(
      `structural language manifest is not exhaustive: ${JSON.stringify(
        report
      )}`
    );
  }
}

export function getLanguageManifestEntry(
  extension: string
): LanguageManifestEntry | undefined {
  return MANIFEST_BY_EXTENSION.get(extension.toLowerCase());
}

export function resolveStructuralLanguage(
  extension: string
): StructuralLanguageResolution {
  const normalized = extension.toLowerCase();
  const found = getLanguageManifestEntry(normalized);
  if (found)
    return { status: "supported", requiredForReadiness: true, entry: found };
  return {
    status: "semantic_only",
    extension: normalized,
    requiredForReadiness: false,
    diagnostic: {
      code: "unsupported_structural_language",
      severity: "recovered",
      message: `No structural parser is registered for ${normalized}; semantic indexing remains enabled.`,
    },
  };
}

export interface HeaderLanguageEvidence {
  readonly cImporters?: readonly string[];
  readonly cppImporters?: readonly string[];
  readonly buildLanguage?: "c" | "cpp" | "conflict";
}

/** `.h` is C unless one unambiguous importer/build signal positively proves C++. */
export function resolveStructuralParseLanguage(
  extension: string,
  evidence?: HeaderLanguageEvidence,
): StructuralLanguageResolution {
  const resolution = resolveStructuralLanguage(extension);
  if (resolution.status !== "supported" || resolution.entry.extension !== ".h") return resolution;
  const provesC = (evidence?.cImporters?.length ?? 0) > 0 || evidence?.buildLanguage === "c" || evidence?.buildLanguage === "conflict";
  const provesCpp = (evidence?.cppImporters?.length ?? 0) > 0 || evidence?.buildLanguage === "cpp" || evidence?.buildLanguage === "conflict";
  if (!provesCpp || provesC || !resolution.entry.alternateGrammarArtifact) return resolution;
  return {
    ...resolution,
    entry: Object.freeze({
      ...resolution.entry,
      language: "C++",
      dialect: "header-cpp",
      grammarArtifact: resolution.entry.alternateGrammarArtifact,
    }),
  };
}

/** Stable, serializable inputs. T10 owns the final structural fingerprint hash. */
export const STRUCTURAL_FINGERPRINT_INPUTS = Object.freeze({
  manifestVersion: LANGUAGE_MANIFEST_VERSION,
  runtime: Object.freeze({
    packageName: "tree-sitter",
    version: TREE_SITTER_RUNTIME_VERSION,
    bunVersion: STRUCTURAL_BUN_VERSION,
    nativeModuleAbi: TREE_SITTER_NATIVE_MODULE_ABI,
    patchSha256: TREE_SITTER_PATCH_SHA256,
  }),
  schemas: Object.freeze({
    taxonomy: STRUCTURAL_TAXONOMY_VERSION,
    sourceSpan: SOURCE_SPAN_SCHEMA_VERSION,
    fqn: STRUCTURAL_FQN_SCHEMA_VERSION,
  }),
  languages: Object.freeze(
    LANGUAGE_MANIFEST.map((item) =>
      Object.freeze({
        extension: item.extension,
        language: item.language,
        dialect: item.dialect,
        grammarArtifact: item.grammarArtifact,
        alternateGrammarArtifact: item.alternateGrammarArtifact,
        queryPackVersion: item.queryPackVersion,
        resolverVersion: item.resolverVersion,
        capabilityTier: item.capabilityTier,
        capabilities: item.capabilities,
        mixedLanguagePolicy: item.mixedLanguagePolicy,
      })
    )
  ),
});

assertLanguageManifestExhaustive();
