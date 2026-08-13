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
