---
name: synapse-usage
description: Use the massa-ai Synapse cognitive modulation layer to get focused, low-noise retrieval during multi-step coding tasks. Open a session, prime the buffer with known-relevant memories, pass synapseSessionId on every search, and prefetch when opening a file. Triggers on tasks involving repeated searches in the same context (debugging, code review, refactor, onboarding) where retrieval quality matters more than one-shot speed.
license: MIT
metadata:
  author: S1LV4, luizgmassa
  version: "1.0.0"
---

# synapse-usage Skill

Use the massa-ai **Synapse** cognitive modulation layer to get focused, low-noise retrieval during multi-step coding tasks. Synapse does not replace `search` or `optimized_context` — it modulates *which results survive and in what order* based on session context, task alignment, agent affinity, intent, recency, and result diversity.

## When to Apply

Activate Synapse whenever the same task will issue **more than one search** in the same conversation:

- Multi-step debugging (error → handler → config)
- Code review (PR → history → tests)
- Refactor across files (usages → definitions → tests)
- Onboarding to a new module (entry point → calls → decisions)
- Any prolonged session where the same files/concepts will reappear

Skip Synapse for one-shot lookups; the overhead does not pay back.

## Interface

Synapse is exposed via the massa-ai MCP server (10 Synapse tools: `synapse_session`, `synapse_get`, `synapse_update`, `synapse_end`, `synapse_prime`, `synapse_access`, `synapse_prefetch`, `synapse_list`, `synapse_task_begin`, `synapse_task_end`) and, as a fallback when the MCP adapter is unavailable, via the tools-API REST endpoints at `http://localhost:3333/api/v1/synapse/...`. Prefer MCP; fall back to REST only after a documented MCP schema or adapter failure. The eight REST endpoints are:

| Endpoint | Purpose |
|----------|---------|
| `POST   /api/v1/synapse/session` | Create a session, returns `sessionId` |
| `GET    /api/v1/synapse/session/:id` | Inspect session state |
| `PATCH  /api/v1/synapse/session/:id` | Update task context (refreshes TTL) |
| `DELETE /api/v1/synapse/session/:id` | End session |
| `POST   /api/v1/synapse/session/:id/prime` | Seed buffer with known-relevant entries |
| `POST   /api/v1/synapse/session/:id/access` | Record access for agent-affinity scoring |
| `POST   /api/v1/synapse/session/:id/prefetch` | Plan + execute prefetch on file open |
| `GET    /api/v1/synapse/sessions` | List active session count (debug) |

Search integration: pass `synapseSessionId` on `POST /api/v1/search/project` (the `search` MCP tool maps to this endpoint).

## Lifecycle (the five moves)

### 1. Open a session at task start

```bash
SID=$(curl -sS -X POST http://localhost:3333/api/v1/synapse/session \
  -H 'Content-Type: application/json' \
  -d '{
    "agentId":"claude-code",
    "taskContext":"investigating ECONNRESET errors in auth middleware under load",
    "enableBuffer":true
  }' | jq -r .data.sessionId)
```

- `agentId` — stable identifier for *which* agent is calling. Used by agent-affinity. Keep it the same across calls.
- `taskContext` — 1-2 sentences describing what you are doing. Feeds the task-alignment signal of the attention scorer.
- `enableBuffer: true` — activates the working-memory cache (top-20 warm hits, TTL 15min).

### 2. Pass `synapseSessionId` to every search

When using `search` (or POSTing directly to `/api/v1/search/project`):

```
search({
  query: "where does the timeout get applied?",
  projectId: "my-project",
  synapseSessionId: "syn_mp16isfr_nvfo1g7c"
})
```

That is the only integration point on the search side. Synapse does the rest:
- Buffer hits from previous queries surface automatically
- Attention re-ranking (opt-in) uses the task context
- Chain inhibition boosts results aligned with detected intent (decision, debug, pattern, symbol)
- Diversity penalty stops the top-5 being five chunks of one file
- Confidence gate cuts noise relative to raw cosine, not RRF-inflated score

### 3. Update task context when the focus shifts

When the agent moves from "investigate" to "fix", update the context. It changes what attention considers aligned.

```bash
curl -sS -X PATCH http://localhost:3333/api/v1/synapse/session/$SID \
  -H 'Content-Type: application/json' \
  -d '{"taskContext":"implementing a configurable timeout in auth middleware"}'
```

Update when the *kind* of work changes, not after every query.

### 4. Prefetch when opening a file

Right after deciding to read a specific file, fire a prefetch so the buffer is warm before the next search.

```bash
curl -sS -X POST http://localhost:3333/api/v1/synapse/session/$SID/prefetch \
  -H 'Content-Type: application/json' \
  -d '{
    "filePath":"src/auth/middleware.ts",
    "symbols":[{"name":"verifyJwt"},{"name":"tokenTimeout"}],
    "entries":[
      {"id":"mem-1","content":"decided to use jwt with 15min expiry","score":0.9},
      {"id":"mem-2","content":"ECONNREFUSED workaround in prod deploy","score":0.85}
    ]
  }'
```

`entries` are memories you (typically from a prior `recall`) believe will be relevant. The endpoint can also be called with just `filePath`/`symbols` and no entries — Synapse then builds a prefetch *plan* (returned in the response) which you can execute with `recall` and POST back as `entries`.

### 5. Close the session at task end

```bash
curl -sS -X DELETE http://localhost:3333/api/v1/synapse/session/$SID
```

Optional — sessions auto-expire after 1h (TTL slides forward on every `get`/`recordAccess`). Closing explicitly frees memory immediately.

## Reading the pipeline output

When `synapseSessionId` is provided and the server logs at `LOG_LEVEL=debug`, one structured log fires per query:

```json
{
  "before": 16, "after": 14,
  "queryClass": "specific",
  "intent": "decision",
  "appliedFilters": ["buffer-hit","pre-gate","attention","chain","diversity","temporal","confidence-gate","spectrum","buffer-put"],
  "flags": {
    "lowConfidence": false,
    "noStrongMatch": false,
    "definitiveMatch": true,
    "spread": 0.31, "mean": 0.78, "confidence": 0.24
  }
}
```

| Signal | Reading |
|--------|---------|
| `appliedFilters` contains `buffer-hit` | Buffer had warm results — priming/prefetch is paying off |
| `appliedFilters` contains `pre-gate` | Early raw-score filter cut noise before attention |
| `queryClass = "specific"` | Symbol-like query; gate at 0.55 threshold |
| `queryClass = "focused"` | Tech terms; gate at 0.40 |
| `queryClass = "broad"` | Exploratory; gate at 0.25 |
| `intent != "general"` | Chain inhibition modulated results by Memory.type |
| `flags.definitiveMatch = true` | A dominant hit; trust the top-1 |
| `flags.lowConfidence = true` | Results clustered; query is ambiguous, refine it |
| `flags.noStrongMatch = true` | Nothing crossed threshold; answer probably not in corpus |

## Practical patterns

### Debugging session

```
1. CREATE session   taskContext = "investigating <error> in <area>"
2. search     for the error message  (pass synapseSessionId)
3. PREFETCH         on the file that owns the failing code
4. search     for context (config, related handlers, recent changes)
5. UPDATE context   "applying fix for <root cause>"
6. search     for affected tests
7. DELETE session
```

### Code review

```
1. CREATE session   taskContext = "reviewing PR #N about <feature>"
2. search     each touched file's history
3. PREFETCH         on each touched file
4. search     tests covering the change
5. DELETE
```

### Refactor across files

```
1. CREATE session   taskContext = "renaming X to Y across the codebase"
2. search     references — wide net first
3. POST /access     on each true hit (agent-affinity boost for next iteration)
4. PREFETCH         per file as you decide which to edit
5. search     again later for the same X — buffer surfaces prior hits
6. DELETE
```

### Priming with domain knowledge

If certain memories will always matter for the task (architectural decisions, recent incidents, project idioms), seed the buffer upfront:

```bash
curl -sS -X POST http://localhost:3333/api/v1/synapse/session/$SID/prime \
  -H 'Content-Type: application/json' \
  -d '{"entries":[
    {"id":"ad-001","content":"auth uses jwt with 15min expiry by design","score":0.9},
    {"id":"ad-002","content":"chose pgvector over chromadb for HNSW","score":0.9}
  ]}'
```

Primed entries surface only when their content tokens overlap with the new query — they don't pollute unrelated searches.

## Things to avoid

- **Reusing one mega-session across unrelated tasks.** Signals (taskAlign, agentAffinity, buffer) drift into noise. Open a fresh session per task.
- **Updating `taskContext` after every query.** Defeats the purpose; the signal must mean something.
- **Calling `prime` with hundreds of entries.** Buffer is capped at 20 by default; flood eviction wastes the priming work.
- **Treating `flags.lowConfidence` as "search failed".** It means the corpus had no clear winner — usually a hint to refine the query, not abort.
- **Sending `synapseSessionId` on a stateless one-shot call.** No benefit; same overhead.
- **Sending a different `agentId` per call.** Agent-affinity needs a stable identity.

## Minimal happy path

```bash
# Once per task
SID=$(curl -sS -X POST http://localhost:3333/api/v1/synapse/session \
  -H 'Content-Type: application/json' \
  -d '{"agentId":"claude-code","taskContext":"add retry to auth client","enableBuffer":true}' \
  | jq -r .data.sessionId)

# Every search (or use search with synapseSessionId param)
curl -sS -X POST http://localhost:3333/api/v1/search/project \
  -H 'Content-Type: application/json' \
  -d "{\"query\":\"auth client retry\",\"projectId\":\"my-project\",\"synapseSessionId\":\"$SID\"}"

# At cleanup
curl -sS -X DELETE http://localhost:3333/api/v1/synapse/session/$SID
```

That is the entire surface area. Everything else (attention, chain inhibition, diversity, gate, spectrum, buffer eviction) is automatic when Synapse is enabled in the server config.

## Decision Flow

```
Starting a multi-step task?
  → POST /api/v1/synapse/session   (open session, get sessionId)
  → recall                   (collect known-relevant memories for the task)
  → POST /session/:id/prime        (seed buffer with those memories)

Running a search inside the task?
  → search  with synapseSessionId param
  → (server applies the full pipeline automatically)

Opening a file the agent will dig into?
  → POST /session/:id/prefetch     (warms buffer with related decisions/code)

Task focus shifted (investigate → fix)?
  → PATCH /session/:id             (update taskContext)

Found an important hit?
  → POST /session/:id/access       (record for agent-affinity)

Task done?
  → DELETE /session/:id            (free resources)
```

## Configuration

Synapse is enabled by default in the server config. To toggle:

| Env var | Default | Effect |
|--------|---------|--------|
| `SYNAPSE_ENABLED` | `true` | Master kill switch; `false` bypasses the entire pipeline |
| `SYNAPSE_ATTENTION_ENABLED` | `false` | Enables the multi-signal attention re-ranker (opt-in until validated per project) |
| `LOG_LEVEL` | `info` | Set to `debug` to see the `Synapse pipeline applied` log line per query |

## Reference

- Endpoints documented in Swagger: `http://localhost:3333/swagger` — filter by `synapse` tag.
- Source: `packages/core/src/services/synapse/` (manager, buffer, session, scoring, inhibition, metacognition, plasticity, prefetch).
- Route: `apps/tools-api/src/routes/synapse.ts`.
- Design rationale: `docs/rfc-venvanse-for-agents.md`, `docs/synapse-dev-plan.md`.

This skill is about **using** Synapse from the agent side. To diagnose retrieval quality regressions or measure pipeline behavior, see the project's benchmark scripts at `scripts/synapse-benchmark-v2.sh` and `scripts/synapse-bench-analyze-v2.py`.
