# TypeScript neuron example — `examples/http.fetch`

A minimal, complete neuron: it connects to a BigBrain gateway, advertises one
`any`-scoped capability, and handles tasks that fetch an HTTP(S) URL.

This is the TypeScript sibling of [`../python/http_fetch`](../python/http_fetch) —
both speak the same wire protocol; pick the language that fits where your
capability lives.

## Prerequisites

- Node.js 20+
- Access to the `@holokai/neuron-sdk` package. It is published to Holokai's
  private npm registry — configure your `.npmrc` with the registry + token, or
  ask your Holokai contact for access. (Without it `npm install` cannot resolve
  the dependency.)

## Run

```bash
npm install
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
npm start
```

`BIGBRAIN_TOKEN` is your gateway JWT. If you omit it, set `BIGBRAIN_TOKEN_FILE`
to a path the SDK re-reads on every refresh (rotate the token without
restarting). Use a **stable** `BIGBRAIN_NEURON_ID` across restarts.

For a deployed (non-dev) neuron, skip the static token entirely — enroll the
machine once and mint short-lived tokens from the stored credential:

```bash
npx @holokai/neuron-sdk enroll --moku-url https://moku.example --name my-ts-neuron
```

```ts
import { createClientCredentialsAuth, defaultCredentialPath } from '@holokai/neuron-sdk/auth';
// pass this as the Neuron's `auth` option instead of the env token:
const auth = createClientCredentialsAuth(defaultCredentialPath());
```

See `docs/NEURON_AUTH_SPEC.md` in the bigbrain repo for the full model
(enrollment, approval, revocation).

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the concepts and decisions behind this code.
- [`docs/NEURON_SDK_TYPESCRIPT.md`](../../../docs/NEURON_SDK_TYPESCRIPT.md) — the full SDK API reference.
