import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dir, "../..");
const README_PATH = resolve(ROOT, "README.md");

function readReadme(): string {
  return readFileSync(README_PATH, "utf8");
}

/** README prose with markdown emphasis and hard newlines normalized, so phrase
 *  assertions match what a reader sees rather than the exact markdown bytes. */
function readmeProse(): string {
  return readReadme()
    .replace(/```[\s\S]*?```/g, "") // drop fenced code blocks
    .replace(/[`*]/g, "") // strip inline code/emphasis markers
    .replace(/\s+/g, " "); // collapse newlines/indentation
}

/**
 * TASK-026 docs-parity guard. Keeps the active README honest about the measured
 * polyglot structural-indexing behavior and forbids stale regex / zero-symbol
 * limitation claims from returning. Deterministic and fast (file read + scans).
 *
 *Calibration note: the forbidden-phrase scan is scoped to active user-facing
 * prose. Phrases that legitimately appear in code, identifiers, or historical
 * spec evidence are not flagged here; this test only guards the README narrative.
 */
describe("polyglot indexing docs parity", () => {
  const readme = readReadme();

  describe("required content is present", () => {
    test("has a Structural indexing section", () => {
      expect(readme).toContain("## Structural indexing");
    });

    test("documents the 33 canonical extensions", () => {
      expect(readme).toMatch(/33 canonical (source )?extensions/);
      expect(readme).toMatch(/33 extensions/);
    });

    test("documents macOS arm64 and Linux glibc x64 as the native targets", () => {
      const prose = readmeProse();
      expect(prose).toMatch(/macOS arm64/);
      expect(prose).toMatch(/Linux glibc x64/);
      expect(prose).toMatch(/ELF x86-64/);
      expect(prose).toMatch(/no musl, Alpine, Windows/);
    });

    test("documents readiness vs. liveness", () => {
      expect(readme).toMatch(/readiness/i);
      expect(readme).toMatch(/liveness/i);
      expect(readme).toContain("validateAllGrammars");
    });

    test("documents graph schema v2 / rebuild visibility", () => {
      expect(readme).toContain("generation");
      expect(readme).toContain("last-known-good");
      expect(readme).toContain("CAS");
    });

    test("documents diagnostics bounding (<=10 details, exact totals)", () => {
      const prose = readmeProse();
      expect(prose).toMatch(/at most 10/);
      expect(prose).toMatch(/exact.*totals/i);
    });

    test("documents modern + legacy FQNs and ambiguity", () => {
      expect(readme).toContain("legacy");
      expect(readme).toContain("modern");
      expect(readme).toContain("ambiguity");
      expect(readme).toContain("sha256");
    });

    test("documents embedded parsing (Vue/Markdown)", () => {
      expect(readme).toContain("embedded");
      expect(readme).toContain("Vue");
      expect(readme).toContain("Markdown");
    });
  });

  describe("verification evidence is documented", () => {
    test("lists the native verifier commands and measured numbers", () => {
      expect(readme).toContain("verify:tree-sitter-native");
      expect(readme).toContain("verify:tree-sitter-source-dist");
      expect(readme).toContain("verify:tree-sitter-package");
      expect(readme).toContain("bench:parser");
      expect(readme).toContain("structural-native-linux");
      // Measured evidence numbers from the verifier
      expect(readme).toContain("33+33 parses");
      expect(readme).toContain("27 native modules");
      expect(readme).toContain("16 MiB");
      expect(readme).toContain("Mach-O arm64");
      expect(readme).toContain("ELF x86-64");
    });

    test("documents runtime/build-helper pins", () => {
      expect(readme).toContain("1.3.11"); // Bun application runtime
      expect(readme).toContain("25.9.0"); // Node build-only helper
      expect(readme).toContain("11.14.1"); // npm
    });
  });

  describe("performance status is honest", () => {
    test("states native is correct/verified but not at parity with regex", () => {
      expect(readme).toMatch(/correct and verified/);
      expect(readme).toMatch(/not yet met|has not yet reached parity/);
      expect(readme).toMatch(/BLOCKED ON PERF|known.*tracked limitation/i);
      // Must NOT claim parity with regex
      expect(readme.toLowerCase()).not.toMatch(/native.*parity with (the )?regex/);
    });
  });

  describe("no stale regex / zero-symbol limitation claims remain", () => {
    // Forbidden in README prose: stale limitations from the pre-native regex era.
    // These phrases imply parsing does not work or produces no symbols.
    const forbiddenPhrases = [
      /zero[\s-]*symbols?/i,
      /not parsed/i,
      /regex structural/i,
      /typed[\s-]*edge extractor/i,
      /regex[\s-]*only/i,
      /no structural (indexing|parsing)/i,
      /symbols? (are|are\s+not) (?:not )?extracted via regex/i,
    ];

    test("README contains none of the forbidden stale-limitation phrases", () => {
      // Scope to the normalized narrative (code blocks + emphasis stripped) so a
      // legitimate identifier or historical reference inside an example is not
      // flagged.
      const prose = readmeProse();
      const offenders = forbiddenPhrases
        .map((re) => ({ re, match: prose.match(re) }))
        .filter((o) => o.match !== null);
      expect(offenders).toEqual([]);
    });
  });

  describe("documented extension count matches the manifest", () => {
    test("LANGUAGE_MANIFEST length is 33", () => {
      // Cross-check that the documented "33" matches the source-of-truth manifest.
      // Importing the TS module would pull the native grammar loader, so count the
      // frozen `entry(...)` declarations in the manifest source instead. The
      // manifest's own `assertLanguageManifestExhaustive()` enforces equality with
      // DEFAULT_ALLOWED_EXTENSIONS at module load; here we couple the doc's "33"
      // to that same count deterministically and without a native import.
      const manifestPath = resolve(
        ROOT,
        "packages/core/src/services/structural/language-manifest.ts",
      );
      const manifestSrc = readFileSync(manifestPath, "utf8");
      const entryCount = (manifestSrc.match(/^\s*entry\(/gm) ?? []).length;
      expect(entryCount).toBe(33);
      expect(readme).toMatch(/33/);
    });
  });
});
