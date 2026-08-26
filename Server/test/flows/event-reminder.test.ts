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
import { Pool } from "pg";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";
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

describe("Scheduled reminders for non-primary events", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  const OWNER = "sched-nonprimary-owner";
  const GUEST_PHONE = "+972509990101";

  // Seeds an approved-messaging owner with a NON-primary event, reminder on,
  // and one confirmed guest — i.e. an event the scheduler should now pick up.
  const seedOwnerWithEvent = async (date: string, reminderDay: "day_before" | "wedding_day") => {
    await pool.query(
      `INSERT INTO users ("userID", email, name, messaging_permission_status)
       VALUES ($1, $2, $3, 'approved')`,
      [OWNER, `${OWNER}@test.com`, OWNER],
    );
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, 'sched-guest', $2, 'bride', 'family', 1) RETURNING id`,
      [OWNER, GUEST_PHONE],
    );
    const { rows: [event] } = await pool.query(
      `INSERT INTO events (user_id, is_primary, ceremony_name, date, time, bride_name, groom_name,
                           send_reminder, reminder_day, reminder_time)
       VALUES ($1, FALSE, 'חינה מתוזמנת', $2, '19:00', 'כלה', 'חתן', TRUE, $3, '09:00') RETURNING id`,
      [OWNER, date, reminderDay],
    );
    await pool.query(
      `INSERT INTO event_guests (event_id, guest_id, rsvp_status) VALUES ($1, $2, 2)`,
      [event.id, guest.id],
    );
  };

  afterEach(async () => {
    // Cascades to the seeded guests/events/event_guests
    await pool.query(`DELETE FROM users WHERE "userID" = $1`, [OWNER]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("the scheduler sends a same-day reminder for a non-primary event dated today", async () => {
    // Same date format the scheduler compares against (getDateFormat → UTC yyyy-mm-dd)
    const today = new Date().toISOString().split("T")[0];
    await seedOwnerWithEvent(today, "wedding_day");

    await axios.post(`${REAL_SERVER}/test/run-scheduled-messages`);

    const [msg] = await mock.waitForMessages(GUEST_PHONE, 1);
    expect(msg.template?.name).toBe("event_reminder");
    const params = bodyParams(msg);
    expect(params.day).toBe("היום");
    expect(params.ceremony_name).toBe("חינה מתוזמנת");
  });

  it("the scheduler sends a day-before reminder for a non-primary event dated tomorrow", async () => {
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    await seedOwnerWithEvent(tomorrow, "day_before");

    await axios.post(`${REAL_SERVER}/test/run-scheduled-messages`);

    const [msg] = await mock.waitForMessages(GUEST_PHONE, 1);
    expect(msg.template?.name).toBe("event_reminder");
    expect(bodyParams(msg).day).toBe("מחר");
  });
});
