/**
 * Resolve how this neuron authenticates to the gateway. No static JWT is
 * required once the machine is enrolled.
 *
 * Preference order:
 *   1. **Enrolled credential (the deployed path — no env token).** If the
 *      credential file written by `npx @holokai/neuron-sdk enroll ...` exists,
 *      mint short-lived `aud=bigbrain` access tokens from it via the OAuth2
 *      `client_credentials` grant (RFC 8628 device-flow enrollment + client
 *      credentials, HOL-2538). Override the path with `BIGBRAIN_CREDENTIAL_FILE`.
 *   2. **`BIGBRAIN_TOKEN` / `BIGBRAIN_TOKEN_FILE`** — a pasted JWT, for quick
 *      local development.
 *
 * This helper is intentionally duplicated into each example so a single example
 * folder stays self-contained (copy one folder and go). The pattern is
 * documented once in ../../README.md.
 */
import { existsSync, readFileSync } from 'node:fs';

import type { AuthCallback } from '@holokai/neuron-sdk';
import { createClientCredentialsAuth, defaultCredentialPath } from '@holokai/neuron-sdk/auth';

export function resolveAuth(): AuthCallback {
  // 1. Enrolled credential — the tokenless, deployed path.
  const explicitCredentialPath = process.env.BIGBRAIN_CREDENTIAL_FILE;
  const credentialPath = explicitCredentialPath ?? defaultCredentialPath();
  const hasCredential = existsSync(credentialPath);

  // If BIGBRAIN_CREDENTIAL_FILE was set explicitly, a missing file is almost
  // certainly a mistake (typo / wrong mount) — fail loudly instead of silently
  // falling back to a token or the generic "no auth" message.
  if (explicitCredentialPath && !hasCredential) {
    throw new Error(
      `BIGBRAIN_CREDENTIAL_FILE points at "${explicitCredentialPath}", which does not exist. ` +
        'Fix the path, or run `npx @holokai/neuron-sdk enroll ...` to create it.',
    );
  }

  if (hasCredential) {
    // The enrolled credential wins (a deployed neuron's identity shouldn't be
    // hijacked by a stray ambient token). But warn rather than silently ignore
    // a static token, so a dev isn't surprised BIGBRAIN_TOKEN had no effect.
    if (process.env.BIGBRAIN_TOKEN || process.env.BIGBRAIN_TOKEN_FILE) {
      console.warn(
        '[auth] BIGBRAIN_TOKEN/BIGBRAIN_TOKEN_FILE is set but ignored — using the ' +
          `enrolled credential at ${credentialPath}. Remove the credential file (or ` +
          'unset the token) to use the static token instead.',
      );
    }
    return createClientCredentialsAuth(credentialPath);
  }

  // 2. Static token — quick local dev.
  const token = process.env.BIGBRAIN_TOKEN;
  if (token) return () => token;
  const tokenFile = process.env.BIGBRAIN_TOKEN_FILE;
  if (tokenFile) return () => readFileSync(tokenFile, 'utf8').trim();

  throw new Error(
    'No auth configured. Enroll this machine once (recommended):\n' +
      '  npx @holokai/neuron-sdk enroll --moku-url <url> --name <neuron-name>\n' +
      'or set BIGBRAIN_TOKEN / BIGBRAIN_TOKEN_FILE for local development.',
  );
}
