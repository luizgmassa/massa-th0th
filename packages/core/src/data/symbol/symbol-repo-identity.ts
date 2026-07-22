/**
 * symbol-repo-identity.ts — SQL identity helpers (N31 split T07)
 *
 * TransactionClient type + definitionIdentityColumns +
 * generationDefinitionIdentityColumns + referenceSourceSpan. These are
 * SQL value-extraction helpers used by queries (NOT mappers). Mappers
 * live in symbol-repo-mappers.ts.
 */

import { createHash } from "node:crypto";
import { getPrismaClient } from "../../services/query/prisma-client.js";
import { parseStructuralFqn } from "../../services/structural/fqn-codec.js";
import type { SymbolDefinition, SymbolReference } from "./symbol-repo-types.js";

export type TransactionClient = Parameters<
  Parameters<ReturnType<typeof getPrismaClient>["$transaction"]>[0]
>[0];

export function definitionIdentityColumns(def: SymbolDefinition): {
  qualifiedName: string;
  canonicalSignature: string | null;
  signatureHash: string | null;
  legacyFqn: string;
  sourceSpan: Record<string, unknown> | null;
} {
  const legacyFqn = def.legacy_fqn ?? `${def.file_path}#${def.name}`;
  let parsedModern: Extract<ReturnType<typeof parseStructuralFqn>, { format: "qualified" }> | null = null;
  try {
    const parsed = parseStructuralFqn(def.id);
    if (
      parsed.format === "qualified" &&
      parsed.file === def.file_path &&
      parsed.kind === def.kind &&
      parsed.qualifiedName.split(".").at(-1) === def.name
    ) {
      parsedModern = parsed;
    }
  } catch {
    // Pre-codec legacy rows retain their compatibility fields without
    // fabricating qualified identity material.
  }
  return {
    qualifiedName: def.qualified_name ?? parsedModern?.qualifiedName ?? def.name,
    canonicalSignature: def.canonical_signature ?? null,
    signatureHash: def.signature_hash ?? parsedModern?.signatureHash ?? null,
    legacyFqn,
    sourceSpan: def.source_span ?? null,
  };
}

export function generationDefinitionIdentityColumns(def: SymbolDefinition): ReturnType<typeof definitionIdentityColumns> {
  const identity = definitionIdentityColumns(def);
  const parsed = parseStructuralFqn(def.id);
  if (parsed.file !== def.file_path) throw new TypeError(`definition_fqn_file_mismatch:${def.id}`);
  const expectedLegacyFqn = `${def.file_path}#${def.name}`;
  if (identity.legacyFqn !== expectedLegacyFqn) {
    throw new TypeError(`definition_legacy_fqn_mismatch:${def.id}`);
  }
  if (parsed.format === "simple") {
    if (parsed.name !== def.name) throw new TypeError(`definition_fqn_name_mismatch:${def.id}`);
    if (def.qualified_name !== undefined && def.qualified_name !== def.name) {
      throw new TypeError(`definition_fqn_qualified_name_mismatch:${def.id}`);
    }
    if ((def.canonical_signature === undefined) !== (def.signature_hash === undefined)) {
      throw new TypeError(`definition_simple_signature_pair_mismatch:${def.id}`);
    }
    if (def.canonical_signature !== undefined && def.signature_hash !== undefined) {
      const digest = createHash("sha256").update(def.canonical_signature, "utf8").digest("hex");
      if (digest !== def.signature_hash) throw new TypeError(`definition_fqn_signature_mismatch:${def.id}`);
    }
    return { ...identity, qualifiedName: def.name };
  }
  if (parsed.kind !== def.kind) throw new TypeError(`definition_fqn_kind_mismatch:${def.id}`);
  if (parsed.qualifiedName.split(".").at(-1) !== def.name) {
    throw new TypeError(`definition_fqn_name_mismatch:${def.id}`);
  }
  if (def.qualified_name !== undefined && def.qualified_name !== parsed.qualifiedName) {
    throw new TypeError(`definition_fqn_qualified_name_mismatch:${def.id}`);
  }
  if (def.signature_hash !== undefined && def.signature_hash !== parsed.signatureHash) {
    throw new TypeError(`definition_fqn_signature_hash_mismatch:${def.id}`);
  }
  if (def.canonical_signature !== undefined) {
    const digest = createHash("sha256").update(def.canonical_signature, "utf8").digest("hex");
    if (digest !== parsed.signatureHash) throw new TypeError(`definition_fqn_signature_mismatch:${def.id}`);
  }
  return {
    ...identity,
    qualifiedName: parsed.qualifiedName,
    signatureHash: parsed.signatureHash,
  };
}

export function referenceSourceSpan(ref: SymbolReference): Record<string, unknown> | null {
  const candidate = ref.source_span ?? ref.meta?.sourceSpan;
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) return null;
  const span = candidate as Record<string, unknown>;
  const start = span.start as Record<string, unknown> | undefined;
  const end = span.end as Record<string, unknown> | undefined;
  const integers = [span.startByte, span.endByte, start?.row, start?.column, end?.row, end?.column];
  if (!integers.every((value) => Number.isInteger(value) && (value as number) >= 0)) return null;
  if ((span.endByte as number) < (span.startByte as number)) return null;
  return span;
}