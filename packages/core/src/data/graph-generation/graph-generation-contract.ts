export type GraphGenerationStatus = "pending" | "active" | "failed" | "superseded";

export interface GenerationCounts {
  files: number;
  definitions: number;
  references: number;
  imports: number;
  centrality: number;
  diagnostics: number;
  recovered: number;
  hardFailures: number;
  staleFiles: number;
}

export interface GraphGenerationLease {
  projectId: string;
  generationId: string;
  leaseToken: string;
  expectedActiveGenerationId: string | null;
  fingerprint: string;
  inputSnapshotHash: string;
  expectedFilesCount: number;
  leaseExpiresAt: number;
}

export interface BeginGraphGenerationInput {
  projectId: string;
  expectedActiveGenerationId: string | null;
  fingerprint: string;
  inputSnapshotHash: string;
  expectedFilesCount: number;
  leaseTtlMs: number;
}

export type BeginGraphGenerationOutcome =
  | { status: "acquired"; lease: GraphGenerationLease }
  | { status: "busy"; generationId: string; leaseExpiresAt: number }
  | { status: "stale_active"; activeGenerationId: string | null };

export type HeartbeatGraphGenerationOutcome =
  | { status: "renewed"; leaseExpiresAt: number }
  | { status: "lease_lost" };

export type CompleteGraphGenerationOutcome =
  | { status: "complete"; counts: GenerationCounts; completedAt: number }
  | { status: "incomplete"; counts: GenerationCounts; reasons: readonly string[] }
  | { status: "lease_lost" }
  | { status: "stale_active"; activeGenerationId: string | null };

export type ActivateGraphGenerationOutcome =
  | { status: "activated"; generationId: string; supersededGenerationId: string | null; counts: GenerationCounts }
  | { status: "incomplete"; counts: GenerationCounts; reasons: readonly string[] }
  | { status: "lease_lost" }
  | { status: "stale_active"; activeGenerationId: string | null };

export type AbortGraphGenerationOutcome =
  | { status: "aborted"; generationId: string }
  | { status: "lease_lost" };

export interface CleanupSupersededOptions {
  retainedGenerationIds?: readonly string[];
}

export interface GraphGenerationRepository {
  begin(input: BeginGraphGenerationInput): Promise<BeginGraphGenerationOutcome>;
  heartbeat(lease: GraphGenerationLease, leaseTtlMs: number): Promise<HeartbeatGraphGenerationOutcome>;
  complete(lease: GraphGenerationLease): Promise<CompleteGraphGenerationOutcome>;
  activate(lease: GraphGenerationLease): Promise<ActivateGraphGenerationOutcome>;
  abort(lease: GraphGenerationLease, reason: string): Promise<AbortGraphGenerationOutcome>;
  cleanupSuperseded(projectId: string, options?: CleanupSupersededOptions): Promise<number>;
}
