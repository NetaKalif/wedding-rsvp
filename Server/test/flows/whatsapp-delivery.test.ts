/**
 * WhatsApp delivery reliability:
 *  1. runPaced — the bulk-dispatch queue caps concurrency and paces sends so
 *     Meta's throughput limits aren't tripped (200 OK ≠ delivered).
 *  2. sendWhatsAppMessage retries rate-limited (429 / code 130429) sends with
 *     backoff instead of reporting them as plain failures.
 *  3. The /sms webhook processes `statuses` payloads: a "failed" delivery
 *     status is surfaced in the owner's activity log with the Meta error code.
 *
 * Seed (from globalSetup):
 *   Wedding (id=1, primary) ← Test Guest, Alice, Bob, Clare
 *   Alice id=2 phone=+972501111111
 *   Bob   id=3 phone=+972502222222
 *   Clare id=4 phone=+972503333333
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";
import { runPaced } from "../../src/sendQueue";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const WEDDING_EVENT_ID = 1;
const BOB_ID = 3;
const CLARE_ID = 4;
const ALICE_PHONE = "+972501111111";
const BOB_PHONE = "+972502222222";
const CLARE_PHONE = "+972503333333";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const sendFreeText = (guestIds: number[], customText = "test message") =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "freeText", eventId: WEDDING_EVENT_ID, guestIds, customText } },
    { headers: authHeader() },
  );

const getLogs = async (): Promise<Array<{ message: string }>> => {
  const res = await axios.get(`${REAL_SERVER}/logs`, { headers: authHeader() });
  return res.data;
};

const postStatusWebhook = (statuses: unknown[]) =>
  axios.post(`${REAL_SERVER}/sms`, {
    entry: [{ changes: [{ value: { statuses } }] }],
  });

beforeEach(async () => {
  await mock.reset();
});

describe("runPaced bulk-dispatch queue", () => {
  it("never runs more tasks at once than the concurrency cap", async () => {
    let active = 0;
    let maxActive = 0;
    const tasks = Array.from({ length: 12 }, (_, i) => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(20);
      active--;
      return i;
    });

    await runPaced(tasks, { concurrency: 3, delayMs: 0 });

    expect(maxActive).toBeLessThanOrEqual(3);
  });

  it("returns results in input order even when tasks finish out of order", async () => {
    const tasks = [50, 10, 30].map((ms, i) => async () => {
      await sleep(ms);
      return i;
    });

    const results = await runPaced(tasks, { concurrency: 3, delayMs: 0 });

    expect(results).toEqual([0, 1, 2]);
  });

  it("waits delayMs between dispatches on the same worker", async () => {
    const start = Date.now();
    const tasks = Array.from({ length: 3 }, (_, i) => async () => i);

    await runPaced(tasks, { concurrency: 1, delayMs: 60 });

    // 3 sequential tasks → 2 inter-dispatch delays
    expect(Date.now() - start).toBeGreaterThanOrEqual(110);
  });
});

describe("rate-limited sends are retried with backoff", () => {
  it("delivers after a transient 429 and reports the send as successful", async () => {
    await mock.throttle(BOB_PHONE, 1);

    const res = await sendFreeText([BOB_ID], "retry me");

    expect(res.data.success).toBe(1);
    expect(res.data.fail).toBe(0);
    // The retry (after ~1s backoff) is the only message that got stored
    const msgs = await mock.waitForMessages(BOB_PHONE, 1, 6000);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text?.body).toBe("retry me");
  }, 15000);

  it("reports a failure once the rate-limit retries are exhausted", async () => {
    // More consecutive 429s than configured retries (default: 2)
    await mock.throttle(CLARE_PHONE, 5);

    const res = await sendFreeText([CLARE_ID]);

    expect(res.data.success).toBe(0);
    expect(res.data.fail).toBe(1);
    expect(res.data.failGuestsList[0].guestName).toBe("Clare");
    expect(await mock.getMessages({ to: CLARE_PHONE })).toHaveLength(0);
  }, 15000);
});

describe("delivery-status webhook", () => {
  it("logs a failed delivery to the owner's activity log with the Meta error code", async () => {
    const res = await postStatusWebhook([
      {
        id: "wamid.test-failed-1",
        status: "failed",
        timestamp: "1700000000",
        recipient_id: ALICE_PHONE.slice(1), // Meta sends the number without '+'
        errors: [
          {
            code: 131026,
            title: "Message undeliverable",
            error_data: { details: "Message could not be delivered." },
          },
        ],
      },
    ]);

    expect(res.status).toBe(200);
    const logs = await getLogs();
    const failureLog = logs.find((l) => l.message.includes("131026"));
    expect(failureLog).toBeDefined();
    expect(failureLog!.message).toContain("Alice");
    expect(failureLog!.message).toContain(ALICE_PHONE);
    expect(failureLog!.message).toContain("Message could not be delivered.");
  });

  it("acknowledges statuses for unknown recipients without logging to any user", async () => {
    const before = (await getLogs()).length;

    const res = await postStatusWebhook([
      {
        status: "failed",
        recipient_id: "972500000000",
        errors: [{ code: 131026, title: "Message undeliverable" }],
      },
    ]);

    expect(res.status).toBe(200);
    expect((await getLogs()).length).toBe(before);
  });

  it("ignores non-failure statuses (sent/delivered/read) instead of spamming the log", async () => {
    const before = (await getLogs()).length;

    const res = await postStatusWebhook([
      { status: "sent", recipient_id: ALICE_PHONE.slice(1) },
      { status: "delivered", recipient_id: ALICE_PHONE.slice(1) },
      { status: "read", recipient_id: ALICE_PHONE.slice(1) },
    ]);

    expect(res.status).toBe(200);
    expect((await getLogs()).length).toBe(before);
  });
});
