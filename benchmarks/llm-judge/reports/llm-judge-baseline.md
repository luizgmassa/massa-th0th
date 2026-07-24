# massa-ai LLM-judge Benchmark Report

- Ran at: `2026-07-12T15:47:09.981Z`
- Instruction model: `qwen2.5:7b-instruct`
- Coder model: `qwen2.5-coder:7b`

## Aggregate

| Judge | Metric | Value |
|---|---|---:|
| Consolidator merge | n | 10 |
| Consolidator merge | TP / FP / FN / TN | 2 / 0 / 2 / 6 |
| Consolidator merge | precision | 1 |
| Consolidator merge | recall | 0.5 |
| Consolidator merge | F1 | 0.667 |
| Consolidator merge | accuracy | 0.8 |
| Salience consistency | groups | 4 |
| Salience consistency | consistent groups | 2 |
| Salience consistency | consistency rate | 0.5 |
| Salience consistency | mean spread | 0.4 |
| Reranker | cases | 3 |
| Reranker | hit@1 | 0.667 |

## Merge-decision per-case

| ref | kind | expected | judge | outcome |
|---|---|---|---|---|
| G1-llm-model-swap | dup-group | merge | merge | TP |
| G2-file-cache-lru | dup-group | merge | merge | TP |
| G3-checkpoint-async | dup-group | merge | distinct | FN |
| G4-skip-guards-removed | dup-group | merge | distinct | FN |
| P1-same-keyword-different-fact | distinct-pair | distinct | distinct | TN |
| P2-same-model-different-action | distinct-pair | distinct | distinct | TN |
| P3-same-component-different-concern | distinct-pair | distinct | distinct | TN |
| P4-same-test-different-target | distinct-pair | distinct | distinct | TN |
| P5-near-paraphrase-different-domain | distinct-pair | distinct | distinct | TN |
| P6-opposite-actions | distinct-pair | distinct | distinct | TN |

## Salience per-group

| group | scores | spread | consistent |
|---|---|---:|---|
| G1-llm-model-swap | [0.80, 0.20, 0.80] | 0.60 | no |
| G2-file-cache-lru | [0.60, 0.70] | 0.10 | yes |
| G3-checkpoint-async | [0.20, 0.65, 0.70] | 0.50 | no |
| G4-skip-guards-removed | [0.30, 0.70] | 0.40 | yes |

## Reranker per-case

| case | query | expected best | judge top | hit@1 |
|---|---|---|---|---|
| R1-llm-swap | why was the LLM model swapped to qwen2.5 | best-swap | best-swap | yes |
| R2-checkpoint-async | checkpoint restore made async for real postgres select | best-ckpt | best-ckpt | yes |
| R3-config-drift | config interface reconciled with runtime server config shape | best-config | distract-deps | no |
