#!/usr/bin/env bun
/**
 * massa-th0th-hook — single typed Bun binary replacing 7 shell hook scripts.
 *
 * Wave 6 N30 (T20): reads JSON from stdin (Bun-native, no jq), resolves the
 * project id through the per-session pin, and POSTs a lifecycle observation
 * to the massa-th0th hook endpoint. Silent-degrade: never blocks the agent
 * (exit 0, no stdout).
 *
 * Subcommands (Claude Code hook event types):
 *   session-start      → event: "session-start"
 *   user-prompt-submit  → event: "user-prompt"
 *   post-tool-use       → event: "post-tool-use"
 *   pre-compact         → SPECIAL: TWO POSTs (observation + compact-snapshot)
 *   stop                → event: "session-end"
 *
 * CRITICAL (pre-mortem F3): pre-compact does TWO POSTs:
 *   (1) observation to /api/v1/hook (3s timeout, observation body
 *       {event, projectId, sessionId, cwd, payload})
 *   (2) snapshot to /api/v1/hook/compact-snapshot (5s timeout, snapshot body
 *       {sessionId, projectId, persist, cwd})
 *   All other subcommands: single POST to /api/v1/hook (2s timeout).
 *
 * Pin resolution order (ported from _pin.sh):
 *   existing pin → env (MASSA_TH0TH_PROJECT_ID) → git toplevel basename → cwd basename
 *
 * Terminal stdin (no pipe) → exit 0, no POST (same as shell [ -t 0 ] check).
 */

import { spawnSync } from "child_process";
import { readFileSync, writeFileSync, mkdirSync, existsSync, fstatSync } from "fs";
import path from "path";

// ── Event type mapping ──────────────────────────────────────────────────────

const EVENT_MAP: Record<string, string> = {
  "session-start": "session-start",
  "user-prompt-submit": "user-prompt",
  "post-tool-use": "post-tool-use",
  "pre-compact": "pre-compact",
  stop: "session-end",
};

// ── Pin resolution (ported from _pin.sh) ─────────────────────────────────────

function sanitizeSessionId(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9._-]/g, "_");
}

function getPinDir(): string {
  return `${process.env.TMPDIR || "/tmp"}/massa-th0th-hooks`;
}

function getPinFile(sessionId: string): string | null {
  if (!sessionId) return null;
  const safe = sanitizeSessionId(sessionId);
  if (safe === "." || safe === "..") return null;
  return path.join(getPinDir(), safe);
}

function resolveProjectId(sessionId: string, cwd: string): string {
  // 1. Existing pin wins
  if (sessionId) {
    const pinFile = getPinFile(sessionId);
    if (pinFile) {
      try {
        if (existsSync(pinFile)) {
          const pinned = readFileSync(pinFile, "utf8").trim();
          if (pinned) return pinned;
        }
      } catch {
        // fall through to compute
      }
    }
  }

  // 2. Compute: env override > git toplevel basename > cwd basename
  let computed = process.env.MASSA_TH0TH_PROJECT_ID || "";
  if (!computed) {
    try {
      const result = spawnSync("git", ["-C", cwd, "rev-parse", "--show-toplevel"], {
        encoding: "utf8",
        timeout: 2000,
      });
      const root = result.stdout?.trim();
      if (root) {
        computed = path.basename(root);
      }
    } catch {
      // git not available
    }
    if (!computed) {
      computed = path.basename(cwd);
    }
  }

  // 3. Write pin for later events of this session (best effort)
  if (sessionId) {
    const pinFile = getPinFile(sessionId);
    if (pinFile) {
      try {
        mkdirSync(getPinDir(), { recursive: true });
        writeFileSync(pinFile, computed, { encoding: "utf8" });
      } catch {
        // silent-degrade: pin write failure is non-fatal
      }
    }
  }

  return computed;
}

// ── Stdin reading ───────────────────────────────────────────────────────────

function readStdin(): string {
  // Terminal stdin (no pipe) → exit 0, no POST (same as shell [ -t 0 ] check)
  try {
    const stats = fstatSync(0);
    if (stats && stats.isCharacterDevice()) {
      return ""; // terminal stdin → no payload
    }
  } catch {
    // stat failed — assume no stdin available
    return "";
  }

  try {
    return readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

// ── POST helper ─────────────────────────────────────────────────────────────

function postObservation(
  url: string,
  body: Record<string, unknown>,
  timeoutMs: number,
): void {
  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    const apiKey = process.env.MASSA_TH0TH_API_KEY;
    if (apiKey) {
      headers["x-api-key"] = apiKey;
    }

    // Fire-and-forget with AbortSignal timeout; never throws to caller
    fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    }).catch(() => {
      // silent-degrade: network failure is non-fatal
    });
  } catch {
    // silent-degrade: fetch unavailable or immediate error is non-fatal
  }
}

// ── Main ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const subcommand = process.argv[2];
  if (!subcommand || !EVENT_MAP[subcommand]) {
    // Unknown or missing subcommand → exit 0 (silent-degrade)
    process.exit(0);
  }

  const rawStdin = readStdin();
  // Whitespace-stripped check: empty payload → no POST (server rejects empty payload)
  const stdinStripped = rawStdin.trim();
  if (!stdinStripped) {
    process.exit(0);
  }

  // Parse JSON (Bun-native, no jq). Malformed JSON → exit 0, no POST.
  let payload: Record<string, unknown>;
  try {
    const parsed = JSON.parse(stdinStripped);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      process.exit(0);
    }
    payload = parsed as Record<string, unknown>;
  } catch {
    // Malformed JSON → exit 0, no POST (same as shell jq failure)
    process.exit(0);
  }

  const event = EVENT_MAP[subcommand]!;
  const cwd = process.cwd();

  // Extract session id from payload (Claude Code sends "session_id"; accept "sessionId" too)
  const sessionId =
    (typeof payload.session_id === "string" ? payload.session_id : "") ||
    (typeof payload.sessionId === "string" ? payload.sessionId : "") ||
    "unknown";

  const projectId = resolveProjectId(sessionId, cwd);

  const baseUrl = process.env.MASSA_TH0TH_API_BASE || "http://localhost:3333";
  const hookUrl = `${baseUrl}/api/v1/hook`;

  if (subcommand === "pre-compact") {
    // CRITICAL (F3): pre-compact does TWO POSTs
    // 1. Observation to /api/v1/hook (3s timeout, observation body)
    const obsBody = {
      event,
      projectId,
      sessionId,
      cwd,
      payload,
    };
    postObservation(hookUrl, obsBody, 3000);

    // 2. Snapshot to /api/v1/hook/compact-snapshot (5s timeout, snapshot body)
    const snapshotUrl = `${baseUrl}/api/v1/hook/compact-snapshot`;
    const snapBody = {
      sessionId,
      projectId,
      persist: true,
      cwd,
    };
    postObservation(snapshotUrl, snapBody, 5000);
  } else {
    // All other subcommands: single POST to /api/v1/hook (2s timeout, observation body)
    const sessionField = sessionId && sessionId !== "unknown" ? { sessionId } : {};
    const obsBody = {
      event,
      projectId,
      ...sessionField,
      payload,
    };
    postObservation(hookUrl, obsBody, 2000);
  }

  // Always exit 0 (silent-degrade: never blocks the agent)
  process.exit(0);
}

main().catch(() => process.exit(0));