# TypeScript neuron example — MCP bridge

A neuron that reads a **pluggable JSON catalog** of [Model Context
Protocol](https://modelcontextprotocol.io) servers, connects to each, and
**reflects every tool they advertise into a neuron capability**. Add a server by
editing `mcp.catalog.json` — no code change — and its tools become callable
through the BigBrain gateway.

The capability shape mirrors the Holokai desktop tester's MCP provider: one
capability per tool, named `<prefix>/<serverId>/<toolName>`.

## Quick start

```bash
npm install
cp mcp.catalog.example.json mcp.catalog.json     # then edit it
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-mcp-bridge-1 \
npm start
```

The default catalog includes the stdio **filesystem** server, which needs no
auth and is the easiest way to see it work — start it and you'll see
`mcp/filesystem/read_file`, `mcp/filesystem/list_directory`, … registered.

## The catalog

`mcp.catalog.json` (path overridable with `MCP_CATALOG`):

```jsonc
{
  // Owner segment of the reflected capability types. Default "mcp". See
  // "Capability naming" below — you may need to change this.
  "capabilityPrefix": "mcp",
  "servers": [
    // stdio: a child process spoken to over stdin/stdout (classic MCP servers)
    { "id": "filesystem", "transport": "stdio",
      "command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "/tmp"] },

    // http + bearer: a static token read from an env var (never put it in the file)
    { "id": "internal", "transport": "http", "url": "https://acme.example/mcp",
      "auth": { "type": "bearer", "tokenEnv": "ACME_MCP_TOKEN" } },

    // http + oauth: the full OAuth dance — works with ANY spec-compliant server
    { "id": "linear", "transport": "http", "url": "https://mcp.linear.app/mcp",
      "auth": { "type": "oauth", "clientName": "My MCP bridge neuron" } }
  ]
}
```

- **`transport: "stdio"`** — `command` + `args` (+ optional `cwd`, `env`).
- **`transport: "http"`** — Streamable HTTP `url` + an `auth` block:
  - `{ "type": "none" }` (default)
  - `{ "type": "bearer", "tokenEnv": "..." }` — token from the named env var.
  - `{ "type": "oauth", "clientName": "...", "scopes": [...] }` — see below.

## OAuth

For `oauth` servers the bridge runs the same flow the desktop tester uses,
implemented with the MCP SDK's own `OAuthClientProvider` + `auth()` orchestrator:
**RFC 9728** protected-resource discovery → **RFC 7591** dynamic client
registration → **PKCE** → a one-shot `127.0.0.1` **loopback callback**. Because
it's all discovery/registration-driven (nothing Linear-specific), any
spec-compliant OAuth MCP server works — just add a catalog entry.

On first connect the bridge prints (and tries to open) an authorize URL; you log
in, the loopback listener catches the redirect, and tokens are saved to
`~/.holokai/mcp-bridge/mcp-<serverId>-token.json` (mode 0600, override the
directory with `MCP_TOKEN_DIR`). Subsequent runs reuse the refresh token; the
transport refreshes access tokens transparently. Delete the token file to force
re-authorization.

> Tokens are stored as **plain JSON** — the same developer-tool trade-off the
> desktop tester makes. Fine for local development; use a real secret store for
> anything else.

## Capability naming

Each tool becomes a capability typed `<capabilityPrefix>/<serverId>/<toolName>`
— e.g. `mcp/linear/create_issue`. This follows the documented convention
`{owner}/{package}[/{name}][.{variant}]` (see
[`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md)).

**Heads-up on the prefix.** The gateway's namespace-authz table authorizes
`core/* · desktop/* · org/{orgId}/* · user/{userId}/*` — **`mcp/*` is not on
it.** In the desktop app that's fine (`mcp/...` is its *internal* type; it
advertises to the gateway as an attested `desktop/*` binary). Here you're a
plain neuron, so against a gateway with authz enabled, `mcp/...` registrations
get **HTTP 403**. Fix by setting `capabilityPrefix` to something your token is
authorized for (e.g. `org/<yourOrgId>/mcp`), or run the gateway in dev with
`NEURON_NAMESPACE_AUTH_BYPASS`.

## Output shape

Every reflected capability returns a uniform envelope:

```json
{ "content": <the tool's result, structured/parsed when possible>, "isError": false }
```

`content` is the tool's payload with one layer of string-encoding unwrapped
(structuredContent when the server provides it). The bridge advertises this
envelope as the `outputSchema` for *every* tool — unlike the desktop tester,
which advertises each tool's own `outputSchema`. The reason: the neuron SDK
validates handler output against the advertised schema, so a uniform envelope is
correct-by-construction. To surface a tool's typed output shape instead, advertise
`tool.outputSchema` and return the bare structured content.

## Scope

Reflected capabilities are `scope: "any"` for simplicity. **An OAuth server is
authenticated as a specific user** — in a real deployment those capabilities
should be `{ onBehalfOf: <userId> }` so the gateway never routes another user's
task to your connection. Scope is the most important per-capability decision;
see the "Scope" section of the Developer's Guide.

## Prerequisites

- Node.js 20+
- `@holokai/neuron-sdk` and `@modelcontextprotocol/sdk` from public npm —
  `npm install` resolves both with no registry config.
- For the default catalog's stdio filesystem server: `npx` on PATH.

## What to read next

- [`docs/NEURON_DEVELOPERS_GUIDE.md`](../../../../docs/NEURON_DEVELOPERS_GUIDE.md) — capabilities, scope, namespace auth.
