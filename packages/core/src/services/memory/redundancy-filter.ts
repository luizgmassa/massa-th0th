/** PostgreSQL-backed duplicate detection and consolidation for memories. */
import { logger } from "@massa-ai/shared";
import { Prisma } from "../../generated/prisma/index.js";
import { getPrismaClient } from "../query/prisma-client.js";
import { TokenMetrics } from "../metrics/token-metrics.js";
import type { MemoryRowWithEmbedding } from "../graph/types.js";

export interface DuplicatePair { keepId: string; removeId: string; similarity: number; reason: string; }
export interface MergeResult { merged: number; edgesTransferred: number; accessCountsBoosted: number; }
export interface CleanupStats { duplicatesFound: number; merged: number; edgesTransferred: number; durationMs: number; }

export class RedundancyFilter {
  private static instance: RedundancyFilter | null = null;
  static getInstance(): RedundancyFilter { return this.instance ??= new RedundancyFilter(); }

  async findDuplicates(threshold = 0.95, scanLimit = 300): Promise<DuplicatePair[]> {
    const rows = await getPrismaClient().$queryRaw<MemoryRowWithEmbedding[]>`
      SELECT id, content, type, level, importance, array_to_json(tags)::text AS tags, embedding,
        created_at, updated_at, access_count, user_id, session_id, project_id, agent_id
      FROM memories WHERE embedding IS NOT NULL AND deleted_at IS NULL
      ORDER BY created_at DESC LIMIT ${scanLimit}`;
    const groups = new Map<string, Array<{ row: MemoryRowWithEmbedding; vector: Float32Array; norm: number }>>();
    for (const row of rows) {
      if (!row.embedding) continue;
      const bytes = Buffer.from(row.embedding);
      const vector = new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.byteLength / 4));
      let norm = 0; for (const value of vector) norm += value * value; norm = Math.sqrt(norm);
      if (!norm) continue;
      const group = groups.get(row.type) ?? []; group.push({ row, vector, norm }); groups.set(row.type, group);
    }
    const pairs: DuplicatePair[] = []; const removed = new Set<string>();
    for (const group of groups.values()) for (let left = 0; left < group.length; left++) for (let right = left + 1; right < group.length; right++) {
      const a = group[left]; const b = group[right];
      if (removed.has(a.row.id) || removed.has(b.row.id) || a.vector.length !== b.vector.length) continue;
      let dot = 0; for (let index = 0; index < a.vector.length; index++) dot += a.vector[index] * b.vector[index];
      const similarity = dot / (a.norm * b.norm); if (similarity < threshold) continue;
      const keep = a.row.importance !== b.row.importance ? (a.row.importance > b.row.importance ? a : b) : a.row.access_count >= b.row.access_count ? a : b;
      const drop = keep === a ? b : a; removed.add(drop.row.id);
      pairs.push({ keepId: keep.row.id, removeId: drop.row.id, similarity, reason: keep.row.importance !== drop.row.importance ? "Higher importance" : "Higher access count" });
    }
    return pairs;
  }

  async mergeDuplicates(pairs: DuplicatePair[]): Promise<MergeResult> {
    if (!pairs.length) return { merged: 0, edgesTransferred: 0, accessCountsBoosted: 0 };
    const prisma = getPrismaClient(); let merged = 0; let edgesTransferred = 0; let accessCountsBoosted = 0;
    await prisma.$transaction(async (tx) => {
      for (const pair of pairs) {
        const rows = await tx.$queryRaw<Array<{ content: string; access_count: number }>>`SELECT content, access_count FROM memories WHERE id = ${pair.removeId} FOR UPDATE`;
        if (!rows[0]) continue;
        const moved = await tx.$executeRaw`
          INSERT INTO memory_edges (from_id, to_id, edge_type, weight, metadata, created_at, updated_at)
          SELECT CASE WHEN from_id = ${pair.removeId} THEN ${pair.keepId} ELSE from_id END,
                 CASE WHEN to_id = ${pair.removeId} THEN ${pair.keepId} ELSE to_id END,
                 edge_type, weight, metadata, NOW(), NOW()
          FROM memory_edges WHERE (from_id = ${pair.removeId} OR to_id = ${pair.removeId})
            AND from_id <> ${pair.keepId} AND to_id <> ${pair.keepId}
          ON CONFLICT (from_id, to_id, edge_type) DO UPDATE SET weight = GREATEST(memory_edges.weight, EXCLUDED.weight), updated_at = NOW()`;
        await tx.$executeRaw`DELETE FROM memory_edges WHERE from_id = ${pair.removeId} OR to_id = ${pair.removeId}`;
        await tx.$executeRaw`UPDATE memories SET access_count = access_count + ${rows[0].access_count}, updated_at = NOW() WHERE id = ${pair.keepId}`;
        await tx.$executeRaw`DELETE FROM memories WHERE id = ${pair.removeId}`;
        TokenMetrics.getInstance().recordRedundancyFilterSavings(rows[0].content);
        merged++; edgesTransferred += Number(moved); if (rows[0].access_count > 0) accessCountsBoosted++;
      }
    });
    logger.info("RedundancyFilter: merge complete", { merged, edgesTransferred, accessCountsBoosted });
    return { merged, edgesTransferred, accessCountsBoosted };
  }

  async runCleanup(threshold = 0.95): Promise<CleanupStats> {
    const start = Date.now(); const pairs = await this.findDuplicates(threshold); const result = await this.mergeDuplicates(pairs);
    return { duplicatesFound: pairs.length, merged: result.merged, edgesTransferred: result.edgesTransferred, durationMs: Date.now() - start };
  }
  close(): void { RedundancyFilter.instance = null; }
}
