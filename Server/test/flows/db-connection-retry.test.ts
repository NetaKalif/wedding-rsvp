/**
 * Unit tests for runQuery's retry-on-connect-failure behavior (pg is mocked —
 * no real DB involved).
 *
 * A "Connection terminated due to connection timeout" / "timeout exceeded when
 * trying to connect" error is raised while the pool is still establishing or
 * acquiring a connection, i.e. before the query is sent, so retrying once is
 * always safe. Mid-query connection drops and SQL errors must NOT be retried
 * (the statement may already have executed).
 */

const mockQuery = jest.fn();
const mockOn = jest.fn();

jest.mock("pg", () => ({
  Pool: jest.fn(() => ({ query: mockQuery, on: mockOn })),
}));

import Database from "../../src/dbUtils";

// The constructor is private (singleton) — bypass for unit testing runQuery.
const db = new (Database as any)();

beforeEach(() => {
  mockQuery.mockReset();
});

describe("pool idle-client error handling", () => {
  test("registers an 'error' listener on the pool so an idle connection drop can't crash the process", () => {
    // Node kills the process on an unhandled 'error' event, so the listener
    // itself is the fix (seen in prod: ECONNABORTED from Aiven on an idle
    // client took the whole server down).
    const errorCalls = mockOn.mock.calls.filter(([event]) => event === "error");
    expect(errorCalls).toHaveLength(1);

    // The handler must swallow the error (log it), never rethrow.
    const handler = errorCalls[0][1];
    expect(() => handler(new Error("read ECONNABORTED"))).not.toThrow();
  });
});

describe("runQuery connect-failure retry", () => {
  test("retries once when the pool times out establishing a connection", async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("Connection terminated due to connection timeout"))
      .mockResolvedValueOnce({ rows: [{ ok: 1 }] });

    const rows = await db.runQuery("SELECT 1;", []);

    expect(rows).toEqual([{ ok: 1 }]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test("retries once when acquiring a client from the pool times out", async () => {
    mockQuery
      .mockRejectedValueOnce(new Error("timeout exceeded when trying to connect"))
      .mockResolvedValueOnce({ rows: [] });

    const rows = await db.runQuery("INSERT INTO x VALUES ($1);", [1]);

    expect(rows).toEqual([]);
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test("throws if the retry also fails", async () => {
    mockQuery.mockRejectedValue(new Error("Connection terminated due to connection timeout"));

    await expect(db.runQuery("SELECT 1;", [])).rejects.toThrow("connection timeout");
    expect(mockQuery).toHaveBeenCalledTimes(2);
  });

  test("does NOT retry a mid-query connection drop (query may have executed)", async () => {
    mockQuery.mockRejectedValue(new Error("Connection terminated unexpectedly"));

    await expect(db.runQuery("UPDATE x SET y=1;", [])).rejects.toThrow("unexpectedly");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });

  test("does NOT retry SQL errors", async () => {
    mockQuery.mockRejectedValue(new Error('column "nope" does not exist'));

    await expect(db.runQuery("SELECT nope;", [])).rejects.toThrow("does not exist");
    expect(mockQuery).toHaveBeenCalledTimes(1);
  });
});
