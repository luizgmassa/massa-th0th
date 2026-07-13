# Virtual Lantern — Design and Execution Record

## Source Plan

`/Users/luizmassa/.claude/plans/i-want-to-understand-virtual-lantern.md` — “massa-th0th Improvement Plan”.

## Intent and Scope

The plan proposed a SQLite-canonical, local-first agent-memory and code-context system: fix indexing/tool reachability gaps; improve memory quality and durable sessions; add query understanding, passive capture, bootstrap, handoffs, auto-improvement, retrieval/compression polish, and a read-only web UI. LLM features were to be opt-in and silently degradable.

## Implemented Outcome

The commit range implements the planned Phase 0–8 product surface. It adds shared extension/config handling; memory CRUD and checkpoint reachability; decay, consolidation, durable sessions/jobs; LLM query understanding; hook observations; bootstrap; handoffs; proposal-driven auto-improvement; optional rerank/salience/compression/graph retrieval; dead embedding-stub removal; and a served read-only UI.

## Commit Evidence

### Foundation and retrieval

- `4e27925cbe751534be05b20d9afb18b0264a2a18` — `fix(mcp-client): use shared canonical extension list for upload collection`
- `e49ffa9a537a98d725667322f16e3c1e77e35759` — `feat(memory): add tunable decay fn, pinned column, and soft-delete`
- `12fe00212a86c197cbe77997e4aa9862d7bf208b` — `feat(memory): LLM-driven consolidation + backend-polymorphic job`
- `1ccb42c2bb66812f1e8edff41bf2689288032f56` — `feat(synapse,jobs): durable Synapse sessions and index jobs`
- `6a7598f4af0c48539d13d6a4384156615480eefc` — `feat(search): add query-understanding service + events`
- `6cb5edbb40db5ff5925ca8d4caa7797a493ebda8` — `feat(search): wire query-understanding fan-out into search`

### Passive lifecycle and memory operations

- `b950df7d6cd072aff88b28b7ec3511b639ad7096` — `feat(hooks): add hook-service with single-writer queue and 429`
- `8fb0cacde4492c883ea90999c4d4dba66ffeaa53` — `feat(hooks): add routes, consolidation bridge, hook scripts, mcp tool`
- `ae296e70451a121c9bbf94713cbc5632bc1de17b` — `feat(bootstrap): add BootstrapService with scan, LLM/rule-based seed, idempotency`
- `4d8ac600d4e759c48f6630ed77bed61bae1997ac` — `feat(handoff): add HandoffStore + HandoffService + auto-injector`
- `d3242cb75c4f5f7066767364e6967fe2e43e4bba` — `feat(auto-improve): add AutoImproveJob with pattern detection + review gate`

### Retrieval polish and UI

- `2c043f2e61f06dbdc001f700f3944bbfcf49fdbf` — `feat(search): LLM-judge reranker on top of RRF + centrality (7a)`
- `3716e66a7abf19bb84f0c48211e01721a05bf267` — `feat(memory): auto importance/salience scoring on remember (7b)`
- `d0adee1eee0762383cb214fe8a5f3b8a4472a544` — `feat(search): graph-neighbor BFS as ...`
- `784fe00962488e64210bcacceca990bdd829fbb4` — `feat(compression): wire LLM compression branch in code-compressor (7d)`
- `9bded69f0eab8f6032a64eb1e94ad21d68e12cb4` — `refactor(embeddings): relocate EmbeddingService + delete dead chromadb stub (7f)`
- `71f0727e8bd126959c8b9b0b9c4b250dbe8a8af2` — `feat(web-ui): scaffold apps/web-ui + serve static via tools-api (8a)`
- `46c2995185e9d3940628d069c90e53be13a69c6c` — `feat(web-ui): api client + 5 read-only views + markdown + dark mode (8b)`
- `58a1d5e9e5add0cc9883e4d29c7f9279703d7f81` — `test(web-ui): serve + 5 views + markdown + dark mode + read-only (8d)`

## Spec / Acceptance Facts Now Worth Preserving

- SQLite remains canonical; no markdown/git second store or multi-user attribution was introduced by this plan execution.
- LLM-backed paths are configuration-gated, default-off, and retain a non-LLM fallback on disabled/failed calls.
- Memory visibility excludes soft-deleted and superseded records; pinned memories are decay-exempt.
- Hook ingestion uses serialized writes with a saturation response, and observation consolidation does not block ingestion.
- Handoff, bootstrap, auto-improvement, and UI features are surfaced through MCP/API boundaries; the UI is read-only.
- The retrieval pipeline can augment its baseline streams with query rewrite/HyDE, graph neighbors, and optional LLM judging without making those paths mandatory.

## Deviations or Unresolved Gaps

- The source plan described memory deletion as “soft then hard.” Phase 0 implemented hard delete with edge severance; Phase 1 subsequently added soft-delete and read filtering. This is an execution sequencing change, not an omitted capability.
- Commit evidence confirms feature and focused-test additions, but this record does not independently rerun the plan’s full Ollama/MCP end-to-end matrix or optional benchmark.

## Cross-References

- `.specs/features/phase-0-quick-wins/spec.md`
- `.specs/features/phase-1-memory-foundation/spec.md`
- `.specs/features/phase-2-query-understanding/spec.md`
- `.specs/features/phase-3-hook-capture/spec.md`
- `.specs/features/phase-4-bootstrap/spec.md`
- `.specs/features/phase-5-auto-improve/spec.md`
- `.specs/features/phase-6-handoffs/spec.md`
- `.specs/features/phase-7-retrieval-polish/spec.md`
- `.specs/features/phase-8-web-ui/spec.md`

## Verification Evidence Used

- Read source plan in full and compared its phased scope with implementation commit subjects and targeted commit statistics in `c1d37b8120025a69e2de0e5fd054ca8177e205de..81d33606fb6826e1759a073006b165419d0e3ba4`.
- Confirmed existing phase specifications and integration ledger identify the same source plan and phase boundaries.
- Documentation artifact checks: non-empty file and `git diff --check`.
