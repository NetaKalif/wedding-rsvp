/**
 * Admin approval-gate tests.
 * Covers the pending/approved/declined user status lifecycle: admin-only
 * access to the review endpoints, and that Database.addUser never clobbers
 * an existing user's status on repeat login.
 */

import axios from "axios";
import { Pool } from "pg";
import Database from "../../src/dbUtils";
import { authHeader, TEST_USER_ID } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const insertUser = (userID: string, status: "pending" | "approved" | "declined") =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status) VALUES ($1, $2, $3, $4)
     ON CONFLICT ("userID") DO UPDATE SET status = EXCLUDED.status`,
    [userID, `${userID}@test.com`, userID, status],
  );

const getStatus = async (userID: string): Promise<string> => {
  const { rows } = await pool.query(`SELECT status FROM users WHERE "userID" = $1`, [userID]);
  return rows[0]?.status;
};

const deleteUser = (userID: string) =>
  pool.query(`DELETE FROM users WHERE "userID" = $1`, [userID]);

const getPendingUsers = () =>
  axios.post(`${REAL_SERVER}/admin/getPendingUsers`, {}, { headers: authHeader(TEST_USER_ID, { isAdmin: true }) });

const approveUser = (userID: string) =>
  axios.post(`${REAL_SERVER}/admin/approveUser`, { userID }, { headers: authHeader(TEST_USER_ID, { isAdmin: true }) });

const declineUser = (userID: string) =>
  axios.post(`${REAL_SERVER}/admin/declineUser`, { userID }, { headers: authHeader(TEST_USER_ID, { isAdmin: true }) });

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Admin-only access", () => {
  it("non-admin is rejected from all three endpoints", async () => {
    await expect(
      axios.post(`${REAL_SERVER}/admin/getPendingUsers`, {}, { headers: authHeader(TEST_USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });

    await expect(
      axios.post(`${REAL_SERVER}/admin/approveUser`, { userID: "someone" }, { headers: authHeader(TEST_USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });

    await expect(
      axios.post(`${REAL_SERVER}/admin/declineUser`, { userID: "someone" }, { headers: authHeader(TEST_USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("Pending user review", () => {
  const PENDING_USER_ID = "pending-review-user";

  afterEach(async () => {
    await deleteUser(PENDING_USER_ID);
  });

  it("a pending user shows up in the admin's pending list", async () => {
    await insertUser(PENDING_USER_ID, "pending");

    const { data } = await getPendingUsers();
    expect(data.some((u: any) => u.userID === PENDING_USER_ID)).toBe(true);
  });

  it("approving a pending user updates their status and removes them from the pending list", async () => {
    await insertUser(PENDING_USER_ID, "pending");

    await approveUser(PENDING_USER_ID);

    expect(await getStatus(PENDING_USER_ID)).toBe("approved");
    const { data } = await getPendingUsers();
    expect(data.some((u: any) => u.userID === PENDING_USER_ID)).toBe(false);
  });

  it("declining a pending user updates their status and removes them from the pending list", async () => {
    await insertUser(PENDING_USER_ID, "pending");

    await declineUser(PENDING_USER_ID);

    expect(await getStatus(PENDING_USER_ID)).toBe("declined");
    const { data } = await getPendingUsers();
    expect(data.some((u: any) => u.userID === PENDING_USER_ID)).toBe(false);
  });

  it("404s approving an unknown userID", async () => {
    await expect(approveUser("no-such-approval-test-user")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it("404s declining an unknown userID", async () => {
    await expect(declineUser("no-such-approval-test-user")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });
});

describe("Database.addUser status semantics", () => {
  const NEW_USER_ID = "brand-new-signup-user";

  afterEach(async () => {
    await deleteUser(NEW_USER_ID);
  });

  it("a first-time sign-up is inserted with the requested initial status", async () => {
    const db = await Database.connect();

    const result = await db.addUser(
      { userID: NEW_USER_ID, email: "new@test.com", name: "New User" },
      "pending",
    );

    expect(result).toEqual({ isNewUser: true, status: "pending" });
    expect(await getStatus(NEW_USER_ID)).toBe("pending");
  });

  it("a repeat login never clobbers an existing approved/declined status", async () => {
    const db = await Database.connect();
    await insertUser(NEW_USER_ID, "declined");

    const result = await db.addUser(
      { userID: NEW_USER_ID, email: "new@test.com", name: "New User" },
      "pending",
    );

    // isNewUser is false and the pre-existing "declined" status survives —
    // addUser's ON CONFLICT clause deliberately omits `status`.
    expect(result).toEqual({ isNewUser: false, status: "declined" });
    expect(await getStatus(NEW_USER_ID)).toBe("declined");
  });
});
