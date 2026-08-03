/**
 * Voice RSVP (Twilio IVR) tests.
 *
 * Drives the public /voice/* webhooks the way Twilio does — POSTing form-encoded
 * `Digits` with eventId/guestId in the query string — and asserts both the TwiML
 * returned and the resulting rsvp_status written via the same path as WhatsApp
 * (null = pending, 0 = declined, N = attending count).
 *
 * The test server runs with TWILIO_VALIDATE_SIGNATURE=false (set in
 * start-test-server.sh), so the X-Twilio-Signature guard is bypassed here.
 * Twilio credentials are unset, so the outbound trigger is expected to report
 * "not configured" rather than actually dialing.
 *
 * Seed (from globalSetup): wedding id=1 (primary, groom "חתן"/bride "כלה"),
 * "Test Guest" id=1 phone +972501234567 → wedding, rsvp_status NULL.
 */

import axios from "axios";
import { authHeader } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const WEDDING_EVENT_ID = 1;
const GUEST_ID = 1;

// Twilio posts application/x-www-form-urlencoded with eventId/guestId in the query.
const postVoice = (path: string, eventId: number, guestId: number, body: Record<string, string> = {}) =>
  axios.post(
    `${REAL_SERVER}${path}?eventId=${eventId}&guestId=${guestId}`,
    new URLSearchParams(body).toString(),
    { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
  );

const getRsvp = async (eventId: number, guestId: number): Promise<number | null | undefined> => {
  const { data } = await axios.get(`${REAL_SERVER}/events/${eventId}/guests`, { headers: authHeader() });
  return (data as Array<{ guest_id: number; rsvp_status: number | null }>)
    .find((g) => g.guest_id === guestId)?.rsvp_status ?? undefined;
};

const setRsvp = (eventId: number, guestId: number, rsvpStatus: number | null) =>
  axios.post(`${REAL_SERVER}/updateRsvp`, { eventId, guestId, rsvpStatus }, { headers: authHeader() });

beforeEach(async () => {
  await setRsvp(WEDDING_EVENT_ID, GUEST_ID, null);
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Greeting webhook", () => {
  it("returns Hebrew TwiML that gathers a digit and posts to /voice/answer", async () => {
    const { status, data } = await postVoice("/voice/greeting", WEDDING_EVENT_ID, GUEST_ID);
    expect(status).toBe(200);
    const xml = String(data);
    expect(xml).toContain("<Gather");
    expect(xml).toContain("/voice/answer");
    expect(xml).toContain("he-IL");
    // Couple names are interpolated from the event.
    expect(xml).toContain("חתן");
    expect(xml).toContain("כלה");
  });
});

describe("Answer webhook", () => {
  it("press 0 marks the guest declined (rsvp_status = 0)", async () => {
    const { data } = await postVoice("/voice/answer", WEDDING_EVENT_ID, GUEST_ID, { Digits: "0" });
    expect(String(data)).toContain("<Hangup");
    expect(await getRsvp(WEDDING_EVENT_ID, GUEST_ID)).toBe(0);
  });

  it("press 1 gathers the guest count and does not yet set a status", async () => {
    const { data } = await postVoice("/voice/answer", WEDDING_EVENT_ID, GUEST_ID, { Digits: "1" });
    const xml = String(data);
    expect(xml).toContain("<Gather");
    expect(xml).toContain("/voice/count");
    // Still pending until they enter a number.
    expect(await getRsvp(WEDDING_EVENT_ID, GUEST_ID)).toBeNull();
  });

  it("an unrecognized key re-reads the greeting", async () => {
    const { data } = await postVoice("/voice/answer", WEDDING_EVENT_ID, GUEST_ID, { Digits: "7" });
    expect(String(data)).toContain("/voice/greeting");
    expect(await getRsvp(WEDDING_EVENT_ID, GUEST_ID)).toBeNull();
  });
});

describe("Count webhook", () => {
  it("a valid number is stored as the attending count", async () => {
    await postVoice("/voice/answer", WEDDING_EVENT_ID, GUEST_ID, { Digits: "1" });
    const { data } = await postVoice("/voice/count", WEDDING_EVENT_ID, GUEST_ID, { Digits: "3" });
    expect(String(data)).toContain("3");
    expect(await getRsvp(WEDDING_EVENT_ID, GUEST_ID)).toBe(3);
  });

  it("an out-of-range number re-prompts without storing a status", async () => {
    const { data } = await postVoice("/voice/count", WEDDING_EVENT_ID, GUEST_ID, { Digits: "99" });
    expect(String(data)).toContain("<Gather");
    expect(await getRsvp(WEDDING_EVENT_ID, GUEST_ID)).toBeNull();
  });
});

describe("Outbound trigger", () => {
  it("rejects a non-owner with 404", async () => {
    await expect(
      axios.post(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/voice/call-pending`, {}, {
        headers: authHeader("someone-else"),
      }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it("returns 503 when Twilio is not configured", async () => {
    await expect(
      axios.post(`${REAL_SERVER}/events/${WEDDING_EVENT_ID}/voice/call-pending`, {}, {
        headers: authHeader(),
      }),
    ).rejects.toMatchObject({ response: { status: 503 } });
  });
});
