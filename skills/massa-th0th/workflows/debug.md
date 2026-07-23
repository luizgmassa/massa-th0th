### 🔴 Debug

Use this workflow when the user reports broken behavior, failures, regressions, crashes, unexpected output, flaky behavior, or any issue that needs evidence-backed root-cause diagnosis before a fix. Do not use it for new capabilities; route that to `workflows/feature.md`. Do not use it for broad redesign or unclear cross-boundary changes; route that to `workflows/spec-driven.md`.

1. Generate/reuse `workflowSessionId`: `debug-[entity]`
2. Load shared references:
   - `references/codebase-investigation.md`
   - `references/debug-diagnosis-loop.md`
   - `references/mobile-diagnosis.md` when the bug target involves KMP, iOS, Android, native bridges, devices, simulators/emulators, or mobile lifecycle
   - `references/verification-ladder.md` before Quick/Standard/Spec-driven sizing or applying fixes
   - `references/context-firewall.md` before inspecting logs, traces, snapshots, or generated output that meet its threshold table (a single source/log/doc block >200 lines, >20 KB, or >50 search hits)
   - `references/lessons.md` when `.specs/lessons.json` exists, to load confirmed project lessons before diagnosis
3. `recall` → load prior debugging attempts for this entity
4. IF prior attempts exist:
   - Review what was already tried
   - Focus on untested hypotheses
   - Treat memories tagged `stale` or superseded by `stale-replaces:*` as historical only
   - Do not repeat ruled-out hypotheses unless new evidence invalidates the prior result
5. Follow the shared retrieval order from `references/codebase-investigation.md`
   to load relevant code. `optimized_context` has no session field; put
   `workflowSessionId` in query text/tags and pass only `synapseSessionId` to
   `search.sessionId`.
   - For large files (>200 lines) or derived-value computation, call `execute_file` with `path`, `language`, and `code` to run analysis code over the file instead of loading the entire file into context. Respect the local-dev-only trust model (no untrusted-client exposure).
   - After opening a file for deep investigation, call `synapse_prefetch` with `id` (the `synapseSessionId`) and `filePath` to warm the Synapse buffer before the next search. Requires an existing `synapse_session` id.
6. Build or request a trustworthy feedback loop before editing:
   - Use the reproduction ladder in `references/debug-diagnosis-loop.md`: unit/CLI repro, integration/API repro, app/browser/device repro, then structured HITL.
   - IF no loop can run, record a skipped-reason enum from the debug reference and collect the strongest root-cause proof available
7. Reproduce and minimize the user-described failure without losing the original failure signal
8. Rank 3-5 falsifiable hypotheses before testing:
   - include evidence, prediction, probe, disproof criteria, and tested result
   - test one hypothesis at a time; instrument only to answer the current hypothesis
   - for flaky failures, measure and improve reproduction rate before root-cause guessing
9. Apply debugging heuristics (see `references/decision-engine.md`):
   - Trace data flow: input → transformation → output
   - Compare expected vs actual behavior
   - Check recent changes first
   - Minimize search space to relevant modules
   - For call/data-flow path tracing, call `trace_path` with `function_name` (or `qualifiedName`), `project`, `direction` (outbound/inbound/both), `mode` (calls/data_flow/cross_service/all), and `depth` to trace typed-edge BFS paths. `trace_path` only counts as evidence when the index is fresh for the current repository path and commit/worktree state; fall back to `search`/`get_references` and record reduced retrieval confidence when the index is stale or unavailable.
10. Size the fix before editing:
   - Use the exact Quick, Standard, and Spec-driven thresholds in `references/verification-ladder.md`.
   - Refactor route applies only when the fix becomes behavior-preserving cleanup after the root cause is proven.
11. Define the verification recipe before changing code:
   - reproduction or root-cause proof
   - commands, tests, or artifact checks that prove the fix
   - file-integrity checks for validation assets such as tests, specs, benchmarks, fixtures, and snapshots
12. Fix the divergence point closest to the root cause
13. Add regression coverage at the correct seam, or document why no valid regression seam exists
14. If verification found a reusable signal (`ac_gap`, `surviving_mutant`, `spec_precision_gap`, `spec_deviation`, `gate_fail`), record it via `references/lessons.md`:
     `python3 skills/massa-th0th/scripts/lessons.py --root . add --feature "<slug>" --signal "<signal>" --source "<ref>" --text "<one terse lesson>"`
     Rerun the original feedback loop, run the verification recipe, and remove temporary instrumentation unless intentionally retained as observability
15. Use `references/agent-orchestration.md` only for independent verification or isolated investigation branches
16. IF fix found:
   - Persist the root cause via `remember` as a scored `decision` memory with `memory:semantic`
   - Persist the fix pattern via `remember` as a scored `pattern` memory with `memory:procedural`
   - If a prior debugging memory for this entity is now stale or contradicted by the fix, call `memory_update` with its `id` and the corrected `content` (re-embeds automatically)
17. IF NOT resolved:
   - Persist what was ruled out via `remember` as a scored `conversation` memory with `memory:episodic`
   - Persist repeated failed tool loops as procedural cognition lessons only when they are reusable
   - Document remaining hypotheses for future sessions
18. Complete the Evidence Gate from `references/evidence-gate.md`

## Output Contract

- Issue Summary: symptom, impact, frequency, and environment
- Feedback Loop: command, tool, artifact, or root-cause proof that showed failure and then success
- Hypothesis Board: ranked hypotheses and tested results
- Root Cause: evidence-backed diagnosis with the divergence point
- Fix + Validation: code/test strategy, verification recipe, and commands or artifacts checked
- Prevention: regression test, monitor/runbook suggestion, and memory outcome
- For mobile bugs: device matrix, platform parity, crash/log artifact, and impacted/unaffected platform validation

## Example

User asks: "The login route returns 500 after deploy."

1. Use `workflowSessionId=debug-login-route-500` and recall `session:debug-login-route-500 login route 500 prior attempts`.
2. If recall says "session expiry was ruled out on 2026-05-30", do not repeat that hypothesis unless new evidence contradicts it.
3. Establish the feedback loop: reproduce the 500 with the smallest route check that preserves the deploy failure signal.
4. Build a hypothesis board: missing env, middleware ordering, expired session lookup, or database connection regression; probe one at a time.
5. Trace request → auth middleware → session lookup → response, then fix the divergence point closest to the root cause.
6. Define the verification recipe: rerun the original route check, add or update regression coverage at the failing seam, and confirm validation assets were not weakened.
7. If root cause is a missing `DATABASE_URL`, persist via `remember`: a semantic decision memory for the root cause and a procedural pattern memory for the deploy-env verification command.
