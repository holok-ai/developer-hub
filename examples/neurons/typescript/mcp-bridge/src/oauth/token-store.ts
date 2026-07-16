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
 */
export interface McpTokenFile {
  client?: OAuthClientInformationMixed;
  tokens?: OAuthTokens;
  codeVerifier?: string;
  state?: string;
  discovery?: OAuthDiscoveryState;
}

export class McpTokenStore {
  private cache: McpTokenFile | null = null;
  private readonly path: string;

  constructor(dir: string, serverId: string) {
    this.path = join(dir, `mcp-${serverId}-token.json`);
  }

  /** Best-effort read; empty record if the file is missing or corrupt. A broken
   *  token file should never crash the neuron — clearing + re-auth recovers. */
  async load(): Promise<McpTokenFile> {
    if (this.cache) return this.cache;
    try {
      const raw = await fs.readFile(this.path, 'utf8');
      this.cache = JSON.parse(raw) as McpTokenFile;
      return this.cache;
    } catch {
      this.cache = {};
      return this.cache;
    }
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
