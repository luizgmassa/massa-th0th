import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { promises as fs } from "fs";
import path from "path";
import os from "os";

import {
  runInstall,
  WRITERS,
  ALL_AGENTS,
  assertHomeWriteConsent,
  ConsentError,
  MASSA_TH0TH_OWNED_KEY,
  type AgentName,
  type McpEntry,
} from "../install-agents";

const ENTRY: McpEntry = {
  type: "local",
  command: ["npx", "@massa-th0th/mcp-client"],
  env: { MASSA_TH0TH_API_URL: "http://localhost:3333" },
  enabled: true,
};

let tmp: string;

beforeEach(async () => {
  tmp = await fs.mkdtemp(path.join(os.tmpdir(), "mt-installer-"));
});
afterEach(async () => {
  await fs.rm(tmp, { recursive: true, force: true });
});

const jsonWriters: AgentName[] = ["claude-code", "cursor", "opencode"];
const desktop = process.platform === "darwin" ? (["claude-desktop"] as AgentName[]) : [];

// ── JSON writers: plan / apply / idempotent / uninstall ────────────────────
for (const agent of [...jsonWriters, ...desktop]) {
  describe(`${agent} writer`, () => {
    test("plan on empty config → add change", async () => {
      const root = tmp;
      const plan = await WRITERS[agent].plan(root, ENTRY);
      expect(plan.changes).toHaveLength(1);
      expect(plan.changes[0].kind).toBe("add");
      expect(plan.exists).toBe(false);
    });

    test("apply creates file + backup, writes massa-th0th under mcpServers", async () => {
      const root = tmp;
      const plan = await WRITERS[agent].plan(root, ENTRY);
      const res = await WRITERS[agent].apply(plan, ENTRY, { dryRun: false });
      expect(res.written).toBe(true);
      expect(res.backupPath).toBeTruthy();
      const cfg = JSON.parse(await fs.readFile(plan.configPath, "utf8"));
      expect(cfg.mcpServers[MASSA_TH0TH_OWNED_KEY].command).toEqual(["npx", "@massa-th0th/mcp-client"]);
      // backup exists
      expect(await fileExists(res.backupPath!)).toBe(true);
    });

    test("user keys preserved + massa-th0th added on existing config", async () => {
      const root = tmp;
      const cp = WRITERS[agent].configPath(root)!;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      const existing = {
        mcpServers: { "user-tool": { command: ["echo"] } },
        someUserKey: { nested: [1, 2, 3] },
      };
      await fs.writeFile(cp, JSON.stringify(existing, null, 2));
      const plan = await WRITERS[agent].plan(root, ENTRY);
      const res = await WRITERS[agent].apply(plan, ENTRY, { dryRun: false });
      expect(res.written).toBe(true);
      const cfg = JSON.parse(await fs.readFile(cp, "utf8"));
      expect(cfg.mcpServers["user-tool"]).toEqual({ command: ["echo"] });
      expect(cfg.someUserKey).toEqual({ nested: [1, 2, 3] });
      expect(cfg.mcpServers[MASSA_TH0TH_OWNED_KEY].command).toEqual(ENTRY.command);
    });

    test("idempotent: re-run produces no change", async () => {
      const root = tmp;
      const p1 = await WRITERS[agent].plan(root, ENTRY);
      await WRITERS[agent].apply(p1, ENTRY, { dryRun: false });
      const p2 = await WRITERS[agent].plan(root, ENTRY);
      expect(p2.changes).toHaveLength(0);
      const res2 = await WRITERS[agent].apply(p2, ENTRY, { dryRun: false });
      expect(res2.written).toBe(false);
      expect(res2.backupPath).toBeNull();
    });

    test("uninstall removes massa-th0th keys, preserves user keys", async () => {
      const root = tmp;
      const cp = WRITERS[agent].configPath(root)!;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      await fs.writeFile(
        cp,
        JSON.stringify({
          mcpServers: {
            "user-tool": { command: ["echo"] },
            [MASSA_TH0TH_OWNED_KEY]: { command: ENTRY.command },
          },
          keepMe: true,
        }),
      );
      const res = await WRITERS[agent].uninstall(root);
      expect(res.written).toBe(true);
      const cfg = JSON.parse(await fs.readFile(cp, "utf8"));
      expect(cfg.mcpServers[MASSA_TH0TH_OWNED_KEY]).toBeUndefined();
      expect(cfg.mcpServers["user-tool"]).toEqual({ command: ["echo"] });
      expect(cfg.keepMe).toBe(true);
      // mcpServers remains because user-tool is still there
      expect(cfg.mcpServers).toBeDefined();
    });

    test("uninstall drops empty mcpServers object", async () => {
      const root = tmp;
      const cp = WRITERS[agent].configPath(root)!;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      await fs.writeFile(
        cp,
        JSON.stringify({ mcpServers: { [MASSA_TH0TH_OWNED_KEY]: { command: ENTRY.command } } }),
      );
      await WRITERS[agent].uninstall(root);
      const cfg = JSON.parse(await fs.readFile(cp, "utf8"));
      expect(cfg.mcpServers).toBeUndefined();
    });

    test("uninstall is a no-op when massa-th0th absent", async () => {
      const root = tmp;
      const cp = WRITERS[agent].configPath(root)!;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      await fs.writeFile(cp, JSON.stringify({ mcpServers: { "user-tool": { command: ["echo"] } } }));
      const res = await WRITERS[agent].uninstall(root);
      expect(res.written).toBe(false);
      expect(res.changes).toHaveLength(0);
    });

    test("invalid JSON throws, no write", async () => {
      const root = tmp;
      const cp = WRITERS[agent].configPath(root)!;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      await fs.writeFile(cp, "{ not json");
      await expect(WRITERS[agent].plan(root, ENTRY)).rejects.toThrow(/not valid JSON/);
      // file untouched
      expect((await fs.readFile(cp, "utf8")).trim()).toBe("{ not json");
    });
  });
}

// ── Codex TOML writer ──────────────────────────────────────────────────────
describe("codex writer", () => {
  test("plan on empty → add [mcp_servers.massa-th0th] table", async () => {
    const plan = await WRITERS.codex.plan(tmp, ENTRY);
    expect(plan.changes).toHaveLength(1);
    expect(plan.changes[0].kind).toBe("add");
  });

  test("apply writes TOML with command/args/env + preserves user tables", async () => {
    const cp = WRITERS.codex.configPath(tmp)!;
    await fs.mkdir(path.dirname(cp), { recursive: true });
    await fs.writeFile(
      cp,
      [
        'model = "gpt-5"',
        "",
        "[mcp_servers.user-tool]",
        'command = "echo"',
        "",
        "[user_settings]",
        "theme = \"dark\"",
        "",
      ].join("\n"),
    );
    const plan = await WRITERS.codex.plan(tmp, ENTRY);
    const res = await WRITERS.codex.apply(plan, ENTRY, { dryRun: false });
    expect(res.written).toBe(true);
    expect(res.backupPath).toBeTruthy();
    const out = await fs.readFile(cp, "utf8");
    expect(out).toContain('model = "gpt-5"');
    expect(out).toContain("[mcp_servers.user-tool]");
    expect(out).toContain('command = "echo"');
    expect(out).toContain("[user_settings]");
    expect(out).toContain("[mcp_servers.massa-th0th]");
    expect(out).toContain('command = "npx"');
    expect(out).toContain('"@massa-th0th/mcp-client"');
    expect(out).toContain("MASSA_TH0TH_API_URL");
  });

  test("idempotent: re-run produces no change", async () => {
    const root = tmp;
    const p1 = await WRITERS.codex.plan(root, ENTRY);
    await WRITERS.codex.apply(p1, ENTRY, { dryRun: false });
    const p2 = await WRITERS.codex.plan(root, ENTRY);
    expect(p2.changes).toHaveLength(0);
  });

  test("uninstall removes massa-th0th table, preserves others", async () => {
    const cp = WRITERS.codex.configPath(tmp)!;
    await fs.mkdir(path.dirname(cp), { recursive: true });
    await fs.writeFile(
      cp,
      [
        "[mcp_servers.user-tool]",
        'command = "echo"',
        "",
        "[mcp_servers.massa-th0th]",
        'command = "npx"',
        'args = ["@massa-th0th/mcp-client"]',
        "",
      ].join("\n"),
    );
    const res = await WRITERS.codex.uninstall(tmp);
    expect(res.written).toBe(true);
    const out = await fs.readFile(cp, "utf8");
    expect(out).not.toContain("[mcp_servers.massa-th0th]");
    expect(out).toContain("[mcp_servers.user-tool]");
  });
});

// ── Flag / orchestration tests ─────────────────────────────────────────────
describe("runInstall orchestration", () => {
  test("--dry-run writes nothing, shows diff", async () => {
    const before = await listTree(tmp);
    const { results, plans } = await runInstall({ target: tmp, dryRun: true, mcpEntry: ENTRY });
    const after = await listTree(tmp);
    expect(after).toEqual(before); // zero writes
    expect(results.every((r) => !r.written && !r.backupPath)).toBe(true);
    expect(plans.filter((p) => p.changes.length > 0).length).toBeGreaterThan(0);
  });

  test("--agent limits to one writer", async () => {
    const { results } = await runInstall({ target: tmp, agent: "cursor", dryRun: true, mcpEntry: ENTRY });
    expect(results.map((r) => r.agent)).toEqual(["cursor"]);
  });

  test("full install writes all agents (skips claude-desktop off-mac)", async () => {
    const { results } = await runInstall({ target: tmp, mcpEntry: ENTRY });
    const written = results.filter((r) => r.written).map((r) => r.agent);
    const expected = process.platform === "darwin" ? ALL_AGENTS : (ALL_AGENTS.filter((a) => a !== "claude-desktop"));
    expect(written.sort()).toEqual(expected.sort());
  });

  test("second run is a full no-op", async () => {
    await runInstall({ target: tmp, mcpEntry: ENTRY });
    const { results } = await runInstall({ target: tmp, mcpEntry: ENTRY });
    expect(results.every((r) => !r.written)).toBe(true);
  });

  test("--uninstall across all agents preserves user keys", async () => {
    // Seed every agent with a user key + massa-th0th key.
    for (const a of ALL_AGENTS) {
      const cp = WRITERS[a].configPath(tmp)!;
      if (!cp) continue;
      await fs.mkdir(path.dirname(cp), { recursive: true });
      if (a === "codex") {
        await fs.writeFile(
          cp,
          [
            '[mcp_servers.user-tool]',
            'command = "echo"',
            "",
            "[mcp_servers.massa-th0th]",
            'command = "npx"',
            "",
          ].join("\n"),
        );
      } else {
        await fs.writeFile(
          cp,
          JSON.stringify({
            mcpServers: {
              "user-tool": { command: ["echo"] },
              [MASSA_TH0TH_OWNED_KEY]: { command: ENTRY.command },
            },
          }),
        );
      }
    }
    const { results } = await runInstall({ target: tmp, uninstall: true });
    expect(results.filter((r) => r.written).length).toBeGreaterThan(0);
    for (const a of ALL_AGENTS) {
      const cp = WRITERS[a].configPath(tmp)!;
      if (!cp) continue;
      const raw = await fs.readFile(cp, "utf8");
      expect(raw).not.toContain("massa-th0th");
      expect(raw).toContain("user-tool");
    }
  });
});

// ── Home-write consent gate ────────────────────────────────────────────────
describe("home-write consent gate", () => {
  test("refuses real home without --yes / target / dryRun", () => {
    // Simulate "no flags" against real home by overriding os.homedir via target.
    const realHome = os.homedir();
    expect(() => assertHomeWriteConsent({ target: realHome })).toThrow(ConsentError);
  });

  test("consents with --yes against real home", () => {
    const realHome = os.homedir();
    expect(() => assertHomeWriteConsent({ target: realHome, yes: true })).not.toThrow();
  });

  test("consents with --dry-run against real home (writes nothing)", () => {
    const realHome = os.homedir();
    expect(() => assertHomeWriteConsent({ target: realHome, dryRun: true })).not.toThrow();
  });

  test("tmpdir is always allowed", () => {
    expect(() => assertHomeWriteConsent({ target: tmp })).not.toThrow();
  });

  test("runInstall surfaces consent error (exit 13 path)", async () => {
    const realHome = os.homedir();
    await expect(runInstall({ target: realHome, mcpEntry: ENTRY })).rejects.toThrow(ConsentError);
  });
});

// ── Deconfliction hint (T12) ───────────────────────────────────────────────
// When install-agents writes the Codex/Cursor MCP entry, it prints a hint
// reminding the user that the massa-th0th plugin bundle already registers
// MCP, so the install-agents step can be skipped for that agent.
describe("plugin deconfliction hint", () => {
  test("codex apply prints plugin/skip hint when written", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await runInstall({ target: tmp, agent: "codex", mcpEntry: ENTRY });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("plugin") && l.includes("skip"))).toBe(true);
    expect(logs.some((l) => l.toLowerCase().includes("codex"))).toBe(true);
  });

  test("cursor apply prints plugin/skip hint when written", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await runInstall({ target: tmp, agent: "cursor", mcpEntry: ENTRY });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("plugin") && l.includes("skip"))).toBe(true);
    expect(logs.some((l) => l.toLowerCase().includes("cursor"))).toBe(true);
  });

  test("codex dry-run does NOT print the hint (nothing written)", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await runInstall({ target: tmp, agent: "codex", dryRun: true, mcpEntry: ENTRY });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("skip this install-agents"))).toBe(false);
  });

  test("cursor dry-run does NOT print the hint (nothing written)", async () => {
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => { logs.push(args.join(" ")); };
    try {
      await runInstall({ target: tmp, agent: "cursor", dryRun: true, mcpEntry: ENTRY });
    } finally {
      console.log = originalLog;
    }
    expect(logs.some((l) => l.includes("skip this install-agents"))).toBe(false);
  });
});

// ── helpers ────────────────────────────────────────────────────────────────
async function fileExists(p: string): Promise<boolean> {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

async function listTree(dir: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(d: string, base = d) {
    const entries = await fs.readdir(d, { withFileTypes: true });
    for (const e of entries) {
      const full = path.join(d, e.name);
      out.push(path.relative(base, full));
      if (e.isDirectory()) await walk(full, base);
    }
  }
  await walk(dir);
  return out.sort();
}
