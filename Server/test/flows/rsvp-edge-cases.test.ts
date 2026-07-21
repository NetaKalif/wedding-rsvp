/**
 * RSVP webhook edge cases.
 * Tests unusual guest reply scenarios that fall outside the happy paths.
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const EVENT_ID = 1;
const GUEST_ID = 1;
const GUEST_PHONE = "972501234567";

const sendRsvp = () =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "rsvp", eventId: EVENT_ID, guestIds: [GUEST_ID] } },
    { headers: authHeader() },
  );

const getGuest = async () => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${EVENT_ID}/guests`, {
    headers: authHeader(),
  });
  return (data as Array<{ guest_id: number; rsvp_status: number | null }>).find(
    (g) => g.guest_id === GUEST_ID,
  );
};

const resetRsvp = (status: number | null = null) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId: EVENT_ID, guestId: GUEST_ID, rsvpStatus: status },
    { headers: authHeader() },
  );

beforeEach(async () => {
  await mock.reset();
  await resetRsvp(null);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Invalid text response", () => {
  it("random text reply → server sends unknownResponse, rsvp stays null", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "אולי" });

    const msgs = await mock.waitForMessages(`+${GUEST_PHONE}`, 2);
    expect(msgs[1].text?.body).toContain("לא הבנתי");

    expect((await getGuest())?.rsvp_status).toBeNull();
  });

  it("number out of range (>10) → server sends unknownResponse, rsvp stays null", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "99" });

    const msgs = await mock.waitForMessages(`+${GUEST_PHONE}`, 2);
    expect(msgs[1].text?.body).toContain("לא הבנתי");

    expect((await getGuest())?.rsvp_status).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Guest sends 0", () => {
  it("sending 0 is treated as a decline → rsvp=0, declined message", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    // Guest clicks approve to unlock free-text, then sends 0
    await mock.simulateReply({ from: GUEST_PHONE, type: "button", payload: "כן אני אגיע!" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 2);

    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "0" });

    const msgs = await mock.waitForMessages(`+${GUEST_PHONE}`, 3);
    expect(msgs[2].text?.body).toContain("לא נורא");

    expect((await getGuest())?.rsvp_status).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Guest changes RSVP", () => {
  it("guest approved with 3, later sends 2 → rsvp updates to 2", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    await mock.simulateReply({ from: GUEST_PHONE, type: "button", payload: "כן אני אגיע!" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 2);

    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "3" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 3);

    expect((await getGuest())?.rsvp_status).toBe(3);

    // Guest sends a new count without a new template — lastRsvpSentAt is still set
    await mock.reset();
    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "2" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    expect((await getGuest())?.rsvp_status).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Unknown phone replies", () => {
  it("reply from a phone not in the DB is silently ignored — no message sent", async () => {
    await mock.simulateReply({ from: "972599999999", type: "button", payload: "כן אני אגיע!" });

    // Give the server a moment to react (it should do nothing)
    await new Promise((r) => setTimeout(r, 300));

    const msgs = await mock.getMessages();
    expect(msgs).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Pending guest later sends count without a new template", () => {
  it("guest clicked pending, later texts a number → rsvp is saved", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    // Guest is not sure yet
    await mock.simulateReply({ from: GUEST_PHONE, type: "button", payload: "עדיין לא יודע/ת" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 2);

    expect((await getGuest())?.rsvp_status).toBeNull();

    // Later, guest texts a count directly (lastRsvpSentAt is still set from the template)
    await mock.reset();
    await mock.simulateReply({ from: GUEST_PHONE, type: "text", payload: "4" });
    await mock.waitForMessages(`+${GUEST_PHONE}`, 1);

    expect((await getGuest())?.rsvp_status).toBe(4);
  });
});
