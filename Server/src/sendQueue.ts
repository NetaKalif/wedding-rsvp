// Paced task runner for bulk WhatsApp dispatch.
//
// Meta's Cloud API accepts bursts with 200 OK but silently throttles delivery
// when messages are fired too fast (the API response only means "accepted",
// not "delivered"). Bulk sends therefore go through this queue instead of a
// bare Promise.all: a fixed number of workers pull tasks off a shared list,
// and each worker waits WA_SEND_DELAY_MS between its own dispatches, capping
// throughput at roughly concurrency / (delay in seconds) messages per second.

export interface PacingOptions {
  concurrency?: number;
  delayMs?: number;
}

// ~4 workers × one message per 250ms ≈ 16 msg/sec — well under Meta's lowest
// throughput tier (80 msg/sec) while still clearing a 250-guest batch in ~16s.
const DEFAULT_CONCURRENCY = Number(process.env.WA_SEND_CONCURRENCY ?? 4);
const DEFAULT_DELAY_MS = Number(process.env.WA_SEND_DELAY_MS ?? 250);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Runs `tasks` with bounded concurrency and a per-worker delay between
 * dispatches. Results are returned in the same order as `tasks`, so callers
 * can zip them back to their inputs. Tasks must not reject (the WhatsApp
 * sender resolves failures into MessageResult objects); a rejection here
 * propagates and aborts the batch.
 */
export const runPaced = async <T>(
  tasks: Array<() => Promise<T>>,
  options: PacingOptions = {},
): Promise<T[]> => {
  const concurrency = Math.max(1, options.concurrency ?? DEFAULT_CONCURRENCY);
  const delayMs = Math.max(0, options.delayMs ?? DEFAULT_DELAY_MS);

  const results: T[] = new Array(tasks.length);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < tasks.length) {
      const index = nextIndex++;
      results[index] = await tasks[index]();
      if (delayMs > 0 && nextIndex < tasks.length) await sleep(delayMs);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );

  return results;
};
