# Woolly Giggling Beaver — Design and Execution Record

## Source plan

`/Users/luizmassa/.claude/plans/woolly-giggling-beaver.md` — interactive
opt-in search-quality toggles across `install.sh` and
`scripts/setup-local-first.sh`.

## Intent and scope

Preserve installer parity for the synchronous LLM-backed search features:
`SEARCH_QUERY_UNDERSTANDING_ENABLED` and `SEARCH_RERANK_ENABLED`. The plan
required explicit, default-off choices with latency/quality warnings, while
keeping the toggles usable only when the local LLM path is enabled.

## Implemented outcome

Verified commit evidence shows both installer paths now expose the two `[y/N]`
choices and emit their selected values into generated `.env` files.

- `install.sh` adds `prompt_search_quality_flags`, skips prompts for
  `NO_START=1` or an unavailable LLM model, reads from `/dev/tty`, and passes
  selected values into `write_env`.
- `scripts/setup-local-first.sh` configures `LLM_MODEL` (default
  `qwen2.5-coder:7b`), pulls it when absent, offers both choices, appends one
  shared LLM/search configuration block after either database branch, and
  reports the enabled LLM plus selected search options in its summary.
- In both paths, HyDE remains enabled as a subordinate setting; the primary
  query-understanding gate remains selected default-off.

## Commit evidence

### Plan implementation

- `17ac0d180667ad537bd8db9395864e43b6f5d14c` — `feat(install): offer LLM search-quality toggles at install time`
  - Changes `install.sh` and `scripts/setup-local-first.sh` only (+111/-3).
  - Commit patch and message substantiate the prompt gates, source-mode model
    pull, `.env` emission, and summary update described above.

## Spec/acceptance facts now worth preserving

- Query understanding is a typed, default-off feature controlled by
  `SEARCH_QUERY_UNDERSTANDING_ENABLED`; its accepted configuration preserves
  `hydeEnabled=true`, a five-minute cache TTL, and a 256-entry cache.
- Reranking is separately default-off through `SEARCH_RERANK_ENABLED`; its
  configured rerank window is 50.
- These installer choices are opt-in because the features run synchronously on
  search and can add LLM latency and result-quality variance. This rationale is
  stated by the source plan and implementation commit, not independently
  re-measured here.

## Deviations or unresolved gaps

- No material implementation deviation found between the source plan and
  `17ac0d1`.
- The plan proposed temporary harness coverage. The commit message reports
  syntax and prompt/append matrix checks, but this record does not independently
  reproduce them; no persistent test files were changed by the implementation
  commit.

## Cross-references

- [Phase 2 — Query Understanding spec](../../phase-2-query-understanding/spec.md)
  and [validation](../../phase-2-query-understanding/validation.md) define the
  default-off query-understanding gate and HyDE/cache behavior.
- [Phase 7 — Retrieval Polish spec](../../phase-7-retrieval-polish/spec.md)
  and [validation](../../phase-7-retrieval-polish/validation.md) preserve the
  default-off rerank gate and window.

## Verification evidence used

- Read source plan and inspected the implementation commit's metadata and
  focused patch in the assigned inclusive range.
- Compared current installer occurrences of both feature flags and the
  `qwen2.5-coder:7b` source-mode setup with the recorded implementation.
- Documentation-artifact checks: file non-empty and `git diff --check`.
