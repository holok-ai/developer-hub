# TypeScript neuron examples

Each subdirectory is a **standalone, individually-downloadable** neuron: its own
`package.json`, `tsconfig.json`, and `src/index.ts`. Copy the one that fits your
use case into your own project and go.

| Example | Capability | What it shows |
|---|---|---|
| [`http-fetch/`](./http-fetch) | `examples/http.fetch` | The minimal complete neuron — typed capability (zod), abort-on-cancel, graceful shutdown |
| [`progress-cancel/`](./progress-cancel) | `examples/batch.process` | Progress frames (`ctx.progress`) + cooperative cancellation (`ctx.signal`, abort-aware waiting) |
| [`web-search/`](./web-search) | `examples/web.search` | A second capability with its own schema; terminal-vs-retryable failure classification (`ctx.fail`) |
| [`mcp-bridge/`](./mcp-bridge) | `mcp/<server>/<tool>` (dynamic) | Reflect MCP-server tools into capabilities from a JSON catalog; stdio/http; `none`/`bearer`/`oauth` (PKCE loopback) auth |

All of them: connect with a gateway URL + JWT, advertise an `any`-scoped
capability, classify failures correctly, and shut down on SIGINT/SIGTERM.

## SDK

They depend on [`@holokai/neuron-sdk`](https://www.npmjs.com/package/@holokai/neuron-sdk)
(**≥ 0.3.0**), published to **public npm** — `npm install` resolves it with no
registry config or auth. Requires Node.js 20+.

## Authentication

Every example authenticates the same way, via a small `src/auth.ts` helper
(`resolveAuth()`) that each one carries. It prefers, in order:

1. **Enrolled credential — no static JWT.** This is the deployed path. Enroll
   the machine **once** and the neuron mints its own short-lived `aud=bigbrain`
   tokens from the stored credential (OAuth2 `client_credentials`); there is **no
   `BIGBRAIN_TOKEN` env var** and nothing to rotate by hand:

   ```bash
   npx @holokai/neuron-sdk enroll --moku-url https://moku.example --name my-neuron
   ```

   `resolveAuth()` then finds the credential file (default location, or
   `BIGBRAIN_CREDENTIAL_FILE`) and uses `createClientCredentialsAuth` from
   `@holokai/neuron-sdk/auth`. Enrollment uses the RFC 8628 device flow; see
   `docs/NEURON_AUTH_SPEC.md` for the full model (enrollment, approval,
   revocation).

2. **`BIGBRAIN_TOKEN` / `BIGBRAIN_TOKEN_FILE`** — a pasted gateway JWT, for quick
   local development when you haven't enrolled.

So a deployed neuron needs **no JWT in its environment** — only the one-time
enrollment. The `BIGBRAIN_TOKEN` shown in each example's quick-start is just the
dev fallback.

Start with the [Neuron Developer's Guide](../../../docs/pdf/Neuron-Developers-Guide.pdf)
for the mental model, then copy whichever example fits.
