# TypeScript neuron example — `examples/batch.process`

A neuron that demonstrates the two lifecycle features the minimal
[`http-fetch`](../http-fetch) example doesn't: **progress reporting** and
**cooperative cancellation**.

It offers one `any`-scoped capability, `examples/batch.process`, that walks a
list of items, does a little work on each (SHA-256), and reports progress as it
goes — while polling the lease's abort signal so a cancel or shutdown stops it
promptly.

## Why it matters

The gateway *leases* a task and expects heartbeats while you hold it. A
long-running handler that ignores `ctx.signal` keeps its lease — and the
underlying broker message — held even after the workflow was cancelled, wasting
the slot until the lease TTL expires. Honouring the signal is how you release
promptly. The key pieces:

- **`ctx.progress({ percent, message, data })`** — advisory progress frames.
  Safe to drop; call as often as makes sense.
- **`ctx.signal`** (an `AbortSignal`) — fires on cancel *or* shutdown. Check
  `ctx.signal.aborted` between units of work, and make any waiting cancellable.
  This example's `abortableDelay()` is the reusable pattern: a `setTimeout` that
  rejects the instant the signal aborts, with no leaked timer or listener.

When the signal fires mid-run, the handler throws the abort reason, which the
SDK reports to the gateway as a **cancelled** nack (not a failure).

## Prerequisites

- Node.js 20+
- `@holokai/neuron-sdk` from public npm (no auth needed):
  `npm install` resolves it from `registry.npmjs.org`.

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
  --name my-ts-neuron --capabilities examples/batch.process

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

Then send it a `examples/batch.process` task with, e.g.,
`{ "items": ["a", "b", "c"], "perItemMs": 500 }` and cancel it mid-run to watch
it stop within `perItemMs` rather than after the whole batch.

Auth is resolved by [`src/auth.ts`](./src/auth.ts) (`resolveAuth()`; enrolled
credential preferred, `BIGBRAIN_TOKEN` fallback), documented once in
**[../README.md → Authentication](../README.md#authentication)**. Use a **stable**
`BIGBRAIN_NEURON_ID` across restarts.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the lease/heartbeat/cancel model behind this code.
