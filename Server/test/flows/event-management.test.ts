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

const createEvent = async (ceremonyName: string, extraFields: Record<string, string> = {}) => {
  const form = new FormData();
  form.append("ceremony_name", ceremonyName);
  Object.entries(extraFields).forEach(([k, v]) => form.append(k, v));
  const { data } = await axios.post(`${REAL_SERVER}/events`, form, {
    headers: { ...form.getHeaders(), ...authHeader() },
  });
  return data as { id: number; ceremony_name: string; waze_link: string | null; gift_link: string | null };
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

  it("persists waze and gift links provided at creation", async () => {
    const created = await createEvent("שבת חתן", {
      waze_link: "https://waze.com/ul/xyz",
      gift_link: "https://pay.example.com/gift",
    });
    createdEventIds.push(created.id);

    expect(created.waze_link).toBe("https://waze.com/ul/xyz");
    expect(created.gift_link).toBe("https://pay.example.com/gift");
  });

  it("persists reminder settings provided at creation (multipart delivers them as strings)", async () => {
    const created = await createEvent("חינה עם תזכורת", {
      send_reminder: "true",
      reminder_day: "wedding_day",
      reminder_time: "09:30",
    });
    createdEventIds.push(created.id);

    expect((created as any).send_reminder).toBe(true);
    expect((created as any).reminder_day).toBe("wedding_day");
    expect(String((created as any).reminder_time)).toContain("09:30");
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

describe("Update event with invitation image", () => {
  it("PATCH with a multipart image uploads it and sets file_id", async () => {
    const created = await createEvent("אירוע עם תמונה");
    createdEventIds.push(created.id);

    const form = new FormData();
    form.append("ceremony_name", "אירוע עם תמונה");
    form.append("image", Buffer.from("fake-image-bytes"), {
      filename: "invite.png",
      contentType: "image/png",
    });
    const { data: updated } = await axios.patch(`${REAL_SERVER}/events/${created.id}`, form, {
      headers: { ...form.getHeaders(), ...authHeader() },
    });

    expect(updated.file_id).toEqual(expect.stringContaining("mock-media-"));
  });

  it("PATCH with a JSON body still updates fields without touching file_id", async () => {
    const created = await createEvent("אירוע ללא תמונה");
    createdEventIds.push(created.id);

    const { data: updated } = await axios.patch(
      `${REAL_SERVER}/events/${created.id}`,
      { location: "אולם הדקל" },
      { headers: authHeader() },
    );

    expect(updated.location).toBe("אולם הדקל");
    expect(updated.file_id).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Update event reminder settings", () => {
  it("PATCH with a JSON body turns the reminder on with day and time", async () => {
    const created = await createEvent("אירוע עם תזכורת");
    createdEventIds.push(created.id);

    const { data: updated } = await axios.patch(
      `${REAL_SERVER}/events/${created.id}`,
      { send_reminder: true, reminder_day: "day_before", reminder_time: "08:15" },
      { headers: authHeader() },
    );

    expect(updated.send_reminder).toBe(true);
    expect(updated.reminder_day).toBe("day_before");
    expect(String(updated.reminder_time)).toContain("08:15");
  });

  it("PATCH with a multipart body coerces send_reminder='false' and empty reminder fields", async () => {
    const created = await createEvent("אירוע לכיבוי תזכורת", {
      send_reminder: "true",
      reminder_day: "wedding_day",
      reminder_time: "09:00",
    });
    createdEventIds.push(created.id);

    const form = new FormData();
    form.append("send_reminder", "false");
    form.append("reminder_time", "");
    form.append("reminder_day", "");
    const { data: updated } = await axios.patch(`${REAL_SERVER}/events/${created.id}`, form, {
      headers: { ...form.getHeaders(), ...authHeader() },
    });

    expect(updated.send_reminder).toBe(false);
    expect(updated.reminder_time).toBeNull();
    expect(updated.reminder_day).toBeNull();
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
