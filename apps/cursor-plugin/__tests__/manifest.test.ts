/**
 * Cursor plugin manifest + structure tests (Phase 2, T10).
 *
 * Verifies the static plugin bundle shape against the spec acceptance
 * criteria (CRS-01, CRS-03, CRS-04, CRS-05, CRS-06, CRS-08):
 * - 7 events in hooks/hooks.json including sessionStart + preCompact (historical gap fix)
 * - 6 skills/<name>/SKILL.md files exist
 * - agents/massa-th0th-navigator.md exists
 * - mcp.json declares the massa-th0th MCP server (npx @massa-th0th/mcp-client)
 * - .cursor-plugin/plugin.json has name and version
 * - hooks/massa-th0th-hook symlink resolves to the claude-plugin binary
 * - directory layout matches vscode.cursor.plugins.registerPath auto-discovery
 */

import { describe, test, expect } from "bun:test";
import { promises as fs } from "fs";
import path from "path";

const PLUGIN_ROOT = path.resolve(import.meta.dir, "..");
const REPO_ROOT = path.resolve(PLUGIN_ROOT, "../..");
const CLAUDE_PLUGIN_BIN = path.resolve(
  REPO_ROOT,
  "apps/claude-plugin/hooks/massa-th0th-hook.ts",
);

async function readJson(p: string): Promise<Record<string, unknown>> {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

describe("cursor-plugin manifest (T10 / CRS-01,03,04,05,06,08)", () => {
  test("hooks/hooks.json contains 7 events including sessionStart + preCompact (historical gap fix)", async () => {
    const cfg = await readJson(path.join(PLUGIN_ROOT, "hooks/hooks.json"));
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
    // Historical gap fix: sessionStart + preCompact must be present
    expect(hooks).toHaveProperty("sessionStart");
    expect(hooks).toHaveProperty("preCompact");
    for (const evt of expectedEvents) {
      const arr = hooks[evt];
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThanOrEqual(1);
      const owned = arr.find(
        (e) =>
          (e as Record<string, unknown>)._massaTh0thOwned === true,
      );
      expect(owned).toBeDefined();
      const cmd = (owned as Record<string, unknown>).command as string;
      expect(cmd).toContain("massa-th0th-hook");
    }
  });

  test("6 skills/<name>/SKILL.md files exist (map, index, find, def, graph, status)", async () => {
    const expected = ["map", "index", "find", "def", "graph", "status"];
    for (const name of expected) {
      const p = path.join(PLUGIN_ROOT, `skills/${name}/SKILL.md`);
      const stat = await fs.stat(p);
      expect(stat.isFile()).toBe(true);
      const content = await fs.readFile(p, "utf8");
      // Adapted frontmatter keeps description + allowed-tools
      expect(content).toContain("description:");
      expect(content).toContain("allowed-tools:");
    }
  });

  test("agents/massa-th0th-navigator.md exists", async () => {
    const p = path.join(PLUGIN_ROOT, "agents/massa-th0th-navigator.md");
    const stat = await fs.stat(p);
    expect(stat.isFile()).toBe(true);
    const content = await fs.readFile(p, "utf8");
    expect(content).toContain("massa-th0th-navigator");
  });

  test("mcp.json declares massa-th0th MCP server with npx @massa-th0th/mcp-client", async () => {
    const mcp = await readJson(path.join(PLUGIN_ROOT, "mcp.json"));
    expect(mcp).toHaveProperty("mcpServers");
    const servers = mcp.mcpServers as Record<string, Record<string, unknown>>;
    expect(servers).toHaveProperty("massa-th0th");
    const entry = servers["massa-th0th"];
    const cmd = entry.command as unknown[];
    expect(Array.isArray(cmd)).toBe(true);
    expect(cmd).toContain("npx");
    expect(cmd).toContain("@massa-th0th/mcp-client");
    expect(entry.env).toHaveProperty("MASSA_TH0TH_API_URL");
  });

  test(".cursor-plugin/plugin.json has name and version", async () => {
    const manifest = await readJson(
      path.join(PLUGIN_ROOT, ".cursor-plugin/plugin.json"),
    );
    expect(manifest).toHaveProperty("name");
    expect(typeof manifest.name).toBe("string");
    expect(manifest).toHaveProperty("version");
    expect(typeof manifest.version).toBe("string");
    expect(manifest).toHaveProperty("description");
    expect(typeof manifest.description).toBe("string");
  });

  test("hooks/massa-th0th-hook symlink resolves to the claude-plugin binary", async () => {
    const linkPath = path.join(PLUGIN_ROOT, "hooks/massa-th0th-hook");
    const stat = await fs.lstat(linkPath);
    expect(stat.isSymbolicLink()).toBe(true);
    const target = await fs.readlink(linkPath);
    // Resolved target should point at the claude-plugin binary
    const resolved = path.resolve(path.dirname(linkPath), target);
    expect(resolved).toBe(CLAUDE_PLUGIN_BIN);
    // And the target must be readable
    await fs.access(CLAUDE_PLUGIN_BIN);
  });

  test("directory layout matches vscode.cursor.plugins.registerPath auto-discovery", async () => {
    // Cursor auto-discovers: skills/, hooks/hooks.json, mcp.json, agents/
    const required = [
      "skills",
      "skills/map/SKILL.md",
      "skills/index/SKILL.md",
      "skills/find/SKILL.md",
      "skills/def/SKILL.md",
      "skills/graph/SKILL.md",
      "skills/status/SKILL.md",
      "hooks/hooks.json",
      "mcp.json",
      "agents/massa-th0th-navigator.md",
    ];
    for (const rel of required) {
      const p = path.join(PLUGIN_ROOT, rel);
      await fs.access(p); // throws if missing
    }
  });
});