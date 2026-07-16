# Example neurons

Runnable reference neurons in both supported languages. A *neuron* is any
process that connects to a BigBrain gateway and executes capability-typed tasks.

| Example | Language | Capability | What it shows |
|---|---|---|---|
| [`typescript/http-fetch/`](./typescript/http-fetch) | TypeScript | `examples/http.fetch` | Typed capability (zod), abort-on-cancel, graceful shutdown |
| [`typescript/progress-cancel/`](./typescript/progress-cancel) | TypeScript | `examples/batch.process` | Progress frames + cooperative cancellation (abort-aware waiting) |
| [`typescript/web-search/`](./typescript/web-search) | TypeScript | `examples/web.search` | Second capability; terminal-vs-retryable failure classification |
| [`typescript/mcp-bridge/`](./typescript/mcp-bridge) | TypeScript | `mcp/<server>/<tool>` (dynamic) | Bridge MCP servers into capabilities from a JSON catalog; stdio/http; OAuth (PKCE loopback) |
| [`python/http_fetch/`](./python/http_fetch) | Python | `examples/http.fetch` | Async handler, cancellation race, progress updates |
| [`python/web_search/`](./python/web_search) | Python | `examples/web.search` | A second capability with its own schema |

All of them: connect with a gateway URL + JWT, advertise an `any`-scoped
capability, classify failures correctly, and shut down on SIGTERM/SIGINT.

Start with the [Neuron Developer's Guide](../../docs/NEURON_DEVELOPERS_GUIDE.md)
for the mental model, then copy whichever example matches your language.

> **SDK access:** these depend on Holokai's neuron SDK — `@holokai/neuron-sdk`
> on public [npm](https://www.npmjs.com/package/@holokai/neuron-sdk) and
> `holokai-neuron-sdk` on public [PyPI](https://pypi.org/project/holokai-neuron-sdk/).
> Both install with no registry configuration or auth.
