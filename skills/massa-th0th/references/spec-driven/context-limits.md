# Spec-Driven Context Limits

Use this reference when planning context loading for a spec-driven feature or when `.specs/features/<slug>/` artifacts grow large enough to reduce implementation quality.

## Targets

- Loaded working context target: under 40k tokens (20% of the window).
- Warning range: 40k to 60k tokens.
- Critical range: above 60k tokens.
- Reserve: 160k+ tokens for work, reasoning, and outputs.

## Base Load Set

The deterministic starting context for a spec-driven task is a ~15k-token base set, loaded once before deeper artifacts:

- The selected workflow (`workflows/spec-driven.md`) — routing and phase contracts.
- `references/spec-driven/memory.md` and `references/spec-driven/artifact-store.md` — state layer + precedence.
- `.specs/project/STATE.md` and `.specs/HANDOFF.md` — current position and decisions.
- The active feature's `spec.md` (requirements + ACs) — the source of truth for the work.

Load additional phase references (`specify.md`, `design.md`, `tasks.md`, `execute.md`, `validate.md`) only when the active phase needs them, and unload/summarize when the phase closes. The base set keeps the starting footprint predictable; phase references are additive and bounded.

## File Size Limits

| File          | Max Tokens | ~Words | Warning At |
| ------------- | ---------- | ------ | ---------- |
| `spec.md`     | 5,000      | 3,000  | 4,000      |
| `design.md`   | 8,000      | 4,800  | 6,400      |
| `tasks.md`    | 10,000     | 6,000  | 8,000      |

## Artifact Budgets

| Artifact   | Target              |
| ---------- | ------------------- |
| `spec.md`  | 5k tokens or less   |
| `design.md`| 8k tokens or less   |
| `tasks.md` | 10k tokens or less  |

## Context Zones

- 🟢 **Healthy** (<40k total): Silent.
- 🟡 **Moderate** (40-60k): Discrete footer note.
- 🔴 **Critical** (>60k): Active warning, suggest optimization.

## Monitoring

Display context status in footer when loaded context exceeds 40k:

```
📊 Context: 52k tokens (moderate)
  - tasks.md: 11k (ok)
  - design.md: 6k (ok)
  - Total: 52k / 200k (26%)
```

## Rules

- Load one active feature's `.specs/features/<slug>/` artifacts at a time.
- Never load multiple feature specs or architecture docs simultaneously — cross-feature loading invites stale-requirement bleed and blows the context budget. If a second feature's context is needed, summarize the first, persist position to `.specs/HANDOFF.md`, then load the next feature alone.
- Prefer summaries, targeted sections, and file ranges over full broad dumps.
- Use `references/context-firewall.md` before raw logs, raw transcripts, raw search output, generated reports, screenshots, large diffs, subagent output, or external research.
- Report context pressure as a compact status or `.specs/HANDOFF.md` field when loaded context approaches warning or critical range; do not paste raw context dumps to explain pressure.
- If context exceeds the warning range, compact artifact summaries before adding more source.
- If context exceeds the critical range, stop and produce a restartable handoff (`.specs/HANDOFF.md`) before continuing.
