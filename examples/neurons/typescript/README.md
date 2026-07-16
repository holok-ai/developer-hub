# TypeScript neuron examples

Each subdirectory is a **standalone, individually-downloadable** neuron: its own
`package.json`, `tsconfig.json`, and `src/index.ts`. Copy the one that fits your
use case into your own project and go.

| Example | Capability | What it shows |
|---|---|---|
| [`http-fetch/`](./http-fetch) | `examples/http.fetch` | The minimal complete neuron — typed capability (zod), abort-on-cancel, graceful shutdown |
| [`progress-cancel/`](./progress-cancel) | `examples/batch.process` | Progress frames (`ctx.progress`) + cooperative cancellation (`ctx.signal`, abort-aware waiting) |
| [`web-search/`](./web-search) | `examples/web.search` | A second capability with its own schema; terminal-vs-retryable failure classification (`ctx.fail`) |

All of them: connect with a gateway URL + JWT, advertise an `any`-scoped
capability, classify failures correctly, and shut down on SIGINT/SIGTERM.

## SDK

They depend on [`@holokai/neuron-sdk`](https://www.npmjs.com/package/@holokai/neuron-sdk),
published to **public npm** — `npm install` resolves it with no registry config
or auth. Requires Node.js 20+.

Start with the [Neuron Developer's Guide](../../../docs/NEURON_DEVELOPERS_GUIDE.md)
for the mental model, then copy whichever example fits.
