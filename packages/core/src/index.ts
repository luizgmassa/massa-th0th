/**
 * @massa-th0th/core - Lógica de negócio do massa-th0th
 *
 * Contém tools, controllers, services, data e models
 * independente do protocolo de transporte (MCP, HTTP, etc.)
 *
 * Architecture (4 layers):
 *   tools/        → Thin MCP handlers (schema + delegation)
 *   controllers/  → Orchestration (composes services, side-effects)
 *   services/     → Domain logic (scoring, embedding, graph)
 *   data/         → Persistence (SQLite, FTS, migrations)
 */

// Tools
export * from "./tools/index.js";

// Controllers
export * from "./controllers/index.js";

// Services
export * from "./services/index.js";

// Data
export { MemoryRepository } from "./data/memory/memory-repository.js";
export { getMemoryRepository } from "./data/memory/memory-repository-factory.js";
export type {
  MemoryRow,
  InsertMemoryInput,
  SearchFilters,
} from "./data/memory/memory-repository.js";
export { getVectorStore, resetVectorStore } from "./data/vector/index.js";
export { SQLiteVectorStore } from "./data/vector/index.js";

// Phase 3 — passive lifecycle capture (hook ingestion)
export {
  SqliteObservationStore,
  MemoryObservationStore,
  getObservationStore,
  resetObservationStore,
  newObservationId,
  LIFECYCLE_EVENTS,
  OBSERVATION_CATEGORIES,
} from "./data/memory/observation-repository.js";
export type { ObservationStore } from "./data/memory/observation-repository.js";
export type {
  Observation,
  ObservationRow,
  LifecycleEventKind,
  ObservationCategory,
} from "./data/memory/observation-repository.js";
export {
  HookService,
  ValidationError,
  getHookService,
  resetHookService,
  validateEvent,
} from "./services/hooks/hook-service.js";
export type {
  IncomingEvent,
  NormalizedEvent,
  BridgeTrigger,
} from "./services/hooks/hook-service.js";
export {
  WriterQueue,
  QueueSaturatedError,
} from "./services/hooks/writer-queue.js";
// Phase 3 C1 — expanded taxonomy + compaction snapshot
export {
  extractCategory,
  CATEGORY_LABELS,
} from "./services/hooks/observation-extractor.js";
export { CompactionSnapshotService } from "./services/hooks/compaction-snapshot-service.js";
export type {
  SnapshotBuildOptions,
  SnapshotSection,
  CompactionSnapshot,
} from "./services/hooks/compaction-snapshot-service.js";

// Phase 4 — repo bootstrap (seed memories)
export {
  BootstrapService,
  getBootstrapService,
  resetBootstrapService,
  bootstrapService,
  SeedMemoriesSchema,
  scanSignals,
  summarizeWithLlm,
  ruleBasedSeed,
  storeSeeds,
  countSignals,
} from "./services/bootstrap/bootstrap-service.js";
export type {
  BootstrapSeed,
  BootstrapSignals,
  BootstrapResult,
  BootstrapOptions,
  BootstrapDeps,
  BootstrapSource,
  SeedType,
  MemoryRepoSeam,
  CentralitySource,
  GitRunner,
  SeedMemories,
} from "./services/bootstrap/bootstrap-service.js";

// Phase 6 — cross-session handoffs (G2)
export {
  SqliteHandoffStore,
  MemoryHandoffStore,
  getHandoffStore,
  resetHandoffStore,
  newHandoffId,
  HANDOFF_STATUSES,
} from "./data/handoff/handoff-repository.js";
export type {
  HandoffStore,
  HandoffRecord,
  HandoffStatus,
} from "./data/handoff/handoff-repository.js";
export {
  HandoffService,
  getHandoffService,
  resetHandoffService,
  buildHandoffMemoryInput,
  formatMemoryContent,
} from "./services/handoff/handoff-service.js";
export type {
  BeginHandoffInput,
  BeginResult,
  AcceptCancelResult,
  HandoffMemorySeam,
  HandoffDeps,
} from "./services/handoff/handoff-service.js";
export { HandoffAutoInjector } from "./services/handoff/handoff-auto-injector.js";

// Phase 5 — auto-improvement loop (G7)
export {
  SqliteProposalStore,
  MemoryProposalStore,
  getProposalStore,
  resetProposalStore,
  newProposalId,
  PROPOSAL_STATUSES,
  PROPOSAL_KINDS,
} from "./data/proposal/proposal-repository.js";
export type {
  ProposalStore,
  ProposalRecord,
  ProposalStatus,
  ProposalKind,
  ProposalPayload,
  CreateMemoryPayload,
  UpdateMemoryPayload,
  TagMemoryPayload,
} from "./data/proposal/proposal-repository.js";
export {
  AutoImproveJob,
  getAutoImproveJob,
  resetAutoImproveJob,
  autoImproveJob,
  detectPatterns,
  enrichWithLlm,
  ProposalEnrichmentSchema,
} from "./services/jobs/auto-improve-job.js";
export type {
  AutoImproveJobOptions,
  AutoImproveResult,
  ApproveRejectResult,
  PatternThresholds,
  PatternCandidate,
  MemoryApplySeam,
  ProposalEnrichment,
} from "./services/jobs/auto-improve-job.js";

// Re-export types from shared for convenience
export type { ToolResponse, IToolHandler } from "@massa-th0th/shared";
