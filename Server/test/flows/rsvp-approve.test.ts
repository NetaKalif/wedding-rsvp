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

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const MOCK_PORT = 3001;
const mock = new MockWhatsAppClient(MOCK_PORT);

// ── Seed data (created by globalSetup) ───────────────────────────────────────
const TEST_USER_ID = "test-user-id";
const TEST_EVENT_ID = 1;
const TEST_GUEST_ID = 1;
const TEST_GUEST_PHONE = "972501234567"; // without "+"

// ── Helpers ──────────────────────────────────────────────────────────────────

const sendRsvp = () =>
  axios.post(`${REAL_SERVER}/sendMessage`, {
    userID: TEST_USER_ID,
    options: { messageType: "rsvp", eventId: TEST_EVENT_ID, guestIds: [TEST_GUEST_ID] },
  });

const getGuest = async () => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${TEST_EVENT_ID}/guests`, {
    params: { userID: TEST_USER_ID },
  });
  return data.find((g: { guest_id: number }) => g.guest_id === TEST_GUEST_ID);
};

const resetRsvp = (rsvpStatus: number | null) =>
  axios.post(`${REAL_SERVER}/updateRsvp`, {
    userID: TEST_USER_ID,
    eventId: TEST_EVENT_ID,
    guestId: TEST_GUEST_ID,
    rsvpStatus,
  });

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
