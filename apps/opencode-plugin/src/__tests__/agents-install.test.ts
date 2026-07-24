/**
 * OpenCode agents install/uninstall integration tests (T7).
 *
 * Verifies the `massa-ai-config agents` subcommand against spec ACs
 * (OPC-01,02,05,06,07 + DOC-01):
 * - `agents install --user` writes 12 .md files to ~/.config/opencode/agents/
 * - each file has mode: subagent + metadata: { massa-ai-owned: true }
 * - `agents uninstall` removes only massa-ai-owned files (R3: user agents preserved)
 * - idempotent re-run overwrites with identical content
 * - install prints "+ 12 subagent specialists"
 *
 * Uses spawnSync to run the source CLI with overridden HOME + XDG_CONFIG_HOME.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { spawnSync } from "child_process";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

const REPO_ROOT = path.resolve(import.meta.dir, "../../../..");
const CLI = path.resolve(
  REPO_ROOT,
  "apps/opencode-plugin/src/config-cli.ts",
);

let tmp: string;
let xdgConfig: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mt-opencode-agents-"));
  xdgConfig = path.join(tmp, ".config");
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

function runCli(
  cliArgs: string[],
  env: Record<string, string>,
): RunResult {
  const result = spawnSync("bun", ["run", CLI, ...cliArgs], {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: REPO_ROOT,
    timeout: 30000,
  });
  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

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

describe("opencode-plugin config-cli agents subcommand (T7 / OPC-01,02,05,06,07 + DOC-01)", () => {
  test("OPC-01/DOC-01: agents install --user writes 12 .md to ~/.config/opencode/agents/ + prints summary", async () => {
    const res = runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    expect(res.exitCode).toBe(0);

    const agentsDir = path.join(xdgConfig, "opencode/agents");
    for (const name of SPECIALIST_NAMES) {
      expect(
        await pathExists(path.join(agentsDir, `massa-ai-${name}.md`)),
      ).toBe(true);
    }

    // Install output mentions 12 subagent specialists (DOC-01)
    expect(res.stdout).toContain("12 subagent specialists");
  });

  test("OPC-07: each installed agent has mode: subagent + metadata massa-ai-owned: true", async () => {
    runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    const agentsDir = path.join(xdgConfig, "opencode/agents");
    for (const name of SPECIALIST_NAMES) {
      const content = await fs.readFile(
        path.join(agentsDir, `massa-ai-${name}.md`),
        "utf8",
      );
      expect(content).toContain("mode: subagent");
      expect(content).toContain("massa-ai-owned: true");
    }
  });

  test("OPC-02: read-only agents have edit: deny; write agents have edit: allow", async () => {
    runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    const agentsDir = path.join(xdgConfig, "opencode/agents");
    const writeAgents = new Set(["builder", "test-engineer", "documentation-agent"]);

    for (const name of SPECIALIST_NAMES) {
      const content = await fs.readFile(
        path.join(agentsDir, `massa-ai-${name}.md`),
        "utf8",
      );
      const permLine = content.split("\n").find((l) => l.startsWith("permission:")) ?? "";
      if (writeAgents.has(name)) {
        expect(permLine).toContain("edit: allow");
      } else {
        expect(permLine).toContain("edit: deny");
      }
    }
  });

  test("OPC-05/OPC-06: uninstall removes only owned files; user agents preserved (R3)", async () => {
    const agentsDir = path.join(xdgConfig, "opencode/agents");
    runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });

    // Pre-seed a user agent (no ownership marker)
    await fs.writeFile(
      path.join(agentsDir, "user-custom.md"),
      "---\nname: user-custom\ndescription: user agent\nmode: subagent\n---\nbody\n",
    );

    const res = runCli(["agents", "uninstall", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    expect(res.exitCode).toBe(0);

    // 12 massa-ai-owned files removed
    for (const name of SPECIALIST_NAMES) {
      expect(
        await pathExists(path.join(agentsDir, `massa-ai-${name}.md`)),
      ).toBe(false);
    }
    // User agent survives (R3: no ownership marker)
    expect(await pathExists(path.join(agentsDir, "user-custom.md"))).toBe(true);
  });

  test("OPC-06: idempotent re-run overwrites with identical content", async () => {
    const agentsDir = path.join(xdgConfig, "opencode/agents");
    runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    const readAll = async () => {
      const out: Record<string, string> = {};
      for (const name of SPECIALIST_NAMES) {
        out[name] = await fs.readFile(
          path.join(agentsDir, `massa-ai-${name}.md`),
          "utf8",
        );
      }
      return out;
    };
    const afterFirst = await readAll();
    runCli(["agents", "install", "--user"], {
      HOME: tmp,
      XDG_CONFIG_HOME: xdgConfig,
    });
    const afterSecond = await readAll();
    for (const name of SPECIALIST_NAMES) {
      expect(afterSecond[name]).toBe(afterFirst[name]);
    }
  });
});