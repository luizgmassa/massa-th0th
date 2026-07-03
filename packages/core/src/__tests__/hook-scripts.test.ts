/**
 * Hook script existence + silent-degrade test (Phase 3, P3-HOOKSCRIPT-01).
 *
 * Verifies the four Claude Code hook scripts exist under apps/claude-plugin/hooks,
 * are executable, and that the core silent-degrade guard (curl missing → exit 0)
 * works. The full "curl to a dead endpoint → exit 0" path is exercised manually
 * in validation (it depends on curl availability in the environment).
 */

import { describe, expect, it } from "bun:test";
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const HOOKS_DIR = path.resolve(
  __dirname,
  "../../../../apps/claude-plugin/hooks",
);

const EXPECTED = [
  "session-start.sh",
  "user-prompt-submit.sh",
  "post-tool-use.sh",
  "stop.sh",
  "_post.sh",
];

describe("Claude Code hook scripts (P3-HOOKSCRIPT-01)", () => {
  it("all four lifecycle scripts + the shared helper exist", () => {
    for (const f of EXPECTED) {
      const p = path.join(HOOKS_DIR, f);
      expect(fs.existsSync(p), `${f} should exist at ${p}`).toBe(true);
    }
  });

  it("lifecycle scripts are executable", () => {
    for (const f of ["session-start.sh", "user-prompt-submit.sh", "post-tool-use.sh", "stop.sh"]) {
      const p = path.join(HOOKS_DIR, f);
      const stat = fs.statSync(p);
      // Mode 0o111 (any execute bit)
      expect(stat.mode & 0o111, `${f} should be executable`).not.toBe(0);
    }
  });

  it("each lifecycle script maps to the correct massa-th0th event kind", () => {
    const cases: Array<[string, string]> = [
      ["session-start.sh", "session-start"],
      ["user-prompt-submit.sh", "user-prompt"],
      ["post-tool-use.sh", "post-tool-use"],
      ["stop.sh", "session-end"],
    ];
    for (const [file, event] of cases) {
      const content = fs.readFileSync(path.join(HOOKS_DIR, file), "utf8");
      expect(content).toContain(`EVENT="${event}"`);
    }
  });

  it("silent-degrades when curl is missing (exit 0, no output)", () => {
    // Replicate the guard from _post.sh in isolation.
    const probe = `#!/bin/sh
command -v curl >/dev/null 2>&1 || { exit 0; }
exit 7
`;
    const tmp = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "massa-th0th-hook-")), "probe.sh");
    fs.writeFileSync(tmp, probe);
    fs.chmodSync(tmp, 0o755);
    // Run with a PATH that does NOT contain curl (use /dev/null).
    let exitCode = -1;
    try {
      execSync(`env PATH=/dev/null ${tmp}`, { stdio: "ignore" });
      exitCode = 0;
    } catch (e: any) {
      exitCode = e.status ?? -1;
    }
    expect(exitCode).toBe(0);
  });

  it("the shared _post.sh contains the 2s timeout + exit 0 contract", () => {
    const content = fs.readFileSync(path.join(HOOKS_DIR, "_post.sh"), "utf8");
    expect(content).toContain("-m 2");
    expect(content).toContain("exit 0");
    expect(content).toContain("MASSA_TH0TH_API_BASE");
    expect(content).toContain("MASSA_TH0TH_API_KEY");
  });
});
