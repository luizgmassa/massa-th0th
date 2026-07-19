export const PROPOSAL_STATUSES = ["pending", "approved", "rejected"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_KINDS = ["memory.create", "memory.update", "memory.tag"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export interface CreateMemoryPayload { content: string; type?: string; level?: number; importance?: number; tags?: string[]; }
export interface UpdateMemoryPayload { content?: string; importance?: number; tags?: string[]; }
export interface TagMemoryPayload { tags: string[]; }
export type ProposalPayload = CreateMemoryPayload | UpdateMemoryPayload | TagMemoryPayload;
export interface ProposalRecord { id: string; projectId: string; kind: ProposalKind; targetMemoryId: string | null; payload: ProposalPayload; rationale: string; status: ProposalStatus; createdAt: number; decidedAt: number | null; }

export interface ProposalStore {
  insert(p: ProposalRecord): Promise<void>;
  getById(id: string): Promise<ProposalRecord | null>;
  listPending(projectId: string): Promise<ProposalRecord[]>;
  setStatus(id: string, status: "approved" | "rejected", decidedAt?: number): Promise<ProposalRecord | null>;
  journalMode(): Promise<string>;
}

export class MemoryProposalStore implements ProposalStore {
  public rows: ProposalRecord[] = [];

  async insert(row: ProposalRecord): Promise<void> {
    this.rows.push(structuredClone(row));
  }

  async getById(id: string): Promise<ProposalRecord | null> {
    const row = this.rows.find((item) => item.id === id);
    return row ? structuredClone(row) : null;
  }

  async listPending(projectId: string): Promise<ProposalRecord[]> {
    return this.rows
      .filter((row) => row.projectId === projectId && row.status === "pending")
      .sort((a, b) => a.createdAt - b.createdAt)
      .map((row) => structuredClone(row));
  }

  async setStatus(
    id: string,
    status: "approved" | "rejected",
    decidedAt?: number,
  ): Promise<ProposalRecord | null> {
    const row = this.rows.find((item) => item.id === id);
    if (!row) return null;
    if (row.status !== "pending") return structuredClone(row);
    row.status = status;
    row.decidedAt = decidedAt ?? Date.now();
    return structuredClone(row);
  }

  async journalMode(): Promise<string> {
    return "memory";
  }
}
