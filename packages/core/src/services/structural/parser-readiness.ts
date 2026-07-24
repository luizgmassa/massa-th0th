import { LANGUAGE_MANIFEST } from "./language-manifest.js";
import {
  grammarArtifactKey,
  loadNativeGrammarSet,
  type LoadedNativeGrammarSet,
} from "./grammar-loaders.js";
import { verifyNativeGrammarIntegrity } from "./grammar-integrity.js";
import type { GrammarArtifact } from "./types.js";

export type ParserReadinessStatus =
  | "pending"
  | "validating"
  | "ready"
  | "failed";

export interface ParserReadinessDiagnostic {
  code: string;
  message: string;
}

export interface ParserReadinessSnapshot {
  status: ParserReadinessStatus;
  requiredExtensions: number;
  validatedExtensions: number;
  errors: readonly ParserReadinessDiagnostic[];
  checkedAt?: string;
}

export class ParserReadinessError extends Error {
  readonly code = "PARSER_NOT_READY";

  constructor(readonly readiness: ParserReadinessSnapshot) {
    const detail = readiness.errors[0]?.message ?? readiness.status;
    super(`Structural parser is not ready for indexing: ${detail}`);
    this.name = "ParserReadinessError";
  }
}

const MAX_ERRORS = 8;
const MAX_ERROR_MESSAGE_LENGTH = 240;

const MINIMAL_FIXTURES: Readonly<Record<string, string>> = Object.freeze({
  ".ts": "const answer: number = 42;",
  ".js": "const answer = 42;",
  ".tsx": "const App = () => <div />;",
  ".jsx": "const App = () => <div />;",
  ".vue": "<template><div /></template><script>const answer = 42;</script>",
  ".dart": "void main() { print('ok'); }",
  ".py": "def answer():\n    return 42\n",
  ".php": "<?php function answer(): int { return 42; }",
  ".java": "class Main { static int answer() { return 42; } }",
  ".go": "package main\nfunc answer() int { return 42 }\n",
  ".rs": "fn answer() -> i32 { 42 }",
  ".cpp": "int answer() { return 42; }",
  ".c": "int answer(void) { return 42; }",
  ".h": "int answer(void);",
  ".md": "# Answer\n\n42\n",
  ".json": '{"answer":42}',
  ".yaml": "answer: 42\n",
  ".yml": "answer: 42\n",
  ".hpp": "int answer();",
  ".cs": "class Main { static int Answer() { return 42; } }",
  ".rb": "def answer\n  42\nend\n",
  ".swift": "func answer() -> Int { return 42 }",
  ".kt": "fun answer(): Int = 42",
  ".kts": "val answer = 42",
  ".scala": "object Main { def answer: Int = 42 }",
  ".lua": "function answer() return 42 end",
  ".zig": "pub fn answer() i32 { return 42; }",
  ".ex": "defmodule Main do\n  def answer, do: 42\nend\n",
  ".exs": "answer = fn -> 42 end\n",
  ".erl": "-module(main).\n-export([answer/0]).\nanswer() -> 42.\n",
  ".clj": "(ns main)\n(defn answer [] 42)\n",
  ".ml": "let answer () = 42\n",
  ".hs": "module Main where\nanswer :: Int\nanswer = 42\n",
});

type GrammarLoader = (
  artifacts: readonly GrammarArtifact[],
) => Promise<LoadedNativeGrammarSet>;

let grammarLoader: GrammarLoader = loadNativeGrammarSet;
let validationPromise: Promise<ParserReadinessSnapshot> | null = null;
let validatedGrammarSet: LoadedNativeGrammarSet | null = null;
let readinessGeneration = 0;
let readiness: ParserReadinessSnapshot = Object.freeze({
  status: "pending",
  requiredExtensions: LANGUAGE_MANIFEST.length,
  validatedExtensions: 0,
  errors: Object.freeze([]),
});

function boundedDiagnostic(error: unknown): ParserReadinessDiagnostic {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  const code =
    normalized.includes("module version") ||
    normalized.includes("abi") ||
    normalized.includes("dlopen")
      ? "incompatible_native_abi"
      : normalized.includes("cannot find") || normalized.includes("missing")
        ? "missing_native_grammar"
        : "native_grammar_validation_failed";
  return Object.freeze({
    code,
    message: message.slice(0, MAX_ERROR_MESSAGE_LENGTH),
  });
}

function uniqueArtifacts(): GrammarArtifact[] {
  const artifacts = new Map<string, GrammarArtifact>();
  for (const entry of LANGUAGE_MANIFEST) {
    artifacts.set(grammarArtifactKey(entry.grammarArtifact), entry.grammarArtifact);
  }
  return [...artifacts.values()];
}

async function runValidation(
  generation: number,
  loader: GrammarLoader,
): Promise<ParserReadinessSnapshot> {
  readiness = Object.freeze({
    status: "validating",
    requiredExtensions: LANGUAGE_MANIFEST.length,
    validatedExtensions: 0,
    errors: Object.freeze([]),
  });

  try {
    // Load-time grammar integrity check: recompute each pinned package's
    // ABI-independent source hash and fail loud before the first parse if a
    // pin has drifted. Runs once per process, only on the production loader
    // path (test stubs that swap the loader are exempt). Default is ON; set
    // MASSA_AI_SKIP_GRAMMAR_INTEGRITY=1 to skip for local dev.
    if (loader === loadNativeGrammarSet) {
      verifyNativeGrammarIntegrity();
    }

    const loaded = await loader(uniqueArtifacts());
    let validatedExtensions = 0;
    for (const entry of LANGUAGE_MANIFEST) {
      const fixture = MINIMAL_FIXTURES[entry.extension];
      if (fixture === undefined) {
        throw new Error(`No readiness fixture for ${entry.extension}`);
      }
      const language = loaded.grammars.get(
        grammarArtifactKey(entry.grammarArtifact),
      );
      if (!language) {
        throw new Error(
          `Missing loaded grammar ${grammarArtifactKey(entry.grammarArtifact)}`,
        );
      }
      const parser = new loaded.Parser();
      parser.setLanguage(language);
      const tree = parser.parse(fixture);
      try {
        const expectedBytes = Buffer.byteLength(fixture, "utf8");
        if (tree.rootNode.hasError) {
          throw new Error(
            `${entry.extension} readiness parse produced an error root (${tree.rootNode.type})`,
          );
        }
        if (tree.rootNode.endIndex !== expectedBytes) {
          throw new Error(
            `${entry.extension} readiness parse consumed ${tree.rootNode.endIndex}/${expectedBytes} bytes`,
          );
        }
      } finally {
        tree.delete();
      }
      validatedExtensions += 1;
    }

    if (generation !== readinessGeneration) {
      throw new Error("Parser readiness validation was superseded by a test reset");
    }
    readiness = Object.freeze({
      status: "ready",
      requiredExtensions: LANGUAGE_MANIFEST.length,
      validatedExtensions,
      errors: Object.freeze([]),
      checkedAt: new Date().toISOString(),
    });
    validatedGrammarSet = loaded;
    return readiness;
  } catch (error) {
    if (generation !== readinessGeneration) throw error;
    validatedGrammarSet = null;
    readiness = Object.freeze({
      status: "failed",
      requiredExtensions: LANGUAGE_MANIFEST.length,
      validatedExtensions: 0,
      errors: Object.freeze([boundedDiagnostic(error)].slice(0, MAX_ERRORS)),
      checkedAt: new Date().toISOString(),
    });
    throw new ParserReadinessError(readiness);
  }
}

/** Idempotently validate every required extension in one process-wide flight. */
export function validateAllGrammars(): Promise<ParserReadinessSnapshot> {
  if (readiness.status === "ready") return Promise.resolve(readiness);
  if (readiness.status === "failed") {
    return Promise.reject(new ParserReadinessError(readiness));
  }
  validationPromise ??= runValidation(readinessGeneration, grammarLoader);
  return validationPromise;
}

export function getParserReadiness(): ParserReadinessSnapshot {
  return readiness;
}

/** Return the startup-validated immutable grammar cache; never loads modules. */
export function getValidatedNativeGrammarSet(): LoadedNativeGrammarSet {
  if (readiness.status !== "ready" || !validatedGrammarSet) {
    throw new ParserReadinessError(readiness);
  }
  return validatedGrammarSet;
}

export async function assertParserReadyForIndexing(): Promise<void> {
  await validateAllGrammars();
}

/** Isolated-test seam; production code never calls this. */
export function resetParserReadinessForTests(
  loader: GrammarLoader = loadNativeGrammarSet,
): void {
  grammarLoader = loader;
  readinessGeneration += 1;
  validationPromise = null;
  validatedGrammarSet = null;
  readiness = Object.freeze({
    status: "pending",
    requiredExtensions: LANGUAGE_MANIFEST.length,
    validatedExtensions: 0,
    errors: Object.freeze([]),
  });
}
