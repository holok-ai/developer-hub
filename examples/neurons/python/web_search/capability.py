"""`examples/web.search` — keyless web search via DuckDuckGo HTML.

POSTs the query to `https://html.duckduckgo.com/html/` and parses the
returned HTML with stdlib `html.parser`. Free, no API key, but inherently
fragile: DuckDuckGo can change the markup or rate-limit at any time. For
production use, swap in a paid provider via `EXAMPLES_WEB_SEARCH_ENDPOINT`
or replace this handler with one that calls Brave / Tavily / SearXNG.

Failure semantics match the rest of the SDK:

* Network errors (DNS, connect refused, timeout) → retryable nack.
* Non-2xx response from DuckDuckGo → terminal nack via `ctx.fail`. Most
  often this means rate-limited; the workflow author can decide to back
  off and retry on a longer cadence.
* Cancellation while the request is in flight → `cancelled` nack.
"""

from __future__ import annotations

import asyncio
import os
import urllib.parse
from html.parser import HTMLParser
from typing import Any

import httpx

from holokai_neuron_sdk import Capability, HandlerContext

CAPABILITY = Capability(
    type="examples/web.search",
    scope="any",
    concurrency=4,
    leaseTtlMs=30_000,
)

INPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string", "minLength": 1, "maxLength": 500},
        "max_results": {
            "type": "integer",
            "minimum": 1,
            "maximum": 25,
            "default": 10,
        },
        "region": {
            "type": "string",
            "default": "wt-wt",
            "description": (
                "DuckDuckGo region code (e.g. 'us-en', 'wt-wt' for worldwide). "
                "Pass-through; no validation against the supported set."
            ),
        },
    },
    "required": ["query"],
    "additionalProperties": False,
}

OUTPUT_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "query": {"type": "string"},
        "results": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "title": {"type": "string"},
                    "url": {"type": "string"},
                    "snippet": {"type": "string"},
                },
                "required": ["title", "url", "snippet"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["query", "results"],
    "additionalProperties": False,
}

_DEFAULT_ENDPOINT = "https://html.duckduckgo.com/html/"
# DDG returns an empty results list for the bare default UA — a real-looking
# UA is part of the contract here. Override via env if you need to identify
# yourself differently.
_DEFAULT_USER_AGENT = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
)


async def handle_web_search(
    payload: dict[str, Any],
    ctx: HandlerContext,
    *,
    client_factory: Any = None,
) -> dict[str, Any]:
    """Run the search.

    `client_factory` is a test seam — anything callable returning an
    `httpx.AsyncClient`. Production callers should not pass it.
    """
    query: str = payload["query"]
    max_results: int = payload.get("max_results", 10)
    region: str = payload.get("region", "wt-wt")

    endpoint = os.environ.get("EXAMPLES_WEB_SEARCH_ENDPOINT", _DEFAULT_ENDPOINT)
    user_agent = os.environ.get("EXAMPLES_WEB_SEARCH_UA", _DEFAULT_USER_AGENT)

    await ctx.progress(percent=10, message=f"querying {endpoint}")

    client = client_factory() if client_factory else httpx.AsyncClient(
        timeout=15.0,
        follow_redirects=True,
        headers={"User-Agent": user_agent},
    )
    async with client:
        response = await _race_against_cancel(
            client.post(endpoint, data={"q": query, "kl": region}),
            ctx,
        )

    if response.status_code != 200:
        # DDG returns 202 when rate-limiting; surface as terminal so the
        # workflow author chooses to back off rather than the framework
        # silently retrying into a tighter ban.
        ctx.fail(
            f"search endpoint returned HTTP {response.status_code}",
            code="UPSTREAM_NON_2XX",
        )

    results = _parse_results(response.text)[:max_results]

    await ctx.progress(percent=100, message=f"found {len(results)} results")
    return {"query": query, "results": results}


# ---------------------------------------------------------------------------
# HTML parsing
# ---------------------------------------------------------------------------


def _parse_results(html: str) -> list[dict[str, str]]:
    """Extract `[{title, url, snippet}]` from a DDG HTML response.

    Defensive against partial / malformed markup: yields whatever it can
    pair up cleanly and skips the rest.
    """
    parser = _DdgResultParser()
    parser.feed(html)
    parser.close()
    return parser.results


class _DdgResultParser(HTMLParser):
    """Stateful parser walking DDG's `result` blocks.

    Each result looks roughly like:

      <div class="result results_links results_links_deep web-result">
        <div class="links_main result__body">
          <h2 class="result__title">
            <a class="result__a" href="//duckduckgo.com/l/?uddg=...">Title</a>
          </h2>
          <a class="result__snippet" href="...">Snippet text</a>
        </div>
      </div>
    """

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.results: list[dict[str, str]] = []
        self._current: dict[str, str] | None = None
        self._capture: str | None = None  # 'title' | 'snippet' | None
        self._buffer: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {k: (v or "") for k, v in attrs}
        cls = attr.get("class", "")
        classes = cls.split()

        if tag == "h2" and "result__title" in classes:
            self._current = {}
            return

        if tag == "a" and self._current is not None:
            if "result__a" in classes and "title" not in self._current:
                self._current["url"] = _resolve_redirect(attr.get("href", ""))
                self._capture = "title"
                self._buffer = []
            elif "result__snippet" in classes:
                self._capture = "snippet"
                self._buffer = []

    def handle_endtag(self, tag: str) -> None:
        if tag != "a" or self._current is None or self._capture is None:
            return
        text = "".join(self._buffer).strip()
        if self._capture == "title":
            self._current["title"] = text
        elif self._capture == "snippet":
            self._current["snippet"] = text
        self._capture = None
        self._buffer = []
        self._maybe_flush()

    def handle_data(self, data: str) -> None:
        if self._capture is not None:
            self._buffer.append(data)

    def _maybe_flush(self) -> None:
        cur = self._current
        if cur is None:
            return
        if "title" in cur and "url" in cur and "snippet" in cur:
            self.results.append(
                {
                    "title": cur["title"],
                    "url": cur["url"],
                    "snippet": cur["snippet"],
                }
            )
            self._current = None


def _resolve_redirect(href: str) -> str:
    """DDG wraps result links in `//duckduckgo.com/l/?uddg=<encoded>` —
    unwrap to the real URL. Pass non-DDG hrefs through; protocol-relative
    URLs get an explicit `https:` prefix."""
    if not href:
        return ""
    parsed = urllib.parse.urlparse(href if "://" in href else "https:" + href)
    if "duckduckgo.com" in parsed.netloc and parsed.path.rstrip("/") == "/l":
        qs = urllib.parse.parse_qs(parsed.query)
        if "uddg" in qs and qs["uddg"]:
            return qs["uddg"][0]
    if href.startswith("//"):
        return "https:" + href
    return href


# ---------------------------------------------------------------------------
# Cancellation helper (copy of the http_fetch one — examples are intentionally
# self-contained so each can be lifted into a user project on its own).
# ---------------------------------------------------------------------------


async def _race_against_cancel(coro: Any, ctx: HandlerContext) -> Any:
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
    "handle_web_search",
]
