/**
 * Codex plugin manifest + structure tests (Phase 1, T5).
 *
 * Verifies the static plugin bundle shape against the spec acceptance
 * criteria (CPX-01, CPX-03, CPX-04, CPX-05):
 * - .codex-plugin/plugin.json has name, version, description, skills, mcp, hooks
 * - 6 skills/*.md files exist (map, index, find, def, graph, status)
 * - hooks/hooks.json has exactly 6 event keys, each with an owned entry
 * - .mcp.json declares the massa-th0th MCP server (npx @massa-th0th/mcp-client)
 * - hooks/massa-th0th-hook symlink resolves to the claude-plugin binary
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

describe("codex-plugin manifest (T5 / CPX-01,03,04,05)", () => {
  test(".codex-plugin/plugin.json has name, version, description, skills, mcp, hooks", async () => {
    const manifest = await readJson(
      path.join(PLUGIN_ROOT, ".codex-plugin/plugin.json"),
    );
    expect(manifest).toHaveProperty("name");
    expect(typeof manifest.name).toBe("string");
    expect(manifest).toHaveProperty("version");
    expect(typeof manifest.version).toBe("string");
    expect(manifest).toHaveProperty("description");
    expect(typeof manifest.description).toBe("string");
    expect(manifest).toHaveProperty("skills");
    expect(manifest).toHaveProperty("mcp");
    expect(manifest).toHaveProperty("hooks");
  });

  test("6 skills/*.md files exist (map, index, find, def, graph, status)", async () => {
    const expected = ["map", "index", "find", "def", "graph", "status"];
    for (const name of expected) {
      const p = path.join(PLUGIN_ROOT, `skills/${name}.md`);
      const stat = await fs.stat(p);
      expect(stat.isFile()).toBe(true);
      const content = await fs.readFile(p, "utf8");
      // Adapted frontmatter keeps description + allowed-tools
      expect(content).toContain("description:");
      expect(content).toContain("allowed-tools:");
    }
  });

  test("hooks/hooks.json contains exactly 6 event keys, each with an owned entry", async () => {
    const hooks = await readJson(path.join(PLUGIN_ROOT, "hooks/hooks.json"));
    const expectedEvents = [
      "SessionStart",
      "UserPromptSubmit",
      "PreToolUse",
      "PostToolUse",
      "PreCompact",
      "Stop",
    ];
    expect(Object.keys(hooks).sort()).toEqual(expectedEvents.sort());
    for (const evt of expectedEvents) {
      const arr = hooks[evt] as unknown[];
      expect(Array.isArray(arr)).toBe(true);
      expect(arr.length).toBeGreaterThanOrEqual(1);
      const owned = arr.find(
        (e) =>
          (e as Record<string, unknown>)._massaTh0thOwned === true,
      );
      expect(owned).toBeDefined();
      // Each owned entry points at the binary with a subcommand
      const cmd = (owned as Record<string, unknown>).command as string;
      expect(cmd).toContain("massa-th0th-hook");
    }
  });

  test(".mcp.json declares massa-th0th MCP server with npx @massa-th0th/mcp-client", async () => {
    const mcp = await readJson(path.join(PLUGIN_ROOT, ".mcp.json"));
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
});