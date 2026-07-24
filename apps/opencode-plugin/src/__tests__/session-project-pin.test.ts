/**
 * SessionProjectPin + computePluginProjectId + agentIdOf tests
 * (T6 / HAR-04 OpenCode emitter half / HAR-06 value half).
 */

import { describe, expect, it } from "bun:test";
import fs from "fs";
import os from "os";
import path from "path";
import { spawnSync } from "child_process";
import {
  SessionProjectPin,
  computePluginProjectId,
  gitToplevelSafe,
  agentIdOf,
} from "../session-project-pin";

function makeCompute() {
  let calls = 0;
  const fn = () => {
    calls++;
    return "proj";
  };
  return { fn, count: () => calls };
}

describe("computePluginProjectId precedence", () => {
  it("explicit project id wins over git and directory", () => {
    expect(
      computePluginProjectId({
        projectId: "explicit",
        directory: "/repo/sub",
        gitToplevel: () => "/repo",
      }),
    ).toBe("explicit");
  });

  it("git toplevel basename beats directory basename", () => {
    expect(
      computePluginProjectId({
        directory: "/repo/sub",
        gitToplevel: () => "/repo",
      }),
    ).toBe("repo");
  });

  it("directory basename is the fallback when git yields nothing", () => {
    expect(
      computePluginProjectId({
        directory: "/some/plain-dir",
        gitToplevel: () => undefined,
      }),
    ).toBe("plain-dir");
  });

  it('"default" is the last resort', () => {
    expect(computePluginProjectId({})).toBe("default");
    expect(
      computePluginProjectId({ directory: "/", gitToplevel: () => undefined }),
    ).toBe("default");
  });
});

describe("SessionProjectPin memo", () => {
  it("first event computes; later events of the same session reuse the memo", () => {
    const compute = makeCompute();
    const pin = new SessionProjectPin({ computeProjectId: compute.fn });
    expect(pin.for("s1")).toBe("proj");
    expect(pin.for("s1")).toBe("proj");
    expect(pin.for("s1")).toBe("proj");
    expect(compute.count()).toBe(1);
  });

  it("distinct sessions compute independently", () => {
    const compute = makeCompute();
    const pin = new SessionProjectPin({ computeProjectId: compute.fn });
    pin.for("s1");
    pin.for("s2");
    expect(compute.count()).toBe(2);
    expect(pin.size).toBe(2);
  });

  it("events without a session id are never memoized", () => {
    const compute = makeCompute();
    const pin = new SessionProjectPin({ computeProjectId: compute.fn });
    expect(pin.for(undefined)).toBe("proj");
    expect(pin.for(undefined)).toBe("proj");
    expect(compute.count()).toBe(2);
    expect(pin.size).toBe(0);
  });

  it("memo is bounded; the oldest session is evicted at the cap", () => {
    const compute = makeCompute();
    const pin = new SessionProjectPin({ computeProjectId: compute.fn, maxSessions: 2 });
    pin.for("s1");
    pin.for("s2");
    pin.for("s3"); // evicts s1
    expect(pin.size).toBe(2);
    expect(compute.count()).toBe(3);
    pin.for("s2"); // still memoized
    expect(compute.count()).toBe(3);
    pin.for("s1"); // evicted → recompute
    expect(compute.count()).toBe(4);
  });
});

const gitAvailable =
  spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

describe("gitToplevelSafe", () => {
  it.skipIf(!gitAvailable)("returns the toplevel inside a real repo, undefined outside one", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "massa-ai-git-"));
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    expect(spawnSync("git", ["init", repo], { stdio: "ignore" }).status).toBe(0);
    expect(gitToplevelSafe(repo)).toBe(fs.realpathSync(repo));
    const plain = path.join(root, "plain");
    fs.mkdirSync(plain);
    expect(gitToplevelSafe(plain)).toBeUndefined();
  });

  it("never throws on a missing directory", () => {
    expect(
      gitToplevelSafe(path.join(os.tmpdir(), "massa-ai-does-not-exist-xyz")),
    ).toBeUndefined();
  });
});

describe("agentIdOf (HAR-06)", () => {
  it("returns the agent when the host context provides a non-empty string", () => {
    expect(agentIdOf({ agent: "build" })).toBe("build");
  });

  it("is honestly undefined when the host provides none", () => {
    expect(agentIdOf({})).toBeUndefined();
    expect(agentIdOf({ agent: "" })).toBeUndefined();
    expect(agentIdOf({ agent: 42 })).toBeUndefined();
    expect(agentIdOf(undefined)).toBeUndefined();
    expect(agentIdOf("agent")).toBeUndefined();
  });
});
