# Installer LLM Search-Quality Toggles Specification

Slug: `installer-llm-search-quality-toggles`. Source: `woolly-giggling-beaver.md`.

## Requirements

1. Both installation paths offer default-off `[y/N]` choices for `SEARCH_QUERY_UNDERSTANDING_ENABLED` and `SEARCH_RERANK_ENABLED` only when the local LLM path is usable.
2. Selected values are emitted to generated `.env` files and summarized to the user.
3. Query understanding preserves `hydeEnabled=true`, five-minute cache TTL, and 256-entry cache; reranking retains its default-off 50-result window.
4. The installer explains synchronous latency/quality trade-offs.

## Out of Scope

Changing Phase 2/7 runtime contracts or treating temporary-plan harness claims as persistent test evidence.

## Verification Approach

Commit `17ac0d1` is the direct implementation; current-session validation is documentation-only.
