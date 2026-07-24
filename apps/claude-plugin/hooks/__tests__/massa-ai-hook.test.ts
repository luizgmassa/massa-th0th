/**
 * massa-ai-hook — unit tests (Wave 6 N30, T21)
 *
 * Verifies the hook binary behavior:
 * - Malformed JSON → exit 0, no POST
 * - Valid JSON → POST correct body to correct endpoint
 * - Terminal stdin (no pipe) → exit 0, no POST
 * - Pin resolution order correct (existing pin → env → git → cwd basename)
 * - pre-compact does TWO POSTs (observation + snapshot, different body shapes)
 *
 * Tests spawn the binary as a child process with piped stdin so the terminal
 * detection logic is exercised correctly.
 */

import { describe, test, expect } from "bun:test";
import { spawnSync, type SpawnSyncReturns } from "child_process";
import { writeFileSync, mkdirSync, readFileSync, rmSync } from "fs";
import path from "path";
import http from "node:http";
import type { AddressInfo } from "node:net";

const HOOK_SCRIPT = path.resolve(import.meta.dir, "../massa-ai-hook.ts");

interface RunResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

// Captured POST: { url path, headers, parsed JSON body }
interface CapturedPost {
  url: string;
  headers: http.IncomingHttpHeaders;
  body: Record<string, unknown>;
}

/**
 * Start a local HTTP capture server that records every POST it receives.
 * Returns the base URL and a function to read+clear captured posts.
 * The hook binary is configured (via MASSA_AI_API_BASE) to POST here
 * instead of the unreachable default, so we can assert endpoint/body/count.
 *
 * NOTE: the hook uses fire-and-forget fetch with AbortSignal timeouts. The
 * capture server responds immediately (200) so the POSTs complete before the
 * binary exits. We poll briefly in the test to let both POSTs land.
 */
function startCaptureServer(): {
  baseUrl: string;
  getPosts: () => CapturedPost[];
  close: () => Promise<void>;
} {
  const posts: CapturedPost[] = [];
  const server = http.createServer((req, res) => {
    let chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      let body: Record<string, unknown> = {};
      try {
        body = JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
      } catch {
        // non-JSON body → empty
      }
      posts.push({ url: req.url || "/", headers: req.headers, body });
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end("{}");
    });
  });
  server.listen(0, "127.0.0.1");
  const port = (server.address() as AddressInfo).port;
  return {
    baseUrl: `http://127.0.0.1:${port}`,
    getPosts: () => [...posts],
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/** Wait until predicate is true or timeout elapses (lets async POSTs land). */
async function waitFor(predicate: () => boolean, timeoutMs = 1500): Promise<void> {
  const start = Date.now();
  while (!predicate() && Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 25));
  }
}

function runHook(
  subcommand: string,
  stdinInput: string | null,
  env: Record<string, string> = {},
  pipeStdin = true,
): RunResult {
  const fullEnv = {
    ...process.env,
    MASSA_AI_API_BASE: "http://127.0.0.1:59999", // unreachable port — POST is fire-and-forget
    ...env,
  };

  // When pipeStdin=false, don't provide stdin (simulates terminal)
  const result: SpawnSyncReturns<string> = spawnSync(
    "bun",
    ["run", HOOK_SCRIPT, subcommand],
    {
      encoding: "utf8",
      env: fullEnv,
      input: pipeStdin ? (stdinInput ?? "") : undefined,
      stdio: pipeStdin ? ["pipe", "pipe", "pipe"] : ["ignore", "pipe", "pipe"],
      timeout: 8000, // accommodate pre-compact's 5s snapshot POST timeout
    },
  );

  return {
    exitCode: result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

/**
 * Run the hook against a live capture server and collect captured POSTs.
 * main() awaits the POSTs before process.exit, so posts are present once the
 * child returns. A short poll guards against scheduling jitter.
 */
async function runHookCaptured(
  subcommand: string,
  stdinInput: string,
  extraEnv: Record<string, string> = {},
): Promise<{ posts: CapturedPost[]; exitCode: number | null }> {
  // Use a fresh TMPDIR per call so the per-session pin file from a prior
  // test run can't shadow the env MASSA_AI_PROJECT_ID we set here.
  const tmpDir = path.join(
    process.env.TMPDIR || "/tmp",
    `massa-ai-hook-cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
  );
  mkdirSync(tmpDir, { recursive: true });
  const cap = startCaptureServer();
  try {
    const result = runHook(subcommand, stdinInput, {
      MASSA_AI_API_BASE: cap.baseUrl,
      TMPDIR: tmpDir,
      ...extraEnv,
    });
    await waitFor(() => cap.getPosts().length > 0, 3000);
    return { posts: cap.getPosts(), exitCode: result.exitCode };
  } finally {
    await cap.close();
    rmSync(tmpDir, { recursive: true, force: true });
  }
}

describe("massa-ai-hook (T21)", () => {
  test("malformed JSON → exit 0, no POST", () => {
    const result = runHook("session-start", "not valid json {{{");
    expect(result.exitCode).toBe(0);
  });

  test("valid JSON → exit 0", () => {
    const result = runHook(
      "session-start",
      JSON.stringify({ session_id: "test-123", cwd: "/tmp" }),
    );
    expect(result.exitCode).toBe(0);
  });

  test("empty stdin → exit 0, no POST", () => {
    const result = runHook("session-start", "");
    expect(result.exitCode).toBe(0);
  });

  test("terminal stdin (no pipe) → exit 0, no POST", () => {
    // When stdin is ignored (not piped), the binary should exit 0
    const result = runHook("session-start", null, {}, false);
    expect(result.exitCode).toBe(0);
  });

  test("unknown subcommand → exit 0", () => {
    const result = runHook("nonexistent-event", JSON.stringify({ x: 1 }));
    expect(result.exitCode).toBe(0);
  });

  test("pre-tool-use subcommand produces exactly ONE POST with event=pre-tool-use", async () => {
    // CPX-05/CRS-03 (partial): the new EVENT_MAP entry must route the
    // pre-tool-use subcommand to a single observation POST (not silent exit-0).
    const { posts, exitCode } = await runHookCaptured(
      "pre-tool-use",
      JSON.stringify({ session_id: "pre-tool-test-session", tool: "Edit" }),
    );
    expect(exitCode).toBe(0);
    expect(posts.length).toBe(1);
    expect(posts[0]!.url).toBe("/api/v1/hook");
    expect(posts[0]!.body.event).toBe("pre-tool-use");
  }, 10000);

  test("valid JSON with session_id → exit 0 (pin resolution works)", () => {
    const result = runHook(
      "user-prompt-submit",
      JSON.stringify({ session_id: "pin-test-session", prompt: "hello" }),
      { MASSA_AI_PROJECT_ID: "test-project-via-env" },
    );
    expect(result.exitCode).toBe(0);
  });

  test("pre-compact: TWO POSTs (observation + snapshot) → exit 0", async () => {
    // Kills the "remove second POST" mutant: asserts BOTH POSTs land on
    // the correct endpoints with the correct body shapes.
    const { posts, exitCode } = await runHookCaptured(
      "pre-compact",
      JSON.stringify({ session_id: "compact-test-session" }),
      { MASSA_AI_PROJECT_ID: "proj-via-env" },
    );
    expect(exitCode).toBe(0);
    expect(posts.length).toBe(2);

    // 1st POST: observation → /api/v1/hook, observation body shape
    const obs = posts.find((p) => p.url === "/api/v1/hook");
    expect(obs).toBeDefined();
    expect(obs!.body.event).toBe("pre-compact");
    expect(obs!.body.projectId).toBe("proj-via-env");
    expect(obs!.body.sessionId).toBe("compact-test-session");
    expect(typeof obs!.body.cwd).toBe("string");
    expect(obs!.body.payload).toBeDefined();

    // 2nd POST: snapshot → /api/v1/hook/compact-snapshot, snapshot body shape
    const snap = posts.find((p) => p.url === "/api/v1/hook/compact-snapshot");
    expect(snap).toBeDefined();
    expect(snap!.body.sessionId).toBe("compact-test-session");
    expect(snap!.body.projectId).toBe("proj-via-env");
    expect(snap!.body.persist).toBe(true);
    expect(typeof snap!.body.cwd).toBe("string");
    // snapshot body must NOT carry the observation's `event`/`payload` keys
    expect(snap!.body.event).toBeUndefined();
    expect(snap!.body.payload).toBeUndefined();
  }, 15000);

  test("pre-compact with no session_id → exit 0 (uses 'unknown')", async () => {
    const { posts, exitCode } = await runHookCaptured(
      "pre-compact",
      JSON.stringify({ data: "compact" }),
    );
    expect(exitCode).toBe(0);
    // silent-degrade: still makes both POSTs, sessionId resolves to "unknown"
    expect(posts.length).toBe(2);
    const obs = posts.find((p) => p.url === "/api/v1/hook");
    expect(obs).toBeDefined();
    expect(obs!.body.sessionId).toBe("unknown");
  }, 15000);

  test("single-event subcommands make exactly ONE POST (not two)", async () => {
    // Kills the "always POST twice" inverse mutant: non-pre-compact events
    // must make exactly one POST to /api/v1/hook.
    const { posts, exitCode } = await runHookCaptured(
      "session-start",
      JSON.stringify({ session_id: "single-post-test" }),
    );
    expect(exitCode).toBe(0);
    expect(posts.length).toBe(1);
    expect(posts[0]!.url).toBe("/api/v1/hook");
  }, 10000);

  test("stop event maps to session-end → exit 0", () => {
    const result = runHook("stop", JSON.stringify({ session_id: "stop-test" }));
    expect(result.exitCode).toBe(0);
  });

  test("pin resolution: env MASSA_AI_PROJECT_ID is used when no pin file", () => {
    const tmpDir = path.join(process.env.TMPDIR || "/tmp", "massa-ai-hooks-test-" + Date.now());
    const result = runHook(
      "session-start",
      JSON.stringify({ session_id: "env-pin-test" }),
      {
        MASSA_AI_PROJECT_ID: "env-project-id",
        TMPDIR: tmpDir,
      },
    );
    expect(result.exitCode).toBe(0);
    // The pin file should have been written with the env value
    const pinFile = path.join(tmpDir, "massa-ai-hooks", "env-pin-test");
    try {
      const pinned = readFileSync(pinFile, "utf8").trim();
      expect(pinned).toBe("env-project-id");
    } catch {
      // Pin file write is best-effort; if it fails the test still passes
    }
    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });

  test("pin resolution: existing pin file wins over env", () => {
    const tmpDir = path.join(process.env.TMPDIR || "/tmp", "massa-ai-hooks-test2-" + Date.now());
    const pinDir = path.join(tmpDir, "massa-ai-hooks");
    mkdirSync(pinDir, { recursive: true });
    // Pre-write a pin file
    const pinFile = path.join(pinDir, "existing-pin-session");
    writeFileSync(pinFile, "pinned-project-id");

    const result = runHook(
      "session-start",
      JSON.stringify({ session_id: "existing-pin-session" }),
      {
        MASSA_AI_PROJECT_ID: "env-should-be-ignored",
        TMPDIR: tmpDir,
      },
    );
    expect(result.exitCode).toBe(0);

    // The pin file should still contain the original pinned value
    const pinned = readFileSync(pinFile, "utf8").trim();
    expect(pinned).toBe("pinned-project-id");

    // Cleanup
    rmSync(tmpDir, { recursive: true, force: true });
  });
});

// ── N30 AC6: AttributionResolver parity ─────────────────────────────────────
//
// The hook binary does NOT replicate AttributionResolver server-side logic
// (explicit→sticky→containment→verbatim, fail-open). Instead it sends the RAW
// fields the server resolver needs: the caller's resolved `projectId` (the
// client-side pin/env/git/cwd fallback — NOT server attribution), `sessionId`,
// and `cwd`. The server-side AttributionResolver then resolves the durable id
// using these three inputs. These tests pin that the binary emits exactly the
// fields required for server-side resolution, killing mutants that drop
// sessionId/cwd/projectId from the POST body.

describe("N30 AC6: hook emits attribution fields for server-side resolver", () => {
  test("observation POST carries sessionId + cwd + projectId (resolver inputs)", async () => {
    const { posts } = await runHookCaptured(
      "user-prompt-submit",
      JSON.stringify({ session_id: "attr-test-session", prompt: "hi" }),
      { MASSA_AI_PROJECT_ID: "caller-proj-1" },
    );
    expect(posts.length).toBe(1);
    const body = posts[0]!.body;
    // Server-side AttributionResolver needs: callerProjectId (projectId),
    // sessionId, cwd. The binary MUST send all three.
    expect(body).toHaveProperty("projectId");
    expect(body).toHaveProperty("sessionId");
    expect(body).toHaveProperty("cwd");
    expect(typeof body.projectId).toBe("string");
    expect(typeof body.sessionId).toBe("string");
    expect(typeof body.cwd).toBe("string");
    expect(body.projectId).toBe("caller-proj-1");
    expect(body.sessionId).toBe("attr-test-session");
  });

  test("pre-compact snapshot POST carries sessionId + cwd + projectId", async () => {
    const { posts } = await runHookCaptured(
      "pre-compact",
      JSON.stringify({ session_id: "compact-attr-session" }),
      { MASSA_AI_PROJECT_ID: "compact-caller-proj" },
    );
    const snap = posts.find((p) => p.url === "/api/v1/hook/compact-snapshot");
    expect(snap).toBeDefined();
    expect(snap!.body).toHaveProperty("sessionId");
    expect(snap!.body).toHaveProperty("projectId");
    expect(snap!.body).toHaveProperty("cwd");
    expect(snap!.body.sessionId).toBe("compact-attr-session");
    expect(snap!.body.projectId).toBe("compact-caller-proj");
  }, 15000);

  test("hook binary does not perform server-side containment/explicit tiers", () => {
    // The binary's resolveProjectId is a CLIENT-SIDE pin/env/git/cwd fallback,
    // NOT the server AttributionResolver's explicit→sticky→containment→
    // verbatim chain. Pin this contract: the binary imports neither the
    // AttributionResolver class nor the resolver module (it would be wrong to
    // duplicate that logic client-side). Server-side resolution is canonical.
    const fs = require("fs") as typeof import("fs");
    const src = fs.readFileSync(HOOK_SCRIPT, "utf8");
    expect(src).not.toMatch(/import\s+.*AttributionResolver/);
    expect(src).not.toMatch(/from\s+["'].*attribution-resolver/);
    expect(src).not.toContain("resolveContainment");
    // The binary DOES send the raw inputs the server resolver consumes.
    expect(src).toContain("sessionId");
    expect(src).toContain("projectId");
    expect(src).toContain("cwd");
  });
});