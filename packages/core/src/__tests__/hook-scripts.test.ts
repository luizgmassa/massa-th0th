/**
 * Hook script existence + silent-degrade test (Phase 3, P3-HOOKSCRIPT-01).
 *
 * Verifies the four Claude Code hook scripts exist under apps/claude-plugin/hooks,
 * are executable, and that the core silent-degrade guard (curl missing → exit 0)
 * works. The full "curl to a dead endpoint → exit 0" path is exercised manually
 * in validation (it depends on curl availability in the environment).
 */

import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync, spawnSync } from "child_process";

const HOOKS_DIR = path.resolve(
  __dirname,
  "../../../../apps/claude-plugin/hooks",
);

const EXPECTED = [
  "session-start.sh",
  "user-prompt-submit.sh",
  "post-tool-use.sh",
  "stop.sh",
  "_post.sh",
  "_pin.sh",
];

describe("Claude Code hook scripts (P3-HOOKSCRIPT-01)", () => {
  it("all four lifecycle scripts + the shared helper exist", () => {
    for (const f of EXPECTED) {
      const p = path.join(HOOKS_DIR, f);
      expect(fs.existsSync(p), `${f} should exist at ${p}`).toBe(true);
    }
  });

  it("lifecycle scripts are executable", () => {
    for (const f of ["session-start.sh", "user-prompt-submit.sh", "post-tool-use.sh", "stop.sh"]) {
      const p = path.join(HOOKS_DIR, f);
      const stat = fs.statSync(p);
      // Mode 0o111 (any execute bit)
      expect(stat.mode & 0o111, `${f} should be executable`).not.toBe(0);
    }
  });

  it("each lifecycle script maps to the correct massa-ai event kind", () => {
    const cases: Array<[string, string]> = [
      ["session-start.sh", "session-start"],
      ["user-prompt-submit.sh", "user-prompt"],
      ["post-tool-use.sh", "post-tool-use"],
      ["stop.sh", "session-end"],
    ];
    for (const [file, event] of cases) {
      const content = fs.readFileSync(path.join(HOOKS_DIR, file), "utf8");
      expect(content).toContain(`EVENT="${event}"`);
    }
  });

  it("silent-degrades when curl is missing (exit 0, no output)", () => {
    // Replicate the guard from _post.sh in isolation.
    const probe = `#!/bin/sh
command -v curl >/dev/null 2>&1 || { exit 0; }
exit 7
`;
    const tmp = path.join(fs.mkdtempSync(path.join(require("os").tmpdir(), "massa-ai-hook-")), "probe.sh");
    fs.writeFileSync(tmp, probe);
    fs.chmodSync(tmp, 0o755);
    // Run with a PATH that does NOT contain curl (use /dev/null).
    let exitCode = -1;
    try {
      execSync(`env PATH=/dev/null ${tmp}`, { stdio: "ignore" });
      exitCode = 0;
    } catch (e: any) {
      exitCode = e.status ?? -1;
    }
    expect(exitCode).toBe(0);
  });

  it("the shared _post.sh contains the 2s timeout + exit 0 contract", () => {
    const content = fs.readFileSync(path.join(HOOKS_DIR, "_post.sh"), "utf8");
    expect(content).toContain("-m 2");
    expect(content).toContain("exit 0");
    expect(content).toContain("MASSA_AI_API_BASE");
    expect(content).toContain("MASSA_AI_API_KEY");
  });
});

/**
 * Session pinning harness (T5 / HAR-04 / AC-5).
 *
 * Runs the real hook scripts under `sh` with a stubbed `curl` (records every
 * invocation as `<url>\t<body>` lines) and an isolated TMPDIR so pin files
 * never leak between tests. Git-dependent cases use real temp repos.
 */

const STUB_CURL = `#!/bin/sh
body=""
url=""
while [ $# -gt 0 ]; do
  case "$1" in
    --data) body="$2"; shift 2 ;;
    -H|-m|-o|-X) shift 2 ;;
    -*) shift ;;
    *) url="$1"; shift ;;
  esac
done
printf '%s\\t%s\\n' "$url" "$body" >> "$STUB_CURL_LOG"
exit "\${STUB_CURL_EXIT:-0}"
`;

const gitAvailable =
  spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

function makeHarness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-pin-test-"));
  const binDir = path.join(root, "bin");
  fs.mkdirSync(binDir);
  const curlPath = path.join(binDir, "curl");
  fs.writeFileSync(curlPath, STUB_CURL);
  fs.chmodSync(curlPath, 0o755);
  const tmpdir = path.join(root, "tmp");
  fs.mkdirSync(tmpdir);
  const log = path.join(root, "curl.log");
  return { root, binDir, tmpdir, log };
}

function runHook(
  harness: { binDir: string; tmpdir: string; log: string },
  script: string,
  opts: { cwd: string; stdin?: string; env?: Record<string, string> },
) {
  return spawnSync("sh", [path.join(HOOKS_DIR, script)], {
    cwd: opts.cwd,
    input: opts.stdin ?? "",
    env: {
      PATH: `${harness.binDir}:/usr/bin:/bin`,
      TMPDIR: harness.tmpdir,
      STUB_CURL_LOG: harness.log,
      MASSA_AI_API_BASE: "http://127.0.0.1:9",
      ...opts.env,
    },
  });
}

function readCalls(harness: { log: string }) {
  if (!fs.existsSync(harness.log)) return [];
  return fs
    .readFileSync(harness.log, "utf8")
    .split("\n")
    .filter((l) => l.length > 0)
    .map((l) => {
      const tab = l.indexOf("\t");
      return { url: l.slice(0, tab), body: JSON.parse(l.slice(tab + 1)) };
    });
}

function gitInit(dir: string) {
  const res = spawnSync("git", ["init", dir], { stdio: "ignore" });
  expect(res.status).toBe(0);
}

describe("Claude hook session pinning (T5/HAR-04/AC-5)", () => {
  it.skipIf(!gitAvailable)(
    "first event from a subdirectory pins the git toplevel id; POST body intact",
    () => {
      const h = makeHarness();
      const repo = path.join(h.root, "proj-root");
      const sub = path.join(repo, "a", "b");
      fs.mkdirSync(sub, { recursive: true });
      gitInit(repo);

      const res = runHook(h, "session-start.sh", {
        cwd: sub,
        stdin: JSON.stringify({ session_id: "sess-1", marker: "intact" }),
      });
      expect(res.status).toBe(0);

      const calls = readCalls(h);
      expect(calls.length).toBe(1);
      expect(calls[0].url).toBe("http://127.0.0.1:9/api/v1/hook");
      expect(calls[0].body.projectId).toBe("proj-root");
      expect(calls[0].body.event).toBe("session-start");
      expect(calls[0].body.sessionId).toBe("sess-1");
      // Stdin single-read constraint: payload survived pin logic untouched.
      expect(calls[0].body.payload).toEqual({
        session_id: "sess-1",
        marker: "intact",
      });

      const pinFile = path.join(h.tmpdir, "massa-ai-hooks", "sess-1");
      expect(fs.readFileSync(pinFile, "utf8")).toBe("proj-root");
    },
  );

  it.skipIf(!gitAvailable)(
    "later event of the same session reuses the pin from a deeper subdirectory (pin beats env)",
    () => {
      const h = makeHarness();
      const repo = path.join(h.root, "proj-root");
      const sub = path.join(repo, "a", "b");
      fs.mkdirSync(sub, { recursive: true });
      gitInit(repo);

      runHook(h, "session-start.sh", {
        cwd: repo,
        stdin: JSON.stringify({ session_id: "sess-2" }),
      });
      const res = runHook(h, "stop.sh", {
        cwd: sub,
        stdin: JSON.stringify({ session_id: "sess-2" }),
        env: { MASSA_AI_PROJECT_ID: "env-override" },
      });
      expect(res.status).toBe(0);

      const calls = readCalls(h);
      expect(calls.length).toBe(2);
      expect(calls[1].body.projectId).toBe("proj-root");
      expect(calls[1].body.event).toBe("session-end");
    },
  );

  it("env override wins on a fresh session and is pinned for later events", () => {
    const h = makeHarness();
    const work = path.join(h.root, "plain");
    fs.mkdirSync(work);

    runHook(h, "session-start.sh", {
      cwd: work,
      stdin: JSON.stringify({ session_id: "sess-3" }),
      env: { MASSA_AI_PROJECT_ID: "explicit-env" },
    });
    const res = runHook(h, "user-prompt-submit.sh", {
      cwd: work,
      stdin: JSON.stringify({ session_id: "sess-3" }),
    });
    expect(res.status).toBe(0);

    const calls = readCalls(h);
    expect(calls.length).toBe(2);
    expect(calls[0].body.projectId).toBe("explicit-env");
    expect(calls[1].body.projectId).toBe("explicit-env");
  });

  it("without a git repo the cwd basename is used and pinned (today's fallback)", () => {
    const h = makeHarness();
    const work = path.join(h.root, "plain-dir");
    fs.mkdirSync(work);

    const res = runHook(h, "session-start.sh", {
      cwd: work,
      stdin: JSON.stringify({ session_id: "sess-4" }),
    });
    expect(res.status).toBe(0);

    const calls = readCalls(h);
    expect(calls.length).toBe(1);
    expect(calls[0].body.projectId).toBe("plain-dir");
    const pinFile = path.join(h.tmpdir, "massa-ai-hooks", "sess-4");
    expect(fs.readFileSync(pinFile, "utf8")).toBe("plain-dir");
  });

  it.skipIf(!gitAvailable)(
    "pre-compact pins from a subdirectory; both bodies consistent; stdin intact",
    () => {
      const h = makeHarness();
      const repo = path.join(h.root, "proj-pc");
      const sub = path.join(repo, "deep");
      fs.mkdirSync(sub, { recursive: true });
      gitInit(repo);

      const res = runHook(h, "pre-compact.sh", {
        cwd: sub,
        stdin: JSON.stringify({ session_id: "sess-pc", trigger: "auto" }),
      });
      expect(res.status).toBe(0);

      const calls = readCalls(h);
      expect(calls.length).toBe(2);
      const [obs, snap] = calls;
      expect(obs.url).toBe("http://127.0.0.1:9/api/v1/hook");
      expect(obs.body.projectId).toBe("proj-pc");
      expect(obs.body.payload).toEqual({
        session_id: "sess-pc",
        trigger: "auto",
      });
      expect(snap.url).toBe("http://127.0.0.1:9/api/v1/hook/compact-snapshot");
      expect(snap.body.projectId).toBe("proj-pc");
      expect(snap.body.sessionId).toBe("sess-pc");
      expect(snap.body.cwd).toBe(fs.realpathSync(sub));
    },
  );

  it("session id is sanitized for the pin file name (no path escape)", () => {
    const h = makeHarness();
    const work = path.join(h.root, "san");
    fs.mkdirSync(work);

    const res = runHook(h, "session-start.sh", {
      cwd: work,
      stdin: JSON.stringify({ session_id: "../../evil/x" }),
    });
    expect(res.status).toBe(0);

    const pinDir = path.join(h.tmpdir, "massa-ai-hooks");
    const entries = fs.readdirSync(pinDir);
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatch(/^[A-Za-z0-9._-]+$/);
    expect(entries[0]).not.toBe("x");
    const calls = readCalls(h);
    expect(calls[0].body.projectId).toBe("san");
  });

  it("missing _pin.sh falls back to env/basename behavior and still exits 0", () => {
    const h = makeHarness();
    const work = path.join(h.root, "nopin");
    fs.mkdirSync(work);
    // Copy the hook family WITHOUT _pin.sh into a temp hooks dir.
    const hooksCopy = path.join(h.root, "hooks");
    fs.mkdirSync(hooksCopy);
    for (const f of ["session-start.sh", "_post.sh"]) {
      fs.copyFileSync(path.join(HOOKS_DIR, f), path.join(hooksCopy, f));
    }

    const res = spawnSync("sh", [path.join(hooksCopy, "session-start.sh")], {
      cwd: work,
      input: JSON.stringify({ session_id: "sess-nopin" }),
      env: {
        PATH: `${h.binDir}:/usr/bin:/bin`,
        TMPDIR: h.tmpdir,
        STUB_CURL_LOG: h.log,
        MASSA_AI_API_BASE: "http://127.0.0.1:9",
      },
    });
    expect(res.status).toBe(0);

    const calls = readCalls(h);
    expect(calls.length).toBe(1);
    expect(calls[0].body.projectId).toBe("nopin");
  });

  it("degenerate session ids ('.', '..') skip pin I/O but still emit the computed id", () => {
    const h = makeHarness();
    const work = path.join(h.root, "degen");
    fs.mkdirSync(work);

    for (const sessionId of [".", ".."]) {
      const res = runHook(h, "session-start.sh", {
        cwd: work,
        stdin: JSON.stringify({ session_id: sessionId }),
      });
      expect(res.status).toBe(0);
      expect(res.stderr.toString()).toBe("");
    }
    const calls = readCalls(h);
    expect(calls.length).toBe(2);
    expect(calls[0].body.projectId).toBe("degen");
    expect(calls[1].body.projectId).toBe("degen");
  });

  it("scripts exit 0 when the API call fails", () => {
    const h = makeHarness();
    const work = path.join(h.root, "fail");
    fs.mkdirSync(work);

    const res = runHook(h, "session-start.sh", {
      cwd: work,
      stdin: JSON.stringify({ session_id: "sess-5" }),
      env: { STUB_CURL_EXIT: "1" },
    });
    expect(res.status).toBe(0);
  });

  it("empty stdin exits 0 without posting or pinning", () => {
    const h = makeHarness();
    const work = path.join(h.root, "empty");
    fs.mkdirSync(work);

    const res = runHook(h, "session-start.sh", { cwd: work, stdin: "" });
    expect(res.status).toBe(0);
    expect(readCalls(h).length).toBe(0);
    expect(
      fs.existsSync(path.join(h.tmpdir, "massa-ai-hooks")),
    ).toBe(false);
  });
});
