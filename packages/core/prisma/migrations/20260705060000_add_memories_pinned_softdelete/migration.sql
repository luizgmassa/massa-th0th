-- Add pinned (decay-exempt) and deleted_at (soft-delete tombstone) to memories.
-- schema.prisma declares both (lines 35, 37) and the PG repository writes them,
-- but no prior migration created the columns — every memory store/update/delete
-- failed with PG 42703 "column pinned of relation memories does not exist".
-- Additive, safe, matches the schema.
ALTER TABLE "memories" ADD COLUMN "pinned" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memories" ADD COLUMN "deleted_at" TIMESTAMP(3);

-- Sparse index on deleted_at (most rows NULL). Matches @@index([deletedAt]).
CREATE INDEX "memories_deleted_at_idx" ON "memories"("deleted_at");
