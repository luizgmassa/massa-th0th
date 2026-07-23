# Debug Diagnosis Loop

Use this reference when `workflows/debug.md` asks for an evidence-first diagnosis loop.

## Principle

Debugging is a feedback-loop problem first and a code-change problem second. Before editing, establish a trustworthy way to observe the failure and later prove the fix, or document why only root-cause proof is possible.

## Intake Packet

Capture the smallest useful issue packet before broad investigation:

- Expected behavior
- Actual behavior
- Environment: local, CI, staging, production, browser/device, service, region, tenant, or data set
- Frequency: always, intermittent, percentage, time window, or reproduction count
- Affected components and entry point
- Reproducibility: command, request, user steps, fixture, trace, or missing repro
- Recent changes: deploy, config, dependency, schema, data, feature flag, infrastructure, or permissions
- Safety constraints: production access limits, data sensitivity, allowed mutation level, and rollback constraints

If any field is unknown, continue with available evidence unless the missing field blocks a safe pass/fail loop.

## Feedback-Loop Gate

Pick the first reproduction ladder step that preserves the original failure signal and can be rerun after the fix:

- Unit/component or CLI repro around the failing seam, including a focused failing test, regression scaffold, or command transcript
- Integration/API/service repro, including `curl`/HTTP script, API client command, route smoke check, fixture, or trace replay
- App/browser/device/simulator repro, including browser automation, UI artifact inspection, emulator/simulator/device run, or screenshot/video proof
- Trace, replay, or event fixture
- Throwaway harness in a temp location when production code is hard to reach
- Fuzz/property loop when input space is the suspected trigger
- `git bisect`, dependency diff, config diff, or differential run between known good and bad versions
- Structured human-in-the-loop (HITL) script when the user must perform a step: exact action, exact observation, exact pass/fail signal

Skipped-reason enum when no loop can run: `missing-credentials`, `missing-service`, `missing-hardware`, `unsafe-production`, `destructive-risk`, `tool-missing`, `data-unavailable`, or `not-reproducible-yet`.

Loop quality rules:

- Prefer deterministic, fast, local loops.
- Preserve the original user-facing failure signal; do not replace it with a narrower check unless the original loop is also rerun before completion.
- If the loop requires unavailable credentials, services, or data, state the missing dependency and use the strongest root-cause proof available.
- Do not edit code to "see what happens" before the loop or proof exists.

## Non-Deterministic Failures

For flaky or production-only failures, raise the reproduction rate before root-cause guessing:

- Measure the current reproduction rate, such as `3/50` runs or "appeared twice in 20 minutes".
- Isolate entropy one source at a time: time, randomness, async scheduling, cache, filesystem, network, concurrency, global state, data ordering, environment variables, feature flags, clock/timezone, permissions, and external services.
- Add controls or probes that increase signal: fixed seeds, fake timers, serialized execution, cache reset, narrowed input set, correlation IDs, or sampled traces.
- If the failure cannot be made repeatable, keep the confidence label explicit and verify with multiple independent signals.

## Minimize The Case

Reduce noise while preserving the failure:

- Smallest input, request body, fixture, trace, or UI step set that still fails
- Smallest module path that still contains the divergence
- Smallest environment difference or recent-change window that explains the symptom
- Smallest commit/dependency/config range when regression timing matters

Stop minimizing when further reduction would remove the actual behavior being debugged.

## Hypothesis Board

Before testing, create 3-5 falsifiable hypotheses. Use prior memories to avoid repeating ruled-out paths.

```md
| Rank | Hypothesis | Why plausible | Prediction | Probe | Disproof | Result |
|---|---|---|---|---|---|---|
| 1 | ... | evidence or memory | what should be true if this is root cause | command/log/assertion/inspection | what result rules it out | untested / supported / ruled out |
```

Rules:

- Test the highest-value hypothesis first, not the easiest one if it has weak explanatory power.
- Each probe must have a clear predicted result before running it.
- Treat symptoms and root causes separately.
- Update the board after each probe; do not retry the same failing command more than twice unchanged.
- If evidence contradicts every hypothesis, revise the board instead of patching speculatively.

## Instrumentation

Instrument to answer one question at a time:

- Prefer debugger, REPL, focused assertions, and small scripts before adding app logs.
- Add targeted tagged logs only when they answer a named hypothesis.
- Include correlation IDs, request IDs, timestamps, tenant/user-safe identifiers, or span IDs when needed to join events.
- Use structured parsers or summary commands for large logs; load `references/context-firewall.md` before bringing verbose output into context.
- Remove temporary instrumentation before completion unless the change is intentionally retained as observability, and document why it stays.

## Production-Safe Diagnosis

Use these only when concrete tools, access, and user/project policy allow them. Do not hard-require any vendor or platform.

- OpenTelemetry spans, attributes, metrics, or trace correlation
- Feature-flagged debug logging with sampling and expiration
- Sampling profilers or read-only performance snapshots
- Protected read-only inspection through existing approved tools
- Canary, shadow traffic, replay, or staged rollout validation
- Release, config, dependency, schema, and feature-flag diffing

Production guardrails:

- Do not expose secrets, tokens, PII, or sensitive customer data in logs or memory.
- Avoid write operations against production during diagnosis unless the user explicitly approves and rollback is defined.
- Prefer canary or sampled checks over broad instrumentation.
- Record skipped production checks and why they could not run.

## Fix And Prevention

Fix the divergence point closest to the root cause:

- Make the smallest behavior-preserving change that explains the evidence.
- Do not bundle adjacent refactors with the debug fix.
- Add regression coverage at the seam that failed: unit, integration, route, CLI, UI, contract, fixture, or monitor.
- If no valid regression seam exists, document the missing seam, provide the strongest available proof, and persist a testability or architecture note only when durable.
- Rerun the original feedback loop after the fix, plus the regression check and any validation assets from `references/verification-ladder.md`.

## Output Contract

A completed debug workflow should report:

- Issue Summary: symptom, impact, frequency, and environment
- Feedback Loop: command, tool, artifact, or root-cause proof that showed failure and then success
- Hypothesis Board: ranked hypotheses and tested results
- Root Cause: evidence-backed diagnosis with the divergence point
- Fix + Validation: code/test strategy, verification recipe, and commands or artifacts checked
- Prevention: regression test, monitor/runbook suggestion, and memory outcome

## Memory Guidance

Persist only durable debugging knowledge after recall and importance scoring:

- Root cause as semantic `decision` memory when future agents could repeat the mistake
- Reusable verification or diagnostic recipe as procedural `pattern` memory
- Ruled-out hypotheses as episodic `conversation` memory only when rediscovery would waste future effort
- Repeated failed tool loops as cognition lessons only when the lesson is reusable across sessions
