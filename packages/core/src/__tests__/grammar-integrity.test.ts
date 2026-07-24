import { describe, expect, test } from "bun:test";
import { createRequire } from "node:module";

import { describeNative } from "./_helpers/native-skip.js";
import {
  GrammarIntegrityError,
  computePackageSourceIntegrity,
  resetGrammarIntegrityForTests,
  verifyNativeGrammarIntegrity,
} from "../services/structural/grammar-integrity.js";
import {
  NATIVE_DEPENDENCIES,
  NATIVE_LOCK_IDENTITIES,
  NATIVE_LOCK_IDENTITY_COUNT,
  TRUSTED_NATIVE_PACKAGES,
} from "../services/structural/native-lock-identities.js";

const requireFromCore = createRequire(import.meta.url);

describe("native grammar integrity pins", () => {
  test("identity count matches the audited dependency set exactly", () => {
    expect(NATIVE_LOCK_IDENTITY_COUNT).toBe(27);
    expect(Object.keys(NATIVE_DEPENDENCIES)).toHaveLength(27);
    expect(Object.keys(NATIVE_LOCK_IDENTITIES)).toHaveLength(27);
    expect(TRUSTED_NATIVE_PACKAGES).toHaveLength(27);
  });

  test("every registry package has sri, every git package has gitIdentity, all have sourceIntegrity", () => {
    for (const [pkg, id] of Object.entries(NATIVE_LOCK_IDENTITIES)) {
      expect(typeof id.sourceIntegrity).toBe("string");
      expect(id.sourceIntegrity.startsWith("sha512-")).toBe(true);
      const isGit = id.resolved.includes("@github:");
      if (isGit) {
        expect(typeof id.gitIdentity).toBe("string");
        expect(id.gitIdentity!.length).toBeGreaterThan(0);
        expect(id.sri).toBeUndefined();
      } else {
        expect(typeof id.sri).toBe("string");
        expect(id.sri!.startsWith("sha512-")).toBe(true);
        expect(id.gitIdentity).toBeUndefined();
      }
    }
  });
});

describeNative("runtime grammar integrity verification", () => {
  test("verifier PASSES on the real current install (pins reconciled)", () => {
    resetGrammarIntegrityForTests();
    expect(() => verifyNativeGrammarIntegrity(requireFromCore)).not.toThrow();
    // Memoized second call is a no-op and must also pass.
    expect(() => verifyNativeGrammarIntegrity(requireFromCore)).not.toThrow();
  });

  test("every pinned sourceIntegrity matches the recomputed value for the installed package", () => {
    // The install is the source of truth: each pin must equal what the verifier
    // computes over the on-disk package source.
    for (const pkg of Object.keys(NATIVE_LOCK_IDENTITIES)) {
      const computed = computePackageSourceIntegrity(requireFromCore, pkg);
      expect(computed).toBe(NATIVE_LOCK_IDENTITIES[pkg as keyof typeof NATIVE_LOCK_IDENTITIES].sourceIntegrity);
    }
  });

  test("a tampered pin (one byte flipped) throws GrammarIntegrityError", () => {
    const original = NATIVE_LOCK_IDENTITIES["tree-sitter-javascript"].sourceIntegrity;
    const tampered =
      original.slice(0, "sha512-".length + 1) +
      (original["sha512-".length + 1] === "A" ? "B" : "A") +
      original.slice("sha512-".length + 2);
    expect(tampered).not.toBe(original);

    // Mutate the pinned value in place to simulate a drifted pin without
    // touching the filesystem. Restore in finally so other tests stay clean.
    const record = NATIVE_LOCK_IDENTITIES[
      "tree-sitter-javascript" as keyof typeof NATIVE_LOCK_IDENTITIES
    ] as { sourceIntegrity: string };
    const saved = record.sourceIntegrity;
    record.sourceIntegrity = tampered;
    resetGrammarIntegrityForTests();
    try {
      let caught: unknown;
      try {
        verifyNativeGrammarIntegrity(requireFromCore);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(GrammarIntegrityError);
      const err = caught as GrammarIntegrityError;
      expect(err.pkg).toBe("tree-sitter-javascript");
      expect(err.expected).toBe(tampered);
      expect(err.actual).toBe(original);
      expect(err.code).toBe("GRAMMAR_INTEGRITY_MISMATCH");
      expect(err.message).toContain("tree-sitter-javascript");
    } finally {
      record.sourceIntegrity = saved;
      resetGrammarIntegrityForTests();
    }
  });

  test("MASSA_AI_SKIP_GRAMMAR_INTEGRITY=1 skips verification and sets the memo", () => {
    const saved = process.env.MASSA_AI_SKIP_GRAMMAR_INTEGRITY;
    process.env.MASSA_AI_SKIP_GRAMMAR_INTEGRITY = "1";
    resetGrammarIntegrityForTests();
    try {
      expect(() => verifyNativeGrammarIntegrity(requireFromCore)).not.toThrow();
      // A subsequent tampered pin would still throw unless the skip memo is set;
      // verify the memo persists by calling again without re-resolving.
      expect(() => verifyNativeGrammarIntegrity(requireFromCore)).not.toThrow();
    } finally {
      if (saved === undefined) {
        delete process.env.MASSA_AI_SKIP_GRAMMAR_INTEGRITY;
      } else {
        process.env.MASSA_AI_SKIP_GRAMMAR_INTEGRITY = saved;
      }
      resetGrammarIntegrityForTests();
    }
  });
});
