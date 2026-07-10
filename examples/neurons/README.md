# Example neurons

Runnable reference neurons in both supported languages. A *neuron* is any
process that connects to a BigBrain gateway and executes capability-typed tasks.

| Example | Language | Capability | What it shows |
|---|---|---|---|
| [`typescript/`](./typescript) | TypeScript | `examples/http.fetch` | Typed capability (zod), abort-on-cancel, graceful shutdown |
| [`python/http_fetch/`](./python/http_fetch) | Python | `examples/http.fetch` | Async handler, cancellation race, progress updates |
| [`python/web_search/`](./python/web_search) | Python | `examples/web.search` | A second capability with its own schema |

All of them: connect with a gateway URL + JWT, advertise an `any`-scoped
capability, classify failures correctly, and shut down on SIGTERM/SIGINT.

Start with the [Neuron Developer's Guide](../../docs/NEURON_DEVELOPERS_GUIDE.md)
for the mental model, then copy whichever example matches your language.

> **SDK access:** both depend on Holokai's neuron SDK (`@holokai/neuron-sdk` /
> `holokai-neuron-sdk`), published to Holokai's private registries. Configure
> registry access first — see each example's README.
