/**
 * Filter Validation unit tests (Wave 5 T18 / FR-18 / N16 / AC-15).
 *
 * Validates:
 *  - Cap: include.length + exclude.length > maxFilterPatterns → teaching error.
 *  - Glob syntax: invalid glob (makeRe throws or returns false) → teaching error.
 *  - Contradiction downgrade: same pattern in both include and exclude →
 *    exclude dropped, downgrade emitted, include survives (observable, never
 *    silent drop both).
 *  - Cleaned patterns are what the caller should pass to filterByPatterns.
 *  - filter_downgrades is additive (absent when no downgrades).
 */

import { describe, expect, test } from "bun:test";
import {
  validateFilters,
  DEFAULT_MAX_FILTER_PATTERNS,
} from "../services/search/filter-validation.js";
import type { FilterDowngrade, FilterValidationResult } from "../services/search/filter-validation.js";
import { ToolError } from "../tools/enum-validation.js";

describe("filter-validation (FR-18 / AC-15)", () => {
  // ── Cap (FR-18 / AC-15: "Search with 33+ patterns is rejected") ───────────

  test("cap: 33 patterns rejected with teaching error (default max=32)", () => {
    const include = Array.from({ length: 33 }, (_, i) => `pattern${i}/**/*.ts`);
    expect(() => validateFilters(include, [])).toThrow(ToolError);
    expect(() => validateFilters(include, [])).toThrow(/exceed the maximum of 32/);
  });

  test("cap: exactly 32 patterns passes (boundary)", () => {
    const include = Array.from({ length: 16 }, (_, i) => `inc${i}/**/*.ts`);
    const exclude = Array.from({ length: 16 }, (_, i) => `exc${i}/**/*.ts`);
    const result = validateFilters(include, exclude);
    expect(result.include).toHaveLength(16);
    expect(result.exclude).toHaveLength(16);
    expect(result.downgrades).toEqual([]);
  });

  test("cap: custom maxFilterPatterns honored", () => {
    const include = ["src/**/*.ts", "lib/**/*.ts", "test/**/*.ts"];
    expect(() => validateFilters(include, [], 2)).toThrow(/exceed the maximum of 2/);
    const ok = validateFilters(include, [], 3);
    expect(ok.include).toHaveLength(3);
  });

  test("cap: error message reports include/exclude counts", () => {
    const include = Array.from({ length: 20 }, (_, i) => `i${i}/**`);
    const exclude = Array.from({ length: 20 }, (_, i) => `e${i}/**`);
    expect(() => validateFilters(include, exclude, 32)).toThrow(/include=20, exclude=20/);
  });

  // ── Glob syntax validation (FR-18 / AC-15: "invalid glob is rejected") ───

  test("glob: valid globs pass", () => {
    const result = validateFilters(["**/*.ts", "src/**", "foo/*.js"], ["dist/**"]);
    expect(result.include).toEqual(["**/*.ts", "src/**", "foo/*.js"]);
    expect(result.exclude).toEqual(["dist/**"]);
    expect(result.downgrades).toEqual([]);
  });

  test("glob: empty string pattern rejected", () => {
    expect(() => validateFilters(["", "**/*.ts"], [])).toThrow(ToolError);
    expect(() => validateFilters(["", "**/*.ts"], [])).toThrow(/empty pattern is not a valid glob/);
  });

  test("glob: empty exclude pattern rejected", () => {
    expect(() => validateFilters([], ["**/*.ts", ""])).toThrow(/empty pattern is not a valid glob/);
  });

  test("glob: error message names the array (include vs exclude)", () => {
    expect(() => validateFilters([""], [])).toThrow(/filter include:/);
    expect(() => validateFilters([], [""])).toThrow(/filter exclude:/);
  });

  // ── Contradiction downgrade (FR-18 / AD-W5-012 / AC-15) ───────────────────
  // "search with the same pattern in include and exclude returns results that
  //  include the pattern and adds a filter_downgrades entry"

  test("downgrade: same pattern in both → exclude dropped, include survives", () => {
    const result = validateFilters(["src/**/*.ts"], ["src/**/*.ts"]);
    expect(result.include).toEqual(["src/**/*.ts"]);
    expect(result.exclude).toEqual([]);
    expect(result.downgrades).toHaveLength(1);
    expect(result.downgrades[0].pattern).toBe("src/**/*.ts");
    expect(result.downgrades[0].reason).toContain("both include and exclude");
  });

  test("downgrade: non-overlapping patterns unaffected", () => {
    const result = validateFilters(["src/**/*.ts"], ["dist/**"]);
    expect(result.include).toEqual(["src/**/*.ts"]);
    expect(result.exclude).toEqual(["dist/**"]);
    expect(result.downgrades).toEqual([]);
  });

  test("downgrade: multiple contradictions each emit a downgrade record", () => {
    const include = ["a/**", "b/**", "c/**"];
    const exclude = ["a/**", "x/**", "c/**"];
    const result = validateFilters(include, exclude);
    expect(result.include).toEqual(["a/**", "b/**", "c/**"]);
    expect(result.exclude).toEqual(["x/**"]);
    expect(result.downgrades).toHaveLength(2);
    const downgradedPatterns = result.downgrades.map((d) => d.pattern).sort();
    expect(downgradedPatterns).toEqual(["a/**", "c/**"]);
  });

  test("downgrade: never silent drop both — include always survives", () => {
    const result = validateFilters(["keep-me.ts"], ["keep-me.ts"]);
    expect(result.include).toContain("keep-me.ts");
    expect(result.exclude).not.toContain("keep-me.ts");
    expect(result.downgrades).toHaveLength(1);
  });

  // ── Edge cases ───────────────────────────────────────────────────────────

  test("edge: undefined include/exclude → empty arrays, no downgrades", () => {
    const result = validateFilters(undefined, undefined);
    expect(result.include).toEqual([]);
    expect(result.exclude).toEqual([]);
    expect(result.downgrades).toEqual([]);
  });

  test("edge: empty arrays → empty result, no downgrades", () => {
    const result = validateFilters([], []);
    expect(result.include).toEqual([]);
    expect(result.exclude).toEqual([]);
    expect(result.downgrades).toEqual([]);
  });

  test("edge: default max is 32", () => {
    expect(DEFAULT_MAX_FILTER_PATTERNS).toBe(32);
  });

  test("types: FilterDowngrade + FilterValidationResult are importable (FR-26 parity)", () => {
    const d: FilterDowngrade = { pattern: "x", reason: "test" };
    const r: FilterValidationResult = { include: [], exclude: [], downgrades: [d] };
    expect(r.downgrades[0].pattern).toBe("x");
  });
});