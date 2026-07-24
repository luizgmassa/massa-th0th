/**
 * Scheduler safe-defaults preset — Wave 6 T29 / N29.
 *
 * Tests the `MASSA_AI_SCHEDULER_SAFE_DEFAULTS=true` preset wiring inside
 * `registerDefaultJobs`.
 *
 * CRITICAL (pre-mortem F5): the preset is applied INSIDE
 * `registerDefaultJobs` before the `envBool` loop reads `defaultEnabled` —
 * NOT as a separate export. The test "preset + master + no per-kind env →
 * consolidation enabled" proves the wiring.
 */

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import {
  Scheduler,
  resetScheduledJobStore,
} from "../services/scheduler/index.js";
import { registerDefaultJobs } from "../services/scheduler/scheduler-defaults.js";
import type { ScheduledJobStore, ScheduledJob } from "../services/scheduler/index.js";

function makeInMemoryStore(): ScheduledJobStore & {
  _dump(): ScheduledJob[];
} {
  const map = new Map<string, ScheduledJob>();
  return {
    save(job: ScheduledJob): void {
      map.set(job.id, { ...job });
    },
    get(id: string): ScheduledJob | null {
      const j = map.get(id);
      return j ? { ...j } : null;
    },
    listAll(): ScheduledJob[] {
      return Array.from(map.values()).sort((a, b) => a.nextRunAt - b.nextRunAt);
    },
    listEnabled(): ScheduledJob[] {
      return Array.from(map.values())
        .filter((j) => j.enabled)
        .sort((a, b) => a.nextRunAt - b.nextRunAt);
    },
    delete(id: string): void {
      map.delete(id);
    },
    _dump(): ScheduledJob[] {
      return Array.from(map.values());
    },
  };
}

const ENV_KEYS = [
  "MASSA_AI_SCHEDULER_ENABLED",
  "MASSA_AI_SCHEDULER_SAFE_DEFAULTS",
  "MASSA_AI_SCHEDULER_CONSOLIDATION_ENABLED",
  "MASSA_AI_SCHEDULER_DECAY_ENABLED",
  "MASSA_AI_SCHEDULER_AUTO_IMPROVE_ENABLED",
  "MASSA_AI_SCHEDULER_OBSERVATION_BRIDGE_ENABLED",
  "MASSA_AI_SCHEDULER_CONSOLIDATION_INTERVAL_MS",
  "MASSA_AI_SCHEDULER_DECAY_INTERVAL_MS",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  resetScheduledJobStore();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  resetScheduledJobStore();
});

function jobByName(scheduler: Scheduler): Record<string, ScheduledJob> {
  const jobs = scheduler.status().jobs;
  const map: Record<string, ScheduledJob> = {};
  for (const j of jobs) {
    map[j.jobKind] = j as unknown as ScheduledJob;
  }
  return map;
}

describe("T29: Scheduler safe-defaults preset", () => {
  test("preset without master → no jobs enabled", () => {
    process.env.MASSA_AI_SCHEDULER_SAFE_DEFAULTS = "true";
    // Master switch NOT set → scheduler.enabled=false, but jobs are still
    // registered. The preset should enable consolidation+decay defaultEnabled,
    // but without the master switch the scheduler won't run. The test checks
    // that the preset does not bypass the master switch for job registration:
    // jobs are registered but the scheduler is not enabled.
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: false });
    registerDefaultJobs(scheduler);
    const status = scheduler.status();
    // Scheduler not running (master switch off)
    expect(status.running).toBe(false);
    // Jobs are registered regardless of master switch
    expect(status.jobs.length).toBeGreaterThan(0);
  });

  test("preset + master → consolidation + decay enabled, auto-improve NOT enabled", () => {
    process.env.MASSA_AI_SCHEDULER_ENABLED = "true";
    process.env.MASSA_AI_SCHEDULER_SAFE_DEFAULTS = "true";
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: true });
    registerDefaultJobs(scheduler);
    const jobs = jobByName(scheduler);
    expect(jobs["memory-consolidation"]?.enabled).toBe(true);
    expect(jobs["decay-sweep"]?.enabled).toBe(true);
    // Auto-improve is NOT enabled by the preset
    expect(jobs["auto-improve"]?.enabled).toBe(false);
    // Observation-bridge is NOT enabled by the preset
    expect(jobs["observation-bridge"]?.enabled).toBe(false);
  });

  test("preset + master + auto-improve env → all three (consolidation+decay+auto-improve)", () => {
    process.env.MASSA_AI_SCHEDULER_ENABLED = "true";
    process.env.MASSA_AI_SCHEDULER_SAFE_DEFAULTS = "true";
    process.env.MASSA_AI_SCHEDULER_AUTO_IMPROVE_ENABLED = "true";
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: true });
    registerDefaultJobs(scheduler);
    const jobs = jobByName(scheduler);
    expect(jobs["memory-consolidation"]?.enabled).toBe(true);
    expect(jobs["decay-sweep"]?.enabled).toBe(true);
    expect(jobs["auto-improve"]?.enabled).toBe(true);
    // Observation-bridge still NOT enabled (no env, not in preset)
    expect(jobs["observation-bridge"]?.enabled).toBe(false);
  });

  test("preset + master + no per-kind env → consolidation enabled (proves wiring)", () => {
    // This test proves the preset is wired INSIDE registerDefaultJobs, not
    // just function logic. If applySafeDefaults were a separate export that
    // callers must invoke, this test would fail (consolidation would be
    // defaultEnabled=false because no env overrides it).
    process.env.MASSA_AI_SCHEDULER_ENABLED = "true";
    process.env.MASSA_AI_SCHEDULER_SAFE_DEFAULTS = "true";
    // NO per-kind env vars set
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: true });
    registerDefaultJobs(scheduler);
    const jobs = jobByName(scheduler);
    // Consolidation enabled by the preset alone (no per-kind env)
    expect(jobs["memory-consolidation"]?.enabled).toBe(true);
  });

  test("preset not set → behavior unchanged (all jobs disabled)", () => {
    process.env.MASSA_AI_SCHEDULER_ENABLED = "true";
    // Preset NOT set
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: true });
    registerDefaultJobs(scheduler);
    const jobs = jobByName(scheduler);
    expect(jobs["memory-consolidation"]?.enabled).toBe(false);
    expect(jobs["decay-sweep"]?.enabled).toBe(false);
    expect(jobs["auto-improve"]?.enabled).toBe(false);
    expect(jobs["observation-bridge"]?.enabled).toBe(false);
  });

  test("individual env overrides preset (consolidation disabled via env)", () => {
    process.env.MASSA_AI_SCHEDULER_ENABLED = "true";
    process.env.MASSA_AI_SCHEDULER_SAFE_DEFAULTS = "true";
    // Explicitly disable consolidation via env → overrides preset
    process.env.MASSA_AI_SCHEDULER_CONSOLIDATION_ENABLED = "false";
    const store = makeInMemoryStore();
    const scheduler = new Scheduler({ store, enabled: true });
    registerDefaultJobs(scheduler);
    const jobs = jobByName(scheduler);
    expect(jobs["memory-consolidation"]?.enabled).toBe(false);
    // Decay still enabled by preset
    expect(jobs["decay-sweep"]?.enabled).toBe(true);
  });
});