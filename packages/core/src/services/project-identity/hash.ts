import { createHash } from "node:crypto";

import type { ProjectIdentityMode, ProjectIdentityPlanMaterial } from "./contracts.js";

/**
 * Stable digest of an APPLY request's identity material. Used by the operation
 * table to detect operationId reuse with different request material. Excludes
 * every preview-derived field (expectedPlanHash) so a stale preview hash does
 * not change the request identity.
 */
export function hashProjectIdentityRequest(material: {
  mode: ProjectIdentityMode;
  sourceProjectId: string;
  targetProjectId: string;
  operationId: string;
}): string {
  return createHash("sha256")
    .update("project-identity-request:v1\n", "utf8")
    .update(canonicalProjectIdentityJson({
      mode: material.mode,
      source: material.sourceProjectId,
      target: material.targetProjectId,
      operationId: material.operationId,
    }), "utf8")
    .digest("hex");
}

type CanonicalJson = null | boolean | number | string | CanonicalJson[] | {
  [key: string]: CanonicalJson;
};

function canonicalize(value: unknown, seen: Set<object>): CanonicalJson {
  if (value === null || typeof value === "string" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new TypeError("Canonical JSON requires finite numbers");
    return Object.is(value, -0) ? 0 : value;
  }
  if (Array.isArray(value)) {
    if (seen.has(value)) throw new TypeError("Canonical JSON cannot contain cycles");
    seen.add(value);
    const result = value.map((item) => canonicalize(item, seen));
    seen.delete(value);
    return result;
  }
  if (typeof value === "object") {
    if (seen.has(value)) throw new TypeError("Canonical JSON cannot contain cycles");
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
      throw new TypeError("Canonical JSON requires plain objects");
    }
    seen.add(value);
    const result: Record<string, CanonicalJson> = {};
    for (const key of Object.keys(value).sort()) {
      const item = (value as Record<string, unknown>)[key];
      if (item === undefined) throw new TypeError("Canonical JSON cannot contain undefined");
      result[key] = canonicalize(item, seen);
    }
    seen.delete(value);
    return result;
  }
  throw new TypeError(`Canonical JSON does not support ${typeof value}`);
}

export function canonicalProjectIdentityJson(value: unknown): string {
  return JSON.stringify(canonicalize(value, new Set()));
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

export function hashProjectIdentityPlan(plan: ProjectIdentityPlanMaterial): string {
  const normalized: ProjectIdentityPlanMaterial = {
    ...plan,
    stores: [...plan.stores].sort((left, right) =>
      compareText(left.storeId, right.storeId) ||
      left.directCount - right.directCount ||
      left.adaptedCount - right.adaptedCount),
    conflicts: [...plan.conflicts].sort((left, right) =>
      compareText(left.storeId, right.storeId) ||
      compareText(left.kind, right.kind) ||
      left.count - right.count),
    unknownStores: [...plan.unknownStores].sort(compareText),
  };
  return createHash("sha256")
    .update(`project-identity-plan:v${plan.planVersion}\n`, "utf8")
    .update(canonicalProjectIdentityJson(normalized), "utf8")
    .digest("hex");
}
