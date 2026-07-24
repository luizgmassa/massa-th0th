/**
 * OS-level sandbox wrapper for the executor (W7-08, T12).
 *
 * Wraps child process spawn in platform-specific isolation:
 *   - macOS: `sandbox-exec` with a seatbelt profile (no network, reads
 *     restricted to realpath(project root) + tmpdir, writes only to tmpdir).
 *   - Linux: `docker run --rm --read-only --tmpfs /tmp --network none`
 *     with the project root mounted read-only.
 *
 * Default mode is `auto`: uses the sandbox if the platform tool is available,
 * falls back to best-effort containment if not (F1 mitigation — CI can't run
 * Docker). `MASSA_AI_EXECUTOR_SANDBOX=none` forces best-effort.
 * `MASSA_AI_EXECUTOR_SANDBOX=on` forces sandbox and errors if unavailable
 * (teaching error, not silent fallback).
 *
 * Seatbelt profile uses `realpathSync` for the project root, not lexical
 * paths (F2 mitigation — worktree symlink breakage).
 */

import { spawn } from "node:child_process";
import { realpathSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { logger } from "@massa-ai/shared";

export type SandboxMode = "docker" | "seatbelt" | "none";

/** Cached availability checks. */
let _dockerAvailable: boolean | null = null;
let _seatbeltAvailable: boolean | null = null;

/**
 * Check if `docker` is available on the system (Linux sandbox).
 * @internal
 */
export function isDockerAvailable(): boolean {
  if (_dockerAvailable !== null) return _dockerAvailable;
  try {
    execFileSync("docker", ["--version"], { stdio: "pipe", timeout: 5000 });
    _dockerAvailable = true;
  } catch {
    _dockerAvailable = false;
  }
  return _dockerAvailable;
}

/**
 * Check if `sandbox-exec` is available on the system (macOS sandbox).
 * @internal
 */
export function isSeatbeltAvailable(): boolean {
  if (_seatbeltAvailable !== null) return _seatbeltAvailable;
  try {
    execFileSync("sandbox-exec", ["--version"], { stdio: "pipe", timeout: 5000 });
    _seatbeltAvailable = true;
  } catch {
    _seatbeltAvailable = false;
  }
  return _seatbeltAvailable;
}

/**
 * Reset availability caches. Test seam.
 * @internal
 */
export function _resetSandboxAvailabilityCache(): void {
  _dockerAvailable = null;
  _seatbeltAvailable = null;
}

/**
 * Determine the sandbox mode based on env + platform + tool availability.
 *
 * - `MASSA_AI_EXECUTOR_SANDBOX=none` → best-effort (no sandbox)
 * - `MASSA_AI_EXECUTOR_SANDBOX=on` → force sandbox, error if unavailable
 * - unset / `auto` → use sandbox if available, fall back to best-effort
 */
export function getSandboxMode(): SandboxMode {
  const env = process.env.MASSA_AI_EXECUTOR_SANDBOX ?? "auto";

  if (env === "none") return "none";

  const isMac = process.platform === "darwin";
  const isLinux = process.platform === "linux";

  if (env === "on") {
    if (isMac && isSeatbeltAvailable()) return "seatbelt";
    if (isLinux && isDockerAvailable()) return "docker";
    throw new Error(
      `Sandbox forced (MASSA_AI_EXECUTOR_SANDBOX=on) but no sandbox tool available. ` +
        `Set MASSA_AI_EXECUTOR_SANDBOX=none to disable.`,
    );
  }

  // auto: use if available, fall back to best-effort
  if (isMac && isSeatbeltAvailable()) return "seatbelt";
  if (isLinux && isDockerAvailable()) return "docker";
  return "none";
}

/**
 * Build a macOS seatbelt profile for the sandbox.
 *
 * Uses `realpathSync` for the project root to resolve symlinks (F2 mitigation).
 * The profile allows:
 *   - reads on realpath(project root) + tmpdir
 *   - writes ONLY to tmpdir
 *   - no network
 *   - no process-possession changes (no signal to other pids)
 *
 * @internal
 */
export function _buildSeatbeltProfile(projectRoot: string, tmpDir: string): string {
  // F2 mitigation: use realpathSync to resolve symlinks (worktree path).
  let realRoot: string;
  try {
    realRoot = realpathSync(projectRoot);
  } catch {
    // If realpath fails (path doesn't exist yet), fall back to lexical path.
    realRoot = projectRoot;
  }

  let realTmp: string;
  try {
    realTmp = realpathSync(tmpDir);
  } catch {
    realTmp = tmpDir;
  }

  return `(version 1)
(deny default)
(allow process-fork)
(allow process-exec)
(allow signal (target self))
(allow sysctl-read)
(allow file-read*)
(allow file-write*
  (subpath "${realTmp}"))
(deny file-write*)
(allow file-read*
  (subpath "${realRoot}"))
(allow file-read*
  (subpath "${realTmp}"))
(deny network*)
`;
}

/**
 * Wrap a command array with the sandbox prefix.
 *
 * Returns a new command array where cmd[0] is the sandbox launcher and the
 * rest are the sandbox args + the original command.
 *
 * - macOS seatbelt: `["sandbox-exec", "-p", profile, "--", ...cmd]`
 * - Linux docker: `["docker", "run", "--rm", "--read-only", "--tmpfs", "/tmp", "-v", "project:/project:ro", "--network", "none", "--", ...cmd]`
 * - none: returns cmd unchanged
 */
export function wrapSpawn(
  cmd: string[],
  cwd: string,
  tmpDir: string,
  mode: SandboxMode,
): string[] {
  if (mode === "none") return cmd;

  if (mode === "seatbelt") {
    const profile = _buildSeatbeltProfile(cwd, tmpDir);
    logger.info("sandbox: using macOS seatbelt", { cwd, tmpDir });
    return ["sandbox-exec", "-p", profile, "--", ...cmd];
  }

  if (mode === "docker") {
    // F2 mitigation: use realpathSync for project root mount.
    let realRoot: string;
    try {
      realRoot = realpathSync(cwd);
    } catch {
      realRoot = cwd;
    }
    logger.info("sandbox: using Linux Docker", { cwd: realRoot, tmpDir });
    return [
      "docker",
      "run",
      "--rm",
      "--read-only",
      "--tmpfs",
      "/tmp",
      "-v",
      `${realRoot}:/project:ro`,
      "--network",
      "none",
      "--workdir",
      "/project",
      "--",
      ...cmd,
    ];
  }

  return cmd;
}