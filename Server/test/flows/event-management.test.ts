/**
 * Event management tests.
 * Covers event listing, secondary event creation, authorization checks,
 * and sendMessage error handling for invalid events.
 */

import axios from "axios";
import FormData from "form-data";
import { authHeader, TEST_USER_ID } from "../helpers/auth";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const USER_ID = TEST_USER_ID;
const WEDDING_EVENT_ID = 1;

// ── Helpers ──────────────────────────────────────────────────────────────────

const getEvents = async (userID = USER_ID) => {
  const { data } = await axios.get(`${REAL_SERVER}/events`, { headers: authHeader(userID) });
  return data as Array<{ id: number; ceremony_name: string; is_primary: boolean }>;
};

const createEvent = async (ceremonyName: string) => {
  const form = new FormData();
  form.append("ceremony_name", ceremonyName);
  const { data } = await axios.post(`${REAL_SERVER}/events`, form, {
    headers: { ...form.getHeaders(), ...authHeader() },
  });
  return data as { id: number; ceremony_name: string };
};

const deleteEvent = (eventId: number) =>
  axios.delete(`${REAL_SERVER}/events/${eventId}`, { headers: authHeader() });

const getEventGuests = (eventId: number, userID = USER_ID) =>
  axios.get(`${REAL_SERVER}/events/${eventId}/guests`, { headers: authHeader(userID) });

// ── Track events created during tests ────────────────────────────────────────
const createdEventIds: number[] = [];

afterEach(async () => {
  for (const id of createdEventIds) {
    try { await deleteEvent(id); } catch { /* already deleted */ }
  }
  createdEventIds.length = 0;
});

// ─────────────────────────────────────────────────────────────────────────────

describe("List events", () => {
  it("returns at least the primary wedding event and the henna event", async () => {
    const events = await getEvents();
    expect(events.length).toBeGreaterThanOrEqual(2);
    expect(events.some((e) => e.is_primary)).toBe(true);
    expect(events.some((e) => e.ceremony_name === "חינה")).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Create secondary event", () => {
  it("newly created event appears in the event list", async () => {
    const created = await createEvent("קבלת פנים");
    createdEventIds.push(created.id);

    const events = await getEvents();
    expect(events.some((e) => e.id === created.id && e.ceremony_name === "קבלת פנים")).toBe(true);
  });

  it("newly created event is not primary", async () => {
    const created = await createEvent("ערב כיף");
    createdEventIds.push(created.id);

    const events = await getEvents();
    const found = events.find((e) => e.id === created.id);
    expect(found?.is_primary).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Authorization", () => {
  it("GET /events/:eventId/guests with a different user's token returns 404", async () => {
    await expect(
      getEventGuests(WEDDING_EVENT_ID, "wrong-user-id"),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("sendMessage error handling", () => {
  it("sending to a non-existent eventId returns 404", async () => {
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { messageType: "rsvp", eventId: 99999 } },
        { headers: authHeader() },
      ),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it("sending freeText with empty customText returns 400", async () => {
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { messageType: "freeText", eventId: WEDDING_EVENT_ID, customText: "   " } },
        { headers: authHeader() },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});
