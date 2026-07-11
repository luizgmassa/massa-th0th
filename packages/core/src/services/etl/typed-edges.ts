/**
 * Typed Structural Edge Extractor (D1) — TS/JS
 *
 * Best-effort regex-based extraction of typed call/control-flow edges for
 * TypeScript and JavaScript. No full AST parser; designed to be cheap and run
 * inline in the Parse stage. Inspired conceptually by codebase-memory-mcp's
 * C passes (pass_calls / pass_semantic_edges / pass_infrascan) but rewritten
 * from scratch in TS for the TS/JS language family only.
 *
 * Edge types emitted (returned as RawEdge[]):
 *   - call       : A() calls B() — caller symbol → callee name
 *   - http_call  : fetch/axios/http/GraphQL/tRPC call site → route/URL
 *   - emit       : emitter.emit('event', ...) — event producer
 *   - listen     : emitter.on('event', ...) — event consumer
 *   - data_flow  : a value flows into a call argument (param binding, best-effort)
 *
 * Caller resolution: the enclosing function/method is determined by tracking
 * the most recently declared function/method header above the call site. This
 * is heuristic (no scope tree) but captures the common case of top-level and
 * one-level-nested calls.
 */

import type { RawEdge, RawEdgeKind, RawSymbol } from "./stage-context.js";

/** All TS/JS extensions the extractor handles. */
export const TYPED_EDGE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx"]);

/** The canonical public edge-type names surfaced by the query layer. */
export const EDGE_TYPES: readonly RawEdgeKind[] = [
  "call",
  "data_flow",
  "http_call",
  "emit",
  "listen",
] as const;

// ─── Pattern fragments ─────────────────────────────────────────────────────

// A simple identifier (callee name, event name, etc.).
const IDENT = `[A-Za-z_$][A-Za-z0-9_$]*`;

// Optional member-access chain: foo.bar.baz(  OR  foo(
// Capture group 1 = the final callee name (the method or function called).
const CALLEE = `(?:${IDENT}(?:\\s*\\.\\s*))*(${IDENT})\\s*\\(`;

// String literal: 'x' | "x" | `x` — capture the inner text.
const STR = `['"\`]([^'"\`]*)['"\`]`;

// ─── Per-type extractors ───────────────────────────────────────────────────

/** HTTP/remote call sites: fetch, axios.get/post/..., http.get(...), graphql(), trpc callers. */
function extractHttpCalls(
  content: string,
  callerAtLine: (line: number) => string | undefined,
): RawEdge[] {
  const edges: RawEdge[] = [];

  // fetch('url' | "url" | `url`, ...)  OR  fetch(variable) (no literal route)
  const fetchRe = new RegExp(`\\bfetch\\s*\\(\\s*${STR}`, "g");
  let m: RegExpExecArray | null;
  while ((m = fetchRe.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "http_call",
      line,
      symbolName: "fetch",
      callerSymbol: callerAtLine(line),
      meta: { client: "fetch", route: m[1] },
    });
  }

  // axios.get('url'), axios.post('url'), http.get('url'), https.request('url'), etc.
  // Capture: client.method('url') where method ∈ get|post|put|patch|delete|request
  const methodRe = new RegExp(
    `\\b(axios|http|https|got|superagent|request)\\s*\\.\\s*(get|post|put|patch|delete|request|head|options)\\s*\\(\\s*${STR}`,
    "g",
  );
  while ((m = methodRe.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "http_call",
      line,
      symbolName: `${m[1]}.${m[2]}`,
      callerSymbol: callerAtLine(line),
      meta: { client: m[1], method: m[2], route: m[3] },
    });
  }

  // GraphQL: graphql(`query ...`), gql`...`, client.query({ query: ... })
  // Capture group 1 = the actual client token (graphql | gql) so the matched
  // name is surfaced instead of a dead fallback.
  const gqlRe = new RegExp(`\\b(graphql|gql)\\s*[(\`]`, "g");
  while ((m = gqlRe.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "http_call",
      line,
      symbolName: m[1],
      callerSymbol: callerAtLine(line),
      meta: { client: "graphql" },
    });
  }

  // tRPC: trpc.<router>.<proc>.query/mutate(...) — best-effort, no route literal.
  const trpcRe = new RegExp(`\\btrpc\\s*\\.\\s*${IDENT}(?:\\s*\\.\\s*${IDENT})*\\s*\\.(query|mutate|subscribe)\\s*\\(`, "g");
  while ((m = trpcRe.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "http_call",
      line,
      symbolName: "trpc",
      callerSymbol: callerAtLine(line),
      meta: { client: "trpc", method: m[1] },
    });
  }

  return edges;
}

/** Event emitter: obj.emit('event', ...) — producer edges. */
function extractEmits(
  content: string,
  callerAtLine: (line: number) => string | undefined,
): RawEdge[] {
  const edges: RawEdge[] = [];
  const re = new RegExp(`\\b${IDENT}\\s*\\.\\s*emit\\s*\\(\\s*${STR}`, "g");
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "emit",
      line,
      symbolName: m[1], // event name
      callerSymbol: callerAtLine(line),
      meta: { event: m[1] },
    });
  }
  return edges;
}

/** Event listener: obj.on('event', ...) / obj.addListener / obj.addEventListener. */
function extractListens(
  content: string,
  callerAtLine: (line: number) => string | undefined,
): RawEdge[] {
  const edges: RawEdge[] = [];
  // obj.on('event', ...) and obj.once('event', ...)
  const onRe = new RegExp(
    `\\b${IDENT}\\s*\\.\\s*(?:on|once|addListener|addEventListener|off|removeListener)\\s*\\(\\s*${STR}`,
    "g",
  );
  let m: RegExpExecArray | null;
  while ((m = onRe.exec(content)) !== null) {
    const line = computeLine(content, m.index);
    edges.push({
      kind: "listen",
      line,
      symbolName: m[1], // event name
      callerSymbol: callerAtLine(line),
      meta: { event: m[1] },
    });
  }
  return edges;
}

/**
 * Call edges: callee(...) where callee is an identifier (not a keyword).
 * Filters out control-flow keywords and the special HTTP/emit/listen calls
 * already captured above to avoid duplicate edges.
 */
function extractCalls(
  content: string,
  callerAtLine: (line: number) => string | undefined,
): RawEdge[] {
  const edges: RawEdge[] = [];
  // Match a call: <optional chain>.<callee>(  — capture callee.
  const callRe = new RegExp(`\\b${CALLEE}`, "g");

  const SKIP = new Set([
    "if", "for", "while", "switch", "catch", "return", "function",
    "new", "typeof", "void", "delete", "instanceof", "in", "of",
    "await", "yield", "import", "export", "from", "as",
    // HTTP/emitter clients already captured as their own edge types
    "fetch", "axios", "http", "https", "got", "superagent", "request",
    "graphql", "gql", "trpc", "emit", "on", "once", "addListener",
    "addEventListener", "off", "removeListener", "require",
    // console.* / lifecycle — not useful as call edges
    "log", "error", "warn", "info", "debug", "trace",
  ]);

  let m: RegExpExecArray | null;
  while ((m = callRe.exec(content)) !== null) {
    const callee = m[1];
    if (SKIP.has(callee)) continue;
    // Skip pure-punctuation/numeric "names"
    if (!/^[A-Za-z_$]/.test(callee)) continue;
    // Skip function/method/class DECLARATION sites (not invocations).
    if (isDeclarationSite(content, m.index, callee)) continue;

    const line = computeLine(content, m.index);
    edges.push({
      kind: "call",
      line,
      symbolName: callee,
      callerSymbol: callerAtLine(line),
    });
  }
  return edges;
}

/**
 * Best-effort data-flow edges: an identifier passed as an argument to a call.
 * Captures `callee(arg)` where arg is a bare identifier, recording the param
 * index. This is a coarse signal for "value X flows into function Y at
 * position N" — refined later by the Resolve stage (target resolution).
 */
function extractDataFlows(
  content: string,
  callerAtLine: (line: number) => string | undefined,
): RawEdge[] {
  const edges: RawEdge[] = [];
  // callee(id1, id2, ...) — capture the whole arg list, then split on top-level commas.
  const callArgsRe = new RegExp(`\\b(${IDENT})\\s*\\(([^()]*?)\\)`, "g");
  let m: RegExpExecArray | null;
  while ((m = callArgsRe.exec(content)) !== null) {
    const callee = m[1];
    const argsRaw = m[2];
    if (!argsRaw || !argsRaw.trim()) continue;
    // Skip declaration sites — they are not invocations.
    if (isDeclarationSite(content, m.index, callee)) continue;
    // Only interested in bare-identifier args (param-position binding).
    const args = splitTopLevelCommas(argsRaw);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i].trim();
      if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(arg)) {
        const line = computeLine(content, m.index);
        edges.push({
          kind: "data_flow",
          line,
          symbolName: callee,
          callerSymbol: callerAtLine(line),
          meta: { paramIndex: i, argName: arg },
        });
      }
    }
  }
  return edges;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Determine whether a call-site match is actually a function/method/class
 * DECLARATION rather than an invocation. Declarations look like:
 *   function NAME(
 *   async function NAME(
 *   class NAME(           ← constructor
 *   NAME(params): type {  ← TS method
 *   NAME(params) {        ← method/function shorthand
 *   public/private/... NAME(
 *
 * Heuristic: look at the text from the start of the line up to the match. If
 * it contains a declaration keyword, or the matched callee is the FIRST token
 * on the (trimmed) line and the line ends with `{` or `:` return-type, treat
 * it as a declaration and skip.
 */
function isDeclarationSite(content: string, matchIndex: number, callee: string): boolean {
  // Walk back to the start of the line containing matchIndex.
  let lineStart = matchIndex;
  while (lineStart > 0 && content.charCodeAt(lineStart - 1) !== 10) lineStart--;
  const lineToMatch = content.slice(lineStart, matchIndex);
  const trimmedStart = lineToMatch.trimStart();

  // Explicit declaration keywords preceding the callee on the same line.
  if (/\b(?:function|class|interface|enum|namespace|module)\s*$/.test(lineToMatch)) {
    return true;
  }
  // Modifiers + async preceding the callee (method declarations).
  if (/\b(?:public|private|protected|static|readonly|async|abstract|override|get|set)\s+[A-Za-z_$]/.test(lineToMatch) &&
      /(?:public|private|protected|static|readonly|async|abstract|override|get|set)\s*$/.test(lineToMatch.replace(new RegExp(`\\b${callee}\\s*$`), ""))) {
    return true;
  }

  // The callee is the FIRST identifier on the trimmed line AND the full line
  // looks like a declaration: `name(args) {` or `name(args): ReturnType {`.
  // Crucially, a line ending in `;` or `)` is a CALL (statement), not a decl.
  const nlIdx = content.indexOf("\n", lineStart);
  const fullLine = content.slice(lineStart, nlIdx === -1 ? undefined : nlIdx);
  const stripped = fullLine.trim();
  // Starts exactly with the callee name (method/function shorthand declaration).
  if (stripped.startsWith(callee + "(")) {
    // Declaration body opens a block: line ends with `{` (no trailing `;`).
    // Arrow functions `name(x) => ...` are NOT declarations.
    if (/=>/.test(stripped)) return false;
    if (/\{\s*$/.test(stripped)) return true;
    // TS method with return-type annotation: `name(args): Type {` or `name(args): Type;`
    if (/\)\s*:\s*[\w<>\[\],\s|&?"'{}]+\s*\{?\s*$/.test(stripped)) return true;
  }
  return false;
}

/** Split on commas that are not nested in (), [], {}. */
function splitTopLevelCommas(s: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let cur = "";
  for (const ch of s) {
    if (ch === "(" || ch === "[" || ch === "{") depth++;
    else if (ch === ")" || ch === "]" || ch === "}") depth--;
    else if (ch === "," && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out;
}

/** Convert a character offset into a 1-based line number. */
function computeLine(content: string, offset: number): number {
  let line = 1;
  for (let i = 0; i < offset && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++; // \n
  }
  return line;
}

/**
 * Build a (line → enclosing symbol name) lookup from the file's extracted
 * symbols. Returns a function that, given a 1-based line, returns the name of
 * the innermost symbol whose [lineStart, lineEnd] range contains it.
 */
function buildCallerLookup(symbols: RawSymbol[]): (line: number) => string | undefined {
  if (symbols.length === 0) return () => undefined;
  // Sort by lineStart ascending for the binary search; keep lineEnd for range check.
  const sorted = [...symbols].sort((a, b) => a.lineStart - b.lineStart);
  return (line: number): string | undefined => {
    // Linear scan from the end — small N per file, and we want the *last*
    // symbol whose range starts at or before `line` and ends at/after it.
    for (let i = sorted.length - 1; i >= 0; i--) {
      const s = sorted[i];
      if (s.lineStart <= line && line <= s.lineEnd) {
        return s.name;
      }
    }
    return undefined;
  };
}

/**
 * Extract all typed structural edges from TS/JS source.
 *
 * @param content  raw file content
 * @param symbols  symbols already extracted from this file (for caller resolution)
 * @returns        RawEdge[] — one per detected edge site
 */
export function extractTypedEdges(
  content: string,
  symbols: RawSymbol[],
): RawEdge[] {
  const callerAtLine = buildCallerLookup(symbols);
  return [
    ...extractHttpCalls(content, callerAtLine),
    ...extractEmits(content, callerAtLine),
    ...extractListens(content, callerAtLine),
    ...extractCalls(content, callerAtLine),
    ...extractDataFlows(content, callerAtLine),
  ];
}
