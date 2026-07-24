/**
 * runPool — generic in-flight-capped worker pool.
 *
 * Single concurrency primitive for the project: every "run N independent
 * operations with at most M in flight" need routes here. Currently consumed
 * by `batch_execute`; P2-T2 (web fetch + index) will reuse it.
 *
 * Design contract:
 *   - Order-preserving: results[i] corresponds to jobs[i] regardless of
 *     completion order. Implemented by writing into a fixed-index array.
 *   - allSettled-shaped: one job throwing never strands its siblings. A job's
 *     failure surfaces as a `rejected` entry, not a thrown promise.
 *   - CPU-capped: `capByCpuCount` additionally clamps effective concurrency to
 *     `os.cpus().length` for memory-pressure safety.
 *   - Clamped to job count: requesting concurrency 8 for 3 jobs runs 3.
 *   - STANDALONE: imports only `node:os`. Must NOT depend on executor or any
 *     other massa-ai service so it stays a clean reusable export.
 */

import { cpus } from "node:os";

/** A unit of work. `run()` is invoked exactly once per job. */
export interface PoolJob<T> {
  run(): Promise<T>;
}

export interface RunPoolOptions {
  /** Hard concurrency cap (1-N). Auto-clamped to job count. */
  concurrency: number;
  /** Also clamp by `os.cpus().length`. Default false. */
  capByCpuCount?: boolean;
  /** Per-settled callback (progress / metrics). Optional. */
  onSettled?: (idx: number, result: PromiseSettledResult<unknown>) => void;
}

export interface RunPoolResult<T> {
  /** Per-index settled result, ordered by input index (NOT completion). */
  settled: PromiseSettledResult<T>[];
  /** Concurrency actually used after all caps applied. */
  effectiveConcurrency: number;
  /** True when effectiveConcurrency < requested concurrency. */
  capped: boolean;
}

/**
 * Run an array of jobs with bounded concurrency. Returns one settled result
 * per input job, in input order.
 *
 * Implementation: a pool of `effectiveConcurrency` workers pulls the next
 * index from a shared counter. Because each worker writes only to its claimed
 * index, the output array is naturally order-preserving without sorting.
 */
export async function runPool<T>(
  jobs: PoolJob<T>[],
  opts: RunPoolOptions,
): Promise<RunPoolResult<T>> {
  const { concurrency, capByCpuCount = false, onSettled } = opts;

  if (jobs.length === 0) {
    return { settled: [], effectiveConcurrency: 0, capped: false };
  }

  const requested = Math.max(1, Math.floor(concurrency));
  const cpuCap = capByCpuCount ? Math.max(1, cpus().length) : requested;
  const effectiveConcurrency = Math.min(requested, cpuCap, jobs.length);
  const capped = effectiveConcurrency < requested;

  const settled: PromiseSettledResult<T>[] = new Array(jobs.length);
  let nextIdx = 0;

  async function worker(): Promise<void> {
    while (true) {
      const idx = nextIdx++;
      if (idx >= jobs.length) return;
      try {
        const value = await jobs[idx].run();
        settled[idx] = { status: "fulfilled", value };
      } catch (err) {
        settled[idx] = { status: "rejected", reason: err };
      }
      onSettled?.(idx, settled[idx]);
    }
  }

  const workers: Promise<void>[] = [];
  for (let w = 0; w < effectiveConcurrency; w++) workers.push(worker());
  // Belt-and-braces: workers already swallow their own errors, but
  // allSettled guarantees no rejection escapes even if a worker throws.
  await Promise.allSettled(workers);

  return { settled, effectiveConcurrency, capped };
}

/**
 * Convenience: extract only the fulfilled values, preserving order. Rejected
 * entries are dropped (the caller already sees reasons via `settled`).
 */
export function fulfilledValues<T>(
  result: RunPoolResult<T>,
): T[] {
  return result.settled
    .filter((r): r is PromiseFulfilledResult<T> => r.status === "fulfilled")
    .map((r) => r.value);
}
