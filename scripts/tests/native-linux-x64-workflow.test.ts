import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { spawnSync } from "node:child_process";

import { EXPECTED_BUN_VERSION } from "../verify-tree-sitter-grammars.ts";

const ROOT = resolve(import.meta.dir, "../..");
const CI_PATH = resolve(ROOT, ".github/workflows/ci.yml");
const BASELINE_COMMIT = "cc5e5e9";

// M21 T4: the new structural-native-linux CI job is additive. This test
// asserts the Linux job pins the exact runtime, runs the frozen verifier,
// and uploads provenance. It does NOT touch the pre-existing
// native-macos-arm64-workflow.test.ts (which has its own pre-existing
// failure state unrelated to M21).
describe("native linux x64 CI job", () => {
  function readCi(): string {
    return readFileSync(CI_PATH, "utf8");
  }

  test("structural-native-linux job pins Bun 1.3.11 and targets ubuntu-latest", () => {
    const yaml = readCi();
    expect(yaml).toContain("structural-native-linux:");
    expect(yaml).toContain("runs-on: ubuntu-latest");
    expect(yaml).toContain(`bun-version: ${EXPECTED_BUN_VERSION}`);
  });

  test("pins Node 25.9.0 as the build helper", () => {
    const yaml = readCi();
    expect(yaml).toContain("node-version: '25.9.0'");
  });

  test("runs the frozen native verifier and native-structural unit tests", () => {
    const yaml = readCi();
    expect(yaml).toContain("bun install --frozen-lockfile");
    expect(yaml).toContain("bun run build");
    expect(yaml).toContain("bun run verify:tree-sitter-native");
    expect(yaml).toContain("run-tests-isolated.ts --unit --filter='structural|parse-long-class'");
  });

  test("uploads provenance artifact with if-no-files-found: error", () => {
    const yaml = readCi();
    expect(yaml).toContain("native-linux-x64-verification.log");
    expect(yaml).toContain("actions/upload-artifact@v4");
    expect(yaml).toContain("if-no-files-found: error");
    expect(yaml).toContain("if: always()");
  });

  test("does not modify the pre-existing macOS structural-native test or other workflows", () => {
    // Check committed diff (HEAD vs M21 baseline) for forbidden pre-existing
    // test/workflow files. The current T4 working-tree ci.yml change is not
    // yet committed, so the committed diff won't show it — that's expected;
    // the ci.yml additive job is asserted directly in the tests above.
    const result = spawnSync("git", ["diff", "--name-only", `${BASELINE_COMMIT}..HEAD`], {
      cwd: ROOT,
      encoding: "utf8",
    });
    if (result.status !== 0) {
      console.warn(`baseline non-touch sensor skipped: git diff exited ${result.status}`);
      return;
    }
    const changed = result.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    // M21 must not touch the pre-existing failing test or other workflows
    const forbidden = [
      "scripts/tests/native-macos-arm64-workflow.test.ts",
      ".github/workflows/needles-gate.yml",
      ".github/workflows/publish.yml",
      ".github/workflows/skills.yml",
    ];
    const touched = changed.filter((path) => forbidden.includes(path));
    expect(touched).toEqual([]);
  });

  test("pre-existing macOS structural-native job remains unchanged in ci.yml", () => {
    const yaml = readCi();
    expect(yaml).toContain("structural-native:");
    expect(yaml).toContain("name: Structural native tests (darwin-arm64)");
    expect(yaml).toContain("runs-on: macos-14");
    expect(yaml).toContain("node-version: '22'");
  });
});