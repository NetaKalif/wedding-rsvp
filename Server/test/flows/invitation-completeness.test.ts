/**
 * Invitation-completeness gate tests.
 *
 * The RSVP invitation renders the event's photo (template image header),
 * couple names, date, and location — so the server blocks every path that
 * would send it while any of that is missing: manual /sendMessage (including
 * the targeted failedOnly/unsentOnly sends), saving an invitation round in
 * the message schedule, and the scheduled-rounds sweep itself.
 *
 * Prerequisites — three processes must be running before `npm test`:
 *   npm run test:db:start   — Docker Postgres on port 5433
 *   npm run test:server     — real server (with test env vars)
 *   npm run mock-wa         — mock WhatsApp server on port 3001
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const OWNER = "incomplete-invitation-owner";
const PHONE = "+972521119001";

const insertUser = (userID: string, plan: "manual" | "scheduled" = "manual") =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status, messaging_permission_status, messaging_plan)
     VALUES ($1, $2, $3, 'approved', 'approved', $4)
     ON CONFLICT ("userID") DO UPDATE SET messaging_plan = $4`,
    [userID, `${userID}@test.com`, userID, plan],
  );

/** Seeds a primary event + one pending guest. Pass overrides to blank out invitation content. */
const seedEvent = async (
  ownerID: string,
  overrides: Partial<{ file_id: string | null; location: string | null; bride_name: string | null }> = {},
) => {
  const fields = {
    file_id: "test-file-id",
    location: "תל אביב",
    bride_name: "כלה",
    ...overrides,
  };
  const { rows: [event] } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, location, file_id)
     VALUES ($1, TRUE, 'חתונה', '2027-01-01', $2, 'חתן', $3, $4) RETURNING id`,
    [ownerID, fields.bride_name, fields.location, fields.file_id],
  );
  const { rows: [guest] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, 'invite-guest', $2, 'bride', 'family', 1) RETURNING id`,
    [ownerID, PHONE],
  );
  await pool.query(
    `INSERT INTO event_guests (event_id, guest_id, rsvp_status) VALUES ($1, $2, NULL)`,
    [event.id, guest.id],
  );
  return { eventId: event.id as number, guestId: guest.id as number };
};

const sendMessage = (options: Record<string, unknown>) =>
  axios.post(`${REAL_SERVER}/sendMessage`, { options }, { headers: authHeader(OWNER) });

const saveSchedule = (eventId: number, rounds: unknown[]) =>
  axios.post(`${REAL_SERVER}/events/${eventId}/messageSchedule`, { rounds }, { headers: authHeader(OWNER) });

const futureIso = (hoursAhead = 24) => new Date(Date.now() + hoursAhead * 3600_000).toISOString();

beforeEach(async () => {
  await mock.reset();
});

afterEach(async () => {
  await pool.query(`DELETE FROM users WHERE "userID" = $1`, [OWNER]); // cascades
});

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Manual invitation sends require complete invitation content", () => {
  it("400s the invitation when the invitation photo is missing and sends nothing", async () => {
    await insertUser(OWNER);
    const { eventId } = await seedEvent(OWNER, { file_id: null });

    await expect(sendMessage({ messageType: "rsvp", eventId })).rejects.toMatchObject({
      response: { status: 400, data: { missingFields: ["invitation photo"] } },
    });
    expect(await mock.getMessages({ to: PHONE })).toHaveLength(0);
  });

  it("lists every missing field, not just the photo", async () => {
    await insertUser(OWNER);
    const { eventId } = await seedEvent(OWNER, { file_id: null, location: null, bride_name: null });

    await expect(sendMessage({ messageType: "rsvp", eventId })).rejects.toMatchObject({
      response: {
        status: 400,
        data: { missingFields: ["invitation photo", "couple names", "event location"] },
      },
    });
  });

  it("blocks the targeted failed-only resend too — it is also the invitation", async () => {
    await insertUser(OWNER);
    const { eventId, guestId } = await seedEvent(OWNER, { file_id: null });
    await pool.query(
      `UPDATE event_guests SET last_send_error = 'bad number' WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestId],
    );

    await expect(sendMessage({ eventId, failedOnly: true })).rejects.toMatchObject({
      response: { status: 400, data: { missingFields: ["invitation photo"] } },
    });
    expect(await mock.getMessages({ to: PHONE })).toHaveLength(0);
  });

  it("still allows non-invitation sends (the reminder doesn't render the photo)", async () => {
    await insertUser(OWNER);
    const { eventId } = await seedEvent(OWNER, { file_id: null });

    await sendMessage({ messageType: "rsvpReminder", eventId });
    const [message] = await mock.waitForMessages(PHONE, 1);
    expect(message.template?.name).toBe("wedding_rsvp_reminder");
  });

  it("sends normally once all invitation content is present", async () => {
    await insertUser(OWNER);
    const { eventId } = await seedEvent(OWNER);

    await sendMessage({ messageType: "rsvp", eventId });
    const [message] = await mock.waitForMessages(PHONE, 1);
    expect(message.template?.name).toBe("wedding_rsvp_action");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Non-primary events and the completeness gate", () => {
  // guests are UNIQUE(user_id, phone) — the secondary event needs its own guest
  const SECONDARY_PHONE = "+972521119002";

  /** A secondary event (own photo optional) whose couple names are unset. */
  const seedSecondaryEvent = async (ownerID: string, fileId: string | null) => {
    const { rows: [event] } = await pool.query(
      `INSERT INTO events (user_id, is_primary, ceremony_name, date, location, file_id)
       VALUES ($1, FALSE, 'חינה', '2027-01-01', 'חיפה', $2) RETURNING id`,
      [ownerID, fileId],
    );
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, 'henna-guest', $2, 'bride', 'family', 1) RETURNING id`,
      [ownerID, SECONDARY_PHONE],
    );
    await pool.query(`INSERT INTO event_guests (event_id, guest_id) VALUES ($1, $2)`, [
      event.id,
      guest.id,
    ]);
    return event.id as number;
  };

  it("couple names are inherited from the primary event, so they don't block the send", async () => {
    await insertUser(OWNER);
    await seedEvent(OWNER); // the primary event carries the couple names
    const secondaryId = await seedSecondaryEvent(OWNER, "henna-file-id");

    await sendMessage({ messageType: "rsvp", eventId: secondaryId });
    const [message] = await mock.waitForMessages(SECONDARY_PHONE, 1);
    expect(message.template?.name).toBe("wedding_rsvp_action");
  });

  it("the invitation photo is per-event — the primary's photo doesn't satisfy it", async () => {
    await insertUser(OWNER);
    await seedEvent(OWNER); // primary has a photo
    const secondaryId = await seedSecondaryEvent(OWNER, null);

    await expect(sendMessage({ messageType: "rsvp", eventId: secondaryId })).rejects.toMatchObject({
      response: { status: 400, data: { missingFields: ["invitation photo"] } },
    });
    expect(await mock.getMessages({ to: SECONDARY_PHONE })).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Scheduling the invitation round requires complete invitation content", () => {
  it("400s saving an invitation round while the photo is missing, but allows other rounds", async () => {
    await insertUser(OWNER, "scheduled");
    const { eventId } = await seedEvent(OWNER, { file_id: null });

    await expect(
      saveSchedule(eventId, [{ roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso() }]),
    ).rejects.toMatchObject({
      response: { status: 400, data: { missingFields: ["invitation photo"] } },
    });

    // Reminder/call rounds don't render the photo — scheduling them still works
    const { data } = await saveSchedule(eventId, [
      { roundType: "rsvpReminder", roundNumber: 1, scheduledAt: futureIso() },
    ]);
    expect(data.rounds).toHaveLength(1);
  });

  it("saves the invitation round once the photo exists", async () => {
    await insertUser(OWNER, "scheduled");
    const { eventId } = await seedEvent(OWNER);

    const { data } = await saveSchedule(eventId, [
      { roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso() },
    ]);
    expect(data.rounds[0].status).toBe("pending");
  });

  it("the sweep skips a due invitation round whose event lost its invitation content", async () => {
    await insertUser(OWNER, "scheduled");
    // Round was scheduled before this gate existed / before the photo was removed
    const { eventId } = await seedEvent(OWNER, { file_id: null });
    await pool.query(
      `INSERT INTO scheduled_rounds (event_id, round_type, round_number, scheduled_at, status)
       VALUES ($1, 'rsvp', 1, NOW() - INTERVAL '1 hour', 'pending')`,
      [eventId],
    );

    await axios.post(`${REAL_SERVER}/test/run-scheduled-rounds`, { eventId });

    const { rows: [round] } = await pool.query(
      `SELECT status FROM scheduled_rounds WHERE event_id = $1 AND round_type = 'rsvp'`,
      [eventId],
    );
    expect(round.status).toBe("skipped");
    expect(await mock.getMessages({ to: PHONE })).toHaveLength(0);
  });
});
