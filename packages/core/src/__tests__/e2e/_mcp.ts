/**
 * MCP transport driver for E2E tests.
 *
 * Spawns the REAL massa-th0th MCP server (built dist) as a subprocess and
 * drives it via the @modelcontextprotocol/sdk Client over StdioClientTransport.
 * Zero source changes — true black-box, matches how OpenCode/Claude connect.
 *
 * Precondition enforced by the caller (see _helpers.probeAvailability):
 *   - ~/.config/massa-th0th/config.json must exist (else the MCP entrypoint
 *     prints an init banner to stdout and corrupts the JSON-RPC stream).
 *   - Tools API /health must be up (else the MCP entrypoint prints a warning
 *     to stdout on boot — same corruption risk).
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import path from "path";
import { API, API_KEY } from "./_helpers.js";

const MCP_DIST = path.resolve(import.meta.dir, "../../../../../apps/mcp-client/dist/index.js");

export interface McpHandle {
  client: Client;
  toolNames: string[];
  stop: () => Promise<void>;
}

export async function startMcp(extraEnv: Record<string, string> = {}): Promise<McpHandle> {
  const env: Record<string, string> = {
    ...process.env as Record<string, string>,
    MASSA_TH0TH_API_URL: API,
    ...extraEnv,
  };
  if (API_KEY) env.MASSA_TH0TH_API_KEY = API_KEY;
  // Deterministic MCP proxy timeout budget (finding #12). Default 120s; overridable
  // via env. NOTE: do NOT set "0" — api-client.ts does `Number(env)||120000`, and
  // Number("0")===0 (falsy) silently collapses to 120s.
  env.MASSA_TH0TH_PROXY_TIMEOUT_MS = process.env.MASSA_TH0TH_PROXY_TIMEOUT_MS ?? "120000";

  const transport = new StdioClientTransport({
    command: "bun",
    args: [MCP_DIST],
    env,
  });

  const client = new Client({ name: "e2e-mcp-driver", version: "1.0.0" }, { capabilities: {} });
  await client.connect(transport);

  const list = await client.listTools();
  const toolNames = list.tools.map((t) => t.name);

  return {
    client,
    toolNames,
    stop: async () => {
      try {
        await transport.close();
      } catch {
        /* ignore */
      }
      try {
        await client.close();
      } catch {
        /* ignore */
      }
    },
  };
}

/**
 * Per-request timeout passed to the MCP SDK `Client.callTool`.
 *
 * The SDK's DEFAULT_REQUEST_TIMEOUT_MSEC is 60s (see
 * @modelcontextprotocol/sdk shared/protocol.js). Several massa-th0th tools
 * legitimately exceed that — notably `bootstrap`, whose underlying
 * /api/v1/bootstrap handler runs an LLM-seed step that can hit its own 90s
 * internal timeout before degrading to rule-based (the MCP bootstrap matrix
 * regressed as -32001: Request timed out at exactly 60s for this reason;
 * finding #12). The client timeout MUST be at least as long as the proxy's
 * budget (MASSA_TH0TH_PROXY_TIMEOUT_MS) or the client kills the call before
 * the proxy can return. We add a 30s margin so proxy-side errors surface
 * rather than masquerading as client timeouts.
 */
const MCP_CLIENT_TIMEOUT_MS =
  Number(process.env.MASSA_TH0TH_PROXY_TIMEOUT_MS ?? "120000") + 30_000;

/**
 * Call an MCP tool and parse the response. Returns parsed JSON when the proxy
 * returned JSON, or the raw string otherwise (e.g. bare TOON string after the
 * proxy's data-string unwrap branch at apps/mcp-client/src/index.ts:178-187).
 */
export async function mcpCall(client: Client, name: string, args: Record<string, unknown> = {}): Promise<any> {
  // Pass an explicit per-request timeout (3rd arg = RequestOptions). Without
  // this the SDK applies its 60s default and any tool whose HTTP path exceeds
  // 60s (e.g. bootstrap) fails with -32001 regardless of the proxy budget.
  const res = await client.callTool(
    { name, arguments: args },
    undefined,
    { timeout: MCP_CLIENT_TIMEOUT_MS },
  );
  const text = (res as any)?.content?.[0]?.text ?? "";
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

/** Expect a tool name to be advertised; throws a clear error if absent. */
export function requireTool(toolNames: string[], name: string): void {
  if (!toolNames.includes(name)) {
    throw new Error(`MCP server does not advertise tool "${name}". Got ${toolNames.length} tools.`);
  }
}
