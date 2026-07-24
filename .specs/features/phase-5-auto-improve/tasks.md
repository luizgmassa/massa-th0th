# Phase 5 — Auto-improvement loop (G7): Tasks

One atomic Conventional Commit per task. Branch `main`. Never `git push`.
Tests derive from ACs (spec.md) and assert spec-defined outcomes.

## Task 1 — Spec artifacts (this commit)
- `spec.md`, `design.md`, `tasks.md` under
  `.specs/features/phase-5-auto-improve/`.
- Commit: `docs(specs): add phase-5 auto-improve spec/design/tasks`.

## Task 2 — config + memory:auto-improved + proposals table + ProposalStore
- `packages/shared/src/config/index.ts`:
  - Add `memory.autoImprove` block to `ServerConfig.memory` (R9 keys).
  - Add defaults to `defaultConfig` (envBool/envNum).
  - Shallow-merge `autoImprove` in `mergeConfig` (one-level deep, like `bootstrap`).
- `packages/core/src/services/events/event-bus.ts`:
  - Add `memory:auto-improved` to `EventMap` (R6 shape).
- `packages/core/src/data/proposal/proposal-repository.ts` (NEW):
  - `PROPOSAL_STATUSES`, `ProposalStatus`, `PROPOSAL_KINDS`, `ProposalKind`,
    `ProposalPayload` (typed union), `ProposalRecord`.
  - `ProposalStore` interface, `MemoryProposalStore` (in-memory fallback),
    `SqliteProposalStore` (lazy open, WAL + busy_timeout=3000,
    `CREATE TABLE IF NOT EXISTS proposals` + 2 indexes), `getProposalStore()`,
    `resetProposalStore()`, `newProposalId()`.
- `packages/core/prisma/schema.prisma`:
  - Additive `model Proposal @@map("proposals")` (R1 cols + index).
- Commit: `feat(auto-improve): add config + memory:auto-improved event + proposals table`.

## Task 3 — auto-improve-job (detectPatterns + enrichWithLlm + runOnce + approve/reject + auto-approve)
- `packages/core/src/services/jobs/auto-improve-job.ts` (NEW):
  - `detectPatterns(observations, thresholds): PatternCandidate[]` (pure; R3).
  - `enrichWithLlm(candidates, observations, llm): Promise<PatternCandidate[]>`
    (silent degrade; R7).
  - `AutoImproveJob` ctor `AutoImproveJobOptions` (ctor seam; R4).
  - `maybeRun(projectId)` (debounce; fire-and-forget; mirror Phase-3).
  - `runOnce(projectId)`: listRecent → detect → enrich(optional) →
    insert(pending) → reviewGate? auto-approve : leave pending. Never throws.
  - `approve(id, projectId?)` / `reject(id, projectId?, reason?)` (R5 state
    machine; reuse approve for auto-apply).
  - `applyProposal(record, memoryRepo)` (insert for create/tag; update for
    update).
  - Types + singleton `autoImproveJob` + `getAutoImproveJob()`/`resetAutoImproveJob()`.
- Commit: `feat(auto-improve): add AutoImproveJob with pattern detection + review gate`.

## Task 4 — MCP tools + API route + core barrel
- `apps/mcp-client/src/tool-definitions.ts`:
  - `list_proposals` (POST `/api/v1/proposal/list`).
  - `approve_proposal` (POST `/api/v1/proposal/approve`).
  - `reject_proposal` (POST `/api/v1/proposal/reject`).
- `apps/tools-api/src/routes/proposals.ts` (NEW):
  - Elysia prefix `/api/v1/proposal`; 3 POST handlers; 423 disabled; 400
    missing projectId/id; 200 `{success, data}`. Swagger tag `proposals`.
- `apps/tools-api/src/index.ts`:
  - `import { proposalRoutes } from "./routes/proposals.js"` + `.use(proposalRoutes)`
    after `.use(handoffRoutes)`.
- `packages/core/src/index.ts`:
  - Barrel re-exports Phase-5 symbols (ProposalStore types +
    `getProposalStore`/`resetProposalStore`/`newProposalId` +
    `AutoImproveJob`/`getAutoImproveJob`/`resetAutoImproveJob`/`detectPatterns`/
    `enrichWithLlm`/`PROPOSAL_KINDS`).
- Commit: `feat(auto-improve): wire 3 MCP tools + /api/v1/proposal routes + barrel`.

## Task 5 — tests + validation + integration ledger
- `packages/core/src/__tests__/proposal-repository.test.ts` (NEW):
  - SQLite createSchema idempotent (reopen same dbPath reads prior row).
  - MemoryProposalStore insert/getById/listPending/setStatus.
  - WAL journal mode.
- `packages/core/src/__tests__/auto-improve-job.test.ts` (NEW):
  - P5-DETECT-01 (≥1 proposal from deterministic pattern).
  - P5-DETECT-02 (no pattern → 0 proposals, no throw).
  - P5-LIST-01 (listPending returns pending only).
  - P5-APPROVE-01 (apply + flip + event shape).
  - P5-AUTOAPPROVE-01 (reviewGate=false applies + emits + logs).
  - P5-REJECT-01 (reject flips, no apply, no event).
  - P5-DEGRADE-01 (LLM off → rule-based proposals).
  - P5-DEGRADE-02 (LLM on + {ok:false} → rule-based candidates verbatim).
  - P5-FAIL-01 (missing / non-pending / project-mismatch).
  - P5-EVENT-01 (EventMap shape).
- `apps/mcp-client/src/__tests__/tool-definitions.test.ts` (extend if exists,
  else add assertion) OR assert in route test:
  - P5-TOOL-01 (3 tools present + route registered).
- Discrimination sensor: mutate the pending-guard in `approve`/`setStatus`
  (`WHERE status='pending'` → `WHERE 1=1`) → expect P5-FAIL-01 to fail; revert.
- `validation.md` (PASS/Blocked + per-AC evidence + discrimination result +
  gate output + same-author caveat).
- `project/STATE.md`, `project/FEATURES.json` (phase-5 row), `HANDOFF.md`.
- Append Phase-5 delta to `PHASE-INTEGRATION.md` + commit-ledger row.
- Commit: `test(auto-improve): cover detect/list/approve/auto-approve/reject/degrade + validation`.

## Gate (per task 5)
- `bun run --filter @massa-ai/core test` ≥ 791 pass / 0 fail / 46 skip (no regression).
- `bun run type-check` clean (5/5).
- Discrimination mutant killed.
