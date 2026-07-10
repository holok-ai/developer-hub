# Python neuron examples

Two runnable neurons built on `holokai-neuron-sdk`.

## Prerequisites

- Python 3.11+
- Access to the `holokai-neuron-sdk` package (Holokai's private package index)
  plus each example's own deps (`httpx`). Configure your index/credentials, then:

```bash
python -m venv .venv && source .venv/bin/activate
pip install holokai-neuron-sdk httpx
```

## Run

Each example is a runnable module. From this directory:

```bash
BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
BIGBRAIN_TOKEN=eyJhbGciOi... \
BIGBRAIN_NEURON_ID=my-python-neuron-1 \
python -m http_fetch
```

Swap `http_fetch` for `web_search` to run the other. If you omit
`BIGBRAIN_TOKEN`, set `BIGBRAIN_TOKEN_FILE` to a path the SDK re-reads on every
refresh. Use a **stable** `BIGBRAIN_NEURON_ID` across restarts.

See each example's own `README.md` for its capability contract, and
[`docs/NEURON_SDK_PYTHON.md`](../../../docs/NEURON_SDK_PYTHON.md) for the full
SDK API.
