/**
 * Filter Validation — Wave 5 FR-18 / N16 / AD-W5-012 / AC-15.
 *
 * Pure module (no I/O): server-side revalidation of client filter hints
 * before `filterByPatterns` consumes them.
 *
 * Three guarantees:
 *  1. Cap — `include.length + exclude.length ≤ maxFilterPatterns` (default 32,
 *     env `MAX_FILTER_PATTERNS`). Exceeding → teaching error (throw).
 *  2. Glob syntax — each pattern validated via `minimatch.makeRe` try/catch.
 *     A pattern that throws or returns `false` (no usable regex) → teaching
 *     error (throw).
 *  3. Contradiction downgrade — when the SAME pattern appears in both
 *     `include` and `exclude`, the `exclude` entry is dropped and a
 *     `filter_downgrades: [{ pattern, reason }]` entry is emitted. This is
 *     observable (never silent drop both). The `include` entry survives so the
 *     pattern's files remain in results.
 *
 * The caller passes the cleaned (post-downgrade) include/exclude to
 * `filterByPatterns` and attaches `filter_downgrades` to the response (additive,
 * only when non-empty).
 */

import { minimatch } from "minimatch";
import { ToolError } from "../../tools/enum-validation.js";

/**
 * A downgrade record emitted when a contradictory pattern is reconciled.
 * Observable on the response so the caller can correct its hints.
 */
export interface FilterDowngrade {
  /** The glob pattern that was downgraded. */
  pattern: string;
  /** Why it was downgraded (human-readable). */
  reason: string;
}

/**
 * Result of {@link validateFilters}. The cleaned `include` / `exclude`
 * arrays are what `filterByPatterns` should consume. `downgrades` is
 * attached to the response when non-empty.
 */
export interface FilterValidationResult {
  include: string[];
  exclude: string[];
  downgrades: FilterDowngrade[];
}

/**
 * Default cap for include.length + exclude.length. Mirror of
 * `config.filterValidation.maxFilterPatterns` (env `MAX_FILTER_PATTERNS`).
 * Callers SHOULD pass the config value; this is the fallback when no config
 * is available (e.g. unit tests).
 */
export const DEFAULT_MAX_FILTER_PATTERNS = 32;

/**
 * Validate and clean client-supplied include/exclude filter patterns.
 *
 * @param include  client include patterns (may be undefined/empty)
 * @param exclude  client exclude patterns (may be undefined/empty)
 * @param maxFilterPatterns  cap from config.filterValidation.maxFilterPatterns
 *                           (default {@link DEFAULT_MAX_FILTER_PATTERNS})
 * @returns cleaned patterns + downgrade records
 * @throws ToolError (400) when the cap is exceeded or a glob is invalid
 */
export function validateFilters(
  include: string[] | undefined,
  exclude: string[] | undefined,
  maxFilterPatterns: number = DEFAULT_MAX_FILTER_PATTERNS,
): FilterValidationResult {
  const inc = include ? [...include] : [];
  const exc = exclude ? [...exclude] : [];

  // 1. Cap (FR-18 / AC-15): total pattern count must not exceed the limit.
  const total = inc.length + exc.length;
  if (total > maxFilterPatterns) {
    throw new ToolError(
      `filter patterns: ${total} patterns exceed the maximum of ${maxFilterPatterns} ` +
        `(include=${inc.length}, exclude=${exc.length}). ` +
        `Reduce the number of include/exclude patterns.`,
    );
  }

  // 2. Glob syntax validation (FR-18 / AC-15): minimatch.makeRe try/catch.
  //    minimatch v9 treats unclosed brackets/braces as literals rather than
  //    throwing, so we also treat a `false` return (no usable regex) as
  //    invalid. The try/catch is the spec-mandated contract; the `false`
  //    check catches the empty-pattern / degenerate case.
  for (const pattern of inc) {
    assertValidGlob(pattern, "include");
  }
  for (const pattern of exc) {
    assertValidGlob(pattern, "exclude");
  }

  // 3. Contradiction downgrade (FR-18 / AD-W5-012 / AC-15): the SAME pattern
  //    in both include AND exclude. Drop the EXCLUDE entry (never drop both
  //    silently) and emit a downgrade record so the caller sees it.
  const downgrades: FilterDowngrade[] = [];
  const includeSet = new Set(inc);
  const cleanedExclude: string[] = [];
  for (const pattern of exc) {
    if (includeSet.has(pattern)) {
      downgrades.push({
        pattern,
        reason:
          "pattern appears in both include and exclude; exclude entry dropped (include wins)",
      });
    } else {
      cleanedExclude.push(pattern);
    }
  }

  return {
    include: inc,
    exclude: cleanedExclude,
    downgrades,
  };
}

/**
 * Assert a single glob pattern is syntactically valid. Uses
 * `minimatch.makeRe` in a try/catch per the FR-18 hard constraint. A `false`
 * return (no usable regex — e.g. empty string) is also rejected.
 *
 * @throws ToolError (400) with a teaching error naming the array and pattern.
 */
function assertValidGlob(pattern: string, arrayName: string): void {
  if (typeof pattern !== "string" || pattern.length === 0) {
    throw new ToolError(
      `filter ${arrayName}: empty pattern is not a valid glob. ` +
        `Provide a non-empty glob string.`,
    );
  }
  let re: RegExp | false;
  try {
    re = minimatch.makeRe(pattern);
  } catch (err) {
    throw new ToolError(
      `filter ${arrayName}: invalid glob "${pattern}" — ` +
        `${err instanceof Error ? err.message : String(err)}.`,
    );
  }
  if (re === false) {
    throw new ToolError(
      `filter ${arrayName}: invalid glob "${pattern}" — ` +
        `minimatch could not compile a regex for this pattern.`,
    );
  }
}