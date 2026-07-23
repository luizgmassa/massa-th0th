### 🔵 Exploration

Use this workflow when the user wants to understand a codebase, module, data flow, runtime behavior, schema, dependency, or architecture area before asking for changes. Exploration is read-only: do not implement, refactor, rewrite docs, or mutate project files unless the user explicitly changes workflows or asks for edits.

## Golden Rules

Inviolable across every exploration:

1. **Never assume or invent.** Uncertainty is always preferable to fabrication; invented APIs, symbols, or patterns cascade into wrong answers.
2. **Deserves-a-note.** When understanding is worth persisting, record what is durable — not trivia.
3. **Pointers, not copies.** Link/reference source (`path`, symbol, line); do not duplicate bulk content into notes or reports.
4. **Surgical precision.** Make the smallest sufficient change; in Exploration, that usually means the smallest sufficient read set.
5. **Verify against source.** Treat indexed context, memories, and external summaries as leads until confirmed against current source.

Write and search in the user's human language. Match the language of the user's prompt for explanations, notes, and questions; match the language of the codebase for identifiers, paths, and commands.

## Knowledge Verification Chain

When researching or resolving any technical question during exploration, follow this chain in strict order. Never skip steps.

```
Step 1: Codebase → existing code, conventions, patterns already in use
Step 2: Project docs → README, docs/, inline comments, .specs/project/STATE.md (Decisions)
Step 3: Context7 MCP → resolve library ID, then query for current API/patterns
Step 4: Web search → official docs, reputable sources, community patterns
Step 5: Flag as uncertain → "I'm not certain about X — here's my reasoning, but verify"
```

- Never skip to Step 5 if Steps 1-4 are available.
- Step 5 is always flagged uncertain — never presented as fact.
- Never assume or fabricate. If no answer is found, say "I don't know" or "I couldn't find documentation for this". "I don't know" beats invention.

1. Resolve/reuse `projectId` and `workflowSessionId`: `explore-[entity]`.
2. Load shared references:
   - `references/codebase-investigation.md` always.
   - `references/context-firewall.md` when source inspection, logs, traces, snapshots, generated output, external research, or broad search results may flood context.
   - `references/synapse-policy.md` when two or more related th0th searches are expected.
   - `references/mobile-context.md` only for non-debug mobile exploration involving KMP, iOS, Android, native bridges, mobile lifecycle, offline sync, permissions, push/background work, local persistence, backend-mobile contracts, or runtime lazy loading.
   - `references/agent-orchestration.md` only when an isolated read-only investigation or independent verification task is justified.
   - Route broken mobile behavior, crashes, regressions, or device-specific failures to `workflows/debug.md` plus `references/mobile-diagnosis.md`; do not keep them in Exploration.
3. Brief the exploration:
   - objective and user-facing success criteria
   - scope and explicit out-of-scope areas
   - constraints, target environment, and current session
   - whether the task is pure explanation, onboarding, flow mapping, or decision support
4. Recall first:
   - `th0th_recall` for prior decisions, patterns, handoffs, gotchas, and previous exploration of the entity.
   - Filter stale, superseded, or contradicted memories before using them as current truth.
   - Treat memory as a lead until confirmed against current source when accuracy matters.
5. Build a proportional investigation plan before deep reads (BRIEFING → PLAN → EXECUTE → DEBRIEF):
   - start from the closest entry point to the question
   - name the symbols, files, routes, commands, docs, or runtime artifacts to inspect
   - per step, state a `verify:` criterion — what concrete evidence confirms that step succeeded (a read signature, a matched call graph, a resolved data path) before moving on
   - define what evidence would be enough to answer the user
   - ask only if the objective or scope cannot be inferred from local context
6. Recon with progressive disclosure. Dispatch `investigator` per `references/agent-orchestration.md` when the investigation justifies an isolated read-only subagent:

> **Dispatch: investigator** — see `skills/agents/investigator/SKILL.md`
> - trigger: isolated read-only investigation justified; large scope, repeated searches, or context-firewall threshold exceeded
> - scope: the exploration target — symbols, files, routes, commands, docs, or runtime artifacts to inspect
> - permissions: read-only
> - inputs: objective, scope, explicit out-of-scope areas, constraints, recalled facts, and the closest entry point
> - sensors: progressive disclosure (project map → summary search → enriched search → symbol/file tools → optimized context → focused shell); per-step `verify:` criterion
> - output: entry points, core flow, dependencies, data ownership, relevant contracts, exact evidence pointers (path, symbol, line), confirmed facts vs inferences
> - firewall: raw logs, snapshots, generated reports, and broad search output summarized, not returned raw
> - memory: suggest-only; main agent persists durable discoveries

    - Follow the shared retrieval order: project map, summary search, targeted
      enriched search, symbol/file tools, optimized context, then focused shell
      fallback.
   - Follow imports, calls, ownership boundaries, and data paths from entry point outward.
   - For behavior questions, trace input -> transformation -> output.
   - Read signatures and high-value logic first; avoid whole-project sweeps and large raw file reads.
   - Use pointers (`path`, symbol, line) instead of copying code into notes or reports.
7. Mobile exploration extension:
   - Capture only the minimal mobile packet needed: platform scope, shared vs platform boundary, parity target, relevant device/runtime state, and cheapest validation sensor.
   - For runtime lazy-loading questions, trace list/media/module loading, cache and prefetch behavior, lifecycle or background constraints, offline behavior, and Android/iOS parity where relevant.
   - State skipped platform checks and the risk of treating one platform or simulator as global proof.
8. Synthesize the answer:
   - state what was checked and what was intentionally not checked
   - identify entry points, core flow, dependencies, data ownership, and relevant contracts
   - include exact evidence pointers: file paths, symbols, commands, or artifacts
   - separate confirmed facts from inferences and open questions
   - name the next best workflow if the user wants changes after the explanation (`debug`, `feature`, `refactor`, `architecture-audit`, `spec-driven`, etc.)
9. Debrief memory with scoring from `references/decision-engine.md`:
   - Persist only durable discoveries that would cost future effort to rediscover: repeated project patterns, architectural constraints, fragile flows, gotchas, accepted exceptions, rejected approaches, or reusable verification recipes.
   - **Note-worthiness trigger:** when understanding touches 3+ files or a non-trivial flow, persist a note to the th0th memory layer. Below that threshold, decide per-finding.
   - Three-way note decision: **create** (new durable finding), **update** (existing non-stale note for the same entity), or **skip** (trivial, one-off, already captured). The Debrief records what was verified against source, not just what was read.
   - Use `th0th_remember` with required tags and the correct memory tier.
   - Keep `th0th` as the canonical memory layer for massa-th0th workflows. Do not introduce `.notebook/`, generated state files, or copied-code notes as default persistence.
   - Skip memory for trivial observations, one-off facts, raw logs, copied source, screenshots, customer data, tokens, device IDs, and facts already captured in current non-stale memories.
10. Complete the Evidence Gate from `references/evidence-gate.md`.

## Anti-Patterns

- Reading the entire project when a nearby entry point exists.
- Dumping raw logs, browser snapshots, generated reports, long diffs, or whole files into context.
- Treating stale or superseded memories as current source truth.
- Implementing fixes or refactors inside Exploration.
- Creating a new persistence system or duplicating CodeNavi-style local notebooks inside massa-th0th workflows.
- Asking the user where code lives before searching current sources.

## Output Contract

- Objective: what question was answered
- Scope Checked: files, symbols, docs, commands, memories, or artifacts inspected
- Entry Points: closest source pointers for future navigation
- Flow: input -> transformation -> output, when applicable
- Key Evidence: exact paths, symbols, command results, or artifact pointers
- Mobile Context: platform, boundary, parity, and skipped checks when mobile context was loaded
- Confirmed Facts vs Inferences: label uncertainty explicitly
- Next Step: recommended workflow if the user wants changes
- Memory: write/skip, memory tier, and reason
