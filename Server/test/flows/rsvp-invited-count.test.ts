/**
 * ask_invited_count flow tests.
 *
 * When an event's ask_invited_count flag is on, the follow-up sent after a
 * guest taps the "approve" button states how many guests the invitation was
 * for (guests.number_of_guests), instead of the generic "כמה אורחים תהיו".
 * The voice-RSVP count prompt gets the same treatment.
 *
 * Prerequisites — three processes must be running before `npm test`:
 *   npm run test:db:start   — Docker Postgres on port 5433
 *   npm run test:server     — real server (with test env vars)
 *   npm run mock-wa         — mock WhatsApp server on :3001
 */

import axios from "axios";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const MOCK_PORT = 3001;
const mock = new MockWhatsAppClient(MOCK_PORT);

// ── Seed data (created by globalSetup) ───────────────────────────────────────
const TEST_EVENT_ID = 1;
const TEST_GUEST_ID = 1; // "Test Guest", number_of_guests = 1
const TEST_GUEST_PHONE = "972501234567"; // without "+"

// Dedicated multi-person invitation for the plural phrasing tests
const FAMILY_PHONE = "972509999001"; // without "+"
const FAMILY_SIZE = 4;

// ── Helpers ──────────────────────────────────────────────────────────────────

const setAskInvitedCount = (ask_invited_count: boolean) =>
  axios.patch(`${REAL_SERVER}/events/${TEST_EVENT_ID}`, { ask_invited_count }, { headers: authHeader() });

const sendRsvp = (guestId: number) =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "rsvp", eventId: TEST_EVENT_ID, guestIds: [guestId] } },
    { headers: authHeader() },
  );

const resetRsvp = (guestId: number) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId: TEST_EVENT_ID, guestId, rsvpStatus: null },
    { headers: authHeader() },
  );

const addGuest = async (name: string, phone: string, numberOfGuests: number) => {
  const { data } = await axios.patch(
    `${REAL_SERVER}/addGuests`,
    { guestsToAdd: [{ name, phone, whose: "bride", circle: "friends", number_of_guests: numberOfGuests }] },
    { headers: authHeader() },
  );
  return (data as Array<{ id: number; name: string }>).find((g) => g.name === name)!;
};

const addGuestToEvent = (guestIds: number[]) =>
  axios.post(`${REAL_SERVER}/events/${TEST_EVENT_ID}/guests`, { guestIds }, { headers: authHeader() });

const deleteGuest = (guestId: number) =>
  axios.delete(`${REAL_SERVER}/deleteGuest`, { data: { guestId }, headers: authHeader() });

const approveAndGetFollowUp = async (phone: string): Promise<string> => {
  await mock.simulateReply({ from: phone, type: "button", payload: "כן אני אגיע!" });
  const msgs = await mock.waitForMessages(`+${phone}`, 2);
  expect(msgs[1].type).toBe("text");
  return msgs[1].text!.body;
};

// Twilio posts application/x-www-form-urlencoded with eventId/guestId in the query.
const postVoiceAnswer = (guestId: number, digits: string) =>
  axios.post(
    `${REAL_SERVER}/voice/answer?eventId=${TEST_EVENT_ID}&guestId=${guestId}`,
    new URLSearchParams({ Digits: digits }).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

// ─────────────────────────────────────────────────────────────────────────────

let familyGuestId: number;

beforeAll(async () => {
  const familyGuest = await addGuest("Family Guest", `+${FAMILY_PHONE}`, FAMILY_SIZE);
  familyGuestId = familyGuest.id;
  await addGuestToEvent([familyGuestId]);
});

afterAll(async () => {
  await setAskInvitedCount(false);
  await resetRsvp(TEST_GUEST_ID);
  await deleteGuest(familyGuestId);
});

beforeEach(async () => {
  await mock.reset();
  await resetRsvp(TEST_GUEST_ID);
  await resetRsvp(familyGuestId);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("WhatsApp approve follow-up with ask_invited_count on", () => {
  it("states the invited count for a multi-person invitation", async () => {
    await setAskInvitedCount(true);
    await sendRsvp(familyGuestId);
    await mock.waitForMessages(`+${FAMILY_PHONE}`, 1);

    const followUp = await approveAndGetFollowUp(FAMILY_PHONE);
    expect(followUp).toContain(`ההזמנה שלכם היא ל-${FAMILY_SIZE} אורחים`);
    expect(followUp).toContain("כמה אורחים תגיעו");
  });

  it("uses the singular phrasing for a single-person invitation", async () => {
    await setAskInvitedCount(true);
    await sendRsvp(TEST_GUEST_ID);
    await mock.waitForMessages(`+${TEST_GUEST_PHONE}`, 1);

    const followUp = await approveAndGetFollowUp(TEST_GUEST_PHONE);
    expect(followUp).toContain("ההזמנה שלכם היא לאורח אחד");
    expect(followUp).not.toContain("ל-1");
  });

  it("the count-stating follow-up still leads to a stored RSVP count", async () => {
    await setAskInvitedCount(true);
    await sendRsvp(familyGuestId);
    await mock.waitForMessages(`+${FAMILY_PHONE}`, 1);
    await approveAndGetFollowUp(FAMILY_PHONE);

    await mock.simulateReply({ from: FAMILY_PHONE, type: "text", payload: "3" });
    await mock.waitForMessages(`+${FAMILY_PHONE}`, 3);

    const { data } = await axios.get(`${REAL_SERVER}/events/${TEST_EVENT_ID}/guests`, {
      headers: authHeader(),
    });
    const guest = data.find((g: { guest_id: number }) => g.guest_id === familyGuestId);
    expect(guest?.rsvp_status).toBe(3);
  });
});

describe("WhatsApp approve follow-up with ask_invited_count off", () => {
  it("keeps the generic follow-up", async () => {
    await setAskInvitedCount(false);
    await sendRsvp(familyGuestId);
    await mock.waitForMessages(`+${FAMILY_PHONE}`, 1);

    const followUp = await approveAndGetFollowUp(FAMILY_PHONE);
    expect(followUp).toContain("כמה אורחים תהיו");
    expect(followUp).not.toContain("ההזמנה שלכם");
  });
});

describe("Voice RSVP count prompt", () => {
  it("states the invited count when the flag is on", async () => {
    await setAskInvitedCount(true);
    const { data } = await postVoiceAnswer(familyGuestId, "1");
    expect(String(data)).toContain(`ההזמנה שלכם היא ל-${FAMILY_SIZE} אורחים`);
  });

  it("uses the singular phrasing for a single-person invitation", async () => {
    await setAskInvitedCount(true);
    const { data } = await postVoiceAnswer(TEST_GUEST_ID, "1");
    expect(String(data)).toContain("ההזמנה שלכם היא לאורח אחד");
  });

  it("keeps the generic prompt when the flag is off", async () => {
    await setAskInvitedCount(false);
    const { data } = await postVoiceAnswer(familyGuestId, "1");
    const xml = String(data);
    expect(xml).toContain("כמה אורחים תגיעו");
    expect(xml).not.toContain("ההזמנה שלכם");
  });
});
