import type { MemoryLevel, MemoryType } from "@massa-ai/shared";

export interface MemoryRow {
  id: string; content: string; type: string; level: number;
  user_id: string | null; session_id: string | null; project_id: string | null; agent_id: string | null;
  importance: number; tags: string; embedding: Buffer | null; metadata: string | null;
  created_at: number; updated_at: number; access_count: number; last_accessed: number | null;
  pinned: number; deleted_at: number | null;
}
export interface InsertMemoryInput {
  id: string; content: string; type: MemoryType; level: MemoryLevel;
  userId?: string; sessionId?: string; projectId?: string; agentId?: string;
  importance: number; tags: string[]; embedding: number[]; metadata?: Record<string, unknown>; pinned?: boolean;
}
export interface SearchFilters {
  userId?: string; sessionId?: string; projectId?: string; agentId?: string;
  types?: MemoryType[]; minImportance: number; includePersistent: boolean; limit: number;
}
export interface UpdateMemoryPatch {
  content?: string; importance?: number; tags?: string[]; embedding?: number[]; pinned?: boolean;
}
