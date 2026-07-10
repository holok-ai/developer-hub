"""CLI runner: connect to a BigBrain gateway and offer `examples/http.fetch`.

Usage:

    BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \\
    BIGBRAIN_TOKEN=eyJhbGciOi... \\
    BIGBRAIN_NEURON_ID=my-python-neuron-1 \\
    python -m examples.http_fetch

If `BIGBRAIN_TOKEN` is omitted, the runner falls back to reading from a
`BIGBRAIN_TOKEN_FILE` path (re-read on every refresh, so you can rotate it
out-of-band without restarting). At least one of the two must be set.

Run from the repo root:

    cd packages/neuron-sdk-python
    pip install -e .
    python -m examples.http_fetch
"""

from __future__ import annotations

import asyncio
import logging
import os
import signal
import sys
from collections.abc import Callable
from pathlib import Path

from holokai_neuron_sdk import Neuron

from .capability import (
    CAPABILITY,
    INPUT_SCHEMA,
    OUTPUT_SCHEMA,
    handle_http_fetch,
)

log = logging.getLogger("examples.http_fetch")


def _build_auth_callback() -> Callable[[], str]:
    static = os.environ.get("BIGBRAIN_TOKEN")
    if static:
        return lambda: static

    token_file = os.environ.get("BIGBRAIN_TOKEN_FILE")
    if token_file:
        path = Path(token_file)

        def _read() -> str:
            return path.read_text(encoding="utf-8").strip()

        return _read

    raise SystemExit(
        "Set BIGBRAIN_TOKEN or BIGBRAIN_TOKEN_FILE so the SDK can authenticate."
    )


async def _run() -> int:
    logging.basicConfig(
        level=os.environ.get("LOG_LEVEL", "INFO").upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )

    gateway_url = os.environ.get("BIGBRAIN_GATEWAY_URL")
    neuron_id = os.environ.get("BIGBRAIN_NEURON_ID")
    if not gateway_url or not neuron_id:
        print(
            "BIGBRAIN_GATEWAY_URL and BIGBRAIN_NEURON_ID are required.",
            file=sys.stderr,
        )
        return 2

    auth = _build_auth_callback()

    neuron = Neuron(
        gateway_url=gateway_url,
        neuron_id=neuron_id,
        auth=auth,
        logger=log,
    )
    neuron.register_handler(
        CAPABILITY,
        handle_http_fetch,
        input_schema=INPUT_SCHEMA,
        output_schema=OUTPUT_SCHEMA,
    )
    neuron.on(
        "connection:registered",
        lambda info: log.info("registered", extra={"session_id": info["session_id"]}),
    )
    neuron.on("error", lambda err: log.warning("transport error: %r", err))

    stop_event = asyncio.Event()

    def _request_stop(*_args: object) -> None:
        log.info("shutdown signal received")
        stop_event.set()

    loop = asyncio.get_running_loop()
    for sig in (signal.SIGINT, signal.SIGTERM):
        try:
            loop.add_signal_handler(sig, _request_stop)
        except NotImplementedError:
            # Windows or unusual environments — fall back to Python signal.
            signal.signal(sig, _request_stop)

    await neuron.start()
    log.info("neuron started; offering examples/http.fetch")
    try:
        await stop_event.wait()
    finally:
        await neuron.stop(drain=True, timeout=30)
    return 0


def main() -> int:
    try:
        return asyncio.run(_run())
    except KeyboardInterrupt:
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
