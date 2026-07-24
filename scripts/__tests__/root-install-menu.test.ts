import { describe, test, expect } from "bun:test";
import { promises as fs } from "fs";
import path from "path";

// Static/grep-style tests: the root install.sh is interactive, so we verify
// its source content offers the four-plugin choice and invokes the
// per-plugin installers with the selected scope. (T12 + T17 four-plugin parity)
const ROOT_INSTALL = path.resolve(process.cwd(), "install.sh");

describe("root install.sh menu — four-plugin parity (T17)", () => {
  test("install.sh exists at repo root", async () => {
    expect(await fs.access(ROOT_INSTALL).then(() => true).catch(() => false)).toBe(true);
  });

  test("menu offers the 'p' plugins option", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("p)${NC} Install massa-ai plugins");
  });

  test("case statement routes p|P to install_plugins_menu", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toMatch(/p\|P\)\s*\n\s*install_plugins_menu/);
  });

  test("install_plugins_menu references claude-plugin/install.sh", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("apps/claude-plugin/install.sh");
  });

  test("install_plugins_menu references codex-plugin/install.sh", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("apps/codex-plugin/install.sh");
  });

  test("install_plugins_menu references cursor-plugin/install.sh", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("apps/cursor-plugin/install.sh");
  });

  test("sub-menu offers all four plugin names + an 'all four' option", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("Claude Code plugin");
    expect(src).toContain("Codex plugin");
    expect(src).toContain("Cursor plugin");
    expect(src).toContain("OpenCode plugin");
    expect(src).toContain("All four");
  });

  test("per-plugin installers invoked with --user by default", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    // The menu passes --user since root install.sh doesn't track project scope.
    expect(src).toMatch(/bash "\$\{?claude_installer\}?" --user/);
    expect(src).toMatch(/bash "\$\{?codex_installer\}?" --user/);
    expect(src).toMatch(/bash "\$\{?cursor_installer\}?" --user/);
  });

  test("OpenCode option prints npm install + config instructions", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("npm install @massa-ai/opencode-plugin");
    expect(src).toContain("@massa-ai/opencode-plugin");
    expect(src).toContain("opencode.json");
    expect(src).toContain("MASSA_AI_API_URL");
  });

  test("unknown-choice prompt updated to include 'p'", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("Enter w, v, t, c, p, or s.");
  });
});