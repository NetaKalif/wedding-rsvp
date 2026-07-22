/**
 * Full RSVP flow tests.
 *
 * Prerequisites — three processes must be running before `npm test`:
 *   npm run test:db:start   — Docker Postgres on port 5433
 *   npm run test:server     — real server on port 8080 (with test env vars)
 *   npm run mock-wa         — mock WhatsApp server on port 3001
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const MOCK_PORT = 3001;
const mock = new MockWhatsAppClient(MOCK_PORT);

// ── Seed data (created by globalSetup) ───────────────────────────────────────
const TEST_EVENT_ID = 1;
const TEST_GUEST_ID = 1;
const TEST_GUEST_PHONE = "972501234567"; // without "+"

// ── Helpers ──────────────────────────────────────────────────────────────────

const sendRsvp = () =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "rsvp", eventId: TEST_EVENT_ID, guestIds: [TEST_GUEST_ID] } },
    { headers: authHeader() },
  );

const getGuest = async () => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${TEST_EVENT_ID}/guests`, {
    headers: authHeader(),
  });
  return data.find((g: { guest_id: number }) => g.guest_id === TEST_GUEST_ID);
};

const resetRsvp = (rsvpStatus: number | null) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId: TEST_EVENT_ID, guestId: TEST_GUEST_ID, rsvpStatus },
    { headers: authHeader() },
  );

const addGuest = async (name: string, phone: string | null) => {
  const { data } = await axios.patch(
    `${REAL_SERVER}/addGuests`,
    { guestsToAdd: [{ name, phone, whose: "bride", circle: "friends", number_of_guests: 1 }] },
    { headers: authHeader() },
  );
  return (data as Array<{ id: number; name: string }>).find((g) => g.name === name)!;
};

const addGuestToEvent = (eventId: number, guestIds: number[]) =>
  axios.post(`${REAL_SERVER}/events/${eventId}/guests`, { guestIds }, { headers: authHeader() });

const deleteGuest = (guestId: number) =>
  axios.delete(`${REAL_SERVER}/deleteGuest`, { data: { guestId }, headers: authHeader() });

// ─────────────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await mock.reset();
  await resetRsvp(null);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("RSVP approve flow", () => {
  it("sends RSVP template, guest approves, sends count, DB is updated", async () => {
    await sendRsvp();

    const [inviteMsg] = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);
    expect(inviteMsg.type).toBe("template");
    expect(inviteMsg.template?.name).toBe("wedding_rsvp_action");

    await mock.simulateReply({ from: TEST_GUEST_PHONE, type: "button", payload: "כן אני אגיע!" });

    const msgs = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 2);
    expect(msgs[1].type).toBe("text");
    expect(msgs[1].text?.body).toContain("כמה אורחים");

    await mock.simulateReply({ from: TEST_GUEST_PHONE, type: "text", payload: "3" });

    const msgsAfterCount = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 3);
    expect(msgsAfterCount[2].type).toBe("text");
    expect(msgsAfterCount[2].text?.body).toContain("תודה רבה");

    const guest = await getGuest();
    expect(guest?.rsvp_status).toBe(3);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("RSVP decline flow", () => {
  it("guest declines, DB is updated to 0", async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);

    await mock.simulateReply({ from: TEST_GUEST_PHONE, type: "button", payload: "לצערי לא" });

    const msgs = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 2);
    expect(msgs[1].type).toBe("text");
    expect(msgs[1].text?.body).toContain("לא נורא");

    const guest = await getGuest();
    expect(guest?.rsvp_status).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("RSVP pending flow", () => {
  it('guest clicks "עדיין לא יודע/ת", server replies and rsvp stays null', async () => {
    await sendRsvp();
    await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);

    await mock.simulateReply({ from: TEST_GUEST_PHONE, type: "button", payload: "עדיין לא יודע/ת" });

    const msgs = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 2);
    expect(msgs[1].type).toBe("text");
    expect(msgs[1].text?.body).toContain("אין בעיה");

    const guest = await getGuest();
    expect(guest?.rsvp_status).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("RSVP mistake correction", () => {
  it('guest sends "טעות", RSVP is reset to null', async () => {
    await resetRsvp(2);

    await mock.simulateReply({ from: TEST_GUEST_PHONE, type: "text", payload: "טעות" });

    await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);

    const guest = await getGuest();
    expect(guest?.rsvp_status).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Guests without a phone are excluded from sends", () => {
  it("/sendMessage only sends to the guest that has a phone", async () => {
    const noPhoneGuest = await addGuest("NoPhone Guest", null);
    try {
      await addGuestToEvent(TEST_EVENT_ID, [noPhoneGuest.id]);

      const { data } = await axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { messageType: "rsvp", eventId: TEST_EVENT_ID, guestIds: [TEST_GUEST_ID, noPhoneGuest.id] } },
        { headers: authHeader() },
      );

      expect(data.success).toBe(1);
      expect(data.fail).toBe(0);

      const msgs = await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);
      expect(msgs).toHaveLength(1);
    } finally {
      await deleteGuest(noPhoneGuest.id);
    }
  });
});
