/**
 * Phase 7b — SalienceJudge tests (auto importance on remember).
 *
 * Derives from spec R7B-01..04 + edge cases. Injects a fake LLM surface so no
 * network/config-gate is needed; the feature gate (`memory.autoImportance
 * .enabled`) is toggled via the real `config` object (this file does not mock
 * shared, mirrors query-understanding.test.ts).
 *
 * Tests assert spec OUTCOMES, never mirroring the implementation.
 */

import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { config, MemoryType } from "@th0th-ai/shared";
import {
  SalienceJudge,
  SalienceSchema,
  NEUTRAL_SALIENCE,
  type QueryLlmSurface,
} from "../services/memory/salience-judge.js";
import { _setLlmEnabledForTesting } from "../services/memory/llm-client.js";
import type { z } from "zod";

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Salience = z.infer<typeof SalienceSchema>;

function fakeSurface(
  verdict: Salience | null,
  opts: { enabled?: boolean; throws?: boolean } = {},
): QueryLlmSurface {
  return {
    object: async (_prompt, _schema) => {
      if (opts.throws) throw new Error("boom");
      if (verdict == null) return { ok: false, error: "disabled" };
      return { ok: true, value: verdict };
    },
    complete: async () => ({ ok: false, error: "unused" }),
    isEnabled: () => opts.enabled ?? true,
  };
}

const ORIGINAL_MEMORY = config.get("memory");

beforeEach(() => {
  _setLlmEnabledForTesting(true);
  config.set("memory", {
    ...ORIGINAL_MEMORY,
    autoImportance: { enabled: true },
  });
});

afterEach(() => {
  _setLlmEnabledForTesting(null);
  config.set("memory", ORIGINAL_MEMORY);
});

// ─── R7B-01: scoring via LLM ───────────────────────────────────────────────────

describe("SalienceJudge — R7B-01 LLM scoring", () => {
  test("returns the clamped LLM verdict with source=llm", async () => {
    const judge = new SalienceJudge(fakeSurface({ importance: 0.83 }));
    const { salience, source } = await judge.scoreSalience(
      "Critical auth decision",
      MemoryType.DECISION,
    );
    expect(salience).toBeCloseTo(0.83, 5);
    expect(source).toBe("llm");
  });

  test("clamps out-of-range LLM verdicts into [0,1]", async () => {
    const over = new SalienceJudge(fakeSurface({ importance: 5 } as any));
    expect((await over.scoreSalience("x", MemoryType.CRITICAL)).salience).toBe(1);
    const under = new SalienceJudge(fakeSurface({ importance: -3 } as any));
    expect((await under.scoreSalience("x", MemoryType.CRITICAL)).salience).toBe(0);
  });
});

// ─── R7B-02: degradation (the discrimination-sensor target) ───────────────────

describe("SalienceJudge — R7B degradation returns neutral 0.5", () => {
  test("feature disabled → neutral default, source=default", async () => {
    config.set("memory", {
      ...config.get("memory"),
      autoImportance: { enabled: false },
    });
    const judge = new SalienceJudge(fakeSurface({ importance: 0.99 }));
    const { salience, source } = await judge.scoreSalience(
      "x",
      MemoryType.DECISION,
    );
    expect(salience).toBe(NEUTRAL_SALIENCE);
    expect(source).toBe("default");
  });

  test("LLM disabled → neutral default", async () => {
    const judge = new SalienceJudge(
      fakeSurface({ importance: 0.99 }, { enabled: false }),
    );
    const { salience, source } = await judge.scoreSalience(
      "x",
      MemoryType.DECISION,
    );
    expect(salience).toBe(NEUTRAL_SALIENCE);
    expect(source).toBe("default");
  });

  test("LLM returns {ok:false} → neutral default", async () => {
    const judge = new SalienceJudge(fakeSurface(null));
    const { salience, source } = await judge.scoreSalience(
      "x",
      MemoryType.DECISION,
    );
    expect(salience).toBe(NEUTRAL_SALIENCE);
    expect(source).toBe("default");
  });

  test("LLM throws → neutral default (no throw escapes)", async () => {
    const judge = new SalienceJudge(
      fakeSurface({ importance: 0.99 }, { throws: true }),
    );
    const { salience, source } = await judge.scoreSalience(
      "x",
      MemoryType.DECISION,
    );
    expect(salience).toBe(NEUTRAL_SALIENCE);
    expect(source).toBe("default");
  });
});

// ─── Edge cases (spec §"Edge cases") ──────────────────────────────────────────

describe("SalienceJudge — edge cases", () => {
  test("explicit empty content → neutral default", async () => {
    const judge = new SalienceJudge(fakeSurface({ importance: 0.99 }));
    expect((await judge.scoreSalience("", MemoryType.CRITICAL)).salience).toBe(
      NEUTRAL_SALIENCE,
    );
    expect(
      (await judge.scoreSalience("   \n\t  ", MemoryType.CRITICAL)).salience,
    ).toBe(NEUTRAL_SALIENCE);
  });

  test("very long content is accepted (truncated internally, no throw)", async () => {
    const long = "x".repeat(50_000);
    const judge = new SalienceJudge(fakeSurface({ importance: 0.42 }));
    const { salience, source } = await judge.scoreSalience(
      long,
      MemoryType.PATTERN,
    );
    expect(salience).toBeCloseTo(0.42, 5);
    expect(source).toBe("llm");
  });
});

// ─── Discrimination sensor (mutant must be killed by R7B-02) ──────────────────
// The "LLM returns {ok:false} → neutral" test IS the mutant-kill: if the
// degrade guard were removed, {ok:false} would propagate the (absent) verdict
// and either throw or return NaN, breaking the .toBe(0.5) assertion.

describe("discrimination sensor — degrade guard is load-bearing", () => {
  test("removing the {ok:false} guard would NOT return a verdict (mutant kill)", async () => {
    const judge = new SalienceJudge(fakeSurface(null));
    const out = await judge.scoreSalience("real content", MemoryType.DECISION);
    expect(out.salience).toBe(0.5);
    expect(out.source).toBe("default");
  });
});
