#!/usr/bin/env node
/**
 * massa-th0th MCP Client
 *
 * Cliente MCP que se conecta ao OpenCode via stdio
 * e faz proxy das tool calls para a Tools API via HTTP.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import fs from "fs/promises";
import { ApiClient } from "./api-client.js";
import { EmbeddedApiClient } from "./embedded-api-client.js";
import { collectFiles } from "./file-collector.js";
import { TOOL_DEFINITIONS } from "./tool-definitions.js";
import { proxyCallTool, type ToolProxyApiClient } from "./call-tool-proxy.js";
import { pageToolDefinitions } from "./tool-discovery.js";
import { applyMoonshotFlavor, resolveFlavor } from "./moonshot-flavor.js";
import {
  configExists,
  initConfig,
  loadConfig,
  getConfigPath,
  getConfigDir
} from "@massa-th0th/shared/config";

// Check for config-related flags before starting MCP server
const args = process.argv.slice(2);

if (args.includes("--config-show")) {
  try {
    const config = loadConfig();
    console.log(JSON.stringify(config, null, 2));
    process.exit(0);
  } catch (error) {
    console.error("Error loading config:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args.includes("--config-path")) {
  console.log(getConfigPath());
  process.exit(0);
}

if (args.includes("--config-dir")) {
  console.log(getConfigDir());
  process.exit(0);
}

if (args.includes("--config-init")) {
  try {
    initConfig();
    console.log(`Configuration initialized at: ${getConfigPath()}`);
    process.exit(0);
  } catch (error) {
    console.error("Error initializing config:", error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`
massa-th0th MCP Client

Usage:
  npx @massa-th0th/mcp-client [options]

Options:
  --config-show     Show current configuration
  --config-path     Show config file path
  --config-dir      Show config directory path
  --config-init     Initialize configuration
  --help, -h        Show this help message

For advanced configuration, use the config CLI:
  npx @massa-th0th/mcp-client massa-th0th-config <command>

Examples:
  npx @massa-th0th/mcp-client --config-show
  npx @massa-th0th/mcp-client --config-path
`);
  process.exit(0);
}

function textContent(text: string) {
  return { content: [{ type: "text" as const, text }] };
}

/**
 * The apiClient must implement the ToolProxyApiClient interface (for proxyCallTool)
 * AND expose uploadAndIndex + healthCheck (called directly by McpProxyServer for
 * the `index` tool and startup health check). Both ApiClient and EmbeddedApiClient
 * satisfy this union.
 */
type ApiClientLike = ToolProxyApiClient & {
  uploadAndIndex(params: {
    projectPath: string;
    projectId?: string;
    forceReindex?: boolean;
    warmCache?: boolean;
    warmupQueries?: string[];
    files: Array<{ relativePath: string; content: string }>;
  }): Promise<unknown>;
  healthCheck(): Promise<boolean>;
};

function isEmbeddedMode(): boolean {
  return process.env.MASSA_TH0TH_EMBEDDED === "true";
}

// Reject unknown CLI flags (usage error, exit code 2).
const KNOWN_FLAGS = ["--config-show", "--config-path", "--config-dir", "--config-init", "--help", "-h"];
const unknown = args.filter((a) => a.startsWith("-") && !KNOWN_FLAGS.includes(a));
if (unknown.length) {
  console.error(`Unknown flag: ${unknown[0]}\nRun 'massa-th0th --help' for usage.`);
  process.exit(2);
}

// Auto-configure on first run
if (!configExists()) {
  initConfig();
  console.log(`
[massa-th0th] Initialized with default configuration
[massa-th0th] Config: ${getConfigPath()}
[massa-th0th] Provider: Ollama (local, free)
[massa-th0th] To change: npx @massa-th0th/mcp-client massa-th0th-config use mistral --api-key YOUR_KEY
`);
}

class McpProxyServer {
  private server: Server;
  private transport: StdioServerTransport;
  private apiClient: ApiClientLike;
  private mode: "embedded" | "http";

  constructor() {
    this.server = new Server(
      {
        name: "massa-th0th",
        version: "1.0.0",
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.transport = new StdioServerTransport();
    if (isEmbeddedMode()) {
      this.apiClient = new EmbeddedApiClient() as ApiClientLike;
      this.mode = "embedded";
    } else {
      this.apiClient = new ApiClient() as ApiClientLike;
      this.mode = "http";
    }
    this.setupHandlers();
  }

  private setupHandlers(): void {
    // List tools in stable protocol pages. Current roster remains one page.
    // Wave 5 FR-17: `?flavor=moonshot` strips root-level JSON Schema
    // combinators from each tool's inputSchema (transport-only, no storage
    // rewrite). The flavor may arrive via `_meta.flavor` or a `flavor`
    // param on the request.
    this.server.setRequestHandler(ListToolsRequestSchema, async (request) => {
      const result = pageToolDefinitions(TOOL_DEFINITIONS, request.params?.cursor);
      const flavor = resolveFlavor(request);
      return applyMoonshotFlavor(result, flavor);
    });

    // Handle tool calls - proxy to Tools API
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      try {
        if (name === "index") {
          return await this.handleIndexTool((args ?? {}) as Record<string, unknown>);
        }
        return await proxyCallTool(
          this.apiClient,
          name,
          (args ?? {}) as Record<string, unknown>,
        );
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({
                success: false,
                error: error instanceof Error ? error.message : String(error),
              }),
            },
          ],
        };
      }
    });
  }

  private async handleIndexTool(
    args: Record<string, unknown>,
  ): Promise<{ content: Array<{ type: "text"; text: string }> }> {
    const projectPath = args.projectPath as string | undefined;

    if (!projectPath) {
      return textContent(JSON.stringify({ success: false, error: "projectPath is required" }));
    }

    try {
      if (!(await fs.stat(projectPath)).isDirectory()) {
        return textContent(JSON.stringify({ success: false, error: `${projectPath} is not a directory` }));
      }
    } catch {
      return textContent(JSON.stringify({ success: false, error: `Path not found: ${projectPath}` }));
    }

    const files = await collectFiles(projectPath);

    if (files.length === 0) {
      return textContent(JSON.stringify({
        success: false,
        error: `No indexable files found in ${projectPath}`,
      }));
    }

    const response = await this.apiClient.uploadAndIndex({
      projectPath,
      projectId: args.projectId as string | undefined,
      forceReindex: args.forceReindex as boolean | undefined,
      warmCache: args.warmCache as boolean | undefined,
      warmupQueries: args.warmupQueries as string[] | undefined,
      files,
    });

    return textContent(JSON.stringify(response, null, 2));
  }

  async start(): Promise<void> {
    // Check API health before starting
    const healthy = await this.apiClient.healthCheck();
    if (!healthy) {
      console.log(
        `[massa-th0th-mcp] Warning: Tools API is not reachable (mode: ${this.mode}). Requests will fail until API is available.`,
      );
    } else {
      console.log(`[massa-th0th-mcp] Connected (mode: ${this.mode})`);
    }

    await this.server.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.server.close();
  }
}

// Main
const client = new McpProxyServer();

client.start().catch((error) => {
  console.error("Failed to start MCP client:", error);
  process.exit(1);
});

process.on("SIGINT", async () => {
  await client.close();
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await client.close();
  process.exit(0);
});
