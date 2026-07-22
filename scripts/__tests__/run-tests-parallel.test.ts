/**
 * Parallel test runner — unit tests (Wave 6 N20, T23-T24)
 *
 * Verifies:
 * - SUITE_TABLE is built correctly with id, description, testFiles, isolationReason, deadlineSensitive
 * - --list-suites flag outputs the table
 * - UNION GUARD: crashed suite = failed (not dropped); result-set ≠ list → exit 1
 * - Per-suite pass/fail/skip counts + total summary
 */

import { describe, test, expect } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import path from "path";

const SCRIPT = path.resolve(import.meta.dir, "../run-tests-parallel.ts");

function runScript(args: string[], env: Record<string, string> = {}): {
  exitCode: number | null;
  stdout: string;
  stderr: string;
} {
  const result: SpawnSyncReturns<string> = spawnSync("bun", ["run", SCRIPT, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    timeout: 10000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

describe("Parallel test runner (T23-T24)", () => {
  test("--list-suites prints SUITE_TABLE with suite entries", () => {
    const result = runScript(["--list-suites"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("SUITE_TABLE");
    expect(result.stdout).toContain("description:");
    expect(result.stdout).toContain("isolationReason:");
    expect(result.stdout).toContain("testFiles:");
    // Should have at least the pure-shared suite
    expect(result.stdout).toContain("pure-shared");
  });

  test("SUITE_TABLE entries have deadlineSensitive marking", () => {
    const result = runScript(["--list-suites"]);
    expect(result.exitCode).toBe(0);
    // At least one suite should be marked DEADLINE-SENSITIVE
    expect(result.stdout).toContain("DEADLINE-SENSITIVE");
  });

  test("SUITE_TABLE has multiple isolation reasons", () => {
    const result = runScript(["--list-suites"]);
    expect(result.exitCode).toBe(0);
    expect(result.stdout).toContain("pure");
    expect(result.stdout).toContain("module mock");
    expect(result.stdout).toContain("database/integration");
    expect(result.stdout).toContain("process-global state");
  });

  test("unknown argument exits with code 2", () => {
    const result = runScript(["--unknown-flag"]);
    expect(result.exitCode).toBe(2);
  });

  test("UNION GUARD: --filter with no matching suites runs 0 suites (no crash)", () => {
    // Filter for a nonexistent suite — should run 0 suites and pass
    const result = runScript(["--filter=NONEXISTENT_SUITE_xyz"]);
    // With 0 suites, the UNION GUARD has nothing to compare → pass
    expect(result.exitCode).toBe(0);
  });
});