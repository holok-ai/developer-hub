import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import type { OAuthClientProvider } from '@modelcontextprotocol/sdk/client/auth.js';

/** A JSON Schema object — passed through from the MCP tool to the capability. */
export type JsonSchema = Record<string, unknown>;

/**
 * A server config with its auth already resolved to concrete transport inputs:
 * an OAuth provider, static headers, or nothing. Built by `resolveServer` in
 * index.ts from a catalog entry. Ported/adapted from the desktop tester's
 * `mcp-client.ts` (`StdioMcpServerConfig` / `HttpMcpServerConfig`).
 */
export type ResolvedMcpServer =
  | {
      kind: 'stdio';
      id: string;
      command: string;
      args: string[];
      cwd?: string;
      env?: Record<string, string>;
    }
  | {
      kind: 'http';
      id: string;
      url: string;
      /** OAuth provider — drives the dance + refresh. Mutually exclusive with headers. */
      authProvider?: OAuthClientProvider;
      /** Static headers, e.g. `{ Authorization: 'Bearer …' }`. */
      headers?: Record<string, string>;
    };

export interface McpTool {
  name: string;
  description?: string;
  inputSchema: JsonSchema;
  /** Optional MCP 2025-06-18 per-tool output schema; passed through verbatim. */
  outputSchema?: JsonSchema;
}

export interface McpCallResult {
  content: unknown;
  isError?: boolean;
  /** MCP 2025-06-18 `structuredContent` — preferred by `normalizeMcpContent`. */
  structuredContent?: unknown;
}

/** Narrow client surface — what the bridge needs from MCP. */
export interface McpClient {
  connect(): Promise<void>;
  close(): Promise<void>;
  listTools(): Promise<{ tools: McpTool[] }>;
  callTool(args: { name: string; arguments: unknown }): Promise<McpCallResult>;
}

export function createMcpClient(config: ResolvedMcpServer): McpClient {
  const client = new Client({ name: 'neuron-mcp-bridge', version: '1.0.0' });

  if (config.kind === 'stdio') {
    const transport = new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: config.env,
    });
    return wrapClient(client, transport);
  }

  const transport = new StreamableHTTPClientTransport(new URL(config.url), {
    ...(config.authProvider ? { authProvider: config.authProvider } : {}),
    ...(config.headers ? { requestInit: { headers: config.headers } } : {}),
  });
  return wrapClient(client, transport);
}

function wrapClient(
  client: Client,
  transport: Parameters<Client['connect']>[0],
): McpClient {
  return {
    async connect() {
      await client.connect(transport);
    },
    async close() {
      await client.close();
    },
    async listTools() {
      const result = await client.listTools();
      return {
        tools: result.tools.map((t) => ({
          name: t.name,
          description: t.description,
          inputSchema: (t.inputSchema ?? { type: 'object' }) as JsonSchema,
          // The MCP `outputSchema` field is optional — newer servers declare it
          // per tool. Pass it through so the capability advertises the real
          // shape rather than a generic default (HOL-985).
          ...(t.outputSchema ? { outputSchema: t.outputSchema as JsonSchema } : {}),
        })),
      };
    },
    async callTool(args) {
      const result = await client.callTool({
        name: args.name,
        arguments: args.arguments as Record<string, unknown> | undefined,
      });
      return {
        content: result.content,
        isError: result.isError as boolean | undefined,
        structuredContent: (result as { structuredContent?: unknown }).structuredContent,
      };
    },
  };
}
