/**
 * Event reminder (same-day) tests.
 * Verifies the eventReminder message type sends the event_reminder_same_day
 * template to confirmed guests on a non-primary event.
 *
 * Seed (from globalSetup):
 *   Henna (id=2, non-primary) ← Alice, Bob
 *   Alice  id=2  phone=+972501111111
 *   Bob    id=3  phone=+972502222222
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const HENNA_EVENT_ID = 2;
const ALICE_ID = 2;
const BOB_ID = 3;
const ALICE_PHONE = "972501111111";
const BOB_PHONE = "972502222222";

const setRsvp = (eventId: number, guestId: number, rsvpStatus: number | null) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId, guestId, rsvpStatus },
    { headers: authHeader() },
  );

const sendEventReminder = (eventId: number, guestIds?: number[]) =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "eventReminder", eventId, ...(guestIds ? { guestIds } : {}) } },
    { headers: authHeader() },
  );

beforeEach(async () => {
  await mock.reset();
  await setRsvp(HENNA_EVENT_ID, ALICE_ID, null);
  await setRsvp(HENNA_EVENT_ID, BOB_ID, null);
});

describe("eventReminder sends event_reminder_same_day template", () => {
  it("sends the template to confirmed guests", async () => {
    await setRsvp(HENNA_EVENT_ID, ALICE_ID, 2);

    await sendEventReminder(HENNA_EVENT_ID, [ALICE_ID]);

    const messages = await mock.waitForMessages(`+${ALICE_PHONE}`, 1);
    expect(messages[0].template?.name).toBe("event_reminder_same_day");
  });

  it("sends to all specified guests", async () => {
    await setRsvp(HENNA_EVENT_ID, ALICE_ID, 3);
    await setRsvp(HENNA_EVENT_ID, BOB_ID, 1);

    await sendEventReminder(HENNA_EVENT_ID);

    const aliceMessages = await mock.waitForMessages(`+${ALICE_PHONE}`, 1);
    const bobMessages = await mock.waitForMessages(`+${BOB_PHONE}`, 1);
    expect(aliceMessages[0].template?.name).toBe("event_reminder_same_day");
    expect(bobMessages[0].template?.name).toBe("event_reminder_same_day");
  });
});
