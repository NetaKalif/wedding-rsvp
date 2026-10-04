/**
 * "Send and go" messaging plan tests.
 * Covers: admin assigning messaging_plan, the plan surfacing in /auth/me and
 * getAllUsersDetailed, manual /sendMessage blocked for scheduled-plan users
 * (except failed-only resends), the messageSchedule endpoints (validation,
 * upsert, edit-lock after send), the scheduled-rounds sweep (invitation to
 * everyone, reminders to pending only, plan/permission gating), per-guest
 * last_send_error recording from the delivery-status webhook, the
 * failure-report pass, and the resend-to-failed flow.
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader, TEST_USER_ID } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
const mock = new MockWhatsAppClient(3001);
const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const OWNER = "send-and-go-owner";
const PHONE_A = "+972521110001";
const PHONE_B = "+972521110002";
const PHONE_C = "+972521110003";

const adminHeaders = authHeader(TEST_USER_ID, { isAdmin: true });

const insertUser = (
  userID: string,
  { plan = "manual", permission = "approved" }: { plan?: string; permission?: string } = {},
) =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status, messaging_permission_status, messaging_plan)
     VALUES ($1, $2, $3, 'approved', $4, $5)
     ON CONFLICT ("userID") DO UPDATE SET messaging_permission_status = $4, messaging_plan = $5`,
    [userID, `${userID}@test.com`, userID, permission, plan],
  );

const deleteUser = (userID: string) => pool.query(`DELETE FROM users WHERE "userID" = $1`, [userID]);

/** Seeds an event with two guests (A confirmed, B pending) and returns ids. */
const seedEvent = async (ownerID: string) => {
  const today = new Date().toISOString().split("T")[0];
  // location + file_id: invitation sends/scheduling are blocked while any
  // invitation content (chiefly the photo) is missing
  const { rows: [event] } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name, location, file_id)
     VALUES ($1, TRUE, 'חתונה', $2, 'כלה', 'חתן', 'תל אביב', 'test-file-id') RETURNING id`,
    [ownerID, today],
  );
  const insertGuest = async (name: string, phone: string, rsvp: number | null) => {
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, $2, $3, 'bride', 'family', 1) RETURNING id`,
      [ownerID, name, phone],
    );
    await pool.query(
      `INSERT INTO event_guests (event_id, guest_id, rsvp_status) VALUES ($1, $2, $3)`,
      [event.id, guest.id, rsvp],
    );
    return guest.id as number;
  };
  const guestA = await insertGuest("guest-a", PHONE_A, 2); // confirmed
  const guestB = await insertGuest("guest-b", PHONE_B, null); // pending
  return { eventId: event.id as number, guestA, guestB };
};

const insertRound = (eventId: number, roundType: string, roundNumber = 1, status = "pending") =>
  pool.query(
    `INSERT INTO scheduled_rounds (event_id, round_type, round_number, scheduled_at, status, sent_at)
     VALUES ($1, $2, $3, NOW() - INTERVAL '1 hour', $4, CASE WHEN $4 = 'sent' THEN NOW() ELSE NULL END)`,
    [eventId, roundType, roundNumber, status],
  );

const getRound = async (eventId: number, roundType: string, roundNumber = 1) => {
  const { rows } = await pool.query(
    `SELECT * FROM scheduled_rounds WHERE event_id = $1 AND round_type = $2 AND round_number = $3`,
    [eventId, roundType, roundNumber],
  );
  return rows[0];
};

const runScheduledRounds = (eventId: number) =>
  axios.post(`${REAL_SERVER}/test/run-scheduled-rounds`, { eventId });

const saveSchedule = (eventId: number, rounds: unknown[], userID = OWNER) =>
  axios.post(`${REAL_SERVER}/events/${eventId}/messageSchedule`, { rounds }, { headers: authHeader(userID) });

const futureIso = (hoursAhead = 24) => new Date(Date.now() + hoursAhead * 3600_000).toISOString();

const postStatusWebhook = (statuses: unknown[]) =>
  axios.post(`${REAL_SERVER}/sms`, { entry: [{ changes: [{ value: { statuses } }] }] });

beforeEach(async () => {
  await mock.reset();
});

afterEach(async () => {
  await deleteUser(OWNER); // cascades to guests/events/event_guests/scheduled_rounds
});

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Admin messaging-plan assignment", () => {
  it("admin sets the plan and it surfaces in getAllUsersDetailed and /auth/me", async () => {
    await insertUser(OWNER);

    await axios.post(
      `${REAL_SERVER}/admin/setMessagingPlan`,
      { userID: OWNER, plan: "scheduled" },
      { headers: adminHeaders },
    );

    const { data: users } = await axios.post(`${REAL_SERVER}/admin/getAllUsersDetailed`, {}, { headers: adminHeaders });
    expect(users.find((u: any) => u.userID === OWNER).messagingPlan).toBe("scheduled");

    const { data: me } = await axios.get(`${REAL_SERVER}/auth/me`, { headers: authHeader(OWNER) });
    expect(me.user.messagingPlan).toBe("scheduled");
  });

  it("rejects invalid plans and non-admin callers", async () => {
    await insertUser(OWNER);
    await expect(
      axios.post(`${REAL_SERVER}/admin/setMessagingPlan`, { userID: OWNER, plan: "weekly" }, { headers: adminHeaders }),
    ).rejects.toMatchObject({ response: { status: 400 } });
    await expect(
      axios.post(`${REAL_SERVER}/admin/setMessagingPlan`, { userID: OWNER, plan: "scheduled" }, { headers: authHeader(OWNER) }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("QA schedule reset", () => {
  it("admin reset wipes the rounds and clears guest send markers", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp", 1, "sent");
    await insertRound(eventId, "rsvpReminder", 1);
    await pool.query(
      `UPDATE event_guests SET last_send_error = 'bad number', last_message_type = 'rsvp'
       WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );

    await axios.post(
      `${REAL_SERVER}/admin/resetMessageSchedule`,
      { eventId, clearGuestState: true },
      { headers: adminHeaders },
    );

    const { rows: rounds } = await pool.query(`SELECT * FROM scheduled_rounds WHERE event_id = $1`, [eventId]);
    expect(rounds).toHaveLength(0);
    const { rows: guests } = await pool.query(
      `SELECT last_send_error, last_message_type FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(guests[0].last_send_error).toBeNull();
    expect(guests[0].last_message_type).toBeNull();

    // The schedule can be entered again from scratch — including the round
    // that was previously locked as "sent"
    const { data } = await saveSchedule(eventId, [
      { roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso(1) },
    ]);
    expect(data.rounds).toHaveLength(1);
    expect(data.rounds[0].status).toBe("pending");
  });

  it("non-admins cannot reset a schedule", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await expect(
      axios.post(
        `${REAL_SERVER}/admin/resetMessageSchedule`,
        { eventId, clearGuestState: true },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("Manual sending is blocked for scheduled-plan users", () => {
  it("403s a manual send but allows a failed-only rsvp resend", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);

    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { messageType: "rsvp", eventId } },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 403 } });

    // Mark guest B as failed, then a failedOnly resend goes out — to B only
    await pool.query(
      `UPDATE event_guests SET last_send_error = 'bad number' WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { messageType: "rsvp", eventId, failedOnly: true } },
      { headers: authHeader(OWNER) },
    );

    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(0);
    expect((await mock.getMessages({ to: PHONE_B })).length).toBeGreaterThanOrEqual(1);

    // The successful resend clears the stored error
    const { rows } = await pool.query(
      `SELECT last_send_error FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(rows[0].last_send_error).toBeNull();
  });

  it("403s manual call-pending for scheduled-plan users (calls run on the schedule)", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);

    await expect(
      axios.post(`${REAL_SERVER}/events/${eventId}/voice/call-pending`, {}, { headers: authHeader(OWNER) }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });

  it("manual-plan users still reach the call-pending endpoint (503 — no Twilio in tests, not 403)", async () => {
    await insertUser(OWNER, { plan: "manual" });
    const { eventId } = await seedEvent(OWNER);

    await expect(
      axios.post(`${REAL_SERVER}/events/${eventId}/voice/call-pending`, {}, { headers: authHeader(OWNER) }),
    ).rejects.toMatchObject({ response: { status: 503 } });
  });

  it("manual-plan users keep sending as before", async () => {
    await insertUser(OWNER, { plan: "manual" });
    const { eventId } = await seedEvent(OWNER);
    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { messageType: "rsvp", eventId } },
      { headers: authHeader(OWNER) },
    );
    await mock.waitForMessages(PHONE_A, 1);
    await mock.waitForMessages(PHONE_B, 1);
  });
});

describe("Message schedule endpoints", () => {
  it("saves, returns, and reschedules rounds", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);

    const { data } = await saveSchedule(eventId, [
      { roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso(1) },
      { roundType: "rsvpReminder", roundNumber: 1, scheduledAt: futureIso(24) },
      { roundType: "rsvpReminder", roundNumber: 2, scheduledAt: futureIso(48) },
      { roundType: "rsvpReminder", roundNumber: 3, scheduledAt: futureIso(72) },
      { roundType: "call", roundNumber: 1, scheduledAt: futureIso(96) },
      { roundType: "call", roundNumber: 2, scheduledAt: futureIso(120) },
    ]);
    expect(data.rounds).toHaveLength(6);
    expect(data.rounds.every((r: any) => r.status === "pending")).toBe(true);

    // Reschedule a pending round (its date hasn't passed → editable)
    const newTime = futureIso(2);
    await saveSchedule(eventId, [{ roundType: "rsvp", roundNumber: 1, scheduledAt: newTime }]);
    const { data: fetched } = await axios.get(`${REAL_SERVER}/events/${eventId}/messageSchedule`, {
      headers: authHeader(OWNER),
    });
    const rsvpRound = fetched.rounds.find((r: any) => r.round_type === "rsvp");
    expect(new Date(rsvpRound.scheduled_at).toISOString()).toBe(newTime);

    // scheduledAt: null removes a still-pending round
    await saveSchedule(eventId, [{ roundType: "call", roundNumber: 2, scheduledAt: null }]);
    const { data: after } = await axios.get(`${REAL_SERVER}/events/${eventId}/messageSchedule`, {
      headers: authHeader(OWNER),
    });
    expect(after.rounds).toHaveLength(5);
  });

  it("validates round types, numbers, and future dates", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);

    await expect(
      saveSchedule(eventId, [{ roundType: "carrierPigeon", roundNumber: 1, scheduledAt: futureIso() }]),
    ).rejects.toMatchObject({ response: { status: 400 } });
    await expect(
      saveSchedule(eventId, [{ roundType: "rsvpReminder", roundNumber: 4, scheduledAt: futureIso() }]),
    ).rejects.toMatchObject({ response: { status: 400 } });
    await expect(
      saveSchedule(eventId, [
        { roundType: "rsvp", roundNumber: 1, scheduledAt: new Date(Date.now() - 3600_000).toISOString() },
      ]),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("refuses to edit a round that was already sent", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp", 1, "sent");

    await expect(
      saveSchedule(eventId, [{ roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso() }]),
    ).rejects.toMatchObject({ response: { status: 409 } });
  });

  it("404s for an event that belongs to someone else", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await expect(
      saveSchedule(eventId, [{ roundType: "rsvp", roundNumber: 1, scheduledAt: futureIso() }], TEST_USER_ID),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });

  it("404s a malformed eventId URL param instead of a 500 query error", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    await expect(
      axios.get(`${REAL_SERVER}/events/undefined/messageSchedule`, { headers: authHeader(OWNER) }),
    ).rejects.toMatchObject({ response: { status: 404 } });
  });
});

describe("Scheduled rounds sweep", () => {
  it("sends a due invitation round to all guests with a phone and marks it sent", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestA, guestB } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");

    await runScheduledRounds(eventId);

    await mock.waitForMessages(PHONE_A, 1);
    await mock.waitForMessages(PHONE_B, 1);

    const round = await getRound(eventId, "rsvp");
    expect(round.status).toBe("sent");
    expect(round.sent_at).not.toBeNull();

    const { rows } = await pool.query(
      `SELECT guest_id, last_rsvp_sent_at FROM event_guests WHERE event_id = $1`,
      [eventId],
    );
    for (const id of [guestA, guestB]) {
      expect(rows.find((r) => r.guest_id === id).last_rsvp_sent_at).not.toBeNull();
    }
  });

  it("sends a reminder round only to pending guests", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvpReminder", 2);

    await runScheduledRounds(eventId);

    await mock.waitForMessages(PHONE_B, 1); // pending guest
    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(0); // confirmed guest

    expect((await getRound(eventId, "rsvpReminder", 2)).status).toBe("sent");
  });

  it("skips rounds when the owner was moved back to the manual plan", async () => {
    await insertUser(OWNER, { plan: "manual" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");

    await runScheduledRounds(eventId);

    expect((await getRound(eventId, "rsvp")).status).toBe("skipped");
    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(0);
    expect(await mock.getMessages({ to: PHONE_B })).toHaveLength(0);
  });

  it("skips rounds when the owner lost messaging permission", async () => {
    await insertUser(OWNER, { plan: "scheduled", permission: "denied" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");

    await runScheduledRounds(eventId);

    expect((await getRound(eventId, "rsvp")).status).toBe("skipped");
    expect(await mock.getMessages({ to: PHONE_B })).toHaveLength(0);
  });

  it("skips a call round when voice calling is not configured", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "call", 1);

    await runScheduledRounds(eventId);

    // The test server has no Twilio config, so the round is skipped, not stuck
    expect((await getRound(eventId, "call", 1)).status).toBe("skipped");
  });

  it("a claimed round is not re-sent by a second sweep", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");

    await runScheduledRounds(eventId);
    await mock.waitForMessages(PHONE_B, 1);
    await runScheduledRounds(eventId);

    // Still exactly one invitation per guest
    expect(await mock.getMessages({ to: PHONE_B })).toHaveLength(1);
  });
});

describe("Guests added after the invitation round", () => {
  const addLateGuest = async (ownerID: string, eventId: number, name: string, phone: string) => {
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, $2, $3, 'bride', 'family', 1) RETURNING id`,
      [ownerID, name, phone],
    );
    await pool.query(`INSERT INTO event_guests (event_id, guest_id) VALUES ($1, $2)`, [eventId, guest.id]);
    return guest.id as number;
  };

  it("unsentOnly sends the invitation only to guests who never got any message", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");
    await runScheduledRounds(eventId);
    await mock.waitForMessages(PHONE_A, 1);
    await mock.waitForMessages(PHONE_B, 1);

    // The couple forgot this guest and adds them after the round went out
    await addLateGuest(OWNER, eventId, "late-guest", PHONE_C);

    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { eventId, unsentOnly: true } },
      { headers: authHeader(OWNER) },
    );

    const [invitation] = await mock.waitForMessages(PHONE_C, 1);
    expect(invitation.template?.name).toBe("wedding_rsvp_action");
    // The guests from the original round are not re-sent
    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(1);
    expect(await mock.getMessages({ to: PHONE_B })).toHaveLength(1);

    // The late guest is now stamped — a second unsentOnly has no one to send to
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { eventId, unsentOnly: true } },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("rejects combining failedOnly and unsentOnly", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId } = await seedEvent(OWNER);
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { eventId, failedOnly: true, unsentOnly: true } },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });
});

describe("Delivery failures → per-guest error, report, resend", () => {
  it("does not flag guests when a reminder delivery fails — only invitation failures feed the panel", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);
    // A *reminder* round goes out to pending guest B and its delivery fails
    await insertRound(eventId, "rsvpReminder", 1);
    await runScheduledRounds(eventId);
    const [reminder] = await mock.waitForMessages(PHONE_B, 1);
    expect(reminder.template?.name).toBe("wedding_rsvp_reminder");

    await postStatusWebhook([
      { status: "failed", recipient_id: PHONE_B.replace("+", ""), errors: [{ code: 131026 }] },
    ]);

    // Reminder failures are log-only: the guest is not flagged...
    const { rows } = await pool.query(
      `SELECT last_send_error FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(rows[0].last_send_error).toBeNull();

    // ...so there is nothing for the failed-only resend to send
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { eventId, failedOnly: true } },
        { headers: authHeader(OWNER) },
      ),
    ).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("the failed-only resend always sends the invitation", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);
    await pool.query(
      `UPDATE event_guests SET last_send_error = 'bad number' WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );

    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { eventId, failedOnly: true } },
      { headers: authHeader(OWNER) },
    );

    const [message] = await mock.waitForMessages(PHONE_B, 1);
    expect(message.template?.name).toBe("wedding_rsvp_action");
    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(0);
  });

  it("records webhook delivery failures on the guest and exposes them via the guests endpoint", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");
    await runScheduledRounds(eventId);
    await mock.waitForMessages(PHONE_B, 1);

    // Meta reports async that guest B's message couldn't be delivered
    await postStatusWebhook([
      {
        status: "failed",
        recipient_id: PHONE_B.replace("+", ""),
        errors: [{ code: 131026, title: "Message Undeliverable" }],
      },
    ]);

    const { rows } = await pool.query(
      `SELECT last_send_error FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(rows[0].last_send_error).toContain("131026");

    const { data: guests } = await axios.get(`${REAL_SERVER}/events/${eventId}/guests`, {
      headers: authHeader(OWNER),
    });
    expect(guests.find((g: any) => g.guest_id === guestB).last_send_error).toContain("131026");
  });

  it("marks failures as reported after the grace window (guest-based, not round-based)", async () => {
    await insertUser(OWNER, { plan: "scheduled" });
    const { eventId, guestB } = await seedEvent(OWNER);
    await insertRound(eventId, "rsvp");
    await runScheduledRounds(eventId);
    await mock.waitForMessages(PHONE_B, 1);

    await postStatusWebhook([
      { status: "failed", recipient_id: PHONE_B.replace("+", ""), errors: [{ code: 131026 }] },
    ]);

    // Second sweep runs the failure-report pass (bypassTime → no grace window).
    // Email itself no-ops in tests (EMAIL_USER is blanked); we assert the marker.
    await runScheduledRounds(eventId);

    const { rows: reported } = await pool.query(
      `SELECT last_send_error_reported_at FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(reported[0].last_send_error_reported_at).not.toBeNull();

    // guest B still carries the error → the failed-only resend targets exactly them
    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { messageType: "rsvp", eventId, failedOnly: true } },
      { headers: authHeader(OWNER) },
    );
    await mock.waitForMessages(PHONE_B, 2);
    expect(await mock.getMessages({ to: PHONE_A })).toHaveLength(1);
    const { rows } = await pool.query(
      `SELECT last_send_error FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(rows[0].last_send_error).toBeNull();
  });

  it("reports failures from manual invitation sends too (no scheduled round involved)", async () => {
    await insertUser(OWNER, { plan: "manual" });
    const { eventId, guestB } = await seedEvent(OWNER);

    // Manual-plan user sends the invitation themselves
    await axios.post(
      `${REAL_SERVER}/sendMessage`,
      { options: { messageType: "rsvp", eventId } },
      { headers: authHeader(OWNER) },
    );
    await mock.waitForMessages(PHONE_B, 1);

    await postStatusWebhook([
      { status: "failed", recipient_id: PHONE_B.replace("+", ""), errors: [{ code: 131026 }] },
    ]);

    // The sweep reports it even though no scheduled round exists for this event
    await runScheduledRounds(eventId);

    const { rows } = await pool.query(
      `SELECT last_send_error, last_send_error_reported_at FROM event_guests WHERE event_id = $1 AND guest_id = $2`,
      [eventId, guestB],
    );
    expect(rows[0].last_send_error).toContain("131026");
    expect(rows[0].last_send_error_reported_at).not.toBeNull();
  });
});
