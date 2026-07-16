/**
 * `examples/web.search` — keyless web search via DuckDuckGo HTML. The
 * TypeScript sibling of the Python `web_search` example; both speak the same
 * wire protocol and return the same `{ query, results[] }` shape.
 *
 * POSTs the query to `https://html.duckduckgo.com/html/` and extracts results
 * from the returned HTML. Free, no API key, but inherently fragile: DuckDuckGo
 * can change the markup or rate-limit at any time. For production, point
 * `EXAMPLES_WEB_SEARCH_ENDPOINT` at a real provider (Brave / Tavily / SearXNG)
 * or replace the handler.
 *
 * Failure semantics:
 *   - Network errors (DNS, connect refused, timeout) → thrown → retryable nack.
 *   - Non-2xx from the endpoint (DDG returns 202 when rate-limiting) → terminal
 *     nack via `ctx.fail`, so the workflow author backs off instead of the
 *     framework retrying into a tighter ban.
 *   - Cancellation while the request is in flight → AbortError propagates →
 *     cancelled nack.
 *
 * Run:
 *   BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
 *   BIGBRAIN_TOKEN=eyJhbGciOi... \
 *   BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
 *   npm start
 */
import { readFileSync } from 'node:fs';
import { Neuron, defineCapability } from '@holokai/neuron-sdk';
import { z } from 'zod';

const DEFAULT_ENDPOINT = 'https://html.duckduckgo.com/html/';
// DDG returns an empty list for a bare default UA — a real-looking UA is part
// of the contract. Override via EXAMPLES_WEB_SEARCH_UA if you need to identify
// yourself differently.
const DEFAULT_USER_AGENT =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const webSearch = defineCapability({
  type: 'examples/web.search',
  description: 'Search the web (keyless, via DuckDuckGo HTML) and return titles, URLs, and snippets.',
  scope: 'any',
  concurrency: 4,
  leaseTtlMs: 30_000,
  input: z.object({
    query: z.string().min(1).max(500),
    maxResults: z.number().int().min(1).max(25).default(10),
    // DuckDuckGo region code (e.g. 'us-en', 'wt-wt' for worldwide). Pass-through;
    // not validated against the supported set.
    region: z.string().default('wt-wt'),
  }),
  output: z.object({
    query: z.string(),
    results: z.array(
      z.object({ title: z.string(), url: z.string(), snippet: z.string() }),
    ),
  }),
});

interface SearchResult {
  title: string;
  url: string;
  snippet: string;
}

function authCallback(): string {
  const token = process.env.BIGBRAIN_TOKEN;
  if (token) return token;
  const file = process.env.BIGBRAIN_TOKEN_FILE;
  if (file) return readFileSync(file, 'utf8').trim();
  throw new Error('Set BIGBRAIN_TOKEN or BIGBRAIN_TOKEN_FILE so the SDK can authenticate.');
}

async function main(): Promise<void> {
  const gatewayUrl = process.env.BIGBRAIN_GATEWAY_URL;
  const neuronId = process.env.BIGBRAIN_NEURON_ID;
  if (!gatewayUrl || !neuronId) {
    throw new Error('BIGBRAIN_GATEWAY_URL and BIGBRAIN_NEURON_ID are required.');
  }

  const neuron = new Neuron({ gatewayUrl, neuronId, auth: authCallback });

  neuron.handle(webSearch, async (input, ctx) => {
    const endpoint = process.env.EXAMPLES_WEB_SEARCH_ENDPOINT ?? DEFAULT_ENDPOINT;
    const userAgent = process.env.EXAMPLES_WEB_SEARCH_UA ?? DEFAULT_USER_AGENT;

    ctx.progress({ percent: 10, message: `querying ${endpoint}` });

    // Thread the lease's abort signal so an in-flight request cancels on
    // cancel/shutdown (see the progress-cancel example for the pattern).
    const controller = new AbortController();
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    let response: Response;
    try {
      response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'User-Agent': userAgent,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({ q: input.query, kl: input.region }).toString(),
        signal: controller.signal,
      });
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }

    if (response.status !== 200) {
      // Terminal: most often a 202 rate-limit. Let the workflow author decide
      // to back off rather than the framework retrying into a tighter ban.
      ctx.fail(`search endpoint returned HTTP ${response.status}`, { code: 'UPSTREAM_NON_2XX' });
    }

    const results = parseResults(await response.text()).slice(0, input.maxResults);
    ctx.progress({ percent: 100, message: `found ${results.length} results` });
    return { query: input.query, results };
  });

  neuron.once('connection:registered', ({ sessionId, capabilities }) =>
    console.log(`registered ${capabilities} capability(ies) as session ${sessionId}`),
  );
  neuron.on('connection:reconnecting', ({ attempt, delayMs, reason }) =>
    console.warn(`reconnecting #${attempt} in ${delayMs}ms (${reason})`),
  );

  await neuron.start();
  console.log('neuron started; offering examples/web.search');

  const stop = () => {
    void neuron.stop({ drain: true, timeoutMs: 30_000 }).then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

// ---------------------------------------------------------------------------
// HTML parsing. Intentionally dependency-free and defensive: it pairs each
// `result__a` (title + link) with the following `result__snippet` in document
// order and skips anything it can't cleanly pair. Fragile by nature — see the
// header note about swapping in a real provider.
// ---------------------------------------------------------------------------

const TITLE_RE = /<a\b[^>]*\bclass="[^"]*\bresult__a\b[^"]*"[^>]*\bhref="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
const SNIPPET_RE = /<a\b[^>]*\bclass="[^"]*\bresult__snippet\b[^"]*"[^>]*>([\s\S]*?)<\/a>/gi;

function parseResults(html: string): SearchResult[] {
  const titles: { title: string; url: string }[] = [];
  for (const m of html.matchAll(TITLE_RE)) {
    titles.push({ url: resolveRedirect(m[1]), title: cleanText(m[2]) });
  }
  const snippets: string[] = [];
  for (const m of html.matchAll(SNIPPET_RE)) {
    snippets.push(cleanText(m[1]));
  }

  const results: SearchResult[] = [];
  for (let i = 0; i < titles.length; i++) {
    const { title, url } = titles[i];
    const snippet = snippets[i] ?? '';
    if (title && url) results.push({ title, url, snippet });
  }
  return results;
}

/**
 * DDG wraps result links in `//duckduckgo.com/l/?uddg=<encoded>` — unwrap to
 * the real URL. Non-DDG hrefs pass through; protocol-relative URLs get an
 * explicit `https:` prefix.
 */
function resolveRedirect(href: string): string {
  if (!href) return '';
  let parsed: URL;
  try {
    parsed = new URL(href.includes('://') ? href : `https:${href}`);
  } catch {
    return href;
  }
  if (parsed.hostname.includes('duckduckgo.com') && parsed.pathname.replace(/\/$/, '') === '/l') {
    const uddg = parsed.searchParams.get('uddg');
    if (uddg) return uddg;
  }
  return href.startsWith('//') ? `https:${href}` : href;
}

/** Strip inline tags (DDG bolds matched terms) and decode HTML entities. */
function cleanText(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, '')).trim();
}

function decodeEntities(text: string): string {
  const named: Record<string, string> = {
    amp: '&',
    lt: '<',
    gt: '>',
    quot: '"',
    apos: "'",
    nbsp: ' ',
    '#39': "'",
    '#x27': "'",
  };
  return text.replace(/&(#x?[0-9a-f]+|[a-z0-9]+);/gi, (whole, entity: string) => {
    const key = entity.toLowerCase();
    if (key in named) return named[key];
    if (key.startsWith('#x')) {
      const code = parseInt(key.slice(2), 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    if (key.startsWith('#')) {
      const code = parseInt(key.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return whole;
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
