/**
 * Frozen TS/JS corpus generator for the parser benchmark (TASK-025).
 *
 * Produces a deterministic set of .ts/.tsx/.js/.jsx files under
 * benchmarks/parser/corpus/ and writes corpus-manifest.json recording every
 * file's SHA-256, total bytes, file count, and a single corpus checksum
 * (SHA-256 of the manifest content excluding the checksum field itself).
 *
 * Determinism: no Math.random / Date.now. All content is derived from stable
 * indices. Re-running this script regenerates byte-identical corpus files and
 * the same manifest checksum, so the benchmark can FAIL when the on-disk
 * corpus drifts from the committed manifest.
 *
 * Run: `bun benchmarks/parser/generate-corpus.ts`
 */

import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CORPUS_DIR = resolve(SCRIPT_DIR, "corpus");
const MANIFEST_PATH = resolve(CORPUS_DIR, "corpus-manifest.json");

/** Corpus targets: each extension gets several deterministic modules. */
const SPEC: ReadonlyArray<{ extension: string; modules: number }> = Object.freeze([
  { extension: ".ts", modules: 14 },
  { extension: ".tsx", modules: 10 },
  { extension: ".js", modules: 14 },
  { extension: ".jsx", modules: 10 },
]);

/** Fixed prose seeds so comment/doc content is rich but deterministic. */
const DOC_SEEDS: readonly string[] = Object.freeze([
  "Allocates a bounded lease over the structural parser pool and emits recovered diagnostics.",
  "Resolves a modern FQN through the shared codec, retaining legacy aliases for back-compat.",
  "Projects an HTTP call site onto the canonical route table using best-effort regex evidence.",
  "Aggregates per-language parser status summaries scoped to the active graph generation.",
  "Marshals an embedded source slice through the host byte index for span remapping.",
  "Validates every required grammar before indexing and surfaces readiness separately from liveness.",
  "Serializes competing owners through a database lease token with expected-active CAS.",
  "Bounds diagnostic detail to ten entries per file while preserving exact recovered/hard totals.",
]);

const IDENTIFIERS: readonly string[] = Object.freeze([
  "Parser", "Runtime", "Resolver", "Codec", "Lease", "Cursor", "Grammar",
  "Snapshot", "Generation", "Diagnostic", "Manifest", "Span", "Index", "Pool",
  "Queue", "Token", "Fingerprint", "Staging", "Activator", "Coordinator",
]);

function hashSha256(content: string | Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

function docFor(index: number): string {
  return DOC_SEEDS[index % DOC_SEEDS.length]!;
}

function identifierFor(prefix: string, index: number): string {
  return `${prefix}${IDENTIFIERS[index % IDENTIFIERS.length]!}${index}`;
}

/** Build a deterministic TypeScript module body of roughly `targetBytes`. */
function buildTypescriptModule(moduleIndex: number, targetBytes: number): string {
  const lines: string[] = [];
  lines.push(`/** Module ${moduleIndex}: ${docFor(moduleIndex)} */`);
  lines.push(`import type { TreeNode } from "./types.js";`);
  lines.push(`import { parse, lease } from "./runtime.js";`);
  lines.push(`import DefaultAdapter from "./adapter.js";`);
  lines.push(`import * as Util from "./util.js";`);
  lines.push(`export const VERSION_${moduleIndex} = "${moduleIndex}.0.0";`);
  lines.push(`export type Mode_${moduleIndex} = "strict" | "recovered" | "failed";`);
  lines.push("");
  lines.push(`interface Config_${moduleIndex} {`);
  lines.push(`  readonly capacity: number;`);
  lines.push(`  readonly timeoutMs: number;`);
  lines.push(`  readonly label: string;`);
  lines.push(`}`);
  lines.push("");

  const className = `Service${moduleIndex}`;
  lines.push(`/** ${docFor(moduleIndex + 1)} */`);
  lines.push(`export class ${className}<T extends TreeNode> implements Iterable<T> {`);
  lines.push(`  private readonly items: T[] = [];`);
  lines.push(`  private closed = false;`);
  lines.push("");
  lines.push(`  constructor(private readonly config: Config_${moduleIndex}) {}`);
  lines.push("");
  lines.push(`  async push(value: T): Promise<void> {`);
  lines.push(`    if (this.closed) throw new Error("${className} closed");`);
  lines.push(`    this.items.push(value);`);
  lines.push(`    await parse(value);`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  [Symbol.iterator](): Iterator<T> {`);
  lines.push(`    return this.items[Symbol.iterator]();`);
  lines.push(`  }`);
  lines.push("");

  // Deterministic method families.
  let methodIndex = 0;
  while (lines.join("\n").length < targetBytes) {
    const methodName = identifierFor("step", methodIndex);
    lines.push(`  /** ${docFor(methodIndex + 2)} */`);
    lines.push(`  ${methodName}(input: string): Mode_${moduleIndex} {`);
    lines.push(`    const created = lease(input);`);
    lines.push(`    const client = DefaultAdapter;`);
    lines.push(`    fetch("/api/${methodName}");`);
    lines.push(`    axios.post("https://example.test/${methodName}", input);`);
    lines.push(`    emitter.emit("${methodName}", created);`);
    lines.push(`    emitter.once("${methodName}", client.handle);`);
    lines.push(`    gql\`query ${methodName} { node }\`;`);
    lines.push(`    return created ? "recovered" : "strict";`);
    lines.push(`  }`);
    lines.push("");
    methodIndex += 1;
  }

  lines.push(`  async dispose(): Promise<void> {`);
  lines.push(`    this.closed = true;`);
  lines.push(`    this.items.length = 0;`);
  lines.push(`    await Util.drain(this);`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");

  // Free functions with overloads.
  lines.push(`export function resolve${className}(value: unknown): value is ${className}<TreeNode> {`);
  lines.push(`  return value instanceof ${className};`);
  lines.push(`}`);
  lines.push("");
  lines.push(`export async function load${className}(path: string): Promise<${className}<TreeNode>> {`);
  lines.push(`  const mod = await import(path);`);
  lines.push(`  return new ${className}({ capacity: ${moduleIndex + 4}, timeoutMs: 250, label: path });`);
  lines.push(`}`);
  lines.push("");

  return lines.join("\n");
}

/** Build a deterministic TSX module (TypeScript + JSX surface). */
function buildTsxModule(moduleIndex: number, targetBytes: number): string {
  const lines: string[] = [];
  lines.push(`/** TSX module ${moduleIndex}: ${docFor(moduleIndex)} */`);
  lines.push(`import type { ReactNode } from "react";`);
  lines.push(`import { useMemo, useState, useCallback } from "react";`);
  lines.push(`import { fetchProfile } from "./api.js";`);
  lines.push("");
  lines.push(`interface ProfileProps_${moduleIndex} {`);
  lines.push(`  readonly id: string;`);
  lines.push(`  readonly onSelect?: (id: string) => void;`);
  lines.push(`}`);
  lines.push("");

  const componentName = `Panel${moduleIndex}`;
  lines.push(`export function ${componentName}({ id, onSelect }: ProfileProps_${moduleIndex}): ReactNode {`);
  lines.push(`  const [state, setState] = useState<{ label: string; ok: boolean }>({ label: id, ok: false });`);
  lines.push(`  const handleClick = useCallback(() => {`);
  lines.push(`    fetch("/api/profiles/" + id);`);
  lines.push(`    emitter.emit("selected", id);`);
  lines.push(`    onSelect?.(id);`);
  lines.push(`  }, [id, onSelect]);`);
  lines.push("");

  let itemIndex = 0;
  while (lines.join("\n").length < targetBytes) {
    const key = `item_${itemIndex}`;
    lines.push(`  const ${key} = useMemo(() => ({ id: "${key}", label: "${componentName} ${itemIndex}" }), []);`);
    lines.push(`  void ${key};`);
    itemIndex += 1;
  }

  lines.push(`  return (`);
  lines.push(`    <section data-id={id} aria-label={state.label}>`);
  lines.push(`      <header><h1>{state.label}</h1></header>`);
  lines.push(`      <button type="button" onClick={handleClick}>Select</button>`);
  lines.push(`      <aside>{id}</aside>`);
  lines.push(`    </section>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push("");

  lines.push(`export default ${componentName};`);
  lines.push("");
  return lines.join("\n");
}

/** Build a deterministic JavaScript (CommonJS-flavored) module. */
function buildJavascriptModule(moduleIndex: number, targetBytes: number): string {
  const lines: string[] = [];
  lines.push(`// Module ${moduleIndex}: ${docFor(moduleIndex)}`);
  lines.push(`const { parse, lease } = require("./runtime");`);
  lines.push(`const DefaultAdapter = require("./adapter");`);
  lines.push(`const Util = require("./util");`);
  lines.push(`const emitter = require("./emitter");`);
  lines.push(`const axios = require("axios");`);
  lines.push(`const VERSION_${moduleIndex} = "${moduleIndex}.0.0";`);
  lines.push(`module.exports.VERSION_${moduleIndex} = VERSION_${moduleIndex};`);
  lines.push("");

  const className = `Service${moduleIndex}`;
  lines.push(`class ${className} {`);
  lines.push(`  constructor(config) {`);
  lines.push(`    this.items = [];`);
  lines.push(`    this.config = config;`);
  lines.push(`    this.closed = false;`);
  lines.push(`  }`);
  lines.push("");
  lines.push(`  async push(value) {`);
  lines.push(`    if (this.closed) throw new Error("${className} closed");`);
  lines.push(`    this.items.push(value);`);
  lines.push(`    await parse(value);`);
  lines.push(`  }`);
  lines.push("");

  let methodIndex = 0;
  while (lines.join("\n").length < targetBytes) {
    const methodName = identifierFor("step", methodIndex);
    lines.push(`  ${methodName}(input) {`);
    lines.push(`    const created = lease(input);`);
    lines.push(`    fetch("/api/${methodName}");`);
    lines.push(`    axios.post("https://example.test/${methodName}", input);`);
    lines.push(`    emitter.emit("${methodName}", created);`);
    lines.push(`    emitter.once("${methodName}", DefaultAdapter.handle);`);
    lines.push(`    return created ? "recovered" : "strict";`);
    lines.push(`  }`);
    lines.push("");
    methodIndex += 1;
  }

  lines.push(`  async dispose() {`);
  lines.push(`    this.closed = true;`);
  lines.push(`    this.items.length = 0;`);
  lines.push(`    await Util.drain(this);`);
  lines.push(`  }`);
  lines.push(`}`);
  lines.push("");
  lines.push(`module.exports.${className} = ${className};`);
  lines.push(`module.exports.load${className} = async (path) => {`);
  lines.push(`  const mod = require(path);`);
  lines.push(`  return new ${className}({ capacity: ${moduleIndex + 4}, timeoutMs: 250, label: path });`);
  lines.push(`};`);
  lines.push("");
  return lines.join("\n");
}

/** Build a deterministic JSX (JavaScript + JSX) module. */
function buildJsxModule(moduleIndex: number, targetBytes: number): string {
  const lines: string[] = [];
  lines.push(`// JSX module ${moduleIndex}: ${docFor(moduleIndex)}`);
  lines.push(`const { useMemo, useState, useCallback } = require("react");`);
  lines.push(`const { fetchProfile } = require("./api");`);
  lines.push(`const emitter = require("./emitter");`);
  lines.push("");

  const componentName = `Panel${moduleIndex}`;
  lines.push(`function ${componentName}({ id, onSelect }) {`);
  lines.push(`  const [state, setState] = useState({ label: id, ok: false });`);
  lines.push(`  const handleClick = useCallback(() => {`);
  lines.push(`    fetch("/api/profiles/" + id);`);
  lines.push(`    emitter.emit("selected", id);`);
  lines.push(`    onSelect?.(id);`);
  lines.push(`  }, [id, onSelect]);`);
  lines.push("");

  let itemIndex = 0;
  while (lines.join("\n").length < targetBytes) {
    const key = `item_${itemIndex}`;
    lines.push(`  const ${key} = useMemo(() => ({ id: "${key}", label: "${componentName} ${itemIndex}" }), []);`);
    lines.push(`  void ${key};`);
    itemIndex += 1;
  }

  lines.push(`  return (`);
  lines.push(`    <section data-id={id} aria-label={state.label}>`);
  lines.push(`      <header><h1>{state.label}</h1></header>`);
  lines.push(`      <button type="button" onClick={handleClick}>Select</button>`);
  lines.push(`    </section>`);
  lines.push(`  );`);
  lines.push(`}`);
  lines.push("");
  lines.push(`module.exports = ${componentName};`);
  lines.push(`module.exports.${componentName} = ${componentName};`);
  lines.push("");
  return lines.join("\n");
}

interface CorpusFile {
  readonly name: string;
  readonly extension: string;
  readonly bytes: number;
  readonly sha256: string;
}

function generateCorpus(): { files: readonly CorpusFile[]; totalBytes: number } {
  // Target ~12 KiB per file so each is comfortably above the 32 KiB RSS-sensor
  // floor when concatenated, and the whole corpus reaches several hundred KB.
  const TARGET_BYTES_PER_FILE = 12_000;
  const files: CorpusFile[] = [];
  let totalBytes = 0;

  for (const spec of SPEC) {
    for (let index = 0; index < spec.modules; index += 1) {
      const moduleIndex = index + 1;
      const name = `module-${spec.extension.slice(1)}-${String(moduleIndex).padStart(2, "0")}${spec.extension}`;
      let body: string;
      if (spec.extension === ".ts") body = buildTypescriptModule(moduleIndex, TARGET_BYTES_PER_FILE);
      else if (spec.extension === ".tsx") body = buildTsxModule(moduleIndex, TARGET_BYTES_PER_FILE);
      else if (spec.extension === ".js") body = buildJavascriptModule(moduleIndex, TARGET_BYTES_PER_FILE);
      else body = buildJsxModule(moduleIndex, TARGET_BYTES_PER_FILE);

      const buffer = Buffer.from(body, "utf8");
      writeFileSync(resolve(CORPUS_DIR, name), buffer);
      const sha256 = hashSha256(buffer);
      files.push({ name, extension: spec.extension, bytes: buffer.byteLength, sha256 });
      totalBytes += buffer.byteLength;
    }
  }

  return { files, totalBytes };
}

function writeManifest(files: readonly CorpusFile[], totalBytes: number): { corpusChecksum: string } {
  // Corpus checksum = SHA-256 over the deterministic manifest fields (everything
  // except the checksum itself), so any file/byte/order drift changes the sum.
  const manifestPayload = {
    version: 1,
    generatedBy: "benchmarks/parser/generate-corpus.ts",
    fileCount: files.length,
    totalBytes,
    files: files.map((file) => ({
      name: file.name,
      extension: file.extension,
      bytes: file.bytes,
      sha256: file.sha256,
    })),
  };
  const manifestJson = JSON.stringify(manifestPayload, null, 2);
  const corpusChecksum = hashSha256(manifestJson);
  const manifest = { ...manifestPayload, corpusChecksum };
  writeFileSync(MANIFEST_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
  return { corpusChecksum };
}

function main(): void {
  // Wipe only generated corpus files (preserve the manifest directory and any
  // non-corpus files). The manifest itself is rewritten below.
  mkdirSync(CORPUS_DIR, { recursive: true });
  for (const entry of readdirSync(CORPUS_DIR)) {
    if (entry === "corpus-manifest.json") continue;
    rmSync(resolve(CORPUS_DIR, entry), { recursive: true, force: true });
  }

  const { files, totalBytes } = generateCorpus();
  const { corpusChecksum } = writeManifest(files, totalBytes);

  const byExtension = new Map<string, number>();
  for (const file of files) byExtension.set(file.extension, (byExtension.get(file.extension) ?? 0) + 1);

  process.stdout.write(
    `Generated ${files.length} corpus files (${totalBytes} bytes). ` +
      `Checksum: ${corpusChecksum.slice(0, 12)}…\n` +
      [...byExtension.entries()].map(([ext, count]) => `  ${ext}: ${count}`).join("\n") +
      "\n",
  );
}

main();
