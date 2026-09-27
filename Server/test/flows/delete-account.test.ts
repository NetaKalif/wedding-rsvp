/**
 * Self-service account deletion (/deleteUser) guard tests.
 *
 * Regression suite for the 2026-09-26 incident: a UI cancel path called
 * DELETE /deleteUser implicitly and hard-deleted real accounts. The route now
 * requires an explicit confirm=true, refuses to run while impersonating, and
 * writes a deleted_accounts tombstone before deleting.
 *
 * Uses its own dedicated users (never the shared seeded fixture).
 */

import axios from "axios";
import { Pool } from "pg";
import { authHeader } from "../helpers/auth";
import { DATABASE_URL } from "../globalSetup";

const REAL_SERVER = process.env.REAL_SERVER_URL ?? "http://localhost:8080";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const OWNER = "del-acct-owner";
const PARTNER = "del-acct-partner";
const ADMIN = "del-acct-admin";

const insertUser = (userID: string, primaryUserID?: string) =>
  pool.query(
    `INSERT INTO users ("userID", email, name, status, primary_user_id)
     VALUES ($1, $2, $3, 'approved', $4)
     ON CONFLICT ("userID") DO UPDATE SET primary_user_id = EXCLUDED.primary_user_id`,
    [userID, `${userID}@test.com`, userID, primaryUserID ?? null],
  );

const insertPrimaryEvent = (userID: string, date: string) =>
  pool.query(
    `INSERT INTO events (user_id, is_primary, ceremony_name, date, bride_name, groom_name)
     VALUES ($1, TRUE, 'חתונה', $2, 'כלה', 'חתן')`,
    [userID, date],
  );

const insertGuest = (userID: string, phone: string) =>
  pool.query(
    `INSERT INTO guests (user_id, name, phone, whose, circle, number_of_guests) VALUES ($1, 'אורח', $2, 'חתן', 'משפחה', 1)`,
    [userID, phone],
  );

const userExists = async (userID: string): Promise<boolean> => {
  const { rows } = await pool.query(`SELECT 1 FROM users WHERE "userID" = $1`, [userID]);
  return rows.length > 0;
};

const guestCount = async (userID: string): Promise<number> => {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM guests WHERE user_id = $1`, [userID]);
  return rows[0].n;
};

const getTombstones = async (userID: string) => {
  const { rows } = await pool.query(
    `SELECT role, wedding_date FROM deleted_accounts WHERE user_id = $1`,
    [userID],
  );
  return rows as { role: string; wedding_date: string | null }[];
};

const deleteUserRequest = (
  userID: string,
  opts: { confirm?: boolean; actor?: string } = {},
) =>
  axios.delete(`${REAL_SERVER}/deleteUser${opts.confirm ? "?confirm=true" : ""}`, {
    headers: authHeader(userID, opts.actor ? { actor: opts.actor } : {}),
    validateStatus: () => true,
  });

const cleanup = async () => {
  await pool.query(`DELETE FROM users WHERE "userID" = ANY($1::text[])`, [[OWNER, PARTNER, ADMIN]]);
  await pool.query(`DELETE FROM deleted_accounts WHERE user_id = ANY($1::text[])`, [[OWNER, PARTNER, ADMIN]]);
};

beforeEach(async () => {
  await cleanup();
  await insertUser(ADMIN);
  await insertUser(OWNER);
  await insertUser(PARTNER, OWNER);
  await insertPrimaryEvent(OWNER, "2030-05-20");
  await insertGuest(OWNER, "+972500000201");
});

afterAll(async () => {
  await cleanup();
  await pool.end();
});

describe("DELETE /deleteUser guards", () => {
  test("without confirm=true the request is rejected and nothing is deleted", async () => {
    const res = await deleteUserRequest(OWNER);
    expect(res.status).toBe(400);
    expect(await userExists(OWNER)).toBe(true);
    expect(await guestCount(OWNER)).toBe(1);
    expect(await getTombstones(OWNER)).toHaveLength(0);
  });

  test("refuses to delete while an admin is impersonating the account", async () => {
    const res = await deleteUserRequest(OWNER, { confirm: true, actor: ADMIN });
    expect(res.status).toBe(403);
    expect(await userExists(OWNER)).toBe(true);
  });

  test("confirmed self-delete removes the account, cascades data, and writes an owner tombstone", async () => {
    const res = await deleteUserRequest(OWNER, { confirm: true });
    expect(res.status).toBe(200);

    expect(await userExists(OWNER)).toBe(false);
    expect(await guestCount(OWNER)).toBe(0);

    const tombstones = await getTombstones(OWNER);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].role).toBe("owner");
    expect(tombstones[0].wedding_date).toBe("2030-05-20");

    // Only the requesting account is deleted — the linked partner survives.
    expect(await userExists(PARTNER)).toBe(true);
  });

  test("a linked partner self-deleting gets a partner tombstone and leaves the owner intact", async () => {
    const res = await deleteUserRequest(PARTNER, { confirm: true });
    expect(res.status).toBe(200);

    expect(await userExists(PARTNER)).toBe(false);
    expect(await userExists(OWNER)).toBe(true);
    expect(await guestCount(OWNER)).toBe(1);

    const tombstones = await getTombstones(PARTNER);
    expect(tombstones).toHaveLength(1);
    expect(tombstones[0].role).toBe("partner");
    // The tombstone records the shared wedding date resolved via the owner.
    expect(tombstones[0].wedding_date).toBe("2030-05-20");
  });
});
