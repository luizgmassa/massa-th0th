# Context Slices

Opt-in context **mode slices** that load only the mode a session needs, instead
of one monolithic bootstrap. Slices are plain Markdown files under `contexts/`.

## Available Slices

| Slice | File | Mode |
|---|---|---|
| dev | `contexts/dev.md` | write-first: implement, verify, then explain |
| review | `contexts/review.md` | structured PR-review output, one line per finding |
| research | `contexts/research.md` | read-widely-before-concluding, cite evidence |

## How To Load

Use the `--system-prompt` alias technique (Claude Code):

```
claude --system-prompt "$(cat contexts/dev.md)"
```

For other agents, transport the slice content into the session's
additional-context channel (the installer's SessionStart already transports
the `AGENTS.md` bootstrap; a slice is an additional, mode-specific layer).

## Design Rules

- Slices are **opt-in via aliases**; they are NOT forced into the `AGENTS.md`
  bootstrap. `AGENTS.md` remains the single startup source (progressive
  disclosure; one canonical location per rule).
- A slice composes with system/developer/project instructions; it never
  overrides them.
- A slice names the massa-ai references it activates; it does not re-author
  them.
- Slices stay small (one screen of mode contract + active references).

## When To Use Which

- `dev` — focused implementation or modification sessions.
- `review` — diff/branch/file review with structured findings output.
- `research` — investigation, mapping, or answering from an unfamiliar area
  before any mutation.

## Verification

`scripts/validate_repository.py` checks that context slices exist, are
non-empty, and carry their mode contract; see the `hooks`/context-slice
invariants.
