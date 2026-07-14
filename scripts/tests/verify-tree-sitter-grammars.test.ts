import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  CORE_CONSUMER_ENTRIES,
  EXPECTED_BUN_VERSION,
  EXPECTED_NATIVE_MODULE_ABI,
  EXPECTED_NODE_BUILD_VERSION,
  MINIMAL_PARSE_CASES,
  NATIVE_DEPENDENCIES,
  NATIVE_LOCK_IDENTITIES,
  TREE_SITTER_PATCH,
  TRUSTED_NATIVE_PACKAGES,
  assertCompatibleNativeAbi,
  assertRuntimeTarget,
  parseBunLockText,
  runDiscriminationSensors,
  verifyBunMaskRestoration,
  verifyColdConsumerProcesses,
  verifyConsumerEntries,
  verifyLockContract,
  verifyLockContractText,
  verifyPatchBehaviorProcess,
  verifyRssDiscriminationProcesses,
  verifyStaticContract,
  withMaskedBunVersion,
} from "../verify-tree-sitter-grammars.ts";

const ROOT = resolve(import.meta.dir, "../..");
const lockSource = readFileSync(resolve(ROOT, "bun.lock"), "utf8");

describe("native Tree-sitter package contract", () => {
  test("freezes exact runtime, build helper, packages, trust, and 33 extensions", () => {
    assertRuntimeTarget();
    const result = verifyStaticContract();

    expect(EXPECTED_BUN_VERSION).toBe("1.3.0");
    expect(EXPECTED_NODE_BUILD_VERSION).toBe("22.22.2");
    expect(EXPECTED_NATIVE_MODULE_ABI).toBe(137);
    expect(Object.keys(NATIVE_DEPENDENCIES)).toHaveLength(27);
    expect(Object.keys(NATIVE_LOCK_IDENTITIES)).toHaveLength(27);
    expect(TRUSTED_NATIVE_PACKAGES).toHaveLength(27);
    expect(MINIMAL_PARSE_CASES).toHaveLength(33);
    expect(result).toEqual({
      extensions: 33,
      nativeDependencies: 27,
      trustedDependencies: 27,
      lockedIdentities: 27,
      patchedDependencies: 1,
    });
    expect(TREE_SITTER_PATCH).toEqual({
      package: "tree-sitter@0.25.0",
      path: "patches/tree-sitter@0.25.0.patch",
      sha256: "b0f73d0031e70f3585fca701076e1c6a05c30968b62f2d939de32af6df39a06a",
    });
  });

  test("parses JSONC and freezes every package resolution and integrity identity", () => {
    expect(parseBunLockText('{"lockfileVersion": 1,}').lockfileVersion).toBe(1);
    expect(verifyLockContract()).toEqual({
      nativeDependencies: 27,
      trustedDependencies: 27,
      lockedIdentities: 27,
      patchedDependencies: 1,
    });
    expect(NATIVE_LOCK_IDENTITIES["tree-sitter"]).toEqual({
      resolved: "tree-sitter@0.25.0",
      sri: "sha512-PGZZzFW63eElZJDe/b/R/LbsjDDYJa5UEjLZJB59RQsMX+fo0j54fqBPn1MGKav/QNa0JR0zBiVaikYDWCj5KQ==",
    });
    expect(NATIVE_LOCK_IDENTITIES["tree-sitter-dart"]).toEqual({
      resolved: "tree-sitter-dart@github:UserNobody14/tree-sitter-dart#be07cf7",
      gitIdentity: "UserNobody14-tree-sitter-dart-be07cf7",
    });

    const corruptedSri = lockSource.replace(
      "sha512-PGZZzFW63eElZJDe/b/R/LbsjDDYJa5UEjLZJB59RQsMX+fo0j54fqBPn1MGKav/QNa0JR0zBiVaikYDWCj5KQ==",
      "sha512-corrupted",
    );
    expect(() => verifyLockContractText(corruptedSri, "corrupted-sri.lock")).toThrow(
      "tree-sitter SRI drifted",
    );
    const corruptedGitIdentity = lockSource.replace(
      "UserNobody14-tree-sitter-dart-be07cf7",
      "UserNobody14-tree-sitter-dart-corrupted",
    );
    expect(() => verifyLockContractText(corruptedGitIdentity, "corrupted-git.lock")).toThrow(
      "tree-sitter-dart Git identity drifted",
    );
    const corruptedPatchMapping = lockSource.replace(
      '"tree-sitter@0.25.0": "patches/tree-sitter@0.25.0.patch"',
      '"tree-sitter@0.25.0": "patches/corrupted.patch"',
    );
    expect(() => verifyLockContractText(corruptedPatchMapping, "corrupted-patch.lock")).toThrow(
      "patchedDependencies",
    );
  });

  test("serializes masking and restores the full Bun descriptor after success and throw", async () => {
    const before = Object.getOwnPropertyDescriptor(process.versions, "bun");
    await verifyBunMaskRestoration();
    expect(Object.getOwnPropertyDescriptor(process.versions, "bun")).toEqual(before);
  });

  test("releases queued callers after descriptor setup and restoration failures", async () => {
    let setupCallbackRan = false;
    const setupFailure = withMaskedBunVersion(
      () => {
        setupCallbackRan = true;
      },
      { target: {} },
    );
    const afterSetupFailure = withMaskedBunVersion(() => "setup-recovered");
    await expect(setupFailure).rejects.toThrow("descriptor is missing");
    expect(setupCallbackRan).toBe(false);
    await expect(afterSetupFailure).resolves.toBe("setup-recovered");

    const fakeVersions: Record<string, string> = {};
    Object.defineProperty(fakeVersions, "bun", {
      configurable: true,
      enumerable: true,
      writable: true,
      value: EXPECTED_BUN_VERSION,
    });
    const restorationFailure = new Error("forced restoration failure");
    const failedRestoration = withMaskedBunVersion(
      () => "callback-completed",
      {
        target: fakeVersions,
        restoreProperty: () => {
          throw restorationFailure;
        },
      },
    );
    const afterRestorationFailure = withMaskedBunVersion(() => "restoration-recovered");
    await expect(failedRestoration).rejects.toBe(restorationFailure);
    await expect(afterRestorationFailure).resolves.toBe("restoration-recovered");
  });

  test("imports real source and built dist entries in separate cold Bun processes", () => {
    expect(verifyConsumerEntries()).toEqual(CORE_CONSUMER_ENTRIES);
    expect(CORE_CONSUMER_ENTRIES.source).toEndWith("packages/core/src/index.ts");
    expect(CORE_CONSUMER_ENTRIES.dist).toEndWith("packages/core/dist/index.js");

    const consumers = verifyColdConsumerProcesses();
    expect(consumers.source).toMatchObject({
      status: "PASS",
      consumer: "source",
      bun: "1.3.0",
      entryImported: true,
      resolvable: 27,
      parses: 33,
      nativeModules: 27,
      patchedRuntimeModule: expect.stringContaining("tree_sitter_runtime_binding.node"),
    });
    expect(consumers.dist).toMatchObject({
      status: "PASS",
      consumer: "dist",
      bun: "1.3.0",
      entryImported: true,
      resolvable: 27,
      parses: 33,
      nativeModules: 27,
      patchedRuntimeModule: expect.stringContaining("tree_sitter_runtime_binding.node"),
    });
    expect(consumers.source.pid).not.toBe(consumers.dist.pid);
    expect(consumers.source.pid).not.toBe(process.pid);
    expect(consumers.dist.pid).not.toBe(process.pid);
  });

  test("requires explicit tree deletion in every non-control parse path", () => {
    const verifierSource = readFileSync(
      resolve(ROOT, "scripts/verify-tree-sitter-grammars.ts"),
      "utf8",
    );
    expect(verifierSource).toContain("interface ParsedTree");
    expect(verifierSource).toContain("delete(): void;");
    expect(verifierSource).toContain("finally {\n    tree.delete();");
    expect(verifierSource).not.toContain("tree.delete?.");
    expect(verifierSource).toContain("control intentionally omits delete");
  });

  test("guards every patched post-delete behavior in a cold child", () => {
    const behavior = verifyPatchBehaviorProcess();
    expect(behavior.status).toBe("PASS");
    expect(behavior.bun).toBe("1.3.0");
    expect(behavior.sensors.doubleDelete).toBe(true);
    expect(behavior.sensors.cachedNode).toContain("Argument must be a live tree");
    expect(behavior.sensors.query).toContain("Missing argument tree");
    expect(behavior.sensors.parserOldTree).toContain("Second argument must be a tree");
    expect(behavior.sensors.cursorDelete).toContain("Tree cursor has been deleted");
    expect(behavior.sensors.cursorAfterTree).toContain("Tree cursor has been deleted");
    expect(behavior.sensors.nodeOwnerSubstitution).toContain("Argument must be a live tree");
    expect(behavior.sensors.cursorOwnerSubstitution).toContain("Tree cursor has been deleted");
    expect(behavior.sensors.cursorResetCrossTree).toContain("same tree");
    expect(behavior.sensors.cursorResetToCrossTree).toContain("same tree");
  });

  test("discriminates no-delete growth and bounds patched 100-cycle RSS", () => {
    const rss = verifyRssDiscriminationProcesses();
    expect(rss.control.cycles).toBe(100);
    expect(rss.control.growthBytes).toBeGreaterThan(16 * 1024 * 1024);
    expect(rss.patched.cycles).toBe(100);
    expect(rss.patched.cycles81To100Median).toBeLessThanOrEqual(
      rss.patched.cycles21To40Median + 16 * 1024 * 1024,
    );
  });

  test("distinguishes missing and incompatible native packages without rejected artifacts", () => {
    expect(runDiscriminationSensors()).toEqual({ missing: true, incompatible: true });
    expect(() =>
      assertCompatibleNativeAbi("compatible", EXPECTED_NATIVE_MODULE_ABI, EXPECTED_NATIVE_MODULE_ABI)
    ).not.toThrow();
    expect(() =>
      assertCompatibleNativeAbi("incompatible", EXPECTED_NATIVE_MODULE_ABI - 1, EXPECTED_NATIVE_MODULE_ABI)
    ).toThrow("incompatible");
  });
});
