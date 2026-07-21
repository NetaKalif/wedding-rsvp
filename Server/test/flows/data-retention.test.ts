/**
 * 60-day post-wedding data retention & deletion tests.
 * Covers: no-op before day 57, warning-sent at day 57 (idempotent), deletion
 * only after a confirmed warning (day 60+), dual owner+partner deletion,
 * admin cancel/list, and postponing the wedding restarting the countdown.
 *
 * Uses its own dedicated users/events (never the shared seeded fixture from
 * globalSetup.ts) since this suite mutates account-deletion state.
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

// ── Date helpers — match the server's UTC-calendar-day arithmetic ───────────

const dateOffset = (daysAgo: number): string => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - daysAgo);
  return d.toISOString().split("T")[0];
};

// ── DB setup/teardown helpers ────────────────────────────────────────────────

const insertUser = (userID: string, primaryUserID?: string) =>
  pool.query(
    `INSERT INTO users ("userID", email, name, primary_user_id) VALUES ($1, $2, $3, $4)`,
    [userID, `${userID}@test.com`, userID, primaryUserID ?? null],
  );

const insertPrimaryEvent = async (
  userID: string,
  daysAgo: number,
  opts: { warningSent?: boolean; cancelled?: boolean } = {},
): Promise<number> => {
  const { rows } = await pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name,
       deletion_warning_sent_at, deletion_cancelled_at)
     VALUES ($1, TRUE, 'חתונה', $2, 'כלה', 'חתן',
       CASE WHEN $3 THEN CURRENT_TIMESTAMP ELSE NULL END,
       CASE WHEN $4 THEN CURRENT_TIMESTAMP ELSE NULL END)
     RETURNING id`,
    [userID, dateOffset(daysAgo), !!opts.warningSent, !!opts.cancelled],
  );
  return rows[0].id;
};

const getEventState = async (eventId: number) => {
  const { rows } = await pool.query(
    `SELECT deletion_warning_sent_at, deletion_cancelled_at FROM events WHERE id = $1`,
    [eventId],
  );
  return rows[0] as { deletion_warning_sent_at: Date | null; deletion_cancelled_at: Date | null } | undefined;
};

const userExists = async (userID: string): Promise<boolean> => {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE "userID" = $1`, [userID]);
  return rows.length > 0;
};

const getDeletedAccountRoles = async (userID: string): Promise<string[]> => {
  const { rows } = await pool.query(`SELECT role FROM deleted_accounts WHERE user_id = $1`, [userID]);
  return rows.map((r) => r.role);
};

const deleteUsers = (userIDs: string[]) =>
  pool.query(`DELETE FROM users WHERE "userID" = ANY($1)`, [userIDs]);

const deleteDeletedAccountRows = (userIDs: string[]) =>
  pool.query(`DELETE FROM deleted_accounts WHERE user_id = ANY($1)`, [userIDs]);

const runRetentionCheck = () => axios.post(`${REAL_SERVER}/test/run-retention-check`);

const patchEventDate = (eventId: number, userID: string, date: string) =>
  axios.patch(`${REAL_SERVER}/events/${eventId}`, { date }, { headers: authHeader(userID) });

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Before the warning window (day < 57)", () => {
  const USER_ID = "retention-day56-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 56);
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("does not send a warning or delete the account", async () => {
    await runRetentionCheck();

    const state = await getEventState(eventId);
    expect(state?.deletion_warning_sent_at).toBeNull();
    expect(await userExists(USER_ID)).toBe(true);
  });
});

describe("Warning window (day 57)", () => {
  const USER_ID = "retention-day57-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 57);
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("sends the warning exactly once, even across repeated runs", async () => {
    await runRetentionCheck();
    const firstState = await getEventState(eventId);
    expect(firstState?.deletion_warning_sent_at).not.toBeNull();

    await runRetentionCheck();
    const secondState = await getEventState(eventId);
    expect(secondState?.deletion_warning_sent_at?.getTime()).toBe(
      firstState?.deletion_warning_sent_at?.getTime(),
    );

    // Well within the 60-day deletion threshold — account survives.
    expect(await userExists(USER_ID)).toBe(true);
  });
});

describe("Deletion (day >= 60)", () => {
  const USER_ID = "retention-day60-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 60);
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("only deletes once a warning has been confirmed sent on a prior run", async () => {
    // First run: no warning sent yet, so this run only sends & marks the
    // warning — it must NOT delete the account in the same pass.
    await runRetentionCheck();
    expect(await userExists(USER_ID)).toBe(true);
    const afterWarning = await getEventState(eventId);
    expect(afterWarning?.deletion_warning_sent_at).not.toBeNull();

    // Second run: warning is now confirmed sent from the DB's perspective,
    // and days-since-wedding is still >= 60 — deletion proceeds.
    await runRetentionCheck();
    expect(await userExists(USER_ID)).toBe(false);
    expect(await getDeletedAccountRoles(USER_ID)).toEqual(["owner"]);
  });
});

describe("Deletion cascades to a linked partner account", () => {
  const OWNER_ID = "retention-owner-user";
  const PARTNER_ID = "retention-partner-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(OWNER_ID);
    await insertUser(PARTNER_ID, OWNER_ID);
    // Warning already confirmed sent — simulates day 60 arriving 3+ days
    // after the day-57 warning went out.
    eventId = await insertPrimaryEvent(OWNER_ID, 60, { warningSent: true });
  });

  afterEach(async () => {
    await deleteUsers([OWNER_ID, PARTNER_ID]);
    await deleteDeletedAccountRows([OWNER_ID, PARTNER_ID]);
  });

  it("deletes both the owner and the linked partner, recording both in the audit table", async () => {
    await runRetentionCheck();

    expect(await userExists(OWNER_ID)).toBe(false);
    expect(await userExists(PARTNER_ID)).toBe(false);
    expect(await getDeletedAccountRoles(OWNER_ID)).toEqual(["owner"]);
    expect(await getDeletedAccountRoles(PARTNER_ID)).toEqual(["partner"]);
  });
});

describe("Admin cancellation stops the deletion", () => {
  const USER_ID = "retention-cancelled-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 61, { warningSent: true, cancelled: true });
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("never deletes a cancelled account, however many days have passed", async () => {
    await runRetentionCheck();
    expect(await userExists(USER_ID)).toBe(true);
    expect(await getDeletedAccountRoles(USER_ID)).toEqual([]);
  });
});

describe("Postponing the wedding date restarts the countdown", () => {
  const USER_ID = "retention-postpone-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 57);
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("clears deletion_warning_sent_at when the primary event's date changes", async () => {
    await runRetentionCheck();
    expect((await getEventState(eventId))?.deletion_warning_sent_at).not.toBeNull();

    await patchEventDate(eventId, USER_ID, dateOffset(-30)); // postponed 30 days into the future

    const state = await getEventState(eventId);
    expect(state?.deletion_warning_sent_at).toBeNull();
  });
});

describe("Admin scheduled-deletions view", () => {
  const USER_ID = "retention-admin-view-user";
  let eventId: number;

  beforeEach(async () => {
    await insertUser(USER_ID);
    eventId = await insertPrimaryEvent(USER_ID, 57);
  });

  afterEach(async () => {
    await deleteUsers([USER_ID]);
    await deleteDeletedAccountRows([USER_ID]);
  });

  it("lists the account and lets an admin cancel its scheduled deletion", async () => {
    const { data: before } = await axios.post(
      `${REAL_SERVER}/admin/getScheduledDeletions`,
      {},
      { headers: authHeader("retention-admin", { isAdmin: true }) },
    );
    expect(before.some((d: any) => d.userID === USER_ID)).toBe(true);

    await axios.post(
      `${REAL_SERVER}/admin/cancelScheduledDeletion`,
      { userID: USER_ID },
      { headers: authHeader("retention-admin", { isAdmin: true }) },
    );

    const state = await getEventState(eventId);
    expect(state?.deletion_cancelled_at).not.toBeNull();

    await runRetentionCheck();
    expect(await userExists(USER_ID)).toBe(true);
  });

  it("rejects non-admins", async () => {
    await expect(
      axios.post(`${REAL_SERVER}/admin/getScheduledDeletions`, {}, { headers: authHeader(USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});
