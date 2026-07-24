import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import {
  EXPECTED_NPM_VERSION,
  PACKED_RUNTIME_ADDON,
  assertCoreTarEntries,
  assertPublishManifests,
  createPackedConsumerManifest,
  verifyPackageArtifactStaticContract,
} from "../verify-tree-sitter-package-artifact.ts";
import { TRUSTED_NATIVE_PACKAGES } from "../verify-tree-sitter-grammars.ts";

const ROOT = resolve(import.meta.dir, "../..");

describe("macOS arm64 packed Tree-sitter artifact contract", () => {
  test("freezes publish-safe manifests and exact build tools", () => {
    expect(verifyPackageArtifactStaticContract()).toEqual({
      sharedVersion: "1.1.0",
      coreVersion: "1.1.0",
      trustedDependencies: 27,
    });
    expect(EXPECTED_NPM_VERSION).toBe("11.14.1");
  });

  test("accepts only semver shared dependencies and one bundled runtime", () => {
    const shared = { name: "@massa-ai/shared", version: "1.0.0" };
    const core = {
      name: "@massa-ai/core",
      version: "1.0.0",
      dependencies: { "@massa-ai/shared": "1.0.0" },
      bundledDependencies: ["tree-sitter"],
    };
    expect(() => assertPublishManifests(shared, core)).not.toThrow();
    expect(() => assertPublishManifests(shared, {
      ...core,
      dependencies: { "@massa-ai/shared": "workspace:*" },
    })).toThrow("plain semver");
    expect(() => assertPublishManifests(shared, {
      ...core,
      bundledDependencies: ["tree-sitter", "tree-sitter-javascript"],
    })).toThrow("bundle only tree-sitter");
  });

  test("requires the exact nested generated addon and rejects alternatives", () => {
    const valid = [
      "package/package.json",
      "package/node_modules/tree-sitter/package.json",
      PACKED_RUNTIME_ADDON,
    ];
    expect(() => assertCoreTarEntries(valid)).not.toThrow();
    expect(() => assertCoreTarEntries(valid.slice(0, 2))).toThrow("generated addon");
    expect(() => assertCoreTarEntries([
      ...valid,
      "package/node_modules/tree-sitter/prebuilds/darwin-arm64/alternate.node",
    ])).toThrow("alternate tree-sitter addons");
  });

  test("consumer redirects only unpublished shared and trusts the audited native set", () => {
    const manifest = createPackedConsumerManifest("/tmp/shared.tgz", "/tmp/core.tgz") as {
      dependencies: Record<string, string>;
      overrides: Record<string, string>;
      trustedDependencies: string[];
    };
    expect(manifest.dependencies).toEqual({
      "@massa-ai/shared": "file:/tmp/shared.tgz",
      "@massa-ai/core": "file:/tmp/core.tgz",
    });
    expect(manifest.overrides).toEqual({
      "@massa-ai/shared": "file:/tmp/shared.tgz",
    });
    expect(manifest.trustedDependencies).toEqual(TRUSTED_NATIVE_PACKAGES);
  });

  test("invokes exact npm through Node without a shell and uses fresh caches", () => {
    const source = readFileSync(
      resolve(ROOT, "scripts/verify-tree-sitter-package-artifact.ts"),
      "utf8",
    );
    expect(source).toContain('command(node, [npmCli, "--version"])');
    expect(source).toContain('[npmCli, "pack", "--json", "--ignore-scripts"');
    expect(source).toContain('["install", "--cache-dir", bunCache, "--no-progress"]');
    expect(source).not.toContain("shell: true");
  });
});
