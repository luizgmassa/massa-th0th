/**
 * Symbol Repository - PostgreSQL Implementation (N31 facade).
 * Singleton + 1-line delegates to per-domain modules. Barrel re-exports keep
 * import paths unchanged. See M14 delegate pattern.
 */
import { logger } from "@massa-th0th/shared";
import type { GraphGenerationLease } from "../graph-generation/graph-generation-contract.js";
import type {
  SymbolKind, RefKind, WorkspaceStatus, SymbolFileRow, SymbolDefinition,
  SymbolReference, SymbolImport, CentralityEntry, WorkspaceRow,
  ProjectMapGraphSnapshot, ProjectMapSnapshotOptions, ActiveGenerationScope,
  GenerationFileWrite, DefinitionFqnResolution,
  WorkspaceUpsertInput, WorkspaceStatusUpdateOptions, ProjectMapAggregatesResult,
  ActiveGraphSnapshot, MarkFileStaleInput, FindEdgesOptions, ListDefinitionsOptions,
  ListAllDefinitionsOptions,
} from "./symbol-repo-types.js";

// Barrel re-exports (import paths unchanged)
export type {
  SymbolKind, RefKind, WorkspaceStatus, SymbolFileRow, SymbolDefinition,
  SymbolReference, SymbolImport, CentralityEntry, WorkspaceRow,
  ProjectMapGraphSnapshot, ProjectMapSnapshotOptions, ActiveGenerationScope,
  GenerationFileWrite, DefinitionFqnResolution,
  WorkspaceUpsertInput, WorkspaceStatusUpdateOptions, ProjectMapAggregatesResult,
  ActiveGraphSnapshot, MarkFileStaleInput, FindEdgesOptions, ListDefinitionsOptions,
  ListAllDefinitionsOptions,
} from "./symbol-repo-types.js";
export type { TransactionClient } from "./symbol-repo-identity.js";
export { definitionIdentityColumns, generationDefinitionIdentityColumns, referenceSourceSpan } from "./symbol-repo-identity.js";
export type { WsRaw, FileRaw, DefRaw, RefRaw, ImpRaw } from "./symbol-repo-mappers.js";
export { mapWs, mapFile, mapDef, mapRef, mapImp } from "./symbol-repo-mappers.js";

import {
  copyFileGeneration, writeFileGeneration, deleteFileGeneration,
  markFileStaleGeneration, updateCentralityGeneration, writeFileSymbols,
} from "./symbol-repo-generation.js";
import * as queries from "./symbol-repo-queries.js";
import * as graph from "./symbol-repo-graph.js";

export class SymbolRepositoryPg {
  private static instance: SymbolRepositoryPg | null = null;
  private constructor() { logger.info("SymbolRepositoryPg initialized (PostgreSQL)"); }
  static getInstance(): SymbolRepositoryPg {
    if (!SymbolRepositoryPg.instance) SymbolRepositoryPg.instance = new SymbolRepositoryPg();
    return SymbolRepositoryPg.instance;
  }

  // Workspace
  async upsertWorkspace(ws: WorkspaceUpsertInput): Promise<void> { return queries.upsertWorkspace(ws); }
  async updateWorkspaceStatus(projectId: string, status: WorkspaceStatus, opts?: WorkspaceStatusUpdateOptions | string): Promise<void> { return queries.updateWorkspaceStatus(projectId, status, opts); }
  async getWorkspace(projectId: string): Promise<WorkspaceRow | null> { return queries.getWorkspace(projectId); }
  async listWorkspaces(): Promise<WorkspaceRow[]> { return queries.listWorkspaces(); }
  async deleteWorkspace(projectId: string): Promise<void> { return queries.deleteWorkspace(projectId); }

  // File
  async upsertFile(file: SymbolFileRow): Promise<void> { return queries.upsertFile(file); }
  async getFile(projectId: string, relativePath: string): Promise<SymbolFileRow | null> { return queries.getFile(projectId, relativePath); }

  // Definition
  async upsertDefinition(def: SymbolDefinition): Promise<void> { return queries.upsertDefinition(def); }
  async deleteDefinitionsByFile(projectId: string, filePath: string): Promise<number> { return queries.deleteDefinitionsByFile(projectId, filePath); }
  async searchDefinitions(projectId: string, query?: string, kinds?: SymbolKind[], exportedOnly?: boolean, limit: number = 20, filePath?: string): Promise<SymbolDefinition[]> { return queries.searchDefinitions(projectId, query, kinds, exportedOnly, limit, filePath); }
  async countDefinitions(projectId: string, query?: string, kinds?: SymbolKind[], exportedOnly?: boolean, filePath?: string): Promise<number> { return queries.countDefinitions(projectId, query, kinds, exportedOnly, filePath); }
  async getDefinition(projectId: string, fqn: string): Promise<SymbolDefinition | null> { return queries.getDefinition(projectId, fqn); }

  // Reference
  async insertReference(ref: SymbolReference): Promise<void> { return queries.insertReference(ref); }
  async deleteReferencesByFile(projectId: string, filePath: string): Promise<number> { return queries.deleteReferencesByFile(projectId, filePath); }
  async getReferences(projectId: string, symbolName: string, limit: number = 50): Promise<SymbolReference[]> { return queries.getReferences(projectId, symbolName, limit); }

  // Import
  async insertImport(imp: SymbolImport): Promise<void> { return queries.insertImport(imp); }
  async deleteImportsByFile(projectId: string, filePath: string): Promise<number> { return queries.deleteImportsByFile(projectId, filePath); }
  async getImportsFrom(projectId: string, filePath: string): Promise<SymbolImport[]> { return queries.getImportsFrom(projectId, filePath); }

  // Centrality
  async upsertCentrality(entry: CentralityEntry): Promise<void> { return queries.upsertCentrality(entry); }
  async getTopCentralFiles(projectId: string, limit: number = 20): Promise<CentralityEntry[]> { return queries.getTopCentralFiles(projectId, limit); }
  async getCentrality(projectId: string): Promise<Map<string, number>> { return queries.getCentrality(projectId); }

  // Batch
  async batchUpsertDefinitions(defs: SymbolDefinition[]): Promise<void> { return queries.batchUpsertDefinitions(defs); }
  async batchInsertReferences(refs: SymbolReference[]): Promise<void> { return queries.batchInsertReferences(refs); }
  async batchInsertImports(imports: SymbolImport[]): Promise<void> { return queries.batchInsertImports(imports); }

  // Generation-scoped writes
  async copyFileGeneration(lease: GraphGenerationLease, sourceGenerationId: string, filePath: string): Promise<{ status: "copied" | "missing" | "lease_lost" }> { return copyFileGeneration(lease, sourceGenerationId, filePath); }
  async writeFileGeneration(input: { lease: GraphGenerationLease } & GenerationFileWrite): Promise<{ status: "written" | "lease_lost" }> { return writeFileGeneration(input); }
  async deleteFileGeneration(lease: GraphGenerationLease, filePath: string): Promise<{ status: "deleted" | "lease_lost" }> { return deleteFileGeneration(lease, filePath); }
  async markFileStaleGeneration(lease: GraphGenerationLease, filePath: string, input: MarkFileStaleInput): Promise<{ status: "stale" | "lease_lost" }> { return markFileStaleGeneration(lease, filePath, input); }
  async updateCentralityGeneration(lease: GraphGenerationLease, entries: readonly { filePath: string; score: number }[]): Promise<{ status: "written" | "lease_lost" }> { return updateCentralityGeneration(lease, entries); }
  async writeFileSymbols(projectId: string, filePath: string, defs: SymbolDefinition[], refs: SymbolReference[], imports: SymbolImport[]): Promise<void> { return writeFileSymbols(projectId, filePath, defs, refs, imports); }

  // Graph queries
  async getProjectMapAggregates(projectId: string, recentLimit: number = 10): Promise<ProjectMapAggregatesResult> { return graph.getProjectMapAggregates(projectId, recentLimit); }
  async getProjectMapSnapshot(projectId: string, opts: ProjectMapSnapshotOptions = {}): Promise<ProjectMapGraphSnapshot | null> { return graph.getProjectMapSnapshot(projectId, opts); }
  async getActiveGraphSnapshot(projectId: string): Promise<ActiveGraphSnapshot | null> { return graph.getActiveGraphSnapshot(projectId); }
  async resolveDefinitionFqn(projectId: string, fqn: string): Promise<DefinitionFqnResolution> { return graph.resolveDefinitionFqn(projectId, fqn); }
  async allFiles(projectId: string): Promise<string[]> { return graph.allFiles(projectId); }
  async allImportEdges(projectId: string): Promise<SymbolImport[]> { return graph.allImportEdges(projectId); }
  async runBfsCteImpact(projectId: string, changedFiles: string[], opts: { depth: number; maxImpacted: number }): Promise<{ file: string; hop: number }[]> { return graph.runBfsCteImpact(projectId, changedFiles, opts); }
  async findImporters(projectId: string, filePath: string): Promise<SymbolImport[]> { return graph.findImporters(projectId, filePath); }
  async findReferencesByFqn(projectId: string, fqn: string): Promise<SymbolReference[]> { return graph.findReferencesByFqn(projectId, fqn); }
  async findReferencesByName(projectId: string, symbolName: string): Promise<SymbolReference[]> { return graph.findReferencesByName(projectId, symbolName); }
  async findEdges(projectId: string, opts: FindEdgesOptions = {}): Promise<SymbolReference[]> { return graph.findEdges(projectId, opts); }
  async countEdgesByKind(projectId: string): Promise<Record<string, number>> { return graph.countEdgesByKind(projectId); }
  async updateCentrality(projectId: string, scores: Map<string, number>): Promise<void> { return graph.updateCentrality(projectId, scores); }

  // Query helpers + composite
  async clearProject(projectId: string): Promise<void> { return queries.clearProject(projectId); }
  async getActiveGenerationScope(projectId: string): Promise<ActiveGenerationScope | null> { return queries.getActiveGenerationScope(projectId); }
  async findDefinitionsByName(projectId: string, name: string): Promise<SymbolDefinition[]> { return queries.findDefinitionsByName(projectId, name); }
  async findDefinitionByFqn(projectId: string, fqn: string): Promise<SymbolDefinition | null> { return queries.findDefinitionByFqn(projectId, fqn); }
  async findDependencies(projectId: string, fromFile: string): Promise<SymbolImport[]> { return queries.findDependencies(projectId, fromFile); }
  async listDefinitions(projectId: string, opts: ListDefinitionsOptions = {}): Promise<SymbolDefinition[]> { return queries.listDefinitions(projectId, opts); }
  async listAllDefinitions(projectId: string, opts: ListAllDefinitionsOptions = {}): Promise<SymbolDefinition[]> { return queries.listAllDefinitions(projectId, opts); }
}