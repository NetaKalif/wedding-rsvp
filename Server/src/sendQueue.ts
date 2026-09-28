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
  /** Called after each task resolves — drives send-progress reporting. */
  onResult?: (result: unknown) => void;
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
      // Safe without locking: the check and the claim run in one synchronous
      // block — workers can only interleave at the awaits below.
      const index = nextIndex++;
      results[index] = await tasks[index]();
      options.onResult?.(results[index]);
      if (delayMs > 0 && nextIndex < tasks.length) await sleep(delayMs);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );

  return results;
};

// ============================================================================
// Send-job progress registry
// ============================================================================
// One live send job per data owner, kept in memory — like the queue itself:
// if the process dies the send dies with it, so persisting would be
// meaningless. The client polls GET /sendProgress to draw a progress bar.
// A job lingers for a grace window after dispatch finishes so delivery
// failures reported by the statuses webhook (most arrive within seconds of
// the send) can be attached to the same send session and shown in the UI.

export interface DeliveryFailure {
  guestName: string;
  phone: string;
  description: string;
}

export interface SendJob {
  label: string;
  total: number;
  completed: number;
  failed: number;
  dispatchDone: boolean;
  finishedAt: number | null;
  /** phone → guest name, for matching webhook delivery failures to this send */
  recipients: Map<string, string>;
  deliveryFailures: DeliveryFailure[];
}

const SEND_JOB_GRACE_MS = Number(process.env.WA_SEND_JOB_GRACE_MS ?? 30_000);

const sendJobs = new Map<string, SendJob>();

const isJobExpired = (job: SendJob): boolean =>
  job.dispatchDone && job.finishedAt !== null && Date.now() - job.finishedAt > SEND_JOB_GRACE_MS;

/**
 * Registers a new send job for a data owner. Returns null if a dispatch is
 * already running for that owner — the caller should reject the send, which
 * also guards against a double-clicked bulk send going out twice.
 */
export const startSendJob = (
  ownerID: string,
  label: string,
  recipients: Array<{ phone: string; name: string }>,
): SendJob | null => {
  const existing = sendJobs.get(ownerID);
  if (existing && !existing.dispatchDone) return null;
  const job: SendJob = {
    label,
    total: recipients.length,
    completed: 0,
    failed: 0,
    dispatchDone: false,
    finishedAt: null,
    recipients: new Map(recipients.map((r) => [r.phone, r.name])),
    deliveryFailures: [],
  };
  sendJobs.set(ownerID, job);
  return job;
};

/** Marks dispatch as finished; the job stays readable for the grace window. */
export const finishSendJob = (job: SendJob): void => {
  job.dispatchDone = true;
  job.finishedAt = Date.now();
};

/** Returns the owner's live job (still dispatching or within the grace window). */
export const getSendJob = (ownerID: string): SendJob | null => {
  const job = sendJobs.get(ownerID);
  if (!job) return null;
  if (isJobExpired(job)) {
    sendJobs.delete(ownerID);
    return null;
  }
  return job;
};

/**
 * Attaches a webhook-reported delivery failure to whichever live job sent to
 * this phone, so the client polling that job sees it in the same session.
 * A phone that matches no live job is simply ignored here (it's still logged
 * to the activity log by the webhook handler).
 */
export const recordDeliveryFailure = (phone: string, description: string): void => {
  for (const [ownerID, job] of sendJobs) {
    if (isJobExpired(job)) {
      sendJobs.delete(ownerID);
      continue;
    }
    const guestName = job.recipients.get(phone);
    if (guestName !== undefined) {
      job.deliveryFailures.push({ guestName, phone, description });
    }
  }
};
