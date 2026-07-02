/**
 * Configuration Management
 *
 * Centralized configuration for th0th Server
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

  // Compression Configuration
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
  // Mirrored from Th0thConfig so runtime services have a uniform access point.
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

/**
 * Get global data directory
 * Creates ~/.rlm/ directory for all projects
 */
function getGlobalDataDir(): string {
  const homeDir = os.homedir();
  const dataDir = path.join(homeDir, ".rlm");
  return dataDir;
}

/**
 * Canonical default allow-list of file extensions th0th indexes/searches.
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
  name: "th0th-server",
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

  compression: {
    defaultStrategy: "code_structure",
    minTokensForCompression: envNum("MIN_TOKENS_FOR_COMPRESSION", 100),
    targetCompressionRatio: envNum("TARGET_COMPRESSION_RATIO", 0.7),
    llm: {
      enabled: process.env.RLM_LLM_ENABLED === "true",
      baseUrl: process.env.RLM_LLM_BASE_URL || "https://api.openai.com/v1",
      apiKey: process.env.RLM_LLM_API_KEY || "",
      model: process.env.RLM_LLM_MODEL || "gpt-4o-mini",
      temperature: Number(process.env.RLM_LLM_TEMPERATURE || "0.2"),
      maxOutputTokens: Number(process.env.RLM_LLM_MAX_OUTPUT_TOKENS || "800"),
      timeoutMs: Number(process.env.RLM_LLM_TIMEOUT_MS || "20000"),
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
  Th0thConfig,
  defaultTh0thConfig,
} from "./th0th-config";

export {
  getConfigDir,
  getConfigPath,
  configExists,
  loadConfig,
  saveConfig,
  initConfig,
  getConfigForEnv,
} from "./config-loader";
