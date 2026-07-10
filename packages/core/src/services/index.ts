/**
 * @massa-th0th/core - Services Export
 */

// Search
export { ContextualSearchRLM } from "./search/contextual-search-rlm.js";
export { SearchCache } from "./search/search-cache.js";
export { getSearchCache } from "./search/cache-factory.js";
export { SearchAnalytics } from "./search/search-analytics.js";
export { IndexManager } from "./search/index-manager.js";

// Cache
export { CacheManager } from "./cache/cache-manager.js";
export { L1MemoryCache } from "./cache/l1-memory-cache.js";
export { L2SQLiteCache } from "./cache/l2-sqlite-cache.js";
export { EmbeddingCache } from "./cache/embedding-cache.js";

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
export { GraphStore } from "./graph/graph-store.js";
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

// Symbol Graph
export { symbolGraphService, SymbolGraphService } from "./symbol/symbol-graph.service.js";
export { computePageRank } from "./symbol/centrality.js";
export type {
  DefinitionResult,
  ReferenceResult,
  DependencyGraph,
  DependencyNode,
  DependencyEdge,
  ListDefinitionsOptions,
  CentralityResult,
} from "./symbol/symbol-graph.service.js";

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

// Keyword search factory (SQLite/PG backend resolution, sibling to getVectorStore)
export {
  getKeywordSearch,
  resetKeywordSearch,
} from "../data/sqlite/keyword-search-factory.js";

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
