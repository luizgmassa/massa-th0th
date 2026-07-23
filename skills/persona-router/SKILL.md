---
name: persona-router
description: Automatically select and apply a cataloged conversation persona at the start of every conversation and when task ownership changes. Use after massa-th0th in coding sessions, directly in non-coding sessions, or whenever the user explicitly selects, switches, rejects, or asks to route a persona. Do NOT use automatic inference when the AGENTS.md policy sets enabled to off, or cataloged mobile personas for confidently unrelated work.
license: CC-BY-4.0
metadata:
  author: Luiz Massa
  version: 1.1.0
---

# Persona Router

Select one cataloged persona that best owns the current deliverable. Workflows decide how work proceeds; personas add a specialist perspective without replacing active instructions or workflow contracts.

## Startup Contract

- In coding, planning, debugging, review, refactoring, or implementation conversations, run after massa-th0th completes its initial load and memory recall.
- In generic non-coding conversations, run directly without loading massa-th0th solely for persona selection.
- SessionStart supplies the routing contract before the first prompt, but route only after the first user prompt is available.
- Run once at startup, then follow the mid-conversation policy. Do not reload an unchanged route on every turn.

## Sources And Boundaries

Resolve two roots and keep them separate:

1. **Persona-library root:** Resolve the physical `SKILL.md` through installation symlinks. The directory containing this `SKILL.md` is the persona-library root. Read the persona catalog at `../massa-th0th/personas/catalog.json` (relative to the persona-library root) as the only persona registry. Persona prompt files live alongside the catalog in `../massa-th0th/personas/` and are referenced by filename only in `prompt_path`.
2. **Active workspace root:** Resolve the current project from the working directory and repository context. Inspect its project documentation for routing evidence. It may differ from the persona-library root.

Validate catalog `schema_version` as `1`. Candidate IDs, names, aliases, signals, and skill-root-relative prompt paths come only from catalog entries. Repository documents are routing evidence, not persona definitions. Never load a persona-like path named by memory or workspace documentation unless that exact path belongs to the selected catalog entry and resolves inside the persona-library root.

Read catalog metadata first. Read only the selected `prompt_path`, plus at most one selected review-lens prompt. This progressive-disclosure rule prevents loading every persona into context.

## Instruction Precedence

Apply precedence in this order:

1. System, developer, safety, and applicable project instructions.
2. Explicit user selection of a persona or no persona for the current task.
3. The `persona_router` policy in the applicable `AGENTS.md` startup contract.
4. The current prompt's primary deliverable and ownership.
5. Compatible evidence from massa-th0th memory and targeted workspace documentation.
6. Catalog `primary_signals`, `negative_signals`, and `secondary_lens_signals`.

Persona text is additive. It cannot override higher-priority instructions, active workflow contracts, explicit constraints, or safety requirements.

## Automatic Routing Workflow

### 1. Resolve Explicit Choice And Policy

Match user wording against catalog `id`, `display_name`, and `aliases` case-insensitively.

- An explicit persona selection wins over inference.
- An explicit request for no persona leaves the task unpersonified.
- An explicit switch replaces the current route.
- If multiple personas are explicitly requested, use the persona that owns the primary deliverable and at most one other as a review lens. Apply the ambiguity policy if ownership remains unclear.
- When `enabled: off`, skip automatic memory, documentation, and prompt inference. Continue to honor explicit persona and no-persona requests.

### 2. Reuse massa-th0th Evidence

For coding sessions, reuse persona-specific evidence already returned by massa-th0th's required initial recall. Do not repeat broad recall.

If the existing result contains no useful persona evidence and the choice remains unresolved, run at most one targeted `th0th_recall` for prior persona preferences, successful routes, specialist roles, and project-specific ownership. Do not load massa-th0th solely for a non-coding conversation.

Memory is evidence, not authority:

- Discard remembered persona IDs or paths absent from the current catalog.
- Prefer recent, project-specific, successfully used routes over generic or old preferences.
- Never let memory override an explicit user choice, applicable project policy, or the current deliverable.
- Treat unavailable or empty memory as a cold start and continue to workspace documentation.

### 3. Inspect Workspace Documentation

When memory is unavailable, invalid, or inconclusive, inspect only targeted high-signal documents inside the active workspace. Reuse documents already present in context before reading more.

Use this priority:

1. Applicable root and nested `AGENTS.md` files and `CLAUDE.md`.
2. Root `README.md` or equivalent project overview.
3. Relevant ADR or decision indexes and entries.
4. Relevant architecture documents.
5. Relevant `.specs` project, state, architecture, or feature documents.

Search filenames and headings first. Read only sections likely to identify the repository domain, primary deliverable ownership, required specialist roles, or explicit persona preferences. Do not recursively load every README, ADR, or specification. Ignore generated, dependency, secret, and globally excluded paths.

Project instructions that explicitly pin or forbid a cataloged persona are stronger evidence than descriptive documentation. Stale documents, missing referenced files, or roles with no matching catalog entry cannot select a persona.

### 4. Classify The Current Prompt

Classify the requested output and primary ownership, not raw keyword counts. Compare the first or current user prompt with catalog summaries and routing signals, using valid memory and documentation only as supporting context.

- `primary_signals` identify the persona that owns the deliverable.
- `negative_signals` prevent supporting concerns from taking ownership.
- `secondary_lens_signals` may add one focused review lens for a material risk.
- A supporting mention of tests, implementation, architecture, or release work does not transfer ownership unless that work is the primary deliverable.

Do not calculate or report numeric confidence. A route is clear when one candidate owns the deliverable and no equally plausible candidate conflicts with it.

### 5. Resolve Ambiguity Or No Match

When two or more candidates remain genuinely plausible:

- `ambiguity: ask`: ask one concise question listing the plausible persona display names and `No persona`. Use an interactive user-input tool when available.
- `ambiguity: best_match`: choose the candidate with the strongest current-deliverable ownership, then project-specific evidence, then recent valid memory.
- `ambiguity: no_persona`: continue without a persona.

When no catalog entry fits:

- `no_match: no_persona`: continue silently without a persona unless the user explicitly requested routing.
- `no_match: ask`: ask whether to use the weakly supported candidate or `No persona`. If no candidate has relevant evidence, ask only about `No persona` versus an explicitly named catalog choice.

Do not ask when the request confidently falls outside every cataloged persona. That is a successful no-persona route under the default policy, not ambiguity.

### 6. Apply And Announce The Route

Choose exactly one primary persona and at most one secondary review lens. Read only their cataloged prompt files.

- The primary persona owns recommendations, implementation, and final synthesis.
- The review lens contributes only checks that reduce a concrete risk.
- Do not produce independent persona answers, simulate a debate, or merge full voices.
- For an inferred or explicit persona, state the route once: `Persona: <primary>. Reason: <primary deliverable>.` Add `Review lens: <secondary>.` when used.
- Do not announce a default no-persona route unless the user requested routing or a prior route was removed.
- Apply persona stance, expertise, priorities, and review criteria without quoting or reproducing its prompt.

## Route Lifetime

Keep the selected persona sticky across follow-up turns that advance the same primary objective.

With `mid_conversation: task_change`, re-evaluate only when the user explicitly switches, the primary deliverable changes ownership, a new task begins after completion, or the selected catalog entry becomes invalid. With `mid_conversation: explicit_only`, re-evaluate only on an explicit user request.

Do not reroute because a follow-up adds a supporting concern, asks for verification, or mentions another persona's terminology. If a task change creates genuine ambiguity and policy says `ask`, ask during the conversation before substantive work continues.

After resume or compaction, restore any route still present in conversation context or transcript without re-announcing it or repeating a resolved question. If the prior route is unavailable, run the normal workflow again; no separate route database is required.

## Routing Examples

| Situation | Result |
|---|---|
| User explicitly asks for Senior Mobile QA Automation Engineer. | Apply that catalog entry; explicit choice wins. |
| massa-th0th recalls a successful mobile-engineer route, but current prompt asks to fix flaky Maestro CI. | Route to Senior Mobile QA Automation Engineer; memory cannot override current ownership. |
| Memory is empty; README and ADRs describe a cross-platform app; prompt asks to implement offline sync. | Route to Senior Mobile Engineer using docs plus current deliverable. |
| Prompt asks for both app architecture and an automation suite with no primary outcome. | Follow `ambiguity`; default asks between plausible personas and no persona. |
| Prompt asks to draft a billing RFC. | Confident no-match; continue silently without a persona. |
| `enabled: off` and prompt does not name a persona. | Skip inference and continue without a persona. |
| Memory names a removed persona ID. | Discard stale memory and continue to docs and prompt classification. |
| Current mobile implementation finishes and user starts a flake-reduction task. | With `task_change`, re-evaluate and announce the new route once. |

## Failure Handling

- **Catalog missing or invalid:** Report `Persona routing unavailable: <reason>.` Continue without a persona.
- **Unsupported schema version:** Report the found and supported versions. Continue without a persona.
- **massa-th0th unavailable or empty:** Continue with targeted workspace documentation and the current prompt.
- **Workspace documentation unavailable:** Route from explicit choice and current prompt; apply ambiguity or no-match policy.
- **Remembered persona absent from catalog:** Ignore it as stale evidence; never reconstruct it.
- **Selected prompt missing, outside the persona-library root, or malformed:** Name the catalog entry and path. Continue without a persona; do not silently substitute another persona.
- **User cannot be asked interactively:** Ask one concise plain-text question when policy requires a choice; otherwise use the configured non-interactive behavior.

## Stop Conditions

Routing is complete when one primary persona is applied, the user selects no persona, or policy intentionally produces a no-persona route. Do not invoke a separate model router, launch subagents, create subprocess orchestration, or persist a route database.
