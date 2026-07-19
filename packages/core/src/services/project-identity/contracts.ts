import { z } from "zod";

import { ProjectIdentityError } from "./errors.js";

export const PROJECT_IDENTITY_PLAN_VERSION = 1 as const;
export const PROJECT_IDENTITY_MAX_PROJECT_ID_LENGTH = 255;

const ProjectIdSchema = z.string()
  .trim()
  .min(1)
  .max(PROJECT_IDENTITY_MAX_PROJECT_ID_LENGTH)
  .refine((value) => !value.includes("\0"), "Project IDs cannot contain NUL bytes");

const OperationIdSchema = z.string()
  .trim()
  .min(1)
  .max(255)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/);

const PlanHashSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const ProjectIdentityModeSchema = z.enum(["rename", "merge"]);
export type ProjectIdentityMode = z.infer<typeof ProjectIdentityModeSchema>;

const BaseRequestShape = {
  mode: ProjectIdentityModeSchema,
  sourceProjectId: ProjectIdSchema,
  targetProjectId: ProjectIdSchema,
} as const;

export const ProjectIdentityPreviewRequestSchema = z.object({
  ...BaseRequestShape,
  dryRun: z.literal(true).default(true),
}).strict().superRefine((request, context) => {
  if (request.sourceProjectId === request.targetProjectId) {
    context.addIssue({
      code: "custom",
      path: ["targetProjectId"],
      message: "Source and target project IDs must differ",
    });
  }
});

export const ProjectIdentityApplyRequestSchema = z.object({
  ...BaseRequestShape,
  dryRun: z.literal(false),
  operationId: OperationIdSchema,
  expectedPlanHash: PlanHashSchema,
}).strict().superRefine((request, context) => {
  if (request.sourceProjectId === request.targetProjectId) {
    context.addIssue({
      code: "custom",
      path: ["targetProjectId"],
      message: "Source and target project IDs must differ",
    });
  }
});

export type ProjectIdentityPreviewRequest = z.infer<
  typeof ProjectIdentityPreviewRequestSchema
>;
export type ProjectIdentityPreviewInput = z.input<
  typeof ProjectIdentityPreviewRequestSchema
>;
export type ProjectIdentityApplyRequest = z.infer<
  typeof ProjectIdentityApplyRequestSchema
>;
export type ProjectIdentityApplyInput = z.input<
  typeof ProjectIdentityApplyRequestSchema
>;

export interface ProjectIdentityStoreCount {
  storeId: string;
  directCount: number;
  adaptedCount: number;
}

export interface ProjectIdentityConflict {
  storeId: string;
  kind: "key_collision" | "semantic_conflict" | "malformed_payload";
  count: number;
}

/** Hash input. Arrays must already be in deterministic store/kind order. */
export interface ProjectIdentityPlanMaterial {
  planVersion: typeof PROJECT_IDENTITY_PLAN_VERSION;
  mode: ProjectIdentityMode;
  sourceProjectId: string;
  targetProjectId: string;
  sourceCanonicalRoot: string;
  targetCanonicalRoot: string | null;
  stores: readonly ProjectIdentityStoreCount[];
  conflicts: readonly ProjectIdentityConflict[];
  unknownStores: readonly string[];
  /** Digest of relevant source and target row material; detects changes without exposing it. */
  storageFingerprint?: string;
}

export interface ProjectIdentityPreview extends ProjectIdentityPlanMaterial {
  dryRun: true;
  planHash: string;
}

export interface ProjectIdentityApplyResult {
  mode: ProjectIdentityMode;
  dryRun: false;
  operationId: string;
  sourceProjectId: string;
  targetProjectId: string;
  sourceCanonicalRoot: string;
  targetCanonicalRoot: string;
  planHash: string;
  stores: readonly ProjectIdentityStoreCount[];
  committedAt: string;
}

export interface ProjectIdentityService {
  preview(request: ProjectIdentityPreviewInput): Promise<ProjectIdentityPreview>;
  apply(request: ProjectIdentityApplyInput): Promise<ProjectIdentityApplyResult>;
}

/**
 * Query client that also owns a transaction lifecycle. Apply receives one of
 * these inside `withIdentityTransaction`; the body must COMMIT or ROLLBACK via
 * the client. Kept as an interface so tests can substitute a transaction-aware
 * fake without a real PostgreSQL connection.
 */
export interface ProjectIdentityTransactionClient {
  query<Row = Record<string, unknown>>(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: Row[] }>;
  /** SELECT setval('BEGIN') semantics — begin is implicit on the pooled client. */
  beginTransaction(): Promise<void>;
  commitTransaction(): Promise<void>;
  rollbackTransaction(): Promise<void>;
}

function parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw new ProjectIdentityError("INVALID_PROJECT_IDENTITY_REQUEST", {
      cause: parsed.error,
    });
  }
  return parsed.data;
}

export function parseProjectIdentityPreviewRequest(
  input: unknown,
): ProjectIdentityPreviewRequest {
  return parseRequest(ProjectIdentityPreviewRequestSchema, input);
}

export function parseProjectIdentityApplyRequest(
  input: unknown,
): ProjectIdentityApplyRequest {
  return parseRequest(ProjectIdentityApplyRequestSchema, input);
}
