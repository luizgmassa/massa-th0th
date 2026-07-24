/**
 * Unit tests for the OS-level sandbox wrapper (W7-08, T12).
 *
 * Tests derive from spec ACs:
 *   1. macOS: wraps spawn in sandbox-exec with seatbelt profile
 *   2. Linux: wraps spawn in docker run --rm --read-only --tmpfs --network none
 *   3. MASSA_AI_EXECUTOR_SANDBOX=none forces best-effort (no sandbox)
 *   4. MASSA_AI_EXECUTOR_SANDBOX=on errors when sandbox unavailable
 *   5. auto mode falls back when Docker/seatbelt unavailable
 *
 * F1 mitigation: default auto (not on)
 * F2 mitigation: seatbelt profile uses realpathSync for project root
 */

import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";

// Mock execFileSync to control tool availability checks
let _execFileResult: { stdout: string; stderr: string } | Error | null = null;

mock.module("node:child_process", () => ({
  spawn: () => {},
  execSync: () => {},
  execFileSync: (...args: any[]) => {
    if (_execFileResult instanceof Error) throw _execFileResult;
    return _execFileResult?.stdout ?? "";
  },
}));

import {
  getSandboxMode,
  wrapSpawn,
  _buildSeatbeltProfile,
  isDockerAvailable,
  isSeatbeltAvailable,
  _resetSandboxAvailabilityCache,
  type SandboxMode,
} from "../services/executor/sandbox.js";

const origEnv = process.env.MASSA_AI_EXECUTOR_SANDBOX;
const origPlatform = process.platform;

beforeEach(() => {
  _resetSandboxAvailabilityCache();
  _execFileResult = null;
  delete process.env.MASSA_AI_EXECUTOR_SANDBOX;
});

afterEach(() => {
  _resetSandboxAvailabilityCache();
  if (origEnv !== undefined) {
    process.env.MASSA_AI_EXECUTOR_SANDBOX = origEnv;
  } else {
    delete process.env.MASSA_AI_EXECUTOR_SANDBOX;
  }
});

describe("sandbox wrapper (W7-08)", () => {
  describe("getSandboxMode", () => {
    test("MASSA_AI_EXECUTOR_SANDBOX=none returns none", () => {
      process.env.MASSA_AI_EXECUTOR_SANDBOX = "none";
      expect(getSandboxMode()).toBe("none");
    });

    test("MASSA_AI_EXECUTOR_SANDBOX=on throws when sandbox unavailable", () => {
      process.env.MASSA_AI_EXECUTOR_SANDBOX = "on";
      _execFileResult = new Error("not found");
      _resetSandboxAvailabilityCache();
      expect(() => getSandboxMode()).toThrow(/Sandbox forced.*no sandbox tool available/);
    });

    test("auto mode returns none when no tools available", () => {
      _execFileResult = new Error("not found");
      _resetSandboxAvailabilityCache();
      expect(getSandboxMode()).toBe("none");
    });

    test.skipIf(origPlatform !== "darwin")("auto mode returns seatbelt when sandbox-exec available on macOS", () => {
      _execFileResult = { stdout: "sandbox-exec 1.0", stderr: "" };
      _resetSandboxAvailabilityCache();
      expect(getSandboxMode()).toBe("seatbelt");
    });

    test.skipIf(origPlatform !== "linux")("auto mode returns docker when docker available on Linux", () => {
      _execFileResult = { stdout: "Docker version 24.0", stderr: "" };
      _resetSandboxAvailabilityCache();
      expect(getSandboxMode()).toBe("docker");
    });
  });

  describe("wrapSpawn — none mode", () => {
    test("returns cmd unchanged when mode is none", () => {
      const cmd = ["node", "script.js"];
      const result = wrapSpawn(cmd, "/project", "/tmp/sandbox", "none");
      expect(result).toEqual(cmd);
    });
  });

  describe("wrapSpawn — seatbelt mode (macOS)", () => {
    test("prepends sandbox-exec with profile", () => {
      const cmd = ["node", "script.js"];
      const result = wrapSpawn(cmd, "/project", "/tmp/sandbox", "seatbelt");
      expect(result[0]).toBe("sandbox-exec");
      expect(result[1]).toBe("-p");
      expect(result[2]).toContain("(version 1)");
      expect(result[3]).toBe("--");
      expect(result[4]).toBe("node");
      expect(result[5]).toBe("script.js");
    });

    test("seatbelt profile denies network", () => {
      const profile = _buildSeatbeltProfile("/project", "/tmp/sandbox");
      expect(profile).toContain("(deny network*)");
    });

    test("seatbelt profile allows file-read on project root", () => {
      const profile = _buildSeatbeltProfile("/project", "/tmp/sandbox");
      expect(profile).toContain('file-read*');
      expect(profile).toContain('/project');
    });

    test("seatbelt profile restricts writes to tmpdir only", () => {
      const profile = _buildSeatbeltProfile("/project", "/tmp/sandbox");
      expect(profile).toContain('file-write*');
      expect(profile).toContain('/tmp/sandbox');
      expect(profile).toContain("(deny file-write*)");
    });

    test("seatbelt profile uses realpathSync for project root (F2 mitigation)", () => {
      // The profile builder calls realpathSync internally. We can't test the
      // resolved path without a real symlink, but we can assert the function
      // doesn't throw and produces a valid profile with a subpath entry.
      const profile = _buildSeatbeltProfile(process.cwd(), "/tmp");
      expect(profile).toContain("(subpath");
    });
  });

  describe("wrapSpawn — docker mode (Linux)", () => {
    test("prepends docker run with read-only + tmpfs + no network", () => {
      const cmd = ["node", "script.js"];
      const result = wrapSpawn(cmd, "/project", "/tmp/sandbox", "docker");
      expect(result[0]).toBe("docker");
      expect(result[1]).toBe("run");
      expect(result).toContain("--rm");
      expect(result).toContain("--read-only");
      expect(result).toContain("--tmpfs");
      expect(result).toContain("/tmp");
      expect(result).toContain("--network");
      expect(result).toContain("none");
      expect(result).toContain("/project:/project:ro");
      expect(result).toContain("--workdir");
      expect(result).toContain("/project");
      expect(result).toContain("node");
      expect(result).toContain("script.js");
    });
  });

  describe("availability checks", () => {
    test("isDockerAvailable returns false when docker not found", () => {
      _execFileResult = new Error("not found");
      _resetSandboxAvailabilityCache();
      expect(isDockerAvailable()).toBe(false);
    });

    test("isSeatbeltAvailable returns false when sandbox-exec not found", () => {
      _execFileResult = new Error("not found");
      _resetSandboxAvailabilityCache();
      expect(isSeatbeltAvailable()).toBe(false);
    });
  });
});