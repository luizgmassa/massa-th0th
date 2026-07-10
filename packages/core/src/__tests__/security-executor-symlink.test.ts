/**
 * Security tests for the execute_file symlink bypass fix (structural gap #3).
 *
 * The vulnerability: the boundary check used `relative(root, absolutePath)` on
 * the path STRING without resolving symlinks. A symlink inside the project root
 * pointing to `/etc/passwd` or a non-deny-glob secrets file passed both the
 * boundary AND deny-glob checks, then `readFileSync` followed the symlink out
 * of the project.
 *
 * The fix: `realpathSync` is called on BOTH the target file AND the project
 * root before the boundary + deny-glob checks. If the realpath escapes the
 * realpath-root or matches a deny pattern, the request is rejected.
 *
 * These tests verify:
 *   1. A symlink inside the project pointing to a file OUTSIDE the project
 *      (e.g. /etc/hosts) is rejected.
 *   2. A symlink inside the project pointing to a file outside the project via
 *      a chain of symlinks is rejected.
 *   3. A symlink whose link name matches a deny pattern (e.g. `.env`) is
 *      rejected by the deny-glob check.
 *   4. A symlink pointing TO a deny-patterned realpath is rejected.
 *   5. A legit (non-symlinked) in-cwd file still works after the fix.
 *   6. A symlink to another file INSIDE the project root still works (legit
 *      internal symlink is not a bypass).
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import {
  PolyglotExecutor,
  detectRuntimes,
} from "../services/executor/index.js";
import {
  mkdtempSync,
  writeFileSync,
  symlinkSync,
  rmSync,
  mkdirSync,
  realpathSync,
} from "node:fs";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";

const RUNTIMES = detectRuntimes();
const HAS_NODE = RUNTIMES.javascript === "node" || RUNTIMES.javascript === "bun";

/** Build a throwaway project root + an outside-project secrets file. */
function makeProject(): {
  projectRoot: string;
  outsideDir: string;
  outsideFile: string;
  outsideSecret: string;
  cleanup: () => void;
} {
  // Two sibling temp dirs: one is the "project root", the other is "outside".
  const base = mkdtempSync(join(tmpdir(), ".massa-th0th-sec-"));
  const projectRoot = join(base, "project");
  const outsideDir = join(base, "outside");
  mkdirSync(projectRoot, { recursive: true });
  mkdirSync(outsideDir, { recursive: true });

  // A non-sensitive file outside the project (e.g. /etc/hosts stand-in).
  const outsideFile = join(outsideDir, "hosts.txt");
  writeFileSync(outsideFile, "127.0.0.1 localhost\n", "utf-8");

  // A secrets file outside the project whose name is NOT on the deny list
  // (so only the realpath boundary check catches a symlink to it).
  const outsideSecret = join(outsideDir, "config.yaml");
  writeFileSync(outsideSecret, "api_key: leaked\n", "utf-8");

  return {
    projectRoot: realpathSync(projectRoot),
    outsideDir,
    outsideFile,
    outsideSecret,
    cleanup: () => rmSync(base, { recursive: true, force: true }),
  };
}

describe("execute_file symlink bypass — realpath defense", () => {
  let project: ReturnType<typeof makeProject>;
  let exec: PolyglotExecutor;

  beforeEach(() => {
    project = makeProject();
    exec = new PolyglotExecutor({ projectRoot: project.projectRoot });
  });

  afterEach(() => {
    exec.cleanupBackgrounded();
    project.cleanup();
  });

  (HAS_NODE ? test : test.skip)("rejects a symlink pointing outside the project (boundary bypass)", async () => {
    // Create a symlink INSIDE the project root pointing to an outside file.
    const linkPath = join(project.projectRoot, "evil-link.txt");
    symlinkSync(project.outsideFile, linkPath);

    const result = await exec.executeFile({
      path: "evil-link.txt",
      language: "javascript",
      code: `console.log(FILE_CONTENT);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/outside the project root/);
    // Must NOT have leaked the outside file's content.
    expect(result.stdout).not.toContain("localhost");
  });

  (HAS_NODE ? test : test.skip)("rejects a symlink chain (link → link → outside)", async () => {
    // First symlink inside project → second symlink (also inside) → outside file.
    const outsideTarget = project.outsideFile;
    const innerLink = join(project.projectRoot, "inner-chain.txt");
    const outerLink = join(project.projectRoot, "outer-chain.txt");
    symlinkSync(outsideTarget, innerLink);
    symlinkSync(innerLink, outerLink);

    const result = await exec.executeFile({
      path: "outer-chain.txt",
      language: "javascript",
      code: `console.log(FILE_CONTENT);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/outside the project root/);
  });

  (HAS_NODE ? test : test.skip)("rejects a symlink whose LINK NAME matches a deny pattern", async () => {
    // The link is named `.env` (deny-listed). It points to a file INSIDE the
    // project so the boundary check passes — only the deny-glob (which checks
    // the lexical absolute path) catches the link name.
    const insideTarget = join(project.projectRoot, "real-data.txt");
    writeFileSync(insideTarget, "would-be-leaked", "utf-8");
    const linkPath = join(project.projectRoot, ".env");
    symlinkSync(insideTarget, linkPath);

    const result = await exec.executeFile({
      path: ".env",
      language: "javascript",
      code: `console.log(FILE_CONTENT);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/deny-listed pattern/);
  });

  (HAS_NODE ? test : test.skip)("rejects a symlink pointing TO a deny-patterned realpath", async () => {
    // The link name is benign ("config"), but it points to an outside file
    // whose realpath contains a deny pattern. Only the realpath deny check
    // catches this.
    // Create an outside file named "secrets.json" (deny-listed).
    const secretReal = join(project.outsideDir, "secrets.json");
    writeFileSync(secretReal, '{"key":"leaked"}', "utf-8");
    const linkPath = join(project.projectRoot, "config");
    symlinkSync(secretReal, linkPath);

    const result = await exec.executeFile({
      path: "config",
      language: "javascript",
      code: `console.log(FILE_CONTENT);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    // Either the boundary check (outside project) or the deny-glob (realpath
    // contains "secrets.json") catches it. Both are valid rejections.
    expect(result.stderr).toMatch(/outside the project root|deny-listed pattern/);
    expect(result.stdout).not.toContain("leaked");
  });

  (HAS_NODE ? test : test.skip)("allows a legit non-symlinked in-cwd file", async () => {
    // A real file inside the project root must still work after the fix.
    const realFile = join(project.projectRoot, "data.txt");
    writeFileSync(realFile, "hello-symlink-fix", "utf-8");

    const result = await exec.executeFile({
      path: "data.txt",
      language: "javascript",
      code: `console.log(FILE_CONTENT.trim());`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("hello-symlink-fix");
  });

  (HAS_NODE ? test : test.skip)("allows a symlink to another file INSIDE the project root", async () => {
    // An internal symlink (target also under the project root) is legitimate
    // and must NOT be blocked — the realpath stays under the realpath-root.
    const realFile = join(project.projectRoot, "real.txt");
    writeFileSync(realFile, "internal-symlink-ok", "utf-8");
    const linkPath = join(project.projectRoot, "link.txt");
    symlinkSync(realFile, linkPath);

    const result = await exec.executeFile({
      path: "link.txt",
      language: "javascript",
      code: `console.log(FILE_CONTENT.trim());`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(0);
    expect(result.stdout.trim()).toBe("internal-symlink-ok");
  });

  (HAS_NODE ? test : test.skip)("rejects ../ traversal that escapes via symlink in the path", async () => {
    // A path like "sub/../../outside" where a mid-path component is a symlink
    // that redirects out of the project. realpath resolves the full chain.
    const subDir = join(project.projectRoot, "sub");
    mkdirSync(subDir, { recursive: true });
    // "sub/escape" is a symlink pointing to the outside dir.
    const escapeLink = join(subDir, "escape");
    symlinkSync(project.outsideDir, escapeLink);

    const result = await exec.executeFile({
      path: "sub/escape/hosts.txt",
      language: "javascript",
      code: `console.log(FILE_CONTENT);`,
      timeout: 10_000,
    });
    expect(result.exitCode).toBe(1);
    expect(result.stderr).toMatch(/outside the project root/);
  });
});
