import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import {
  NATIVE_LOCK_IDENTITIES,
  type NativeLockIdentity,
} from "./native-lock-identities.js";

/**
 * Runtime load-time integrity verifier for native Tree-sitter grammar
 * packages.
 *
 * WHY: the offline lockfile verifier (`scripts/verify-tree-sitter-grammars.ts`)
 * pins each package's registry SRI or git identity at publish time, but it
 * cannot detect a tampered, patched, or wrong-version grammar that has been
 * installed into `node_modules` after the fact (e.g. a local `bun add`, a
 * transitive bump, or a supply-chain swap). This module recomputes a hash over
 * each installed package's ABI-independent source at parser init and compares
 * it to the pinned `sourceIntegrity`. A mismatch fails loud before the first
 * parse, so a corrupted grammar can never silently produce wrong structural
 * output.
 *
 * HASHING BASIS (canonical, deterministic, ABI-independent):
 *   For each pinned package, concatenate (in sorted order):
 *     1. the exact bytes of `<packageRoot>/package.json`
 *     2. the exact bytes of `<packageRoot>/grammar.js` if present
 *     3. the exact bytes of every regular file under `<packageRoot>/src/**`,
 *        visited depth-first with directory entries sorted by name and file
 *        paths emitted relative to the package root using POSIX separators.
 *   Each contribution is prefixed by its relative path (POSIX) and its byte
 *   length as ASCII digits followed by a single NUL byte, so a payload
 *   collision cannot arise from concatenation ambiguity. The concatenation is
 *   sha512-hashed and emitted as `sha512-<base64>`.
 *
 * ABI REBUILD SAFETY: compiled artifacts are EXCLUDED by scoping the walk to
 * `package.json`, `grammar.js`, and `src/**` only. The `prebuilds/`, `build/`,
 * `bindings/`, and any `*.node` files live outside that scope, so a legitimate
 * Bun/Node native rebuild cannot flip the hash. Only a change to the grammar
 * source itself (a real version drift or tampering) fails the check.
 */

const SKIP_ENV_FLAG = "MASSA_AI_SKIP_GRAMMAR_INTEGRITY";

/**
 * Carries the pinned and recomputed integrity values so callers can report a
 * precise mismatch surface.
 */
export class GrammarIntegrityError extends Error {
  readonly code = "GRAMMAR_INTEGRITY_MISMATCH";

  constructor(
    readonly pkg: string,
    readonly expected: string,
    readonly actual: string,
  ) {
    super(
      `Grammar source integrity mismatch for ${pkg}: expected ${expected}, got ${actual}`,
    );
    this.name = "GrammarIntegrityError";
  }
}

type RuntimeRequire = ReturnType<typeof createRequire>;

/**
 * Directories whose contents are ABI- or platform-derived and must NOT
 * contribute to the source hash. The walk never enters these because it is
 * scoped to `src/**` (plus the two named root files), but they are listed
 * here as the authoritative exclusion contract.
 */
const EXCLUDED_ABI_DIRS = new Set([
  "prebuilds",
  "build",
  "bindings",
  "node_modules",
]);

/**
 * Resolve the installed package root for a pinned grammar by walking up from
 * the resolved `package.json` entry until the manifest `name` matches. Mirrors
 * `findPackageRoot` in the offline verifier so both tools agree on the package
 * boundary.
 */
function resolvePackageRoot(
  requireFromCore: RuntimeRequire,
  packageName: string,
): string {
  const entry = requireFromCore.resolve(`${packageName}/package.json`);
  let cursor = dirname(entry);
  while (true) {
    const manifestPath = join(cursor, "package.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as {
      name?: string;
    };
    if (manifest.name === packageName) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor) {
      throw new Error(
        `Could not locate package root for ${packageName} from ${entry}`,
      );
    }
    cursor = parent;
  }
}

/**
 * Deterministically list every regular source file under `<root>/src`,
 * depth-first, sorting directory entries by name. Returns POSIX-style relative
 * paths so the hash is stable across POSIX and Windows hosts.
 */
function listSourceFiles(root: string): string[] {
  const srcRoot = join(root, "src");
  let stat;
  try {
    stat = statSync(srcRoot);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) return [];
  const out: string[] = [];

  const visit = (dir: string): void => {
    const entries = readdirSync(dir).sort();
    for (const name of entries) {
      if (EXCLUDED_ABI_DIRS.has(name)) continue;
      const full = join(dir, name);
      const entryStat = statSync(full);
      if (entryStat.isDirectory()) {
        visit(full);
      } else if (entryStat.isFile()) {
        out.push(relative(root, full).split(sep).join("/"));
      }
    }
  };
  visit(srcRoot);
  return out;
}

/**
 * Push a length-prefixed, path-prefixed contribution into the running buffer.
 * The framing (path + NUL + decimal length + NUL + bytes) guarantees that two
 * different file sets cannot produce the same concatenated stream.
 */
function pushContribution(
  chunks: Buffer[],
  relPath: string,
  bytes: Buffer,
): void {
  chunks.push(Buffer.from(relPath, "utf8"));
  chunks.push(Buffer.from([0]));
  chunks.push(Buffer.from(String(bytes.byteLength), "ascii"));
  chunks.push(Buffer.from([0]));
  chunks.push(bytes);
}

/**
 * Compute the canonical `sha512-<base64>` source-integrity digest for one
 * installed package. Throws if the package root or required source files are
 * absent.
 */
export function computePackageSourceIntegrity(
  requireFromCore: RuntimeRequire,
  packageName: string,
): string {
  const root = resolvePackageRoot(requireFromCore, packageName);
  const chunks: Buffer[] = [];

  const packageJsonPath = join(root, "package.json");
  pushContribution(chunks, "package.json", readFileSync(packageJsonPath));

  const grammarPath = join(root, "grammar.js");
  try {
    const grammarStat = statSync(grammarPath);
    if (grammarStat.isFile()) {
      pushContribution(chunks, "grammar.js", readFileSync(grammarPath));
    }
  } catch {
    // grammar.js is optional for some grammars; its absence is part of the
    // canonical basis and is stable across installs of the same version.
  }

  for (const rel of listSourceFiles(root)) {
    pushContribution(chunks, rel, readFileSync(resolve(root, rel)));
  }

  const digest = createHash("sha512").update(Buffer.concat(chunks)).digest(
    "base64",
  );
  return `sha512-${digest}`;
}

let integrityVerified = false;

/**
 * Verify every pinned native grammar package against its `sourceIntegrity`
 * pin. Runs at most once per process: subsequent calls are a no-op so the
 * check never taxes per-request parse paths.
 *
 * Default behavior is ON (verifies). Set the environment variable
 * `MASSA_AI_SKIP_GRAMMAR_INTEGRITY=1` to skip, which is intended only for
 * local development iterations where grammar packages are intentionally
 * patched or swapped. Production and CI default to verifying.
 *
 * @throws {GrammarIntegrityError} when any pinned package's recomputed
 *   source integrity does not match its pin.
 */
export function verifyNativeGrammarIntegrity(
  requireFromCore: RuntimeRequire = createRequire(import.meta.url),
): void {
  if (integrityVerified) return;
  if (process.env[SKIP_ENV_FLAG] === "1") {
    integrityVerified = true;
    return;
  }

  for (const [pkg, identity] of Object.entries(NATIVE_LOCK_IDENTITIES) as [
    string,
    NativeLockIdentity,
  ][]) {
    const actual = computePackageSourceIntegrity(requireFromCore, pkg);
    if (actual !== identity.sourceIntegrity) {
      throw new GrammarIntegrityError(pkg, identity.sourceIntegrity, actual);
    }
  }
  integrityVerified = true;
}

/** Test-only seam: reset the module-level memoization flag. */
export function resetGrammarIntegrityForTests(): void {
  integrityVerified = false;
}
