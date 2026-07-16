# TypeScript neuron example — `examples/http.fetch`

A minimal, complete neuron: it connects to a BigBrain gateway, advertises one
`any`-scoped capability, and handles tasks that fetch an HTTP(S) URL.

This is the TypeScript sibling of [`../../python/http_fetch`](../../python/http_fetch) —
both speak the same wire protocol; pick the language that fits where your
capability lives.

## Prerequisites

- Node.js 20+
- `@holokai/neuron-sdk` from public npm (no auth needed): `npm install` resolves
  it from `registry.npmjs.org`.

## Run

```bash
npm install
```

**Recommended — enroll once, then run with no token.** Registering the machine
(an org admin approves it in Moku) lets the neuron mint its own short-lived
tokens; there is no `BIGBRAIN_TOKEN` in the environment:

```bash
# one-time: register this machine as a neuron
npx @holokai/neuron-sdk enroll --moku-url https://moku.holokai.dev \
  --name my-ts-neuron --capabilities examples/http.fetch

# then start it — resolveAuth() finds the enrolled credential, no JWT needed
BIGBRAIN_GATEWAY_URL=https://bigbrain.holokai.dev \
BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
npm start
```

**Quick-dev alternative** — paste a gateway JWT instead of enrolling:

```bash
BIGBRAIN_GATEWAY_URL=https://bigbrain.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
npm start
```

Auth is resolved by [`src/auth.ts`](./src/auth.ts) (`resolveAuth()`; enrolled
credential preferred, `BIGBRAIN_TOKEN` fallback), documented once for all
examples in **[../README.md → Authentication](../README.md#authentication)**.
Use a **stable** `BIGBRAIN_NEURON_ID` across restarts.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the concepts and decisions behind this code.
