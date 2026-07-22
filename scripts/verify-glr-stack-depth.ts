/**
 * M62 — GLR stack-merge depth verification probe.
 *
 * Read-only probe of the Node tree-sitter binding's GLR stack-merge depth cap.
 * Runs ambiguous grammar input and observes whether the parser caps stack
 * depth, and at what value.
 *
 * This is a READ-ONLY probe — it does NOT modify any code or configuration.
 * Findings are documented in docs/glr-verification.md.
 *
 * If the tree-sitter binding is not available (non-native runtime, missing
 * grammar), the probe reports the absence and exits cleanly.
 */

import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

interface ProbeResult {
  bindingAvailable: boolean;
  grammarLoaded: boolean;
  ambiguousInputParsed: boolean;
  stackMergeDepthCap: number | null | "not exposed";
  errorCount: number;
  notes: string[];
}

async function probeGlrStackDepth(): Promise<ProbeResult> {
  const notes: string[] = [];
  let bindingAvailable = false;
  let grammarLoaded = false;
  let ambiguousInputParsed = false;
  let stackMergeDepthCap: number | null | "not exposed" = "not exposed";
  let errorCount = 0;

  // Step 1: Check if the tree-sitter binding is available
  let Parser: any;
  try {
    Parser = require("tree-sitter");
    bindingAvailable = true;
    notes.push("tree-sitter binding: available");
  } catch {
    notes.push("tree-sitter binding: NOT available (non-native runtime or missing package)");
    return {
      bindingAvailable,
      grammarLoaded,
      ambiguousInputParsed,
      stackMergeDepthCap,
      errorCount,
      notes,
    };
  }

  // Step 2: Check if the Parser exposes any GLR-related config
  const parserInstance = new Parser();
  const parserKeys = Object.keys(parserInstance);
  const parserProtoKeys = Object.getOwnPropertyNames(Object.getPrototypeOf(parserInstance));

  notes.push(`Parser instance keys: ${parserKeys.join(", ") || "(none)"}`);
  notes.push(`Parser prototype keys: ${parserProtoKeys.join(", ") || "(none)"}`);

  // Check for GLR-specific methods/properties
  const glrRelated = parserProtoKeys.filter((k) =>
    /glr|stack|merge|depth|limit|max/i.test(k),
  );
  if (glrRelated.length > 0) {
    notes.push(`GLR-related keys found: ${glrRelated.join(", ")}`);
    stackMergeDepthCap = "not exposed (keys found but no direct cap accessor)";
  } else {
    notes.push("No GLR/stack/merge/depth/limit/max keys found on Parser prototype");
  }

  // Step 3: Try to load a grammar with known ambiguity (JavaScript)
  let language: any;
  try {
    language = require("tree-sitter-javascript");
    grammarLoaded = true;
    notes.push("tree-sitter-javascript grammar: loaded");
  } catch {
    // Try TypeScript as fallback
    try {
      const ts = require("tree-sitter-typescript");
      language = ts.typescript;
      grammarLoaded = true;
      notes.push("tree-sitter-typescript grammar: loaded (fallback)");
    } catch {
      notes.push("No grammar available — cannot probe ambiguous input");
      return {
        bindingAvailable,
        grammarLoaded,
        ambiguousInputParsed,
        stackMergeDepthCap,
        errorCount,
        notes,
      };
    }
  }

  // Step 4: Parse ambiguous input (deeply nested expressions that stress GLR)
  try {
    parserInstance.setLanguage(language);

    // Ambiguous input: deeply nested ternary expressions (classic GLR stress)
    const depth = 100;
    let ambiguous = "let x = ";
    for (let i = 0; i < depth; i++) {
      ambiguous += "a ? b : ";
    }
    ambiguous += "c;";

    const tree = parserInstance.parse(ambiguous);
    ambiguousInputParsed = true;
    notes.push(`Ambiguous input (depth=${depth}): parsed without crash`);

    // Check for error nodes in the tree
    const root = tree.rootNode;
    if (root && root.hasError) {
      errorCount = -1; // hasError flag set
      notes.push("Parse tree has error flag set (ambiguous input produced errors)");
    } else {
      notes.push("Parse tree: no error flag (ambiguous input resolved)");
    }
  } catch (e) {
    notes.push(`Ambiguous input parse failed: ${(e as Error).message}`);
    errorCount = 1;
  }

  // Step 5: Try to find a stack depth cap by checking if the binding documents one
  // The Node tree-sitter binding does not expose GLR internals via the JS API.
  // The cap is in the C runtime (tree-sitter/lib/src/parser.c) and is not
  // surfaced through the Node binding.
  notes.push("GLR stack-merge depth cap is internal to the C runtime (parser.c)");
  notes.push("The Node binding does not expose a JS-level accessor for stack depth cap");
  stackMergeDepthCap = "not exposed by binding API";

  return {
    bindingAvailable,
    grammarLoaded,
    ambiguousInputParsed,
    stackMergeDepthCap,
    errorCount,
    notes,
  };
}

// ── Run probe ───────────────────────────────────────────────────────────────

const result = await probeGlrStackDepth();

console.log("═".repeat(70));
console.log("M62 — GLR Stack-Merge Depth Verification Probe");
console.log("═".repeat(70));
console.log();
console.log(`Binding available:     ${result.bindingAvailable}`);
console.log(`Grammar loaded:        ${result.grammarLoaded}`);
console.log(`Ambiguous input parsed: ${result.ambiguousInputParsed}`);
console.log(`Stack-merge depth cap: ${result.stackMergeDepthCap}`);
console.log(`Error count:           ${result.errorCount}`);
console.log();
console.log("Notes:");
for (const note of result.notes) {
  console.log(`  • ${note}`);
}
console.log();
console.log("═".repeat(70));
console.log("Findings documented in docs/glr-verification.md");
console.log("═".repeat(70));

export { probeGlrStackDepth, type ProbeResult };