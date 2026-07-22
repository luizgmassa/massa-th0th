/**
 * Shared serializer for tool success-path responses.
 *
 * Owns two concerns that were previously inlined per-tool:
 *   1. `fields` projection (shallow + dotted walk; arrays element-wise)
 *   2. `format` encoding (json raw object | toon string)
 *
 * Contract (plan-critic boundary): wrap ONLY the success-path return of a tool.
 * Error / catch / not-found branches — including any `data:{hint}` on the error
 * branch — are returned directly and MUST NOT pass through this helper. This
 * keeps the error wire-shape byte-identical and avoids projecting/throwing on
 * partial data.
 *
 * Defaults are resolved by the CALLING tool and passed in as literals; this
 * helper never picks a default. The helper only branches on the literal
 * "toon" — anything else (including "json" or undefined) returns the raw object.
 */

import { encode as toTOON } from "@toon-format/toon";
import type { ToolResponse } from "@massa-th0th/shared";
import type {
  GroupRowsByPrefixOptions,
  GroupedResult,
  GroupedGroup,
  GroupedRow,
} from "./serialize-interfaces.js";

export interface SerializeOpts {
  format?: "json" | "toon" | "tree";
  fields?: string[];
  /**
   * Wave 5 FR-06 / N5: when `true` AND a `groupBy` field is present, the
   * helper runs `groupRowsByPrefix` and emits the grouped model (AD-W5-011).
   * `format:"tree"` implies grouped output (text-indented). `format:"json"`
   * with `grouped:true` emits the same grouped model as JSON. One shared
   * helper drives both — a mutation test asserts they change together.
   */
  grouped?: boolean;
  /**
   * Grouping options for `groupRowsByPrefix`. Required when `grouped:true`
   * or `format:"tree"` is used with array/row-shaped data.
   */
  groupBy?: GroupRowsByPrefixOptions;
}

/**
 * Project (and optionally TOON-encode / group) a tool success-path result.
 *
 * Projection runs BEFORE encoding so `fields` composes with all formats.
 *
 * `format:"tree"` (Wave 5 FR-06 / N5) emits a text-indented grouped model:
 *   group header lines (prefix + counts), then each row under it, indented.
 *   Both `tree` and `json` (with `grouped:true`) route through ONE shared
 *   `groupRowsByPrefix` helper (AD-W5-011) so a mutation in the helper
 *   changes both formats together (AC-6 mutation test).
 */
export function serializeToolResponse(
  result: unknown,
  opts: SerializeOpts = {},
): ToolResponse {
  const projected = projectFields(result, opts.fields);
  // Tree format always groups (when groupBy + array data). JSON groups only
  // when `grouped:true` is explicitly requested (additive — existing
  // format:"json" callers are unchanged).
  const wantsGrouped =
    (opts.format === "tree" || (opts.format === "json" && opts.grouped === true)) &&
    opts.groupBy &&
    Array.isArray(projected);
  if (wantsGrouped) {
    const grouped = groupRowsByPrefix(projected as GroupedRow[], opts.groupBy!);
    if (opts.format === "tree") {
      return { success: true, data: groupedToTree(grouped) };
    }
    return { success: true, data: grouped };
  }
  // `format:"tree"` without grouping: still emit text (flat tree = JSON of
  // the projected data). Keeps the contract that tree always returns a string.
  if (opts.format === "tree") {
    return { success: true, data: treeFlat(projected) };
  }
  return {
    success: true,
    data: opts.format === "toon" ? toTOON(projected) : projected,
  };
}

/**
 * Field projection per spec AC P3 / design.md §2.
 *
 * - absent/empty `fields` → full data (no projection)
 * - array `data`          → element-wise map
 * - non-object `data`     → unchanged (scalar)
 * - object `data`         → pick present keys; dotted walks via projectPath
 * - unknown key / broken midpath → silently dropped (no throw)
 */
export function projectFields(data: unknown, fields?: string[]): unknown {
  if (!fields || fields.length === 0) return data;
  if (Array.isArray(data)) {
    return data.map((e) => projectFields(e, fields));
  }
  if (data === null || typeof data !== "object") return data;

  const out: Record<string, unknown> = {};
  const src = data as Record<string, unknown>;
  for (const f of fields) {
    const [head, ...rest] = f.split(".");
    if (!(head in src)) continue; // unknown key → silently dropped
    const v = src[head];
    if (rest.length === 0) {
      // M26: if the value is an escaped JSON string, unescape and parse it
      // into a nested structure. Return the parsed value, not the string.
      out[head] = unescapeJsonField(v);
      continue;
    }
    const projected = projectPath(v, rest);
    if (projected === undefined) continue;
    // Merge when multiple dotted fields share a top-level head
    // (e.g. ["impacted.symbol","impacted.risk"] must yield both keys).
    out[head] = mergeProjection(out[head], projected);
  }
  return out;
}

/**
 * M26: Unescape an escaped JSON string and parse it into a nested structure.
 *
 * If the value is a string that looks like escaped JSON (starts with `{` or
 * `[` after unescaping, or has escaped quotes `\"`), attempt to JSON.parse it.
 * On success, return the parsed nested structure. On failure, return the
 * original value with no throw (clear error is handled by the caller).
 *
 * If the value is already an object/array, return it as-is (no re-parsing).
 * If the value is a scalar (number, boolean, null), return it as-is.
 */
export function unescapeJsonField(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value !== "string") return value;

  // Check for escaped JSON: strings containing `\"` or `{`/`[` patterns
  const trimmed = value.trim();
  if (!trimmed) return value;

  // Unescape: replace `\"` with `"` (common escaping pattern)
  let unescaped = trimmed;
  if (unescaped.includes('\\"')) {
    unescaped = unescaped.replace(/\\"/g, '"');
  }

  // Check if it looks like JSON (starts with { or [)
  if (
    (unescaped.startsWith("{") && unescaped.endsWith("}")) ||
    (unescaped.startsWith("[") && unescaped.endsWith("]"))
  ) {
    try {
      return JSON.parse(unescaped);
    } catch {
      // Not valid JSON — return the unescaped string (clearer than the escaped
      // version). The caller sees the unescaped value and can diagnose.
      return unescaped;
    }
  }

  // Not JSON-like: return the unescaped string if we unescaped it, else original
  return unescaped === trimmed ? value : unescaped;
}

/**
 * Walk the dotted remainder of a single field path and rebuild a nested
 * single-key projection. Per spec AC P3.2, projecting `["nodes.symbol"]` over
 * `nodes:[{symbol,kind,...}]` yields `{nodes:[{symbol},{symbol}]}` — each
 * element keeps ONLY the requested key, not the bare scalar.
 *
 * - arrays recurse element-wise
 * - missing midpoint / primitive midpoint → drop (return undefined, key absent)
 * - leaf returns the value; intermediate wraps under its head key
 * - merges with any prior projection sharing a segment (so
 *   `["impacted.symbol","impacted.risk"]` yields both keys per element)
 */
function projectPath(value: unknown, restKeys: string[]): unknown {
  if (restKeys.length === 0) return value;
  if (Array.isArray(value)) {
    return value.map((e) => projectPath(e, restKeys));
  }
  if (value === null || typeof value !== "object") return undefined;
  const [head, ...rest] = restKeys;
  const src = value as Record<string, unknown>;
  if (!(head in src)) return undefined;
  const child = src[head];
  if (rest.length === 0) {
    // leaf: wrap the value under its key so callers see {head: value}, not bare.
    return Array.isArray(child)
      ? child.map((e) => ({ [head]: e }))
      : { [head]: child };
  }
  const inner = projectPath(child, rest);
  if (inner === undefined) return undefined;
  return { [head]: inner };
}

/**
 * Merge two projections that share a top-level key. Two cases:
 *  - arrays → element-wise object merge (so ["impacted.symbol","impacted.risk"]
 *    yields each element with both symbol and risk)
 *  - plain objects → shallow key merge (later wins on conflict, but dotted
 *    projections target distinct sub-keys so conflicts are rare)
 *  - otherwise → later wins
 */
function mergeProjection(a: unknown, b: unknown): unknown {
  if (a === undefined) return b;
  if (Array.isArray(a) && Array.isArray(b)) {
    const len = Math.max(a.length, b.length);
    const out: unknown[] = [];
    for (let i = 0; i < len; i++) {
      out.push(mergeProjection(a[i], b[i]));
    }
    return out;
  }
  if (
    a !== null &&
    b !== null &&
    typeof a === "object" &&
    typeof b === "object" &&
    !Array.isArray(a) &&
    !Array.isArray(b)
  ) {
    return { ...(a as Record<string, unknown>), ...(b as Record<string, unknown>) };
  }
  return b;
}

// ─── Wave 5 FR-06 / N5: grouped format helper (AD-W5-011) ─────────────────────
//
// One shared `groupRowsByPrefix` helper drives BOTH `format:"tree"` (text-
// indented) and `format:"json"` (with `grouped:true`). Both encoders consume
// the same {@link GroupedResult}; a mutation test in serialize.test.ts
// asserts both formats change together when the helper is mutated (AC-6).
// Bounds: cap rows per group (50), cap groups (20), `(other)` overflow,
// exact `*_total`/`*_shown`/`*_omitted` at both row and group levels — mirrors
// the Wave 4 N4 clamp/emit pattern.

const DEFAULT_MAX_ROWS_PER_GROUP = 50;
const DEFAULT_MAX_GROUPS = 20;
const OTHER_PREFIX = "(other)";

/**
 * Group rows by a 2-segment path prefix derived from each row (or taken from
 * an explicit `qnPrefix` field). Cap rows per group + cap groups; fold
 * overflow into `(other)`. Pure: no I/O.
 *
 * @param rows  Row-shaped objects (search results, impacted symbols, refs…).
 * @param opts  Grouping options. `file` = field name holding the file path
 *              (used to derive the prefix + representative file per group);
 *              `qnPrefix` = explicit prefix field (wins over `file` when set).
 */
export function groupRowsByPrefix(
  rows: readonly GroupedRow[],
  opts: GroupRowsByPrefixOptions = {},
): GroupedResult {
  const fileField = opts.file;
  const prefixField = opts.qnPrefix;
  const maxRowsPerGroup = opts.maxRowsPerGroup ?? DEFAULT_MAX_ROWS_PER_GROUP;
  const maxGroups = opts.maxGroups ?? DEFAULT_MAX_GROUPS;

  const rowsTotal = rows.length;

  // Build groups keyed by prefix. Track representative file per group (the
  // single file when all rows in the group share one).
  type Bucket = { qnPrefix: string; rows: GroupedRow[]; files: Set<string> };
  const byPrefix = new Map<string, Bucket>();
  for (const row of rows) {
    const qnPrefix = resolvePrefix(row, prefixField, fileField);
    let bucket = byPrefix.get(qnPrefix);
    if (!bucket) {
      bucket = { qnPrefix, rows: [], files: new Set<string>() };
      byPrefix.set(qnPrefix, bucket);
    }
    bucket.rows.push(row);
    if (fileField) {
      const f = row[fileField];
      if (typeof f === "string") bucket.files.add(f);
    }
  }

  // Sort groups by row count desc, then qnPrefix asc (deterministic).
  const sortedBuckets = Array.from(byPrefix.values()).sort(
    (a, b) => b.rows.length - a.rows.length || (a.qnPrefix < b.qnPrefix ? -1 : a.qnPrefix > b.qnPrefix ? 1 : 0),
  );
  const groupsTotal = sortedBuckets.length;

  // Group cap: fold overflow into `(other)`. Keep top (maxGroups-1) buckets
  // so the `(other)` group occupies the last slot (total ≤ maxGroups).
  let emitted: Bucket[];
  let groupsOmitted = 0;
  if (sortedBuckets.length <= maxGroups) {
    emitted = sortedBuckets;
  } else {
    const head = sortedBuckets.slice(0, Math.max(1, maxGroups - 1));
    const tail = sortedBuckets.slice(Math.max(1, maxGroups - 1));
    groupsOmitted = tail.length;
    const otherRows: GroupedRow[] = [];
    const otherFiles = new Set<string>();
    for (const b of tail) {
      otherRows.push(...b.rows);
      if (fileField) for (const f of b.files) otherFiles.add(f);
    }
    const otherBucket: Bucket = {
      qnPrefix: OTHER_PREFIX,
      rows: otherRows,
      files: otherFiles,
    };
    emitted = [...head, otherBucket];
  }

  // Per-group row cap + counts.
  let rowsShown = 0;
  let rowsOmitted = 0;
  const groups: GroupedGroup[] = emitted.map((b) => {
    const shownRows = b.rows.slice(0, maxRowsPerGroup);
    const rowsShownHere = shownRows.length;
    const rowsOmittedHere = b.rows.length - rowsShownHere;
    rowsShown += rowsShownHere;
    rowsOmitted += rowsOmittedHere;
    // Representative file only when the group spans a single file.
    let file: string | undefined;
    if (fileField && b.files.size === 1) file = Array.from(b.files)[0];
    return {
      qnPrefix: b.qnPrefix,
      file,
      rows: shownRows,
      rows_shown: rowsShownHere,
      rows_omitted: rowsOmittedHere,
    };
  });

  return {
    rows_total: rowsTotal,
    rows_shown: rowsShown,
    rows_omitted: rowsOmitted,
    groups_total: groupsTotal,
    groups_shown: groups.length,
    groups_omitted: groupsOmitted,
    groups,
  };
}

/**
 * Derive a 2-segment path prefix for a row. Priority:
 *   1. Explicit `prefixField` value (when set on the row).
 *   2. `fileField` value → `twoSegmentPrefix`.
 *   3. `(other)` when neither resolves.
 */
function resolvePrefix(
  row: GroupedRow,
  prefixField: string | undefined,
  fileField: string | undefined,
): string {
  if (prefixField) {
    const v = row[prefixField];
    if (typeof v === "string" && v.length > 0) return v;
  }
  if (fileField) {
    const f = row[fileField];
    if (typeof f === "string" && f.length > 0) return twoSegmentPrefix(f);
  }
  return OTHER_PREFIX;
}

/**
 * Extract the 2-segment path prefix: drop the filename (last segment), then
 * keep up to 2 leading directory segments. Same heuristic as
 * `impact-analysis.ts#twoSegmentPrefix` so the rollup is consistent across
 * tools (FR-03 parity).
 *
 *   `path/to/file.ts`   → `path/to`
 *   `a/b/c/d.ts`        → `a/b`
 *   `src/a.ts`          → `src`
 *   `root.ts`           → `root.ts`
 */
export function twoSegmentPrefix(filePath: string): string {
  if (!filePath) return filePath;
  const slash = filePath.lastIndexOf("/");
  if (slash < 0) return filePath;
  const dir = filePath.slice(0, slash);
  const parts = dir.split("/");
  if (parts.length <= 2) return dir;
  return parts.slice(0, 2).join("/");
}

/**
 * Render a {@link GroupedResult} as a text-indented tree string (AD-W5-011).
 * Each group is a header line `prefix (shown/total rows)` followed by its
 * rows indented two spaces. Counts are surfaced so a caller can see
 * truncation without parsing JSON.
 */
export function groupedToTree(grouped: GroupedResult): string {
  const lines: string[] = [];
  lines.push(
    `rows: ${grouped.rows_shown}/${grouped.rows_total} (omitted ${grouped.rows_omitted})`,
  );
  lines.push(
    `groups: ${grouped.groups_shown}/${grouped.groups_total} (omitted ${grouped.groups_omitted})`,
  );
  for (const g of grouped.groups) {
    const fileSuffix = g.file ? `  [${g.file}]` : "";
    lines.push(
      `${g.qnPrefix} (${g.rows_shown}/${g.rows_shown + g.rows_omitted} rows)${fileSuffix}`,
    );
    for (const row of g.rows) {
      lines.push(`  ${stringifyRow(row)}`);
    }
  }
  return lines.join("\n");
}

/** Compact one-line JSON-ish rendering of a row for the tree encoder. */
function stringifyRow(row: GroupedRow): string {
  try {
    return JSON.stringify(row);
  } catch {
    return String(row);
  }
}

/**
 * Flat tree fallback (no grouping): render the projected data as a text
 * block. Arrays become one line per element; objects become a single JSON
 * line. Keeps `format:"tree"` always returning a string per the contract.
 */
function treeFlat(projected: unknown): string {
  if (Array.isArray(projected)) {
    return projected.map((r) => stringifyRow(r as GroupedRow)).join("\n");
  }
  try {
    return JSON.stringify(projected);
  } catch {
    return String(projected);
  }
}
