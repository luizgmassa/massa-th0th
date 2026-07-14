/**
 * @massa-th0th/core - Services Export
 */

// Search
export { ContextualSearchRLM } from "./search/contextual-search-rlm.js";
export { SearchCachePg } from "./search/search-cache-pg.js";
export { getSearchCache } from "./search/cache-factory.js";
export { SearchAnalyticsPg } from "./search/search-analytics-pg.js";
export { IndexManager } from "./search/index-manager.js";

// Cache
export { L1MemoryCache } from "./cache/l1-memory-cache.js";
export { EmbeddingCachePg } from "./cache/embedding-cache-pg.js";

// Compression
export { CodeCompressor } from "./compression/code-compressor.js";

// Embeddings
export {
  createEmbeddingProvider,
  checkProviderAvailability,
} from "./embeddings/index.js";
export type { EmbeddingProvider } from "./embeddings/provider.js";

// Health (local-first)
export {
  LocalHealthChecker,
  getHealthChecker,
} from "./health/local-health-checker.js";
export type {
  LocalHealthReport,
  ServiceStatus,
} from "./health/local-health-checker.js";

// Jobs (async indexing job tracker + stale-job reaper)
export { IndexJobTracker, indexJobTracker } from "./jobs/index-job-tracker.js";
export type { IndexJob } from "./jobs/index-job-tracker.js";

// Scheduler (in-process cron-like scheduler for clock-triggered jobs)
export {
  Scheduler,
  getScheduler,
  resetScheduler,
  getScheduledJobStore,
  resetScheduledJobStore,
  registerDefaultJobs,
  parseCron,
  nextCronRun,
} from "./scheduler/index.js";
export type {
  SchedulerOptions,
  ScheduledJobStore,
  JobHandler,
  JobKind,
  ScheduledJob as ScheduledJobDef,
  ScheduleSpec,
  SchedulerStatus,
  TickResult,
  ParsedCron,
} from "./scheduler/index.js";

// Pricing (local-first with cache)
export {
  ModelsDevClient,
  getModelsDevClient,
} from "./pricing/models-dev-client.js";
export type { ModelPricing } from "./pricing/models-dev-client.js";

// Graph (knowledge graph over memories)
export { MemoryGraphService } from "./graph/memory-graph.service.js";
export { GraphStorePg } from "./graph/graph-store-pg.js";
export { GraphQueries } from "./graph/graph-queries.js";
export { RelationExtractor } from "./graph/relation-extractor.js";
export type {
  MemoryRow as GraphMemoryRow,
  MemoryRowWithEmbedding,
  RelatedMemory,
} from "./graph/types.js";

// Memory (domain service + quality)
export { MemoryService } from "./memory/memory-service.js";
export type { Memory, ScoredMemory } from "./memory/memory-service.js";
export { RedundancyFilter } from "./memory/redundancy-filter.js";
export type { DuplicatePair, MergeResult, CleanupStats } from "./memory/redundancy-filter.js";
export { MemoryClustering } from "./memory/memory-clustering.js";
export type { MemoryCluster, ClusteringResult } from "./memory/memory-clustering.js";

// Checkpoint (task state persistence)
export { CheckpointManager } from "./checkpoint/checkpoint-manager.js";
export type { CheckpointMetadata } from "./checkpoint/checkpoint-manager.js";
export { AutoCheckpointer } from "./checkpoint/auto-checkpointer.js";
export type { AutoCheckpointerOptions, CheckpointTrigger } from "./checkpoint/auto-checkpointer.js";

// Context (session-scoped delivery optimizations)
export { SessionFileCache, REFERENCE_TOKEN_COST } from "./context/session-file-cache.js";
export type {
  ChunkStatus,
  ChunkCheckResult,
  SessionCacheStats,
} from "./context/session-file-cache.js";

// ETL Pipeline
export { etlPipeline, EtlPipeline } from "./etl/pipeline.js";
export type { PipelineInput, EtlResult, EtlStage } from "./etl/index.js";

// Structural parser readiness (liveness remains transport-owned and separate)
export {
  assertParserReadyForIndexing,
  getParserReadiness,
  validateAllGrammars,
  ParserReadinessError,
} from "./structural/parser-readiness.js";
export type {
  ParserReadinessDiagnostic,
  ParserReadinessSnapshot,
  ParserReadinessStatus,
} from "./structural/parser-readiness.js";
export {
  StructuralParserPool,
  ParserAcquireTimeoutError,
  DEFAULT_STRUCTURAL_PARSER_CAPACITY,
  MAX_STRUCTURAL_PARSER_CAPACITY,
  DEFAULT_STRUCTURAL_ACQUIRE_TIMEOUT_MS,
  MAX_STRUCTURAL_ACQUIRE_TIMEOUT_MS,
} from "./structural/parser-pool.js";
export type {
  ParserLease,
  ParserPoolOptions,
} from "./structural/parser-pool.js";
export {
  StructuralRuntime,
  structuralRuntime,
} from "./structural/structural-runtime.js";
export type {
  StructuralParseRequest,
  StructuralQueryContext,
  StructuralQueryExecutor,
  StructuralQueryTree,
  StructuralRuntimeOptions,
  StructuralSyntaxNode,
} from "./structural/structural-runtime.js";
export {
  MAX_STRUCTURAL_DIAGNOSTIC_DETAILS,
  boundDiagnostics,
} from "./structural/diagnostics.js";
export type {
  ParseDiagnostic,
  SourcePoint,
  SourceSpan,
  StructuralFailureKind,
  StructuralParseOutcome,
} from "./structural/types.js";
export { SourceIndex, deriveLegacyLineRange } from "./structural/source-span.js";
export type { LegacyLineRange } from "./structural/source-span.js";
export {
  FqnHashCollisionError,
  StructuralFqnRegistry,
  canonicalizeStructuralSignature,
  createStructuralIdentity,
  formatStructuralFqn,
  normalizeStructuralFile,
  parseStructuralFqn,
  sha256SignatureDigest,
  structuralFqnDisplayName,
} from "./structural/fqn-codec.js";
export type {
  ParsedStructuralFqn,
  SignatureDigest,
  StructuralFqnCandidate,
  StructuralFqnResolution,
  StructuralIdentity,
  StructuralIdentityInput,
  StructuralIdentityOverload,
  StructuralIdentityScope,
  StructuralSignatureInput,
} from "./structural/fqn-codec.js";

// Symbol Graph
export { symbolGraphService, SymbolGraphService } from "./symbol/symbol-graph.service.js";
export { computePageRank } from "./symbol/centrality.js";
export { TracePathService, tracePathService } from "./symbol/trace-path.js";
export { ImpactAnalysisService, impactAnalysisService, defaultDiffRunner } from "./symbol/impact-analysis.js";
export type {
  DefinitionResult,
  ReferenceResult,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ListDefinitionsOptions,
  CentralityResult,
} from "./symbol/symbol-graph.service.js";
export type {
  TracePathOptions,
  TracePathResult,
  TraceNode,
  TraceEdge,
  TraceDirection,
  TraceMode,
} from "./symbol/trace-path.js";
export type {
  ImpactAnalysisOptions,
  ImpactAnalysisResult,
  ImpactScope,
  ChangedFile,
  ImpactedSymbol,
} from "./symbol/impact-analysis.js";

// Events
export { eventBus, EventBus } from "./events/event-bus.js";
export type { EventMap, EventName } from "./events/event-bus.js";

// Hooks
export { SearchSessionHook, searchSessionHook } from "./hooks/search-session-hook.js";
export { CoRetrievalHook, coRetrievalHook } from "./hooks/co-retrieval-hook.js";
export { extractCategory, CATEGORY_LABELS } from "./hooks/observation-extractor.js";
export {
  CompactionSnapshotService,
  getCompactionSnapshotService,
  resetCompactionSnapshotService,
} from "./hooks/compaction-snapshot-service.js";
export type {
  SnapshotBuildOptions,
  SnapshotSection,
  CompactionSnapshot,
} from "./hooks/compaction-snapshot-service.js";

// Metrics (token savings observability)
export { TokenMetrics } from "./metrics/token-metrics.js";
export type {
  ModelPricing as TokenModelPricing,
  TokenSavingsBreakdown,
  TokenMetricsStats,
  TokenMetricsTimeSeries,
} from "./metrics/token-metrics.js";

// Workspace Manager
export { workspaceManager, WorkspaceManager } from "./workspace/workspace-manager.js";
export type { WorkspaceRow, WorkspaceStatus } from "./workspace/workspace-manager.js";

// Prisma lifecycle
export { getPrismaClient, disconnectPrisma } from "./query/prisma-client.js";

// Executor — polyglot sandbox + run-pool + intent progressive disclosure
export {
  PolyglotExecutor,
  runPool,
  fulfilledValues,
  detectRuntimes,
  getRuntimeSummary,
  getAvailableLanguages,
  intentSearch,
  renderIntentResult,
  DEFAULT_TIMEOUT_MS,
  MAX_TIMEOUT_MS,
} from "./executor/index.js";
export type {
  ExecResult,
  ExecuteOptions,
  ExecuteFileOptions,
  PoolJob,
  RunPoolOptions,
  RunPoolResult,
  Language,
  RuntimeMap,
  IntentSearchResult,
} from "./executor/index.js";

// Keyword search factory (PostgreSQL/PG backend resolution, sibling to getVectorStore)
export {
  getKeywordSearch,
  resetKeywordSearch,
} from "../data/keyword/keyword-search-factory.js";

// Web — SSRF-guarded fetch + HTML→md + index (fetch_and_index)
export {
  WebController,
  classifyIp,
  assertUrlSafe,
  fetchWithSsrfGuard,
  SsrfBlockedError,
  setDnsResolver,
  fetchAndConvertOne,
  composeFetchCacheKey,
  htmlToMarkdown,
  jsonToKeyPathChunks,
  MAX_FETCH_BYTES,
  DEFAULT_FETCH_TTL_MS,
  MAX_REDIRECTS,
} from "./web/index.js";
export type {
  FetchRequest,
  FetchAndIndexParams,
  WebControllerDeps,
  FetchOneResult,
  FetchOneOptions,
  IndexedChunk,
  WebIndexDeps,
  IpClass,
  JsonChunk,
} from "./web/index.js";

// Synapse — cognitive modulation layer (focus, retention, prioritization, speed)
export {
  SynapseManager,
  getSynapseManager,
  resetSynapseManager,
  applyDiversityPenalty,
  applyConfidenceGate,
  applyTemporalInhibition,
  applyChainInhibition,
  applyAttentionScore,
  classifyQuery,
  hasTemporalIndicator,
  detectIntent,
  analyzeSpectrum,
  computeTaskAlignment,
  computeAgentAffinity,
  DEFAULT_CHAIN_BOOSTS,
  DEFAULT_ATTENTION_WEIGHTS,
  DEFAULT_ATTENTION_CONFIG,
  DEFAULT_BUFFER_CONFIG,
  SessionRegistry,
  getSessionRegistry,
  resetSessionRegistry,
  WorkingMemoryBuffer,
  computeStrengthenUpdates,
  selectCompressionCandidates,
  compressBatch,
  evolveEmbeddings,
  buildPrefetchPlan,
  executePrefetch,
  extractTopics,
  DEFAULT_STRENGTHEN_CONFIG,
  DEFAULT_COMPRESS_CONFIG,
  DEFAULT_EMBEDDING_EVOLUTION_CONFIG,
  DEFAULT_PREFETCH_CONFIG,
} from "./synapse/index.js";
export type {
  AgentSession,
  SpectrumFlags,
  SynapsePipelineResult,
  QueryClass,
  QueryIntent,
  ChainBoostMap,
  DiversityPenaltyConfig,
  ConfidenceGateConfig,
  TemporalInhibitionConfig,
  ChainInhibitionConfig,
  ScoreSpectrumConfig,
  AttentionWeights,
  AttentionScoreConfig,
  AttentionScoreBreakdown,
  CreateSessionInput,
  WorkingMemoryBufferConfig,
  BufferGetResult,
  MemoryUsageStats,
  StrengthenConfig,
  StrengthenUpdate,
  CompressionCandidate,
  CompressConfig,
  CompressUpdate,
  SummarizeFn,
  EvolutionInput,
  EvolutionUpdate,
  EmbeddingEvolutionConfig,
  PrefetchConfig,
  PrefetchInput,
  PrefetchPlan,
  PrefetchEntry,
} from "./synapse/index.js";
