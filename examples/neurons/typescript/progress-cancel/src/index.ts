/**
 * Neuron demonstrating the two lifecycle features `http.fetch` doesn't:
 * **progress reporting** and **cooperative cancellation**.
 *
 * Offers `examples/batch.process` — walk a list of items, do a little work on
 * each (here: SHA-256), and report progress as it goes. The handler polls
 * `ctx.signal` between items and uses an abort-aware delay, so a cancel or
 * shutdown stops it promptly instead of running to the end.
 *
 * Why this matters: the gateway *leases* a task and expects heartbeats. A
 * long-running handler that ignores `ctx.signal` keeps its lease (and its
 * broker message) held after the workflow was cancelled — wasting the slot
 * until the lease TTL expires. Honouring the signal is how you release
 * promptly. See docs/NEURON_DEVELOPERS_GUIDE.md.
 *
 * Run:
 *   BIGBRAIN_GATEWAY_URL=https://bigbrain.holokai.dev \
 *   BIGBRAIN_TOKEN=eyJhbGciOi... \
 *   BIGBRAIN_NEURON_ID=my-ts-neuron-1 \
 *   npm start
 *
 * Auth is resolved by ./auth.ts: the enrolled credential (client_credentials,
 * no JWT env) is preferred; BIGBRAIN_TOKEN is the dev fallback. See
 * ../README.md#authentication.
 */
import { createHash } from 'node:crypto';
import { Neuron, defineCapability } from '@holokai/neuron-sdk';
import { z } from 'zod';

import { resolveAuth } from './auth.js';

const batchProcess = defineCapability({
  type: 'examples/batch.process',
  description:
    'Process a list of items one by one (SHA-256 each), reporting progress and honouring cancellation.',
  scope: 'any',
  concurrency: 2,
  // A generous lease: this capability is meant to run for a while. The
  // heartbeat keeps it alive; cancellation (not the TTL) is the normal way
  // it stops early.
  leaseTtlMs: 120_000,
  input: z.object({
    items: z.array(z.string()).min(1).max(1000),
    /** Simulated per-item work, so the progress/cancel behaviour is observable. */
    perItemMs: z.number().int().min(0).max(10_000).default(200),
  }),
  output: z.object({
    processed: z.number().int(),
    results: z.array(z.object({ item: z.string(), sha256: z.string() })),
    durationMs: z.number().int(),
  }),
});

/**
 * A `setTimeout` that rejects the moment `signal` aborts, and never leaks the
 * timer or the listener. The core pattern for making any wait cancellable.
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signalReason(signal));
  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signalReason(signal));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

function signalReason(signal: AbortSignal): Error {
  // `signal.reason` is an AbortError by default; normalise to a real Error.
  const reason = signal.reason as unknown;
  return reason instanceof Error ? reason : new DOMException('Aborted', 'AbortError');
}

async function main(): Promise<void> {
  const gatewayUrl = process.env.BIGBRAIN_GATEWAY_URL;
  const neuronId = process.env.BIGBRAIN_NEURON_ID;
  if (!gatewayUrl || !neuronId) {
    throw new Error('BIGBRAIN_GATEWAY_URL and BIGBRAIN_NEURON_ID are required.');
  }

  const neuron = new Neuron({ gatewayUrl, neuronId, auth: resolveAuth() });

  neuron.handle(batchProcess, async (input, ctx) => {
    const start = Date.now();
    const results: { item: string; sha256: string }[] = [];
    const total = input.items.length;

    for (let i = 0; i < total; i++) {
      // Cheap, synchronous check first — bail before doing any more work.
      if (ctx.signal.aborted) throw signalReason(ctx.signal);

      const item = input.items[i];
      // The abort-aware delay stands in for real per-item work (an API call,
      // a computation). Because it rejects on abort, a cancel mid-item stops
      // us within `perItemMs` rather than after the whole batch.
      if (input.perItemMs > 0) await abortableDelay(input.perItemMs, ctx.signal);
      results.push({ item, sha256: createHash('sha256').update(item).digest('hex') });

      // Report after each item. `percent` drives any progress UI; `message`
      // is free-form. Progress frames are advisory — dropping one is fine.
      ctx.progress({
        percent: Math.round(((i + 1) / total) * 100),
        message: `processed ${i + 1}/${total}`,
        data: { lastItem: item },
      });
    }

    return { processed: results.length, results, durationMs: Date.now() - start };
  });

  neuron.once('connection:registered', ({ sessionId, capabilities }) =>
    console.log(`registered ${capabilities} capability(ies) as session ${sessionId}`),
  );
  neuron.on('connection:reconnecting', ({ attempt, delayMs, reason }) =>
    console.warn(`reconnecting #${attempt} in ${delayMs}ms (${reason})`),
  );

  await neuron.start();
  console.log('neuron started; offering examples/batch.process');

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
