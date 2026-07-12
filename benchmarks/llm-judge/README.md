# massa-th0th LLM-judge Benchmark

Benchmark for the qwen2.5 model swap on the three LLM-judge paths:
**consolidator merge-decision**, **salience judge**, and **LLM-judge reranker**.

The deterministic needles harness (`benchmarks/needles/`) does NOT exercise the
judge — it only measures embedding recall. This benchmark closes that gap:
it drives the REAL local Ollama LLM (`qwen2.5:7b-instruct` + `qwen2.5-coder:7b`)
through the judge code paths against curated known-duplicate / known-distinct
ground truth and reports precision / recall / F1.

## Layout

```
benchmarks/llm-judge/
├── run.ts                         # harness: drives the real LLM, writes results JSON
├── scorer.ts                      # pure scorer: fixtures + results → report + evaluations
├── fixtures/
│   ├── known-dup.json             # dup groups (paraphrases of the same fact; SHOULD merge)
│   └── known-distinct.json        # distinct pairs (share keywords; should NOT merge)
└── reports/                       # results JSON + generated reports (gitignored)
```

## What the judges are

### (a) Consolidator merge-decision probe
For each known-dup group: send all members to the LLM and ask
"are these duplicates?". Ground truth = merge=true.
For each known-distinct pair: send the two members and ask the same.
Ground truth = merge=false.

This isolates the **judge decision** from the rule-based cosine prefilter (the
real `consolidateWindow` clusters on embeddings first; the LLM only echoes the
sourceIds of the picked cluster). The probe scores the LLM's semantic-similarity
judgment directly — the quality the model swap affects.

### (b) Salience-judge consistency
Score every member of each dup-group via `SalienceJudge.scoreSalience`. Paraphrases
of the same fact should score within `salienceTolerance` (default 0.2) of the group
mean. Reported as the fraction of consistent groups + the mean intra-group spread.

### (c) Reranker
For each rerank case: feed candidates (with a known best result NOT at the head)
through `LLMJudgeReranker.rerank` and check whether the expected-best lands at
rank 1 (`hit@1`).

## Metrics (per-judge + aggregate)

| Judge | Metric | Meaning |
|---|---|---|
| Consolidator merge | precision | Of entries the judge flagged "merge", how many were true dup-groups |
| Consolidator merge | recall | Of true dup-groups, how many the judge flagged "merge" |
| Consolidator merge | F1 | harmonic mean of precision/recall |
| Consolidator merge | accuracy | (TP+TN)/N over all dup-group + distinct-pair probes |
| Salience | consistencyRate | Fraction of dup-groups whose scores fall within tolerance of the mean |
| Salience | meanSpread | Average (max−min) score within a group (lower is better) |
| Reranker | hit@1 | Fraction of cases where the expected-best id is ranked first |

## Running

```sh
# 1. Drive the real LLM (needs Ollama up with qwen2.5:7b-instruct + qwen2.5-coder:7b):
bun benchmarks/llm-judge/run.ts --label baseline

# 2. Score (fixtures + results → report + evaluations):
bun benchmarks/llm-judge/scorer.ts \
  --dup benchmarks/llm-judge/fixtures/known-dup.json \
  --distinct benchmarks/llm-judge/fixtures/known-distinct.json \
  --results benchmarks/llm-judge/reports/llm-judge-baseline-results.json
```

Reports are written under `reports/` (gitignored). The `--label` arg is the report
filename; the only timestamp is the in-body `ranAt` field (mirrors the needles
harness — no `Date.now()` for the path).

### Env overrides

| Var | Default | Purpose |
|---|---|---|
| `RLM_LLM_MODEL` | `qwen2.5:7b-instruct` | instruct model (consolidator + salience probes) |
| `RLM_LLM_CODE_MODEL` | `qwen2.5-coder:7b` | coder model (reranker probe) |
| `RLM_LLM_BASE_URL` | `http://localhost:11434/v1` | Ollama OpenAI-compat endpoint |

## Comparing vs the baseline

The gated test `packages/core/src/__tests__/llm-judge.benchmark.test.ts` asserts
non-regression against committed threshold floors (precision/recall/rerank
hit@1) and skips cleanly when Ollama is down. To calibrate floors from a fresh
run, see the recorded baseline numbers in that test's header comment; bump the
floors only after a deliberate model/prompt change, not on noise.

The committed baseline is recorded in the test header. A future model swap (or
prompt change) should re-run `run.ts` and update both the baseline numbers and
the floors together.
