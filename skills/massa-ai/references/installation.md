# Massa-ai Installation And Diagnostics

Load this only for installing, configuring, validating, or troubleshooting the
massa-ai stack. Ordinary workflow routing should use MCP tools instead.

## Install And Upgrade

Current recommended installer:

```bash
curl -fsSL https://raw.githubusercontent.com/luizgmassa/massa-ai/main/install.sh | bash
```

Interactive modes:

| Mode | Requires | Intended use |
|---|---|---|
| Docker | Docker | Default production/quick-start path. |
| Docker build | Docker and Git | Local changes and custom images. |
| Source | Git and Bun | Development and contribution. |

Non-interactive installs may set `MASSA_AI_MODE`, `MASSA_AI_API_PORT`, and
`MASSA_AI_NO_START`. Review the downloaded script and environment before using the
one-line installer in sensitive environments.

Manual source setup:

```bash
git clone https://github.com/luizgmassa/massa-ai.git
cd massa-ai
bun install
./scripts/setup-local-first.sh
bun run build
bun run start:api
```

`setup-local-first.sh` configures Ollama, pulls the embedding model, creates
defaults, and runs diagnostics. Confirm the selected mode and current upstream
instructions before upgrades.

## Configuration

Relevant settings include:

- `DATABASE_URL` and `POSTGRES_PASSWORD` for PostgreSQL/pgvector.
- Embedding provider, model, dimensions, API key, and provider base URL.
- `MASSA_AI_API_URL` for MCP/REST clients.
- `MASSA_AI_API_KEY` for API protection; REST clients send it as `x-api-key`.
- Search tuning such as `SEARCH_DISABLE_KEYWORD`, `SEARCH_MIN_SCORE`,
  `RRF_KEYWORD_BOOST`, `RRF_VECTOR_WEIGHT`, and
  `RRF_MAX_CHUNKS_PER_FILE`.
- Synapse toggles including `SYNAPSE_ENABLED` and
  `SYNAPSE_ATTENTION_ENABLED`.

Current config CLI:

```bash
npx @massa-ai/mcp-client --config-show
npx @massa-ai/mcp-client --config-path
npx @massa-ai/mcp-client --config-dir
npx @massa-ai/mcp-client --config-init
npx @massa-ai/mcp-client --config-set embedding.dimensions 4096
```

Provider initialization supports Ollama plus `--mistral` and `--openai`
credentials. Never place provider keys in committed config.

Never print, persist, commit, or include API keys in memory or status output.

## Validation And Diagnostics

Use the installation's supported CLI diagnostics when present, including
`bun run diagnose` and current config commands documented upstream. Also check:

```bash
docker compose ps
rtk curl -sS http://localhost:3333/health
rtk curl -sS http://localhost:3333/api/v1/system/status
rtk curl -sS http://localhost:3333/api/v1/system/health/local
rtk curl -sS http://localhost:3333/api/v1/system/ollama
```

Add `x-api-key` for protected deployments without echoing the value. Swagger is
served at `/swagger`; its machine-readable contract is `/swagger/json`.

Swagger response schemas may be empty and its displayed API version may lag the
package release. Use it to inspect routes/request fields, then verify important
behavior through MCP declarations and non-destructive runtime probes.

## Deployment Notes

- WSL/Linux Docker setups may need `host.docker.internal:host-gateway`.
- Standard Docker startup should run migrations before the API process.
- Confirm the embedding provider is reachable from inside the API container.
- Do not reset vectors, symbols, or memories unless explicit destructive intent
  exists. Prefer normal indexing or the verified full-index fallback.

## Client Integrations

- OpenCode: local MCP package via `bunx @massa-ai/mcp-client`, or
  `@massa-ai/opencode-plugin`.
- VS Code/Antigravity: `.vscode/mcp.json` or `./scripts/setup-vscode.sh`.
- Docker: run the `mcp` service through `docker compose run --rm -i mcp`.

All MCP clients need the correct `MASSA_AI_API_URL`; protected deployments also
need `MASSA_AI_API_KEY` in the client environment.