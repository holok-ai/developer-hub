import { randomBytes } from 'node:crypto';

import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from '@modelcontextprotocol/sdk/shared/auth.js';
import type {
  OAuthClientProvider,
  OAuthDiscoveryState,
} from '@modelcontextprotocol/sdk/client/auth.js';

import type { McpTokenStore } from './token-store.js';

/**
 * Implements the MCP SDK's `OAuthClientProvider` against {@link McpTokenStore}.
 * The SDK's `auth(provider, ...)` orchestrator does the heavy lifting — RFC 9728
 * discovery, RFC 7591 dynamic client registration, PKCE, and token refresh; this
 * class just supplies persistence, the "open the browser" hook, and CSRF state.
 *
 * Ported from the desktop tester's `linear-oauth-provider.ts`. The only change
 * for a standalone Node process: `shell.openExternal` (Electron) → an injected
 * `openBrowser` callback. Everything OAuth-mechanical is identical, so any
 * spec-compliant OAuth MCP server works, not just Linear.
 */
export interface OAuthProviderOptions {
  /** Human-readable client name submitted to dynamic registration. */
  clientName: string;
  /** Opens the authorize URL in the user's browser (or prints it). */
  openBrowser: (url: string) => void | Promise<void>;
  /** Optional scopes to request. Most servers advertise their own. */
  scopes?: string[];
  /**
   * When false, `redirectToAuthorization` throws instead of opening a browser.
   * Used by the *runtime* provider whose only job is silent token refresh — a
   * failed refresh should surface as an error, not pop a stale authorize URL
   * whose ephemeral-port listener is long gone. Defaults to true.
   */
  interactive?: boolean;
}

export class ReauthorizationRequiredError extends Error {
  constructor(serverId: string) {
    super(`MCP server "${serverId}" needs re-authorization; delete its token file and reconnect.`);
    this.name = 'ReauthorizationRequiredError';
  }
}

export class OAuthProvider implements OAuthClientProvider {
  private readonly interactive: boolean;

  constructor(
    private readonly serverId: string,
    private readonly store: McpTokenStore,
    private readonly _redirectUri: string,
    private readonly opts: OAuthProviderOptions,
  ) {
    this.interactive = opts.interactive ?? true;
  }

  get redirectUrl(): string {
    return this._redirectUri;
  }

  get clientMetadata(): OAuthClientMetadata {
    // Public client (no secret): a downloadable example runs on the user's
    // machine and can't keep one. Submitted to the server's RFC 7591 endpoint.
    return {
      client_name: this.opts.clientName,
      redirect_uris: [this._redirectUri],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      ...(this.opts.scopes ? { scope: this.opts.scopes.join(' ') } : {}),
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    return (await this.store.load()).client;
  }

  async saveClientInformation(client: OAuthClientInformationMixed): Promise<void> {
    await this.store.update({ client });
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    return (await this.store.load()).tokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    // Verifier + state are only valid during the in-flight exchange; clear both
    // once tokens land so a stale value can't poison a later run.
    await this.store.update({ tokens, codeVerifier: undefined, state: undefined });
  }

  async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
    if (!this.interactive) throw new ReauthorizationRequiredError(this.serverId);
    await this.opts.openBrowser(authorizationUrl.toString());
  }

  async saveCodeVerifier(codeVerifier: string): Promise<void> {
    await this.store.update({ codeVerifier });
  }

  async codeVerifier(): Promise<string> {
    const file = await this.store.load();
    if (!file.codeVerifier) {
      throw new Error('codeVerifier not set — saveCodeVerifier must run before code exchange');
    }
    return file.codeVerifier;
  }

  /** Populates the `state` parameter; we persist it so we can verify the echo. */
  async state(): Promise<string> {
    const value = randomBytes(16).toString('base64url');
    await this.store.update({ state: value });
    return value;
  }

  /** RFC 6749 §10.12 CSRF check — compare the callback's state to the persisted one. */
  async verifyState(received: string | undefined): Promise<boolean> {
    if (!received) return false;
    const expected = (await this.store.load()).state;
    if (!expected || expected.length !== received.length) return false;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected.charCodeAt(i) ^ received.charCodeAt(i);
    }
    return diff === 0;
  }

  async invalidateCredentials(
    scope: 'all' | 'client' | 'tokens' | 'verifier' | 'discovery',
  ): Promise<void> {
    if (scope === 'all') {
      await this.store.clear();
      return;
    }
    const patch: Partial<McpTokenFileSubset> = {};
    if (scope === 'client') patch.client = undefined;
    if (scope === 'tokens') patch.tokens = undefined;
    if (scope === 'verifier') patch.codeVerifier = undefined;
    if (scope === 'discovery') patch.discovery = undefined;
    await this.store.update(patch);
  }

  async saveDiscoveryState(state: OAuthDiscoveryState): Promise<void> {
    await this.store.update({ discovery: state });
  }

  async discoveryState(): Promise<OAuthDiscoveryState | undefined> {
    return (await this.store.load()).discovery;
  }
}

interface McpTokenFileSubset {
  client: OAuthClientInformationMixed | undefined;
  tokens: OAuthTokens | undefined;
  codeVerifier: string | undefined;
  discovery: OAuthDiscoveryState | undefined;
}
