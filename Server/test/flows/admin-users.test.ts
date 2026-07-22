/**
 * Admin "Users" page endpoint tests.
 * Covers: admin-only access, the all-statuses/partner-linked detailed listing,
 * and admin-triggered user deletion (including cascade to a linked partner).
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader, TEST_USER_ID } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";
// logMessage requires the acting admin's userID to exist in `users` (FK on
// clientLogs), so this reuses the shared seeded fixture user rather than an
// unseeded fictional ID — see test/globalSetup.ts.
const ADMIN_ID = TEST_USER_ID;

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const insertUser = (userID: string, status: "pending" | "approved" | "declined", primaryUserID?: string) =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status, primary_user_id) VALUES ($1, $2, $3, $4, $5)`,
    [userID, `${userID}@test.com`, userID, status, primaryUserID ?? null],
  );

const userExists = async (userID: string): Promise<boolean> => {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE "userID" = $1`, [userID]);
  return rows.length > 0;
};

const deleteUsers = (userIDs: string[]) =>
  pool.query(`DELETE FROM users WHERE "userID" = ANY($1)`, [userIDs]);

const getAllUsersDetailed = (asAdmin = ADMIN_ID) =>
  axios.post(`${REAL_SERVER}/admin/getAllUsersDetailed`, {}, { headers: authHeader(asAdmin, { isAdmin: true }) });

const adminDeleteUser = (userID: string, asAdmin = ADMIN_ID) =>
  axios.post(`${REAL_SERVER}/admin/deleteUser`, { userID }, { headers: authHeader(asAdmin, { isAdmin: true }) });

afterAll(async () => {
  await pool.end();
});

// ─────────────────────────────────────────────────────────────────────────────

describe("Admin-only access", () => {
  it("non-admin is rejected from both endpoints", async () => {
    await expect(
      axios.post(`${REAL_SERVER}/admin/getAllUsersDetailed`, {}, { headers: authHeader(TEST_USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });

    await expect(
      axios.post(`${REAL_SERVER}/admin/deleteUser`, { userID: "someone" }, { headers: authHeader(TEST_USER_ID) }),
    ).rejects.toMatchObject({ response: { status: 403 } });
  });
});

describe("Detailed user listing", () => {
  const PENDING_ID = "admin-users-pending";
  const APPROVED_OWNER_ID = "admin-users-owner";
  const APPROVED_PARTNER_ID = "admin-users-partner";
  const DECLINED_ID = "admin-users-declined";

  beforeEach(async () => {
    await insertUser(PENDING_ID, "pending");
    await insertUser(APPROVED_OWNER_ID, "approved");
    await insertUser(APPROVED_PARTNER_ID, "approved", APPROVED_OWNER_ID);
    await insertUser(DECLINED_ID, "declined");
  });

  afterEach(async () => {
    await deleteUsers([PENDING_ID, APPROVED_OWNER_ID, APPROVED_PARTNER_ID, DECLINED_ID]);
  });

  it("lists users of every status, with partner links populated both ways", async () => {
    const { data } = await getAllUsersDetailed();
    const byId = (id: string) => data.find((u: any) => u.userID === id);

    expect(byId(PENDING_ID)?.status).toBe("pending");
    expect(byId(APPROVED_OWNER_ID)?.status).toBe("approved");
    expect(byId(DECLINED_ID)?.status).toBe("declined");

    expect(byId(APPROVED_OWNER_ID)?.partnerName).toBe(APPROVED_PARTNER_ID);
    expect(byId(APPROVED_PARTNER_ID)?.linkedToName).toBe(APPROVED_OWNER_ID);
  });
});

describe("Admin user deletion", () => {
  const USER_ID = "admin-users-delete-target";

  afterEach(async () => {
    await deleteUsers([USER_ID]);
  });

  it("requires userID in the body", async () => {
    await expect(adminDeleteUser("")).rejects.toMatchObject({ response: { status: 400 } });
  });

  it("rejects an admin trying to delete the account they're currently acting as", async () => {
    await insertUser(USER_ID, "approved");
    await expect(adminDeleteUser(USER_ID, USER_ID)).rejects.toMatchObject({ response: { status: 400 } });
    expect(await userExists(USER_ID)).toBe(true);
  });

  it("404s for an unknown userID", async () => {
    await expect(adminDeleteUser("no-such-admin-users-test-user")).rejects.toMatchObject({
      response: { status: 404 },
    });
  });

  it("deletes the target user", async () => {
    await insertUser(USER_ID, "approved");

    await adminDeleteUser(USER_ID);

    expect(await userExists(USER_ID)).toBe(false);
  });
});

describe("Admin user deletion cascades to a linked partner", () => {
  const OWNER_ID = "admin-users-delete-owner";
  const PARTNER_ID = "admin-users-delete-partner";

  afterEach(async () => {
    await deleteUsers([OWNER_ID, PARTNER_ID]);
  });

  it("deleting the primary owner also deletes their linked partner", async () => {
    await insertUser(OWNER_ID, "approved");
    await insertUser(PARTNER_ID, "approved", OWNER_ID);

    await adminDeleteUser(OWNER_ID);

    expect(await userExists(OWNER_ID)).toBe(false);
    expect(await userExists(PARTNER_ID)).toBe(false);
  });

  it("deleting only the linked partner leaves the owner intact", async () => {
    await insertUser(OWNER_ID, "approved");
    await insertUser(PARTNER_ID, "approved", OWNER_ID);

    await adminDeleteUser(PARTNER_ID);

    expect(await userExists(PARTNER_ID)).toBe(false);
    expect(await userExists(OWNER_ID)).toBe(true);
  });
});
