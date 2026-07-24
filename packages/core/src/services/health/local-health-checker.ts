/** PostgreSQL/pgvector health checks used by local system status endpoints. */
import { config, logger } from "@massa-ai/shared";
import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { getPgPool } from "../../data/db-connection.js";
import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import {
  getSearchDiagnostics,
  type SearchDiagnostic,
} from "../search/search-diagnostics.js";

export interface ServiceStatus { available: boolean; latency?: number; error?: string; details?: Record<string, unknown>; }
export interface LocalHealthReport {
  status: "healthy" | "degraded" | "unhealthy"; mode: "postgresql"; timestamp: string;
  services: { ollama: ServiceStatus; dataDirectory: ServiceStatus; vectorStore: ServiceStatus; keywordSearch: ServiceStatus; cache: ServiceStatus; embeddingCache: ServiceStatus; };
  diagnostics: { search: readonly SearchDiagnostic[] };
  summary: { total: number; healthy: number; degraded: number; failed: number; }; recommendations: string[];
}
export interface OllamaModelInfo { name: string; size: number; digest: string; modified_at: string; }

export class LocalHealthChecker {
  private readonly ollamaBaseUrl = process.env.OLLAMA_BASE_URL || "http://localhost:11434";
  private readonly dataDir = config.get("dataDir") as string;

  async checkAll(): Promise<LocalHealthReport> {
    const [ollama, dataDirectory, database] = await Promise.all([this.checkOllama(), this.checkDataDirectory(), this.checkPostgres()]);
    const services = { ollama, dataDirectory, vectorStore: database, keywordSearch: database, cache: database, embeddingCache: database };
    const unique = [ollama, dataDirectory, database];
    const healthy = unique.filter((status) => status.available).length;
    const failed = unique.length - healthy;
    const status = failed === 0 ? "healthy" : healthy > failed ? "degraded" : "unhealthy";
    return { status, mode: "postgresql", timestamp: new Date().toISOString(), services, diagnostics: { search: getSearchDiagnostics() }, summary: { total: unique.length, healthy, degraded: 0, failed }, recommendations: this.generateRecommendations(services) };
  }

  async checkOllama(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), 3_000);
      const response = await fetch(`${this.ollamaBaseUrl}/api/tags`, { signal: controller.signal }); clearTimeout(timeout);
      if (!response.ok) return { available: false, latency: Date.now() - start, error: `Ollama responded with HTTP ${response.status}` };
      const models = ((await response.json()) as { models?: OllamaModelInfo[] }).models || [];
      const embeddingModel = process.env.OLLAMA_EMBEDDING_MODEL || (config.getAll() as any)?.embedding?.model || "nomic-embed-text:latest";
      return { available: true, latency: Date.now() - start, details: { url: this.ollamaBaseUrl, modelsAvailable: models.length, models: models.map((model) => model.name), embeddingModel, hasEmbeddingModel: models.some((model) => model.name === embeddingModel || model.name.startsWith(embeddingModel.split(":")[0])) } };
    } catch (error) { return { available: false, latency: Date.now() - start, error: `Ollama unreachable: ${(error as Error).message}` }; }
  }

  async checkDataDirectory(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      if (!existsSync(this.dataDir)) await fs.mkdir(this.dataDir, { recursive: true });
      const probe = path.join(this.dataDir, ".health-check-test"); await fs.writeFile(probe, "ok"); await fs.unlink(probe);
      return { available: true, latency: Date.now() - start, details: { path: this.dataDir, writable: true } };
    } catch (error) { return { available: false, latency: Date.now() - start, error: `Data directory error: ${(error as Error).message}` }; }
  }

  async checkPostgres(): Promise<ServiceStatus> {
    const start = Date.now();
    try {
      const url = new URL(requirePostgresDatabaseUrl());
      const pool = await getPgPool();
      const result = await pool.query<{ extension_installed: boolean; size_bytes: string }>("SELECT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') AS extension_installed, pg_database_size(current_database())::text AS size_bytes");
      const details = { backend: "postgres", database: decodeURIComponent(url.pathname.slice(1)), host: url.hostname, port: Number(url.port || 5432), sizeBytes: Number(result.rows[0]?.size_bytes || 0), pgvector: result.rows[0]?.extension_installed === true };
      if (!details.pgvector) return { available: false, latency: Date.now() - start, error: "pgvector extension is not installed", details };
      return { available: true, latency: Date.now() - start, details };
    } catch (error) { return { available: false, latency: Date.now() - start, error: `PostgreSQL health check failed: ${(error as Error).message}` }; }
  }

  async isOllamaReady(): Promise<boolean> { return (await this.checkOllama()).available; }
  async getOllamaModels(): Promise<string[]> { const result = await this.checkOllama(); return result.details?.models as string[] || []; }
  private generateRecommendations(services: LocalHealthReport["services"]): string[] {
    const recommendations: string[] = [];
    if (!services.vectorStore.available) recommendations.push("Configure a reachable PostgreSQL DATABASE_URL with pgvector, then deploy Prisma migrations.");
    if (!services.ollama.available) recommendations.push("Install and start Ollama, then pull the configured embedding model.");
    if (!services.dataDirectory.available) recommendations.push(`Create writable data directory: mkdir -p ${this.dataDir}`);
    return recommendations.length ? recommendations : ["PostgreSQL, pgvector, Ollama, and local artifacts are healthy."];
  }
}
let healthCheckerInstance: LocalHealthChecker | null = null;
export function getHealthChecker(): LocalHealthChecker { return healthCheckerInstance ??= new LocalHealthChecker(); }
