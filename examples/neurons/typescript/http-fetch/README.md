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
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
npm start
```

`BIGBRAIN_TOKEN` here is the **quick-dev** path. For a deployed neuron, skip the
static token entirely — enroll the machine once and the neuron mints its own
short-lived tokens (no JWT in the environment). Auth is handled by
[`src/auth.ts`](./src/auth.ts) (`resolveAuth()`) and documented once for all
examples in **[../README.md → Authentication](../README.md#authentication)**.
Use a **stable** `BIGBRAIN_NEURON_ID` across restarts.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the concepts and decisions behind this code.
