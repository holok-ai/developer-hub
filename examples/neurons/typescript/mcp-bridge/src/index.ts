/**
 * MCP bridge neuron — connect to the MCP servers listed in a JSON catalog and
 * reflect every tool they advertise into a neuron capability. Download this
 * example, edit `mcp.catalog.json`, and any MCP server (stdio or Streamable
 * HTTP, with `none` / `bearer` / `oauth` auth) becomes callable through the
 * gateway.
 *
 * Capability shape mirrors the desktop tester's `McpProvider`
 * (desktop/neuron-tester-desktop/src/main/providers/mcp.ts): one capability per
 * tool, `type = <prefix>/<serverId>/<toolName>`, the tool's own JSON Schema as
 * the capability input schema. See docs/NEURON_DEVELOPERS_GUIDE.md for the
 * naming convention (`{owner}/{package}[/{name}][.{variant}]`).
 *
 * Run:
 *   cp mcp.catalog.example.json mcp.catalog.json   # then edit it
 *   npm install
 *   BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
 *   BIGBRAIN_TOKEN=eyJhbGciOi... \
 *   BIGBRAIN_NEURON_ID=my-mcp-bridge-1 \
 *   npm start
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

import { Neuron } from '@holokai/neuron-sdk';
import type { CapabilityRegistration, Handler } from '@holokai/neuron-sdk';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

import { loadCatalog, type CatalogServer } from './catalog.js';
import {
  createMcpClient,
  type JsonSchema,
  type McpClient,
  type ResolvedMcpServer,
} from './mcp-client.js';
import { normalizeMcpContent } from './mcp-normalize.js';
import { openOAuthCallbackListener } from './oauth/callback-listener.js';
import { OAuthProvider } from './oauth/oauth-provider.js';
import { McpTokenStore } from './oauth/token-store.js';

// A tool name has to survive as a capability-type segment. The desktop tester
// uses the same guard; a name with other characters is skipped (with a warning)
// rather than producing an invalid type.
const TOOL_NAME_PATTERN = /^[A-Za-z0-9_.\-]+$/;

/**
 * Every reflected capability advertises — and returns — this uniform envelope.
 *
 * The desktop tester advertises each tool's own `outputSchema` when present, but
 * its provider never validates handler output. The neuron SDK *does* validate
 * output against the advertised schema, so advertising `tool.outputSchema` while
 * returning `{ content, isError }` would schema-mismatch. Advertising the
 * envelope for every tool keeps the handler correct-by-construction; `content`
 * is the normalized payload (structuredContent when the server provides it).
 * A production bridge that wants the typed per-tool shape must return the bare
 * structured content instead of this envelope.
 */
const ENVELOPE_OUTPUT_SCHEMA: JsonSchema = {
  type: 'object',
  properties: { content: {}, isError: { type: 'boolean' } },
  required: ['content', 'isError'],
  additionalProperties: false,
};

function authCallback(): string {
  const token = process.env.BIGBRAIN_TOKEN;
  if (token) return token;
  const file = process.env.BIGBRAIN_TOKEN_FILE;
  if (file) return readFileSync(file, 'utf8').trim();
  throw new Error('Set BIGBRAIN_TOKEN or BIGBRAIN_TOKEN_FILE so the SDK can authenticate.');
}

/** Print the authorize URL and best-effort launch the default browser. */
function openBrowser(url: string): void {
  console.log(`\n${'─'.repeat(72)}`);
  console.log('Authorize this neuron in your browser:');
  console.log(`  ${url}`);
  console.log(`${'─'.repeat(72)}\n`);
  const [cmd, args] =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  try {
    const child = spawn(cmd as string, args as string[], { stdio: 'ignore', detached: true });
    child.on('error', () => {
      /* opener missing (headless/CI) — the URL is printed above */
    });
    child.unref();
  } catch {
    /* printed above; user can copy-paste */
  }
}

/**
 * Run the interactive OAuth dance once (if we don't already have tokens), then
 * hand back a *runtime* provider for the transport to refresh with. Mirrors the
 * desktop tester's `LinearMcpService.connect()` orchestration.
 */
async function ensureAuthorized(
  server: Extract<CatalogServer, { transport: 'http' }> & { auth: { type: 'oauth' } },
  store: McpTokenStore,
): Promise<OAuthProvider> {
  const { clientName, scopes } = server.auth;

  const existing = await store.load();
  if (!existing.tokens) {
    const listener = await openOAuthCallbackListener();
    try {
      const provider = new OAuthProvider(server.id, store, listener.redirectUri, {
        clientName,
        openBrowser,
        scopes,
      });
      const first = (await auth(provider, { serverUrl: server.url })) as string;
      if (first !== 'AUTHORIZED') {
        // 'REDIRECT' — the browser was opened; wait for the loopback callback.
        const cb = await listener.result;
        if (!(await provider.verifyState(cb.state))) {
          throw new Error('OAuth state mismatch — possible CSRF; aborting.');
        }
        const second = (await auth(provider, {
          serverUrl: server.url,
          authorizationCode: cb.code,
        })) as string;
        if (second !== 'AUTHORIZED') {
          throw new Error(`OAuth did not complete for "${server.id}" (status: ${second}).`);
        }
      }
    } finally {
      listener.close();
    }
  }

  // Runtime provider: no interactive redirect on refresh failures — surface an
  // error instead (the ephemeral-port listener above is long gone).
  return new OAuthProvider(server.id, store, 'http://127.0.0.1/refresh-only', {
    clientName,
    openBrowser,
    scopes,
    interactive: false,
  });
}

/** Turn a catalog entry into concrete transport inputs (resolving auth). */
async function resolveServer(
  server: CatalogServer,
  tokenDir: string,
): Promise<ResolvedMcpServer> {
  if (server.transport === 'stdio') {
    return { kind: 'stdio', id: server.id, command: server.command, args: server.args, cwd: server.cwd, env: server.env };
  }
  switch (server.auth.type) {
    case 'none':
      return { kind: 'http', id: server.id, url: server.url };
    case 'bearer': {
      const token = process.env[server.auth.tokenEnv];
      if (!token) {
        throw new Error(
          `server "${server.id}": env var ${server.auth.tokenEnv} is not set (holds the bearer token).`,
        );
      }
      return { kind: 'http', id: server.id, url: server.url, headers: { Authorization: `Bearer ${token}` } };
    }
    case 'oauth': {
      const store = new McpTokenStore(tokenDir, server.id);
      const provider = await ensureAuthorized(server as never, store);
      return { kind: 'http', id: server.id, url: server.url, authProvider: provider };
    }
  }
}

/** Connect one server and register a capability for each of its tools. */
async function connectAndReflect(
  neuron: Neuron,
  server: CatalogServer,
  prefix: string,
  tokenDir: string,
): Promise<McpClient> {
  const resolved = await resolveServer(server, tokenDir);
  const client = createMcpClient(resolved);
  await client.connect();

  const { tools } = await client.listTools();
  let registered = 0;
  for (const tool of tools) {
    if (!TOOL_NAME_PATTERN.test(tool.name)) {
      console.warn(`  skipping "${server.id}/${tool.name}" — name has characters outside [A-Za-z0-9_.-]`);
      continue;
    }
    const type = `${prefix}/${server.id}/${tool.name}`;
    const reg: CapabilityRegistration = {
      type,
      // 'any' keeps the example simple. NOTE: an OAuth server authenticated as a
      // specific user touches that user's resources — a real deployment should
      // advertise `{ onBehalfOf: <userId> }` so the gateway never routes another
      // user's task here. See the "Scope" section in NEURON_DEVELOPERS_GUIDE.md.
      scope: 'any',
      concurrency: 4,
      inputSchema: tool.inputSchema,
      outputSchema: ENVELOPE_OUTPUT_SCHEMA,
    };
    const handler: Handler = async (input, ctx) => {
      const result = await client.callTool({ name: tool.name, arguments: input });
      if (result.isError) {
        ctx.log.warn({ tool: tool.name, server: server.id }, 'MCP tool returned isError');
      }
      return { content: normalizeMcpContent(result), isError: result.isError ?? false };
    };
    neuron.handle(reg, handler);
    console.log(`  ↳ ${type}`);
    registered++;
  }
  console.log(`connected "${server.id}" — ${registered} tool(s) reflected`);
  return client;
}

async function main(): Promise<void> {
  const gatewayUrl = process.env.BIGBRAIN_GATEWAY_URL;
  const neuronId = process.env.BIGBRAIN_NEURON_ID;
  if (!gatewayUrl || !neuronId) {
    throw new Error('BIGBRAIN_GATEWAY_URL and BIGBRAIN_NEURON_ID are required.');
  }

  const catalogPath = process.env.MCP_CATALOG ?? join(process.cwd(), 'mcp.catalog.json');
  const tokenDir = process.env.MCP_TOKEN_DIR ?? join(homedir(), '.holokai', 'mcp-bridge');
  await mkdir(tokenDir, { recursive: true, mode: 0o700 });

  const catalog = await loadCatalog(catalogPath);
  const neuron = new Neuron({ gatewayUrl, neuronId, auth: authCallback });

  // Best-effort per server: one bad server (bad command, declined OAuth) should
  // not stop the others. A neuron with zero capabilities is a hard error though.
  const clients: McpClient[] = [];
  for (const server of catalog.servers) {
    try {
      clients.push(await connectAndReflect(neuron, server, catalog.capabilityPrefix, tokenDir));
    } catch (err) {
      console.error(`failed to connect "${server.id}": ${(err as Error).message}`);
    }
  }
  if (clients.length === 0) {
    throw new Error('no MCP servers connected — nothing to advertise. Check the catalog and logs above.');
  }

  neuron.once('connection:registered', ({ sessionId, capabilities }) =>
    console.log(`registered ${capabilities} capability(ies) as session ${sessionId}`),
  );
  neuron.on('connection:reconnecting', ({ attempt, delayMs, reason }) =>
    console.warn(`reconnecting #${attempt} in ${delayMs}ms (${reason})`),
  );

  await neuron.start();
  console.log(`neuron started; bridging ${clients.length} MCP server(s)`);

  let stopping = false;
  const stop = () => {
    if (stopping) return;
    stopping = true;
    void (async () => {
      await neuron.stop({ drain: true, timeoutMs: 30_000 });
      await Promise.allSettled(clients.map((c) => c.close()));
      process.exit(0);
    })();
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
