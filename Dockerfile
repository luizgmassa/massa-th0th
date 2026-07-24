# ============================================
# massa-ai - Multi-stage Docker Build
# ============================================
# Targets:
#   api  - Tools API (ElysiaJS REST on :3333)
#   mcp  - MCP Client (stdio proxy to API)
#
# Usage:
#   docker compose up              # API + MCP
#   docker build --target api .    # API only
#   docker build --target mcp .    # MCP only
# ============================================

# ---- Base: install dependencies & build ----
FROM oven/bun:1.3.14-alpine AS base

# Node.js required by Prisma
RUN apk add --no-cache nodejs-current

WORKDIR /app

# Copy dependency manifests first (cache layer)
COPY package.json bun.lock turbo.json tsconfig.json bunfig.toml ./
COPY packages/core/package.json packages/core/
COPY packages/shared/package.json packages/shared/
COPY apps/tools-api/package.json apps/tools-api/
COPY apps/mcp-client/package.json apps/mcp-client/
COPY apps/opencode-plugin/package.json apps/opencode-plugin/

# Bun patchedDependencies (the tree-sitter prebuilt-binary patch) must be in
# the install context, or `bun install` fails resolving the patch file.
COPY patches ./patches

# Install dependencies (ignore Prisma postinstall that checks Node version)
RUN bun install --ignore-scripts

# Copy source code (web-ui is served by tools-api; plugins install separately)
COPY packages ./packages
COPY apps/tools-api ./apps/tools-api
COPY apps/mcp-client ./apps/mcp-client
COPY apps/opencode-plugin ./apps/opencode-plugin

# Generate Prisma client
RUN cd packages/core && bunx prisma generate

# Build everything
RUN bun run build

# ---- API Target ----
FROM oven/bun:1.3.14-alpine AS api

RUN apk add --no-cache nodejs-current curl

WORKDIR /app

COPY --from=base /app/node_modules ./node_modules
COPY --from=base /app/packages ./packages
COPY --from=base /app/apps/tools-api ./apps/tools-api
COPY --from=base /app/package.json ./package.json
COPY --from=base /app/bunfig.toml ./bunfig.toml

# Entrypoint: runs Prisma migrations before starting the API
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

# Data directory for non-database runtime artifacts
RUN mkdir -p /data

ENV NODE_ENV=production
ENV MASSA_AI_API_PORT=3333
# Default: Ollama on host network
ENV OLLAMA_BASE_URL=http://host.docker.internal:11434
ENV OLLAMA_EMBEDDING_MODEL=qwen3-embedding:8b
ENV OLLAMA_EMBEDDING_DIMENSIONS=4096

EXPOSE 3333

HEALTHCHECK --interval=30s --timeout=3s --start-period=60s --retries=3 \
  CMD curl -sf http://localhost:3333/health || exit 1

ENTRYPOINT ["/entrypoint.sh"]
CMD ["bun", "./apps/tools-api/src/index.ts"]

# ---- MCP Target ----
FROM oven/bun:1.3.14-alpine AS mcp

RUN apk add --no-cache nodejs-current

WORKDIR /app

COPY --from=base /app ./

ENV NODE_ENV=production
# MCP client connects to the API container
ENV MASSA_AI_API_URL=http://massa-ai-api:3333

# stdio transport - no ports exposed
CMD ["bun", "./apps/mcp-client/src/index.ts"]
