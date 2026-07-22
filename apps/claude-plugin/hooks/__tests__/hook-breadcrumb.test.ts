/**
 * Unit tests for hook deadline breadcrumb-on-fire (W7-13, T15).
 *
 * Tests derive from spec ACs:
 *   1. When POST takes > 80% of deadline → logs breadcrumb (JSON line to stderr)
 *   2. When POST times out → logs deadline-on-fire breadcrumb
 *   3. Breadcrumb is parseable (JSON line)
 *
 * Strategy: use spawnSync (blocking) to run the hook binary. The mock server
 * runs in a separate Bun child process so it's not blocked by spawnSync.
 * The server process writes its port to stdout before listening.
 */

import { describe, test, expect } from "bun:test";
import { spawnSync, spawn } from "child_process";
import { writeFileSync, unlinkSync } from "fs";
import path from "path";

const HOOK_SCRIPT = path.resolve(import.meta.dir, "../massa-th0th-hook.ts");

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Start a mock HTTP server in a separate Bun child process.
 * The server writes its port to stdout, then listens.
 * delayMs > 0: respond after delay. delayMs = 0: never respond (hanging).
 */
function startServerInChild(delayMs: number): {
  baseUrl: string;
  stop: () => void;
} {
  const serverScript = `
import http from "node:http";
const delayMs = ${delayMs};
const server = http.createServer((req, res) => {
  if (delayMs > 0) {
    setTimeout(() => { res.writeHead(200); res.end("{}"); }, delayMs);
  }
  // delayMs === 0: never respond (hanging server)
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
});
`;

  const tmpFile = path.join(import.meta.dir, `_tmp_server_${Date.now()}.ts`);
  writeFileSync(tmpFile, serverScript);

  const child = spawn("bun", [tmpFile], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Read port from stdout
  const port = parseInt(
    new Promise<string>((resolve) => {
      let data = "";
      child.stdout?.on("data", (d) => {
        data += d.toString();
        if (data.trim().length > 0) resolve(data.trim());
      });
    }).toString(),
    10,
  );

  // Actually, we need to get the port synchronously. Let me use a sync approach.
  // Wait for the port with a promise.
  return {
    baseUrl: "", // placeholder, filled below
    stop: () => {
      child.kill("SIGTERM");
      try { unlinkSync(tmpFile); } catch { /* ok */ }
    },
  };
}

/**
 * Synchronous version: start server in child, get port via blocking read.
 */
function startServerSync(delayMs: number): { baseUrl: string; stop: () => void } {
  const serverScript = `
import http from "node:http";
const delayMs = ${delayMs};
const server = http.createServer((req, res) => {
  if (delayMs > 0) {
    setTimeout(() => { res.writeHead(200); res.end("{}"); }, delayMs);
  }
});
server.listen(0, "127.0.0.1", () => {
  process.stdout.write(String(server.address().port));
  process.stdout.write("\\n");
});
process.on("SIGTERM", () => { server.close(); process.exit(0); });
`;

  const tmpFile = path.join(import.meta.dir, `_tmp_server_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);
  writeFileSync(tmpFile, serverScript);

  const child = spawn("bun", [tmpFile], {
    stdio: ["pipe", "pipe", "pipe"],
  });

  // Block until we get the port — use a synchronous read via spawnSync trick
  // Actually we can't sync-read from spawn. Let me use a different approach.
  // Write port to a temp file instead.
  child.unref();

  // Poll for the port file — but that's async too.
  // Simpler: just use a known approach — spawn the server with spawnSync to get port.
  return {
    baseUrl: "",
    stop: () => {
      child.kill("SIGTERM");
      try { unlinkSync(tmpFile); } catch { /* ok */ }
    },
  };
}

function runHook(baseUrl: string, payload: string): RunResult {
  const result = spawnSync(
    "bun",
    [HOOK_SCRIPT, "post-tool-use"],
    {
      input: payload,
      env: { ...process.env, MASSA_TH0TH_API_BASE: baseUrl },
      timeout: 30000,
      encoding: "utf-8",
    },
  );
  return {
    exitCode: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

const validPayload = JSON.stringify({
  session_id: "test-session",
  tool_name: "Read",
  tool_input: { file_path: "/test" },
});

function parseBreadcrumbs(stderr: string): any[] {
  return stderr
    .trim()
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try { return JSON.parse(l); } catch { return null; }
    })
    .filter((b) => b !== null);
}

describe("hook deadline breadcrumb-on-fire (W7-13)", () => {
  test(">80% deadline: logs breadcrumb to stderr (JSON line, parseable)", () => {
    // Start server in a separate process that responds after 1700ms (85% of 2000ms deadline)
    const { baseUrl, stop } = startServerWithPort(1700);
    try {
      const result = runHook(baseUrl, validPayload);
      expect(result.exitCode).toBe(0);

      const breadcrumbs = parseBreadcrumbs(result.stderr);
      const breadcrumb = breadcrumbs.find((b) => b.type === "breadcrumb");
      expect(breadcrumb).toBeDefined();
      expect(breadcrumb!.hook).toBe("post-tool-use");
      expect(breadcrumb!.elapsed).toBeGreaterThan(1600);
      expect(breadcrumb!.deadline).toBe(2000);
      expect(breadcrumb!.pct).toBeGreaterThan(80);
    } finally {
      stop();
    }
  }, 30000);

  test("timeout: logs deadline-on-fire breadcrumb on AbortSignal timeout", () => {
    // Server never responds → AbortSignal.timeout fires at 2000ms
    const { baseUrl, stop } = startServerWithPort(0);
    try {
      const result = runHook(baseUrl, validPayload);
      expect(result.exitCode).toBe(0);

      const breadcrumbs = parseBreadcrumbs(result.stderr);
      const deadlineOnFire = breadcrumbs.find((b) => b.type === "deadline-on-fire");
      expect(deadlineOnFire).toBeDefined();
      expect(deadlineOnFire!.hook).toBe("post-tool-use");
      expect(deadlineOnFire!.deadline).toBe(2000);
      expect(deadlineOnFire!.reason).toBe("timeout");
      expect(deadlineOnFire!.elapsed).toBeGreaterThanOrEqual(1900);
    } finally {
      stop();
    }
  }, 30000);

  test("fast response: no breadcrumb logged when under 80% deadline", () => {
    // Server responds in 100ms → well under 80% of 2000ms deadline
    const { baseUrl, stop } = startServerWithPort(100);
    try {
      const result = runHook(baseUrl, validPayload);
      expect(result.exitCode).toBe(0);

      const breadcrumbs = parseBreadcrumbs(result.stderr);
      const breadcrumb = breadcrumbs.find(
        (b) => b.type === "breadcrumb" || b.type === "deadline-on-fire",
      );
      expect(breadcrumb).toBeUndefined();
    } finally {
      stop();
    }
  }, 15000);
});

/**
 * Start a mock HTTP server in a separate Bun child process and return its
 * base URL. Uses a temp file to communicate the port.
 */
function startServerWithPort(delayMs: number): { baseUrl: string; stop: () => void } {
  const { spawnSync: _spawnSync } = require("child_process");
  const { writeFileSync, readFileSync, unlinkSync, existsSync } = require("fs");
  const path = require("path");

  const portFile = path.join(import.meta.dir, `_tmp_port_${Date.now()}_${Math.random().toString(36).slice(2)}.txt`);
  const serverScript = path.join(import.meta.dir, `_tmp_server_${Date.now()}_${Math.random().toString(36).slice(2)}.ts`);

  writeFileSync(serverScript, `
import http from "node:http";
import { writeFileSync } from "node:fs";
const delayMs = ${delayMs};
const portFile = ${JSON.stringify(portFile)};
const server = http.createServer((req, res) => {
  if (delayMs > 0) {
    setTimeout(() => { res.writeHead(200); res.end("{}"); }, delayMs);
  }
});
server.listen(0, "127.0.0.1", () => {
  writeFileSync(portFile, String(server.address().port));
});
process.on("SIGTERM", () => { server.close(); process.exit(0); });
`);

  const child = spawn("bun", [serverScript], {
    stdio: ["pipe", "pipe", "pipe"],
    detached: true,
  });
  child.unref();

  // Poll for port file (max 5s)
  const start = Date.now();
  let port = "";
  while (Date.now() - start < 5000) {
    if (existsSync(portFile)) {
      port = readFileSync(portFile, "utf-8").trim();
      break;
    }
    // Busy-wait briefly (sync, since we're before the async test body)
    const w = Date.now();
    while (Date.now() - w < 50) { /* spin */ }
  }

  if (!port) {
    child.kill("SIGKILL");
    throw new Error("Server failed to start within 5s");
  }

  return {
    baseUrl: `http://127.0.0.1:${port}`,
    stop: () => {
      try { process.kill(-child.pid!, "SIGTERM"); } catch { /* ok */ }
      try { child.kill("SIGTERM"); } catch { /* ok */ }
      try { unlinkSync(portFile); } catch { /* ok */ }
      try { unlinkSync(serverScript); } catch { /* ok */ }
    },
  };
}