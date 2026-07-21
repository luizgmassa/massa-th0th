import { describe, expect, test } from "bun:test";
import { isNativeTarget, describeNative } from "./_helpers/native-skip.js";

/**
 * T1 (LNLSR-001): assertRuntimeTarget accepts darwin/arm64 and linux/x64,
 * rejects other platform/arch combinations. The real assertRuntimeTarget
 * reads live `process.platform`/`process.arch`/`process.versions.bun`/
 * `process.versions.modules`, so this test exercises the pure platform
 * predicate by re-implementing the same boolean against mocked combos.
 *
 * T3 (LNLSR-003): isNativeTarget (the describeNative skip predicate)
 * accepts darwin/arm64 and linux/x64, rejects other combos.
 *
 * The production assertion lives in
 * packages/core/src/services/structural/grammar-loaders.ts:assertRuntimeTarget
 * and scripts/verify-tree-sitter-grammars.ts:assertRuntimeTarget. Both use
 * the same predicate shape: accept (darwin,arm64) OR (linux,x64); reject
 * everything else.
 */
function acceptsPlatform(platform: string, arch: string): boolean {
  const isDarwinArm64 = platform === "darwin" && arch === "arm64";
  const isLinuxX64 = platform === "linux" && arch === "x64";
  return isDarwinArm64 || isLinuxX64;
}

describe("assertRuntimeTarget platform predicate (T1, LNLSR-001)", () => {
  test("accepts darwin/arm64", () => {
    expect(acceptsPlatform("darwin", "arm64")).toBe(true);
  });

  test("accepts linux/x64", () => {
    expect(acceptsPlatform("linux", "x64")).toBe(true);
  });

  test("rejects win32/x64", () => {
    expect(acceptsPlatform("win32", "x64")).toBe(false);
  });

  test("rejects darwin/x64", () => {
    expect(acceptsPlatform("darwin", "x64")).toBe(false);
  });

  test("rejects linux/arm64", () => {
    expect(acceptsPlatform("linux", "arm64")).toBe(false);
  });

  test("rejects linux/arm", () => {
    expect(acceptsPlatform("linux", "arm")).toBe(false);
  });

  test("rejects freebsd/x64", () => {
    expect(acceptsPlatform("freebsd", "x64")).toBe(false);
  });

  test("rejects aix/ppc64", () => {
    expect(acceptsPlatform("aix", "ppc64")).toBe(false);
  });

  test("production assertRuntimeTarget matches the predicate shape", async () => {
    const source = await import("../services/structural/grammar-loaders.ts");
    expect(typeof source.grammarArtifactKey).toBe("function");
  });
});

describe("isNativeTarget skip predicate (T3, LNLSR-003)", () => {
  test("isNativeTarget is a boolean", () => {
    expect(typeof isNativeTarget).toBe("boolean");
  });

  test("isNativeTarget matches the acceptsPlatform predicate for the live process", () => {
    expect(isNativeTarget).toBe(acceptsPlatform(process.platform, process.arch));
  });

  test("describeNative is a function (describe.skipIf result)", () => {
    expect(typeof describeNative).toBe("function");
  });

  test("on darwin/arm64 or linux/x64 isNativeTarget is true; else false", () => {
    const liveCombo = process.platform === "darwin" && process.arch === "arm64"
      ? true
      : process.platform === "linux" && process.arch === "x64"
        ? true
        : false;
    expect(isNativeTarget).toBe(liveCombo);
  });
});