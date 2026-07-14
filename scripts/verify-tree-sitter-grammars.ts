#!/usr/bin/env bun

import { createHash } from "node:crypto";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createRequire, type Require } from "node:module";
import { dirname, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { flattenDiagnosticMessageText, parseConfigFileTextToJson } from "typescript";

export const EXPECTED_BUN_VERSION = "1.3.0";
export const EXPECTED_NODE_BUILD_VERSION = "22.22.2";
export const EXPECTED_NATIVE_MODULE_ABI = 137;
export const EXPECTED_NATIVE_MODULE_COUNT = 27;
export const TREE_SITTER_PATCH = Object.freeze({
  package: "tree-sitter@0.25.0",
  path: "patches/tree-sitter@0.25.0.patch",
  sha256: "b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a",
});
const RSS_DISCRIMINATION_BYTES = 16 * 1024 * 1024;
const RSS_SENSOR_CYCLES = 100;
const VERIFIER_DATABASE_URL =
  "postgresql://tree_sitter_verifier:tree_sitter_verifier@127.0.0.1:1/tree_sitter_verifier";

export const NATIVE_DEPENDENCIES = {
  "@tree-sitter-grammars/tree-sitter-kotlin": "1.1.0",
  "@tree-sitter-grammars/tree-sitter-lua": "0.4.1",
  "@tree-sitter-grammars/tree-sitter-markdown": "0.3.2",
  "@tree-sitter-grammars/tree-sitter-yaml": "0.7.1",
  "@tree-sitter-grammars/tree-sitter-zig": "1.1.2",
  "tree-sitter": "0.25.0",
  "tree-sitter-c": "0.24.1",
  "tree-sitter-c-sharp": "0.23.5",
  "tree-sitter-clojure-orchard": "0.2.5",
  "tree-sitter-cpp": "0.23.4",
  "tree-sitter-dart":
    "github:UserNobody14/tree-sitter-dart#be07cf7118d3dba06236a3f19541685a68209934",
  "tree-sitter-elixir": "0.3.5",
  "tree-sitter-erlang":
    "github:WhatsApp/tree-sitter-erlang#836aa2b6c3af2c7cef3f84049b0ed6d44485a870",
  "tree-sitter-go": "0.25.0",
  "tree-sitter-haskell": "0.23.1",
  "tree-sitter-html": "0.23.2",
  "tree-sitter-java": "0.23.5",
  "tree-sitter-javascript": "0.25.0",
  "tree-sitter-json": "0.24.8",
  "tree-sitter-ocaml": "0.24.2",
  "tree-sitter-php": "0.24.2",
  "tree-sitter-python": "0.25.0",
  "tree-sitter-ruby": "0.23.1",
  "tree-sitter-rust": "0.24.0",
  "tree-sitter-scala": "0.24.0",
  "tree-sitter-swift": "0.7.1",
  "tree-sitter-typescript": "0.23.2",
} as const;

type NativeLockIdentity =
  | { resolved: string; sri: `sha512-${string}` }
  | { resolved: string; gitIdentity: string };

export const NATIVE_LOCK_IDENTITIES: Record<keyof typeof NATIVE_DEPENDENCIES, NativeLockIdentity> = {
  "@tree-sitter-grammars/tree-sitter-kotlin": {
    resolved: "@tree-sitter-grammars/tree-sitter-kotlin@1.1.0",
    sri: "sha512-vlVXaxEE8t2kpJgfZpa8XVvxcnKw9AYtRTgy7KWjsDmAsadk06RxAT80IXOgGQnmM9i/orQn1nD84gPNUHu6DQ==",
  },
  "@tree-sitter-grammars/tree-sitter-lua": {
    resolved: "@tree-sitter-grammars/tree-sitter-lua@0.4.1",
    sri: "sha512-EwagFaU6ZveVk18/Y8qUhZkkiBKnQ7dSCHbm//TUroLVKy3i1rOYGy/cNHtSkAb1eDvS1HhCLybH2S541Cya/g==",
  },
  "@tree-sitter-grammars/tree-sitter-markdown": {
    resolved: "@tree-sitter-grammars/tree-sitter-markdown@0.3.2",
    sri: "sha512-hQXCcDVvg2t4E8cn7zz6jjIBerzk9E9ZlHxJp5IrUOpY4s1YVpXJbMeWZks2/V7lmkPRnnkM8IrTbQ5ltwEOnA==",
  },
  "@tree-sitter-grammars/tree-sitter-yaml": {
    resolved: "@tree-sitter-grammars/tree-sitter-yaml@0.7.1",
    sri: "sha512-AynBwkIoQCTgjDR33bDUp9Mqq+YTco0is3n5hRApMqG9of/6A4eQsfC1/uSEeHSUyMQSYawcAWamsexnVpIP4Q==",
  },
  "@tree-sitter-grammars/tree-sitter-zig": {
    resolved: "@tree-sitter-grammars/tree-sitter-zig@1.1.2",
    sri: "sha512-J0L31HZ2isy3F5zb2g5QWQOv2r/pbruQNL9ADhuQv2pn5BQOzxt80WcEJaYXBeuJ8GHxVT42slpCna8k1c8LOw==",
  },
  "tree-sitter": {
    resolved: "tree-sitter@0.25.0",
    sri: "sha512-PGZZzFW63eElZJDe/b/R/LbsjDDYJa5UEjLZJB59RQsMX+fo0j54fqBPn1MGKav/QNa0JR0zBiVaikYDWCj5KQ==",
  },
  "tree-sitter-c": {
    resolved: "tree-sitter-c@0.24.1",
    sri: "sha512-lkYwWN3SRecpvaeqmFKkuPNR3ZbtnvHU+4XAEEkJdrp3JfSp2pBrhXOtvfsENUneye76g889Y0ddF2DM0gEDpA==",
  },
  "tree-sitter-c-sharp": {
    resolved: "tree-sitter-c-sharp@0.23.5",
    sri: "sha512-xJGOeXPMmld0nES5+080N/06yY6LQi+KWGWV4LfZaZe6srJPtUtfhIbRSN7EZN6IaauzW28v6W4QHFwmeUW6HQ==",
  },
  "tree-sitter-clojure-orchard": {
    resolved: "tree-sitter-clojure-orchard@0.2.5",
    sri: "sha512-X+JaSnqY9hNYDA/hsQ40My47qoG+J26y11VAZ4YUzH3u8ggs+b9sFRQuxE6pNnlgwqWtJUycxnB0cOomtOIvAw==",
  },
  "tree-sitter-cpp": {
    resolved: "tree-sitter-cpp@0.23.4",
    sri: "sha512-qR5qUDyhZ5jJ6V8/umiBxokRbe89bCGmcq/dk94wI4kN86qfdV8k0GHIUEKaqWgcu42wKal5E97LKpLeVW8sKw==",
  },
  "tree-sitter-dart": {
    resolved: "tree-sitter-dart@github:UserNobody14/tree-sitter-dart#be07cf7",
    gitIdentity: "UserNobody14-tree-sitter-dart-be07cf7",
  },
  "tree-sitter-elixir": {
    resolved: "tree-sitter-elixir@0.3.5",
    sri: "sha512-xozQMvYK0aSolcQZAx2d84Xe/YMWFuRPYFlLVxO01bM2GITh5jyiIp0TqPCQa8754UzRAI7A83hZmfiYub5TZQ==",
  },
  "tree-sitter-erlang": {
    resolved: "tree-sitter-erlang@github:WhatsApp/tree-sitter-erlang#836aa2b",
    gitIdentity: "WhatsApp-tree-sitter-erlang-836aa2b",
  },
  "tree-sitter-go": {
    resolved: "tree-sitter-go@0.25.0",
    sri: "sha512-APBc/Dq3xz/e35Xpkhb1blu5UgW+2E3RyGWawZSCNcbGwa7jhSQPS8KsUupuzBla8PCo8+lz9W/JDJjmfRa2tw==",
  },
  "tree-sitter-haskell": {
    resolved: "tree-sitter-haskell@0.23.1",
    sri: "sha512-qG4CYhejveu9DLMLEGBz/n9/TTeGSFLC6wniwOgG6m8/v7Dng8qR0ob0EVG7+XH+9WiOxohpGA23EhceWuxY4w==",
  },
  "tree-sitter-html": {
    resolved: "tree-sitter-html@0.23.2",
    sri: "sha512-TN+l+7cCeLx9db/1RhRSqMAZO/266Oh2BHb8J8hMSSFLuzYvFTYP/UnD3S0mny5awzw05KzFNgu2vnwzN9wVJg==",
  },
  "tree-sitter-java": {
    resolved: "tree-sitter-java@0.23.5",
    sri: "sha512-Yju7oQ0Xx7GcUT01mUglPP+bYfvqjNCGdxqigTnew9nLGoII42PNVP3bHrYeMxswiCRM0yubWmN5qk+zsg0zMA==",
  },
  "tree-sitter-javascript": {
    resolved: "tree-sitter-javascript@0.25.0",
    sri: "sha512-1fCbmzAskZkxcZzN41sFZ2br2iqTYP3tKls1b/HKGNPQUVOpsUxpmGxdN/wMqAk3jYZnYBR1dd/y/0avMeU7dw==",
  },
  "tree-sitter-json": {
    resolved: "tree-sitter-json@0.24.8",
    sri: "sha512-Tc9ZZYwHyWZ3Tt1VEw7Pa2scu1YO7/d2BCBbKTx5hXwig3UfdQjsOPkPyLpDJOn/m1UBEWYAtSdGAwCSyagBqQ==",
  },
  "tree-sitter-ocaml": {
    resolved: "tree-sitter-ocaml@0.24.2",
    sri: "sha512-H0RAeCepIyXyTPCQra6yMd7Bn5ZBYkIaddzdLNwVZpM9mCe2e8av+3O6Ojl7Z8YHrV/kYsfHvI2y+Hh7qzcYQQ==",
  },
  "tree-sitter-php": {
    resolved: "tree-sitter-php@0.24.2",
    sri: "sha512-zwgAePc/HozNaWOOfwRAA+3p8yhuehRw8Fb7vn5qd2XjiIc93uJPryDTMYTSjBRjVIUg/KY6pM3rRzs8dSwKfw==",
  },
  "tree-sitter-python": {
    resolved: "tree-sitter-python@0.25.0",
    sri: "sha512-eCmJx6zQa35GxaCtQD+wXHOhYqBxEL+bp71W/s3fcDMu06MrtzkVXR437dRrCrbrDbyLuUDJpAgycs7ncngLXw==",
  },
  "tree-sitter-ruby": {
    resolved: "tree-sitter-ruby@0.23.1",
    sri: "sha512-d9/RXgWjR6HanN7wTYhS5bpBQLz1VkH048Vm3CodPGyJVnamXMGb8oEhDypVCBq4QnHui9sTXuJBBP3WtCw5RA==",
  },
  "tree-sitter-rust": {
    resolved: "tree-sitter-rust@0.24.0",
    sri: "sha512-NWemUDf629Tfc90Y0Z55zuwPCAHkLxWnMf2RznYu4iBkkrQl2o/CHGB7Cr52TyN5F1DAx8FmUnDtCy9iUkXZEQ==",
  },
  "tree-sitter-scala": {
    resolved: "tree-sitter-scala@0.24.0",
    sri: "sha512-vkMuAUrBZ1zZz2XcGDQk18Kz73JkpgaeXzbNVobPke0G35sd9jH32aUxG6OLRKM7et0TbsfqkWf4DeJoGk4K1g==",
  },
  "tree-sitter-swift": {
    resolved: "tree-sitter-swift@0.7.1",
    sri: "sha512-pneKVTuGamaBsqqqfB9BvNQjktzh/0IVPR54jLB5Fq/JTDQwYHd0Wo6pVyZ5jAYpbztzq+rJ/rpL9ruxTmSoKw==",
  },
  "tree-sitter-typescript": {
    resolved: "tree-sitter-typescript@0.23.2",
    sri: "sha512-e04JUUKxTT53/x3Uq1zIL45DoYKVfHH4CZqwgZhPg5qYROl5nQjV+85ruFzFGZxu+QeFVbRTPDRnqL9UbU4VeA==",
  },
};

export const TRUSTED_NATIVE_PACKAGES = Object.freeze(
  Object.keys(NATIVE_DEPENDENCIES).sort(),
);

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

const ROOT = fileURLToPath(new URL("../", import.meta.url));
const SCRIPT_PATH = fileURLToPath(import.meta.url);
const CONSUMER_RESULT_PREFIX = "TREE_SITTER_CONSUMER_RESULT=";
const BEHAVIOR_RESULT_PREFIX = "TREE_SITTER_BEHAVIOR_RESULT=";
const RSS_RESULT_PREFIX = "TREE_SITTER_RSS_RESULT=";
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
  invariant(process.platform === "darwin", `native verifier requires Darwin, got ${process.platform}`);
  invariant(process.arch === "arm64", `native verifier requires arm64, got ${process.arch}`);
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
    const integrity = record.at(-1);
    if ("sri" in expected) {
      invariant(
        integrity === expected.sri,
        `bun.lock ${packageName} SRI drifted: ${String(integrity)}`,
      );
    } else {
      invariant(
        integrity === expected.gitIdentity,
        `bun.lock ${packageName} Git identity drifted: ${String(integrity)}`,
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
      "bun scripts/verify-tree-sitter-grammars.ts",
    "root native verifier script drifted",
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
    corePackage.dependencies?.["@massa-th0th/shared"] === "1.0.0",
    "core must publish a semver dependency on @massa-th0th/shared",
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
  consumer: ConsumerKind,
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
  consumer: ConsumerKind,
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

function runMinimalParses(consumer: ConsumerKind, loaded: LoadedGrammarSet): number {
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

  const allowedLibraries = new Set([
    "/usr/lib/libc++.1.dylib",
    "/usr/lib/libSystem.B.dylib",
  ]);
  for (const nativeModule of nativeModules) {
    const fileOutput = runCommand("file", [nativeModule]);
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
      invariant(allowedLibraries.has(library), `${nativeModule} links non-system library ${library}`);
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

async function verifyPatchBehaviorInCurrentProcess(): Promise<PatchBehaviorResult> {
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
  let operation: Promise<void>;
  if (requestedConsumer === "source" || requestedConsumer === "dist") {
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
