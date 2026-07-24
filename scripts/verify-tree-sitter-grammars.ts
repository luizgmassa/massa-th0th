#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire, type Require } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";
// Canonical native grammar identity pins live in the shared structural module
// so the offline verifier and the runtime load-time integrity check share a
// single source of truth. Re-exported here to preserve the historical public
// surface of this script (and its test).
export {
  NATIVE_DEPENDENCIES,
  NATIVE_LOCK_IDENTITIES,
  TRUSTED_NATIVE_PACKAGES,
  TREE_SITTER_PATCH,
} from "../packages/core/src/services/structural/native-lock-identities.ts";
import {
  NATIVE_DEPENDENCIES,
  NATIVE_LOCK_IDENTITIES,
  TRUSTED_NATIVE_PACKAGES,
  TREE_SITTER_PATCH,
} from "../packages/core/src/services/structural/native-lock-identities.ts";

export const EXPECTED_BUN_VERSION = "1.3.14";
export const EXPECTED_NODE_BUILD_VERSION = "25.9.0";
export const EXPECTED_NATIVE_MODULE_ABI = 137;
export const EXPECTED_NATIVE_MODULE_COUNT = 27;
const RSS_DISCRIMINATION_BYTES = 16 * 1024 * 1024;
const RSS_SENSOR_CYCLES = 100;
const VERIFIER_DATABASE_URL =
  "postgresql://tree_sitter_verifier:tree_sitter_verifier@127.0.0.1:1/tree_sitter_verifier";

export interface MinimalParseCase {
  extension: string;
  grammar: string;
  source: string;
}

export const MINIMAL_PARSE_CASES: readonly MinimalParseCase[] = [
  { extension: ".ts", grammar: "typescript", source: "const answer: number = 42;" },
  { extension: ".js", grammar: "javascript", source: "const answer = 42;" },
  { extension: ".tsx", grammar: "tsx", source: "const App = () => <div />;" },
  { extension: ".jsx", grammar: "javascript", source: "const App = () => <div />;" },
  {
    extension: ".vue",
    grammar: "html",
    source: "<template><div /></template><script>const answer = 42;</script>",
  },
  { extension: ".dart", grammar: "dart", source: "void main() { print('ok'); }" },
  { extension: ".py", grammar: "python", source: "def answer():\n    return 42\n" },
  {
    extension: ".php",
    grammar: "php",
    source: "<?php function answer(): int { return 42; }",
  },
  {
    extension: ".java",
    grammar: "java",
    source: "class Main { static int answer() { return 42; } }",
  },
  { extension: ".go", grammar: "go", source: "package main\nfunc answer() int { return 42 }\n" },
  { extension: ".rs", grammar: "rust", source: "fn answer() -> i32 { 42 }" },
  { extension: ".cpp", grammar: "cpp", source: "int answer() { return 42; }" },
  { extension: ".c", grammar: "c", source: "int answer(void) { return 42; }" },
  { extension: ".h", grammar: "c", source: "int answer(void);" },
  { extension: ".md", grammar: "markdown", source: "# Answer\n\n42\n" },
  { extension: ".json", grammar: "json", source: '{"answer":42}' },
  { extension: ".yaml", grammar: "yaml", source: "answer: 42\n" },
  { extension: ".yml", grammar: "yaml", source: "answer: 42\n" },
  { extension: ".hpp", grammar: "cpp", source: "int answer();" },
  {
    extension: ".cs",
    grammar: "csharp",
    source: "class Main { static int Answer() { return 42; } }",
  },
  { extension: ".rb", grammar: "ruby", source: "def answer\n  42\nend\n" },
  { extension: ".swift", grammar: "swift", source: "func answer() -> Int { return 42 }" },
  { extension: ".kt", grammar: "kotlin", source: "fun answer(): Int = 42" },
  { extension: ".kts", grammar: "kotlin", source: "val answer = 42" },
  {
    extension: ".scala",
    grammar: "scala",
    source: "object Main { def answer: Int = 42 }",
  },
  { extension: ".lua", grammar: "lua", source: "function answer() return 42 end" },
  { extension: ".zig", grammar: "zig", source: "pub fn answer() i32 { return 42; }" },
  {
    extension: ".ex",
    grammar: "elixir",
    source: "defmodule Main do\n  def answer, do: 42\nend\n",
  },
  { extension: ".exs", grammar: "elixir", source: "answer = fn -> 42 end\n" },
  {
    extension: ".erl",
    grammar: "erlang",
    source: "-module(main).\n-export([answer/0]).\nanswer() -> 42.\n",
  },
  { extension: ".clj", grammar: "clojure", source: "(ns main)\n(defn answer [] 42)\n" },
  { extension: ".ml", grammar: "ocaml", source: "let answer () = 42\n" },
  {
    extension: ".hs",
    grammar: "haskell",
    source: "module Main where\nanswer :: Int\nanswer = 42\n",
  },
] as const;

interface PackageJson {
  packageManager?: string;
  scripts?: Record<string, string>;
  trustedDependencies?: string[];
  patchedDependencies?: Record<string, string>;
  bundledDependencies?: string[];
  dependencies?: Record<string, string>;
}

interface SyntaxNode {
  tree: ParsedTree;
  type: string;
  hasError: boolean;
  endIndex: number;
  walk(): TreeCursor;
}

interface TreeCursor {
  tree: ParsedTree;
  readonly currentNode: SyntaxNode;
  reset(node: SyntaxNode): void;
  resetTo(cursor: TreeCursor): void;
  delete(): void;
}

interface ParsedTree {
  rootNode: SyntaxNode;
  delete(): void;
}

interface ParserInstance {
  setLanguage(language: unknown): void;
  parse(source: string, oldTree?: ParsedTree | null): ParsedTree;
}

interface ParserConstructor {
  new (): ParserInstance;
  Query: new (language: unknown, source: string) => {
    captures(node: SyntaxNode): unknown[];
  };
}

interface LoadedGrammarSet {
  Parser: ParserConstructor;
  grammars: Record<string, unknown>;
}

interface NativeAbiFailure extends Error {
  code: "INCOMPATIBLE_NATIVE_ABI";
}

interface BunLock {
  lockfileVersion?: number;
  workspaces?: Record<string, { dependencies?: Record<string, string> }>;
  trustedDependencies?: string[];
  patchedDependencies?: Record<string, string>;
  packages?: Record<string, unknown>;
}

export interface BunMaskAdapter {
  target: object;
  property?: PropertyKey;
  getDescriptor?: (target: object, property: PropertyKey) => PropertyDescriptor | undefined;
  deleteProperty?: (target: object, property: PropertyKey) => boolean;
  restoreProperty?: (
    target: object,
    property: PropertyKey,
    descriptor: PropertyDescriptor,
  ) => void;
}

export type ConsumerKind = "source" | "dist";

export interface ConsumerVerificationResult {
  status: "PASS";
  consumer: ConsumerKind;
  pid: number;
  bun: string;
  entry: string;
  entryImported: true;
  resolvable: number;
  parses: number;
  nativeModules: number;
  patchedRuntimeModule: string;
}

export interface PatchBehaviorResult {
  status: "PASS";
  pid: number;
  bun: string;
  patchedRuntimeModule: string;
  sensors: {
    doubleDelete: true;
    cachedNode: string;
    query: string;
    parserOldTree: string;
    cursorDelete: string;
    cursorAfterTree: string;
    nodeOwnerSubstitution: string;
    cursorOwnerSubstitution: string;
    cursorResetCrossTree: string;
    cursorResetToCrossTree: string;
  };
}

export interface RssSensorResult {
  status: "PASS";
  mode: "patched" | "control";
  pid: number;
  bun: string;
  cycles: number;
  firstRss: number;
  lastRss: number;
  growthBytes: number;
  cycles21To40Median: number;
  cycles81To100Median: number;
  patchedRuntimeModule: string;
}

export interface PackedConsumerVerificationResult {
  status: "PASS";
  consumer: "packed";
  pid: number;
  bun: string;
  entry: string;
  resolvable: number;
  parses: number;
  nativeModules: number;
  nativePackagePaths: number;
  patchedRuntimePackage: string;
  patchedRuntimeModule: string;
  behaviorSensors: number;
}

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CONSUMER_RESULT_PREFIX = "TREE_SITTER_CONSUMER_RESULT=";
const BEHAVIOR_RESULT_PREFIX = "TREE_SITTER_BEHAVIOR_RESULT=";
const RSS_RESULT_PREFIX = "TREE_SITTER_RSS_RESULT=";
export const PACKED_CONSUMER_RESULT_PREFIX = "TREE_SITTER_PACKED_CONSUMER_RESULT=";
export const CORE_CONSUMER_ENTRIES: Readonly<Record<ConsumerKind, string>> = Object.freeze({
  source: resolve(ROOT, "packages/core/src/index.ts"),
  dist: resolve(ROOT, "packages/core/dist/index.js"),
});
const PROCESS_BUN_MASK_ADAPTER: BunMaskAdapter = Object.freeze({ target: process.versions });
const textDecoder = new TextDecoder();
let bunMaskTail = Promise.resolve();

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function readJson(path: string): PackageJson {
  return JSON.parse(readFileSync(path, "utf8")) as PackageJson;
}

function sorted(values: readonly string[]): string[] {
  return [...values].sort();
}

function equalStringArrays(left: readonly string[], right: readonly string[]): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isNativePackage(name: string): boolean {
  return name === "tree-sitter" || name.startsWith("tree-sitter-") ||
    name.startsWith("@tree-sitter-grammars/tree-sitter-");
}

export function parseBunLockText(source: string, fileName = "bun.lock"): BunLock {
  const parsed = parseConfigFileTextToJson(fileName, source);
  if (parsed.error) {
    throw new Error(
      `${fileName} JSONC parse failed: ${flattenDiagnosticMessageText(parsed.error.messageText, "\n")}`,
    );
  }
  invariant(parsed.config && typeof parsed.config === "object", `${fileName} did not parse to an object`);
  return parsed.config as BunLock;
}

function readCanonicalExtensions(): string[] {
  const configSource = readFileSync(resolve(ROOT, "packages/shared/src/config/index.ts"), "utf8");
  const declaration = configSource.match(
    /export const DEFAULT_ALLOWED_EXTENSIONS:[^=]+?=\s*\[([\s\S]*?)\];/,
  );
  invariant(declaration, "DEFAULT_ALLOWED_EXTENSIONS declaration was not found");
  return [...declaration[1].matchAll(/"(\.[^"]+)"/g)].map((match) => match[1]);
}

function descriptorEquals(left: PropertyDescriptor, right: PropertyDescriptor): boolean {
  return left.configurable === right.configurable && left.enumerable === right.enumerable &&
    left.writable === right.writable && left.value === right.value && left.get === right.get &&
    left.set === right.set;
}

export async function withMaskedBunVersion<T>(
  callback: () => T | Promise<T>,
  adapter: BunMaskAdapter = PROCESS_BUN_MASK_ADAPTER,
): Promise<T> {
  const waitForTurn = bunMaskTail;
  let releaseTurn!: () => void;
  bunMaskTail = new Promise<void>((resolveTurn) => {
    releaseTurn = resolveTurn;
  });
  await waitForTurn;
  try {
    const property = adapter.property ?? "bun";
    const getDescriptor = adapter.getDescriptor ?? Object.getOwnPropertyDescriptor;
    const deleteProperty = adapter.deleteProperty ?? Reflect.deleteProperty;
    const restoreProperty = adapter.restoreProperty ??
      ((target: object, key: PropertyKey, descriptor: PropertyDescriptor) => {
        Object.defineProperty(target, key, descriptor);
      });
    const descriptor = getDescriptor(adapter.target, property);
    invariant(descriptor, "process.versions.bun descriptor is missing before masking");
    invariant(
      descriptor.configurable,
      "process.versions.bun must be configurable for native loading",
    );
    invariant(deleteProperty(adapter.target, property), "failed to mask process.versions.bun");

    try {
      return await callback();
    } finally {
      restoreProperty(adapter.target, property, descriptor);
      const restored = getDescriptor(adapter.target, property);
      invariant(
        restored && descriptorEquals(restored, descriptor),
        "Bun descriptor restoration failed",
      );
    }
  } finally {
    releaseTurn();
  }
}

export function assertRuntimeTarget(): void {
  const isDarwinArm64 = process.platform === "darwin" && process.arch === "arm64";
  const isLinuxX64 = process.platform === "linux" && process.arch === "x64";
  invariant(
    isDarwinArm64 || isLinuxX64,
    `native verifier requires macOS arm64 or Linux glibc x64, got ${process.platform} ${process.arch}`,
  );
  invariant(
    process.versions.bun === EXPECTED_BUN_VERSION,
    `native verifier requires Bun ${EXPECTED_BUN_VERSION}, got ${process.versions.bun ?? "none"}`,
  );
  invariant(
    Number(process.versions.modules) === EXPECTED_NATIVE_MODULE_ABI,
    `Bun ${EXPECTED_BUN_VERSION} must expose native ABI ${EXPECTED_NATIVE_MODULE_ABI}, got ${process.versions.modules}`,
  );
}

export function verifyLockContractText(source: string, fileName = "bun.lock"): {
  nativeDependencies: number;
  trustedDependencies: number;
  lockedIdentities: number;
  patchedDependencies: number;
} {
  const lock = parseBunLockText(source, fileName);
  invariant(lock.lockfileVersion === 1, "bun.lock must use lockfileVersion 1");
  invariant(
    JSON.stringify(lock.patchedDependencies) ===
      JSON.stringify({ [TREE_SITTER_PATCH.package]: TREE_SITTER_PATCH.path }),
    "bun.lock patchedDependencies must contain only the verified tree-sitter patch",
  );
  const dependencies = lock.workspaces?.["packages/core"]?.dependencies;
  invariant(dependencies, "bun.lock is missing packages/core dependencies");
  const actualNativeNames = sorted(Object.keys(dependencies).filter(isNativePackage));
  invariant(
    equalStringArrays(actualNativeNames, TRUSTED_NATIVE_PACKAGES),
    "bun.lock packages/core native dependency names do not match the audited set",
  );
  for (const [packageName, expectedSpec] of Object.entries(NATIVE_DEPENDENCIES)) {
    invariant(
      dependencies[packageName] === expectedSpec,
      `bun.lock ${packageName} spec drifted: ${dependencies[packageName] ?? "missing"}`,
    );
  }

  const trustedDependencies = sorted(lock.trustedDependencies ?? []);
  invariant(
    equalStringArrays(trustedDependencies, TRUSTED_NATIVE_PACKAGES),
    "bun.lock trustedDependencies do not match the audited direct native set",
  );
  invariant(lock.packages, "bun.lock packages map is missing");
  let lockedIdentities = 0;
  for (const packageName of TRUSTED_NATIVE_PACKAGES) {
    const record = lock.packages[packageName];
    invariant(Array.isArray(record), `bun.lock package record is missing for ${packageName}`);
    const expected = NATIVE_LOCK_IDENTITIES[packageName as keyof typeof NATIVE_DEPENDENCIES];
    invariant(
      record[0] === expected.resolved,
      `bun.lock ${packageName} resolved identity drifted: ${String(record[0])}`,
    );
    if ("sri" in expected) {
      const integrity = record.at(-1);
      invariant(
        integrity === expected.sri,
        `bun.lock ${packageName} SRI drifted: ${String(integrity)}`,
      );
    } else {
      // Git-dep records are [resolved, metadata, gitIdentity] under Bun 1.3.11
      // and [resolved, metadata, gitIdentity, sourceIntegrity] under Bun 1.3.14
      // (which appends a per-archive sha512). The gitIdentity token is the commit
      // pin we freeze; assert it by membership so the check survives the appended
      // element without losing the commit-drift guarantee.
      invariant(
        record.includes(expected.gitIdentity),
        `bun.lock ${packageName} Git identity drifted: ${JSON.stringify(record)}`,
      );
    }
    lockedIdentities += 1;
  }
  return {
    nativeDependencies: actualNativeNames.length,
    trustedDependencies: trustedDependencies.length,
    lockedIdentities,
    patchedDependencies: 1,
  };
}

export function verifyLockContract(): {
  nativeDependencies: number;
  trustedDependencies: number;
  lockedIdentities: number;
  patchedDependencies: number;
} {
  return verifyLockContractText(readFileSync(resolve(ROOT, "bun.lock"), "utf8"));
}

export function verifyStaticContract(): {
  extensions: number;
  nativeDependencies: number;
  trustedDependencies: number;
  lockedIdentities: number;
  patchedDependencies: number;
} {
  const rootPackage = readJson(resolve(ROOT, "package.json"));
  const corePackage = readJson(resolve(ROOT, "packages/core/package.json"));
  invariant(rootPackage.packageManager === `bun@${EXPECTED_BUN_VERSION}`, "root Bun pin drifted");
  invariant(
    rootPackage.scripts?.["verify:tree-sitter-native"] ===
      "bun scripts/verify-tree-sitter-grammars.ts && bun scripts/verify-tree-sitter-package-artifact.ts",
    "root native verifier script drifted",
  );
  invariant(
    rootPackage.scripts?.["verify:tree-sitter-source-dist"] ===
      "bun scripts/verify-tree-sitter-grammars.ts",
    "root source/dist native verifier script drifted",
  );
  invariant(
    rootPackage.scripts?.["verify:tree-sitter-package"] ===
      "bun scripts/verify-tree-sitter-package-artifact.ts",
    "root packed-package native verifier script drifted",
  );
  invariant(
    readFileSync(resolve(ROOT, ".node-version"), "utf8").trim() === EXPECTED_NODE_BUILD_VERSION,
    `native build helper must pin Node ${EXPECTED_NODE_BUILD_VERSION}`,
  );
  invariant(
    JSON.stringify(rootPackage.patchedDependencies) ===
      JSON.stringify({ [TREE_SITTER_PATCH.package]: TREE_SITTER_PATCH.path }),
    "root patchedDependencies must contain only the verified tree-sitter patch",
  );
  invariant(
    JSON.stringify(corePackage.bundledDependencies) === JSON.stringify(["tree-sitter"]),
    "core must bundle the patched tree-sitter runtime",
  );
  invariant(
    corePackage.dependencies?.["@massa-ai/shared"] === "1.1.0",
    "core must publish a semver dependency on @massa-ai/shared",
  );
  const patchPath = resolve(ROOT, TREE_SITTER_PATCH.path);
  invariant(existsSync(patchPath) && statSync(patchPath).isFile(), `patch is missing: ${patchPath}`);
  const patchSha256 = createHash("sha256").update(readFileSync(patchPath)).digest("hex");
  invariant(
    patchSha256 === TREE_SITTER_PATCH.sha256,
    `tree-sitter patch SHA-256 drifted: ${patchSha256}`,
  );

  const actualNativeDependencies = Object.fromEntries(
    Object.entries(corePackage.dependencies ?? {}).filter(([name]) => isNativePackage(name)),
  );
  invariant(
    JSON.stringify(actualNativeDependencies) === JSON.stringify(NATIVE_DEPENDENCIES),
    "packages/core native dependency pins do not match the audited set",
  );
  const actualTrusted = sorted(rootPackage.trustedDependencies ?? []);
  invariant(
    equalStringArrays(actualTrusted, TRUSTED_NATIVE_PACKAGES),
    "root trustedDependencies must contain only the audited direct native packages",
  );

  const caseExtensions = MINIMAL_PARSE_CASES.map(({ extension }) => extension);
  const canonicalExtensions = readCanonicalExtensions();
  invariant(new Set(caseExtensions).size === caseExtensions.length, "minimal parse extensions repeat");
  invariant(
    equalStringArrays(caseExtensions, canonicalExtensions),
    "minimal parse cases must exactly match DEFAULT_ALLOWED_EXTENSIONS in canonical order",
  );
  const lockContract = verifyLockContract();
  return {
    extensions: caseExtensions.length,
    nativeDependencies: lockContract.nativeDependencies,
    trustedDependencies: lockContract.trustedDependencies,
    lockedIdentities: lockContract.lockedIdentities,
    patchedDependencies: lockContract.patchedDependencies,
  };
}

export function verifyConsumerEntries(): Readonly<Record<ConsumerKind, string>> {
  for (const [consumer, entry] of Object.entries(CORE_CONSUMER_ENTRIES)) {
    invariant(existsSync(entry), `${consumer} consumer entry is missing: ${entry}`);
    invariant(statSync(entry).isFile(), `${consumer} consumer entry is not a file: ${entry}`);
  }
  return CORE_CONSUMER_ENTRIES;
}

export async function verifyBunMaskRestoration(): Promise<void> {
  const original = Object.getOwnPropertyDescriptor(process.versions, "bun");
  invariant(original, "Bun descriptor missing before restoration sensor");

  let signalFirstEntered!: () => void;
  let releaseFirst!: () => void;
  const firstEntered = new Promise<void>((resolveEntered) => {
    signalFirstEntered = resolveEntered;
  });
  const firstMayExit = new Promise<void>((resolveExit) => {
    releaseFirst = resolveExit;
  });
  let secondEntered = false;

  const first = withMaskedBunVersion(async () => {
    invariant(!Object.hasOwn(process.versions, "bun"), "Bun marker remained visible while masked");
    signalFirstEntered();
    await firstMayExit;
  });
  await firstEntered;
  const second = withMaskedBunVersion(() => {
    secondEntered = true;
    invariant(!Object.hasOwn(process.versions, "bun"), "serialized callback saw the Bun marker");
  });
  await Promise.resolve();
  invariant(!secondEntered, "Bun marker callbacks overlapped");
  releaseFirst();
  await Promise.all([first, second]);
  invariant(secondEntered, "serialized Bun marker callback did not run");

  const sentinel = new Error("forced Bun marker restoration sensor");
  let caught: unknown;
  try {
    await withMaskedBunVersion(() => {
      throw sentinel;
    });
  } catch (error) {
    caught = error;
  }
  invariant(caught === sentinel, "forced Bun marker error was not preserved");
  const restored = Object.getOwnPropertyDescriptor(process.versions, "bun");
  invariant(restored && descriptorEquals(restored, original), "full Bun descriptor was not restored");
}

async function importDefaultFrom(requireFromConsumer: Require, packageName: string): Promise<unknown> {
  const imported = await import(pathToFileURL(requireFromConsumer.resolve(packageName)).href);
  return (imported as { default?: unknown }).default ?? imported;
}

async function loadNativeGrammarSet(requireFromConsumer: Require): Promise<LoadedGrammarSet> {
  return withMaskedBunVersion(async () => {
    const Parser = requireFromConsumer("tree-sitter") as ParserConstructor;
    const typescript = requireFromConsumer("tree-sitter-typescript") as Record<string, unknown>;
    const php = requireFromConsumer("tree-sitter-php") as Record<string, unknown>;
    const ocaml = requireFromConsumer("tree-sitter-ocaml") as Record<string, unknown>;
    const grammars: Record<string, unknown> = {
      javascript: requireFromConsumer("tree-sitter-javascript"),
      typescript: typescript.typescript,
      tsx: typescript.tsx,
      html: requireFromConsumer("tree-sitter-html"),
      dart: requireFromConsumer("tree-sitter-dart"),
      python: requireFromConsumer("tree-sitter-python"),
      php: php.php,
      java: requireFromConsumer("tree-sitter-java"),
      go: requireFromConsumer("tree-sitter-go"),
      rust: requireFromConsumer("tree-sitter-rust"),
      cpp: requireFromConsumer("tree-sitter-cpp"),
      c: requireFromConsumer("tree-sitter-c"),
      markdown: requireFromConsumer("@tree-sitter-grammars/tree-sitter-markdown"),
      json: requireFromConsumer("tree-sitter-json"),
      yaml: requireFromConsumer("@tree-sitter-grammars/tree-sitter-yaml"),
      csharp: await importDefaultFrom(requireFromConsumer, "tree-sitter-c-sharp"),
      ruby: requireFromConsumer("tree-sitter-ruby"),
      swift: requireFromConsumer("tree-sitter-swift"),
      kotlin: requireFromConsumer("@tree-sitter-grammars/tree-sitter-kotlin"),
      scala: requireFromConsumer("tree-sitter-scala"),
      lua: await importDefaultFrom(requireFromConsumer, "@tree-sitter-grammars/tree-sitter-lua"),
      zig: requireFromConsumer("@tree-sitter-grammars/tree-sitter-zig"),
      elixir: requireFromConsumer("tree-sitter-elixir"),
      erlang: requireFromConsumer("tree-sitter-erlang"),
      clojure: requireFromConsumer("tree-sitter-clojure-orchard"),
      ocaml: ocaml.ocaml,
      haskell: requireFromConsumer("tree-sitter-haskell"),
    };
    invariant(
      Object.values(grammars).every(Boolean),
      "one or more grammar modules did not expose a language",
    );
    return { Parser, grammars };
  });
}

function verifyConsumerResolution(
  consumer: ConsumerKind | "packed",
  requireFromConsumer: Require,
): number {
  for (const packageName of TRUSTED_NATIVE_PACKAGES) {
    invariant(
      requireFromConsumer.resolve(packageName),
      `${packageName} is not ${consumer}-resolvable from ${CORE_CONSUMER_ENTRIES[consumer]}`,
    );
  }
  return TRUSTED_NATIVE_PACKAGES.length;
}

function parseMinimalCase(
  consumer: ConsumerKind | "packed",
  loaded: LoadedGrammarSet,
  parseCase: MinimalParseCase,
): void {
  const parser = new loaded.Parser();
  parser.setLanguage(loaded.grammars[parseCase.grammar]);
  const tree = parser.parse(parseCase.source);
  try {
    const root = tree.rootNode;
    const result = {
      type: root.type,
      hasError: root.hasError,
      endIndex: root.endIndex,
      sourceBytes: Buffer.byteLength(parseCase.source, "utf8"),
    };
    invariant(
      !result.hasError,
      `${consumer} ${parseCase.extension} parse produced an error root (${result.type})`,
    );
    invariant(
      result.endIndex === result.sourceBytes,
      `${consumer} ${parseCase.extension} consumed ${result.endIndex}/${result.sourceBytes} bytes`,
    );
  } finally {
    tree.delete();
  }
}

function runMinimalParses(consumer: ConsumerKind | "packed", loaded: LoadedGrammarSet): number {
  let parsed = 0;
  for (const parseCase of MINIMAL_PARSE_CASES) {
    parseMinimalCase(consumer, loaded, parseCase);
    parsed += 1;
  }
  return parsed;
}

function runCommand(command: string, args: string[]): string {
  const result = Bun.spawnSync([command, ...args], { stdout: "pipe", stderr: "pipe" });
  const stdout = textDecoder.decode(result.stdout);
  const stderr = textDecoder.decode(result.stderr);
  invariant(
    result.exitCode === 0,
    `${command} ${args.join(" ")} failed (${result.exitCode}): ${stderr || stdout}`,
  );
  return stdout;
}

function currentNativeModules(requireFromConsumer: Require): string[] {
  return Object.keys(requireFromConsumer.cache)
    .filter((path) => path.endsWith(".node"))
    .map(realpathSync)
    .filter((path, index, paths) => paths.indexOf(path) === index)
    .sort();
}

/** Allowed ELF soname patterns for Linux glibc x64 native modules. */
const ALLOWED_LINUX_SONAME_PATTERNS: readonly RegExp[] = [
  /^linux-vdso\.so\.1$/,
  /^libstdc\+\+\.so\.6(\..*)?$/,
  /^libgcc_s\.so\.1$/,
  /^libc\.so\.6$/,
  /^libpthread\.so\.0$/,
  /^libdl\.so\.2$/,
  /^libm\.so\.6$/,
  /^ld-linux-x86-64\.so\.2$/,
];

/** Allowed Mach-O dynamic libraries for macOS arm64 native modules. */
const ALLOWED_MACOS_LIBRARIES = new Set([
  "/usr/lib/libc++.1.dylib",
  "/usr/lib/libSystem.B.dylib",
]);

/** Parse `readelf -d` output and return the NEEDED soname entries. */
export function parseElfNeeded(readelfOutput: string): string[] {
  const needed: string[] = [];
  for (const line of readelfOutput.split("\n")) {
    const match = line.match(/^\s*0x[0-9a-f]+\s+\(NEEDED\)\s+Shared library:\s+\[([^\]]+)\]/i);
    if (match) needed.push(match[1]);
  }
  return needed;
}

function isAllowedLinuxSoname(soname: string): boolean {
  return ALLOWED_LINUX_SONAME_PATTERNS.some((pattern) => pattern.test(soname));
}

export function verifyNativeLinkage(
  requireFromConsumer: Require,
  baselineNativeModules: ReadonlySet<string> = new Set(),
): string[] {
  const nativeModules = currentNativeModules(requireFromConsumer).filter(
    (path) => !baselineNativeModules.has(path),
  );
  invariant(
    nativeModules.length === EXPECTED_NATIVE_MODULE_COUNT,
    `expected ${EXPECTED_NATIVE_MODULE_COUNT} loaded native modules, got ${nativeModules.length}`,
  );

  const isLinux = process.platform === "linux";
  for (const nativeModule of nativeModules) {
    const fileOutput = runCommand("file", [nativeModule]);
    if (isLinux) {
      invariant(
        fileOutput.includes("ELF 64-bit LSB shared object") && fileOutput.includes("x86-64"),
        `${nativeModule} is not an ELF 64-bit LSB x86-64 shared object: ${fileOutput.trim()}`,
      );
      const readelfOutput = runCommand("readelf", ["-d", nativeModule]);
      const needed = parseElfNeeded(readelfOutput);
      invariant(needed.length > 0, `${nativeModule} has no recorded NEEDED dynamic entries`);
      for (const soname of needed) {
        invariant(
          isAllowedLinuxSoname(soname),
          `${nativeModule} links non-system library ${soname}`,
        );
      }
    } else {
      invariant(
        fileOutput.includes("Mach-O 64-bit bundle arm64"),
        `${nativeModule} is not a Mach-O 64-bit arm64 bundle: ${fileOutput.trim()}`,
      );
      const linkedLibraries = runCommand("otool", ["-L", nativeModule])
        .split("\n")
        .slice(1)
        .map((line) => line.trim().split(/\s+\(/, 1)[0])
        .filter(Boolean);
      invariant(linkedLibraries.length > 0, `${nativeModule} has no recorded dynamic linkage`);
      for (const library of linkedLibraries) {
        invariant(
          ALLOWED_MACOS_LIBRARIES.has(library),
          `${nativeModule} links non-system library ${library}`,
        );
      }
    }
  }
  return nativeModules;
}

function verifyPatchedRuntimeModule(
  requireFromConsumer: Require,
  nativeModules: readonly string[],
): string {
  const packageRoot = dirname(realpathSync(requireFromConsumer.resolve("tree-sitter/package.json")));
  const runtimeModules = nativeModules.filter(
    (nativeModule) => nativeModule.startsWith(`${packageRoot}${sep}`),
  );
  invariant(
    runtimeModules.length === 1,
    `expected one patched tree-sitter runtime under ${packageRoot}, got ${runtimeModules.length}`,
  );
  invariant(
    runtimeModules[0].endsWith("tree_sitter_runtime_binding.node"),
    `unexpected tree-sitter runtime module: ${runtimeModules[0]}`,
  );
  return runtimeModules[0];
}

function findPackageRoot(requireFromConsumer: Require, packageName: string): string {
  let cursor = dirname(realpathSync(requireFromConsumer.resolve(packageName)));
  while (true) {
    const manifestPath = resolve(cursor, "package.json");
    if (existsSync(manifestPath)) {
      const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { name?: string };
      if (manifest.name === packageName) return realpathSync(cursor);
    }
    const parent = dirname(cursor);
    invariant(parent !== cursor, `could not locate package root for ${packageName}`);
    cursor = parent;
  }
}

function verifyExactNativePackagePaths(
  requireFromConsumer: Require,
  nativeModules: readonly string[],
  expectedRuntimePackage: string,
): { packagePaths: number; runtimePackage: string; runtimeModule: string } {
  const roots = new Map(
    TRUSTED_NATIVE_PACKAGES.map((packageName) => [
      packageName,
      findPackageRoot(requireFromConsumer, packageName),
    ]),
  );
  const runtimePackage = roots.get("tree-sitter");
  invariant(runtimePackage, "packed consumer tree-sitter package root is missing");
  invariant(
    runtimePackage === realpathSync(expectedRuntimePackage),
    `packed consumer resolved tree-sitter from ${runtimePackage}, expected ${expectedRuntimePackage}`,
  );

  const matchedPackages = new Set<string>();
  for (const nativeModule of nativeModules) {
    const owners = [...roots.entries()].filter(([, root]) =>
      nativeModule.startsWith(`${root}${sep}`)
    );
    invariant(
      owners.length === 1,
      `${nativeModule} belongs to ${owners.length} audited package roots`,
    );
    matchedPackages.add(owners[0][0]);
  }
  invariant(
    matchedPackages.size === TRUSTED_NATIVE_PACKAGES.length,
    `native inventory covered ${matchedPackages.size}/${TRUSTED_NATIVE_PACKAGES.length} audited packages`,
  );

  const runtimeModule = verifyPatchedRuntimeModule(requireFromConsumer, nativeModules);
  const expectedRuntimeModule = realpathSync(
    resolve(runtimePackage, "build/Release/tree_sitter_runtime_binding.node"),
  );
  invariant(
    runtimeModule === expectedRuntimeModule,
    `packed consumer loaded alternate tree-sitter addon ${runtimeModule}`,
  );
  return {
    packagePaths: matchedPackages.size,
    runtimePackage,
    runtimeModule,
  };
}

export function assertCompatibleNativeAbi(
  packageName: string,
  actualAbi: number,
  expectedAbi: number,
): void {
  if (actualAbi === expectedAbi) return;
  const error = new Error(
    `${packageName} native ABI ${actualAbi} is incompatible with runtime ABI ${expectedAbi}`,
  ) as NativeAbiFailure;
  error.code = "INCOMPATIBLE_NATIVE_ABI";
  throw error;
}

function createConsumerRequire(consumer: ConsumerKind): Require {
  return createRequire(pathToFileURL(CORE_CONSUMER_ENTRIES[consumer]));
}

export function runDiscriminationSensors(
  requireFromConsumer: Require = createConsumerRequire("source"),
): { missing: true; incompatible: true } {
  let missing = false;
  try {
    requireFromConsumer.resolve("tree-sitter-intentionally-missing");
  } catch {
    missing = true;
  }
  invariant(missing, "missing grammar discrimination sensor did not detect absence");

  let incompatible = false;
  try {
    assertCompatibleNativeAbi(
      "tree-sitter-incompatible-sensor",
      EXPECTED_NATIVE_MODULE_ABI - 1,
      EXPECTED_NATIVE_MODULE_ABI,
    );
  } catch (error) {
    incompatible = error instanceof Error &&
      (error as Partial<NativeAbiFailure>).code === "INCOMPATIBLE_NATIVE_ABI";
  }
  invariant(incompatible, "incompatible ABI discrimination sensor did not fail closed");
  return { missing: true, incompatible: true };
}

async function loadJavascriptRuntime(requireFromConsumer: Require): Promise<{
  Parser: ParserConstructor;
  language: unknown;
}> {
  return withMaskedBunVersion(() => ({
    Parser: requireFromConsumer("tree-sitter") as ParserConstructor,
    language: requireFromConsumer("tree-sitter-javascript"),
  }));
}

function expectDeterministicThrow(
  sensor: string,
  action: () => unknown,
  expectedMessage: string,
): string {
  let thrown: unknown;
  try {
    action();
  } catch (error) {
    thrown = error;
  }
  invariant(thrown instanceof Error, `${sensor} did not throw`);
  invariant(
    thrown.message.includes(expectedMessage),
    `${sensor} threw unexpected error: ${thrown.message}`,
  );
  return thrown.message;
}

function assertImmutableTreeOwner(
  sensor: string,
  target: SyntaxNode | TreeCursor,
  expectedTree: ParsedTree,
  replacementTree: ParsedTree,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(target, "tree");
  invariant(descriptor?.value === expectedTree, `${sensor} owner identity is not bound`);
  invariant(descriptor.writable === false, `${sensor} owner identity is writable`);
  invariant(descriptor.configurable === false, `${sensor} owner identity is configurable`);
  try {
    target.tree = replacementTree;
  } catch {
    // Strict runtimes throw; non-strict CommonJS may ignore the assignment.
  }
  invariant(target.tree === expectedTree, `${sensor} owner substitution succeeded`);
}

async function verifyPatchBehaviorForRequire(
  requireFromConsumer: Require,
  patchedRuntimeModule: string,
): Promise<PatchBehaviorResult> {
  const { Parser, language } = await loadJavascriptRuntime(requireFromConsumer);
  const parser = new Parser();
  parser.setLanguage(language);

  const tree = parser.parse("const answer = 42;");
  let cachedNode!: SyntaxNode;
  let query!: { captures(node: SyntaxNode): unknown[] };
  try {
    cachedNode = tree.rootNode;
    query = new Parser.Query(language, "(identifier) @identifier");
  } finally {
    tree.delete();
    tree.delete();
  }
  const cachedNodeMessage = expectDeterministicThrow(
    "cached node after tree delete",
    () => cachedNode.type,
    "Argument must be a live tree",
  );
  const queryMessage = expectDeterministicThrow(
    "query after tree delete",
    () => query.captures(cachedNode),
    "Missing argument tree",
  );
  const oldTreeMessage = expectDeterministicThrow(
    "parser oldTree after tree delete",
    () => parser.parse("const answer = 43;", tree),
    "Second argument must be a tree",
  );

  const cursorDeleteTree = parser.parse("const cursor = 1;");
  let cursorDeleteMessage: string;
  try {
    const cursor = cursorDeleteTree.rootNode.walk();
    cursor.delete();
    cursor.delete();
    cursorDeleteMessage = expectDeterministicThrow(
      "cursor after cursor delete",
      () => cursor.currentNode,
      "Tree cursor has been deleted or its tree is not live",
    );
  } finally {
    cursorDeleteTree.delete();
  }

  const cursorTree = parser.parse("const cursorTree = 2;");
  let cursorAfterTree!: TreeCursor;
  try {
    cursorAfterTree = cursorTree.rootNode.walk();
  } finally {
    cursorTree.delete();
  }
  const cursorAfterTreeMessage = expectDeterministicThrow(
    "cursor after tree delete",
    () => cursorAfterTree.currentNode,
    "Tree cursor has been deleted or its tree is not live",
  );

  const replacementTree = parser.parse("const replacement = 3;");
  let nodeOwnerSubstitutionMessage: string;
  let cursorOwnerSubstitutionMessage: string;
  try {
    assertImmutableTreeOwner("cached node", cachedNode, tree, replacementTree);
    nodeOwnerSubstitutionMessage = expectDeterministicThrow(
      "cached node after owner substitution attempt",
      () => cachedNode.type,
      "Argument must be a live tree",
    );
    assertImmutableTreeOwner("stale cursor", cursorAfterTree, cursorTree, replacementTree);
    cursorOwnerSubstitutionMessage = expectDeterministicThrow(
      "stale cursor after owner substitution attempt",
      () => cursorAfterTree.currentNode,
      "Tree cursor has been deleted or its tree is not live",
    );
  } finally {
    cursorAfterTree.delete();
    replacementTree.delete();
  }

  const transferTreeOne = parser.parse("const transferOne = 1;");
  const transferTreeTwo = parser.parse("const transferTwo = 2;");
  const transferCursorOne = transferTreeOne.rootNode.walk();
  const transferCursorPeer = transferTreeOne.rootNode.walk();
  const transferCursorTwo = transferTreeTwo.rootNode.walk();
  let cursorResetCrossTreeMessage: string;
  let cursorResetToCrossTreeMessage: string;
  try {
    transferCursorOne.reset(transferTreeOne.rootNode);
    invariant(
      transferCursorOne.currentNode.type === transferTreeOne.rootNode.type,
      "same-tree cursor reset did not preserve the node",
    );
    transferCursorOne.resetTo(transferCursorPeer);
    invariant(
      transferCursorOne.currentNode.type === transferCursorPeer.currentNode.type,
      "same-tree cursor resetTo did not preserve the position",
    );
    cursorResetCrossTreeMessage = expectDeterministicThrow(
      "cursor reset with cross-tree node",
      () => transferCursorOne.reset(transferTreeTwo.rootNode),
      "same tree",
    );

    let resetToError: unknown;
    try {
      transferCursorOne.resetTo(transferCursorTwo);
    } catch (error) {
      resetToError = error;
    }
    if (!(resetToError instanceof Error)) {
      transferTreeTwo.delete();
      // The vulnerable binding dereferences freed tree-two state here and crashes the child.
      void transferCursorOne.currentNode.type;
      throw new Error("cursor resetTo cross-tree transfer did not fail closed");
    }
    invariant(
      resetToError.message.includes("same tree"),
      `cursor resetTo cross-tree transfer threw unexpected error: ${resetToError.message}`,
    );
    cursorResetToCrossTreeMessage = resetToError.message;
  } finally {
    transferCursorOne.delete();
    transferCursorPeer.delete();
    transferCursorTwo.delete();
    transferTreeOne.delete();
    transferTreeTwo.delete();
  }

  return {
    status: "PASS",
    pid: process.pid,
    bun: process.versions.bun ?? "",
    patchedRuntimeModule,
    sensors: {
      doubleDelete: true,
      cachedNode: cachedNodeMessage,
      query: queryMessage,
      parserOldTree: oldTreeMessage,
      cursorDelete: cursorDeleteMessage,
      cursorAfterTree: cursorAfterTreeMessage,
      nodeOwnerSubstitution: nodeOwnerSubstitutionMessage,
      cursorOwnerSubstitution: cursorOwnerSubstitutionMessage,
      cursorResetCrossTree: cursorResetCrossTreeMessage,
      cursorResetToCrossTree: cursorResetToCrossTreeMessage,
    },
  };
}

async function verifyPatchBehaviorInCurrentProcess(): Promise<PatchBehaviorResult> {
  assertRuntimeTarget();
  const entry = realpathSync(verifyConsumerEntries().source);
  await import(pathToFileURL(entry).href);
  const requireFromConsumer = createRequire(pathToFileURL(entry));
  const baselineNativeModules = new Set(currentNativeModules(requireFromConsumer));
  await loadJavascriptRuntime(requireFromConsumer);
  const runtimeModules = currentNativeModules(requireFromConsumer).filter(
    (path) => !baselineNativeModules.has(path),
  );
  const patchedRuntimeModule = verifyPatchedRuntimeModule(requireFromConsumer, runtimeModules);
  return verifyPatchBehaviorForRequire(requireFromConsumer, patchedRuntimeModule);
}

function median(values: readonly number[]): number {
  invariant(values.length > 0, "median requires at least one value");
  const ordered = [...values].sort((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0
    ? (ordered[middle - 1] + ordered[middle]) / 2
    : ordered[middle];
}

function rssSensorSource(): string {
  return Array.from(
    { length: 768 },
    (_, index) => `function value_${index}(input) { return input + ${index}; }\n`,
  ).join("");
}

function runRssParseCycle(
  parser: ParserInstance,
  source: string,
  mode: "patched" | "control",
  cycle: number,
): void {
  const tree = parser.parse(source);
  try {
    invariant(!tree.rootNode.hasError, `${mode} RSS cycle ${cycle} produced a parse error`);
  } finally {
    if (mode === "patched") tree.delete();
    // The control intentionally omits delete to prove the verifier can
    // discriminate the native retention defect fixed by the patch. Returning
    // from this function drops the JS tree/root references before forced GC.
  }
}

async function runRssSensorInCurrentProcess(
  mode: "patched" | "control",
): Promise<RssSensorResult> {
  assertRuntimeTarget();
  const entry = realpathSync(verifyConsumerEntries().source);
  await import(pathToFileURL(entry).href);
  const requireFromConsumer = createRequire(pathToFileURL(entry));
  const baselineNativeModules = new Set(currentNativeModules(requireFromConsumer));
  const { Parser, language } = await loadJavascriptRuntime(requireFromConsumer);
  const runtimeModules = currentNativeModules(requireFromConsumer).filter(
    (path) => !baselineNativeModules.has(path),
  );
  const patchedRuntimeModule = verifyPatchedRuntimeModule(requireFromConsumer, runtimeModules);
  const parser = new Parser();
  parser.setLanguage(language);
  const source = rssSensorSource();
  invariant(Buffer.byteLength(source) >= 32 * 1024, "RSS sensor source is smaller than 32 KiB");
  const samples: number[] = [];

  for (let cycle = 0; cycle < RSS_SENSOR_CYCLES; cycle += 1) {
    runRssParseCycle(parser, source, mode, cycle + 1);
    Bun.gc(true);
    samples.push(process.memoryUsage().rss);
  }

  const firstRss = samples[0];
  const lastRss = samples.at(-1) ?? firstRss;
  const growthBytes = lastRss - firstRss;
  const cycles21To40Median = median(samples.slice(20, 40));
  const cycles81To100Median = median(samples.slice(80, 100));
  if (mode === "patched") {
    invariant(
      cycles81To100Median <= cycles21To40Median + RSS_DISCRIMINATION_BYTES,
      `patched RSS median grew ${cycles81To100Median - cycles21To40Median} bytes`,
    );
  } else {
    invariant(
      growthBytes > RSS_DISCRIMINATION_BYTES,
      `no-delete control grew only ${growthBytes} bytes`,
    );
  }

  return {
    status: "PASS",
    mode,
    pid: process.pid,
    bun: process.versions.bun ?? "",
    cycles: RSS_SENSOR_CYCLES,
    firstRss,
    lastRss,
    growthBytes,
    cycles21To40Median,
    cycles81To100Median,
    patchedRuntimeModule,
  };
}

async function verifyConsumerInCurrentProcess(
  consumer: ConsumerKind,
): Promise<ConsumerVerificationResult> {
  assertRuntimeTarget();
  const entries = verifyConsumerEntries();
  const entry = realpathSync(entries[consumer]);

  await import(pathToFileURL(entry).href);
  const requireFromConsumer = createRequire(pathToFileURL(entry));
  const baselineNativeModules = new Set(currentNativeModules(requireFromConsumer));
  const resolvable = verifyConsumerResolution(consumer, requireFromConsumer);
  const loaded = await loadNativeGrammarSet(requireFromConsumer);
  const parses = runMinimalParses(consumer, loaded);
  const nativeModules = verifyNativeLinkage(requireFromConsumer, baselineNativeModules);
  const patchedRuntimeModule = verifyPatchedRuntimeModule(requireFromConsumer, nativeModules);

  return {
    status: "PASS",
    consumer,
    pid: process.pid,
    bun: process.versions.bun ?? "",
    entry,
    entryImported: true,
    resolvable,
    parses,
    nativeModules: nativeModules.length,
    patchedRuntimeModule,
  };
}

export async function verifyPackedConsumerInCurrentProcess(
  entryPath: string,
  expectedRuntimePackage: string,
): Promise<PackedConsumerVerificationResult> {
  assertRuntimeTarget();
  const entry = realpathSync(entryPath);
  invariant(statSync(entry).isFile(), `packed consumer entry is not a file: ${entry}`);
  await import(pathToFileURL(entry).href);
  const requireFromConsumer = createRequire(pathToFileURL(entry));
  const baselineNativeModules = new Set(currentNativeModules(requireFromConsumer));
  const resolvable = verifyConsumerResolution("packed", requireFromConsumer);
  const loaded = await loadNativeGrammarSet(requireFromConsumer);
  const parses = runMinimalParses("packed", loaded);
  const nativeModules = verifyNativeLinkage(requireFromConsumer, baselineNativeModules);
  const inventory = verifyExactNativePackagePaths(
    requireFromConsumer,
    nativeModules,
    expectedRuntimePackage,
  );
  const behavior = await verifyPatchBehaviorForRequire(
    requireFromConsumer,
    inventory.runtimeModule,
  );

  return {
    status: "PASS",
    consumer: "packed",
    pid: process.pid,
    bun: process.versions.bun ?? "",
    entry,
    resolvable,
    parses,
    nativeModules: nativeModules.length,
    nativePackagePaths: inventory.packagePaths,
    patchedRuntimePackage: inventory.runtimePackage,
    patchedRuntimeModule: inventory.runtimeModule,
    behaviorSensors: Object.keys(behavior.sensors).length,
  };
}

function parseConsumerResult(consumer: ConsumerKind, stdout: string): ConsumerVerificationResult {
  const resultLine = stdout
    .split("\n")
    .findLast((line) => line.startsWith(CONSUMER_RESULT_PREFIX));
  invariant(resultLine, `${consumer} verifier did not emit a result record`);
  const result = JSON.parse(resultLine.slice(CONSUMER_RESULT_PREFIX.length)) as
    Partial<ConsumerVerificationResult>;
  invariant(result.status === "PASS", `${consumer} verifier did not pass`);
  invariant(result.consumer === consumer, `${consumer} verifier returned the wrong consumer`);
  invariant(result.bun === EXPECTED_BUN_VERSION, `${consumer} verifier used Bun ${result.bun}`);
  invariant(result.entryImported === true, `${consumer} entry was not imported`);
  invariant(
    result.entry === realpathSync(CORE_CONSUMER_ENTRIES[consumer]),
    `${consumer} verifier used the wrong entry: ${result.entry}`,
  );
  invariant(
    result.resolvable === TRUSTED_NATIVE_PACKAGES.length,
    `${consumer} resolved ${result.resolvable}/${TRUSTED_NATIVE_PACKAGES.length} native packages`,
  );
  invariant(
    result.parses === MINIMAL_PARSE_CASES.length,
    `${consumer} parsed ${result.parses}/${MINIMAL_PARSE_CASES.length} extensions`,
  );
  invariant(
    result.nativeModules === EXPECTED_NATIVE_MODULE_COUNT,
    `${consumer} linked ${result.nativeModules}/${EXPECTED_NATIVE_MODULE_COUNT} native modules`,
  );
  invariant(
    typeof result.patchedRuntimeModule === "string" &&
      result.patchedRuntimeModule.endsWith("tree_sitter_runtime_binding.node") &&
      existsSync(result.patchedRuntimeModule),
    `${consumer} did not load the patched tree-sitter runtime module`,
  );
  invariant(typeof result.pid === "number" && result.pid > 0, `${consumer} verifier PID is invalid`);
  return result as ConsumerVerificationResult;
}

function runColdConsumerProcess(consumer: ConsumerKind): ConsumerVerificationResult {
  const result = Bun.spawnSync([process.execPath, SCRIPT_PATH, "--consumer", consumer], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: VERIFIER_DATABASE_URL },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = textDecoder.decode(result.stdout);
  const stderr = textDecoder.decode(result.stderr);
  invariant(
    result.exitCode === 0,
    `${consumer} cold verifier failed (${result.exitCode}): ${stderr || stdout}`,
  );
  return parseConsumerResult(consumer, stdout);
}

export function verifyColdConsumerProcesses(): {
  source: ConsumerVerificationResult;
  dist: ConsumerVerificationResult;
} {
  verifyConsumerEntries();
  const source = runColdConsumerProcess("source");
  const dist = runColdConsumerProcess("dist");
  invariant(source.pid !== dist.pid, "source and dist verifications reused one process");
  invariant(source.pid !== process.pid && dist.pid !== process.pid, "consumer verifier was not cold");
  return { source, dist };
}

function runColdScript(args: string[], label: string): string {
  const result = Bun.spawnSync([process.execPath, SCRIPT_PATH, ...args], {
    cwd: ROOT,
    env: { ...process.env, DATABASE_URL: VERIFIER_DATABASE_URL },
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = textDecoder.decode(result.stdout);
  const stderr = textDecoder.decode(result.stderr);
  invariant(result.exitCode === 0, `${label} failed (${result.exitCode}): ${stderr || stdout}`);
  return stdout;
}

export function verifyPatchBehaviorProcess(): PatchBehaviorResult {
  const stdout = runColdScript(["--behavior-sensors"], "patch behavior child");
  const resultLine = stdout.split("\n").findLast((line) => line.startsWith(BEHAVIOR_RESULT_PREFIX));
  invariant(resultLine, "patch behavior child did not emit a result record");
  const result = JSON.parse(resultLine.slice(BEHAVIOR_RESULT_PREFIX.length)) as PatchBehaviorResult;
  invariant(result.status === "PASS", "patch behavior child did not pass");
  invariant(result.bun === EXPECTED_BUN_VERSION, `patch behavior child used Bun ${result.bun}`);
  invariant(result.pid > 0 && result.pid !== process.pid, "patch behavior child was not cold");
  invariant(result.sensors.doubleDelete === true, "double-delete sensor did not pass");
  for (const [sensor, message] of Object.entries(result.sensors)) {
    if (sensor === "doubleDelete") continue;
    invariant(typeof message === "string" && message.length > 0, `${sensor} sensor did not throw`);
  }
  invariant(
    existsSync(result.patchedRuntimeModule) &&
      result.patchedRuntimeModule.endsWith("tree_sitter_runtime_binding.node"),
    "patch behavior child did not use the patched runtime module",
  );
  return result;
}

function runColdRssSensor(mode: "patched" | "control"): RssSensorResult {
  const stdout = runColdScript(["--rss-sensor", mode], `${mode} RSS child`);
  const resultLine = stdout.split("\n").findLast((line) => line.startsWith(RSS_RESULT_PREFIX));
  invariant(resultLine, `${mode} RSS child did not emit a result record`);
  const result = JSON.parse(resultLine.slice(RSS_RESULT_PREFIX.length)) as RssSensorResult;
  invariant(result.status === "PASS" && result.mode === mode, `${mode} RSS child did not pass`);
  invariant(result.bun === EXPECTED_BUN_VERSION, `${mode} RSS child used Bun ${result.bun}`);
  invariant(result.pid > 0 && result.pid !== process.pid, `${mode} RSS child was not cold`);
  invariant(result.cycles === RSS_SENSOR_CYCLES, `${mode} RSS child ran ${result.cycles} cycles`);
  invariant(
    existsSync(result.patchedRuntimeModule) &&
      result.patchedRuntimeModule.endsWith("tree_sitter_runtime_binding.node"),
    `${mode} RSS child did not use the patched runtime module`,
  );
  return result;
}

export function verifyRssDiscriminationProcesses(): {
  patched: RssSensorResult;
  control: RssSensorResult;
} {
  const control = runColdRssSensor("control");
  const patched = runColdRssSensor("patched");
  invariant(control.pid !== patched.pid, "RSS sensors reused one process");
  invariant(
    control.growthBytes > RSS_DISCRIMINATION_BYTES,
    `no-delete control grew only ${control.growthBytes} bytes`,
  );
  invariant(
    patched.cycles81To100Median <=
      patched.cycles21To40Median + RSS_DISCRIMINATION_BYTES,
    `patched RSS median grew ${patched.cycles81To100Median - patched.cycles21To40Median} bytes`,
  );
  return { patched, control };
}

export async function verifyTreeSitterNative(): Promise<void> {
  assertRuntimeTarget();
  const contract = verifyStaticContract();
  verifyConsumerEntries();
  await verifyBunMaskRestoration();
  const consumers = verifyColdConsumerProcesses();
  const behavior = verifyPatchBehaviorProcess();
  const rss = verifyRssDiscriminationProcesses();
  const sensors = runDiscriminationSensors();

  console.log(JSON.stringify({
    status: "PASS",
    target: `${process.platform}-${process.arch}`,
    bun: process.versions.bun,
    nodeBuildHelper: EXPECTED_NODE_BUILD_VERSION,
    extensions: contract.extensions,
    nativeDependencies: contract.nativeDependencies,
    trustedDependencies: contract.trustedDependencies,
    lockedIdentities: contract.lockedIdentities,
    patchedDependencies: contract.patchedDependencies,
    patchSha256: TREE_SITTER_PATCH.sha256,
    coldConsumerProcesses: 2,
    sourceEntry: consumers.source.entry,
    distEntry: consumers.dist.entry,
    sourcePid: consumers.source.pid,
    distPid: consumers.dist.pid,
    sourceResolvable: consumers.source.resolvable,
    distResolvable: consumers.dist.resolvable,
    sourceParses: consumers.source.parses,
    distParses: consumers.dist.parses,
    sourceNativeModules: consumers.source.nativeModules,
    distNativeModules: consumers.dist.nativeModules,
    nativeModuleChecks: consumers.source.nativeModules + consumers.dist.nativeModules,
    patchedRuntimeModules: {
      source: consumers.source.patchedRuntimeModule,
      dist: consumers.dist.patchedRuntimeModule,
      behavior: behavior.patchedRuntimeModule,
      rssPatched: rss.patched.patchedRuntimeModule,
      rssControl: rss.control.patchedRuntimeModule,
    },
    behaviorSensors: Object.keys(behavior.sensors).length,
    rss: {
      cycles: RSS_SENSOR_CYCLES,
      patchedMedianDeltaBytes:
        rss.patched.cycles81To100Median - rss.patched.cycles21To40Median,
      controlGrowthBytes: rss.control.growthBytes,
      thresholdBytes: RSS_DISCRIMINATION_BYTES,
    },
    sensors,
  }));
}

if (import.meta.main) {
  const consumerArgumentIndex = process.argv.indexOf("--consumer");
  const requestedConsumer = consumerArgumentIndex >= 0
    ? process.argv[consumerArgumentIndex + 1]
    : undefined;
  const rssArgumentIndex = process.argv.indexOf("--rss-sensor");
  const requestedRssMode = rssArgumentIndex >= 0 ? process.argv[rssArgumentIndex + 1] : undefined;
  const packedArgumentIndex = process.argv.indexOf("--packed-consumer");
  const packedEntry = packedArgumentIndex >= 0 ? process.argv[packedArgumentIndex + 1] : undefined;
  const packedRuntimePackage = packedArgumentIndex >= 0
    ? process.argv[packedArgumentIndex + 2]
    : undefined;
  let operation: Promise<void>;
  if (packedEntry && packedRuntimePackage) {
    operation = verifyPackedConsumerInCurrentProcess(packedEntry, packedRuntimePackage).then(
      (result) => {
        console.log(`${PACKED_CONSUMER_RESULT_PREFIX}${JSON.stringify(result)}`);
      },
    );
  } else if (requestedConsumer === "source" || requestedConsumer === "dist") {
    operation = verifyConsumerInCurrentProcess(requestedConsumer).then((result) => {
      console.log(`${CONSUMER_RESULT_PREFIX}${JSON.stringify(result)}`);
    });
  } else if (process.argv.includes("--behavior-sensors")) {
    operation = verifyPatchBehaviorInCurrentProcess().then((result) => {
      console.log(`${BEHAVIOR_RESULT_PREFIX}${JSON.stringify(result)}`);
    });
  } else if (requestedRssMode === "patched" || requestedRssMode === "control") {
    operation = runRssSensorInCurrentProcess(requestedRssMode).then((result) => {
      console.log(`${RSS_RESULT_PREFIX}${JSON.stringify(result)}`);
    });
  } else {
    operation = verifyTreeSitterNative();
  }
  operation.catch((error) => {
    console.error(JSON.stringify({
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }));
    process.exitCode = 1;
  });
}
