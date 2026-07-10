"""`examples/http.fetch` — fetch an arbitrary HTTP(S) URL and return the response.

A simple, generic capability that lets a BigBrain workflow make an outbound
HTTP request from this neuron's network position. Useful for fetching public
data, calling REST APIs, scraping pages.

Failure semantics:

* `httpx.RequestError` (DNS, connect refused, timeout) → bubbles to the lease
  runner as a retryable nack. The workflow's retry policy decides what to do.
* HTTP non-2xx responses are *not* errors — the response is returned with
  its status code and the workflow author decides how to handle it.
* `ctx.cancelled` set (gateway sent a `cancel` frame, or shutdown) → the
  in-flight request is aborted and the lease runner emits a cancelled nack.
"""

from __future__ import annotations

import asyncio
import time
from typing import Any

import httpx

from holokai_neuron_sdk import Capability, HandlerContext

CAPABILITY = Capability(
    type="examples/http.fetch",
    scope="any",
    concurrency=8,
    leaseTtlMs=60_000,
)

INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "url": {
            "type": "string",
            "format": "uri",
            "description": "Absolute http:// or https:// URL to fetch.",
        },
        "method": {
            "type": "string",
            "enum": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
            "default": "GET",
        },
        "headers": {
            "type": "object",
            "additionalProperties": {"type": "string"},
            "description": "Request headers as a string→string map.",
        },
        "body": {
            "type": ["string", "null"],
            "description": "Request body as a UTF-8 string. Set Content-Type via headers.",
        },
        "timeout_ms": {
            "type": "integer",
            "minimum": 100,
            "maximum": 60_000,
            "default": 10_000,
        },
        "max_response_bytes": {
            "type": "integer",
            "minimum": 1,
            "maximum": 10_000_000,
            "default": 1_000_000,
        },
        "follow_redirects": {"type": "boolean", "default": True},
    },
    "required": ["url"],
    "additionalProperties": False,
}

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "status": {"type": "integer", "minimum": 100, "maximum": 599},
        "headers": {
            "type": "object",
            "additionalProperties": {"type": "string"},
        },
        "body": {"type": "string", "description": "Response body decoded as UTF-8."},
        "truncated": {
            "type": "boolean",
            "description": "True if the body was clipped to max_response_bytes.",
        },
        "duration_ms": {"type": "integer", "minimum": 0},
        "final_url": {"type": "string", "description": "URL after redirects."},
    },
    "required": ["status", "headers", "body", "truncated", "duration_ms", "final_url"],
    "additionalProperties": False,
}


async def handle_http_fetch(
    payload: dict[str, Any],
    ctx: HandlerContext,
    *,
    client_factory: Any = None,
) -> dict[str, Any]:
    """Run the HTTP fetch.

    `client_factory` is for tests — anything callable returning an
    `httpx.AsyncClient` (already entered as an async-context-manager). In
    production callers shouldn't pass it.
    """
    url = payload["url"]
    method = payload.get("method", "GET")
    headers = payload.get("headers", {})
    body = payload.get("body")
    timeout_s = payload.get("timeout_ms", 10_000) / 1000
    max_bytes = payload.get("max_response_bytes", 1_000_000)
    follow_redirects = payload.get("follow_redirects", True)

    await ctx.progress(percent=10, message=f"connecting to {url}")

    start = time.perf_counter()
    client = client_factory() if client_factory else httpx.AsyncClient(
        timeout=timeout_s,
        follow_redirects=follow_redirects,
    )
    async with client:
        response = await _race_against_cancel(
            client.request(method, url, headers=headers, content=body),
            ctx,
        )

    raw = response.content
    truncated = len(raw) > max_bytes
    if truncated:
        raw = raw[:max_bytes]
    text = raw.decode(response.encoding or "utf-8", errors="replace")
    duration_ms = int((time.perf_counter() - start) * 1000)

    await ctx.progress(percent=100, message=f"received {response.status_code}")

    return {
        "status": response.status_code,
        "headers": {k: v for k, v in response.headers.items()},
        "body": text,
        "truncated": truncated,
        "duration_ms": duration_ms,
        "final_url": str(response.url),
    }


async def _race_against_cancel(coro: Any, ctx: HandlerContext) -> Any:
    """Await `coro` while watching `ctx.cancelled`. If cancellation fires
    first, cancel the request task and raise `asyncio.CancelledError` so the
    lease runner emits a `cancelled` nack."""
    request_task = asyncio.ensure_future(coro)
    cancel_task = asyncio.ensure_future(ctx.cancelled.wait())
    try:
        done, _ = await asyncio.wait(
            {request_task, cancel_task},
            return_when=asyncio.FIRST_COMPLETED,
        )
        if cancel_task in done and request_task not in done:
            request_task.cancel()
            try:
                await request_task
            except (asyncio.CancelledError, Exception):
                pass
            raise asyncio.CancelledError("cancelled before response")
        return request_task.result()
    finally:
        cancel_task.cancel()


__all__ = [
    "CAPABILITY",
    "INPUT_SCHEMA",
    "OUTPUT_SCHEMA",
    "handle_http_fetch",
]
