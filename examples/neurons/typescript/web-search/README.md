# TypeScript neuron example — `examples/web.search`

A neuron offering `examples/web.search`: keyless web search via DuckDuckGo HTML.
The TypeScript sibling of [`../../python/web_search`](../../python/web_search) —
both speak the same wire protocol and return the same `{ query, results[] }`
shape.

It POSTs the query to `https://html.duckduckgo.com/html/` and extracts
`{ title, url, snippet }` from the returned markup. **Free, no API key, but
inherently fragile** — DuckDuckGo can change the HTML or rate-limit at any time.
For production, point `EXAMPLES_WEB_SEARCH_ENDPOINT` at a real provider (Brave /
Tavily / SearXNG) or replace the handler.

## What it shows

- A **second capability** with its own input/output schema (beyond `http.fetch`).
- **Failure classification** — a non-2xx response (DDG returns 202 when
  rate-limiting) is a *terminal* nack via `ctx.fail(reason, { code })`, so the
  workflow author backs off rather than the framework retrying into a tighter
  ban. Network blips throw and nack *retryable*.
- **Abort-aware fetch** — the in-flight request cancels on cancel/shutdown.

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
  --name my-ts-neuron --capabilities examples/web.search

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

Optional overrides:

```bash
EXAMPLES_WEB_SEARCH_ENDPOINT=https://your.searxng/search   # swap in a real provider
EXAMPLES_WEB_SEARCH_UA="custom user agent"
```

Auth is resolved by [`src/auth.ts`](./src/auth.ts) (`resolveAuth()`; enrolled
credential preferred, `BIGBRAIN_TOKEN` fallback), documented once in
**[../README.md → Authentication](../README.md#authentication)**. Use a **stable**
`BIGBRAIN_NEURON_ID` across restarts.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the concepts behind this code.
