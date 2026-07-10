/**
 * HookService — passive lifecycle-event ingestion (Phase 3, G1).
 *
 * Accepts six lifecycle event kinds, validates/normalizes them, persists each
 * as an Observation via the single-writer WriterQueue, emits
 * `observation:ingested`, and (debounce) triggers the consolidation bridge.
 *
 * Contract (spec.md):
 *  - Fire-and-forget: a validated+admitted event returns 202 with its id; the
 *    actual persist runs on the writer turn.
 *  - 429 on saturation: when `WriterQueue.saturated`, `ingestOne`/`ingestBatch`
 *    throw QueueSaturatedError and the route maps to HTTP 429 (no admission).
 *  - 400/413 on validation failure (before admission).
 *  - LLM-free: ingestion has no LLM dependency; the bridge is the only
 *    LLM-touching stage and it silent-degrades.
 */

import { config, logger } from "@massa-th0th/shared";
import { eventBus } from "../events/event-bus.js";
import {
  getObservationStore,
  LIFECYCLE_EVENTS,
  newObservationId,
  type LifecycleEventKind,
  type Observation,
  type ObservationStore,
} from "../../data/memory/observation-repository.js";
import { QueueSaturatedError, WriterQueue } from "./writer-queue.js";
import { extractCategory } from "./observation-extractor.js";

// ── Types ───────────────────────────────────────────────────────────────────

/** Incoming wire shape (before normalization). `event` validated case-insensitively. */
export interface IncomingEvent {
  event: string;
  projectId: string;
  sessionId?: string;
  payload: Record<string, unknown>;
  importance?: number;
  agentId?: string;
  ts?: number;
}

/** Normalized event ready to persist. */
export interface NormalizedEvent {
  event: LifecycleEventKind;
  projectId: string;
  sessionId: string | null;
  payload: Record<string, unknown>;
  importance: number;
  agentId: string | null;
  ts: number;
}

export type ValidationResult =
  | { ok: true; event: NormalizedEvent }
  | { ok: false; code: 400 | 413; error: string };

/** Bridge seam — implemented by ObservationConsolidationJob. Injected for tests. */
export interface BridgeTrigger {
  maybeRun(projectId: string): void;
}

/** No-op bridge default (used before the real job is wired / in tests). */
class NoopBridge implements BridgeTrigger {
  maybeRun(): void {}
}

// ── Validation ──────────────────────────────────────────────────────────────

function clamp(n: number, lo: number, hi: number): number {
  if (Number.isNaN(n)) return lo;
  return Math.min(hi, Math.max(lo, n));
}

/**
 * Validate + normalize a single incoming event. Pure (no IO). Returns a
 * discriminated union; `{ok:false}` carries the HTTP-ish code.
 */
export function validateEvent(
  raw: IncomingEvent,
  maxPayloadBytes: number,
): ValidationResult {
  if (!raw || typeof raw !== "object") {
    return { ok: false, code: 400, error: "event body must be an object" };
  }

  // event kind — case-insensitive normalize to canonical.
  const rawEvent = typeof raw.event === "string" ? raw.event.toLowerCase().trim() : "";
  const kind = LIFECYCLE_EVENTS.find((k) => k === rawEvent);
  if (!kind) {
    return {
      ok: false,
      code: 400,
      error: `unknown event kind: ${String(raw.event)}`,
    };
  }

  // projectId — non-empty string.
  const projectId =
    typeof raw.projectId === "string" ? raw.projectId.trim() : "";
  if (!projectId) {
    return { ok: false, code: 400, error: "projectId must be a non-empty string" };
  }

  // payload — non-empty object.
  if (!raw.payload || typeof raw.payload !== "object" || Array.isArray(raw.payload)) {
    return { ok: false, code: 400, error: "payload must be a non-empty object" };
  }
  if (Object.keys(raw.payload).length === 0) {
    return { ok: false, code: 400, error: "payload must be a non-empty object" };
  }

  // size cap.
  let serialized: string;
  try {
    serialized = JSON.stringify(raw.payload);
  } catch {
    return { ok: false, code: 400, error: "payload is not serializable" };
  }
  if (serialized.length > maxPayloadBytes) {
    return {
      ok: false,
      code: 413,
      error: `payload exceeds maxPayloadBytes (${maxPayloadBytes})`,
    };
  }

  const importance = raw.importance !== undefined ? clamp(Number(raw.importance), 0, 1) : 0.5;

  const sessionId =
    typeof raw.sessionId === "string" && raw.sessionId.trim() ? raw.sessionId : null;
  const agentId =
    typeof raw.agentId === "string" && raw.agentId.trim() ? raw.agentId : null;
  const ts = typeof raw.ts === "number" && raw.ts > 0 ? raw.ts : Date.now();

  return {
    ok: true,
    event: { event: kind, projectId, sessionId, payload: raw.payload, importance, agentId, ts },
  };
}

// ── Service ─────────────────────────────────────────────────────────────────

export interface HookServiceOptions {
  store?: ObservationStore;
  maxPending?: number;
  maxPayloadBytes?: number;
  bridge?: BridgeTrigger;
  /** Override id factory (deterministic tests). */
  idFactory?: () => string;
}

export class HookService {
  readonly store: ObservationStore;
  readonly queue: WriterQueue;
  readonly bridge: BridgeTrigger;
  private readonly maxPayloadBytes: number;
  private readonly idFactory: () => string;

  constructor(opts: HookServiceOptions = {}) {
    this.store = opts.store ?? getObservationStore();
    const configuredMax = readHooksConfig().queue.maxPending;
    this.queue = new WriterQueue(opts.maxPending ?? configuredMax);
    this.maxPayloadBytes =
      opts.maxPayloadBytes ?? readHooksConfig().maxPayloadBytes;
    this.bridge = opts.bridge ?? new NoopBridge();
    this.idFactory = opts.idFactory ?? (() => newObservationId());
  }

  validate(raw: IncomingEvent): ValidationResult {
    return validateEvent(raw, this.maxPayloadBytes);
  }

  /**
   * Validate, admit, and enqueue a single event. Resolves with the observation
   * id (the persist itself runs on the writer turn — fire-and-forget from the
   * caller's perspective, but the id is returned synchronously on admission).
   *
   * Throws QueueSaturatedError → route maps to 429.
   */
  async ingestOne(raw: IncomingEvent): Promise<string> {
    const v = this.validate(raw);
    if (!v.ok) throw new ValidationError(v.code, v.error);

    const id = this.idFactory();
    const ev = v.event;
    // Enqueue the persist + event + bridge trigger. If saturated, throws before
    // any side effect.
    void this.queue.enqueue(async () => {
      const obs: Observation = {
        id,
        projectId: ev.projectId,
        sessionId: ev.sessionId,
        source: ev.event,
        category: extractCategory(ev.event, ev.payload),
        payloadJson: JSON.stringify(ev.payload),
        importance: ev.importance,
        createdAt: ev.ts,
      };
      try {
        this.store.insert(obs);
        eventBus.publish("observation:ingested", {
          observationId: obs.id,
          projectId: obs.projectId,
          sessionId: obs.sessionId ?? undefined,
          source: obs.source,
          importance: obs.importance,
        });
        this.bridge.maybeRun(obs.projectId);
      } catch (e) {
        // Fire-and-forget: a persist failure after admission is logged, not
        // retried, and does NOT poison the queue (spec §11 / design §5).
        logger.warn("observation persist failed", {
          id: obs.id,
          error: (e as Error).message,
        });
      }
    });
    return id;
  }

  /**
   * Validate the whole batch atomically, then admit all. Returns the array of
   * ids in input order. Throws ValidationError (400/413) if ANY event is bad,
   * before persisting anything; throws QueueSaturatedError if the queue cannot
   * admit the full batch.
   */
  async ingestBatch(raws: IncomingEvent[]): Promise<string[]> {
    if (!Array.isArray(raws) || raws.length === 0) {
      throw new ValidationError(400, "events must be a non-empty array");
    }
    // Atomic validation first.
    const validated: NormalizedEvent[] = [];
    for (const raw of raws) {
      const v = this.validate(raw);
      if (!v.ok) throw new ValidationError(v.code, v.error);
      validated.push(v.event);
    }
    // Then admit (may throw QueueSaturatedError).
    const ids: string[] = [];
    for (const ev of validated) {
      ids.push(await this.ingestOneNormalized(ev));
    }
    return ids;
  }

  private async ingestOneNormalized(ev: NormalizedEvent): Promise<string> {
    const id = this.idFactory();
    void this.queue.enqueue(async () => {
      const obs: Observation = {
        id,
        projectId: ev.projectId,
        sessionId: ev.sessionId,
        source: ev.event,
        category: extractCategory(ev.event, ev.payload),
        payloadJson: JSON.stringify(ev.payload),
        importance: ev.importance,
        createdAt: ev.ts,
      };
      try {
        this.store.insert(obs);
        eventBus.publish("observation:ingested", {
          observationId: obs.id,
          projectId: obs.projectId,
          sessionId: obs.sessionId ?? undefined,
          source: obs.source,
          importance: obs.importance,
        });
        this.bridge.maybeRun(obs.projectId);
      } catch (e) {
        logger.warn("observation persist failed", {
          id: obs.id,
          error: (e as Error).message,
        });
      }
    });
    return id;
  }
}

export class ValidationError extends Error {
  constructor(public readonly code: 400 | 413, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

// ── Defensive config reader ─────────────────────────────────────────────────
// Real config always has the hooks block (added in Phase 3). Some test files
// mock @massa-th0th/shared process-wide and omit it; fall back to spec defaults
// (mirrors the Phase-2 QueryUnderstandingService defensive reader pattern).

const FALLBACK_HOOKS = {
  enabled: true,
  maxPayloadBytes: 65_536,
  queue: { maxPending: 256 },
  bridge: {
    enabled: true,
    minObservations: 8,
    minIntervalMs: 5 * 60 * 1000,
    maxWindow: 8,
  },
};

function readHooksConfig() {
  try {
    const c = config.get("hooks");
    if (c && typeof c === "object") return c as typeof FALLBACK_HOOKS;
  } catch {
    /* fall through */
  }
  return FALLBACK_HOOKS;
}

// ── Singleton ───────────────────────────────────────────────────────────────

let cachedService: HookService | null = null;

export function getHookService(): HookService {
  if (cachedService) return cachedService;
  cachedService = new HookService();
  return cachedService;
}

/** Test hook: reset the cached service (and the underlying observation store). */
export function resetHookService(): void {
  cachedService = null;
}
