import { describe, expect, test } from "bun:test";
import {
  FqnHashCollisionError,
  StructuralFqnRegistry,
  canonicalizeStructuralSignature,
  createStructuralIdentity,
  normalizeStructuralFile,
  parseStructuralFqn,
  structuralFqnDisplayName,
  type StructuralIdentityInput,
} from "../services/structural/fqn-codec.js";
import {
  SourceIndex,
  deriveLegacyLineRange,
} from "../services/structural/source-span.js";

const SOURCE = Buffer.from(
  '\uFEFF\tconst café = "😀";\r\nclass Outer {\r\n\tmethod(x: string): void {}\r\n}\n',
);

const METHOD: StructuralIdentityInput = {
  file: "src/example.ts",
  name: "method",
  qualifiedName: "Outer.method",
  language: "TypeScript",
  dialect: "TS",
  kind: "method",
  scope: "nested",
  overload: "unique",
  arity: 1,
  typeTokens: ["x: string", "void"],
  modifiers: ["PUBLIC", "async", "public"],
};

describe("SourceIndex UTF-8 span goldens", () => {
  test("owns original bytes and precomputes BOM/CRLF line starts", () => {
    const mutable = Buffer.from(SOURCE);
    const index = new SourceIndex(mutable);
    mutable.fill(0);
    expect(index.byteLength).toBe(73);
    expect(index.lineStarts()).toEqual([0, 27, 42, 71, 73]);
    expect(index.sourceBytes()).toEqual(SOURCE);
  });

  test("counts BOM, tab, accented text, and emoji in UTF-8 byte columns", () => {
    const index = new SourceIndex(SOURCE);
    expect(index.pointAt(0)).toEqual({ row: 0, column: 0 });
    expect(index.pointAt(3)).toEqual({ row: 0, column: 3 });
    expect(index.pointAt(4)).toEqual({ row: 0, column: 4 });
    expect(index.pointAt(16)).toEqual({ row: 0, column: 16 });
    expect(index.pointAt(23)).toEqual({ row: 0, column: 23 });
  });

  test("treats CRLF as one boundary spanning two bytes", () => {
    const index = new SourceIndex(SOURCE);
    expect(index.pointAt(25)).toEqual({ row: 0, column: 25 });
    expect(index.pointAt(26)).toEqual({ row: 0, column: 26 });
    expect(index.pointAt(27)).toEqual({ row: 1, column: 0 });
  });

  test("does not treat a lone carriage return as a line boundary", () => {
    const index = new SourceIndex("a\rb\n");
    expect(index.lineStarts()).toEqual([0, 4]);
    expect(index.pointAt(2)).toEqual({ row: 0, column: 2 });
  });

  test("builds end-exclusive spans and round-trips snippets by byte slice", () => {
    const index = new SourceIndex(SOURCE);
    const start = SOURCE.indexOf(Buffer.from("café"));
    const span = index.span(start, start + Buffer.byteLength("café"));
    expect(span).toEqual({
      startByte: 10,
      endByte: 15,
      start: { row: 0, column: 10 },
      end: { row: 0, column: 15 },
    });
    expect(index.snippet(span)).toBe("café");
    expect(index.snippetBytes(span)).toEqual(Buffer.from("café"));
  });

  test("rejects out-of-range, reversed, continuation-byte, and mismatched spans", () => {
    const index = new SourceIndex(SOURCE);
    expect(() => index.span(-1, 0)).toThrow("outside");
    expect(() => index.span(10, 9)).toThrow("greater than");
    expect(() => index.span(14, 15)).toThrow("UTF-8 code point");
    expect(() => index.validateSpan({
      startByte: 10,
      endByte: 15,
      start: { row: 9, column: 9 },
      end: { row: 0, column: 15 },
    })).toThrow("do not match");
  });

  test("remaps child bytes into host coordinates and recomputes both points", () => {
    const index = new SourceIndex(SOURCE);
    const host = index.span(42, 71);
    const child = new SourceIndex(index.snippetBytes(host)).span(1, 7);
    expect(index.remapChildSpan(host, child)).toEqual({
      startByte: 43,
      endByte: 49,
      start: { row: 2, column: 1 },
      end: { row: 2, column: 7 },
    });
  });

  test("rejects child spans outside or inconsistent with the host slice", () => {
    const index = new SourceIndex(SOURCE);
    const host = index.span(42, 71);
    expect(() => index.remapChildSpan(host, {
      startByte: 0,
      endByte: 30,
      start: { row: 0, column: 0 },
      end: { row: 1, column: 0 },
    })).toThrow("outside");
  });

  test("derives inclusive legacy lines at row boundaries and for empty spans", () => {
    const index = new SourceIndex(SOURCE);
    expect(deriveLegacyLineRange(index.span(27, 42))).toEqual({ lineStart: 2, lineEnd: 2 });
    expect(deriveLegacyLineRange(index.span(27, 43))).toEqual({ lineStart: 2, lineEnd: 3 });
    expect(deriveLegacyLineRange(index.span(42, 42))).toEqual({ lineStart: 3, lineEnd: 3 });
    expect(deriveLegacyLineRange(index.span(0, 73))).toEqual({ lineStart: 1, lineEnd: 4 });
  });
});

describe("versioned structural FQN codec goldens", () => {
  test("normalizes relative files but rejects absolute, drive, dot, NUL, and # paths", () => {
    expect(normalizeStructuralFile("./src\\nested//file.ts")).toBe("src/nested/file.ts");
    expect(normalizeStructuralFile("src/a  b.ts")).toBe("src/a  b.ts");
    for (const file of ["/src/a.ts", "C:\\src\\a.ts", "src/../a.ts", "src\0a.ts", "src/#a.ts"]) {
      expect(() => normalizeStructuralFile(file)).toThrow();
    }
  });

  test("preserves collision-free top-level identities and always returns legacy alias", () => {
    const identity = createStructuralIdentity({
      ...METHOD,
      name: "run",
      qualifiedName: "run",
      scope: "top_level",
      overload: "unique",
    });
    expect(identity.fqn).toBe("src/example.ts#run");
    expect(identity.legacyFqn).toBe("src/example.ts#run");
    expect(identity.aliases).toEqual(["src/example.ts#run"]);
    expect(identity.signatureHash).toMatch(/^[0-9a-f]{64}$/);
  });

  test("uses qualified kind and full lowercase SHA-256 for nested symbols", () => {
    const identity = createStructuralIdentity(METHOD);
    expect(identity.fqn).toBe(
      `src/example.ts#Outer.method~method~${identity.signatureHash}`,
    );
    expect(identity.signatureHash).toHaveLength(64);
    expect(identity.legacyFqn).toBe("src/example.ts#method");
  });

  test("hashes overloaded top-level symbols even without nesting", () => {
    const identity = createStructuralIdentity({
      ...METHOD,
      name: "parse",
      qualifiedName: "parse",
      scope: "top_level",
      overload: "overloaded",
    });
    expect(identity.fqn).toMatch(/^src\/example\.ts#parse~method~[0-9a-f]{64}$/);
  });

  test("hashes reserved-looking top-level names so primary identities round-trip", () => {
    const identity = createStructuralIdentity({
      ...METHOD,
      name: "topic~method~draft",
      qualifiedName: "topic~method~draft",
      scope: "top_level",
      overload: "unique",
    });
    expect(identity.fqn).toMatch(
      /^src\/example\.ts#topic~method~draft~method~[0-9a-f]{64}$/,
    );
    expect(parseStructuralFqn(identity.fqn)).toMatchObject({
      format: "qualified",
      qualifiedName: "topic~method~draft",
      kind: "method",
    });
    expect(identity.legacyFqn).toBe("src/example.ts#topic~method~draft");
  });

  test("canonical serialization is position-free, NFC, whitespace-normalized, and modifier-sorted", () => {
    const first = canonicalizeStructuralSignature(METHOD);
    const second = canonicalizeStructuralSignature({
      ...METHOD,
      language: "  TYPESCRIPT ",
      dialect: "ts",
      qualifiedName: "Outer.\u006dethod",
      typeTokens: ["x:   string", "void"],
      modifiers: ["async", "public"],
    });
    expect(first).toBe(second);
    expect(first).toBe(JSON.stringify({
      version: "1.0.0",
      language: "typescript",
      dialect: "ts",
      qualifiedName: "Outer.method",
      kind: "method",
      arity: 1,
      typeTokens: ["x: string", "void"],
      modifiers: ["async", "public"],
    }));
  });

  test("matches frozen canonical method serialization and full SHA-256 golden", () => {
    const identity = createStructuralIdentity({
      file: "src/outer.ts",
      name: "method",
      qualifiedName: "Outer.method",
      language: "typescript",
      dialect: "typescript",
      kind: "method",
      scope: "nested",
      overload: "unique",
      arity: 1,
      typeTokens: ["string", "void"],
      modifiers: ["public"],
    });
    expect(identity.canonicalSignature).toBe(
      '{"version":"1.0.0","language":"typescript","dialect":"typescript","qualifiedName":"Outer.method","kind":"method","arity":1,"typeTokens":["string","void"],"modifiers":["public"]}',
    );
    expect(identity.signatureHash).toBe("b738f0516b320c0125823b89b5d2877b20a3190de14eead3929695f63247023e");
    expect(identity.fqn).toBe(`src/outer.ts#Outer.method~method~${identity.signatureHash}`);
    expect(identity.legacyFqn).toBe("src/outer.ts#method");
    expect(structuralFqnDisplayName(identity.fqn)).toBe("Outer.method");
  });

  test("type-token order and case affect canonical signatures", () => {
    const original = canonicalizeStructuralSignature(METHOD);
    expect(canonicalizeStructuralSignature({ ...METHOD, typeTokens: ["void", "x: string"] })).not.toBe(original);
    expect(canonicalizeStructuralSignature({ ...METHOD, typeTokens: ["x: String", "void"] })).not.toBe(original);
  });

  test("rejects invalid arity, empty fields, invalid taxonomy, and inconsistent top-level input", () => {
    expect(() => canonicalizeStructuralSignature({ ...METHOD, arity: -1 })).toThrow("arity");
    expect(() => canonicalizeStructuralSignature({ ...METHOD, language: " " })).toThrow("empty");
    expect(() => canonicalizeStructuralSignature({ ...METHOD, kind: "bogus" as never })).toThrow("taxonomy");
    expect(() => createStructuralIdentity({ ...METHOD, scope: "top_level" })).toThrow("qualifiedName");
  });

  test("parses and displays simple and anchored modern FQNs with internal tildes", () => {
    expect(parseStructuralFqn("src/a.ts#run")).toEqual({
      format: "simple", file: "src/a.ts", name: "run",
    });
    const hash = "a".repeat(64);
    expect(parseStructuralFqn(`src/a.ts#Outer~inner.run~method~${hash}`)).toEqual({
      format: "qualified",
      file: "src/a.ts",
      qualifiedName: "Outer~inner.run",
      kind: "method",
      signatureHash: hash,
    });
    expect(structuralFqnDisplayName(`src/a.ts#Outer~inner.run~method~${hash}`)).toBe("Outer~inner.run");
  });

  test("rejects malformed modern-looking suffixes instead of treating them as legacy names", () => {
    const lowerHash = "a".repeat(64);
    const upperHash = "A".repeat(64);
    expect(() => parseStructuralFqn(`src/a.ts#run~method~${upperHash}`)).toThrow("lowercase");
    expect(() => parseStructuralFqn("src/a.ts#run~method~abc123")).toThrow("full");
    expect(() => parseStructuralFqn("src/a.ts#run~method~not-a-digest")).toThrow("SHA-256");
    expect(() => parseStructuralFqn("src/a.ts#run~method~")).toThrow("SHA-256");
    expect(() => parseStructuralFqn(`src/a.ts#run~unknown~${lowerHash}`)).toThrow("known kind");
    expect(parseStructuralFqn("src/a.ts#Outer~inner.run")).toEqual({
      format: "simple", file: "src/a.ts", name: "Outer~inner.run",
    });
  });

  test("detects distinct signatures with the same injected full digest without salting", () => {
    const digest = "0".repeat(64);
    const registry = new StructuralFqnRegistry(() => digest);
    registry.register(METHOD);
    expect(() => registry.register({ ...METHOD, arity: 2 })).toThrow(FqnHashCollisionError);
    try {
      registry.register({ ...METHOD, arity: 2 });
    } catch (error) {
      expect(error).toMatchObject({ code: "fqn_hash_collision", signatureHash: digest });
    }
  });

  test("resolves exact modern and unique legacy identities", () => {
    const registry = new StructuralFqnRegistry();
    const identity = registry.register(METHOD);
    expect(registry.register(METHOD)).toBe(identity);
    expect(registry.resolveModern(identity.fqn)).toEqual({ found: true, ambiguous: false, identity });
    expect(registry.resolveLegacy(identity.legacyFqn)).toEqual({ found: true, ambiguous: false, identity });
    expect(registry.resolve(identity.fqn)).toEqual({ found: true, ambiguous: false, identity });
  });

  test("resolves an exact simple identity before its now-ambiguous legacy alias", () => {
    const registry = new StructuralFqnRegistry();
    const exact = registry.register({
      ...METHOD,
      name: "method",
      qualifiedName: "method",
      scope: "top_level",
      overload: "unique",
    });
    registry.register(METHOD);
    expect(registry.resolve(exact.fqn)).toEqual({
      found: true, ambiguous: false, identity: exact,
    });
    expect(registry.resolveLegacy(exact.legacyFqn)).toMatchObject({
      found: false, ambiguous: true,
    });
  });

  test("returns deterministic ambiguity candidates sorted by file, qualified name, kind, and hash", () => {
    const registry = new StructuralFqnRegistry();
    const zeta = registry.register({ ...METHOD, qualifiedName: "Zeta.method", arity: 2 });
    const alpha = registry.register({ ...METHOD, qualifiedName: "Alpha.method", arity: 1 });
    const result = registry.resolveLegacy("src/example.ts#method");
    expect(result).toEqual({
      found: false,
      ambiguous: true,
      legacyFqn: "src/example.ts#method",
      candidates: [alpha, zeta].map((identity) => ({
        fqn: identity.fqn,
        file: identity.file,
        name: identity.name,
        displayName: identity.displayName,
        qualifiedName: identity.qualifiedName,
        kind: identity.kind,
        signatureHash: identity.signatureHash,
      })),
    });
    if (!result.found && result.ambiguous) {
      expect(Object.isFrozen(result.candidates)).toBe(true);
      expect(result.candidates.every(Object.isFrozen)).toBe(true);
    }
  });

  test("returns stable not-found payloads for absent modern and legacy inputs", () => {
    const registry = new StructuralFqnRegistry();
    expect(registry.resolveModern("src/missing.ts#nope")).toEqual({
      found: false, ambiguous: false, fqn: "src/missing.ts#nope",
    });
    expect(registry.resolveLegacy("src/missing.ts#nope")).toEqual({
      found: false,
      ambiguous: false,
      legacyFqn: "src/missing.ts#nope",
      candidates: [],
    });
  });
});
