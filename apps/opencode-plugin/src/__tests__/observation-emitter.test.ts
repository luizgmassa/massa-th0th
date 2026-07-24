/**
 * Unit tests for the opencode-plugin observation emitter (SG-7 / #21).
 *
 * These run fully in isolation — no network, no massa-ai server, no PG.
 * The EmitterDeps are faked (post/log/timers), so the tests are deterministic
 * and fast. They cover:
 *  - payload builders → correct shape (server classifier reads snake_case keys)
 *  - POST /api/v1/hook/batch wire shape ({ events: [...] })
 *  - batching + debounce collapse a burst into one flush
 *  - maxBatch forces an immediate flush
 *  - network failure (post rejects / returns !ok) is swallowed, never rejects
 *  - enabled() gate suppresses emission
 *  - malformed events are dropped client-side (do not poison the batch)
 *  - primary function unaffected: emit() returns synchronously (non-blocking)
 */
import { test, expect, describe, mock, beforeEach } from "bun:test"
import {
  ObservationEmitter,
  buildToolPayload,
  buildPromptPayload,
  buildSessionPayload,
  type EmitterDeps,
  type HookBatchBody,
} from "../observation-emitter"

// ---------------------------------------------------------------------------
// Fake deps
// ---------------------------------------------------------------------------

interface FakeState {
  posts: Array<{ url: string; body: HookBatchBody; timeoutMs: number }>
  postResult: () => Promise<boolean> // override to simulate failure
  logs: Array<{ level: string; message: string }>
  timers: Array<{ fn: () => void; ms: number; fired: boolean }>
  enabledFlag: boolean
  nowMs: number
}

function makeFakeDeps(overrides: Partial<FakeState> = {}): { deps: EmitterDeps; state: FakeState } {
  const state: FakeState = {
    posts: [],
    postResult: () => Promise.resolve(true),
    logs: [],
    timers: [],
    enabledFlag: true,
    nowMs: 1_000,
    ...overrides,
  }
  const deps: EmitterDeps = {
    apiUrl: "http://localhost:3333",
    enabled: () => state.enabledFlag,
    now: () => state.nowMs,
    log: (level, message, extra) => state.logs.push({ level, message: extra ? `${message} ${JSON.stringify(extra)}` : message }),
    setTimer: (fn, ms) => {
      const entry = { fn, ms, fired: false }
      state.timers.push(entry)
      // Return a handle; tests fire manually via fireTimers().
      return entry as unknown as ReturnType<typeof setTimeout>
    },
    clearTimer: () => {
      // no-op for tests (we inspect state.timers)
    },
    post: async (url, body, timeoutMs) => {
      state.posts.push({ url, body, timeoutMs })
      return state.postResult()
    },
  }
  return { deps, state }
}

/** Fire all pending scheduled timers in order (simulates debounce elapsing). */
function fireTimers(state: FakeState): void {
  for (const t of state.timers) {
    if (!t.fired) {
      t.fired = true
      t.fn()
    }
  }
}

// ---------------------------------------------------------------------------
// Payload builder tests
// ---------------------------------------------------------------------------

describe("payload builders", () => {
  test("buildToolPayload emits snake_case tool_name + tool_input/output/cwd", () => {
    const p = buildToolPayload({ tool: "Read", args: { file_path: "/a.ts" }, output: "ok", cwd: "/proj", sessionId: "s1" })
    expect(p.tool_name).toBe("Read")
    expect(p.tool_input).toEqual({ file_path: "/a.ts" })
    expect(p.tool_response).toBe("ok")
    expect(p.cwd).toBe("/proj")
    expect(p.session_id).toBe("s1")
  })

  test("buildToolPayload keeps OpenCode tool names raw (server normalizes)", () => {
    const p = buildToolPayload({ tool: "run_shell_command", args: { command: "git status" } })
    expect(p.tool_name).toBe("run_shell_command")
    expect((p.tool_input as { command: string }).command).toBe("git status")
  })

  test("buildToolPayload omits optional keys when undefined", () => {
    const p = buildToolPayload({ tool: "Bash" })
    expect(Object.keys(p)).toEqual(["tool_name"])
  })

  test("buildPromptPayload emits prompt + message/text aliases", () => {
    const p = buildPromptPayload({ prompt: "/goal ship it", cwd: "/p" })
    expect(p.prompt).toBe("/goal ship it")
    expect(p.message).toBe("/goal ship it")
    expect(p.text).toBe("/goal ship it")
    expect(p.cwd).toBe("/p")
  })

  test("buildSessionPayload omits empty fields", () => {
    const p = buildSessionPayload({ cwd: "/p", model: "gpt" })
    expect(p.cwd).toBe("/p")
    expect(p.model).toBe("gpt")
    expect(Object.keys(p).sort()).toEqual(["cwd", "model"])
  })
})

// ---------------------------------------------------------------------------
// Emitter: batching + debounce
// ---------------------------------------------------------------------------

describe("ObservationEmitter batching/debounce", () => {
  test("single emit schedules a debounced flush; firing timers sends one batch", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps, flushMs: 2_000 })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    expect(state.posts.length).toBe(0) // not yet
    expect(state.timers.length).toBe(1)
    fireTimers(state)
    expect(state.posts.length).toBe(1)
    expect(state.posts[0]!.url).toBe("http://localhost:3333/api/v1/hook/batch")
    expect(state.posts[0]!.body.events.length).toBe(1)
    expect(state.posts[0]!.body.events[0]!.event).toBe("post-tool-use")
  })

  test("a burst collapses into ONE debounced flush", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps, flushMs: 2_000 })
    for (let i = 0; i < 10; i++) {
      e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read", i } })
    }
    // Each emit reschedules the same timer (clearTimer is no-op in fake, but
    // our fake accumulates timers; production uses real clearTimer). We verify
    // the buffer holds all 10 and a single flush sends them as one batch.
    expect(e).toBeDefined()
    await e.flush()
    expect(state.posts.length).toBe(1)
    expect(state.posts[0]!.body.events.length).toBe(10)
  })

  test("maxBatch triggers an immediate (0ms) flush", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps, maxBatch: 3 })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read", n: 1 } })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read", n: 2 } })
    expect(state.posts.length).toBe(0)
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read", n: 3 } })
    // 3rd event hits maxBatch → schedules a 0ms timer
    const lastTimer = state.timers[state.timers.length - 1]!
    expect(lastTimer.ms).toBe(0)
    lastTimer.fn()
    await Promise.resolve()
    expect(state.posts.length).toBe(1)
    expect(state.posts[0]!.body.events.length).toBe(3)
  })

  test("flush() of empty buffer is a no-op (no POST)", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps })
    await e.flush()
    expect(state.posts.length).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Wire shape: matches POST /api/v1/hook/batch contract
// ---------------------------------------------------------------------------

describe("hook batch contract shape", () => {
  test("POST body is { events: [...] } with camelCase top-level + snake_case payload keys", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps })
    e.emit({
      event: "post-tool-use",
      projectId: "my-proj",
      sessionId: "sess-1",
      agentId: "agent-x",
      importance: 0.8,
      payload: { tool_name: "Write", tool_input: { file_path: "/a" }, cwd: "/p" },
    })
    await e.flush()
    expect(state.posts.length).toBe(1)
    const body = state.posts[0]!.body
    expect(Array.isArray(body.events)).toBe(true)
    expect(body.events.length).toBe(1)
    const ev = body.events[0]!
    // camelCase top-level (server Elysia schema)
    expect(ev.projectId).toBe("my-proj")
    expect(ev.sessionId).toBe("sess-1")
    expect(ev.agentId).toBe("agent-x")
    expect(ev.importance).toBe(0.8)
    expect(typeof ev.ts).toBe("number")
    // snake_case inside payload (server classifier)
    expect(ev.payload.tool_name).toBe("Write")
    expect(ev.payload.tool_input).toEqual({ file_path: "/a" })
    expect(ev.payload.cwd).toBe("/p")
  })

  test("default importance/agentId omitted (server defaults apply)", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "session-start", projectId: "p", payload: { cwd: "/p" } })
    await e.flush()
    const ev = state.posts[0]!.body.events[0]!
    expect(ev.importance).toBeUndefined()
    expect(ev.agentId).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// Non-blocking / failure isolation
// ---------------------------------------------------------------------------

describe("non-blocking + failure isolation", () => {
  test("post() rejecting is swallowed; flush() does not reject; warning logged", async () => {
    const { deps, state } = makeFakeDeps({ postResult: () => Promise.reject(new Error("ECONNREFUSED")) })
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    await expect(e.flush()).resolves.toBeUndefined()
    expect(state.posts.length).toBe(1)
    expect(state.logs.some(l => l.level === "warn" && /hook batch ingest failed/.test(l.message))).toBe(true)
  })

  test("post() returning !ok (423/429/5xx) is swallowed + logged", async () => {
    const { deps, state } = makeFakeDeps({ postResult: () => Promise.resolve(false) })
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    await expect(e.flush()).resolves.toBeUndefined()
    expect(state.logs.some(l => l.level === "warn" && /non-ok/.test(l.message))).toBe(true)
  })

  test("enabled() false suppresses all emission (no timers, no posts)", () => {
    const { deps, state } = makeFakeDeps({ enabledFlag: false })
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    expect(state.timers.length).toBe(0)
    expect(state.posts.length).toBe(0)
  })

  test("emit() returns synchronously (non-blocking for primary function)", () => {
    const { deps } = makeFakeDeps()
    const e = new ObservationEmitter({ deps })
    // emit must not await anything — it just buffers + schedules.
    const ret = e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    expect(ret).toBeUndefined() // void, not a Promise
  })

  test("malformed events are dropped client-side (do not poison the batch)", async () => {
    const { deps, state } = makeFakeDeps()
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "post-tool-use", projectId: "", payload: { x: 1 } }) // empty projectId
    e.emit({ event: "post-tool-use", projectId: "p", payload: {} }) // empty payload
    e.emit({ event: "post-tool-use", projectId: "p" } as never) // missing payload
    await e.flush()
    expect(state.posts.length).toBe(0)
  })

  test("dispose() flushes + clears timers and never throws", async () => {
    const { deps, state } = makeFakeDeps({ postResult: () => Promise.reject(new Error("boom")) })
    const e = new ObservationEmitter({ deps })
    e.emit({ event: "post-tool-use", projectId: "p", payload: { tool_name: "Read" } })
    await expect(e.dispose()).resolves.toBeUndefined()
    expect(state.posts.length).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Event → observation mapping coverage (the categories the server derives)
// ---------------------------------------------------------------------------

describe("event → observation lifecycle-kind coverage", () => {
  test("all 6 lifecycle kinds are accepted", async () => {
    const kinds = ["session-start", "user-prompt", "pre-tool-use", "post-tool-use", "pre-compact", "session-end"] as const
    for (const kind of kinds) {
      const { deps, state } = makeFakeDeps()
      const e = new ObservationEmitter({ deps })
      e.emit({ event: kind, projectId: "p", payload: { k: kind } })
      await e.flush()
      expect(state.posts.length).toBe(1)
      expect(state.posts[0]!.body.events[0]!.event).toBe(kind)
    }
  })
})
