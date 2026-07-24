/**
 * Pure XDG Base Directory resolution (N36).
 *
 * Zero project-module imports — only Node builtins (`path`, `os`). The
 * circular dependency was `config-loader.ts ↔ massa-ai-config.ts`; this
 * module imports neither, so importing it from both sides breaks the cycle
 * without inlining the XDG logic in each file.
 *
 * Spec AC 1 (N36): exports `xdgConfigHome`, `xdgDataHome`, `xdgCacheHome`,
 * `xdgRuntimeDir`, `xdgStateHome`, `configDir(app)`, `dataDir(app)`,
 * `cacheDir(app)` and has ZERO imports from project modules.
 *
 * Env precedence follows the XDG Base Directory Specification:
 *   - `XDG_CONFIG_HOME` (default `~/.config`) — non-empty, trimmed
 *   - `XDG_DATA_HOME`    (default `~/.local/share`)
 *   - `XDG_CACHE_HOME`   (default `~/.cache`)
 *   - `XDG_RUNTIME_DIR`  (default `/run/user/<uid>`) — no trailing slash
 *   - `XDG_STATE_HOME`   (default `~/.local/state`)
 *
 * An env var that is empty or whitespace-only is treated as unset (the
 * default is used), matching the spec's "non-empty trimmed" rule.
 */

import path from "path";
import os from "os";

function xdgEnv(name: string, fallback: string): string {
  const v = process.env[name];
  return v && v.trim() ? v : fallback;
}

export function xdgConfigHome(): string {
  return xdgEnv("XDG_CONFIG_HOME", path.join(os.homedir(), ".config"));
}

export function xdgDataHome(): string {
  return xdgEnv("XDG_DATA_HOME", path.join(os.homedir(), ".local", "share"));
}

export function xdgCacheHome(): string {
  return xdgEnv("XDG_CACHE_HOME", path.join(os.homedir(), ".cache"));
}

export function xdgRuntimeDir(): string {
  // `os.uid()` is not in the Node/Bun `os` type surface. Use
  // `process.getuid()` (POSIX, available on Node and Bun) and fall back to an
  // empty uid segment on non-POSIX runtimes. Users on non-POSIX should set
  // XDG_RUNTIME_DIR explicitly per the XDG Base Directory Specification.
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "";
  return xdgEnv("XDG_RUNTIME_DIR", path.join("/run", "user", uid));
}

export function xdgStateHome(): string {
  return xdgEnv("XDG_STATE_HOME", path.join(os.homedir(), ".local", "state"));
}

export function configDir(app: string): string {
  return path.join(xdgConfigHome(), app);
}

export function dataDir(app: string): string {
  return path.join(xdgDataHome(), app);
}

export function cacheDir(app: string): string {
  return path.join(xdgCacheHome(), app);
}