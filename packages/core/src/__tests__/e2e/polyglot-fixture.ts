import { readdir } from "node:fs/promises";
import path from "node:path";
import { DEFAULT_ALLOWED_EXTENSIONS } from "@massa-th0th/shared";
import { LANGUAGE_MANIFEST } from "../../services/structural/language-manifest.js";
import { POLY_FIXTURE_PATH } from "./_helpers.js";

export interface PolyglotExpectation {
  extension: string;
  file: string;
  sentinel: string;
  kind: string;
  tier: "flow" | "structure";
  qualifiedName?: string;
  flowTarget?: string;
}

const SENTINELS: Readonly<Record<string, Omit<PolyglotExpectation, "extension" | "tier">>> = Object.freeze({
  ".ts": { file: "decorator-heavy.ts", sentinel: "PolyRoot", kind: "class", flowTarget: "PolyRoot" },
  ".js": { file: "sentinel.js", sentinel: "PolyJavascript", kind: "function", flowTarget: "PolyJavascript" },
  ".tsx": { file: "sentinel.tsx", sentinel: "PolyTsx", kind: "function", flowTarget: "PolyTsx" },
  ".jsx": { file: "sentinel.jsx", sentinel: "PolyJsx", kind: "function", flowTarget: "PolyJsx" },
  ".vue": { file: "sentinel.vue", sentinel: "PolyVue", kind: "constant", qualifiedName: "vue.script[0].PolyVue", flowTarget: "toUpperCase" },
  ".dart": { file: "poly.dart", sentinel: "PolyDart", kind: "class", flowTarget: "PolyDart" },
  ".py": { file: "indent-method.py", sentinel: "Outer", kind: "class", flowTarget: "Outer" },
  ".php": { file: "sentinel.php", sentinel: "PolyPhp", kind: "class", flowTarget: "run" },
  ".java": { file: "sentinel.java", sentinel: "PolyJava", kind: "class", flowTarget: "PolyJava" },
  ".go": { file: "poly.go", sentinel: "PolyGo", kind: "function", flowTarget: "PolyGo" },
  ".rs": { file: "poly.rs", sentinel: "PolyRust", kind: "class", flowTarget: "PolyRust" },
  ".cpp": { file: "sentinel.cpp", sentinel: "PolyCpp", kind: "class", flowTarget: "PolyCpp" },
  ".c": { file: "sentinel.c", sentinel: "poly_c", kind: "function", flowTarget: "poly_c" },
  ".h": { file: "sentinel.h", sentinel: "poly_header", kind: "function", flowTarget: "poly_header" },
  ".md": { file: "README.md", sentinel: "Polyglot E2E Fixture", kind: "heading" },
  ".json": { file: "tsconfig.json", sentinel: "compilerOptions", kind: "key" },
  ".yaml": { file: "sentinel.yaml", sentinel: "PolyYaml", kind: "key" },
  ".yml": { file: "sentinel.yml", sentinel: "PolyYml", kind: "key" },
  ".hpp": { file: "sentinel.hpp", sentinel: "PolyHpp", kind: "class", flowTarget: "PolyHpp" },
  ".cs": { file: "sentinel.cs", sentinel: "PolyCsharp", kind: "class", flowTarget: "PolyCsharp" },
  ".rb": { file: "sentinel.rb", sentinel: "PolyRuby", kind: "class", flowTarget: "new" },
  ".swift": { file: "sentinel.swift", sentinel: "PolySwift", kind: "class", flowTarget: "PolySwift" },
  ".kt": { file: "poly.kt", sentinel: "PolyKotlin", kind: "class", flowTarget: "PolyKotlin" },
  ".kts": { file: "sentinel.kts", sentinel: "polyKotlinScript", kind: "function", flowTarget: "polyKotlinScript" },
  ".scala": { file: "sentinel.scala", sentinel: "PolyScala", kind: "class", flowTarget: "PolyScala" },
  ".lua": { file: "sentinel.lua", sentinel: "poly_lua", kind: "function", flowTarget: "poly_lua" },
  ".zig": { file: "sentinel.zig", sentinel: "PolyZig", kind: "class", flowTarget: "PolyZig" },
  ".ex": { file: "sentinel.ex", sentinel: "PolyElixir", kind: "module", flowTarget: "run" },
  ".exs": { file: "sentinel.exs", sentinel: "poly_elixir_script", kind: "function", flowTarget: "poly_elixir_script" },
  ".erl": { file: "sentinel.erl", sentinel: "poly_erlang", kind: "module", flowTarget: "poly_erlang" },
  ".clj": { file: "sentinel.clj", sentinel: "poly_clojure", kind: "function", qualifiedName: "poly.clojure.poly_clojure", flowTarget: "poly_clojure" },
  ".ml": { file: "sentinel.ml", sentinel: "poly_ocaml", kind: "function", flowTarget: "poly_ocaml" },
  ".hs": { file: "sentinel.hs", sentinel: "polyHaskell", kind: "function", qualifiedName: "PolyHaskell.polyHaskell", flowTarget: "polyHaskell" },
});

export const POLYGLOT_EXPECTATIONS: readonly PolyglotExpectation[] = Object.freeze(
  LANGUAGE_MANIFEST.map((entry) => Object.freeze({
    extension: entry.extension,
    ...SENTINELS[entry.extension]!,
    tier: entry.capabilityTier,
  })),
);

export async function inspectPolyglotFixture(): Promise<{
  files: readonly string[];
  extensions: readonly string[];
}> {
  const files = (await readdir(POLY_FIXTURE_PATH, { withFileTypes: true }))
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name)
    .sort();
  return Object.freeze({
    files: Object.freeze(files),
    extensions: Object.freeze([...new Set(files.map((file) => path.extname(file).toLowerCase()))].sort()),
  });
}

export function assertPolyglotContractStatic(): void {
  const expected = [...DEFAULT_ALLOWED_EXTENSIONS].sort();
  const declared = POLYGLOT_EXPECTATIONS.map((entry) => entry.extension).sort();
  if (JSON.stringify(declared) !== JSON.stringify(expected)) {
    throw new Error(`polyglot expectations drifted: ${JSON.stringify({ expected, declared })}`);
  }
  if (POLYGLOT_EXPECTATIONS.some((entry) => !entry.file || !entry.sentinel || !entry.kind)) {
    throw new Error("polyglot expectations require one file/sentinel/kind per extension");
  }
  if (POLYGLOT_EXPECTATIONS.some((entry) =>
    (entry.tier === "flow") !== Boolean(entry.flowTarget)
  )) {
    throw new Error("polyglot flow expectations require one transport-visible edge target");
  }
}
