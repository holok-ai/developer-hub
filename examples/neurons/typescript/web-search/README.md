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
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
npm start
```

Optional overrides:

```bash
EXAMPLES_WEB_SEARCH_ENDPOINT=https://your.searxng/search   # swap in a real provider
EXAMPLES_WEB_SEARCH_UA="custom user agent"
```

`BIGBRAIN_TOKEN` is your gateway JWT. If you omit it, set `BIGBRAIN_TOKEN_FILE`
to a path the SDK re-reads on every refresh. Use a **stable**
`BIGBRAIN_NEURON_ID` across restarts.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — the concepts behind this code.
