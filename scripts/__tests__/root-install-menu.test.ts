import { describe, test, expect } from "bun:test";
import { promises as fs } from "fs";
import path from "path";

// Static/grep-style tests: the root install.sh is interactive, so we verify
// its source content offers the Codex/Cursor plugin choice and invokes the
// per-plugin installers with the selected scope. (T12)
const ROOT_INSTALL = path.resolve(process.cwd(), "install.sh");

describe("root install.sh menu — Codex/Cursor plugin choice", () => {
  test("install.sh exists at repo root", async () => {
    expect(await fs.access(ROOT_INSTALL).then(() => true).catch(() => false)).toBe(true);
  });

  test("menu offers the 'p' Codex/Cursor plugins option", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("p)${NC} Install Codex/Cursor plugins");
  });

  test("case statement routes p|P to install_plugins_menu", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toMatch(/p\|P\)\s*\n\s*install_plugins_menu/);
  });

  test("install_plugins_menu references codex-plugin/install.sh", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("apps/codex-plugin/install.sh");
  });

  test("install_plugins_menu references cursor-plugin/install.sh", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("apps/cursor-plugin/install.sh");
  });

  test("sub-menu offers Codex, Cursor, and Both options", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("Codex plugin");
    expect(src).toContain("Cursor plugin");
    expect(src).toContain("Both Codex and Cursor plugins");
  });

  test("per-plugin installers invoked with --user by default", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    // The menu passes --user since root install.sh doesn't track project scope.
    expect(src).toMatch(/bash "\$\{?codex_installer\}?" --user/);
    expect(src).toMatch(/bash "\$\{?cursor_installer\}?" --user/);
  });

  test("unknown-choice prompt updated to include 'p'", async () => {
    const src = await fs.readFile(ROOT_INSTALL, "utf8");
    expect(src).toContain("Enter w, v, t, c, p, or s.");
  });
});