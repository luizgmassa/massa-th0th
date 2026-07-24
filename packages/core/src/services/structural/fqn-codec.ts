import { createHash } from "node:crypto";
import {
  STRUCTURAL_FQN_SCHEMA_VERSION,
  STRUCTURAL_SYMBOL_KINDS,
  type StructuralSymbolKind,
} from "./types.js";
import { assertSchemaSupported } from "./schema-version.js";
import type { StructuralFqnCandidate } from "@massa-ai/shared";

const KIND_PATTERN = STRUCTURAL_SYMBOL_KINDS.join("|");
const MODERN_SUFFIX = new RegExp(`^(.*)~(${KIND_PATTERN})~([0-9a-f]{64})$`, "u");
const KNOWN_KIND_SUFFIX = new RegExp(`~(?:${KIND_PATTERN})~[^~]*$`, "u");
const MODERN_LIKE_SUFFIX = /~[^~]+~[0-9a-f]+$/iu;
const STRUCTURAL_KIND_SET = new Set<string>(STRUCTURAL_SYMBOL_KINDS);

export type StructuralIdentityScope = "top_level" | "nested";
export type StructuralIdentityOverload = "unique" | "overloaded";
export type SignatureDigest = (canonicalSignature: string) => string;

export interface StructuralSignatureInput {
  language: string;
  dialect: string;
  qualifiedName: string;
  kind: StructuralSymbolKind;
  arity?: number;
  typeTokens?: readonly string[];
  modifiers?: readonly string[];
}

export interface StructuralIdentityInput extends StructuralSignatureInput {
  file: string;
  name: string;
  scope: StructuralIdentityScope;
  overload: StructuralIdentityOverload;
}

export interface StructuralIdentity {
  fqn: string;
  legacyFqn: string;
  aliases: readonly [string];
  file: string;
  name: string;
  displayName: string;
  qualifiedName: string;
  kind: StructuralSymbolKind;
  canonicalSignature: string;
  signatureHash: string;
}

export type { StructuralFqnCandidate } from "@massa-ai/shared";

export type StructuralFqnResolution =
  | { found: true; ambiguous: false; identity: StructuralIdentity }
  | { found: false; ambiguous: false; fqn: string }
  | {
      found: false;
      ambiguous: false;
      legacyFqn: string;
      candidates: readonly [];
    }
  | {
      found: false;
      ambiguous: true;
      legacyFqn: string;
      candidates: readonly StructuralFqnCandidate[];
    };

export type ParsedStructuralFqn =
  | { format: "simple"; file: string; name: string }
  | {
      format: "qualified";
      file: string;
      qualifiedName: string;
      kind: StructuralSymbolKind;
      signatureHash: string;
    };

function normalizedNfcText(value: string, label: string): string {
  const normalized = value.normalize("NFC").trim();
  if (!normalized) throw new TypeError(`${label} must not be empty`);
  return normalized;
}

function normalizedSignatureText(value: string, label: string, lowercase = false): string {
  const normalized = normalizedNfcText(value, label).replace(/\s+/gu, " ");
  return lowercase ? normalized.toLocaleLowerCase("en-US") : normalized;
}

export function normalizeStructuralFile(file: string): string {
  let normalized = normalizedNfcText(file, "file").replace(/\\/gu, "/");
  if (/^[a-z]:/iu.test(normalized) || normalized.startsWith("/")) {
    throw new TypeError("file must be a relative POSIX path");
  }
  if (normalized.includes("\0") || normalized.includes("#")) {
    throw new TypeError("file contains a reserved character");
  }
  normalized = normalized.replace(/\/{2,}/gu, "/");
  if (normalized.startsWith("./")) normalized = normalized.slice(2);
  const segments = normalized.split("/");
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new TypeError("file must not contain empty or dot path segments");
  }
  return normalized;
}

function normalizeSymbolText(value: string, label: string): string {
  const normalized = normalizedNfcText(value, label);
  if (normalized.includes("#")) throw new TypeError(`${label} contains reserved #`);
  return normalized;
}

function hasReservedModernSuffix(value: string): boolean {
  return KNOWN_KIND_SUFFIX.test(value) || MODERN_LIKE_SUFFIX.test(value);
}

export function canonicalizeStructuralSignature(input: StructuralSignatureInput): string {
  if (!STRUCTURAL_KIND_SET.has(input.kind)) throw new TypeError("kind is outside structural taxonomy");
  if (input.arity !== undefined && (!Number.isInteger(input.arity) || input.arity < 0)) {
    throw new TypeError("arity must be a non-negative integer");
  }
  const typeTokens = (input.typeTokens ?? []).map((token) =>
    normalizedSignatureText(token, "type token"),
  );
  const modifiers = [...new Set((input.modifiers ?? []).map((modifier) =>
    normalizedSignatureText(modifier, "modifier", true),
  ))].sort();
  return JSON.stringify({
    version: STRUCTURAL_FQN_SCHEMA_VERSION,
    language: normalizedSignatureText(input.language, "language", true),
    dialect: normalizedSignatureText(input.dialect, "dialect", true),
    qualifiedName: normalizeSymbolText(input.qualifiedName, "qualifiedName"),
    kind: input.kind,
    arity: input.arity ?? null,
    typeTokens,
    modifiers,
  });
}

/**
 * Extract the embedded schema version from a canonical signature produced by
 * `canonicalizeStructuralSignature`. Returns `""` for any payload that does not
 * carry a parseable version field (legacy pre-version rows, malformed input, or
 * the synthetic `"persisted:<id>"` placeholder used by the ETL resolve stage).
 *
 * Read-side corruption-surface guard: callers that re-hash or compare persisted
 * canonical signatures must route the extracted version through
 * `assertCanonicalSignatureSupported` so a row written by NEWER code fails loud
 * instead of silently identity-drifting.
 */
export function decodeCanonicalSignatureVersion(canonicalSignature: string): string {
  if (!canonicalSignature || typeof canonicalSignature !== "string") return "";
  // The synthetic ETL placeholder ("persisted:<id>") and any non-JSON legacy
  // payload have no embedded version — treat them as unknown / legacy.
  if (!canonicalSignature.startsWith("{")) return "";
  try {
    const parsed = JSON.parse(canonicalSignature) as { version?: unknown };
    return typeof parsed.version === "string" ? parsed.version : "";
  } catch {
    return "";
  }
}

/**
 * Decode-and-assert for persisted canonical signatures. Throws
 * `SchemaAheadError` ONLY when the embedded version is strictly newer than the
 * running code's `STRUCTURAL_FQN_SCHEMA_VERSION`. Legacy / malformed / missing
 * versions pass through unchanged (forward-compat with old rows).
 */
export function assertCanonicalSignatureSupported(canonicalSignature: string): void {
  const embedded = decodeCanonicalSignatureVersion(canonicalSignature);
  // Empty embedded version = legacy / unknown — never throw.
  if (!embedded) return;
  assertSchemaSupported("fqn", embedded, STRUCTURAL_FQN_SCHEMA_VERSION);
}

export const sha256SignatureDigest: SignatureDigest = (canonicalSignature) =>
  createHash("sha256").update(canonicalSignature, "utf8").digest("hex");

function validateDigest(digest: string): string {
  if (!/^[0-9a-f]{64}$/u.test(digest)) {
    throw new TypeError("signature digest must be a full lowercase SHA-256 hex value");
  }
  return digest;
}

export function createStructuralIdentity(
  input: StructuralIdentityInput,
  digest: SignatureDigest = sha256SignatureDigest,
): StructuralIdentity {
  const file = normalizeStructuralFile(input.file);
  const name = normalizeSymbolText(input.name, "name");
  const qualifiedName = normalizeSymbolText(input.qualifiedName, "qualifiedName");
  if (input.scope !== "top_level" && input.scope !== "nested") {
    throw new TypeError("scope must be top_level or nested");
  }
  if (input.overload !== "unique" && input.overload !== "overloaded") {
    throw new TypeError("overload must be unique or overloaded");
  }
  if (input.scope === "top_level" && qualifiedName !== name) {
    throw new TypeError("top-level identity requires qualifiedName to equal name");
  }
  const canonicalSignature = canonicalizeStructuralSignature({ ...input, qualifiedName });
  const signatureHash = validateDigest(digest(canonicalSignature));
  const legacyFqn = `${file}#${name}`;
  const fqn = input.scope === "top_level" &&
      input.overload === "unique" &&
      !hasReservedModernSuffix(name)
    ? legacyFqn
    : `${file}#${qualifiedName}~${input.kind}~${signatureHash}`;
  return Object.freeze({
    fqn,
    legacyFqn,
    aliases: Object.freeze([legacyFqn]) as readonly [string],
    file,
    name,
    displayName: qualifiedName,
    qualifiedName,
    kind: input.kind,
    canonicalSignature,
    signatureHash,
  });
}

export function formatStructuralFqn(identity: StructuralIdentity): string {
  return identity.fqn;
}

export function parseStructuralFqn(fqn: string): ParsedStructuralFqn {
  const separator = fqn.indexOf("#");
  if (separator <= 0 || separator !== fqn.lastIndexOf("#")) {
    throw new TypeError("FQN must contain exactly one non-leading # separator");
  }
  const file = normalizeStructuralFile(fqn.slice(0, separator));
  const symbolPart = fqn.slice(separator + 1);
  if (!symbolPart) throw new TypeError("FQN symbol must not be empty");
  const modern = MODERN_SUFFIX.exec(symbolPart);
  if (!modern) {
    if (hasReservedModernSuffix(symbolPart)) {
      throw new TypeError("modern FQN suffix requires a known kind and full lowercase SHA-256");
    }
    return { format: "simple", file, name: normalizeSymbolText(symbolPart, "name") };
  }
  return {
    format: "qualified",
    file,
    qualifiedName: normalizeSymbolText(modern[1]!, "qualifiedName"),
    kind: modern[2] as StructuralSymbolKind,
    signatureHash: modern[3]!,
  };
}

export function structuralFqnDisplayName(fqn: string): string {
  const parsed = parseStructuralFqn(fqn);
  return parsed.format === "qualified" ? parsed.qualifiedName : parsed.name;
}

export class FqnHashCollisionError extends Error {
  readonly code = "fqn_hash_collision" as const;
  readonly signatureHash: string;

  constructor(signatureHash: string) {
    super(`Distinct canonical signatures produced SHA-256 ${signatureHash}`);
    this.name = "FqnHashCollisionError";
    this.signatureHash = signatureHash;
  }
}

function candidate(identity: StructuralIdentity): StructuralFqnCandidate {
  return Object.freeze({
    fqn: identity.fqn,
    file: identity.file,
    name: identity.name,
    displayName: identity.displayName,
    qualifiedName: identity.qualifiedName,
    kind: identity.kind,
    signatureHash: identity.signatureHash,
  });
}

function compareCandidates(left: StructuralFqnCandidate, right: StructuralFqnCandidate): number {
  const fields: ReadonlyArray<readonly [string, string]> = [
    [left.file, right.file],
    [left.qualifiedName, right.qualifiedName],
    [left.kind, right.kind],
    [left.signatureHash, right.signatureHash],
  ];
  for (const [leftValue, rightValue] of fields) {
    if (leftValue < rightValue) return -1;
    if (leftValue > rightValue) return 1;
  }
  return 0;
}

/** Generation-scoped identity registry with collision and ambiguity enforcement. */
export class StructuralFqnRegistry {
  readonly #digest: SignatureDigest;
  readonly #canonicalByHash = new Map<string, string>();
  readonly #identityByFqn = new Map<string, StructuralIdentity>();
  readonly #identitiesByLegacy = new Map<string, StructuralIdentity[]>();

  constructor(digest: SignatureDigest = sha256SignatureDigest) {
    this.#digest = digest;
  }

  register(input: StructuralIdentityInput): StructuralIdentity {
    const identity = createStructuralIdentity(input, this.#digest);
    const priorCanonical = this.#canonicalByHash.get(identity.signatureHash);
    if (priorCanonical !== undefined && priorCanonical !== identity.canonicalSignature) {
      throw new FqnHashCollisionError(identity.signatureHash);
    }
    this.#canonicalByHash.set(identity.signatureHash, identity.canonicalSignature);

    const priorIdentity = this.#identityByFqn.get(identity.fqn);
    if (priorIdentity && priorIdentity.canonicalSignature !== identity.canonicalSignature) {
      throw new Error(`fqn_identity_collision: ${identity.fqn}`);
    }
    if (priorIdentity) return priorIdentity;

    this.#identityByFqn.set(identity.fqn, identity);
    const aliases = this.#identitiesByLegacy.get(identity.legacyFqn) ?? [];
    aliases.push(identity);
    this.#identitiesByLegacy.set(identity.legacyFqn, aliases);
    return identity;
  }

  resolveModern(fqn: string): StructuralFqnResolution {
    const identity = this.#identityByFqn.get(fqn);
    return identity
      ? { found: true, ambiguous: false, identity }
      : { found: false, ambiguous: false, fqn };
  }

  resolveLegacy(legacyFqn: string): StructuralFqnResolution {
    const identities = this.#identitiesByLegacy.get(legacyFqn) ?? [];
    if (identities.length === 1) {
      return { found: true, ambiguous: false, identity: identities[0]! };
    }
    if (identities.length === 0) {
      return {
        found: false,
        ambiguous: false,
        legacyFqn,
        candidates: Object.freeze([]),
      };
    }
    return {
      found: false,
      ambiguous: true,
      legacyFqn,
      candidates: Object.freeze(identities.map(candidate).sort(compareCandidates)),
    };
  }

  /** Exact modern identity wins; otherwise treat input as a legacy alias. */
  resolve(fqn: string): StructuralFqnResolution {
    const modern = this.#identityByFqn.get(fqn);
    return modern
      ? { found: true, ambiguous: false, identity: modern }
      : this.resolveLegacy(fqn);
  }
}
