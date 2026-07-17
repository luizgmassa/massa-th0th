#!/usr/bin/env bun

import {
  cpSync,
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EXPECTED_BUN_VERSION,
  EXPECTED_NODE_BUILD_VERSION,
  EXPECTED_NATIVE_MODULE_COUNT,
  MINIMAL_PARSE_CASES,
  PACKED_CONSUMER_RESULT_PREFIX,
  TRUSTED_NATIVE_PACKAGES,
  assertRuntimeTarget,
  verifyStaticContract,
  type PackedConsumerVerificationResult,
} from "./verify-tree-sitter-grammars.ts";

export const EXPECTED_NPM_VERSION = "11.14.1";
export const PACKED_RUNTIME_ADDON =
  "package/node_modules/tree-sitter/build/Release/tree_sitter_runtime_binding.node";
const ROOT = fileURLToPath(new URL("../", import.meta.url));
const GRAMMAR_VERIFIER = resolve(ROOT, "scripts/verify-tree-sitter-grammars.ts");
const DATABASE_URL =
  "postgresql://tree_sitter_verifier:tree_sitter_verifier@127.0.0.1:1/tree_sitter_verifier";
const decoder = new TextDecoder();

interface PublishManifest {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
  bundleDependencies?: string[];
}

interface PackRecord {
  filename?: string;
}

function invariant(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function command(
  executable: string,
  args: string[],
  options: { cwd?: string; env?: Record<string, string | undefined> } = {},
): string {
  const result = Bun.spawnSync([executable, ...args], {
    cwd: options.cwd ?? ROOT,
    env: options.env ?? process.env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdout = decoder.decode(result.stdout);
  const stderr = decoder.decode(result.stderr);
  invariant(
    result.exitCode === 0,
    `${executable} ${args.join(" ")} failed (${result.exitCode}): ${stderr || stdout}`,
  );
  return stdout;
}

function readManifest(path: string): PublishManifest {
  return JSON.parse(readFileSync(path, "utf8")) as PublishManifest;
}

function isPlainSemver(value: string | undefined): boolean {
  return typeof value === "string" && /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(value);
}

export function assertPublishManifests(
  shared: PublishManifest,
  core: PublishManifest,
): void {
  invariant(shared.name === "@massa-th0th/shared", "shared publish package name drifted");
  invariant(core.name === "@massa-th0th/core", "core publish package name drifted");
  invariant(isPlainSemver(shared.version), "shared publish version must be plain semver");
  invariant(isPlainSemver(core.version), "core publish version must be plain semver");
  invariant(
    isPlainSemver(core.dependencies?.["@massa-th0th/shared"]),
    "core publish dependency on @massa-th0th/shared must be plain semver",
  );
  invariant(
    core.dependencies?.["@massa-th0th/shared"] === shared.version,
    "core publish dependency must equal the packed shared version",
  );
  const bundled = core.bundledDependencies ?? core.bundleDependencies;
  invariant(
    JSON.stringify(bundled) === JSON.stringify(["tree-sitter"]),
    "core publish manifest must bundle only tree-sitter",
  );
}

export function assertCoreTarEntries(entries: readonly string[]): void {
  invariant(entries.includes("package/package.json"), "core tarball is missing package.json");
  invariant(
    entries.includes("package/node_modules/tree-sitter/package.json"),
    "core tarball is missing the nested tree-sitter package",
  );
  invariant(entries.includes(PACKED_RUNTIME_ADDON), "core tarball is missing the generated addon");
  const runtimeAddons = entries.filter((entry) =>
    entry.startsWith("package/node_modules/tree-sitter/") && entry.endsWith(".node")
  );
  invariant(
    JSON.stringify(runtimeAddons) === JSON.stringify([PACKED_RUNTIME_ADDON]),
    `core tarball contains alternate tree-sitter addons: ${runtimeAddons.join(", ")}`,
  );
}

export function createPackedConsumerManifest(sharedTarball: string, coreTarball: string): object {
  const sharedFile = `file:${sharedTarball}`;
  return {
    name: "tree-sitter-packed-consumer",
    version: "1.0.0",
    private: true,
    type: "module",
    dependencies: {
      "@massa-th0th/shared": sharedFile,
      "@massa-th0th/core": `file:${coreTarball}`,
    },
    overrides: {
      "@massa-th0th/shared": sharedFile,
    },
    trustedDependencies: [...TRUSTED_NATIVE_PACKAGES],
  };
}

export function verifyPackageArtifactStaticContract(): {
  sharedVersion: string;
  coreVersion: string;
  trustedDependencies: number;
} {
  verifyStaticContract();
  const shared = readManifest(resolve(ROOT, "packages/shared/package.json"));
  const core = readManifest(resolve(ROOT, "packages/core/package.json"));
  assertPublishManifests(shared, core);
  invariant(
    existsSync(resolve(ROOT, "packages/shared/dist/index.js")),
    "shared dist is missing; run the build gate before packing",
  );
  invariant(
    existsSync(resolve(ROOT, "packages/core/dist/index.js")),
    "core dist is missing; run the build gate before packing",
  );
  return {
    sharedVersion: shared.version!,
    coreVersion: core.version!,
    trustedDependencies: TRUSTED_NATIVE_PACKAGES.length,
  };
}

function exactBuildTools(): { node: string; npmCli: string } {
  const node = Bun.which("node");
  const npm = Bun.which("npm");
  invariant(node, "exact Node build helper is not on PATH");
  invariant(npm, "exact npm build helper is not on PATH");
  const npmCli = realpathSync(npm);
  invariant(
    command(node, ["--version"]).trim() === `v${EXPECTED_NODE_BUILD_VERSION}`,
    `package verifier requires Node ${EXPECTED_NODE_BUILD_VERSION}`,
  );
  invariant(
    command(node, [npmCli, "--version"]).trim() === EXPECTED_NPM_VERSION,
    `package verifier requires npm ${EXPECTED_NPM_VERSION}`,
  );
  return { node: realpathSync(node), npmCli };
}

function packPackage(
  packageDirectory: string,
  destination: string,
  node: string,
  npmCli: string,
  npmCache: string,
): string {
  const output = command(
    node,
    [npmCli, "pack", "--json", "--ignore-scripts", "--pack-destination", destination],
    {
      cwd: packageDirectory,
      env: { ...process.env, npm_config_cache: npmCache },
    },
  );
  const records = JSON.parse(output) as PackRecord[];
  invariant(records.length === 1 && records[0].filename, "npm pack returned no tarball");
  const tarball = resolve(destination, records[0].filename);
  invariant(existsSync(tarball), `npm pack tarball is missing: ${tarball}`);
  return tarball;
}

function tarEntries(tarball: string): string[] {
  return command("tar", ["-tzf", tarball]).trim().split("\n").filter(Boolean);
}

function tarManifest(tarball: string): PublishManifest {
  return JSON.parse(command("tar", ["-xOzf", tarball, "package/package.json"])) as PublishManifest;
}

function parsePackedResult(stdout: string): PackedConsumerVerificationResult {
  const line = stdout.split("\n").findLast((value) =>
    value.startsWith(PACKED_CONSUMER_RESULT_PREFIX)
  );
  invariant(line, "packed consumer did not emit a result record");
  const result = JSON.parse(
    line.slice(PACKED_CONSUMER_RESULT_PREFIX.length),
  ) as PackedConsumerVerificationResult;
  invariant(result.status === "PASS" && result.consumer === "packed", "packed consumer failed");
  invariant(result.bun === EXPECTED_BUN_VERSION, `packed consumer used Bun ${result.bun}`);
  invariant(
    result.resolvable === TRUSTED_NATIVE_PACKAGES.length,
    `packed consumer resolved ${result.resolvable}/${TRUSTED_NATIVE_PACKAGES.length} packages`,
  );
  invariant(
    result.parses === MINIMAL_PARSE_CASES.length,
    `packed consumer parsed ${result.parses}/${MINIMAL_PARSE_CASES.length} extensions`,
  );
  invariant(
    result.nativeModules === EXPECTED_NATIVE_MODULE_COUNT,
    `packed consumer loaded ${result.nativeModules}/${EXPECTED_NATIVE_MODULE_COUNT} native modules`,
  );
  invariant(
    result.nativePackagePaths === TRUSTED_NATIVE_PACKAGES.length,
    "packed consumer native inventory did not cover every audited package path",
  );
  invariant(result.behaviorSensors === 10, "packed consumer did not run all lifetime sensors");
  return result;
}

function materializeBundledRuntime(): void {
  // bun hoists workspace dependencies to the root node_modules, but npm pack
  // only bundles dependencies that are physically present in the workspace
  // package's own node_modules. The pack step below runs with --ignore-scripts
  // (so a prepack hook cannot stage the bundle), so this helper materializes
  // the patched tree-sitter runtime into packages/core's node_modules first.
  // This mirrors the staging a publisher performs so the core tarball carries
  // the exact nested patched runtime rather than stock or hoisted code.
  const hoistedRuntime = resolve(ROOT, "node_modules/tree-sitter");
  invariant(
    existsSync(resolve(hoistedRuntime, "install-guard.js")),
    "hoisted tree-sitter is not the patched runtime (install-guard.js missing)",
  );
  invariant(
    existsSync(resolve(hoistedRuntime, "build/Release/tree_sitter_runtime_binding.node")),
    "hoisted tree-sitter prebuilt addon is missing; run the build gate first",
  );
  const coreNodeModules = resolve(ROOT, "packages/core/node_modules");
  const nestedRuntime = resolve(coreNodeModules, "tree-sitter");
  mkdirSync(coreNodeModules, { recursive: true });
  rmSync(nestedRuntime, { recursive: true, force: true });
  cpSync(hoistedRuntime, nestedRuntime, { recursive: true });
  invariant(
    existsSync(resolve(nestedRuntime, "install-guard.js")),
    "nested bundled runtime is missing the install guard",
  );
  invariant(
    existsSync(resolve(nestedRuntime, "build/Release/tree_sitter_runtime_binding.node")),
    "nested bundled runtime is missing the generated addon",
  );
}

export function verifyTreeSitterPackageArtifact(): void {
  assertRuntimeTarget();
  const contract = verifyPackageArtifactStaticContract();
  const { node, npmCli } = exactBuildTools();
  materializeBundledRuntime();
  const workspace = mkdtempSync(resolve(tmpdir(), "massa-th0th-tree-sitter-package-"));
  try {
    const artifacts = resolve(workspace, "artifacts");
    const npmCache = resolve(workspace, "npm-cache");
    const bunCache = resolve(workspace, "bun-cache");
    const consumer = resolve(workspace, "consumer");
    mkdirSync(artifacts);
    mkdirSync(npmCache);
    mkdirSync(bunCache);
    mkdirSync(consumer);

    const sharedTarball = packPackage(
      resolve(ROOT, "packages/shared"),
      artifacts,
      node,
      npmCli,
      npmCache,
    );
    const coreTarball = packPackage(
      resolve(ROOT, "packages/core"),
      artifacts,
      node,
      npmCli,
      npmCache,
    );
    const sharedPublishManifest = tarManifest(sharedTarball);
    const corePublishManifest = tarManifest(coreTarball);
    assertPublishManifests(sharedPublishManifest, corePublishManifest);
    const entries = tarEntries(coreTarball);
    assertCoreTarEntries(entries);

    writeFileSync(
      resolve(consumer, "package.json"),
      `${JSON.stringify(createPackedConsumerManifest(sharedTarball, coreTarball), null, 2)}\n`,
    );
    command(
      process.execPath,
      ["install", "--cache-dir", bunCache, "--no-progress"],
      { cwd: consumer, env: process.env },
    );

    const packedEntry = resolve(consumer, "node_modules/@massa-th0th/core/dist/index.js");
    const runtimePackage = resolve(
      consumer,
      "node_modules/@massa-th0th/core/node_modules/tree-sitter",
    );
    invariant(existsSync(packedEntry), "packed core dist entry is missing after install");
    invariant(existsSync(runtimePackage), "packed core nested tree-sitter package is missing");
    const stdout = command(
      process.execPath,
      [GRAMMAR_VERIFIER, "--packed-consumer", packedEntry, runtimePackage],
      {
        cwd: consumer,
        env: { ...process.env, DATABASE_URL },
      },
    );
    const result = parsePackedResult(stdout);
    invariant(
      result.patchedRuntimePackage === realpathSync(runtimePackage),
      "packed verifier accepted a hoisted or alternate tree-sitter runtime",
    );

    console.log(JSON.stringify({
      status: "PASS",
      target: `${process.platform}-${process.arch}`,
      bun: process.versions.bun,
      node: EXPECTED_NODE_BUILD_VERSION,
      npm: EXPECTED_NPM_VERSION,
      sharedVersion: contract.sharedVersion,
      coreVersion: contract.coreVersion,
      packOrder: ["@massa-th0th/shared", "@massa-th0th/core"],
      freshNpmCache: true,
      freshBunCache: true,
      publishSemver: true,
      bundledRuntimeAddon: PACKED_RUNTIME_ADDON,
      nestedRuntime: result.patchedRuntimePackage.split(`${sep}node_modules${sep}`).at(-1),
      extensions: result.parses,
      nativeModules: result.nativeModules,
      nativePackagePaths: result.nativePackagePaths,
      behaviorSensors: result.behaviorSensors,
      trustedDependencies: contract.trustedDependencies,
    }));
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    verifyTreeSitterPackageArtifact();
  } catch (error) {
    console.error(JSON.stringify({
      status: "FAIL",
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    }));
    process.exitCode = 1;
  }
}
