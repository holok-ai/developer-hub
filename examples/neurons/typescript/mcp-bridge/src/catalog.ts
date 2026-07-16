import { readFile } from 'node:fs/promises';
import { z } from 'zod';

/**
 * The pluggable MCP catalog — add a server by adding an entry here, no code
 * change. Validated with zod so a typo in the JSON is a clear error, not a
 * confusing runtime failure.
 */

// Server id becomes a capability-type segment (`<prefix>/<id>/<tool>`), so keep
// it to the same character class the gateway accepts for a segment.
const serverId = z
  .string()
  .regex(/^[A-Za-z0-9_.-]+$/, 'server id must match [A-Za-z0-9_.-]');

const noneAuth = z.object({ type: z.literal('none') });

const bearerAuth = z.object({
  type: z.literal('bearer'),
  /** Name of the env var holding the token (never put the token in the file). */
  tokenEnv: z.string().min(1),
});

const oauthAuth = z.object({
  type: z.literal('oauth'),
  /** Client name submitted to dynamic registration. */
  clientName: z.string().default('Holokai MCP bridge'),
  /** Optional scopes; most servers advertise their own via discovery. */
  scopes: z.array(z.string()).optional(),
});

const httpAuth = z
  .discriminatedUnion('type', [noneAuth, bearerAuth, oauthAuth])
  .default({ type: 'none' });

const stdioServer = z.object({
  id: serverId,
  transport: z.literal('stdio'),
  command: z.string().min(1),
  args: z.array(z.string()).default([]),
  cwd: z.string().optional(),
  env: z.record(z.string()).optional(),
});

const httpServer = z.object({
  id: serverId,
  transport: z.literal('http'),
  url: z.string().url(),
  auth: httpAuth,
});

const serverSchema = z.discriminatedUnion('transport', [stdioServer, httpServer]);

export const catalogSchema = z.object({
  /**
   * Owner segment of the reflected capability types (`<prefix>/<id>/<tool>`).
   * Defaults to `mcp` — identical to the desktop tester. Note `mcp/*` is not in
   * the gateway's namespace-authz table (`core/* · desktop/* · org/{orgId}/* ·
   * user/{userId}/*`); set this to a prefix your token is authorized for
   * (e.g. `org/<orgId>/mcp`) or run the gateway with `NEURON_NAMESPACE_AUTH_BYPASS`
   * in dev. See docs/NEURON_DEVELOPERS_GUIDE.md.
   */
  capabilityPrefix: z
    .string()
    .regex(/^[A-Za-z0-9_.\-/]+$/)
    .default('mcp'),
  servers: z.array(serverSchema).min(1),
});

export type Catalog = z.infer<typeof catalogSchema>;
export type CatalogServer = z.infer<typeof serverSchema>;

/** Read + validate the catalog JSON. Throws a readable error on a bad file. */
export async function loadCatalog(path: string): Promise<Catalog> {
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new Error(`Cannot read MCP catalog at "${path}" (set MCP_CATALOG to override the path).`);
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch (err) {
    throw new Error(`MCP catalog at "${path}" is not valid JSON: ${(err as Error).message}`);
  }
  const parsed = catalogSchema.safeParse(json);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new Error(`MCP catalog at "${path}" is invalid:\n${details}`);
  }
  // Reject duplicate ids up front — two servers with the same id would collide
  // on capability types and token files.
  const ids = new Set<string>();
  for (const s of parsed.data.servers) {
    if (ids.has(s.id)) throw new Error(`duplicate server id "${s.id}" in catalog`);
    ids.add(s.id);
  }
  return parsed.data;
}
