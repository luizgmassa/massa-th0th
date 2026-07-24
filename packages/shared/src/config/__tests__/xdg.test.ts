/**
 * T4 (WAVE4-N36): pure xdg.ts module.
 *
 * Asserts spec AC 1 (N36):
 *   - `xdgConfigHome/DataHome/CacheHome/RuntimeDir/StateHome` return the env
 *     override when set (non-empty trimmed) and the default when unset.
 *   - `configDir(app)` / `dataDir(app)` / `cacheDir(app)` return the env-suffixed
 *     (or default-suffixed) app dir.
 *   - Zero project-module imports — only Node builtins (enforced by the
 *     design's acyclic guarantee: this file imports `os` and `path` only).
 *
 * Discrimination:
 *   - drop the `v.trim()` check → the "empty env → default" test fails
 *     (whitespace-only env would pass through).
 *   - swap the default for `configDir` → the "default → ~/.config" test fails.
 */
import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import path from "path";
import os from "os";

import {
  xdgConfigHome,
  xdgDataHome,
  xdgCacheHome,
  xdgRuntimeDir,
  xdgStateHome,
  configDir,
  dataDir,
  cacheDir,
} from "../xdg";

const ENV_VARS = [
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_CACHE_HOME",
  "XDG_RUNTIME_DIR",
  "XDG_STATE_HOME",
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_VARS) saved[k] = process.env[k];
});
afterEach(() => {
  for (const k of ENV_VARS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
});

describe("xdgConfigHome", () => {
  test("returns XDG_CONFIG_HOME when set (non-empty trimmed)", () => {
    process.env.XDG_CONFIG_HOME = "/custom/config";
    expect(xdgConfigHome()).toBe("/custom/config");
  });

  test("returns ~/.config when unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    expect(xdgConfigHome()).toBe(path.join(os.homedir(), ".config"));
  });

  test("returns the default when env is empty string", () => {
    process.env.XDG_CONFIG_HOME = "";
    expect(xdgConfigHome()).toBe(path.join(os.homedir(), ".config"));
  });

  test("returns the default when env is whitespace-only (treated as unset)", () => {
    process.env.XDG_CONFIG_HOME = "   ";
    expect(xdgConfigHome()).toBe(path.join(os.homedir(), ".config"));
  });
});

describe("xdgDataHome", () => {
  test("returns XDG_DATA_HOME when set", () => {
    process.env.XDG_DATA_HOME = "/custom/data";
    expect(xdgDataHome()).toBe("/custom/data");
  });

  test("returns ~/.local/share when unset", () => {
    delete process.env.XDG_DATA_HOME;
    expect(xdgDataHome()).toBe(path.join(os.homedir(), ".local", "share"));
  });
});

describe("xdgCacheHome", () => {
  test("returns XDG_CACHE_HOME when set", () => {
    process.env.XDG_CACHE_HOME = "/custom/cache";
    expect(xdgCacheHome()).toBe("/custom/cache");
  });

  test("returns ~/.cache when unset", () => {
    delete process.env.XDG_CACHE_HOME;
    expect(xdgCacheHome()).toBe(path.join(os.homedir(), ".cache"));
  });
});

describe("xdgRuntimeDir", () => {
  test("returns XDG_RUNTIME_DIR when set", () => {
    process.env.XDG_RUNTIME_DIR = "/run/user/1001";
    expect(xdgRuntimeDir()).toBe("/run/user/1001");
  });

  test("returns /run/user/<uid> when unset", () => {
    delete process.env.XDG_RUNTIME_DIR;
    const expectedUid =
      typeof process.getuid === "function" ? String(process.getuid()) : "";
    expect(xdgRuntimeDir()).toBe(path.join("/run", "user", expectedUid));
  });
});

describe("xdgStateHome", () => {
  test("returns XDG_STATE_HOME when set", () => {
    process.env.XDG_STATE_HOME = "/custom/state";
    expect(xdgStateHome()).toBe("/custom/state");
  });

  test("returns ~/.local/state when unset", () => {
    delete process.env.XDG_STATE_HOME;
    expect(xdgStateHome()).toBe(path.join(os.homedir(), ".local", "state"));
  });
});

describe("app-suffixed dirs", () => {
  test("configDir(app) = xdgConfigHome/app", () => {
    process.env.XDG_CONFIG_HOME = "/etc/xdg";
    expect(configDir("massa-ai")).toBe(path.join("/etc/xdg", "massa-ai"));
  });

  test("dataDir(app) = xdgDataHome/app", () => {
    process.env.XDG_DATA_HOME = "/var/data";
    expect(dataDir("massa-ai")).toBe(path.join("/var/data", "massa-ai"));
  });

  test("cacheDir(app) = xdgCacheHome/app", () => {
    process.env.XDG_CACHE_HOME = "/var/cache";
    expect(cacheDir("massa-ai")).toBe(
      path.join("/var/cache", "massa-ai"),
    );
  });

  test("app-suffixed dirs fall back to defaults when env unset", () => {
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.XDG_DATA_HOME;
    delete process.env.XDG_CACHE_HOME;
    expect(configDir("massa-ai")).toBe(
      path.join(os.homedir(), ".config", "massa-ai"),
    );
    expect(dataDir("massa-ai")).toBe(
      path.join(os.homedir(), ".local", "share", "massa-ai"),
    );
    expect(cacheDir("massa-ai")).toBe(
      path.join(os.homedir(), ".cache", "massa-ai"),
    );
  });
});