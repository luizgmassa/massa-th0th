/**
 * WriterQueue — single-writer serialization for hook ingestion (Phase 3,
 * cross-cutting §4).
 *
 * Mirrors the promise-chain mutex at
 * packages/core/src/services/embeddings/provider.ts:323-337. Serializes
 * observation persist writes so the hook fire-hose cannot starve readers
 * (paired with WAL + busy_timeout on the observation DB).
 *
 * Saturation: when `pending >= maxPending`, `enqueue` throws
 * QueueSaturatedError and the route maps it to HTTP 429 (no admission).
 */

export class QueueSaturatedError extends Error {
  constructor(public readonly retryAfterSeconds = 1) {
    super("writer queue saturated");
    this.name = "QueueSaturatedError";
  }
}

export class WriterQueue {
  private tail: Promise<void> = Promise.resolve();
  private pending = 0;

  constructor(private readonly maxPending: number) {}

  get pendingCount(): number {
    return this.pending;
  }

  get maxPendingCount(): number {
    return this.maxPending;
  }

  get saturated(): boolean {
    return this.pending >= this.maxPending;
  }

  /**
   * Admit `work` onto the single-writer chain. Throws QueueSaturatedError if
   * the queue is full (caller maps to 429). The returned promise resolves when
   * this work has executed (caller MAY await or fire-and-forget).
   *
   * A failure in one work item never poisons the chain: each step's
   * finalize-decrement runs in both resolve and reject branches.
   */
  enqueue(work: () => Promise<void>): Promise<void> {
    if (this.saturated) throw new QueueSaturatedError();

    this.pending++;
    const run = this.tail.then(
      () => work(),
      () => work(),
    );
    this.tail = run.then(
      () => {
        this.pending--;
      },
      () => {
        this.pending--;
      },
    );
    return run;
  }
}
