# massa-ai Needles Benchmark

Needle-in-haystack harness for measuring massa-ai's semantic search recall against
real codebases.

## Layout

```
benchmarks/needles/
├── run.ts               # Standalone harness: chunk → embed → rank → score (no live API)
├── scorer.ts            # CLI: reads dataset + harness output, writes report
├── fixtures/            # Per-project needle datasets (versioned)
│   ├── sicad.json       # 12 needles validated against the Sicad codebase
│   └── massa-ai.json # 14 needles (dogfood) validated against this repo
└── reports/             # Harness outputs and generated reports (gitignored)
```

## Pipeline

```
fixtures/<project>.json ──┐
                          ├─▶ [E] harness                ─▶ reports/<project>-results.json
                          │   (Claude calls search per needle)
                          │                                       │
                          │                                       ▼
                          └────────────────────────▶ [T] scorer.ts ─▶ <project>.md + <project>.evaluations.json
```

- **E (Extract)** — the harness iterates over `fixtures/<project>.json` and,
  for each needle, calls
  `mcp__massa-ai__search(query, projectId=<project>, maxResults=10)`.
  Raw responses are accumulated into `reports/<project>-results.json` in the
  format documented at the top of `scorer.ts`.
- **T (Transform/Load)** — `scorer.ts` computes `hit@1/3/5/10`, `MRR`, and
  per-category / per-difficulty breakdowns. A "hit" requires the chunk's
  `filePath` to match the needle's expected file AND the chunk's
  `[lineStart, lineEnd]` to intersect the expected range within
  `lineTolerance` (default 5).

## Standalone harness (`run.ts`)

`run.ts` is a self-contained chunker-quality harness that does NOT need the
live tools-api stack or a database. It chunks each referenced source file with
`smartChunk`, embeds the query + every chunk via the Ollama embedding endpoint
(`qwen3-embedding:8b` by default — the same model as the E2E baseline), and
cosine-ranks chunks per query. This isolates chunker effects from API/DB/RRF
variance, giving stable, reproducible before/after numbers for tuning.

```sh
# Default config (uses the smart-chunker DEFAULT_CONFIG):
bun benchmarks/needles/run.ts

# Tune chunker params for a sweep:
bun benchmarks/needles/run.ts --codeChunkTarget 50 --chunkOverlapLines 6

# CI regression gate (exit 1 if hit@1/MRR below floor env vars):
bun run bench:needles:gate
#   NEEDLE_FLOOR_HIT1=0.5 NEEDLE_FLOOR_MRR=0.65
```

Env: `OLLAMA_HOST` (default `http://localhost:11434`), `NEEDLE_MODEL` (default
`qwen3-embedding:8b`), `NEEDLE_FLOOR_HIT1`, `NEEDLE_FLOOR_MRR`. Results are
written under `reports/` (gitignored).

The full-stack gate (live API + Postgres + RRF) lives in the E2E suite:
`packages/core/src/__tests__/e2e/14.needles.test.ts` (run with `RUN_E2E=1`).

## Adding a new project

1. Put a fixture at `fixtures/<projectId>.json` following the same shape as
   `sicad.json` (see "Schema" below).
2. Make sure the project is indexed by massa-ai (`mcp__massa-ai__index` with
   `projectPath` and `projectId` matching the fixture).
3. Run the harness (today: a Claude Code session that loops the queries).
4. Score:
   ```sh
   bun benchmarks/needles/scorer.ts \
     --dataset benchmarks/needles/fixtures/<projectId>.json \
     --results benchmarks/needles/reports/<projectId>-results.json
   ```
   The scorer writes `<projectId>.md` and `<projectId>.evaluations.json`
   alongside the results file (override with `--out <prefix>`).

## Why needle-in-haystack?

Each fixture is curated to **penalise keyword search** so it actually exercises
semantic recall. The Sicad fixture covers seven hard categories:

| Category | What it tests |
|---|---|
| `domain-concept-without-keyword` | Historical/legal rules expressed only as arithmetic |
| `cross-language-stack` | Translation chains: enum → string → BACEN code |
| `business-rule-in-utility` | Business rules disguised as generic validators |
| `dynamic-property-access` | `obj[key]`, `'foo' in obj`, `as any` — invisible to indexers |
| `string-literal-config-magic` | Magic numbers that encode case-law thresholds |
| `portuguese-domain-concept` | Intent only clear via PT-BR comments (13º salário, pro-rata) |
| `cross-file-event-coupling` | Fire-and-forget promises with no static coupling |

## Schema

`fixtures/<projectId>.json`:

```jsonc
{
  "projectId": "sicad",
  "version": "1.0.0",
  "description": "...",
  "scoring": {
    "topK": 10,
    "hitAtK": [1, 3, 5, 10],
    "lineTolerance": 5,
    "notes": "A hit requires filePath equality AND [lineStart, lineEnd] intersection (with ±lineTolerance on each side)."
  },
  "needles": [
    {
      "id": "N01-...",
      "category": "domain-concept-without-keyword",
      "difficulty": "hard",
      "query": "...",
      "expected": { "filePath": "...", "lineStart": 71, "lineEnd": 93 },
      "rationale": "..."
    }
  ]
}
```

`reports/<projectId>-results.json`:

```jsonc
{
  "projectId": "sicad",
  "ranAt": "2026-04-20T00:00:00Z",
  "results": [
    {
      "needleId": "N01-...",
      "query": "...",
      "hits": [
        { "filePath": "...", "lineStart": 1, "lineEnd": 17, "score": 0.84 }
      ]
    }
  ]
}
```
