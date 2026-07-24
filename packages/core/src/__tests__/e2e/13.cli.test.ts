/**
 * T12 — CLI smoke (massa-ai + massa-ai-config).
 *
 * Runs the built CLI binaries (apps/mcp-client/dist/index.js and
 * dist/config-cli.js) against the live environment. Gated on the dist files
 * existing. Read-only commands run against the real user config; mutating
 * commands are isolated through a throwaway XDG_CONFIG_HOME.
 *
 * Fixed product bugs (previously reported via test.skip + printed reason):
 *   - config-loader.ts now honors XDG_CONFIG_HOME (prefers it when set + non-
 *     empty, else falls back to ~/.config). All mutating CLI scenarios now run
 *     against a per-test mkdtempSync temp dir and assert the command reads/
 *     writes under that dir — NOT the real user config.
 *   - `massa-ai <unknown-flag>` now exits 2 (usage error).
 */
import { describe, test, expect, beforeAll } from "bun:test";
import { spawn } from "child_process";
import { promises as fs } from "fs";
import os from "os";
import path from "path";

import { E2E_ENABLED, probeAvailability } from "./_helpers";

const MASSA_BIN = path.resolve(import.meta.dir, "../../../../../apps/mcp-client/dist/index.js");
const CONFIG_CLI = path.resolve(import.meta.dir, "../../../../../apps/mcp-client/dist/config-cli.js");

// ── Gate ────────────────────────────────────────────────────────────────────

const READY = await (async () => {
  if (!E2E_ENABLED) return false;
  const a = await probeAvailability();
  return !!a.MCP_BIN;
})();

// ── Runner ──────────────────────────────────────────────────────────────────

interface RunResult {
  code: number;
  stdout: string;
  stderr: string;
}

function runBin(bin: string, args: string[], env?: Record<string, string>): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("bun", [bin, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, ...(env ?? {}) },
    });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => (stdout += d.toString()));
    child.stderr?.on("data", (d) => (stderr += d.toString()));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

function makeTempXdg(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "massa-ai-cli-"));
}

// dotenvx writes a `◇ injected env (0) from .env // tip: …` banner to stdout
// asynchronously, and it can interleave at any point in the stream (including
// between the opening `{` and the rest of a JSON dump). Strip every line that
// carries the `◇` marker before extracting/parse JSON from CLI output.
function stripBanner(s: string): string {
  return s
    .split("\n")
    .filter((l) => !l.includes("◇"))
    .join("\n");
}

function extractJson(stdout: string): unknown {
  const clean = stripBanner(stdout);
  const start = clean.indexOf("{");
  if (start < 0) throw new Error("no JSON object found in stdout");
  return JSON.parse(clean.slice(start));
}

const REAL_CONFIG_MARKER = `${os.homedir()}/.config/massa-ai`;

// ── Suite ───────────────────────────────────────────────────────────────────

describe.skipIf(!READY)("T12 — CLI smoke", () => {
  // Probe once: confirm the CLI honors XDG_CONFIG_HOME. After the loader fix
  // this is expected to pass; assert it here so a regression fails loudly
  // rather than silently skipping every mutating test.
  beforeAll(async () => {
    const tmp = await makeTempXdg();
    let line = "";
    let probeError: string | null = null;
    try {
      const r = await runBin(MASSA_BIN, ["--config-path"], { XDG_CONFIG_HOME: tmp });
      line = stripBanner(r.stdout)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .pop() ?? "";
    } catch (e) {
      probeError = (e as Error).message;
    } finally {
      await fs.rm(tmp, { recursive: true, force: true });
    }
    // Hard gate: the loader MUST honor XDG_CONFIG_HOME. Failing here is the
    // correct signal — mutating tests below depend on temp-dir isolation.
    const honored = !probeError && !line.startsWith(REAL_CONFIG_MARKER) && line.includes(tmp);
    const reason = probeError
      ? `XDG probe threw: ${probeError}`
      : `config-loader ignores XDG_CONFIG_HOME (resolved "${line}", expected under "${tmp}")`;
    expect(honored).toBe(true);
  });

  // ── massa-ai flags ────────────────────────────────────────────────────

  describe("massa-ai (dist/index.js) flags", () => {
    test("--help exits 0 and prints usage", async () => {
      const r = await runBin(MASSA_BIN, ["--help"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Usage");
      expect(r.stdout).toContain("Options");
      expect(r.stdout.toLowerCase()).toContain("massa-ai");
    });

    test("-h short alias exits 0 and prints usage", async () => {
      const r = await runBin(MASSA_BIN, ["-h"]);
      expect(r.code).toBe(0);
      expect(r.stdout).toContain("Usage");
    });

    test("--config-show prints valid JSON with provider/embedding keys", async () => {
      const r = await runBin(MASSA_BIN, ["--config-show"]);
      expect(r.code).toBe(0);
      const cfg = extractJson(r.stdout) as Record<string, unknown>;
      expect(cfg).toBeTypeOf("object");
      expect(cfg).not.toBeNull();
      expect(cfg.embedding).toBeTypeOf("object");
      expect(typeof (cfg.embedding as { provider: unknown }).provider).toBe("string");
    });

    test("--config-path prints a path ending in config.json", async () => {
      const r = await runBin(MASSA_BIN, ["--config-path"]);
      expect(r.code).toBe(0);
      const lines = stripBanner(r.stdout)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const line = lines.pop() ?? "";
      expect(line.endsWith("config.json")).toBe(true);
    });

    test("--config-dir prints a directory path", async () => {
      const r = await runBin(MASSA_BIN, ["--config-dir"]);
      expect(r.code).toBe(0);
      const lines = stripBanner(r.stdout)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
      const line = lines.pop() ?? "";
      expect(line.length).toBeGreaterThan(0);
      expect(line.endsWith("config.json")).toBe(false);
    });

    test("--config-init writes under XDG_CONFIG_HOME, never the real config", async () => {
      const tmp = await makeTempXdg();
      try {
        const r = await runBin(MASSA_BIN, ["--config-init"], { XDG_CONFIG_HOME: tmp });
        expect(r.code).toBe(0);
        expect(/Initializ|Configuration initialized/i.test(r.stdout)).toBe(true);
        // The config file must land inside the temp XDG dir, not the real one.
        const cfgPath = path.join(tmp, "massa-ai", "config.json");
        const realCfgPath = path.join(REAL_CONFIG_MARKER, "config.json");
        const tmpExists = await fs.stat(cfgPath).then(() => true).catch(() => false);
        expect(tmpExists).toBe(true);
        // Sanity: ensure we did NOT touch the real config path string in output.
        expect(r.stdout).not.toContain(realCfgPath);
        const created = r.stdout.match(/Configuration initialized at:\s*(\S+)/);
        if (created) expect(created[1].startsWith(tmp)).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("--config-init is idempotent (two runs in same temp dir)", async () => {
      const tmp = await makeTempXdg();
      try {
        const r1 = await runBin(MASSA_BIN, ["--config-init"], { XDG_CONFIG_HOME: tmp });
        expect(r1.code).toBe(0);
        const r2 = await runBin(MASSA_BIN, ["--config-init"], { XDG_CONFIG_HOME: tmp });
        expect(r2.code).toBe(0);
        // Idempotency: second run does not error, config still under temp dir.
        const cfgPath = path.join(tmp, "massa-ai", "config.json");
        const exists = await fs.stat(cfgPath).then(() => true).catch(() => false);
        expect(exists).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("unknown flag is rejected (exit 2 + usage on stderr)", async () => {
      const r = await runBin(MASSA_BIN, ["--definitely-not-a-flag"]);
      expect(r.code).toBe(2);
      expect(/Unknown flag|--help|usage/i.test(r.stderr + r.stdout)).toBe(true);
    });
  });

  // ── config-cli ───────────────────────────────────────────────────────────

  describe("massa-ai-config (dist/config-cli.js) commands", () => {
    test("init creates config.json under XDG_CONFIG_HOME", async () => {
      const tmp = await makeTempXdg();
      try {
        const r = await runBin(CONFIG_CLI, ["init"], { XDG_CONFIG_HOME: tmp });
        expect(r.code).toBe(0);
        const files = await fs.readdir(path.join(tmp, "massa-ai")).catch(() => [] as string[]);
        expect(files).toContain("config.json");
        // Isolation: never created a config dir at the real user path.
        expect(r.stdout + r.stderr).not.toContain(REAL_CONFIG_MARKER);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("path prints a config.json path", async () => {
      const tmp = await makeTempXdg();
      try {
        const r = await runBin(CONFIG_CLI, ["path"], { XDG_CONFIG_HOME: tmp });
        expect(r.code).toBe(0);
        const line = stripBanner(r.stdout)
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean)
          .pop() ?? "";
        expect(line.endsWith("config.json")).toBe(true);
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("show prints valid JSON", async () => {
      const tmp = await makeTempXdg();
      try {
        const r = await runBin(CONFIG_CLI, ["show"], { XDG_CONFIG_HOME: tmp });
        expect(r.code).toBe(0);
        expect(() => extractJson(r.stdout)).not.toThrow();
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("set <key> <value> persists (verified via show)", async () => {
      const tmp = await makeTempXdg();
      try {
        const initR = await runBin(CONFIG_CLI, ["init"], { XDG_CONFIG_HOME: tmp });
        expect(initR.code).toBe(0);
        // Safe key: logging.level (string, low blast radius).
        const setR = await runBin(CONFIG_CLI, ["set", "logging.level", "debug"], {
          XDG_CONFIG_HOME: tmp,
        });
        expect(setR.code).toBe(0);
        const showR = await runBin(CONFIG_CLI, ["show"], { XDG_CONFIG_HOME: tmp });
        const cfg = extractJson(showR.stdout) as { logging?: { level?: string } };
        expect(cfg.logging?.level).toBe("debug");
        // Isolation: the persisted file lives under temp, never the real path.
        const persisted = await fs
          .readFile(path.join(tmp, "massa-ai", "config.json"), "utf-8")
          .catch(() => null);
        expect(persisted).not.toBeNull();
        expect(persisted).toContain('"debug"');
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });

    test("use ollama switches provider (verified via show)", async () => {
      const tmp = await makeTempXdg();
      try {
        const initR = await runBin(CONFIG_CLI, ["init"], { XDG_CONFIG_HOME: tmp });
        expect(initR.code).toBe(0);
        const useR = await runBin(CONFIG_CLI, ["use", "ollama"], { XDG_CONFIG_HOME: tmp });
        expect(useR.code).toBe(0);
        const showR = await runBin(CONFIG_CLI, ["show"], { XDG_CONFIG_HOME: tmp });
        const cfg = extractJson(showR.stdout) as { embedding?: { provider?: string } };
        expect(cfg.embedding?.provider).toBe("ollama");
      } finally {
        await fs.rm(tmp, { recursive: true, force: true });
      }
    });
  });
});
