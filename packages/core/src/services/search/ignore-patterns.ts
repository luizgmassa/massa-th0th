/**
 * Shared ignore patterns for project file scanning.
 * Single source of truth used by DiscoverStage, ContextualSearchRLM, and IndexManager.
 *
 * Wave 5 FR-11 / FR-21 / AD-W5-015: `loadProjectIgnore` is a thin wrapper
 * over the capture-policy pure module. The `.gitignore` merge via the Ignore
 * library runs BEFORE `applyPolicy` so gitignore semantics (including
 * negation rules like `!keep/me.js`) are preserved. The merged rule list is
 * what `applyPolicy` consumes (through the `Ignore` instance's `.ignores()`
 * method), not the raw policy. This keeps the pre-Wave-5 behavior identical
 * (characterization test in ignore-patterns.characterization.test.ts pins
 * the outcomes).
 */

import fs from "fs/promises";
import path from "path";
import ignoreModule, { type Ignore } from "ignore";
import { logger, config } from "@massa-th0th/shared";
import { applyPolicy, DEFAULT_POLICY, validatePolicy } from "./capture-policy.js";
import type { Disposition, Policy } from "./capture-policy-interfaces.js";

const ignore = (ignoreModule as unknown as { default: typeof ignoreModule }).default ?? ignoreModule;

export const DEFAULT_EXTENSIONS = [".ts", ".js", ".tsx", ".jsx", ".dart", ".py", ".kt", ".kts"];

export const DEFAULT_IGNORES = [
  // `**/` prefix required so these match anywhere in the tree (not just root).
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/build/**",
  "**/coverage/**",
  ".env",
  ".env.*",
  "**/generated/**",
  "**/*.generated.*",
  "**/*.d.ts",
  // Tests and benchmarks: usually noise for code search (test fixtures often
  // contain query keywords verbatim, polluting recall of the real
  // implementation). Opt back in per-search via the `include` filter.
  "**/__tests__/**",
  "**/tests/**",
  "**/*.test.ts",
  "**/*.test.tsx",
  "**/*.test.js",
  "**/*.test.jsx",
  "**/*.spec.ts",
  "**/*.spec.tsx",
  "**/*.spec.js",
  "**/*.spec.jsx",
  "**/benchmarks/**",
  "**/fixtures/**",
  "**/*.wasm*",
  "**/*.min.*",
  "**/*.map",
  "**/lock.yaml",
  "**/pnpm-lock.yaml",
  "**/package-lock.json",
  "**/bun.lockb",
  "**/yarn.lock",
];

/**
 * Resolve the active capture policy from config. When the `capturePolicy`
 * block is absent, returns the pure module's DEFAULT_POLICY (migrated from
 * DEFAULT_IGNORES). When present, validates bounds + denyUnknownFields and
 * returns the configured policy. Caches the result; config is load-once.
 */
let cachedPolicy: Policy | undefined;
function getActivePolicy(): Policy {
  if (cachedPolicy) return cachedPolicy;
  const fromConfig = config.get("capturePolicy");
  if (!fromConfig) {
    cachedPolicy = DEFAULT_POLICY;
    return cachedPolicy;
  }
  // Validate at first use (config-load-time gate). The shared config loader
  // already validated, but the pure module's validator is the authoritative
  // contract — run it here too so direct callers (tests, programmatic) are
  // gated even when bypassing the file config loader.
  validatePolicy(fromConfig, { denyUnknownFields: true });
  cachedPolicy = fromConfig as Policy;
  return cachedPolicy;
}

/** @internal test seam to reset the cached policy between tests. */
export function _resetCapturePolicyCacheForTesting(): void {
  cachedPolicy = undefined;
}

/**
 * Apply the active capture policy to a file path. Pure (no I/O): delegates
 * to the capture-policy module's `applyPolicy`. Exposed for callers that
 * want a Disposition (Keep/Drop/MetadataOnly) rather than a boolean ignore.
 *
 * Note: this does NOT include the `.gitignore` merge. The merge is the
 * caller's responsibility (via `loadProjectIgnore`) and runs BEFORE this
 * function. The characterization test pins the combined outcome.
 */
export function applyCapturePolicy(filePath: string): Disposition {
  return applyPolicy(filePath, getActivePolicy());
}

/**
 * Load .gitignore rules merged with default ignores.
 *
 * Wave 5 AD-W5-015: the `.gitignore` merge runs BEFORE `applyPolicy`. This
 * function returns the merged `Ignore` instance; callers that want the
 * policy disposition call `applyCapturePolicy` separately. The two layers
 * compose: a path is indexed iff `!ig.ignores(path) && applyCapturePolicy(path) !== 'Drop'`.
 */
export async function loadProjectIgnore(projectPath: string): Promise<Ignore> {
  const ig = ignore();
  ig.add(DEFAULT_IGNORES);

  try {
    const gitignorePath = path.join(projectPath, ".gitignore");
    const gitignoreContent = await fs.readFile(gitignorePath, "utf8");

    const rules = gitignoreContent
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));

    ig.add(rules);

    logger.debug("Loaded .gitignore", {
      projectPath,
      rulesCount: rules.length,
    });
  } catch {
    logger.debug("No .gitignore found, using defaults only", { projectPath });
  }

  return ig;
}
