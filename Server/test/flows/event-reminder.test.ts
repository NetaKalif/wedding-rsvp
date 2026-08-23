/**
 * Unified event reminder template tests.
 * A single eventReminder message type sends the event_reminder template to
 * primary and non-primary events alike; the day wording comes from
 * reminder_day and the optional waze/payment links are folded into the
 * additional_data param.
 *
 * Seed (from globalSetup):
 *   Wedding (id=1, primary, "חתונה", bride=כלה groom=חתן) ← Test Guest, Alice, Bob, Clare
 *   Henna (id=2, non-primary, "חינה") ← Alice, Bob
 *   Test Guest id=1 phone=+972501234567
 *   Alice      id=2 phone=+972501111111
 *   Bob        id=3 phone=+972502222222
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";
import type { StoredMessage } from "../mock-whatsapp/server";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const WEDDING_EVENT_ID = 1;
const HENNA_EVENT_ID = 2;
const TEST_GUEST_ID = 1;
const ALICE_ID = 2;
const BOB_ID = 3;
const TEST_GUEST_PHONE = "972501234567";
const ALICE_PHONE = "972501111111";
const BOB_PHONE = "972502222222";

const WAZE_LINK = "https://waze.com/ul/test";
const GIFT_LINK = "https://pay.example.com/gift";

const setRsvp = (eventId: number, guestId: number, rsvpStatus: number | null) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId, guestId, rsvpStatus },
    { headers: authHeader() },
  );

const patchEvent = (eventId: number, updates: Record<string, unknown>) =>
  axios.patch(`${REAL_SERVER}/events/${eventId}`, updates, { headers: authHeader() });

const sendReminder = (messageType: "eventReminder", eventId: number, guestIds: number[]) =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType, eventId, guestIds } },
    { headers: authHeader() },
  );

/** Extracts the template body params as { parameter_name: text }. */
const bodyParams = (msg: StoredMessage): Record<string, string> => {
  const body = (msg.template?.components as any[]).find((c) => c.type === "body");
  return Object.fromEntries(body.parameters.map((p: any) => [p.parameter_name, p.text]));
};

beforeEach(async () => {
  await mock.reset();
  await setRsvp(HENNA_EVENT_ID, ALICE_ID, null);
  await setRsvp(HENNA_EVENT_ID, BOB_ID, null);
  await setRsvp(WEDDING_EVENT_ID, TEST_GUEST_ID, null);
});

afterAll(async () => {
  // Restore seed state so other suites aren't affected
  await patchEvent(HENNA_EVENT_ID, { waze_link: null, gift_link: null });
  await patchEvent(WEDDING_EVENT_ID, { waze_link: null, gift_link: null, reminder_day: null });
});

describe("eventReminder sends the unified event_reminder template", () => {
  it("sends same-day wording with the event details and no links block when none are set", async () => {
    await patchEvent(HENNA_EVENT_ID, { waze_link: null, gift_link: null });
    await setRsvp(HENNA_EVENT_ID, ALICE_ID, 2);

    await sendReminder("eventReminder", HENNA_EVENT_ID, [ALICE_ID]);

    const [msg] = await mock.waitForMessages(`+${ALICE_PHONE}`, 1);
    expect(msg.template?.name).toBe("event_reminder");
    const params = bodyParams(msg);
    expect(params.day).toBe("היום");
    expect(params.ceremony_name).toBe("חינה");
    expect(params.couple_names).toBe("כלה וחתן");
    // No links → single-space placeholder (WhatsApp rejects empty params)
    expect(params.additional_data).toBe(" ");
  });

  it("includes waze and payment links in additional_data without newlines", async () => {
    await patchEvent(HENNA_EVENT_ID, { waze_link: WAZE_LINK, gift_link: GIFT_LINK });
    await setRsvp(HENNA_EVENT_ID, BOB_ID, 1);

    await sendReminder("eventReminder", HENNA_EVENT_ID, [BOB_ID]);

    const [msg] = await mock.waitForMessages(`+${BOB_PHONE}`, 1);
    expect(msg.template?.name).toBe("event_reminder");
    const params = bodyParams(msg);
    expect(params.additional_data).toContain(WAZE_LINK);
    expect(params.additional_data).toContain(GIFT_LINK);
    expect(params.additional_data).not.toContain("\n");
  });

  it("includes only the waze link when there is no payment link", async () => {
    await patchEvent(HENNA_EVENT_ID, { waze_link: WAZE_LINK, gift_link: null });
    await setRsvp(HENNA_EVENT_ID, ALICE_ID, 2);

    await sendReminder("eventReminder", HENNA_EVENT_ID, [ALICE_ID]);

    const [msg] = await mock.waitForMessages(`+${ALICE_PHONE}`, 1);
    const params = bodyParams(msg);
    expect(params.additional_data).toContain(WAZE_LINK);
    expect(params.additional_data).not.toContain(GIFT_LINK);
  });
});

describe("eventReminder on the primary event (wedding)", () => {
  it("uses day-before wording when reminder_day is day_before", async () => {
    await patchEvent(WEDDING_EVENT_ID, { reminder_day: "day_before", waze_link: WAZE_LINK, gift_link: null });
    await setRsvp(WEDDING_EVENT_ID, TEST_GUEST_ID, 2);

    await sendReminder("eventReminder", WEDDING_EVENT_ID, [TEST_GUEST_ID]);

    const [msg] = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);
    expect(msg.template?.name).toBe("event_reminder");
    const params = bodyParams(msg);
    expect(params.day).toBe("מחר");
    expect(params.ceremony_name).toBe("חתונה");
    expect(params.additional_data).toContain(WAZE_LINK);
  });

  it("uses same-day wording when reminder_day is wedding_day", async () => {
    await patchEvent(WEDDING_EVENT_ID, { reminder_day: "wedding_day" });
    await setRsvp(WEDDING_EVENT_ID, TEST_GUEST_ID, 1);

    await sendReminder("eventReminder", WEDDING_EVENT_ID, [TEST_GUEST_ID]);

    const [msg] = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);
    expect(msg.template?.name).toBe("event_reminder");
    expect(bodyParams(msg).day).toBe("היום");
  });
});
