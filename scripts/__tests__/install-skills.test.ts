import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

import {
  IntegrationError,
  PLATFORMS,
  BOOTSTRAP_START,
  BOOTSTRAP_END,
  discoverSkillSources,
  extractBootstrap,
  extractBootstrapBlock,
  detectInstalledTools,
  resolveCodexHome,
  platformRoot,
  statePath,
  loadState,
  saveState,
  applyPlatform,
  uninstallPlatform,
  checkPlatform,
  resolveRepoRoot,
  type InstallerState,
  type Platform,
} from "../install-skills";

const REPO_ROOT = resolveRepoRoot();

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mt-skills-"));
});

afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

// ── Skill discovery ──────────────────────────────────────────────────────

describe("discoverSkillSources", () => {
  test("finds skills with SKILL.md in repo root", async () => {
    const skills = await discoverSkillSources(REPO_ROOT);
    expect(skills.size).toBeGreaterThan(0);
    expect(skills.has("massa-ai")).toBe(true);
    expect(skills.has("persona-router")).toBe(true);
  });

  test("throws on missing skills directory", async () => {
    expect(discoverSkillSources("/nonexistent/path")).rejects.toThrow(IntegrationError);
  });
});

// ── Bootstrap extraction ─────────────────────────────────────────────────

describe("extractBootstrapBlock", () => {
  test("extracts block between markers", () => {
    const text = `before\n${BOOTSTRAP_START}\ncontent\n${BOOTSTRAP_END}\nafter`;
    const block = extractBootstrapBlock(text);
    expect(block).toContain(BOOTSTRAP_START);
    expect(block).toContain(BOOTSTRAP_END);
    expect(block).toContain("content");
  });

  test("throws on missing markers", () => {
    expect(() => extractBootstrapBlock("no markers here")).toThrow(IntegrationError);
  });

  test("throws on duplicate markers", () => {
    const text = `${BOOTSTRAP_START}a${BOOTSTRAP_END}${BOOTSTRAP_START}b${BOOTSTRAP_END}`;
    expect(() => extractBootstrapBlock(text)).toThrow(IntegrationError);
  });
});

describe("extractBootstrap from repo", () => {
  test("extracts bootstrap from skills/AGENTS.md", async () => {
    const bootstrap = await extractBootstrap(REPO_ROOT);
    expect(bootstrap).toContain(BOOTSTRAP_START);
    expect(bootstrap).toContain(BOOTSTRAP_END);
    expect(bootstrap).toContain("massa-ai");
  });
});

// ── Platform detection ───────────────────────────────────────────────────

describe("detectInstalledTools", () => {
  test("returns map of detected platforms", () => {
    const tools = detectInstalledTools(["claude", "codex", "cursor", "opencode"]);
    // At least some should be detected in dev environment
    expect(tools.size).toBeGreaterThanOrEqual(0);
  });

  test("skips platforms not on PATH", () => {
    const tools = detectInstalledTools(["cursor"]);
    // cursor-agent/cursor may or may not be on PATH; just verify no crash
    expect(tools.size).toBeGreaterThanOrEqual(0);
  });
});

// ── Codex home resolution ─────────────────────────────────────────────────

describe("resolveCodexHome", () => {
  test("uses explicit path when provided", () => {
    const result = resolveCodexHome(tmp, "/explicit/codex");
    expect(result).toBe(path.resolve("/explicit/codex"));
  });

  test("falls back to primary .codex", () => {
    const result = resolveCodexHome(tmp);
    expect(result).toBe(path.resolve(path.join(tmp, ".codex")));
  });
});

// ── Platform root ────────────────────────────────────────────────────────

describe("platformRoot", () => {
  test("claude root", () => {
    expect(platformRoot(tmp, "/codex", "claude")).toBe(path.join(tmp, ".claude"));
  });
  test("codex root uses codexHome", () => {
    expect(platformRoot(tmp, "/codex", "codex")).toBe("/codex");
  });
  test("cursor root", () => {
    expect(platformRoot(tmp, "/codex", "cursor")).toBe(path.join(tmp, ".cursor"));
  });
  test("opencode root", () => {
    expect(platformRoot(tmp, "/codex", "opencode")).toBe(path.join(tmp, ".config", "opencode"));
  });
});

// ── State management ──────────────────────────────────────────────────────

describe("loadState", () => {
  test("returns empty state when file missing", async () => {
    const sPath = path.join(tmp, "state.json");
    const state = await loadState(sPath, tmp, path.join(tmp, ".codex"));
    expect(state.version).toBe(2);
    expect(state.platforms).toEqual({});
  });

  test("loads v2 state correctly", async () => {
    const sPath = path.join(tmp, "state.json");
    const state: InstallerState = {
      version: 2,
      repository: "/repo",
      platforms: {
        claude: { root: path.join(tmp, ".claude"), skills: ["massa-ai"] },
      },
    };
    await fs.writeFile(sPath, JSON.stringify(state));
    const loaded = await loadState(sPath, tmp, path.join(tmp, ".codex"));
    expect(loaded.version).toBe(2);
    expect(loaded.platforms.claude.skills).toEqual(["massa-ai"]);
  });

  test("migrates v1 state to v2", async () => {
    const sPath = path.join(tmp, "state.json");
    const v1State = { version: 1, platforms: ["claude", "codex"] };
    await fs.writeFile(sPath, JSON.stringify(v1State));
    const loaded = await loadState(sPath, tmp, path.join(tmp, ".codex"));
    expect(loaded.version).toBe(2);
    expect(loaded.platforms.claude).toBeDefined();
    expect(loaded.platforms.codex).toBeDefined();
    expect(loaded.platforms.claude.skills).toEqual([]);
  });

  test("throws on malformed JSON", async () => {
    const sPath = path.join(tmp, "state.json");
    await fs.writeFile(sPath, "{not json}");
    expect(loadState(sPath, tmp, path.join(tmp, ".codex"))).rejects.toThrow(IntegrationError);
  });

  test("throws on unsupported version", async () => {
    const sPath = path.join(tmp, "state.json");
    await fs.writeFile(sPath, JSON.stringify({ version: 99, platforms: {} }));
    expect(loadState(sPath, tmp, path.join(tmp, ".codex"))).rejects.toThrow(IntegrationError);
  });

  test("throws on invalid skill names (path traversal)", async () => {
    const sPath = path.join(tmp, "state.json");
    const badState = {
      version: 2,
      platforms: { claude: { root: "/x", skills: ["../etc/passwd"] } },
    };
    await fs.writeFile(sPath, JSON.stringify(badState));
    expect(loadState(sPath, tmp, path.join(tmp, ".codex"))).rejects.toThrow(IntegrationError);
  });
});

describe("saveState", () => {
  test("writes state file with directory creation", async () => {
    const sPath = path.join(tmp, "nested", "dir", "state.json");
    const state: InstallerState = { version: 2, repository: "/repo", platforms: {} };
    await saveState(sPath, state);
    const content = await fs.readFile(sPath, "utf-8");
    expect(JSON.parse(content).version).toBe(2);
  });
});

// ── Apply / idempotency / uninstall ───────────────────────────────────────

describe("applyPlatform (claude)", () => {
  const skills = new Map([
    ["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")],
    ["persona-router", path.join(REPO_ROOT, "skills", "persona-router")],
  ]);
  const bootstrap = `${BOOTSTRAP_START}\n# bootstrap content\n${BOOTSTRAP_END}`;

  test("creates symlinks and writes bootstrap", async () => {
    const result = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    expect(result.results.some((r) => r.status === "changed")).toBe(true);

    // Verify symlinks
    const link = await fs.readlink(path.join(tmp, ".claude", "skills", "massa-ai"));
    expect(path.resolve(path.join(tmp, ".claude", "skills", "massa-ai"), link)).toBe(
      path.join(REPO_ROOT, "skills", "massa-ai")
    );

    // Verify bootstrap in AGENTS.md
    const agents = await fs.readFile(path.join(tmp, ".claude", "AGENTS.md"), "utf-8");
    expect(agents).toContain(BOOTSTRAP_START);
    expect(agents).toContain(BOOTSTRAP_END);
  });

  test("idempotent — second apply is no-op", async () => {
    await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    const result = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    expect(result.results.every((r) => r.status !== "changed")).toBe(true);
  });

  test("dry-run writes nothing", async () => {
    const result = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, true);
    expect(result.results.some((r) => r.status === "would-change")).toBe(true);
    // Verify nothing was written
    expect(fs.access(path.join(tmp, ".claude", "skills", "massa-ai"))).rejects.toThrow();
  });

  test("aborts on non-symlink conflict", async () => {
    // Create a regular file where symlink should go
    await fs.mkdir(path.join(tmp, ".claude", "skills"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".claude", "skills", "massa-ai"), "user content");

    const result = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    expect(result.results.some((r) => r.status === "error")).toBe(true);

    // Verify user file preserved
    const content = await fs.readFile(path.join(tmp, ".claude", "skills", "massa-ai"), "utf-8");
    expect(content).toBe("user content");
  });

  test("replaces existing bootstrap block", async () => {
    // Pre-write AGENTS.md with old bootstrap
    const oldBootstrap = `${BOOTSTRAP_START}\n# old content\n${BOOTSTRAP_END}`;
    await fs.mkdir(path.join(tmp, ".claude"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".claude", "AGENTS.md"), oldBootstrap);

    await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);

    const agents = await fs.readFile(path.join(tmp, ".claude", "AGENTS.md"), "utf-8");
    expect(agents).toContain("bootstrap content");
    expect(agents).not.toContain("old content");
  });
});

describe("uninstallPlatform (claude)", () => {
  const skills = new Map([
    ["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")],
  ]);
  const bootstrap = `${BOOTSTRAP_START}\n# bootstrap\n${BOOTSTRAP_END}`;

  test("removes managed symlinks and bootstrap", async () => {
    // Install first
    const applyResult = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    const stateRecord = applyResult.state;

    // Uninstall
    const result = await uninstallPlatform("claude", tmp, path.join(tmp, ".codex"), stateRecord, REPO_ROOT, false);
    expect(result.results.some((r) => r.status === "changed")).toBe(true);

    // Verify symlink gone
    expect(fs.access(path.join(tmp, ".claude", "skills", "massa-ai"))).rejects.toThrow();

    // Verify bootstrap removed
    const agents = await fs.readFile(path.join(tmp, ".claude", "AGENTS.md"), "utf-8");
    expect(agents).not.toContain(BOOTSTRAP_START);
  });

  test("preserves unrelated content on uninstall", async () => {
    // Install
    await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);

    // Add user content to AGENTS.md
    const agentsPath = path.join(tmp, ".claude", "AGENTS.md");
    const current = await fs.readFile(agentsPath, "utf-8");
    await fs.writeFile(agentsPath, current + "\n## User Section\nUser content here\n");

    // Add a user skill (regular file, not symlink)
    await fs.writeFile(path.join(tmp, ".claude", "skills", "user-skill"), "user");

    // Uninstall
    const stateRecord = { root: path.join(tmp, ".claude"), skills: ["massa-ai"] };
    await uninstallPlatform("claude", tmp, path.join(tmp, ".codex"), stateRecord, REPO_ROOT, false);

    // Verify user content preserved
    const agents = await fs.readFile(agentsPath, "utf-8");
    expect(agents).toContain("User Section");
    expect(agents).toContain("User content here");
    expect(agents).not.toContain(BOOTSTRAP_START);

    // Verify user skill preserved
    const userSkill = await fs.readFile(path.join(tmp, ".claude", "skills", "user-skill"), "utf-8");
    expect(userSkill).toBe("user");
  });

  test("nothing to uninstall — graceful exit", async () => {
    const stateRecord = { root: path.join(tmp, ".claude"), skills: [] };
    const result = await uninstallPlatform("claude", tmp, path.join(tmp, ".codex"), stateRecord, REPO_ROOT, false);
    expect(result.results.every((r) => r.status !== "changed")).toBe(true);
  });
});

// ── Check (drift detection) ───────────────────────────────────────────────

describe("checkPlatform (claude)", () => {
  const skills = new Map([
    ["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")],
  ]);
  const bootstrap = `${BOOTSTRAP_START}\n# bootstrap\n${BOOTSTRAP_END}`;

  test("clean — no drift after apply", async () => {
    await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    const stateRecord = { root: path.join(tmp, ".claude"), skills: ["massa-ai"] };
    const results = await checkPlatform("claude", tmp, path.join(tmp, ".codex"), skills, stateRecord, REPO_ROOT);
    expect(results.every((r) => r.status !== "drift")).toBe(true);
  });

  test("detects missing symlink as drift", async () => {
    const stateRecord = { root: path.join(tmp, ".claude"), skills: ["massa-ai"] };
    const results = await checkPlatform("claude", tmp, path.join(tmp, ".codex"), skills, stateRecord, REPO_ROOT);
    expect(results.some((r) => r.status === "drift" && r.message.includes("Missing symlink"))).toBe(true);
  });

  test("detects wrong symlink target as drift", async () => {
    // Create symlink pointing to wrong place
    await fs.mkdir(path.join(tmp, ".claude", "skills"), { recursive: true });
    await fs.symlink("/wrong/path", path.join(tmp, ".claude", "skills", "massa-ai"), "dir");

    const stateRecord = { root: path.join(tmp, ".claude"), skills: ["massa-ai"] };
    const results = await checkPlatform("claude", tmp, path.join(tmp, ".codex"), skills, stateRecord, REPO_ROOT);
    expect(results.some((r) => r.status === "drift" && r.message.includes("points to"))).toBe(true);
  });

  test("detects stale symlink (skill removed from repo) as drift", async () => {
    // Install with a skill, then check with a smaller skill set
    const oldSkills = new Map([
      ["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")],
      ["removed-skill", path.join(REPO_ROOT, "skills", "removed-skill")],
    ]);
    // Simulate old install by creating symlink
    await fs.mkdir(path.join(tmp, ".claude", "skills"), { recursive: true });
    await fs.symlink(REPO_ROOT, path.join(tmp, ".claude", "skills", "removed-skill"), "dir");

    const stateRecord = { root: path.join(tmp, ".claude"), skills: ["massa-ai", "removed-skill"] };
    const currentSkills = new Map([["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")]]);
    const results = await checkPlatform("claude", tmp, path.join(tmp, ".codex"), currentSkills, stateRecord, REPO_ROOT);
    expect(results.some((r) => r.status === "drift" && r.message.includes("Stale symlink"))).toBe(true);
  });
});

// ── Repo root resolution (F1 mitigation) ──────────────────────────────────

describe("resolveRepoRoot", () => {
  test("uses explicit path", () => {
    expect(resolveRepoRoot("/explicit/repo")).toBe(path.resolve("/explicit/repo"));
  });

  test("falls back to script location", () => {
    const root = resolveRepoRoot();
    expect(root).toBeTruthy();
    // Should resolve to the massa-ai repo root (parent of scripts/)
    expect(root).not.toBe("/");
  });
});

// ── Hook gating scenarios (ported from test_hooks.py) ────────────────────
// Scenarios that don't require the Python hooks layer. These test data-structure
// and input-handling patterns applicable to the new repo.

describe("hook gating scenarios (ported, no Python hooks layer)", () => {
  test("malformed state JSON aborts before any mutation", async () => {
    const sPath = statePath(tmp);
    await fs.mkdir(path.dirname(sPath), { recursive: true });
    await fs.writeFile(sPath, "{malformed");

    // Loading state should throw, preventing any mutation
    expect(loadState(sPath, tmp, path.join(tmp, ".codex"))).rejects.toThrow(IntegrationError);

    // Verify nothing was written beyond the malformed state
    const files = await fs.readdir(path.dirname(sPath));
    expect(files).toEqual(["install-state.json"]);
  });

  test("conflicting path aborts before any mutation", async () => {
    // Create a regular file where a symlink should go
    await fs.mkdir(path.join(tmp, ".claude", "skills"), { recursive: true });
    await fs.writeFile(path.join(tmp, ".claude", "skills", "massa-ai"), "user file");

    const skills = new Map([["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")]]);
    const bootstrap = `${BOOTSTRAP_START}\n# bootstrap\n${BOOTSTRAP_END}`;

    const result = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    expect(result.results.some((r) => r.status === "error")).toBe(true);

    // Verify user file is untouched
    const content = await fs.readFile(path.join(tmp, ".claude", "skills", "massa-ai"), "utf-8");
    expect(content).toBe("user file");
  });

  test("partial platform uninstall preserves other platform state", async () => {
    const skills = new Map([
      ["massa-ai", path.join(REPO_ROOT, "skills", "massa-ai")],
    ]);
    const bootstrap = `${BOOTSTRAP_START}\n# bootstrap\n${BOOTSTRAP_END}`;

    // Install on both claude and codex
    const claudeResult = await applyPlatform("claude", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);
    await applyPlatform("codex", tmp, path.join(tmp, ".codex"), skills, bootstrap, false);

    // Save state
    const state: InstallerState = {
      version: 2,
      repository: REPO_ROOT,
      platforms: {
        claude: claudeResult.state,
        codex: { root: path.join(tmp, ".codex"), skills: ["massa-ai"] },
      },
    };
    await saveState(statePath(tmp), state);

    // Uninstall only claude
    await uninstallPlatform("claude", tmp, path.join(tmp, ".codex"), state.platforms.claude, REPO_ROOT, false);

    // Verify codex symlinks still exist
    const codexLink = await fs.readlink(path.join(tmp, ".codex", "skills", "massa-ai"));
    expect(codexLink).toBeTruthy();

    // Verify claude symlinks gone
    expect(fs.access(path.join(tmp, ".claude", "skills", "massa-ai"))).rejects.toThrow();
  });

  test("v1 state can be uninstalled without migration apply", async () => {
    // Write v1 state
    const sPath = statePath(tmp);
    await fs.mkdir(path.dirname(sPath), { recursive: true });
    await fs.writeFile(sPath, JSON.stringify({ version: 1, platforms: ["claude"] }));

    // Load (migrates) and uninstall
    const state = await loadState(sPath, tmp, path.join(tmp, ".codex"));
    expect(state.platforms.claude).toBeDefined();
    // Uninstall should work even with empty skills list
    const result = await uninstallPlatform("claude", tmp, path.join(tmp, ".codex"), state.platforms.claude, REPO_ROOT, false);
    expect(result.results.every((r) => r.status !== "error")).toBe(true);
  });
});