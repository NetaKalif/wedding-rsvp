/**
 * Multi-event RSVP tests.
 * Verifies that RSVP sends, replies, and statuses are correctly scoped per event.
 *
 * Seed (from globalSetup):
 *   Wedding (id=1, primary)  ←  Alice, Bob, Clare, BasicGuest
 *   Henna   (id=2)           ←  Alice, Bob
 *
 *   Alice  id=2  phone=+972501111111
 *   Bob    id=3  phone=+972502222222
 *   Clare  id=4  phone=+972503333333
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const USER_ID = "test-user-id";
const WEDDING_EVENT_ID = 1;
const HENNA_EVENT_ID = 2;
const ALICE_ID = 2;
const BOB_ID = 3;
const CLARE_ID = 4;
const ALICE_PHONE = "972501111111";
const BOB_PHONE = "972502222222";
const CLARE_PHONE = "972503333333";

// ── Helpers ──────────────────────────────────────────────────────────────────

const sendRsvpToEvent = (eventId: number, guestIds?: number[]) =>
  axios.post(`${REAL_SERVER}/sendMessage`, {
    userID: USER_ID,
    options: { messageType: "rsvp", eventId, ...(guestIds ? { guestIds } : {}) },
  });

const getEventGuests = async (eventId: number) => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${eventId}/guests`, {
    params: { userID: USER_ID },
  });
  return data as Array<{ guest_id: number; rsvp_status: number | null }>;
};

const getRsvp = async (eventId: number, guestId: number) => {
  const guests = await getEventGuests(eventId);
  return guests.find((g) => g.guest_id === guestId)?.rsvp_status ?? undefined;
};

const setRsvp = (eventId: number, guestId: number, rsvpStatus: number | null) =>
  axios.post(`${REAL_SERVER}/updateRsvp`, {
    userID: USER_ID,
    eventId,
    guestId,
    rsvpStatus,
  });

// ── Setup / teardown ─────────────────────────────────────────────────────────

beforeEach(async () => {
  await mock.reset();
  // Clear all RSVPs for multi-event guests
  for (const [eventId, guestId] of [
    [WEDDING_EVENT_ID, ALICE_ID],
    [WEDDING_EVENT_ID, BOB_ID],
    [WEDDING_EVENT_ID, CLARE_ID],
    [HENNA_EVENT_ID, ALICE_ID],
    [HENNA_EVENT_ID, BOB_ID],
  ]) {
    await setRsvp(eventId, guestId, null);
  }
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Sending to a specific event only reaches that event's guests", () => {
  it("sending to all henna guests reaches Alice and Bob, not Clare", async () => {
    await sendRsvpToEvent(HENNA_EVENT_ID);

    // Alice and Bob should each receive one RSVP template
    await mock.waitForMessages(`+${ALICE_PHONE}`, 1);
    await mock.waitForMessages(`+${BOB_PHONE}`, 1);

    // Clare is not in the henna event — no messages
    const clareMessages = await mock.getMessages({ to: `+${CLARE_PHONE}` });
    expect(clareMessages).toHaveLength(0);
  });

  it("sending to only Alice in henna does not reach Bob or Clare", async () => {
    await sendRsvpToEvent(HENNA_EVENT_ID, [ALICE_ID]);

    await mock.waitForMessages(`+${ALICE_PHONE}`, 1);

    const bobMessages = await mock.getMessages({ to: `+${BOB_PHONE}` });
    const clareMessages = await mock.getMessages({ to: `+${CLARE_PHONE}` });
    expect(bobMessages).toHaveLength(0);
    expect(clareMessages).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Replying to a wedding RSVP does not overwrite an existing henna RSVP", () => {
  it("Alice replies 3 to the wedding RSVP while henna RSVP stays at 2", async () => {
    // Step 1: Actually send the henna RSVP — this sets henna lastRsvpSentAt to T1
    await sendRsvpToEvent(HENNA_EVENT_ID, [ALICE_ID]);
    await mock.waitForMessages(`+${ALICE_PHONE}`, 1);

    // Step 2: Alice completes the henna flow with 2 guests
    await mock.simulateReply({ from: ALICE_PHONE, type: "button", payload: "כן אני אגיע!" });
    await mock.waitForMessages(`+${ALICE_PHONE}`, 2);
    await mock.simulateReply({ from: ALICE_PHONE, type: "text", payload: "2" });
    await mock.waitForMessages(`+${ALICE_PHONE}`, 3);

    expect(await getRsvp(HENNA_EVENT_ID, ALICE_ID)).toBe(2);

    // Step 3: Clear the mock so we can track only the wedding messages
    await mock.reset();

    // Step 4: Send wedding RSVP to Alice — sets wedding lastRsvpSentAt to T2 > T1,
    // so Alice's next reply is routed to the wedding event, not henna.
    await sendRsvpToEvent(WEDDING_EVENT_ID, [ALICE_ID]);
    await mock.waitForMessages(`+${ALICE_PHONE}`, 1);

    // Step 5: Alice approves the wedding with 3 guests
    await mock.simulateReply({ from: ALICE_PHONE, type: "button", payload: "כן אני אגיע!" });
    await mock.waitForMessages(`+${ALICE_PHONE}`, 2);
    await mock.simulateReply({ from: ALICE_PHONE, type: "text", payload: "3" });
    await mock.waitForMessages(`+${ALICE_PHONE}`, 3);

    // Wedding updated to 3, henna untouched at 2
    expect(await getRsvp(WEDDING_EVENT_ID, ALICE_ID)).toBe(3);
    expect(await getRsvp(HENNA_EVENT_ID, ALICE_ID)).toBe(2);
  });
});
