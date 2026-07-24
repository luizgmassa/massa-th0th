/**
 * Monitoring and Metrics System for massa-ai MCP
 *
 * Tracks:
 * - Embedding usage (calls, tokens, cache hits)
 * - API costs per provider
 * - Performance metrics (latency, throughput)
 * - Error rates
 * - Cache efficiency
 */

import { writeFileSync, readFileSync, existsSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { logger } from "@massa-ai/shared";

/**
 * Pricing per provider (per 1M tokens)
 */
export const PROVIDER_PRICING = {
  mistralText: {
    model: "mistral-embed",
    costPer1MTokens: 0.1,
    dimensions: 1024,
  },
  mistralCode: {
    model: "codestral-embed",
    costPer1MTokens: 0.1,
    dimensions: 1536,
  },
  mistralLLM: {
    model: "mistral-small-latest",
    inputCostPer1MTokens: 0.2,
    outputCostPer1MTokens: 0.6,
  },
};

/**
 * Metrics data structure
 */
export interface Metrics {
  // Embedding metrics
  embeddings: {
    totalCalls: number;
    totalTokens: number;
    totalCost: number;
    byProvider: Record<
      string,
      {
        calls: number;
        tokens: number;
        cost: number;
        avgLatency: number;
        errors: number;
      }
    >;
  };

  // Context optimization metrics (CORE FEATURE)
  context: {
    totalRequests: number;
    totalInputTokens: number;        // Tokens do contexto ANTES da otimização
    totalOptimizedTokens: number;    // Tokens APÓS otimização
    totalSentToLLM: number;          // Tokens realmente enviados para LLM
    avgReductionRatio: number;       // Redução média (ex: 0.7 = 70% redução)
    totalCostSaved: number;          // Custo economizado
    avgLatency: number;
  };

  // Cache metrics
  cache: {
    hits: number;
    misses: number;
    hitRate: number;
    savedCost: number;
    avgHitLatency: number;
    avgMissLatency: number;
  };

  // LLM compression metrics
  compression: {
    totalCalls: number;
    totalInputTokens: number;
    totalOutputTokens: number;
    totalCost: number;
    avgCompressionRatio: number;
    avgLatency: number;
  };

  // Performance metrics
  performance: {
    avgEmbeddingLatency: number;
    p95EmbeddingLatency: number;
    p99EmbeddingLatency: number;
    totalRequests: number;
    errorRate: number;
  };

  // Time tracking
  period: {
    start: string;
    end: string;
    durationHours: number;
  };
}

/**
 * Metrics collector singleton
 */
export class MetricsCollector {
  private static instance: MetricsCollector;
  private metricsPath: string;
  private currentMetrics: Metrics;
  private latencies: number[] = [];

  private constructor() {
    this.metricsPath = resolve(process.cwd(), "data", "metrics.json");
    
    // Ensure data directory exists
    const dataDir = dirname(this.metricsPath);
    if (!existsSync(dataDir)) {
      try {
        mkdirSync(dataDir, { recursive: true });
      } catch (error) {
        console.warn("[Metrics] Failed to create data directory:", error);
      }
    }
    
    this.currentMetrics = this.loadMetrics();
  }

  static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  /**
   * Load metrics from disk or initialize new
   */
  private loadMetrics(): Metrics {
    if (existsSync(this.metricsPath)) {
      try {
        const data = readFileSync(this.metricsPath, "utf-8");
        return JSON.parse(data);
      } catch {
        // If corrupted, start fresh
      }
    }

    return this.initializeMetrics();
  }

  /**
   * Initialize empty metrics
   */
  private initializeMetrics(): Metrics {
    return {
      embeddings: {
        totalCalls: 0,
        totalTokens: 0,
        totalCost: 0,
        byProvider: {},
      },
      context: {
        totalRequests: 0,
        totalInputTokens: 0,
        totalOptimizedTokens: 0,
        totalSentToLLM: 0,
        avgReductionRatio: 0,
        totalCostSaved: 0,
        avgLatency: 0,
      },
      cache: {
        hits: 0,
        misses: 0,
        hitRate: 0,
        savedCost: 0,
        avgHitLatency: 0,
        avgMissLatency: 0,
      },
      compression: {
        totalCalls: 0,
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCost: 0,
        avgCompressionRatio: 0,
        avgLatency: 0,
      },
      performance: {
        avgEmbeddingLatency: 0,
        p95EmbeddingLatency: 0,
        p99EmbeddingLatency: 0,
        totalRequests: 0,
        errorRate: 0,
      },
      period: {
        start: new Date().toISOString(),
        end: new Date().toISOString(),
        durationHours: 0,
      },
    };
  }

  /**
   * Record embedding call
   */
  recordEmbedding(params: {
    provider: string;
    tokens: number;
    latency: number;
    cached: boolean;
    error?: boolean;
  }) {
    const { provider, tokens, latency, cached, error } = params;

    // Safety check: ensure metrics are initialized
    if (!this.currentMetrics || !this.currentMetrics.embeddings) {
      this.currentMetrics = this.initializeMetrics();
    }

    // Initialize provider stats if needed
    if (!this.currentMetrics.embeddings.byProvider[provider]) {
      this.currentMetrics.embeddings.byProvider[provider] = {
        calls: 0,
        tokens: 0,
        cost: 0,
        avgLatency: 0,
        errors: 0,
      };
    }

    const providerStats = this.currentMetrics.embeddings.byProvider[provider];

    // Update provider stats
    providerStats.calls++;
    if (error) {
      providerStats.errors++;
    } else {
      providerStats.tokens += tokens;

      // Calculate cost based on provider
      const pricing =
        PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      if (pricing && "costPer1MTokens" in pricing) {
        const cost = (tokens / 1_000_000) * pricing.costPer1MTokens;
        providerStats.cost += cost;

        if (!cached) {
          this.currentMetrics.embeddings.totalCost += cost;
        }
      }
    }

    // Update avg latency
    providerStats.avgLatency =
      (providerStats.avgLatency * (providerStats.calls - 1) + latency) /
      providerStats.calls;

    // Update global stats
    if (!error) {
      this.currentMetrics.embeddings.totalCalls++;
      this.currentMetrics.embeddings.totalTokens += tokens;
    }

    // Update cache stats
    if (cached) {
      this.currentMetrics.cache.hits++;
      this.currentMetrics.cache.avgHitLatency =
        (this.currentMetrics.cache.avgHitLatency *
          (this.currentMetrics.cache.hits - 1) +
          latency) /
        this.currentMetrics.cache.hits;

      // Calculate saved cost
      const pricing =
        PROVIDER_PRICING[provider as keyof typeof PROVIDER_PRICING];
      if (pricing && "costPer1MTokens" in pricing) {
        const savedCost = (tokens / 1_000_000) * pricing.costPer1MTokens;
        this.currentMetrics.cache.savedCost += savedCost;
      }
    } else {
      this.currentMetrics.cache.misses++;
      this.currentMetrics.cache.avgMissLatency =
        (this.currentMetrics.cache.avgMissLatency *
          (this.currentMetrics.cache.misses - 1) +
          latency) /
        this.currentMetrics.cache.misses;
    }

    // Update cache hit rate
    const totalCacheChecks =
      this.currentMetrics.cache.hits + this.currentMetrics.cache.misses;
    this.currentMetrics.cache.hitRate =
      totalCacheChecks > 0
        ? this.currentMetrics.cache.hits / totalCacheChecks
        : 0;

    // Track latency for percentiles
    this.latencies.push(latency);

    // Update performance metrics
    this.updatePerformanceMetrics();

    // Update time period
    this.currentMetrics.period.end = new Date().toISOString();
    const start = new Date(this.currentMetrics.period.start);
    const end = new Date(this.currentMetrics.period.end);
    this.currentMetrics.period.durationHours =
      (end.getTime() - start.getTime()) / (1000 * 60 * 60);

    // Auto-save every 10 calls
    if (this.currentMetrics.embeddings.totalCalls % 10 === 0) {
      this.save();
    }
  }

  /**
   * Record LLM compression call
   */
  recordCompression(params: {
    inputTokens: number;
    outputTokens: number;
    latency: number;
  }) {
    const { inputTokens, outputTokens, latency } = params;

    this.currentMetrics.compression.totalCalls++;
    this.currentMetrics.compression.totalInputTokens += inputTokens;
    this.currentMetrics.compression.totalOutputTokens += outputTokens;

    // Calculate cost
    const pricing = PROVIDER_PRICING.mistralLLM;
    const inputCost = (inputTokens / 1_000_000) * pricing.inputCostPer1MTokens;
    const outputCost =
      (outputTokens / 1_000_000) * pricing.outputCostPer1MTokens;
    this.currentMetrics.compression.totalCost += inputCost + outputCost;

    // Update avg compression ratio
    const ratio = inputTokens > 0 ? outputTokens / inputTokens : 1;
    this.currentMetrics.compression.avgCompressionRatio =
      (this.currentMetrics.compression.avgCompressionRatio *
        (this.currentMetrics.compression.totalCalls - 1) +
        ratio) /
      this.currentMetrics.compression.totalCalls;

    // Update avg latency
    this.currentMetrics.compression.avgLatency =
      (this.currentMetrics.compression.avgLatency *
        (this.currentMetrics.compression.totalCalls - 1) +
        latency) /
      this.currentMetrics.compression.totalCalls;

    this.save();
  }

  /**
   * Record context optimization (CORE FEATURE)
   * Tracks: input tokens → optimized tokens → sent to LLM
   */
  recordContextOptimization(params: {
    inputTokens: number;        // Original context size
    optimizedTokens: number;    // After compression/optimization
    sentToLLM: number;          // Actually sent to LLM
    latency: number;
    costSaved?: number;         // Optional: calculated cost saving
  }) {
    const { inputTokens, optimizedTokens, sentToLLM, latency, costSaved } = params;

    this.currentMetrics.context.totalRequests++;
    this.currentMetrics.context.totalInputTokens += inputTokens;
    this.currentMetrics.context.totalOptimizedTokens += optimizedTokens;
    this.currentMetrics.context.totalSentToLLM += sentToLLM;

    // Calculate reduction ratio
    const reductionRatio = inputTokens > 0 ? 1 - (sentToLLM / inputTokens) : 0;
    this.currentMetrics.context.avgReductionRatio =
      (this.currentMetrics.context.avgReductionRatio *
        (this.currentMetrics.context.totalRequests - 1) +
        reductionRatio) /
      this.currentMetrics.context.totalRequests;

    // Update cost saved
    if (costSaved !== undefined) {
      this.currentMetrics.context.totalCostSaved += costSaved;
    }

    // Update avg latency
    this.currentMetrics.context.avgLatency =
      (this.currentMetrics.context.avgLatency *
        (this.currentMetrics.context.totalRequests - 1) +
        latency) /
      this.currentMetrics.context.totalRequests;

    this.save();
  }

  /**
   * Update performance metrics (percentiles)
   */
  private updatePerformanceMetrics() {
    if (this.latencies.length === 0) return;

    const sorted = [...this.latencies].sort((a, b) => a - b);

    this.currentMetrics.performance.avgEmbeddingLatency =
      this.latencies.reduce((a, b) => a + b, 0) / this.latencies.length;

    this.currentMetrics.performance.p95EmbeddingLatency =
      sorted[Math.floor(sorted.length * 0.95)] || 0;

    this.currentMetrics.performance.p99EmbeddingLatency =
      sorted[Math.floor(sorted.length * 0.99)] || 0;

    this.currentMetrics.performance.totalRequests = this.latencies.length;

    // Calculate error rate
    const totalErrors = Object.values(
      this.currentMetrics.embeddings.byProvider,
    ).reduce((sum, stats) => sum + stats.errors, 0);
    this.currentMetrics.performance.errorRate =
      this.currentMetrics.performance.totalRequests > 0
        ? totalErrors / this.currentMetrics.performance.totalRequests
        : 0;
  }

  /**
   * Get current metrics
   */
  getMetrics(): Metrics {
    return { ...this.currentMetrics };
  }

  /**
   * Save metrics to disk
   */
  save() {
    try {
      writeFileSync(
        this.metricsPath,
        JSON.stringify(this.currentMetrics, null, 2),
      );
    } catch (error) {
      logger.error("[Metrics] Failed to save:", error as Error);
    }
  }

  /**
   * Reset metrics (start fresh period)
   */
  reset() {
    this.currentMetrics = this.initializeMetrics();
    this.latencies = [];
    this.save();
  }

  /**
   * Get formatted summary
   */
  getSummary(): string {
    const m = this.currentMetrics;

    let summary = "\n📊 massa-ai MCP - Metrics Summary\n";
    summary += "=".repeat(60) + "\n\n";

    // Period
    summary += `⏱️  Period: ${new Date(m.period.start).toLocaleString()} → ${new Date(m.period.end).toLocaleString()}\n`;
    summary += `   Duration: ${m.period.durationHours.toFixed(2)} hours\n\n`;

    // Embeddings
    summary += `🔢 Embeddings\n`;
    summary += `   Total calls: ${m.embeddings.totalCalls.toLocaleString()}\n`;
    summary += `   Total tokens: ${m.embeddings.totalTokens.toLocaleString()}\n`;
    summary += `   Total cost: $${m.embeddings.totalCost.toFixed(4)}\n\n`;

    // By provider
    for (const [provider, stats] of Object.entries(m.embeddings.byProvider)) {
      summary += `   ${provider}:\n`;
      summary += `     Calls: ${stats.calls.toLocaleString()}\n`;
      summary += `     Tokens: ${stats.tokens.toLocaleString()}\n`;
      summary += `     Cost: $${stats.cost.toFixed(4)}\n`;
      summary += `     Avg latency: ${stats.avgLatency.toFixed(0)}ms\n`;
      if (stats.errors > 0) {
        summary += `     ⚠️  Errors: ${stats.errors}\n`;
      }
      summary += "\n";
    }

    // Cache
    summary += `💾 Cache Efficiency\n`;
    summary += `   Hit rate: ${(m.cache.hitRate * 100).toFixed(1)}%\n`;
    summary += `   Hits: ${m.cache.hits.toLocaleString()} (${m.cache.avgHitLatency.toFixed(0)}ms avg)\n`;
    summary += `   Misses: ${m.cache.misses.toLocaleString()} (${m.cache.avgMissLatency.toFixed(0)}ms avg)\n`;
    summary += `   💰 Saved cost: $${m.cache.savedCost.toFixed(4)}\n\n`;

    // Compression
    if (m.compression.totalCalls > 0) {
      summary += `🗜️  LLM Compression\n`;
      summary += `   Calls: ${m.compression.totalCalls.toLocaleString()}\n`;
      summary += `   Input tokens: ${m.compression.totalInputTokens.toLocaleString()}\n`;
      summary += `   Output tokens: ${m.compression.totalOutputTokens.toLocaleString()}\n`;
      summary += `   Avg ratio: ${(m.compression.avgCompressionRatio * 100).toFixed(1)}%\n`;
      summary += `   Cost: $${m.compression.totalCost.toFixed(4)}\n`;
      summary += `   Avg latency: ${m.compression.avgLatency.toFixed(0)}ms\n\n`;
    }

    // Performance
    summary += `⚡ Performance\n`;
    summary += `   Avg latency: ${m.performance.avgEmbeddingLatency.toFixed(0)}ms\n`;
    summary += `   P95 latency: ${m.performance.p95EmbeddingLatency.toFixed(0)}ms\n`;
    summary += `   P99 latency: ${m.performance.p99EmbeddingLatency.toFixed(0)}ms\n`;
    summary += `   Error rate: ${(m.performance.errorRate * 100).toFixed(2)}%\n\n`;

    // Total cost
    const totalCost = m.embeddings.totalCost + m.compression.totalCost;
    const netCost = totalCost - m.cache.savedCost;
    summary += `💰 Total Cost\n`;
    summary += `   Gross: $${totalCost.toFixed(4)}\n`;
    summary += `   Saved (cache): -$${m.cache.savedCost.toFixed(4)}\n`;
    summary += `   Net: $${netCost.toFixed(4)}\n\n`;

    summary += "=".repeat(60) + "\n";

    return summary;
  }
}

// Export singleton instance
export const metrics = MetricsCollector.getInstance();
