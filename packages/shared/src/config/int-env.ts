/**
 * Integer environment-variable parsing.
 *
 * Fixes the falsy-`0` footgun shared by `Number(env) || default` idioms:
 * `Number("0")` is `0`, and `0 || default` silently replaces a legitimate
 * explicit zero with the default. Whether zero is a valid intent depends on
 * the knob, so the caller opts in via `{ allowZero }`:
 *
 *  - `{ allowZero: true }`  → honor an explicit `0` (e.g. proxy "disable
 *    timeout"). Used for `MASSA_AI_PROXY_TIMEOUT_MS`.
 *  - `{ allowZero: false }` (default) → treat `0`/negative/NaN/garbage/unset
 *    as the default (sane floor). Used for reaper interval knobs, where `0`
 *    would be catastrophic (tight loop / instant reap).
 *
 * Returns the parsed integer when finite and matches the floor rule;
 * otherwise returns `defaultValue`.
 */

export interface ParseIntEnvOptions {
  /** When true, an explicit `0` is honored. Default: false (floor to default). */
  allowZero?: boolean;
}

/**
 * Parse a positive (or non-negative when `allowZero`) integer env var.
 *
 * @param raw        The raw env value (`process.env.X`).
 * @param defaultValue Returned for unset/garbage/negative (and zero when
 *                   `allowZero` is false).
 * @param opts       `{ allowZero: true }` honors explicit `0`.
 */
export function parsePositiveIntEnv(
  raw: string | undefined,
  defaultValue: number,
  opts?: ParseIntEnvOptions,
): number {
  const allowZero = opts?.allowZero === true;
  if (raw === undefined || raw === "") return defaultValue;
  const n = Number(raw);
  if (!Number.isFinite(n)) return defaultValue;
  const floor = allowZero ? 0 : 1;
  return Number.isInteger(n) && n >= floor ? n : defaultValue;
}
