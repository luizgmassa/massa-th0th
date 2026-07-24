/**
 * Codex plugin installer integration tests (Phase 1, T5).
 *
 * Verifies the install.sh behavior against the spec acceptance criteria
 * (CPX-01, CPX-02, CPX-07) and the F5 array-append merge mitigation:
 * - user-scope install creates ~/.codex/plugins/massa-ai/ + merges hooks.json
 * - project-scope install creates ./.codex/plugins/massa-ai/
 * - array-append merge preserves pre-existing user hooks
 * - uninstall removes only owned entries; user hooks survive
 * - idempotent re-run is a no-op
 * - trust warning printed to stdout
 *
 * Uses spawnSync to run install.sh with an overridden HOME (temp dir),
 * mirroring the scripts/__tests__/install-agents.test.ts convention.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const REPO_ROOT = path.resolve(import.meta.dir, "../../..");
const INSTALL_SH = path.resolve(
  REPO_ROOT,
  "apps/codex-plugin/install.sh",
);

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mt-codex-install-"));
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

describe("codex-plugin install.sh (T5 / CPX-01,02,07 + F5)", () => {
  test("user-scope install creates ~/.codex/plugins/massa-ai/ + merges hooks.json with 6 events", async () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const pluginDir = path.join(tmp, ".codex/plugins/massa-ai");
    expect(await pathExists(path.join(pluginDir, ".codex-plugin/plugin.json"))).toBe(true);

    const hooks = await readJson(path.join(tmp, ".codex/hooks.json"));
    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PreCompact",
      "Stop",
    ];
    expect(Object.keys(hooks).sort()).toEqual(expectedEvents.sort());
  });

  test("project-scope install creates ./.codex/plugins/massa-ai/", async () => {
    const res = runInstall(["--project"], { HOME: tmp }, tmp);
    expect(res.exitCode).toBe(0);

    const pluginDir = path.join(tmp, ".codex/plugins/massa-ai");
    expect(await pathExists(path.join(pluginDir, ".codex-plugin/plugin.json"))).toBe(true);
    expect(await pathExists(path.join(tmp, ".codex/hooks.json"))).toBe(true);
  });

  test("array-append merge: pre-existing user hook survives alongside massa-ai entry", async () => {
    // Pre-create hooks.json with a user hook under SessionStart (no marker)
    await fs.mkdir(path.join(tmp, ".codex"), { recursive: true });
    const userHooks = {
      SessionStart: [{ type: "command", command: "echo user-hook" }],
      model: "gpt-5",
    };
    await fs.writeFile(
      path.join(tmp, ".codex/hooks.json"),
      JSON.stringify(userHooks),
    );

    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const hooks = await readJson(path.join(tmp, ".codex/hooks.json"));
    const sessionStart = hooks.SessionStart as Record<string, unknown>[];
    expect(sessionStart.length).toBe(2);
    // User hook survives
    const userEntry = sessionStart.find(
      (e) => (e.command as string) === "echo user-hook",
    );
    expect(userEntry).toBeDefined();
    // massa-ai entry appended
    const owned = sessionStart.find(
      (e) => e._massaAiOwned === true,
    );
    expect(owned).toBeDefined();
    // User top-level key preserved
    expect(hooks.model).toBe("gpt-5");
  });

  test("uninstall removes only owned entries; user hook survives", async () => {
    await fs.mkdir(path.join(tmp, ".codex"), { recursive: true });
    const userHooks = {
      SessionStart: [{ type: "command", command: "echo user-hook" }],
      model: "gpt-5",
    };
    await fs.writeFile(
      path.join(tmp, ".codex/hooks.json"),
      JSON.stringify(userHooks),
    );

    runInstall(["--user"], { HOME: tmp });
    const res = runInstall(["--uninstall"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    const hooks = await readJson(path.join(tmp, ".codex/hooks.json"));
    const sessionStart = hooks.SessionStart as Record<string, unknown>[];
    // massa-ai entries gone
    expect(
      sessionStart.find((e) => e._massaAiOwned === true),
    ).toBeUndefined();
    // User hook survives
    expect(
      sessionStart.find((e) => (e.command as string) === "echo user-hook"),
    ).toBeDefined();
    expect(hooks.model).toBe("gpt-5");
    // Plugin dir removed
    expect(
      await pathExists(path.join(tmp, ".codex/plugins/massa-ai")),
    ).toBe(false);
  });

  test("idempotent: running --user twice produces no diff in hooks.json", async () => {
    runInstall(["--user"], { HOME: tmp });
    const afterFirst = await fs.readFile(
      path.join(tmp, ".codex/hooks.json"),
      "utf8",
    );
    runInstall(["--user"], { HOME: tmp });
    const afterSecond = await fs.readFile(
      path.join(tmp, ".codex/hooks.json"),
      "utf8",
    );
    expect(afterSecond).toBe(afterFirst);
  });

  test("trust warning printed to stdout (contains /hooks and trust)", () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("/hooks");
    expect(res.stdout.toLowerCase()).toContain("trust");
  });

  test("MCP deconfliction hint printed", () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);
    expect(res.stdout).toContain("install-agents.ts");
    expect(res.stdout.toLowerCase()).toContain("mcp");
  });

  // ── T5: 12 subagent TOML agents (CDX-01,02,05,06,07 + DOC-01) ──────────────
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

  test("CDX-01/DOC-01: user-scope install writes 12 TOML agents to ~/.codex/agents/ + prints summary", async () => {
    const res = runInstall(["--user"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    // 12 TOML files at ~/.codex/agents/massa-ai-<name>.toml (OUTSIDE plugin dir)
    const agentsDir = path.join(tmp, ".codex/agents");
    for (const name of SPECIALIST_NAMES) {
      expect(
        await pathExists(path.join(agentsDir, `massa-ai-${name}.toml`)),
      ).toBe(true);
    }
    // Agents dir is OUTSIDE the plugin dir
    expect(agentsDir).not.toContain("plugins");

    // Install output mentions 12 subagent specialists (DOC-01)
    expect(res.stdout).toContain("12 subagent specialists");
  });

  test("CDX-07: each TOML has # massa-ai-owned top comment", async () => {
    runInstall(["--user"], { HOME: tmp });
    for (const name of SPECIALIST_NAMES) {
      const content = await fs.readFile(
        path.join(tmp, `.codex/agents/massa-ai-${name}.toml`),
        "utf8",
      );
      const firstLine = content.split(/\r?\n/)[0] ?? "";
      expect(firstLine).toBe("# massa-ai-owned");
    }
  });

  test("CDX-05/CDX-06: uninstall removes only owned TOML; user agents preserved (R3)", async () => {
    runInstall(["--user"], { HOME: tmp });
    const agentsDir = path.join(tmp, ".codex/agents");

    // Pre-seed a user agent (no ownership marker)
    await fs.writeFile(
      path.join(agentsDir, "user-custom.toml"),
      'name = "user-custom"\ndescription = "user agent"\n',
    );

    const res = runInstall(["--uninstall"], { HOME: tmp });
    expect(res.exitCode).toBe(0);

    // 12 massa-ai-owned TOML files removed
    for (const name of SPECIALIST_NAMES) {
      expect(
        await pathExists(path.join(agentsDir, `massa-ai-${name}.toml`)),
      ).toBe(false);
    }
    // User agent survives (R3: no ownership marker)
    expect(await pathExists(path.join(agentsDir, "user-custom.toml"))).toBe(true);
  });

  test("CDX-06: idempotent re-run overwrites TOML with identical content", async () => {
    runInstall(["--user"], { HOME: tmp });
    const readAll = async () => {
      const out: Record<string, string> = {};
      for (const name of SPECIALIST_NAMES) {
        out[name] = await fs.readFile(
          path.join(tmp, `.codex/agents/massa-ai-${name}.toml`),
          "utf8",
        );
      }
      return out;
    };
    const afterFirst = await readAll();
    runInstall(["--user"], { HOME: tmp });
    const afterSecond = await readAll();
    for (const name of SPECIALIST_NAMES) {
      expect(afterSecond[name]).toBe(afterFirst[name]);
    }
  });
});