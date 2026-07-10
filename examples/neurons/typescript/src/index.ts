/**
 * Minimal runnable neuron: offers `examples/http.fetch` — fetch an HTTP(S) URL
 * and return the response. This is the TypeScript sibling of the Python
 * `http_fetch` example; both speak the same wire protocol.
 *
 * Run:
 *   BIGBRAIN_GATEWAY_URL=https://api.holokai.dev \
 *   BIGBRAIN_TOKEN=eyJhbGciOi... \
 *   BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
 *   npm start
 *
 * If BIGBRAIN_TOKEN is omitted, set BIGBRAIN_TOKEN_FILE to a path the SDK
 * re-reads on every refresh (rotate the token out-of-band without restarting).
 */
import { readFileSync } from 'node:fs';
import { Neuron, defineCapability } from '@holokai/neuron-sdk';
import { z } from 'zod';

// A typed capability: zod runs as the runtime validator; a JSON Schema
// projection is shipped to the gateway/planner. (You can also pass a raw
// { inputSchema, outputSchema } if you don't have zod on hand.)
const httpFetch = defineCapability({
  type: 'examples/http.fetch',
  description: 'Fetch an arbitrary HTTP(S) URL and return the response.',
  scope: 'any',
  concurrency: 8,
  input: z.object({
    url: z.string().url(),
    method: z.enum(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']).default('GET'),
    headers: z.record(z.string()).optional(),
    body: z.string().nullish(),
    timeoutMs: z.number().int().min(100).max(60_000).default(10_000),
  }),
  output: z.object({
    status: z.number().int(),
    headers: z.record(z.string()),
    body: z.string(),
    durationMs: z.number().int(),
    finalUrl: z.string(),
  }),
});

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

  neuron.handle(httpFetch, async (input, ctx) => {
    // input is typed from the zod schema above.
    ctx.progress({ percent: 10, message: `connecting to ${input.url}` });

    const controller = new AbortController();
    // Thread the lease's abort signal so the request cancels on cancel/shutdown.
    const onAbort = () => controller.abort();
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    const start = Date.now();
    try {
      const resp = await fetch(input.url, {
        method: input.method,
        headers: input.headers,
        body: input.body ?? undefined,
        signal: controller.signal,
      });
      const text = await resp.text();
      ctx.progress({ percent: 100, message: `received ${resp.status}` });
      return {
        status: resp.status,
        headers: Object.fromEntries(resp.headers.entries()),
        body: text,
        durationMs: Date.now() - start,
        finalUrl: resp.url,
      };
    } catch (err) {
      // AbortError → let it propagate as a benign cancellation.
      if ((err as Error).name === 'AbortError') throw err;
      // Network/transport blip → throw to nack as retryable.
      throw err;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  });

  neuron.once('connection:registered', ({ sessionId, capabilities }) =>
    console.log(`registered ${capabilities} capability(ies) as session ${sessionId}`),
  );
  neuron.on('connection:reconnecting', ({ attempt, delayMs, reason }) =>
    console.warn(`reconnecting #${attempt} in ${delayMs}ms (${reason})`),
  );

  await neuron.start();
  console.log('neuron started; offering examples/http.fetch');

  const stop = () => {
    void neuron.stop({ drain: true, timeoutMs: 30_000 }).then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
