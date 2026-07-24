# Gate Manifest

Frozen before tests. Discovery may append evidence-backed rows; rows may not be removed.
Dedicated DB: `postgresql://test:test@127.0.0.1:5433/massa_ai_test`.

| ID | Gate | Exact command family | Backend/services | Destructive | Root aggregate | Result |
| --- | --- | --- | --- | --- | --- | --- |
| G01 | Build | `bun run build` | neutral | No | prerequisite | PASS — 5 tasks |
| G02 | Type-check | `bun run type-check` | neutral | No | No | PASS — 6/6 after F-01..F-03 fixes |
| G03 | Shared unit | `bun run --filter @massa-ai/shared test` | explicit PG env | No | Yes | PASS — 11/0/0 |
| G04 | Core unit | `bun run --filter @massa-ai/core test:unit` | explicit PG; E2E off; LLM off | No | Yes | PASS — 96 files, 25 isolation groups; 2 expected code-model skips |
| G05 | MCP unit | `bun run --filter @massa-ai/mcp-client test` | neutral | No | Yes | PASS — 7/0/0 |
| G06 | Tools API unit | `bun run --filter @massa-ai/tools-api test` | explicit PG | No | Yes | PASS — 52/0/0 after host-network rerun |
| G07 | OpenCode unit | `bun run --filter @massa-ai/opencode-plugin test` | explicit PG | No | Yes | PASS — 18/0/0 |
| G08 | Script tests | `bun run test:scripts` | host shell | No | No | PASS — 8/0/0 |
| G09 | Core integration | `bun run --filter @massa-ai/core test:integration` | API `:3334`, PG `:5433`, Ollama | No | Maybe | PASS — 23 expected RUN_E2E-off skips |
| G10 | Standard E2E | `bun run --filter @massa-ai/core test:e2e` | API `:3334`, PG `:5433`, MCP, Ollama `:11435` | Prefix-scoped | No | DOCUMENTED EXCEPTION — full default-qwen run passed before parity amendments; post-amendment bge run completed all groups but two qwen-calibrated quality gates failed; final default-qwen cold run hit the 420s indexing deadline before assertions (E-08/E-09). Memory matrix fix passed live 25/25; all changed PG subsystems have focused evidence |
| G11 | Executable destructive | `RUN_E2E=1 RUN_E2E_DESTRUCTIVE=1 bun test src/__tests__/e2e/16.destructive.test.ts` in core | dedicated only | Yes | No | PASS — N9/N12/N13/F87 pass; N1/N3/E25/F88 documented static runbook skips; 0 fail |
| G12 | Reprovision | health/backend/config/PID sentinels | dedicated + shared | Recreate dedicated | No | PASS — clean DB, 14 migrations, pgvector 0.8.4, both APIs healthy |
| G13 | Root aggregate | `bun run test` | explicit PG; E2E off; live integration excluded; test cache disabled | No | canonical | PASS — final uncached 10/10 Turbo tasks; core 129 files in 74 groups; exit 0; explicit integration suite did not run |
| G14 | LLM judge benchmark | `bun test src/__tests__/llm-judge.benchmark.test.ts` | dedicated Ollama `:11435`, OpenAI base `/v1` | No | Included in G13 | PASS — 4/0/0 against qwen2.5 instruct/coder floors |

## Expected-Skip Classes

- Live E2E when `RUN_E2E` is unset in unit/aggregate gates.
- Static destructive runbooks N1, N3, E25, F88; external orchestration required.
- LLM code-model tests when a distinct code model is unavailable.
- LLM-judge benchmark only when its Ollama probe is unavailable; the final gate ran all four assertions against the dedicated service.
- SQLite-only gates: report, but never use as PostgreSQL acceptance evidence.

Every other skip is unexplained until classified in `failure-ledger.md`.
