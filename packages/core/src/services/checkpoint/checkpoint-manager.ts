/** Backend-neutral checkpoint facade backed exclusively by PostgreSQL. */
import { requirePostgresDatabaseUrl } from "@massa-ai/shared/config";
import { PgCheckpointStore } from "./checkpoint-store-pg.js";
import type { RestoreResult } from "@massa-ai/shared";
export type { CheckpointMetadata } from "./checkpoint-store.js";
export class CheckpointManager extends PgCheckpointStore {
  private static instance: CheckpointManager | null = null;
  static getInstance(): CheckpointManager {
    requirePostgresDatabaseUrl();
    return this.instance ??= new CheckpointManager();
  }
  async restoreCheckpoint(checkpointId: string): Promise<RestoreResult | null> {
    const checkpoint = this.getCheckpoint(checkpointId);
    if (!checkpoint) return null;
    const existing = new Set(await this.countExistingMemoryIds(checkpoint.memoryIds));
    const validMemoryIds = checkpoint.memoryIds.filter((id) => existing.has(id));
    const missingMemoryIds = checkpoint.memoryIds.filter((id) => !existing.has(id));
    const fileConflicts: string[] = [];
    const restoreInstructions = [
      `Restore checkpoint ${checkpoint.id} for task ${checkpoint.taskId}.`,
      missingMemoryIds.length ? `Missing memories: ${missingMemoryIds.join(", ")}.` : "All referenced memories are available.",
    ].join("\n");
    return { checkpoint, validMemoryIds, missingMemoryIds, fileConflicts, restoreInstructions };
  }
}
