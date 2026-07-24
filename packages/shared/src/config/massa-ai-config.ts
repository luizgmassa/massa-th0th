import path from "path";
import { configDir } from "./xdg";

export interface MassaAiConfig {
  database?: {
    // Optional DATABASE_URL home (secret). Seeded into process.env at runtime
    // by env.ts when DATABASE_URL is unset, so config.json is the source of
    // truth for the DB connection unless an explicit env override exists.
    url: string;
  };
  embedding: {
    provider: "ollama" | "mistral" | "openai" | "google" | "cohere";
    model: string;
    baseURL?: string;
    apiKey?: string;
    dimensions?: number;
  };
  compression: {
    // Runtime canonical shape — mirrors ServerConfig.compression. The loader
    // consumes `targetCompressionRatio` + `minTokensForCompression` +
    // `defaultStrategy`. `prompt` is an optional compression-specific override
    // (env `RLM_LLM_PROMPT`); the LLM connection fields live in the top-level
    // `llm` block.
    defaultStrategy: string;
    minTokensForCompression: number;
    targetCompressionRatio: number; // 0-1
    prompt?: string;
  };
  // Wave 5 FR-05 / N3: impact-analysis CTE behind-flag (default false).
  impact?: {
    bfsCteEnabled: boolean;
  };
  // Wave 5 FR-11 / N13: capture policy (bounded pure module). When absent,
  // the default policy (migrated from DEFAULT_IGNORES) is used. Loaded +
  // validated at config load (denyUnknownFields, maxIgnorePatterns,
  // maxMatchWork). The `.gitignore` merge runs BEFORE applyPolicy per
  // AD-W5-015.
  capturePolicy?: {
    rules: Array<{ pattern: string; disposition: "Keep" | "Drop" | "MetadataOnly" }>;
    maxMatchWork?: number;
    maxIgnorePatterns?: number;
  };
  cache: {
    enabled: boolean;
    l1MaxSizeMB: number;
    l2MaxSizeMB: number;
    defaultTTLSeconds: number;
  };
  dataDir: string;
  logging: {
    level: "debug" | "info" | "warn" | "error";
    enableMetrics: boolean;
  };
  // Keys below mirror the runtime ServerConfig declarations (index.ts) so the
  // interface describes what the loader/runtime actually produces. See
  // ServerConfig for the authoritative field documentation.
  search: {
    autoReindexMaxFiles: number;
    queryUnderstanding: {
      enabled: boolean;
      hydeEnabled: boolean;
      cacheTtlMs: number;
      cacheMaxSize: number;
    };
    rerank: {
      enabled: boolean;
      rerankWindow: number;
    };
  };
  llm: {
    enabled: boolean;
    baseUrl: string;
    apiKey: string;
    model: string;
    codeModel: string;
    temperature: number;
    maxOutputTokens: number;
    timeoutMs: number;
    disableThink: boolean;
  };
  memory: {
    decay: {
      lambda: number;
      sigma: number;
      mu: number;
      coldThreshold: number;
    };
    bootstrap: {
      enabled: boolean;
      maxSeedMemories: number;
      centralityLimit: number;
      gitLogLimit: number;
      refreshEnabled: boolean;
    };
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
    autoImportance: {
      enabled: boolean;
    };
  };
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
  synapse: SynapseConfig;
  // Cross-session handoffs (Phase 6). begin/accept/cancel have no LLM dep; the
  // optional summary-polish inherits the top-level `llm.enabled` gate. Mirrors the
  // runtime ServerConfig declaration (config/index.ts).
  handoffs: {
    enabled: boolean;
  };
  // NOTE: `scheduler` is intentionally NOT a config key — it is env-driven
  // (MASSA_AI_SCHEDULER_ENABLED + job-stale/reaper env vars). Do not add it.
}

/**
 * Synapse — cognitive modulation layer over retrieval.
 * Every submodule has its own kill switch; the whole layer can be disabled at the top.
 * Mirrors the runtime SynapseRuntimeConfig (index.ts) shape; that declaration is
 * the single source of truth — keep the two in sync.
 */
export interface SynapseConfig {
  enabled: boolean;
  inhibition: {
    diversityPenalty: {
      enabled: boolean;
      threshold: number; // cosine threshold above which results are considered redundant
      lambda: number;    // penalty strength: score *= (1 - lambda * cosine)
      samePathPenalty?: number;
    };
    temporalInhibition: {
      enabled: boolean;
      penaltyAgeMs: number; // memories younger than this get penalized when query is non-temporal
      penalty: number;      // absolute score reduction
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

export const defaultMassaAiConfig: MassaAiConfig = {
  database: {
    url: "",
  },
  embedding: {
    provider: "ollama",
    model: "nomic-embed-text:latest",
    baseURL: "http://localhost:11434",
    dimensions: 768,
  },
  compression: {
    defaultStrategy: "code_structure",
    minTokensForCompression: 100,
    targetCompressionRatio: 0.7,
  },
  // Wave 5 FR-05: impact-analysis CTE behind-flag (default false).
  impact: {
    bfsCteEnabled: false,
  },
  // Wave 5 FR-11: capture policy absent by default → the pure module's
  // DEFAULT_POLICY (migrated from DEFAULT_IGNORES) is used. When present,
  // the config loader validates bounds + denyUnknownFields.
  capturePolicy: undefined,
  cache: {
    enabled: true,
    l1MaxSizeMB: 100,
    l2MaxSizeMB: 500,
    defaultTTLSeconds: 3600,
  },
  dataDir: path.join(configDir("massa-ai"), "data"),
  logging: {
    level: "info",
    enableMetrics: false,
  },
  search: {
    autoReindexMaxFiles: 200,
    queryUnderstanding: {
      enabled: false,
      hydeEnabled: true,
      cacheTtlMs: 300_000,
      cacheMaxSize: 256,
    },
    rerank: {
      enabled: false,
      rerankWindow: 50,
    },
  },
  llm: {
    enabled: false,
    baseUrl: "http://localhost:11434/v1",
    apiKey: "ollama",
    model: "qwen2.5:7b-instruct",
    codeModel: "qwen2.5-coder:7b",
    temperature: 0.2,
    maxOutputTokens: 8000,
    timeoutMs: 90_000,
    disableThink: true,
  },
  memory: {
    decay: {
      lambda: 0.02,
      sigma: 0.6,
      mu: 0.04,
      coldThreshold: 0.2,
    },
    bootstrap: {
      enabled: true,
      maxSeedMemories: 8,
      centralityLimit: 10,
      gitLogLimit: 20,
      refreshEnabled: true,
    },
    autoImprove: {
      enabled: true,
      reviewGate: false,
      minObservations: 8,
      minIntervalMs: 300_000,
      maxWindow: 16,
      minQueryHits: 3,
      minFileHits: 3,
      minFixHits: 2,
    },
    autoImportance: {
      enabled: false,
    },
  },
  hooks: {
    enabled: true,
    maxPayloadBytes: 65_536,
    queue: {
      maxPending: 256,
    },
    bridge: {
      enabled: true,
      minObservations: 8,
      minIntervalMs: 300_000,
      maxWindow: 8,
    },
  },
  synapse: {
    enabled: true,
    inhibition: {
      diversityPenalty: { enabled: true, threshold: 0.85, lambda: 0.4, samePathPenalty: 0.15 },
      temporalInhibition: { enabled: true, penaltyAgeMs: 3_600_000, penalty: 0.15 },
      confidenceGate: {
        enabled: true,
        thresholds: { specific: 0.55, focused: 0.4, broad: 0.25 },
      },
      chainInhibition: { enabled: true },
    },
    scoring: {
      attention: {
        enabled: false,
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
      lowConfidenceThreshold: 0.15,
      definitiveTopScore: 0.8,
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
  handoffs: {
    enabled: true,
  },
};
