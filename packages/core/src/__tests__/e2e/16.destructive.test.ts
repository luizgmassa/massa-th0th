/**
 * T13 — DEDICATED-stack destructive suite (E2E).
 *
 * Domain: destructive / global-state mutation. Every scenario in this file
 * mutates a GLOBAL singleton, shared process, or shared backend that is NOT
 * prefix-scoped. They CANNOT run on the shared live stack without disrupting
 * every other producer/consumer. The whole suite defaults to SKIP and only
 * runs when BOTH:
 *
 *   - `RUN_E2E_DESTRUCTIVE=1` is set, AND
 *   - a DEDICATED, DISPOSABLE target stack is provided (via `MASSA_AI_API_URL`
 *     pointing away from the live http://localhost:3333 stack, plus the
 *     corresponding DEDICATED Ollama / PG resources).
 *
 * On the shared stack (the default), every test in this file must SKIP with a
 * printed runbook that explains (a) what it would do, (b) why that is
 * destructive to shared infra, and (c) exactly which dedicated-stack
 * precondition is required to run it for real.
 *
 * WHY EACH SCENARIO IS DESTRUCTIVE (file-level contract):
 *   N1  — Stopping Ollama stops the SHARED Ollama instance, disrupting every
 *         other client indexing/searching against it. Not prefix-scopable.
 *   N3  — Inducing a downstream error (dropping PG / forcing Ollama 500) is a
 *         GLOBAL outage, not a per-project one. Affects every projectId.
 *   N9  — Index throughput timing on the SHARED PG reflects concurrent load
 *         from other clients; a clean ms/file baseline requires a dedicated,
 *         unloaded PG + Ollama pair.
 *   N12 — Embedding mutex serialization timings are skewed by shared Ollama
 *         concurrency (other producers queueing embeds concurrently).
 *   N13 — Cache hit latency on the shared cache reflects contention with other
 *         clients' cache lookups; a clean latency measurement needs a
 *         dedicated stack with a cold, uncontended cache.
 *   E25 — Mid-index API RESTART kills the shared tools-api process (pid 9524),
 *         dropping in-flight requests for ALL projectIds and clearing the
 *         in-memory indexJobTracker for every project.
 *   F87 — Saturating the hook writer queue (firing until 429) blocks every
 *         other producer from admitting lifecycle events globally.
 *   F88 — Toggling HOOKS_ENABLED=false requires a server restart and disables
 *         hook ingest globally for all clients.
 *
 * Read-only: NO production source / prisma / route edits, NO restart of the
 * live tools-api (pid 9524), NO dist rebuild, NO DB schema changes. This file
 * only ADDS a gated test. On the shared stack it must SKIP every scenario.
 */
import { describe, test, expect, afterAll } from "bun:test";
import {
  E2E_ENABLED,
  PREFIX,
  RUN_STAMP,
  PROJECT_PATH,
  assertE2ePrefix,
  probeAvailability,
  httpGet,
  httpPost,
  httpRaw,
  pollUntil,
  resetProject,
  SHARED_PID,
  ensureSharedIndex,
  type Availability,
} from "./_helpers";

// ── DEDICATED STACK GATE ───────────────────────────────────────────────────
//
// HARD GATE: the entire suite is skipped unless RUN_E2E_DESTRUCTIVE=1.
//
// Belt-and-suspenders: even with the gate open, each destructive test that
// CAN be automated (N9 / N12 / N13 / F87) must confirm it is NOT pointed at
// the shared live stack (default http://localhost:3333) before acting. A
// dedicated stack is signaled by MASSA_AI_API_URL being overridden to
// anything other than the default. The orchestration-required tests
// (N1 / N3 / E25 / F88) are static test.skip with a runbook baked into the
// name — they are not executed even on a dedicated stack without external
// orchestration (stopping Ollama, dropping PG, restarting the API, toggling
// config + restart).
const DESTRUCTIVE = process.env.RUN_E2E_DESTRUCTIVE === "1";
const DEFAULT_API = "http://localhost:3333";
const IS_DEDICATED_URL =
  !!process.env.MASSA_AI_API_URL &&
  process.env.MASSA_AI_API_URL !== DEFAULT_API &&
  process.env.MASSA_AI_DEDICATED === "1";

// Shared availability probe; reused across gated tests that need it.
let _avail: Availability | null = null;
async function avail(): Promise<Availability> {
  if (!_avail) _avail = await probeAvailability();
  return _avail;
}

// Track throwaway projectIds for cleanup in afterAll (only relevant on the
// dedicated stack, where some tests actually execute).
const throwaway: string[] = [];
function makePid(n: number): string {
  const id = `${PREFIX}destructive-${RUN_STAMP}-${n}`;
  assertE2ePrefix(id);
  throwaway.push(id);
  return id;
}

// Common runbook preamble baked into each static-skip test name.
const DEDICATED_PREAMBLE =
  `\n[SKIPPED — DEDICATED stack required. This test is destructive to shared infra and ` +
  `MUST NOT run against the live stack (${DEFAULT_API}). To run for real: ` +
  `(1) provision a DISPOSABLE stack (dedicated tools-api + dedicated PG + dedicated Ollama); ` +
  `(2) point this suite at it via MASSA_AI_API_URL=http://<dedicated>:<port>; ` +
  `(3) RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts.]\n` +
  `RUNBOOK:`;

// ═══════════════════════════════════════════════════════════════════════════
// The whole suite is SKIP-by-default. Only the describe() body is entered when
// DESTRUCTIVE=1. On the shared stack (DESTRUCTIVE unset), `describe.skipIf`
// short-circuits the block and every test inside counts as skipped.
// ═══════════════════════════════════════════════════════════════════════════
describe.skipIf(!DESTRUCTIVE)("T13 destructive (DEDICATED stack only)", () => {
  // ── N1 — Ollama down → search/recall/remember must surface failure ────────
  //
  // DESTRUCTIVE: stopping Ollama takes down the SHARED model server for every
  // client. Cannot be prefix-scoped. Requires external orchestration
  // (ollama stop / kill) and a DEDICATED Ollama process that we are allowed
  // to kill. Static skip + runbook: not automated even on a dedicated stack
  // because the test driver cannot safely kill Ollama.
  test.skip(
    `🔴 DEDICATED N1 — Ollama down surfaces failure (not silent zero vectors) ` +
      `${DEDICATED_PREAMBLE}\n` +
      `  Precondition: DEDICATED tools-api + DEDICATED Ollama (e.g. OLLAMA_HOST=http://localhost:11435).\n` +
      `  1. Baseline: with Ollama UP, POST /api/v1/search/project returns non-empty results.\n` +
      `  2. STOP the dedicated Ollama: \`ollama stop <model>\` OR kill its PID (do NOT touch the shared Ollama).\n` +
      `  3. Confirm down: GET /api/v1/system/ollama → available=false, or curl $OLLAMA_HOST/api/tags fails.\n` +
      `  4. POST /api/v1/search/project  → expect {success:false} or 5xx, NOT an empty 200 with zeroed vectors.\n` +
      `  5. POST /api/v1/memory/search   → expect failure surfaced (success:false/empty), not silent fallback.\n` +
      `  6. POST /api/v1/memory/store    → embedding required; expect failure surfaced.\n` +
      `  7. Restart the dedicated Ollama and re-run step 1 to confirm recovery.\n` +
      `  ASSERT: at no point does the API return 200 with results whose vectors are silently all-zero; every failure must be visible to the caller.\n` +
      `  WHY DESTRUCTIVE: stopping Ollama is a GLOBAL outage for all clients of that Ollama instance.`,
    () => {},
  );

  // ── N3 — Silent-degrade: induced downstream error must be wrapped ─────────
  //
  // DESTRUCTIVE: inducing a downstream error means dropping PG or forcing
  // Ollama to 500. Both are GLOBAL — every projectId loses its backend. The
  // proxy wrap contract (apps/mcp-client/src/index.ts:197-209) must catch and
  // return {success:false}, never throw uncaught through MCP. Requires
  // external orchestration (drop PG / break Ollama). Static skip + runbook.
  test.skip(
    `🔴 DEDICATED N3 — induced downstream error is wrapped, no uncaught throw ` +
      `${DEDICATED_PREAMBLE}\n` +
      `  Precondition: DEDICATED tools-api + DEDICATED PG + DEDICATED Ollama.\n` +
      `  Proxy wrap line: apps/mcp-client/src/index.ts:197-209 (catches tool errors → {success:false, error}).\n` +
      `  1. Induce a downstream failure ONE of:\n` +
      `     a. DROP PG: stop the dedicated postgres container / kill the PID.\n` +
      `     b. Force Ollama 500: stop it (see N1) or point OLLAMA_HOST at a port returning HTTP 500.\n` +
      `  2. Through the MCP stdio driver (startMcp + mcpCall), invoke search / recall / remember.\n` +
      `  3. ASSERT: each MCP tool response is JSON {success:false, error:<msg>} — the proxy wrap held.\n` +
      `  4. ASSERT: no MCP response is a raw exception / transport-close / empty content (uncaught throw).\n` +
      `  5. ASSERT: the HTTP API returns 5xx (not a 200 with {success:true, results:[]} silent-degrade).\n` +
      `  6. Restore PG / Ollama and confirm recovery.\n` +
      `  WHY DESTRUCTIVE: dropping PG or Ollama is a GLOBAL outage, not prefix-scoped.`,
    () => {},
  );

  // ── N9 — Index throughput baseline (ms/file) on a DEDICATED stack ─────────
  //
  // GATED REAL TEST. Not catastrophic, but the measurement is only meaningful
  // on an UNLOADED dedicated stack. On the shared stack the timing reflects
  // concurrent load. When DESTRUCTIVE=1 AND MASSA_AI_API_URL points away
  // from the default, this test runs for real and records a warn-only
  // baseline. Otherwise it early-returns with a runbook log line.
  test(
    "🔴 DEDICATED N9 — index throughput ms/file baseline (warn, not fail)",
    async () => {
      if (!IS_DEDICATED_URL) {
        console.log(
          `[N9] SKIP: needs a DEDICATED stack (set MASSA_AI_API_URL ≠ ${DEFAULT_API}) for a clean baseline. ` +
            `On the shared stack, concurrent load makes ms/file meaningless. Runbook: ` +
            `provision dedicated tools-api+PG+Ollama, point MASSA_AI_API_URL at it, ` +
            `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts.`,
        );
        return;
      }
      const a = await avail();
      if (!a.API_UP || !a.OLLAMA_UP) {
        console.log(
          `[N9] SKIP: dedicated stack not up (API_UP=${a.API_UP} OLLAMA_UP=${a.OLLAMA_UP}). ` +
            `Bring up the dedicated tools-api + Ollama before running.`,
        );
        return;
      }

      // Index the full repo on a throwaway projectId and measure wall-clock
      // ms/file as a baseline. Warn-not-fail by design.
      const pid = makePid(9);
      assertE2ePrefix(pid);

      const t0 = Date.now();
      const start = await httpPost<any>("/api/v1/project/index", {
        projectPath: PROJECT_PATH,
        projectId: pid,
        forceReindex: true,
      });
      const jobId: string | undefined = start?.data?.jobId ?? start?.jobId;

      if (jobId) {
        await pollUntil(
          async () => {
            try {
              const s = await httpGet<any>(`/api/v1/project/index/status/${jobId}`);
              const st = s?.data?.status;
              return st === "completed" || st === "indexed" || st === "failed";
            } catch {
              return false;
            }
          },
          { timeoutMs: 900_000, intervalMs: 5_000 },
        );
      }
      const elapsedMs = Date.now() - t0;

      const finalStatus = jobId
        ? (await httpGet<any>(`/api/v1/project/index/status/${jobId}`))?.data?.status
        : (start?.data?.status ?? "completed");

      // Try to read a file count from the job result; fall back to 0 if the
      // API does not surface one.
      let files = 0;
      try {
        const s = jobId
          ? (await httpGet<any>(`/api/v1/project/index/status/${jobId}`))?.data
          : start?.data;
        files =
          s?.result?.files ??
          s?.result?.fileCount ??
          s?.files ??
          s?.stats?.files ??
          0;
      } catch {
        files = 0;
      }

      await resetProject(pid).catch(() => {});

      const msPerFile = files > 0 ? Math.round(elapsedMs / files) : null;
      console.log(
        `[N9] DEDICATED baseline: status=${finalStatus} elapsedMs=${elapsedMs} files=${files} ms/file=${msPerFile}`,
      );

      // Contract: BASELINE / warn-not-fail. We only assert the run completed
      // non-fatally and emitted a positive elapsed time; the actual threshold
      // is recorded for trend tracking, not gating.
      expect(["completed", "indexed"]).toContain(finalStatus);
      expect(elapsedMs).toBeGreaterThan(0);
      console.log(
        `[N9] BASELINE recorded (warn-only): ms/file=${msPerFile ?? "n/a"}. ` +
          `Thresholds tracked out-of-band, not asserted here.`,
      );
    },
    1_200_000,
  );

  // ── N12 — Embedding mutex serialization latency (parallel embeds) ──────────
  //
  // GATED REAL TEST. Shared Ollama skews the timings. Only meaningful on a
  // dedicated stack. When DESTRUCTIVE=1 AND MASSA_AI_API_URL points away
  // from the default, this test runs for real. Otherwise early-return + log.
  test(
    "🔴 DEDICATED N12 — parallel embeds serialize; observe latency",
    async () => {
      if (!IS_DEDICATED_URL) {
        console.log(
          `[N12] SKIP: needs a DEDICATED stack (set MASSA_AI_API_URL ≠ ${DEFAULT_API}); ` +
            `shared Ollama skews mutex-serialization timings. Runbook: ` +
            `provision dedicated tools-api+Ollama, point MASSA_AI_API_URL at it, ` +
            `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts.`,
        );
        return;
      }
      const a = await avail();
      if (!a.API_UP || !a.OLLAMA_UP) {
        console.log(`[N12] SKIP: dedicated stack not up (API_UP=${a.API_UP} OLLAMA_UP=${a.OLLAMA_UP}).`);
        return;
      }

      // Ensure there is a searchable shared project to query against. On a
      // dedicated stack this may be cold; fall back to SHARED_PID if indexing
      // is not feasible.
      const shared = await ensureSharedIndex().catch(() => SHARED_PID);

      // Fire N parallel searches; the contextual-search-rlm mutex serializes
      // the embed step. Measure the spread as a baseline. Warn-not-fail.
      const N = 6;
      const t0 = Date.now();
      const fires = Array.from({ length: N }, (_, i) =>
        httpPost<any>("/api/v1/search/project", {
          query: `mutex serialization probe ${i} ${RUN_STAMP}`,
          projectId: shared,
          maxResults: 1,
          minScore: 0.05,
          format: "json",
        })
          .then((r) => ({ ok: true, ms: Date.now() - t0, r }))
          .catch((e) => ({ ok: false, ms: Date.now() - t0, err: String(e?.message ?? e) })),
      );
      const results = await Promise.all(fires);

      const oks = results.filter((x) => x.ok);
      const maxMs = Math.max(...results.map((x) => x.ms));
      const minMs = Math.min(...results.map((x) => x.ms));
      console.log(
        `[N12] DEDICATED: ${N} parallel searches; ${oks.length} ok; ` +
          `min=${minMs}ms max=${maxMs}ms spread=${maxMs - minMs}ms`,
      );

      // Warn-not-fail: assert no crash and that all calls resolved.
      expect(oks.length).toBe(N);
      expect(maxMs).toBeGreaterThan(0);
    },
    600_000,
  );

  // ── N13 — Cache hit faster + byte-identical modulo _rrfRawVectorScore ──────
  //
  // GATED REAL TEST. Cache contention on the shared stack skews latency. When
  // DESTRUCTIVE=1 AND MASSA_AI_API_URL points away from the default, runs
  // for real. Otherwise early-return + log.
  test(
    "🔴 DEDICATED N13 — repeat identical search: cache hit faster + identical modulo _rrfRawVectorScore",
    async () => {
      if (!IS_DEDICATED_URL) {
        console.log(
          `[N13] SKIP: needs a DEDICATED stack (set MASSA_AI_API_URL ≠ ${DEFAULT_API}); ` +
            `shared cache contention skews latency. Runbook: ` +
            `provision dedicated tools-api (cold, uncontended cache), point MASSA_AI_API_URL at it, ` +
            `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts.`,
        );
        return;
      }
      const a = await avail();
      if (!a.API_UP || !a.OLLAMA_UP) {
        console.log(`[N13] SKIP: dedicated stack not up (API_UP=${a.API_UP} OLLAMA_UP=${a.OLLAMA_UP}).`);
        return;
      }

      const shared = await ensureSharedIndex().catch(() => SHARED_PID);
      const query = `cache identity probe ${RUN_STAMP}`;

      // Cold call (cache miss / embed path).
      const t0 = Date.now();
      const cold = await httpPost<any>("/api/v1/search/project", {
        query,
        projectId: shared,
        maxResults: 5,
        minScore: 0.05,
        format: "json",
      });
      const coldMs = Date.now() - t0;

      // Hot call (cache hit).
      const t1 = Date.now();
      const hot = await httpPost<any>("/api/v1/search/project", {
        query,
        projectId: shared,
        maxResults: 5,
        minScore: 0.05,
        format: "json",
      });
      const hotMs = Date.now() - t1;

      console.log(`[N13] DEDICATED: cold=${coldMs}ms hot=${hotMs}ms delta=${coldMs - hotMs}ms`);

      // Byte-identical modulo the volatile `_rrfRawVectorScore` per-result
      // field (allowed to float). Deep-compare the stripped result shape.
      const strip = (res: any) => {
        const arr = (res?.data?.results ?? res?.results ?? []) as any[];
        return arr.map((h: any) => {
          const { _rrfRawVectorScore, ...rest } = h ?? {};
          return rest;
        });
      };
      const coldStrip = JSON.stringify(strip(cold));
      const hotStrip = JSON.stringify(strip(hot));

      // Warn-not-fail on latency: cache hit SHOULD be faster, but on a tiny
      // dedicated box jitter can flip it. We assert identity strongly and
      // report the latency delta as a baseline observation.
      if (hotMs > coldMs) {
        console.log(
          `[N13] WARN: hot (${hotMs}ms) was NOT faster than cold (${coldMs}ms) — jitter on small box; not failing.`,
        );
      }
      expect(hotStrip).toBe(coldStrip);
      console.log(`[N13] result bodies byte-identical modulo _rrfRawVectorScore: OK`);
    },
    300_000,
  );

  // ── E25 — Mid-index API restart → stale `running` jobs marked failed ──────
  //
  // DESTRUCTIVE: restarting the API kills the shared tools-api process and
  // drops in-flight requests + the in-memory indexJobTracker for EVERY
  // projectId. Requires external process orchestration. Static skip +
  // runbook — not automated because the test driver cannot safely restart
  // the API process.
  test.skip(
    `🔴 DEDICATED E25 — mid-index API restart marks stale running jobs failed ` +
      `${DEDICATED_PREAMBLE}\n` +
      `  Precondition: DEDICATED tools-api whose process you control (NOT pid 9524).\n` +
      `  1. Start a long index: POST /api/v1/project/index with a large projectPath on a throwaway e2e-ai-* projectId.\n` +
      `  2. Capture the jobId from the response.\n` +
      `  3. MID-FLIGHT, restart the dedicated tools-api process (e.g. \`kill <dedicated-pid>; <restart-unit>\`).\n` +
      `  4. After reboot, GET /api/v1/project/index/status/<jobId>.\n` +
      `  5. ASSERT: the stale \`running\` job is marked \`failed\` with a reason like \`process restart\`\n` +
      `     (the boot path reconciles in-memory tracker state against durable status).\n` +
      `  6. ASSERT: no in-flight request silently returns success; the caller observes failure.\n` +
      `  7. Re-issue the index on a fresh jobId and confirm it reaches \`completed\` normally.\n` +
      `  WHY DESTRUCTIVE: restarting the API drops in-flight requests + clears the in-memory job tracker for ALL projectIds.`,
    () => {},
  );

  // ── F87 — Hook-queue saturation → 429 (gated real test) ───────────────────
  //
  // GATED REAL TEST. Saturating the GLOBAL hook writer queue blocks every
  // other producer. When DESTRUCTIVE=1 AND MASSA_AI_API_URL points away
  // from the default, fire batches in a tight loop until 429 or a cap;
  // assert the contract held (429 returned, not a 5xx crash). Otherwise
  // early-return + log.
  test(
    "🔴 DEDICATED F87 — saturate hook writer queue → 429 (or document threshold)",
    async () => {
      if (!IS_DEDICATED_URL) {
        console.log(
          `[F87] SKIP: needs a DEDICATED stack (set MASSA_AI_API_URL ≠ ${DEFAULT_API}); ` +
            `saturating the GLOBAL hook queue blocks every other producer. Runbook: ` +
            `provision dedicated tools-api, point MASSA_AI_API_URL at it, ` +
            `RUN_E2E_DESTRUCTIVE=1 RUN_E2E=1 bun test src/__tests__/e2e/16.destructive.test.ts.`,
        );
        return;
      }
      const a = await avail();
      if (!a.API_UP) {
        console.log(`[F87] SKIP: dedicated stack not up (API_UP=${a.API_UP}).`);
        return;
      }

      // Fire hook batches in a tight loop until we see 429 (writer queue
      // saturated) or hit the cap. Each batch is small + valid so the only
      // rejection path is QueueSaturatedError → 429
      // (apps/tools-api/src/routes/hooks.ts:97).
      const CAP = 200; // generous; the queue is bounded well below this.
      const makeEvents = (i: number) => [
        {
          event: "user-prompt",
          projectId: PREFIX,
          sessionId: `f87-${RUN_STAMP}-${i}`,
          payload: { n: i, probe: "f87-saturation" },
        },
      ];

      let first429: number | null = null;
      let lastStatus = 0;
      let admitted = 0;
      let rejected = 0;
      for (let i = 0; i < CAP; i++) {
        const res = await httpRaw("/api/v1/hook/batch", {
          method: "POST",
          body: JSON.stringify({ events: makeEvents(i) }),
        });
        lastStatus = res.status;
        if (res.status === 202) admitted++;
        if (res.status === 429) {
          rejected++;
          if (first429 === null) first429 = i;
          // Observed saturation. Stop hammering so the queue can drain.
          break;
        }
        if (res.status >= 500) {
          console.log(`[F87] unexpected 5xx at i=${i}: ${res.status}`);
          break;
        }
      }

      console.log(
        `[F87] DEDICATED: admitted=${admitted} rejected(429)=${rejected} ` +
          `first429At=${first429} lastStatus=${lastStatus}`,
      );

      if (first429 === null) {
        // Did not saturate within CAP. Document the threshold observation as
        // a non-failing finding (queue may be large / fast-draining).
        console.log(
          `[F87] did NOT observe 429 within ${CAP} batches — queue drained faster than we could saturate. ` +
            `Documented saturation threshold: > ${CAP} concurrent batches. Treat as warn-only.`,
        );
        // Soft-assert: accept either outcome; the destructive gate is what
        // protected the shared stack. Surface both possibilities explicitly.
        expect(admitted).toBeGreaterThan(0);
        return;
      }

      // Saturation observed → assert the contract held: 429 was returned
      // (not a 5xx crash, not a silent 202).
      expect(first429).not.toBeNull();
      expect(lastStatus).toBe(429);
    },
    300_000,
  );

  // ── F88 — HOOKS_ENABLED=false → hook ingest returns 423 ───────────────────
  //
  // DESTRUCTIVE: toggling HOOKS_ENABLED requires a server restart and disables
  // hook ingest GLOBALLY for all clients. Requires process + config
  // orchestration. Static skip + runbook.
  test.skip(
    `🔴 DEDICATED F88 — HOOKS_ENABLED=false → hook ingest returns 423 ` +
      `${DEDICATED_PREAMBLE}\n` +
      `  Precondition: DEDICATED tools-api whose config you control (NOT the shared stack).\n` +
      `  1. Baseline: with hooks.enabled=true (default), POST /api/v1/hook/batch returns 202.\n` +
      `  2. STOP the dedicated tools-api.\n` +
      `  3. Set config: hooks.enabled=false (config.json or env equiv) on the dedicated stack only.\n` +
      `  4. RESTART the dedicated tools-api so it picks up the new config.\n` +
      `  5. POST /api/v1/hook/batch with a valid event → ASSERT status=423, body.error='hooks disabled'\n` +
      `     (apps/tools-api/src/routes/hooks.ts:88-90).\n` +
      `  6. POST /api/v1/hook (single) → same: ASSERT 423 (hooks.ts:43-45).\n` +
      `  7. Restore hooks.enabled=true and restart; confirm 202 returns.\n` +
      `  WHY DESTRUCTIVE: toggling HOOKS_ENABLED is a GLOBAL flag affecting every client; also requires a server restart.`,
    () => {},
  );
});

// Defensive: on the off chance the gate was open and we actually ran something
// against a dedicated stack, clean up any throwaway projectIds we created.
// On the shared stack (gate off) this is a no-op.
afterAll(async () => {
  if (!DESTRUCTIVE) return;
  await Promise.all(
    throwaway.map((id) =>
      resetProject(id).catch((e) =>
        console.log(`[T13] cleanup failed for ${id}: ${String(e?.message ?? e)}`),
      ),
    ),
  );
});
