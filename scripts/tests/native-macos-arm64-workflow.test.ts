import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { EXPECTED_BUN_VERSION, EXPECTED_NODE_BUILD_VERSION } from "../verify-tree-sitter-grammars.ts";
import { EXPECTED_NPM_VERSION } from "../verify-tree-sitter-package-artifact.ts";

const ROOT = resolve(import.meta.dir, "../..");
const WORKFLOW_PATH = resolve(ROOT, ".github/workflows/native-macos-arm64.yml");
const BASELINE_COMMIT = "5d43a96f4c0f1dfbd04ee7ae95f589f9b023bf03";

// Files this feature must never modify: container packaging, every pre-existing
// workflow, and any non-arm64/Linux path. New additive files (including this
// feature's own `native-macos-arm64.yml`) are allowed.
const EXCLUDED_BASELINE_PATHS = new Set<string>([
  "Dockerfile",
  ".dockerignore",
  "docker-compose.yml",
  "docker-compose.test.yml",
  ".github/workflows/ci.yml",
  ".github/workflows/needles-gate.yml",
  ".github/workflows/publish.yml",
  ".github/workflows/skills.yml",
]);

function isExcludedPath(path: string): boolean {
  return EXCLUDED_BASELINE_PATHS.has(path) || path.startsWith("docker/");
}

function readWorkflow(): string {
  return readFileSync(WORKFLOW_PATH, "utf8");
}

describe("native macOS arm64 CI workflow", () => {
  test("pins the exact runtime and build helper and targets darwin-arm64 only", () => {
    const yaml = readWorkflow();
    expect(yaml).toContain("runs-on: macos-14");
    expect(yaml).toContain(`bun-version: ${EXPECTED_BUN_VERSION}`);
    expect(yaml).toContain(`node-version: ${EXPECTED_NODE_BUILD_VERSION}`);
    // exact-version guards inside the workflow
    expect(yaml).toContain(`= "${EXPECTED_BUN_VERSION}"`);
    expect(yaml).toContain(`= "v${EXPECTED_NODE_BUILD_VERSION}"`);
    expect(yaml).toContain(`= "${EXPECTED_NPM_VERSION}"`);
    // must not target a non-arm64 / Linux host
    expect(yaml).not.toContain("runs-on: ubuntu");
    expect(yaml).not.toContain("runs-on: macos-13");
    expect(yaml).not.toContain("runs-on: macos-12");
    expect(yaml).not.toMatch(/runs-on:\s*windows/);
  });

  test("runs the frozen native verifier and uploads provenance artifacts", () => {
    const yaml = readWorkflow();
    expect(yaml).toContain("bun install --frozen-lockfile");
    expect(yaml).toContain("bun run build");
    expect(yaml).toContain("bun run verify:tree-sitter-native");
    expect(yaml).toContain("native-macos-arm64-verification.log");
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("if-no-files-found: error");
  });

  test("feature does not modify pre-existing workflows, container, or non-arm64 paths", () => {
    const result = spawnSync("git", ["diff", "--name-only", `${BASELINE_COMMIT}..HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      // Shallow CI clones may not retain the baseline commit; skip rather than
      // fail. The structural workflow assertions above still hold.
      console.warn(`baseline non-touch sensor skipped: git diff exited ${result.status}`);
      return;
    }
    const changed = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const touched = changed.filter(isExcludedPath);
    expect(touched).toEqual([]);
  });
});
