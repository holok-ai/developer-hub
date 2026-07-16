import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * One-shot loopback HTTP listener for the OAuth redirect. Portable Node —
 * lifted almost verbatim from the desktop tester's `oauth-callback-listener.ts`
 * (that version has no Electron dependency to begin with).
 *
 * Spawns a server on `127.0.0.1` with an OS-picked port (`listen(0)`), reads
 * the port back so the redirectUri matches whatever the auth server calls, and
 * shuts down after the first `/callback` hit — replying with a small HTML page
 * so the user's browser doesn't sit on a blank tab.
 */
export interface OAuthCallbackResult {
  /** The authorization code from the redirect. */
  code: string;
  /**
   * Echoed-back state. The MCP SDK does not verify this — the caller must
   * compare it against the persisted value (see `OAuthProvider.verifyState`)
   * before exchanging the code (RFC 6749 §10.12, CSRF defence).
   */
  state: string | undefined;
}

export interface OAuthCallbackHandle {
  /** `http://127.0.0.1:<port>/callback`, given to the OAuth client as redirectUri. */
  redirectUri: string;
  /** Resolves on the first `/callback` hit; rejects on timeout / cancel / error response. */
  result: Promise<OAuthCallbackResult>;
  /** Tear down the listener. Safe to call multiple times. */
  close(): void;
}

export async function openOAuthCallbackListener(
  timeoutMs = 5 * 60 * 1000,
): Promise<OAuthCallbackHandle> {
  let server: Server | null = null;
  let timer: NodeJS.Timeout | null = null;
  let settled = false;

  let resolveResult!: (v: OAuthCallbackResult) => void;
  let rejectResult!: (err: Error) => void;
  const result = new Promise<OAuthCallbackResult>((resolve, reject) => {
    resolveResult = resolve;
    rejectResult = reject;
  });

  const settle = (
    outcome: { ok: true; result: OAuthCallbackResult } | { ok: false; error: Error },
  ): void => {
    if (settled) return;
    settled = true;
    if (timer) clearTimeout(timer);
    if (server) {
      server.close();
      server = null;
    }
    if (outcome.ok) resolveResult(outcome.result);
    else rejectResult(outcome.error);
  };

  server = createServer((req, res) => {
    // Base URL only satisfies the parser; only pathname/searchParams matter.
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname !== '/callback') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const error = url.searchParams.get('error');
    const code = url.searchParams.get('code');
    const state = url.searchParams.get('state') ?? undefined;
    if (error) {
      const desc = url.searchParams.get('error_description') ?? '';
      res.statusCode = 400;
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(
        `<html><body><h2>Authorization failed</h2><p>${escapeHtml(error)}: ${escapeHtml(desc)}</p></body></html>`,
      );
      settle({ ok: false, error: new Error(`OAuth error: ${error}${desc ? `: ${desc}` : ''}`) });
      return;
    }
    if (!code) {
      res.statusCode = 400;
      res.end('missing code');
      settle({ ok: false, error: new Error('OAuth callback missing `code` parameter') });
      return;
    }
    res.statusCode = 200;
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end('<html><body><h2>Connected</h2><p>You can close this window.</p></body></html>');
    settle({ ok: true, result: { code, state } });
  });

  await new Promise<void>((resolve, reject) => {
    server?.once('listening', resolve);
    server?.once('error', reject);
    server?.listen(0, '127.0.0.1');
  });

  const addr = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${addr.port}/callback`;

  timer = setTimeout(() => {
    settle({ ok: false, error: new Error(`OAuth callback timed out after ${timeoutMs}ms`) });
  }, timeoutMs);

  return {
    redirectUri,
    result,
    close: () => settle({ ok: false, error: new Error('OAuth listener closed before callback') }),
  };
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
