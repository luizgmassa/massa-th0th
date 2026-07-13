# E2E Coverage Side Findings — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/read-packages-core-src-tests-e2e-coverag-bubbly-riddle.md`.

## Intent and scope

The plan claimed five fixes for open side findings in
`packages/core/src/__tests__/e2e/COVERAGE.md`: structured-output behavior for
the thinking default LLM (A), `read_file` TOON output (B), dedicated-DB and
integer-environment parsing gaps (C), stale PgJobStore recovery/reaper writes
(D), and hydration preserving in-flight saves (E). It explicitly excluded the
`adsads/` junk-path finding. It also prescribed rebuild, live `:3333` restart,
and targeted E2E/unit verification.

## Implemented outcome

Commit `6b5852f` implements A--E and updates the coverage record.

- `llm-client` adds a configurable think-disable attempt plus reasoning-channel
  and JSON recovery; its direct commit says the default `qwen3.5:9b` remained.
- `read_file` encodes `format:"toon"` output, while JSON remains object-shaped;
  E27 now asserts both forms.
- Dedicated-mode guarding checks the effective vector URL; shared integer parsing
  permits proxy timeout `0` but floors unsafe job-reaper values to defaults.
- PostgreSQL and SQLite job-store stale recovery uses heartbeat/start-time age;
  PostgreSQL hydration merges persisted rows rather than clearing its mirror.

## Commit evidence (hash/subject grouped)

### Direct plan implementation

- `6b5852f8c572ca3f459199fc3b60ce568a91e121` — `fix(core): resolve 5 OPEN COVERAGE side-findings (A–E) + verify green`
  - Changed the implementation surfaces named by A--E, their focused unit tests,
    E27 in `08.search.test.ts`, and `COVERAGE.md`.
  - Commit message claims `02/08/11/05` E2E results of 100 pass, 2 skip, 0 fail;
    A15, D-pg17, D-sqlite7, and C11 unit results; and live `:3333`/real-PG
    verification. These are commit claims, not freshly rerun evidence here.

### Related prerequisite and follow-up commits

- `1367007549e9b9ece28f69d44e0dd061ad04fde4` — `fix(e2e): resolve all COVERAGE residuals (#12/#15-18/N7/OOM/.env) + PG job-store parity`
  - Introduced the PostgreSQL job store, dedicated DB guard, heartbeat/reaper
    work, E2E coverage baseline, and the side findings that the source plan
    targets.
- `0455084fd9c5f5e1c93c566cd50023325116d701` — `feat(llm): per-task model routing (qwen2.5 swap) + read_file cache/abs-path fixes`
  - Later changed the default model from `qwen3.5:9b` to
    `qwen2.5:7b-instruct`, added per-task model routing, and extended affected
    LLM/read-file/job-store tests. This is post-plan follow-up, not evidence
    that the original direct change altered the default.

## Spec/acceptance facts

- `format:"toon"` must return a non-empty encoded string; `format:"json"`
  returns a non-null object with string `content`.
- In dedicated mode, either `DATABASE_URL` or the effective
  `POSTGRES_VECTOR_URL || DATABASE_URL` resolving to `massa_th0th` is refused.
- `MASSA_TH0TH_PROXY_TIMEOUT_MS=0` is valid; zero, negative, malformed, or
  absent stale-window/reaper-interval values select their safe defaults.
- Running jobs are recovered only when
  `COALESCE(heartbeat_at, started_at)` is older than the stale cutoff; hydration
  must not discard in-flight mirror state.

## Deviations/unresolved gaps

- The plan required fresh rebuild/restart/live probes. This record did not run
  them; only the direct commit reports that verification.
- Plan A said to keep `qwen3.5:9b`; direct implementation did. Later `0455084`
  changed the default model, so current behavior must not be attributed solely
  to this plan.
- `adsads/` remains deliberately outside this plan; `6b5852f` also reports
  newly surfaced findings remaining open.

## Existing spec crossrefs

- [Phase 1 memory-foundation spec](../../phase-1-memory-foundation/spec.md)
  defines durable index jobs and crash recovery.
- [Repository maintenance spec](../../repository-maintenance-2026-07-12/spec.md)
  makes PostgreSQL-equivalent evidence a coverage requirement.
- [Maintenance final verification evidence](../../close-maintenance-next-steps-2026-07-13/final-verification-evidence.md)
  records dedicated PostgreSQL environment conventions, including
  `POSTGRES_VECTOR_URL`.

## Verification evidence

- Read source plan, commit metadata, focused patches, and relevant existing
  spec artifacts in the assigned range.
- Documentation checks after this write: target file is non-empty and
  `git diff --check` is clean.
