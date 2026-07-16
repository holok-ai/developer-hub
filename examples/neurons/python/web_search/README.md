# `examples/web.search` — keyless web search

Exposes web search to BigBrain workflows by scraping DuckDuckGo's HTML
endpoint (`https://html.duckduckgo.com/html/`). No API key, no extra
dependencies beyond `httpx` and stdlib `html.parser`.

## ⚠️ Caveats

* **Brittle by design** — DuckDuckGo can change the HTML markup or
  tighten rate-limits at any time. If results stop coming back, look at
  the response (`LOG_LEVEL=DEBUG`) and adjust the parser, or swap in
  another provider.
* **Rate-limited** — DDG returns HTTP 202 (with no results) when it
  decides you're hitting too hard. The handler surfaces that as a
  `terminal` nack so the workflow author chooses a back-off rather than
  the framework retrying into a tighter ban.
* **No personalization / safe-search controls** — kept intentionally
  thin. Wire those in via the `region` field (passed through as
  DuckDuckGo's `kl=` parameter) or replace the handler.

## Run

```bash
cd packages/neuron-sdk-python
pip install -e .
BIGBRAIN_GATEWAY_URL=https://bigbrain.holokai.dev \
BIGBRAIN_NEURON_ID=my-python-neuron-1 \
BIGBRAIN_TOKEN=eyJ... \
python -m examples.web_search
```

Optional overrides:

| Env var | Default | What it does |
| ------- | ------- | ------------ |
| `EXAMPLES_WEB_SEARCH_ENDPOINT` | `https://html.duckduckgo.com/html/` | Swap providers (e.g. a private SearXNG instance — though parser will need to be adjusted to the new HTML shape). |
| `EXAMPLES_WEB_SEARCH_UA` | a desktop Chrome UA | Set the `User-Agent`. DDG returns empty results for the stock httpx UA. |

## Capability shape

| Field | Value |
| ----- | ----- |
| `type` | `examples/web.search` |
| `scope` | `any` |
| `concurrency` | 4 |
| `leaseTtlMs` | 30_000 |

### Input

```json
{
  "query": "neuron protocol holokai",
  "max_results": 10,
  "region": "wt-wt"
}
```

Only `query` is required.

### Output

```json
{
  "query": "neuron protocol holokai",
  "results": [
    {
      "title": "Holokai BigBrain — Neuron architecture",
      "url": "https://example.test/neuron",
      "snippet": "Lease-based capability dispatch over SSE+POST..."
    }
  ]
}
```

## Files

| File | What |
| ---- | ---- |
| [`capability.py`](capability.py) | Handler, JSON Schemas, `Capability` definition, defensive HTML parser. |
| [`__main__.py`](__main__.py) | CLI runner. Reads gateway URL / neuron id / token from env, registers the handler, runs until SIGINT. |
