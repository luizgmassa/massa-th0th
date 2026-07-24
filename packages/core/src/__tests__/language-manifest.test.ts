import { describe, expect, test } from "bun:test";
import { DEFAULT_ALLOWED_EXTENSIONS } from "@massa-ai/shared/config";
import {
  getLanguageManifestEntry,
  inspectLanguageManifest,
  LANGUAGE_MANIFEST,
  resolveStructuralLanguage,
  STRUCTURAL_FINGERPRINT_INPUTS,
} from "../services/structural/language-manifest.js";
import {
  STRUCTURAL_CAPABILITIES,
  STRUCTURAL_EDGE_KINDS,
  STRUCTURAL_SYMBOL_KINDS,
  type NormalizedStructuralEdge,
} from "../services/structural/types.js";

const DATA_FLOW_EDGE_FIXTURE = {
  kind: "data_flow",
  span: {
    startByte: 0,
    endByte: 5,
    start: { row: 0, column: 0 },
    end: { row: 0, column: 5 },
  },
  target: { status: "unresolved", name: "value" },
  paramIndex: 1,
} satisfies NormalizedStructuralEdge;

const EXPECTED_GRAMMARS: Record<
  string,
  readonly [packageName: string, version: string, exportName?: string]
> = {
  ".ts": ["tree-sitter-typescript", "0.23.2", "typescript"],
  ".js": ["tree-sitter-javascript", "0.25.0"],
  ".tsx": ["tree-sitter-typescript", "0.23.2", "tsx"],
  ".jsx": ["tree-sitter-javascript", "0.25.0"],
  ".vue": ["tree-sitter-html", "0.23.2"],
  ".dart": [
    "tree-sitter-dart",
    "github:UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934",
  ],
  ".py": ["tree-sitter-python", "0.25.0"],
  ".php": ["tree-sitter-php", "0.24.2", "php"],
  ".java": ["tree-sitter-java", "0.23.5"],
  ".go": ["tree-sitter-go", "0.25.0"],
  ".rs": ["tree-sitter-rust", "0.24.0"],
  ".cpp": ["tree-sitter-cpp", "0.23.4"],
  ".c": ["tree-sitter-c", "0.24.1"],
  ".h": ["tree-sitter-c", "0.24.1"],
  ".md": ["@tree-sitter-grammars/tree-sitter-markdown", "0.3.2"],
  ".json": ["tree-sitter-json", "0.24.8"],
  ".yaml": ["@tree-sitter-grammars/tree-sitter-yaml", "0.7.1"],
  ".yml": ["@tree-sitter-grammars/tree-sitter-yaml", "0.7.1"],
  ".hpp": ["tree-sitter-cpp", "0.23.4"],
  ".cs": ["tree-sitter-c-sharp", "0.23.5", "default"],
  ".rb": ["tree-sitter-ruby", "0.23.1"],
  ".swift": ["tree-sitter-swift", "0.7.1"],
  ".kt": ["@tree-sitter-grammars/tree-sitter-kotlin", "1.1.0"],
  ".kts": ["@tree-sitter-grammars/tree-sitter-kotlin", "1.1.0"],
  ".scala": ["tree-sitter-scala", "0.24.0"],
  ".lua": ["@tree-sitter-grammars/tree-sitter-lua", "0.4.1", "default"],
  ".zig": ["@tree-sitter-grammars/tree-sitter-zig", "1.1.2"],
  ".ex": ["tree-sitter-elixir", "0.3.5"],
  ".exs": ["tree-sitter-elixir", "0.3.5"],
  ".erl": [
    "tree-sitter-erlang",
    "github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870",
  ],
  ".clj": ["tree-sitter-clojure-orchard", "0.2.5"],
  ".ml": ["tree-sitter-ocaml", "0.24.2", "ocaml"],
  ".hs": ["tree-sitter-haskell", "0.23.1"],
};

describe("structural language manifest", () => {
  test("matches the canonical 33 extensions exactly and in order", () => {
    const report = inspectLanguageManifest();
    expect(report).toEqual({
      expectedCount: 33,
      actualCount: 33,
      missing: [],
      extra: [],
      duplicates: [],
      ordered: true,
      exhaustive: true,
    });
    expect(LANGUAGE_MANIFEST.map((entry) => entry.extension)).toEqual(
      DEFAULT_ALLOWED_EXTENSIONS
    );
    expect(
      new Set(LANGUAGE_MANIFEST.map((entry) => entry.extension)).size
    ).toBe(33);
  });

  test("freezes the complete normalized taxonomies", () => {
    expect(STRUCTURAL_SYMBOL_KINDS).toHaveLength(18);
    expect(STRUCTURAL_SYMBOL_KINDS).toEqual([
      "module",
      "namespace",
      "class",
      "interface",
      "trait",
      "enum",
      "function",
      "method",
      "constructor",
      "property",
      "field",
      "variable",
      "constant",
      "type",
      "type_parameter",
      "export",
      "heading",
      "key",
    ]);
    expect(STRUCTURAL_EDGE_KINDS).toEqual([
      "call",
      "data_flow",
      "type_ref",
      "extend",
      "implement",
      "import",
      "http_call",
      "emit",
      "listen",
    ]);
    expect(DATA_FLOW_EDGE_FIXTURE.paramIndex).toBe(1);
  });

  test("every entry pins grammar, query, resolver, tier, and every capability", () => {
    for (const entry of LANGUAGE_MANIFEST) {
      const [packageName, version, exportName] =
        EXPECTED_GRAMMARS[entry.extension];
      expect(entry.grammarArtifact).toEqual({
        packageName,
        version,
        ...(exportName ? { exportName } : {}),
      });
      expect(entry.queryPackVersion).toBe("1.0.0");
      expect(entry.resolverVersion).toBe("1.0.0");
      expect(["structure", "dependencies", "flow"]).toContain(
        entry.capabilityTier
      );
      expect(Object.keys(entry.capabilities).sort()).toEqual(
        [...STRUCTURAL_CAPABILITIES].sort()
      );
      expect(
        Object.values(entry.capabilities).every((value) =>
          ["required", "forbidden", "unsupported"].includes(value)
        )
      ).toBe(true);
      expect(entry.capabilities.declarations).toBe("required");
      expect(entry.capabilities.documentation).toBe("required");
      for (const capability of STRUCTURAL_CAPABILITIES.slice(2)) {
        expect(entry.capabilities[capability]).toBe(
          entry.capabilityTier === "structure" ? "unsupported" : "required"
        );
      }
    }
    expect(Object.keys(EXPECTED_GRAMMARS)).toEqual([
      ...DEFAULT_ALLOWED_EXTENSIONS,
    ]);
  });

  test("records frozen selectors and special host/header policies", () => {
    expect(getLanguageManifestEntry(".tsx")?.grammarArtifact).toEqual({
      packageName: "tree-sitter-typescript",
      version: "0.23.2",
      exportName: "tsx",
    });
    expect(getLanguageManifestEntry(".vue")).toMatchObject({
      language: "Vue",
      grammarArtifact: { packageName: "tree-sitter-html", version: "0.23.2" },
      capabilityTier: "flow",
      mixedLanguagePolicy: "vue",
    });
    expect(getLanguageManifestEntry(".h")).toMatchObject({
      language: "C",
      dialect: "header-default-c",
      grammarArtifact: { packageName: "tree-sitter-c", version: "0.24.1" },
      alternateGrammarArtifact: {
        packageName: "tree-sitter-cpp",
        version: "0.23.4",
      },
    });
    expect(getLanguageManifestEntry(".hpp")).toMatchObject({
      language: "C++",
      grammarArtifact: { packageName: "tree-sitter-cpp", version: "0.23.4" },
    });
    expect(getLanguageManifestEntry(".md")).toMatchObject({
      capabilityTier: "structure",
      mixedLanguagePolicy: "markdown",
      grammarArtifact: {
        packageName: "@tree-sitter-grammars/tree-sitter-markdown",
        version: "0.3.2",
      },
    });
    expect(getLanguageManifestEntry(".dart")?.grammarArtifact.version).toBe(
      "github:UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934"
    );
    expect(getLanguageManifestEntry(".erl")?.grammarArtifact.version).toBe(
      "github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870"
    );
  });

  test("keeps unknown configured extensions semantic-only and outside readiness", () => {
    const before = inspectLanguageManifest();
    expect(resolveStructuralLanguage(".TOML")).toEqual({
      status: "semantic_only",
      extension: ".toml",
      requiredForReadiness: false,
      diagnostic: {
        code: "unsupported_structural_language",
        severity: "recovered",
        message:
          "No structural parser is registered for .toml; semantic indexing remains enabled.",
      },
    });
    expect(inspectLanguageManifest()).toEqual(before);
    expect(getLanguageManifestEntry(".toml")).toBeUndefined();
  });

  test("exposes deterministic fingerprint inputs without computing a hash", () => {
    expect(STRUCTURAL_FINGERPRINT_INPUTS.languages).toHaveLength(33);
    expect(STRUCTURAL_FINGERPRINT_INPUTS.runtime).toEqual({
      packageName: "tree-sitter",
      version: "0.25.0",
      bunVersion: "1.3.14",
      nativeModuleAbi: 137,
      patchSha256:
        "e79aec7b96eb8114e85ebcb90f0a8b12076bcd8aa08c09bb88929621e1c1446d",
    });
    expect(STRUCTURAL_FINGERPRINT_INPUTS.schemas).toEqual({
      taxonomy: "1.0.0",
      sourceSpan: "1.0.0",
      fqn: "1.0.0",
    });
    expect("hash" in STRUCTURAL_FINGERPRINT_INPUTS).toBe(false);
  });
});
