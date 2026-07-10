# `examples/http.fetch` — runnable Python neuron

Generic outbound HTTP fetcher exposed as a BigBrain capability. A workflow
plan that resolves to `examples/http.fetch` will arrive at this neuron as a
lease, run an `httpx` request, and ack with the response.

## Run

```bash
cd packages/neuron-sdk-python
pip install -e .
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_NEURON_ID=my-python-neuron-1 \
BIGBRAIN_TOKEN=eyJhbGciOi... \
python -m examples.http_fetch
```

`BIGBRAIN_TOKEN_FILE=/path/to/token` is supported as an alternative — the
file is re-read on every auth refresh, so you can rotate the token without
restarting.

## Capability shape

| Field | Value |
| ----- | ----- |
| `type` | `examples/http.fetch` |
| `scope` | `any` |
| `concurrency` | 8 (handle up to 8 leases in parallel per neuron) |
| `leaseTtlMs` | 60_000 (longer than the default to cover slow upstreams) |

### Input

```json
{
  "url": "https://example.com/api/thing",
  "method": "GET",
  "headers": {"User-Agent": "bigbrain-neuron"},
  "body": null,
  "timeout_ms": 10000,
  "max_response_bytes": 1000000,
  "follow_redirects": true
}
```

Only `url` is required.

### Output

```json
{
  "status": 200,
  "headers": {"content-type": "application/json", "...": "..."},
  "body": "{\"hello\":\"world\"}",
  "truncated": false,
  "duration_ms": 87,
  "final_url": "https://example.com/api/thing"
}
```

* HTTP non-2xx responses are returned as-is — the workflow author decides
  whether a 4xx/5xx is fatal.
* Response bodies are decoded as UTF-8 (replacement on errors) and clipped
  to `max_response_bytes`. `truncated: true` means there was more.
* Network errors (DNS, connect refused, timeout) propagate as a
  `retryable` nack — the workflow's retry policy decides what's next.
* If the gateway sends a `cancel` frame mid-request the in-flight `httpx`
  call is aborted and the lease is nacked as `cancelled`.

## Files

| File | What |
| ---- | ---- |
| [`capability.py`](capability.py) | Handler, JSON schemas, `Capability` definition. Importable on its own. |
| [`__main__.py`](__main__.py) | CLI runner. Reads gateway URL / neuron id / token from env, registers the handler, runs until SIGINT. |
