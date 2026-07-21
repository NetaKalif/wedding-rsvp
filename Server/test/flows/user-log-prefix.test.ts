/**
 * Server console logs are prefixed with the acting user's display name, via
 * an in-memory cache (logger.ts) that Database keeps in sync whenever a user
 * is added or removed. Covers that the cache reflects add/delete immediately,
 * and that logs with no associated user fall back to a [SYSTEM] tag.
 */

import { Pool } from "pg";
import Database from "../../src/dbUtils";
import { log } from "../../src/logger";
import { DATABASE_URL } from "../globalSetup";

const pool = new Pool({ connectionString: DATABASE_URL, ssl: false });

const TEST_USER_ID = "log-prefix-test-user";

const deleteTestUser = () =>
  pool.query(`DELETE FROM users WHERE "userID" = $1`, [TEST_USER_ID]);

afterEach(async () => {
  await deleteTestUser();
});

afterAll(async () => {
  await pool.end();
});

describe("console log user-name prefix", () => {
  it("prefixes with the user's name once they're added, and falls back to their raw ID once removed", async () => {
    const db = await Database.connect();
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      await db.addUser(
        { userID: TEST_USER_ID, email: `${TEST_USER_ID}@test.com`, name: "Prefix Test User" },
        "approved",
      );

      log(TEST_USER_ID, "hello after add");
      expect(consoleLogSpy).toHaveBeenLastCalledWith("[Prefix Test User]", "hello after add");

      await db.deleteUser(TEST_USER_ID);

      log(TEST_USER_ID, "hello after delete");
      expect(consoleLogSpy).toHaveBeenLastCalledWith(`[${TEST_USER_ID}]`, "hello after delete");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });

  it("tags logs with no associated user as [SYSTEM]", () => {
    const consoleLogSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      log(undefined, "system-level message");
      expect(consoleLogSpy).toHaveBeenLastCalledWith("[SYSTEM]", "system-level message");
    } finally {
      consoleLogSpy.mockRestore();
    }
  });
});
