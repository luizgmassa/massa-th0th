/**
 * Cursor plugin installer integration tests (Phase 2, T10).
 *
 * Verifies the install.sh behavior against the spec acceptance criteria
 * (CRS-01, CRS-02, CRS-07) and the F5 array-append merge mitigation:
 * - user-scope install creates ~/.cursor/plugins/massa-ai/ + merges hooks.json
 * - project-scope install creates ./.cursor/plugins/massa-ai/
 * - array-append merge preserves pre-existing user hooks
 * - uninstall removes only owned entries; user hooks survive
 * - idempotent re-run is a no-op
 * - MCP deconfliction hint printed
 *
 * Uses spawnSync to run install.sh with an overridden HOME (temp dir),
 * mirroring the apps/codex-plugin/__tests__/install.test.ts convention.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const INSTALL_SH = path.resolve(
  REPO_ROOT,
  "apps/cursor-plugin/install.sh",
);

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mt-cursor-install-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runInstall(
  args: string[],
  env: Record<string, string>,
  cwd?: string,
): RunResult {
  const result = spawnSync("bash", [INSTALL_SH, ...args], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: cwd ?? REPO_ROOT,
    timeout: 30000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function readJson(p: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

describe("cursor-plugin install.sh (T10 / CRS-01,02,07 + F5)", () => {
  test("user-scope install creates ~/.cursor/plugins/massa-ai/ + merges hooks.json with 7 events", async () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const pluginDir = path.join(tmp, ".cursor/plugins/massa-ai");
    expect(await pathExists(path.join(pluginDir, ".cursor-plugin/plugin.json"))).toBe(true);
    expect(await pathExists(path.join(pluginDir, "agents/massa-ai-navigator.md"))).toBe(true);

    const cfg = await readJson(path.join(tmp, ".cursor/hooks.json"));
    expect(cfg).toHaveProperty("version");
    expect(cfg).toHaveProperty("hooks");
    const hooks = cfg.hooks as Record<string, unknown[]>;
    const expectedEvents = [
      "sessionStart",
      "sessionEnd",
      "beforeSubmitPrompt",
      "preToolUse",
      "postToolUse",
      "preCompact",
      "stop",
    ];
    expect(Object.keys(hooks).sort()).toEqual(expectedEvents.sort());
  });

  test("project-scope install creates ./.cursor/plugins/massa-ai/", async () => {
    const res = runInstall(["--project"], { HOME: tmp }, tmp);
    expect(res.exitCode).toBe(0);

    const pluginDir = path.join(tmp, ".cursor/plugins/massa-ai");
    expect(await pathExists(path.join(pluginDir, ".cursor-plugin/plugin.json"))).toBe(true);
    expect(await pathExists(path.join(tmp, ".cursor/hooks.json"))).toBe(true);
  });

  test("array-append merge: pre-existing user hook survives alongside massa-ai entry", async () => {
    // Pre-create hooks.json with a user hook under sessionStart (no marker)
    await fs.mkdir(path.join(tmp, ".cursor"), { recursive: true });
    const userHooks = {
      version: 1,
      hooks: {
        sessionStart: [{ command: "user-script" }],
      },
    };
    await fs.writeFile(
      path.join(tmp, ".cursor/hooks.json"),
      JSON.stringify(userHooks),
    );

    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const cfg = await readJson(path.join(tmp, ".cursor/hooks.json"));
    const sessionStart = cfg.hooks!.sessionStart as Record<string, unknown>[];
    expect(sessionStart.length).toBe(2);
    // User hook survives
    const userEntry = sessionStart.find(
      (e) => (e.command as string) === "user-script",
    );
    expect(userEntry).toBeDefined();
    // massa-ai entry appended
    const owned = sessionStart.find(
      (e) => e._massaAiOwned === true,
    );
    expect(owned).toBeDefined();
    // Top-level version preserved
    expect(cfg.version).toBe(1);
  });

  test("uninstall removes only owned entries; user hook survives", async () => {
    await fs.mkdir(path.join(tmp, ".cursor"), { recursive: true });
    const userHooks = {
      version: 1,
      hooks: {
        sessionStart: [{ command: "user-script" }],
      },
    };
    await fs.writeFile(
      path.join(tmp, ".cursor/hooks.json"),
      JSON.stringify(userHooks),
    );

    runInstall(["--user"], { HOME: tmp });
    const res = runInstall(["--uninstall"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const cfg = await readJson(path.join(tmp, ".cursor/hooks.json"));
    const sessionStart = cfg.hooks!.sessionStart as Record<string, unknown>[];
    // massa-ai entries gone
    expect(
      sessionStart.find((e) => e._massaAiOwned === true),
    ).toBeUndefined();
    // User hook survives
    expect(
      sessionStart.find((e) => (e.command as string) === "user-script"),
    ).toBeDefined();
    // Plugin dir removed
    expect(
      await pathExists(path.join(tmp, ".cursor/plugins/massa-ai")),
    ).toBe(false);
  });

  test("idempotent: running --user twice produces no diff in hooks.json", async () => {
    runInstall(["--user"], { HOME: tmp });
    const afterFirst = await fs.readFile(
      path.join(tmp, ".cursor/hooks.json"),
      "utf8",
    );
    runInstall(["--user"], { HOME: tmp });
    const afterSecond = await fs.readFile(
      path.join(tmp, ".cursor/hooks.json"),
      "utf8",
    );
    expect(afterSecond).toBe(afterFirst);
  });

  test("MCP deconfliction hint printed", () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("install-agents.ts");
    expect(res.stdout.toLowerCase()).toContain("mcp");
  });

  // ── T6: 12 subagent specialists bundled into plugin agents/ (CRS-01,04,07 + DOC-01) ─
  const SPECIALIST_NAMES = [
    "investigator",
    "planner",
    "builder",
    "reviewer",
    "context-curator",
    "verification-agent",
    "requirements-analyst",
    "architecture-specialist",
    "test-engineer",
    "documentation-agent",
    "audit-specialist",
    "mobile-specialist",
  ];

  test("CRS-01/CRS-04/DOC-01: install copies 12 specialists + navigator (13 .md) into plugin agents/ + prints summary", async () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const agentsDir = path.join(tmp, ".cursor/plugins/massa-ai/agents");
    // Navigator preserved (CRS-04)
    expect(await pathExists(path.join(agentsDir, "massa-ai-navigator.md"))).toBe(true);
    // 12 specialists (CRS-01)
    for (const name of SPECIALIST_NAMES) {
      expect(
        await pathExists(path.join(agentsDir, `massa-ai-${name}.md`)),
      ).toBe(true);
    }
    // Total 13 .md files in agents/
    const files = (await fs.readdir(agentsDir)).filter((f) => f.endsWith(".md"));
    expect(files.length).toBe(13);

    // Install output mentions 12 subagent specialists (DOC-01)
    expect(res.stdout).toContain("12 subagent specialists");
  });

  test("CRS-05: uninstall removes whole plugin dir (all 13 agents gone)", async () => {
    runInstall(["--user"], { HOME: tmp });
    const agentsDir = path.join(tmp, ".cursor/plugins/massa-ai/agents");
    expect(await pathExists(agentsDir)).toBe(true);

    const res = runInstall(["--uninstall"], { HOME: tmp });
    expect(res.exitCode).toBe(0);
    // Whole plugin dir removed (CRS-05: unchanged behavior)
    expect(
      await pathExists(path.join(tmp, ".cursor/plugins/massa-ai")),
    ).toBe(false);
  });
});