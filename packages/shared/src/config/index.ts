/**
 * Configuration Management
 *
 * Centralized configuration for massa-th0th Server
 *
 * Architecture:
 * - Global cache with projectId namespace (multi-tenant)
 * - All data isolated by project_id in the same SQLite database
 * - Optimized for multiple projects with embedding reuse
 */

// Load environment variables FIRST before any config
import "../env.js";

import path from "path";
import os from "os";

export interface ServerConfig {
  // Server Info
  name: string;
  version: string;

  // Data Directory (global cache location)
  dataDir: string;

  // Cache Configuration (multi-tenant with projectId namespace)
  cache: {
    l1: {
      maxSize: number; // bytes
      defaultTTL: number; // seconds
    };
    l2: {
      dbPath: string;
      maxSize: number;
      defaultTTL: number;
    };
    embedding: {
      dbPath: string;
      maxAgeHours: number;
    };
  };

  // Vector Store Configuration (SQLite-based com embeddings)
  vectorStore: {
    type: "sqlite";
    dbPath: string;
    collectionName: string;
    embeddingModel?: string;
  };

  // Keyword Search Configuration
  keywordSearch: {
    dbPath: string;
    ftsVersion: "fts5";
  };

  // Search / Auto-Reindex Configuration
  search: {
    autoReindexMaxFiles: number;
    // Phase 2: query understanding (LLM rewrite + HyDE). Default-off,
    // silent-degrades. Consumers MUST treat the absence of this block as
    // "feature off" (original single-stream search path).
    queryUnderstanding: {
      enabled: boolean;
      hydeEnabled: boolean;
      cacheTtlMs: number;
      cacheMaxSize: number;
    };
    // Phase 7a: LLM-judge reranking on top of RRF + centrality. Default-off,
    // silent-degrades to RRF order. rerankWindow is the top-K re-scored.
    rerank: {
      enabled: boolean;
      rerankWindow: number;
    };
  };

  // Shared local-first LLM configuration (cross-cutting §1).
  // Consumed by consolidation (Phase 1), query rewrite (Phase 2),
  // compression (Phase 7), bootstrap (Phase 4), auto-improve (Phase 5).
  // Default-off; env RLM_LLM_ENABLED=true opts in. Ollama-local defaults.
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
  };

  // Memory-quality configuration (Phase 1).
  memory: {
    decay: DecayParams;
    // Bootstrap from repo (Phase 4). The service is default-on for scan +
    // rule-based seeding; the LLM-driven summarization inherits the top-level
    // `llm.enabled` gate and silent-degrades to rule-based seeds when off.
    bootstrap: {
      enabled: boolean;
      maxSeedMemories: number;
      centralityLimit: number;
      gitLogLimit: number;
      refreshEnabled: boolean;
    };
    // Auto-improvement loop (Phase 5, G7). Pattern detection is rule-based
    // (no LLM dep); LLM enrichment is optional and inherits the top-level
    // `llm.enabled` gate. Default auto-approve (reviewGate=false) with
    // logging; flip reviewGate=true for human-in-the-loop surfacing.
    autoImprove: {
      enabled: boolean;
      reviewGate: boolean;
      minObservations: number;
      minIntervalMs: number;
      maxWindow: number;
      minQueryHits: number;
      minFileHits: number;
      minFixHits: number;
    };
    // Phase 7b: auto importance/salience scoring on remember. When the caller
    // omits `importance` AND this is enabled AND the LLM is on, score 0..1 via
    // llmObject. Default-off; silent-degrades to 0.5 (the pre-7b default).
    autoImportance: {
      enabled: boolean;
    };
  };

  // Passive lifecycle capture (Phase 3). Ingestion is default-on (no LLM dep);
  // the LLM-driven consolidation bridge inherits the top-level `llm.enabled`
  // gate and silent-degrades to a no-op when the LLM is off.
  hooks: {
    enabled: boolean;
    maxPayloadBytes: number;
    queue: {
      maxPending: number;
    };
    bridge: {
      enabled: boolean;
      minObservations: number;
      minIntervalMs: number;
      maxWindow: number;
    };
  };

  // Cross-session handoffs (Phase 6, G2). The begin/accept/cancel primitive
  // has no LLM dependency; the optional summary-polish inherits the top-level
  // `llm.enabled` gate and silent-degrades to the caller-provided summary.
  handoffs: {
    enabled: boolean;
  };

  // Compression Configuration
  // NOTE: compression.llm is a DEPRECATED alias of the top-level `llm` block
  // (kept for one release so existing readers like code-compressor.ts see no
  // behavior change). `prompt` stays compression-specific.
  compression: {
    defaultStrategy: string;
    minTokensForCompression: number;
    targetCompressionRatio: number; // 0-1
    llm: {
      enabled: boolean;
      baseUrl: string;
      apiKey: string;
      model: string;
      temperature: number;
      maxOutputTokens: number;
      timeoutMs: number;
      prompt?: string;
    };
  };

  // Rate Limiting
  rateLimit: {
    requestsPerMinute: number;
    tokensPerMinute: number;
  };

  // Security
  security: {
    maxInputLength: number;
    sanitizeInputs: boolean;
    maxFileSize: number;
    maxIndexSize: number;
    allowedExtensions: string[];
    excludePatterns: string[];
  };

  // Logging
  logging: {
    level: "debug" | "info" | "warn" | "error";
    enableMetrics: boolean;
  };

  // Synapse — cognitive modulation layer (focus, retention, prioritization, speed).
  // Mirrored from MassaTh0thConfig so runtime services have a uniform access point.
  synapse: SynapseRuntimeConfig;
}

export interface SynapseRuntimeConfig {
  enabled: boolean;
  inhibition: {
    diversityPenalty: {
      enabled: boolean;
      threshold: number;
      lambda: number;
      samePathPenalty?: number;
    };
    temporalInhibition: {
      enabled: boolean;
      penaltyAgeMs: number;
      penalty: number;
    };
    confidenceGate: {
      enabled: boolean;
      thresholds: { specific: number; focused: number; broad: number };
    };
    chainInhibition: {
      enabled: boolean;
      boosts?: Record<string, Record<string, number>>;
    };
  };
  scoring: {
    attention: {
      enabled: boolean;
      rerankWindow: number;
      recencyHalfLifeMs: number;
      semanticScale: number;
      weights: {
        semantic: number;
        recency: number;
        accessHeat: number;
        taskAlign: number;
        agentAffinity: number;
        confidence: number;
      };
    };
  };
  metacognition: {
    enabled: boolean;
    lowConfidenceThreshold: number;
    definitiveTopScore: number;
    definitiveGap: number;
  };
  buffer: {
    enabled: boolean;
    maxSize: number;
    ttlMs: number;
    hitBoost: number;
    matchThreshold: number;
  };
}

/** Read an env var as a number; falls back to `fallback` when unset, empty, or non-finite. */
function envNum(key: string, fallback: number): number {
  const s = process.env[key];
  if (s === undefined || s === "") return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}

/** Read an env var as a boolean; "true"/"1" (case-insensitive) are truthy. */
function envBool(key: string, fallback: boolean): boolean {
  const s = process.env[key];
  if (s === undefined || s === "") return fallback;
  const lower = s.toLowerCase();
  if (lower === "true" || lower === "1") return true;
  if (lower === "false" || lower === "0") return false;
  return fallback;
}

/** Read an env var as a string; falls back to `fallback` when unset or empty. */
function envString(key: string, fallback: string): string {
  const s = process.env[key];
  return s === undefined || s === "" ? fallback : s;
}

/**
 * Decay parameters for memory salience scoring (Phase 1, borrowed from
 * ai-memory decay.rs). Used by `decayScore`:
 *   score = salience·exp(-λ·Δt_days) + σ·log(1+access)·exp(-μ·Δt_access_days)
 * Memories scoring below `coldThreshold` are prune candidates.
 */
export interface DecayParams {
  /** Per-day exponential decay rate of the salience term. */
  lambda: number;
  /** Weight of the access-reinforcement term. */
  sigma: number;
  /** Per-day exponential decay rate of the access term (since last access). */
  mu: number;
  /** Score below which a memory is a candidate for pruning. */
  coldThreshold: number;
}

/**
 * Get global data directory
 * Creates ~/.massa-th0th-data/ directory for all projects
 */
function getGlobalDataDir(): string {
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, ".massa-th0th-data");
  return dataDir;
}

/**
 * Canonical default allow-list of file extensions massa-th0th indexes/searches.
 * Single source of truth — consumed by the indexing pipeline, the search
 * index scanner, and the MCP upload collector so the three never drift.
 * User config (`security.allowedExtensions`) overrides this at runtime.
 */
export const DEFAULT_ALLOWED_EXTENSIONS: readonly string[] = [
  ".ts",
  ".js",
  ".tsx",
  ".jsx",
  ".vue",
  ".dart",
  ".py",
  ".php",
  ".java",
  ".go",
  ".rs",
  ".cpp",
  ".c",
  ".h",
  ".md",
  ".json",
  ".yaml",
  ".yml",
  ".hpp",
  ".cs",
  ".rb",
  ".swift",
  ".kt",
  ".kts",
  ".scala",
  ".lua",
  ".zig",
  ".ex",
  ".exs",
  ".erl",
  ".clj",
  ".ml",
  ".hs",
];

/**
 * Default Configuration
 */
export const defaultConfig: ServerConfig = {
  name: "massa-th0th-server",
  version: "1.0.0",

  dataDir: getGlobalDataDir(),

  cache: {
    l1: {
      maxSize: envNum("L1_CACHE_MAX_SIZE", 100 * 1024 * 1024),
      defaultTTL: envNum("L1_CACHE_TTL", 300),
    },
    l2: {
      dbPath:
        process.env.CACHE_DB_PATH || path.join(getGlobalDataDir(), "cache.db"),
      maxSize: envNum("L2_CACHE_MAX_SIZE", 500 * 1024 * 1024),
      defaultTTL: envNum("L2_CACHE_TTL", 3600),
    },
    embedding: {
      dbPath:
        process.env.EMBEDDING_CACHE_DB_PATH ||
        path.join(getGlobalDataDir(), "embedding-cache.db"),
      maxAgeHours: 168, // 7 days
    },
  },

  vectorStore: {
    type: "sqlite",
    dbPath: path.join(getGlobalDataDir(), "vector-store.db"),
    collectionName: "rlm_memories",
    embeddingModel: "default",
  },

  keywordSearch: {
    dbPath: path.join(getGlobalDataDir(), "keyword-search.db"),
    ftsVersion: "fts5",
  },

  search: {
    // Max files an auto-reindex (latency-sensitive) path will sync before
    // deferring. Overridable via AUTOREINDEX_MAX_FILES env var.
    autoReindexMaxFiles: envNum("AUTOREINDEX_MAX_FILES", 200),
    // Phase 2: query understanding (LLM rewrite + HyDE). Opt-in via
    // SEARCH_QUERY_UNDERSTANDING_ENABLED. hydeEnabled gates only the HyDE
    // extra-LLM-call (the rewrite still runs when enabled && hydeEnabled=false).
    // Cache is per-(query, projectId), TTL+size bounded.
    queryUnderstanding: {
      enabled: envBool("SEARCH_QUERY_UNDERSTANDING_ENABLED", false),
      hydeEnabled: envBool("SEARCH_QUERY_UNDERSTANDING_HYDE_ENABLED", true),
      cacheTtlMs: envNum("SEARCH_QUERY_UNDERSTANDING_CACHE_TTL_MS", 300_000),
      cacheMaxSize: envNum("SEARCH_QUERY_UNDERSTANDING_CACHE_MAX_SIZE", 256),
    },
    // Phase 7a: LLM-judge rerank. Opt-in via SEARCH_RERANK_ENABLED.
    // rerankWindow = top-K re-scored by the LLM judge after centrality boost.
    rerank: {
      enabled: envBool("SEARCH_RERANK_ENABLED", false),
      rerankWindow: envNum("SEARCH_RERANK_WINDOW", 50),
    },
  },

  // Shared local-first LLM block (cross-cutting §1). Ollama defaults; the
  // OpenAI-compatible provider is created from these in services/memory/llm-client.ts.
  llm: {
    enabled: envBool("RLM_LLM_ENABLED", false),
    baseUrl: envString("RLM_LLM_BASE_URL", "http://localhost:11434/v1"),
    apiKey: envString("RLM_LLM_API_KEY", "ollama"),
    model: envString("RLM_LLM_MODEL", "qwen2.5-coder:7b"),
    temperature: envNum("RLM_LLM_TEMPERATURE", 0.2),
    maxOutputTokens: envNum("RLM_LLM_MAX_OUTPUT_TOKENS", 2000),
    timeoutMs: envNum("RLM_LLM_TIMEOUT_MS", 30000),
  },

  memory: {
    // Defaults borrowed from ai-memory decay.rs. Tunable via the `memory.decay`
    // config override or by constructing a Config with overrides.
    decay: {
      lambda: 0.02,
      sigma: 0.6,
      mu: 0.04,
      coldThreshold: 0.2,
    },
    bootstrap: {
      // Phase 4: repo bootstrap. Scan + rule-based seed have no LLM dep.
      enabled: envBool("BOOTSTRAP_ENABLED", true),
      maxSeedMemories: envNum("BOOTSTRAP_MAX_SEED_MEMORIES", 8),
      centralityLimit: envNum("BOOTSTRAP_CENTRALITY_LIMIT", 10),
      gitLogLimit: envNum("BOOTSTRAP_GIT_LOG_LIMIT", 20),
      refreshEnabled: envBool("BOOTSTRAP_REFRESH_ENABLED", true),
    },
    autoImprove: {
      // Phase 5: auto-improvement loop. Rule-based pattern detection has
      // no LLM dep; LLM enrichment inherits the top-level llm.enabled gate.
      // Default auto-approve + logging; reviewGate=true surfaces pending
      // proposals via list_proposals / approve_proposal.
      enabled: envBool("AUTO_IMPROVE_ENABLED", true),
      reviewGate: envBool("AUTO_IMPROVE_REVIEW_GATE", false),
      minObservations: envNum("AUTO_IMPROVE_MIN_OBS", 8),
      minIntervalMs: envNum("AUTO_IMPROVE_MIN_INTERVAL_MS", 5 * 60 * 1000),
      maxWindow: envNum("AUTO_IMPROVE_MAX_WINDOW", 16),
      minQueryHits: envNum("AUTO_IMPROVE_MIN_QUERY_HITS", 3),
      minFileHits: envNum("AUTO_IMPROVE_MIN_FILE_HITS", 3),
      minFixHits: envNum("AUTO_IMPROVE_MIN_FIX_HITS", 2),
    },
    // Phase 7b: auto salience scoring on remember (opt-in via
    // AUTO_IMPORTANCE_ENABLED). Scores only when the caller omits importance.
    autoImportance: {
      enabled: envBool("AUTO_IMPORTANCE_ENABLED", false),
    },
  },

  hooks: {
    // Phase 3: passive lifecycle capture. Ingestion has no LLM dependency.
    enabled: envBool("HOOKS_ENABLED", true),
    maxPayloadBytes: envNum("HOOKS_MAX_PAYLOAD_BYTES", 65_536),
    queue: {
      // Saturation threshold — once exceeded, /api/v1/hook returns 429.
      maxPending: envNum("HOOKS_QUEUE_MAX_PENDING", 256),
    },
    bridge: {
      // LLM-driven observation→memory summarization. No-ops when llm.enabled=false.
      enabled: envBool("HOOKS_BRIDGE_ENABLED", true),
      minObservations: envNum("HOOKS_BRIDGE_MIN_OBS", 8),
      minIntervalMs: envNum("HOOKS_BRIDGE_MIN_INTERVAL_MS", 5 * 60 * 1000),
      maxWindow: envNum("HOOKS_BRIDGE_MAX_WINDOW", 8),
    },
  },

  handoffs: {
    // Phase 6: cross-session handoffs. begin/accept/cancel have no LLM dep.
    enabled: envBool("HANDOFFS_ENABLED", true),
  },

  compression: {
    defaultStrategy: "code_structure",
    minTokensForCompression: envNum("MIN_TOKENS_FOR_COMPRESSION", 100),
    targetCompressionRatio: envNum("TARGET_COMPRESSION_RATIO", 0.7),
    // DEPRECATED alias of top-level `llm`. Same env vars, same shape; `prompt`
    // remains compression-specific. Readers should migrate to `config.get("llm")`.
    llm: {
      enabled: envBool("RLM_LLM_ENABLED", false),
      baseUrl: envString("RLM_LLM_BASE_URL", "http://localhost:11434/v1"),
      apiKey: envString("RLM_LLM_API_KEY", "ollama"),
      model: envString("RLM_LLM_MODEL", "qwen2.5-coder:7b"),
      temperature: envNum("RLM_LLM_TEMPERATURE", 0.2),
      maxOutputTokens: envNum("RLM_LLM_MAX_OUTPUT_TOKENS", 2000),
      timeoutMs: envNum("RLM_LLM_TIMEOUT_MS", 30000),
      prompt: process.env.RLM_LLM_PROMPT || undefined,
    },
  },

  rateLimit: {
    requestsPerMinute: envNum("REQUESTS_PER_MINUTE", 60),
    tokensPerMinute: envNum("TOKENS_PER_MINUTE", 100000),
  },

  security: {
    maxInputLength: envNum("MAX_INPUT_LENGTH", 100000),
    sanitizeInputs: process.env.SANITIZE_INPUTS !== "false",
    maxIndexSize: 100000, // max files to index
    maxFileSize: 1024 * 1024, // 1MB per file
    allowedExtensions: [...DEFAULT_ALLOWED_EXTENSIONS],
    excludePatterns: [
      "node_modules/**",
      ".git/**",
      "dist/**",
      "build/**",
      ".next/**",
      "coverage/**",
      "**/generated/**",
      "*.min.js",
      "*.min.css",
    ],
  },

  logging: {
    level: (process.env.LOG_LEVEL as any) || "info",
    enableMetrics: process.env.ENABLE_METRICS === "true",
  },

  synapse: {
    enabled: process.env.SYNAPSE_ENABLED !== "false",
    inhibition: {
      diversityPenalty: {
        enabled: true,
        threshold: 0.85,
        lambda: 0.4,
        samePathPenalty: 0.15,
      },
      temporalInhibition: {
        enabled: true,
        penaltyAgeMs: 3_600_000,
        penalty: 0.15,
      },
      confidenceGate: {
        enabled: true,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: process.env.SYNAPSE_ATTENTION_ENABLED === "true",
        rerankWindow: 50,
        recencyHalfLifeMs: 7 * 24 * 60 * 60 * 1000,
        semanticScale: 1.0,
        weights: {
          semantic: 0.25,
          recency: 0.15,
          accessHeat: 0.15,
          taskAlign: 0.2,
          agentAffinity: 0.1,
          confidence: 0.15,
        },
      },
    },
    metacognition: {
      enabled: true,
      // Recalibrated against real RRF score distributions (IMP-2):
      // production confidence values fall in 0.07-0.28 range; 0.15 catches
      // genuinely weak clusters without flooding the metric.
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
      // RRF rarely produces 0.4+ gaps in top-2; 0.2 is the practical
      // boundary between "obvious winner" and "competitive set".
      definitiveGap: 0.2,
    },
    buffer: {
      enabled: true,
      maxSize: 20,
      ttlMs: 900_000,
      hitBoost: 1.3,
      matchThreshold: 0.4,
    },
  },
};

/**
 * Configuration Manager
 */
export class Config {
  private config: ServerConfig;

  constructor(overrides?: Partial<ServerConfig>) {
    this.config = this.mergeConfig(defaultConfig, overrides);
    this.validate();
  }

  /**
   * Merge default config with overrides
   */
  private mergeConfig(
    defaults: ServerConfig,
    overrides?: Partial<ServerConfig>,
  ): ServerConfig {
    if (!overrides) return defaults;

    return {
      ...defaults,
      ...overrides,
      cache: {
        l1: { ...defaults.cache.l1, ...overrides.cache?.l1 },
        l2: { ...defaults.cache.l2, ...overrides.cache?.l2 },
        embedding: {
          ...defaults.cache.embedding,
          ...overrides.cache?.embedding,
        },
      },
      vectorStore: { ...defaults.vectorStore, ...overrides.vectorStore },
      keywordSearch: { ...defaults.keywordSearch, ...overrides.keywordSearch },
      search: {
        ...defaults.search,
        ...overrides.search,
        // Shallow-merge the nested queryUnderstanding block so partial
        // overrides (e.g. { enabled: true }) don't drop the cache defaults.
        queryUnderstanding: {
          ...defaults.search.queryUnderstanding,
          ...overrides.search?.queryUnderstanding,
        },
        // Phase 7a: shallow-merge rerank so partial overrides keep the window.
        rerank: {
          ...defaults.search.rerank,
          ...overrides.search?.rerank,
        },
      },
      llm: { ...defaults.llm, ...overrides.llm },
      memory: {
        ...defaults.memory,
        ...overrides.memory,
        decay: { ...defaults.memory.decay, ...overrides.memory?.decay },
        bootstrap: { ...defaults.memory.bootstrap, ...overrides.memory?.bootstrap },
        autoImprove: { ...defaults.memory.autoImprove, ...overrides.memory?.autoImprove },
        autoImportance: { ...defaults.memory.autoImportance, ...overrides.memory?.autoImportance },
      },
      hooks: {
        ...defaults.hooks,
        ...overrides.hooks,
        queue: { ...defaults.hooks.queue, ...overrides.hooks?.queue },
        bridge: { ...defaults.hooks.bridge, ...overrides.hooks?.bridge },
      },
      handoffs: {
        ...defaults.handoffs,
        ...overrides.handoffs,
      },
      compression: {
        ...defaults.compression,
        ...overrides.compression,
        llm: { ...defaults.compression.llm, ...overrides.compression?.llm },
      },
      rateLimit: { ...defaults.rateLimit, ...overrides.rateLimit },
      security: { ...defaults.security, ...overrides.security },
      logging: { ...defaults.logging, ...overrides.logging },
      synapse: {
        ...defaults.synapse,
        ...overrides.synapse,
        inhibition: {
          ...defaults.synapse.inhibition,
          ...overrides.synapse?.inhibition,
          diversityPenalty: {
            ...defaults.synapse.inhibition.diversityPenalty,
            ...overrides.synapse?.inhibition?.diversityPenalty,
          },
          temporalInhibition: {
            ...defaults.synapse.inhibition.temporalInhibition,
            ...overrides.synapse?.inhibition?.temporalInhibition,
          },
          confidenceGate: {
            ...defaults.synapse.inhibition.confidenceGate,
            ...overrides.synapse?.inhibition?.confidenceGate,
            thresholds: {
              ...defaults.synapse.inhibition.confidenceGate.thresholds,
              ...overrides.synapse?.inhibition?.confidenceGate?.thresholds,
            },
          },
          chainInhibition: {
            ...defaults.synapse.inhibition.chainInhibition,
            ...overrides.synapse?.inhibition?.chainInhibition,
          },
        },
        scoring: {
          ...defaults.synapse.scoring,
          ...overrides.synapse?.scoring,
          attention: {
            ...defaults.synapse.scoring.attention,
            ...overrides.synapse?.scoring?.attention,
            weights: {
              ...defaults.synapse.scoring.attention.weights,
              ...overrides.synapse?.scoring?.attention?.weights,
            },
          },
        },
        metacognition: {
          ...defaults.synapse.metacognition,
          ...overrides.synapse?.metacognition,
        },
        buffer: {
          ...defaults.synapse.buffer,
          ...overrides.synapse?.buffer,
        },
      },
    };
  }

  /**
   * Validate configuration
   */
  private validate(): void {
    if (
      this.config.compression.targetCompressionRatio < 0 ||
      this.config.compression.targetCompressionRatio > 1
    ) {
      throw new Error("targetCompressionRatio must be between 0 and 1");
    }
  }

  /**
   * Get configuration value
   */
  get<K extends keyof ServerConfig>(key: K): ServerConfig[K] {
    return this.config[key];
  }

  /**
   * Get nested configuration value
   */
  getNested(path: string): any {
    return path.split(".").reduce((obj: any, key) => obj?.[key], this.config);
  }

  /**
   * Get all configuration
   */
  getAll(): ServerConfig {
    return { ...this.config };
  }

  /**
   * Update configuration (runtime)
   */
  set<K extends keyof ServerConfig>(key: K, value: ServerConfig[K]): void {
    this.config[key] = value;
  }
}

/**
 * Global config instance
 */
export const config = new Config();

export {
  MassaTh0thConfig,
  defaultMassaTh0thConfig,
} from "./massa-th0th-config";

export {
  getConfigDir,
  getConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  initConfig,
  getConfigForEnv,
} from "./config-loader";
