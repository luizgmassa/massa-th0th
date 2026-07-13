# Qwen Model Defaults Specification

Slug: `qwen-model-defaults`. Source: `let-s-use-qwen-embedding-8b-for-goofy-hennessy.md`.

## Requirements

- Default embedding and LLM model configuration uses the recorded Qwen model/budget choices.
- Installer and documentation expose matching defaults.
- Reindexing, model availability, and runtime validation remain explicit operational gates rather than implied by configuration changes.

## Out of Scope

Treating a model default swap as proof of installed models, successful reindex, or production quality.

## Verification Approach

Historical commits `d381721` and `c730076`; missing model-pull/reindex/diagnose evidence remains an open validation gap.
