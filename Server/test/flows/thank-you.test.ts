/**
 * Manual thank-you sends (sendMessage messageType=thankYou).
 * Thank-yous must only go to guests who confirmed attendance (rsvp_status > 0),
 * matching the scheduled day-after send — declined and pending guests are
 * excluded even when explicitly selected.
 *
 * Seed (from globalSetup):
 *   Wedding (id=1, primary, "חתונה") ← Test Guest, Alice, Bob, Clare
 *   Test Guest id=1 phone=+972501234567
 *   Alice      id=2 phone=+972501111111
 *   Bob        id=3 phone=+972502222222
 */

import axios from "axios";
import FormData from "form-data";
import { Pool } from "pg";
import { MockWhatsAppClient } from "../mock-whatsapp/client";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);

const WEDDING_EVENT_ID = 1;
const TEST_GUEST_ID = 1;
const ALICE_ID = 2;
const BOB_ID = 3;
const TEST_GUEST_PHONE = "+972501234567";
const ALICE_PHONE = "+972501111111";
const BOB_PHONE = "+972502222222";

const setRsvp = (guestId: number, rsvpStatus: number | null) =>
  axios.post(
    `${REAL_SERVER}/updateRsvp`,
    { eventId: WEDDING_EVENT_ID, guestId, rsvpStatus },
    { headers: authHeader() },
  );

const sendThankYou = (guestIds?: number[]) =>
  axios.post(
    `${REAL_SERVER}/sendMessage`,
    { options: { messageType: "thankYou", eventId: WEDDING_EVENT_ID, guestIds } },
    { headers: authHeader() },
  );

beforeEach(async () => {
  await mock.reset();
  await setRsvp(TEST_GUEST_ID, 2); // confirmed
  await setRsvp(ALICE_ID, 0); // declined
  await setRsvp(BOB_ID, null); // pending
});

afterAll(async () => {
  // Restore seed state so other suites aren't affected
  await setRsvp(TEST_GUEST_ID, null);
  await setRsvp(ALICE_ID, null);
  await setRsvp(BOB_ID, null);
});

describe("Manual thank-you messages go only to confirmed guests", () => {
  it("sends to confirmed guests and skips declined and pending ones", async () => {
    await sendThankYou();

    const [msg] = await mock.waitForMessages(TEST_GUEST_PHONE, 1);
    expect(msg.template?.name).toBe("thank_you_message");
    expect(await mock.getMessages({ to: ALICE_PHONE })).toHaveLength(0);
    expect(await mock.getMessages({ to: BOB_PHONE })).toHaveLength(0);
  });

  it("returns 400 when only non-confirmed guests are explicitly selected", async () => {
    await expect(sendThankYou([ALICE_ID, BOB_ID])).rejects.toMatchObject({
      response: { status: 400 },
    });
    expect(await mock.getMessages({ to: ALICE_PHONE })).toHaveLength(0);
    expect(await mock.getMessages({ to: BOB_PHONE })).toHaveLength(0);
  });
});

describe("Scheduled thank-you messages (day after the wedding)", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  const OWNER = "sched-thankyou-owner";
  const GUEST_PHONE = "+972509990202";

  // Seeds an approved-messaging owner whose wedding was YESTERDAY, with one
  // confirmed guest — the exact state the day-after thank-you fires on.
  const seedOwnerWithWedding = async (sendThankYou: boolean) => {
    await pool.query(
      `INSERT INTO users ("userID", email, name, messaging_permission_status)
       VALUES ($1, $2, $3, 'approved')`,
      [OWNER, `${OWNER}@test.com`, OWNER],
    );
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, 'thankyou-guest', $2, 'bride', 'family', 1) RETURNING id`,
      [OWNER, GUEST_PHONE],
    );
    // Same date format the scheduler compares against (getDateFormat → UTC yyyy-mm-dd)
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().split("T")[0];
    const { rows: [event] } = await pool.query(
      `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, send_thank_you)
       VALUES ($1, TRUE, 'חתונה', $2, 'כלה', 'חתן', $3) RETURNING id`,
      [OWNER, yesterday, sendThankYou],
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

  it("the scheduler sends the thank-you when send_thank_you is on", async () => {
    await seedOwnerWithWedding(true);

    await axios.post(`${REAL_SERVER}/test/run-scheduled-messages`);

    const [msg] = await mock.waitForMessages(GUEST_PHONE, 1);
    expect(msg.template?.name).toBe("thank_you_message");
  });

  it("the scheduler sends nothing when send_thank_you is off", async () => {
    await seedOwnerWithWedding(false);

    await axios.post(`${REAL_SERVER}/test/run-scheduled-messages`);

    expect(await mock.getMessages({ to: GUEST_PHONE })).toHaveLength(0);
  });
});

describe("saveWeddingInfo persists the send_thank_you flag", () => {
  const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });
  const OWNER = "savewedding-thankyou-owner";

  const saveWeddingInfo = async (info: Record<string, unknown>) => {
    const form = new FormData();
    form.append("weddingInfo", JSON.stringify(info));
    const { data } = await axios.post(`${REAL_SERVER}/saveWeddingInfo`, form, {
      headers: { ...form.getHeaders(), ...authHeader(OWNER) },
    });
    return data;
  };

  beforeEach(async () => {
    await pool.query(
      `INSERT INTO users ("userID", email, name) VALUES ($1, $2, $3)`,
      [OWNER, `${OWNER}@test.com`, OWNER],
    );
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM users WHERE "userID" = $1`, [OWNER]);
  });

  afterAll(async () => {
    await pool.end();
  });

  it("round-trips send_thank_you=true and turns it back off when saved unchecked", async () => {
    const info = { bride_name: "כלה", groom_name: "חתן", date: "2027-06-01", time: "20:00", location: "אולם" };

    const saved = await saveWeddingInfo({ ...info, send_thank_you: true });
    expect(saved.send_thank_you).toBe(true);

    const resaved = await saveWeddingInfo({ ...info, send_thank_you: false });
    expect(resaved.send_thank_you).toBe(false);
  });
});
