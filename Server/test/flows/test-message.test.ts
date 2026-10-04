/**
 * Test-message ("send to myself") tests.
 *
 * POST /sendTestMessage sends a single message to the couple's own phone so
 * they can preview it before anything goes to guests. It must work on BOTH
 * messaging plans — manual and "send and go" (scheduled), where regular manual
 * sends are blocked — require messaging permission, validate/normalize the
 * phone, enforce the invitation-completeness gate, and never stamp guest
 * send-state.
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

const OWNER = "test-message-owner";
const GUEST_PHONE = "+972521117001";
const OWN_PHONE = "+972521117002";

const insertUser = (
  userID: string,
  plan: "manual" | "scheduled" = "manual",
  messagingPermission: "approved" | "denied" = "approved",
) =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status, messaging_permission_status, messaging_plan)
     VALUES ($1, $2, $3, 'approved', $4, $5)
     ON CONFLICT ("userID") DO UPDATE SET messaging_permission_status = $4, messaging_plan = $5`,
    [userID, `${userID}@test.com`, userID, messagingPermission, plan],
  );

/** Seeds a primary event with complete invitation content + one pending guest. */
const seedEvent = async (
  ownerID: string,
  overrides: Partial<{ file_id: string | null }> = {},
) => {
  const fileId = "file_id" in overrides ? overrides.file_id : "test-file-id";
  const { rows: [event] } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, location, file_id)
     VALUES ($1, TRUE, 'חתונה', '2027-01-01', 'כלה', 'חתן', 'תל אביב', $2) RETURNING id`,
    [ownerID, fileId],
  );
  const { rows: [guest] } = await pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
     VALUES ($1, 'test-msg-guest', $2, 'bride', 'family', 1) RETURNING id`,
    [ownerID, GUEST_PHONE],
  );
  await pool.query(
    `INSERT INTO event_guests (event_id, guest_id, rsvp_status) VALUES ($1, $2, NULL)`,
    [event.id, guest.id],
  );
  return { eventId: event.id as number, guestId: guest.id as number };
};

const sendTestMessage = (options: Record<string, unknown>) =>
  axios.post(`${REAL_SERVER}/sendTestMessage`, { options }, { headers: authHeader(OWNER) });

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

describe("Test message — manual plan", () => {
  it("sends a single invitation test to the given phone, not to guests, without stamping guest state", async () => {
    await insertUser(OWNER, "manual");
    const { eventId, guestId } = await seedEvent(OWNER);

    const { data } = await sendTestMessage({ eventId, messageType: "rsvp", phone: OWN_PHONE });
    expect(data.success).toBe(true);

    const [message] = await mock.waitForMessages(OWN_PHONE, 1);
    expect(message.template?.name).toBe("wedding_rsvp_action");

    // Guests got nothing and their send-state is untouched
    expect(await mock.getMessages({ to: GUEST_PHONE })).toHaveLength(0);
    const { rows: [eg] } = await pool.query(
      `SELECT last_message_type, last_rsvp_sent_at FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestId],
    );
    expect(eg.last_message_type).toBeNull();
    expect(eg.last_rsvp_sent_at).toBeNull();
  });

  it("sends the right template per message type", async () => {
    await insertUser(OWNER, "manual");
    const { eventId } = await seedEvent(OWNER);

    await sendTestMessage({ eventId, messageType: "rsvpReminder", phone: OWN_PHONE });
    await sendTestMessage({ eventId, messageType: "eventReminder", phone: OWN_PHONE });
    await sendTestMessage({ eventId, messageType: "thankYou", phone: OWN_PHONE });

    const messages = await mock.waitForMessages(OWN_PHONE, 3);
    const templates = messages.map((m) => m.template?.name);
    expect(templates).toContain("wedding_rsvp_reminder");
    expect(templates).toContain("event_reminder");
    expect(templates).toContain("thank_you_message");
  });

  it("normalizes a local-format phone number (05x…) to +9725x…", async () => {
    await insertUser(OWNER, "manual");
    const { eventId } = await seedEvent(OWNER);

    await sendTestMessage({ eventId, messageType: "rsvpReminder", phone: "052-111 7003" });

    const [message] = await mock.waitForMessages("+972521117003", 1);
    expect(message.template?.name).toBe("wedding_rsvp_reminder");
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Test message — 'send and go' (scheduled) plan", () => {
  it("is allowed even though regular manual sends are blocked on this plan", async () => {
    await insertUser(OWNER, "scheduled");
    const { eventId } = await seedEvent(OWNER);

    // The regular manual send is blocked for scheduled-plan couples…
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { eventId, messageType: "rsvp" } },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 403 } });

    // …but the self-test is not: it targets only the couple's own phone.
    const { data } = await sendTestMessage({ eventId, messageType: "rsvp", phone: OWN_PHONE });
    expect(data.success).toBe(true);
    const [message] = await mock.waitForMessages(OWN_PHONE, 1);
    expect(message.template?.name).toBe("wedding_rsvp_action");
    expect(await mock.getMessages({ to: GUEST_PHONE })).toHaveLength(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Test message — validation and gates", () => {
  it("403s without messaging permission", async () => {
    await insertUser(OWNER, "manual", "denied");
    const { eventId } = await seedEvent(OWNER);

    await expect(
      sendTestMessage({ eventId, messageType: "rsvp", phone: OWN_PHONE }),
    ).rejects.toMatchObject({ response: { status: 403 } });
    expect(await mock.getMessages({ to: OWN_PHONE })).toHaveLength(0);
  });

  it("400s an invalid phone number", async () => {
    await insertUser(OWNER, "manual");
    const { eventId } = await seedEvent(OWNER);

    for (const phone of ["", "12345", "+14155550100", "לא מספר"]) {
      await expect(
        sendTestMessage({ eventId, messageType: "rsvp", phone }),
      ).rejects.toMatchObject({ response: { status: 400 } });
    }
  });

  it("400s an unknown message type", async () => {
    await insertUser(OWNER, "manual");
    const { eventId } = await seedEvent(OWNER);

    await expect(
      sendTestMessage({ eventId, messageType: "nope", phone: OWN_PHONE }),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("enforces the invitation-completeness gate on the invitation test", async () => {
    await insertUser(OWNER, "manual");
    const { eventId } = await seedEvent(OWNER, { file_id: null });

    await expect(
      sendTestMessage({ eventId, messageType: "rsvp", phone: OWN_PHONE }),
    ).rejects.toMatchObject({
      response: { status: 400, data: { missingFields: ["invitation photo"] } },
    });

    // Non-invitation tests don't render the photo — still allowed
    const { data } = await sendTestMessage({ eventId, messageType: "rsvpReminder", phone: OWN_PHONE });
    expect(data.success).toBe(true);
  });

  it("404s an event that belongs to another user", async () => {
    await insertUser(OWNER, "manual");
    await seedEvent(OWNER);
    const OTHER = "test-message-other-owner";
    await insertUser(OTHER, "manual");
    const { rows: [otherEvent] } = await pool.query(
      `INSERT INTO events (user_id, is_primary, ceremony_name, date) VALUES ($1, TRUE, 'חתונה', '2027-01-01') RETURNING id`,
      [OTHER],
    );

    try {
      await expect(
        sendTestMessage({ eventId: otherEvent.id, messageType: "rsvpReminder", phone: OWN_PHONE }),
      ).rejects.toMatchObject({ response: { status: 404 } });
    } finally {
      await pool.query(`DELETE FROM users WHERE "userID" = $1`, [OTHER]);
    }
  });
});
