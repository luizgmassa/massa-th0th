import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  assertProjectRootReuse,
  canonicalizeProjectRoot,
} from "../tools/index_project.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) =>
    rm(root, { recursive: true, force: true })
  ));
});

async function fixtureRoots(): Promise<{
  first: string;
  firstAlias: string;
  second: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "massa-ai-root-identity-"));
  roots.push(root);
  const first = path.join(root, "first");
  const second = path.join(root, "second");
  const firstAlias = path.join(root, "first-alias");
  await mkdir(first);
  await mkdir(second);
  await symlink(first, firstAlias);
  return { first, firstAlias, second };
}

describe("index_project canonical root identity", () => {
  test("realpath canonicalizes a symlinked request root", async () => {
    const { first, firstAlias } = await fixtureRoots();
    expect(await canonicalizeProjectRoot(firstAlias)).toBe(await realpath(first));
  });

  test("non-force reuse accepts aliases of the same canonical root", async () => {
    const { first, firstAlias } = await fixtureRoots();
    await expect(assertProjectRootReuse({
      projectId: "identity-project",
      canonicalProjectPath: await canonicalizeProjectRoot(first),
      storedProjectPath: firstAlias,
      forceReindex: false,
    })).resolves.toBeUndefined();
  });

  test("non-force reuse rejects a different canonical root", async () => {
    const { first, second } = await fixtureRoots();
    await expect(assertProjectRootReuse({
      projectId: "identity-project",
      canonicalProjectPath: await canonicalizeProjectRoot(first),
      storedProjectPath: second,
      forceReindex: false,
    })).rejects.toThrow("already indexes canonical root");
  });

  test("force reuse permits a caller-owned replacement root", async () => {
    const { first, second } = await fixtureRoots();
    await expect(assertProjectRootReuse({
      projectId: "identity-project",
      canonicalProjectPath: await canonicalizeProjectRoot(first),
      storedProjectPath: second,
      forceReindex: true,
    })).resolves.toBeUndefined();
  });
});
