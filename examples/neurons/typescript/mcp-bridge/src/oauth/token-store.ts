import { promises as fs } from 'node:fs';
import { dirname, join } from 'node:path';

import type {
  OAuthClientInformationMixed,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type { OAuthDiscoveryState } from '@modelcontextprotocol/sdk/client/auth.js';

/**
 * On-disk OAuth state for one MCP server. Ported from the desktop tester's
 * `linear-token-store.ts`, generalised to any server id.
 *
 * The refresh token (inside `tokens`) is the part that survives across runs;
 * access tokens are short-lived. `client` is the dynamic-registration result,
 * persisted so we don't re-register every launch. `codeVerifier`/`state` are
 * transient — written during the in-flight auth dance, cleared once tokens land.
 *
 * Threat model: plain JSON at mode 0600, so any process running as you can read
 * it. That's the same explicit trade-off the desktop tester makes — this is a
 * developer example, and simplicity (no native keychain dep) wins. Delete the
 * file to force re-authorization.
 *
 * `tokens.issuer` and `client.issuer` name the authorization server that issued
 * them. The SDK (1.31.0 and later) adds them to what it passes to `saveTokens`
 * and `saveClientInformation`, and they are stored unchanged. A file saved by an
 * earlier version has neither: `load()` gives them the authorization server
 * recorded in `discovery` by the same sign-in, or, when there is none, drops
 * them so you sign in again.
 */
export interface McpTokenFile {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  discovery?: OAuthDiscoveryState;
}

/**
 * True when `a` and `b` name the same authorization server. Compares the parsed
 * URLs and tolerates one trailing `/`, the same rule the SDK uses.
 */
export function issuersMatch(a: string, b: string): boolean {
  let x = a;
  let y = b;
  try {
    x = new URL(a).href;
    y = new URL(b).href;
  } catch {
    // Not two URLs: compared as written.
  }
  return x === y || (x.endsWith('/') && x.slice(0, -1) === y) || (y.endsWith('/') && y.slice(0, -1) === x);
}

/**
 * Brings a file saved before tokens carried an `issuer` up to date. Tokens and
 * client information without a string `issuer` get the authorization server URL
 * that the same sign-in recorded in `discovery`; when the file has no such URL
 * they are dropped, so the next connect signs in again. Returns the file
 * unchanged (same object) when nothing needed it.
 */
export function withStoredIssuer(file: McpTokenFile): McpTokenFile {
  const recorded = file.discovery?.authorizationServerUrl;
  const issuer = typeof recorded === 'string' && recorded.length > 0 ? recorded : undefined;
  let next = file;
  if (file.tokens && typeof file.tokens.issuer !== 'string') {
    next = { ...next, tokens: issuer ? { ...file.tokens, issuer } : undefined };
  }
  if (file.client && typeof file.client.issuer !== 'string') {
    next = { ...next, client: issuer ? { ...file.client, issuer } : undefined };
  }
  return next;
}

export class McpTokenStore {
  private cache: McpTokenFile | null = null;
  private readonly path: string;

  constructor(dir: string, serverId: string) {
    this.path = join(dir, `mcp-${serverId}-token.json`);
  }

  /** Best-effort read; empty record if the file is missing or corrupt. A broken
   *  token file should never crash the neuron; clearing + re-auth recovers. A
   *  file saved without `issuer` is updated by `withStoredIssuer` and written back. */
  async load(): Promise<McpTokenFile> {
    if (this.cache) return this.cache;
    let parsed: McpTokenFile;
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      parsed = JSON.parse(raw) as McpTokenFile;
      if (!parsed || typeof parsed !== 'object') throw new Error('not a token record');
    } catch {
      this.cache = {};
      return this.cache;
    }
    const current = withStoredIssuer(parsed);
    this.cache = current;
    if (current !== parsed) {
      try {
        await this.save(current);
      } catch {
        // The updated record stays in memory; the next save writes it.
      }
    }
    return current;
  }

  async save(file: McpTokenFile): Promise<void> {
    this.cache = file;
    const json = JSON.stringify(file, null, 2);
    // Ensure the containing dir exists so the store is self-sufficient — a
    // caller shouldn't have to mkdir first. Owner-only (0700).
    await fs.mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    // mode 0600 (owner-only) + tmp-then-rename so a crash mid-write can't leave
    // a half-written file that load() then silently discards.
    const tmp = `${this.path}.tmp`;
    await fs.writeFile(tmp, json, { mode: 0o600 });
    await fs.rename(tmp, this.path);
  }

  async update(patch: Partial<McpTokenFile>): Promise<void> {
    const current = await this.load();
    await this.save({ ...current, ...patch });
  }

  async clear(): Promise<void> {
    this.cache = {};
    try {
      await fs.unlink(this.path);
    } catch {
      // already gone
    }
  }
}
