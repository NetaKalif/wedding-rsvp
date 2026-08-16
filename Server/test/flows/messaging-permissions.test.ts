/**
 * Messaging permission tests.
 * Covers the messaging_permission_status lifecycle: user requests permission,
 * admin approves/revokes via /admin/setMessagingPermission, the pending flag
 * surfaces in getAllUsersDetailed, and /sendMessage is blocked without approval.
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader, TEST_USER_ID } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";
import { MockWhatsAppClient } from "../mock-whatsapp/client";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const insertUser = (userID: string, status: "pending" | "approved" | "declined" = "approved") =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT ("userID") DO UPDATE SET status = EXCLUDED.status`,
    [userID, `${userID}@test.com`, userID, status],
  );

const getMessagingPermissionStatus = async (userID: string): Promise<string> => {
  const { rows } = await pool.query(
    `SELECT messaging_permission_status FROM users WHERE "userID" = $1`,
    [userID],
  );
  return rows[0]?.messaging_permission_status || "denied";
};

const deleteUser = (userID: string) =>
  pool.query(`DELETE FROM users WHERE "userID" = $1`, [userID]);

const requestMessagingPermission = (userID: string) =>
  axios.post(
    `${REAL_SERVER}/user/requestMessagingPermission`,
    {},
    { headers: authHeader(userID) },
  );

const getMessagingPermissionStatusEndpoint = (userID: string) =>
  axios.get(
    `${REAL_SERVER}/user/messagingPermissionStatus`,
    { headers: authHeader(userID) },
  );

const setMessagingPermission = (userID: string, approved: boolean) =>
  axios.post(
    `${REAL_SERVER}/admin/setMessagingPermission`,
    { userID, approved },
    { headers: authHeader(TEST_USER_ID, { isAdmin: true }) },
  );

const getAllUsersDetailed = () =>
  axios.post(
    `${REAL_SERVER}/admin/getAllUsersDetailed`,
    {},
    { headers: authHeader(TEST_USER_ID, { isAdmin: true }) },
  );

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Messaging permission status", () => {
  const TEST_MESSAGING_USER_ID = "messaging-test-user";

  afterEach(async () => {
    await deleteUser(TEST_MESSAGING_USER_ID);
  });

  it("new approved users start with denied messaging permission", async () => {
    await insertUser(TEST_MESSAGING_USER_ID, "approved");
    expect(await getMessagingPermissionStatus(TEST_MESSAGING_USER_ID)).toBe("denied");
  });

  it("user can check their messaging permission status", async () => {
    await insertUser(TEST_MESSAGING_USER_ID, "approved");
    const { data } = await getMessagingPermissionStatusEndpoint(TEST_MESSAGING_USER_ID);
    expect(data.status).toBe("denied");
    expect(data.hasPendingRequest).toBe(false);
  });

  it("sendMessage is blocked (403) without messaging permission", async () => {
    await insertUser(TEST_MESSAGING_USER_ID, "approved");
    await expect(
      axios.post(
        `${REAL_SERVER}/sendMessage`,
        { options: { messageType: "rsvp" } },
        { headers: authHeader(TEST_MESSAGING_USER_ID) },
      ),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("Messaging permission requests via the admin users table", () => {
  const REQUEST_TEST_USER = "messaging-request-user";

  afterEach(async () => {
    await deleteUser(REQUEST_TEST_USER);
  });

  it("user can request messaging permission", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await requestMessagingPermission(REQUEST_TEST_USER);
    const { data } = await getMessagingPermissionStatusEndpoint(REQUEST_TEST_USER);
    expect(data.hasPendingRequest).toBe(true);
  });

  it("pending request and permission status surface in getAllUsersDetailed", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await requestMessagingPermission(REQUEST_TEST_USER);

    const { data } = await getAllUsersDetailed();
    const row = data.find((u: any) => u.userID === REQUEST_TEST_USER);
    expect(row).toBeDefined();
    expect(row.messagingPermissionStatus).toBe("denied");
    expect(row.hasPendingMessageRequest).toBe(true);
  });

  it("admin approval grants permission and clears the pending request", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await requestMessagingPermission(REQUEST_TEST_USER);

    await setMessagingPermission(REQUEST_TEST_USER, true);

    expect(await getMessagingPermissionStatus(REQUEST_TEST_USER)).toBe("approved");
    const { data } = await getAllUsersDetailed();
    const row = data.find((u: any) => u.userID === REQUEST_TEST_USER);
    expect(row.messagingPermissionStatus).toBe("approved");
    expect(row.hasPendingMessageRequest).toBe(false);
  });

  it("admin denial keeps permission denied and clears the pending request", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await requestMessagingPermission(REQUEST_TEST_USER);

    await setMessagingPermission(REQUEST_TEST_USER, false);

    expect(await getMessagingPermissionStatus(REQUEST_TEST_USER)).toBe("denied");
    const { data } = await getMessagingPermissionStatusEndpoint(REQUEST_TEST_USER);
    expect(data.hasPendingRequest).toBe(false);
  });

  it("admin can revoke a previously approved permission", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await setMessagingPermission(REQUEST_TEST_USER, true);
    expect(await getMessagingPermissionStatus(REQUEST_TEST_USER)).toBe("approved");

    await setMessagingPermission(REQUEST_TEST_USER, false);
    expect(await getMessagingPermissionStatus(REQUEST_TEST_USER)).toBe("denied");
  });

  it("duplicate requests don't create a second pending request", async () => {
    await insertUser(REQUEST_TEST_USER, "approved");
    await requestMessagingPermission(REQUEST_TEST_USER);
    await requestMessagingPermission(REQUEST_TEST_USER);

    const { rows } = await pool.query(
      `SELECT COUNT(*)::int as count FROM message_permission_requests
       WHERE user_id = $1 AND status = 'pending'`,
      [REQUEST_TEST_USER],
    );
    expect(rows[0].count).toBe(1);
  });

  it("404s for an unknown userID", async () => {
    await expect(setMessagingPermission("no-such-user", true)).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

describe("Admin access control", () => {
  it("non-admin is rejected from setMessagingPermission", async () => {
    await expect(
      axios.post(
        `${REAL_SERVER}/admin/setMessagingPermission`,
        { userID: "someone", approved: true },
        { headers: authHeader("some-user") },
      ),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("Scheduled messages respect messaging permission", () => {
  const mock = new MockWhatsAppClient();
  const ALLOWED_OWNER = "sched-allowed-owner";
  const DENIED_OWNER = "sched-denied-owner";
  const ALLOWED_PHONE = "+972509990001";
  const DENIED_PHONE = "+972509990002";

  // Seeds an owner with a primary event dated today, wedding-day reminder on,
  // and one confirmed guest — i.e. an event the scheduler would send for.
  const seedReminderEvent = async (
    ownerID: string,
    messagingPermission: "approved" | "denied",
    phone: string,
  ) => {
    await pool.query(
      `INSERT INTO users ("userID", email, name, messaging_permission_status)
       VALUES ($1, $2, $3, $4)`,
      [ownerID, `${ownerID}@test.com`, ownerID, messagingPermission],
    );
    const { rows: [guest] } = await pool.query(
      `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests)
       VALUES ($1, $2, $3, 'bride', 'family', 1) RETURNING id`,
      [ownerID, `${ownerID}-guest`, phone],
    );
    // Same date format the scheduler compares against (getDateFormat → UTC yyyy-mm-dd)
    const today = new Date().toISOString().split("T")[0];
    const { rows: [event] } = await pool.query(
      `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name,
                           send_reminder, reminder_day, reminder_time)
       VALUES ($1, TRUE, 'חתונה', $2, 'כלה', 'חתן', TRUE, 'wedding_day', '09:00') RETURNING id`,
      [ownerID, today],
    );
    await pool.query(
      `INSERT INTO event_guests (event_id, guest_id, rsvp_status) VALUES ($1, $2, 2)`,
      [event.id, guest.id],
    );
  };

  afterEach(async () => {
    // Cascades to the seeded guests/events/event_guests
    await deleteUser(ALLOWED_OWNER);
    await deleteUser(DENIED_OWNER);
  });

  it("the scheduler sends for approved owners and skips owners without permission", async () => {
    await mock.reset();
    await seedReminderEvent(ALLOWED_OWNER, "approved", ALLOWED_PHONE);
    await seedReminderEvent(DENIED_OWNER, "denied", DENIED_PHONE);

    await axios.post(`${REAL_SERVER}/test/run-scheduled-messages`);

    const allowedMessages = await mock.waitForMessages(ALLOWED_PHONE, 1);
    expect(allowedMessages.length).toBeGreaterThanOrEqual(1);

    const deniedMessages = await mock.getMessages({ to: DENIED_PHONE });
    expect(deniedMessages).toHaveLength(0);
  });
});
