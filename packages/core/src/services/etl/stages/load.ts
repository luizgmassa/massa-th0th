/**
 * ETL Stage 4 — Load
 *
 * Persists ResolvedFile data in parallel to:
 *   1. Vector store   — embedding chunks for semantic search
 *   2. Keyword store  — lexical/trigram/fuzzy search over the same chunks
 *   3. Symbol DB      — definitions, references, imports for graph navigation
 *
 * Each file is written atomically (PostgreSQL transaction per file).
 * Updates the symbol_files fingerprint table on success.
 */

import { logger } from "@massa-ai/shared";
import { getVectorStore } from "../../../data/vector/vector-store-factory.js";
import { getKeywordSearch } from "../../../data/keyword/keyword-search-factory.js";
import { getSymbolRepository } from "../../../data/symbol/symbol-repository-factory.js";
import { ManagedRunRepositoryPg } from "../../../data/managed-runs/managed-run-repository-pg.js";
import type {
  SymbolDefinition,
  SymbolReference,
  SymbolImport,
} from "../../../data/symbol/symbol-repository-pg.js";
import type {
  EtlStageContext,
  ResolvedFile,
  RawSymbol,
  ResolvedEdge,
} from "../stage-context.js";
import path from "node:path";
import { getLanguageManifestEntry } from "../../structural/language-manifest.js";

export interface LoadResult {
  filesLoaded: number;
  chunksLoaded: number;
  symbolsLoaded: number;
  errors: number;
}

export type LoadMode = "all" | "structural" | "semantic";

/** Human-readable duration: "42s", "3m 12s", "1h 04m". */
function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  if (totalSec < 60) return `${totalSec}s`;
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  if (m < 60) return `${m}m ${s.toString().padStart(2, "0")}s`;
  const h = Math.floor(m / 60);
  const mm = m % 60;
  return `${h}h ${mm.toString().padStart(2, "0")}m`;
}

export function buildSymbolPersistenceBatch(
  projectId: string,
  file: ResolvedFile,
  now = Date.now(),
): { definitions: SymbolDefinition[]; references: SymbolReference[]; imports: SymbolImport[] } {
  const filePath = file.file.relativePath;
  const definitions: SymbolDefinition[] = file.symbols.map((sym: RawSymbol) => ({
    id: sym.fqn ?? `${filePath}#${sym.name}`,
    project_id: projectId,
    file_path: filePath,
    name: sym.name,
    kind: sym.kind,
    line_start: sym.lineStart,
    line_end: sym.lineEnd,
    exported: sym.exported,
    doc_comment: sym.docComment,
    indexed_at: now,
  }));
  const importRefs: SymbolReference[] = file.resolvedImports
    .filter((imp) => !imp.external && imp.raw.form !== "esm_re_export")
    .flatMap((imp) =>
      (imp.raw.bindings ?? imp.raw.names.map((name) => ({ imported: name, local: name, typeOnly: imp.raw.isTypeOnly }))).map((binding) => ({
        project_id: projectId,
        from_file: filePath,
        from_line: imp.raw.span?.start.row !== undefined ? imp.raw.span.start.row + 1 : 1,
        symbol_name: binding.local,
        // A resolved file is not proof of an exact definition identity. T10+
        // can bind this through generation-owned metadata; T9 never guesses.
        target_fqn: undefined,
        ref_kind: "import" as const,
        meta: imp.raw.span ? { sourceSpan: imp.raw.span, importedName: binding.imported } : null,
      })),
    );
  const edgeRefs: SymbolReference[] = (file.resolvedEdges ?? []).map((edge: ResolvedEdge) => ({
    project_id: projectId,
    from_file: filePath,
    from_line: edge.line,
    symbol_name: edge.symbolName,
    target_fqn: edge.targetFqn,
    ref_kind: edge.kind,
    meta: {
      ...(edge.meta ?? {}),
      ...(edge.span ? { sourceSpan: edge.span } : {}),
      ...(edge.sourceFqn ? { callerFqn: edge.sourceFqn } : {}),
    },
  }));
  const imports: SymbolImport[] = file.resolvedImports.map((imp) => ({
    project_id: projectId,
    from_file: filePath,
    to_file: imp.resolvedPath ?? undefined,
    specifier: imp.raw.specifier,
    imported_names: imp.raw.names,
    is_external: imp.external,
    is_type_only: imp.raw.isTypeOnly,
  }));
  return { definitions, references: [...importRefs, ...edgeRefs], imports };
}

export class LoadStage {
  private vectorStore: Awaited<ReturnType<typeof getVectorStore>> | null = null;
  private keywordSearch: ReturnType<typeof getKeywordSearch> | null = null;
  // ── Wave 5 FR-10: lazily-instantiated repository for FileCursor writes.
  // Only constructed when ctx carries a managedRunLease (else no-op).
  private managedRunRepo: ManagedRunRepositoryPg | null = null;

  private async ensureVectorStore() {
    if (!this.vectorStore) {
      this.vectorStore = await getVectorStore();
    }
    return this.vectorStore;
  }

  private ensureKeywordSearch() {
    if (!this.keywordSearch) {
      this.keywordSearch = getKeywordSearch();
    }
    return this.keywordSearch;
  }

  private ensureManagedRunRepo(): ManagedRunRepositoryPg {
    if (!this.managedRunRepo) this.managedRunRepo = ManagedRunRepositoryPg.getInstance();
    return this.managedRunRepo;
  }

  async run(ctx: EtlStageContext, files: ResolvedFile[], mode: LoadMode = "all", emitLifecycle = true): Promise<LoadResult> {
    const t0 = performance.now();
    const toLoadCount = files.filter((f) => f.file.needsReparse).length;

    if (emitLifecycle) ctx.emit({
      type: "stage_start",
      stage: "load",
      payload: { total: files.length, toLoad: toLoadCount },
      timestamp: Date.now(),
    });

    if (toLoadCount > 0) {
      logger.info("ETL Load starting", {
        projectId: ctx.projectId,
        filesToLoad: toLoadCount,
        filesSkipped: files.length - toLoadCount,
      });
    }

    let filesLoaded = 0;
    let chunksLoaded = 0;
    let symbolsLoaded = 0;
    let errors = 0;
    let processedSinceStart = 0; // files that actually ran (not skipped) — for ETA rate
    let lastEtaLogAt = 0;

    // Process in batches of 10 to avoid overwhelming the embedding service
    const BATCH = 10;

    for (let i = 0; i < files.length; i += BATCH) {
      if (ctx.abortSignal?.aborted) throw ctx.abortSignal.reason;
      const batch = files.slice(i, i + BATCH);

      await Promise.all(
        batch.map(async (file) => {
          if (!file.file.needsReparse) return; // skip unchanged files

          try {
            const [chunkCount, symCount] = await Promise.all([
              mode === "structural" ? Promise.resolve(0) : this.loadToSearchStores(ctx, file),
              mode === "semantic" ? Promise.resolve(file.symbols.length) : this.loadToSymbolDb(ctx, file),
            ]);

            if (!ctx.graphGenerationLease && mode !== "structural") {
              await getSymbolRepository().upsertFile({
                project_id: ctx.projectId,
                relative_path: file.file.relativePath,
                content_hash: file.file.contentHash,
                mtime: file.file.mtime,
                size: file.file.size,
                indexed_at: Date.now(),
                symbol_count: symCount,
                chunk_count: chunkCount,
              });
            }

            // ── Wave 5 FR-10 / AD-W5-016: persist a FileCursor after the
            // vector load + symbol write commit so a kill/restart resumes
            // from the NEXT file. The cursor's `path` is the file just
            // applied; `offset` is the file size (fully applied). Discover
            // skips files at-or-before the cursor when it resumes, so this
            // file's vectors are not re-applied on a clean restart. On a
            // kill mid-load, this UPDATE never runs → the cursor stays at
            // the PREVIOUS file → restart re-processes this file (vectors
            // upsert idempotently via deterministic doc ids, so a partial
            // re-apply is safe — AC-24).
            if (ctx.managedRunLease) {
              try {
                const repo = this.ensureManagedRunRepo();
                const cursorOutcome = await repo.updateFileCursor(ctx.managedRunLease, {
                  path: file.file.relativePath,
                  offset: file.file.size,
                });
                if (cursorOutcome.status === "lease_lost") {
                  // The managed run lease is gone (reaped or stolen). Let the
                  // pipeline's heartbeat loop discover this and abort; the
                  // cursor write is best-effort here.
                  logger.warn("LoadStage: managed_run cursor write saw lease_lost", {
                    projectId: ctx.projectId,
                    filePath: file.file.relativePath,
                  });
                }
              } catch (cursorError) {
                logger.error("LoadStage: managed_run cursor write failed", cursorError as Error, {
                  projectId: ctx.projectId,
                  filePath: file.file.relativePath,
                });
              }
            }

            filesLoaded++;
            chunksLoaded += chunkCount;
            symbolsLoaded += symCount;
            processedSinceStart++;

            if (emitLifecycle) ctx.emit({
              type: "file_processed",
              stage: "load",
              payload: {
                filePath: file.file.relativePath,
                chunks: chunkCount,
                symbols: symCount,
                status: "ok",
              },
              timestamp: Date.now(),
            });
          } catch (err) {
            errors++;
            processedSinceStart++;
            if (emitLifecycle) ctx.emit({
              type: "file_error",
              stage: "load",
              payload: { filePath: file.file.relativePath, error: (err as Error).message },
              timestamp: Date.now(),
            });
            logger.error("LoadStage: failed to load file", err as Error, {
              projectId: ctx.projectId,
              filePath: file.file.relativePath,
            });
          }
        }),
      );

      const current = Math.min(i + BATCH, files.length);
      const elapsedMs = performance.now() - t0;
      const remainingToLoad = Math.max(0, toLoadCount - processedSinceStart);
      // Only compute ETA once we have a real sample and files left to process
      const filesPerSec = processedSinceStart > 0 && elapsedMs > 0
        ? (processedSinceStart / elapsedMs) * 1000
        : 0;
      const etaMs = filesPerSec > 0 && remainingToLoad > 0
        ? Math.round(remainingToLoad / filesPerSec * 1000)
        : 0;

      if (emitLifecycle) ctx.emit({
        type: "progress",
        stage: "load",
        payload: {
          current,
          total: files.length,
          percentage: Math.round((current / files.length) * 100),
          processed: processedSinceStart,
          toLoad: toLoadCount,
          elapsedMs: Math.round(elapsedMs),
          filesPerSec: Number(filesPerSec.toFixed(2)),
          etaMs,
        },
        timestamp: Date.now(),
      });

      // Throttle ETA log to at most every 5s so it stays informative, not spammy
      if (
        etaMs > 0 &&
        processedSinceStart >= BATCH &&
        elapsedMs - lastEtaLogAt >= 5000
      ) {
        lastEtaLogAt = elapsedMs;
        logger.info("ETL Load progress", {
          projectId: ctx.projectId,
          processed: processedSinceStart,
          toLoad: toLoadCount,
          percentage: Math.round((processedSinceStart / toLoadCount) * 100),
          filesPerSec: Number(filesPerSec.toFixed(2)),
          eta: formatDuration(etaMs),
          elapsed: formatDuration(elapsedMs),
        });
      }
    }

    const durationMs = Math.round(performance.now() - t0);

    if (emitLifecycle) ctx.emit({
      type: "stage_end",
      stage: "load",
      payload: { filesLoaded, chunksLoaded, symbolsLoaded, errors, durationMs },
      timestamp: Date.now(),
    });

    logger.info("ETL Load complete", {
      projectId: ctx.projectId,
      filesLoaded,
      chunksLoaded,
      symbolsLoaded,
      errors,
      durationMs,
      duration: formatDuration(durationMs),
      filesPerSec: filesLoaded > 0 && durationMs > 0
        ? Number(((filesLoaded / durationMs) * 1000).toFixed(2))
        : 0,
    });

    return { filesLoaded, chunksLoaded, symbolsLoaded, errors };
  }

  /** Insert identical chunks into both semantic and lexical stores. */
  private async loadToSearchStores(ctx: EtlStageContext, file: ResolvedFile): Promise<number> {
    if (file.chunks.length === 0) return 0;

    const vs = await this.ensureVectorStore();
    const keywordSearch = this.ensureKeywordSearch();

    const documents = file.chunks.map((chunk, i) => ({
      id: `${ctx.projectId}:${file.file.relativePath}:${i}`,
      content: chunk.content,
      metadata: {
        projectId: ctx.projectId,
        filePath: file.file.relativePath,
        chunkIndex: i,
        totalChunks: file.chunks.length,
        type: chunk.type,
        language: file.file.relativePath.split(".").pop() ?? "",
        lineStart: chunk.lineStart,
        lineEnd: chunk.lineEnd,
        label: chunk.label,
      },
    }));

    await Promise.all([
      vs.addDocuments(documents),
      "addBatch" in keywordSearch && typeof keywordSearch.addBatch === "function"
        ? keywordSearch.addBatch(documents)
        : Promise.all(
            documents.map((doc) =>
              keywordSearch.index(doc.id, doc.content, doc.metadata),
            ),
          ),
    ]);
    return documents.length;
  }

  /** Insert symbols, references, and imports into the symbol DB. Returns symbol count. */
  private async loadToSymbolDb(ctx: EtlStageContext, file: ResolvedFile): Promise<number> {
    const filePath = file.file.relativePath;
    const batch = buildSymbolPersistenceBatch(ctx.projectId, file);

    if (ctx.graphGenerationLease) {
      const manifest = getLanguageManifestEntry(path.extname(filePath));
      const diagnostics = (file.structuralDiagnostics ?? []).slice(0, 10).map((diagnostic) => ({
        code: diagnostic.code,
        severity: diagnostic.severity,
        message: diagnostic.message,
        ...(diagnostic.span ? { span: diagnostic.span } : {}),
      }));
      const write = await getSymbolRepository().writeFileGeneration({
        lease: ctx.graphGenerationLease,
        file: {
          project_id: ctx.projectId,
          relative_path: filePath,
          content_hash: file.file.contentHash,
          mtime: file.file.mtime,
          size: file.file.size,
          indexed_at: Date.now(),
          symbol_count: batch.definitions.length,
          chunk_count: file.chunks.length,
          language: manifest?.language,
          dialect: manifest?.dialect,
          grammar_version: manifest?.grammarArtifact.version,
          query_pack_version: manifest?.queryPackVersion,
          resolver_version: manifest?.resolverVersion,
          parser_status: file.structuralRecovered ? "recovered" : "ok",
          parser_error_count: file.structuralDiagnosticCount ?? diagnostics.length,
          diagnostics,
          is_stale: false,
        },
        definitions: batch.definitions,
        references: batch.references,
        imports: batch.imports,
      });
      if (write.status !== "written") throw new Error("graph_generation_lease_lost");
    } else {
      await getSymbolRepository().writeFileSymbols(
        ctx.projectId,
        filePath,
        batch.definitions,
        batch.references,
        batch.imports,
      );
    }

    return batch.definitions.length;
  }
}
