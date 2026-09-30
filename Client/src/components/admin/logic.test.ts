import { getSortValue, daysUntilWedding } from "./logic";
import { AdminUserRow } from "../../httpClient";

const userRow = (name: string, weddingDate: string | null): AdminUserRow => ({
  userID: name,
  email: `${name}@example.com`,
  name,
  status: "approved",
  primaryUserID: null,
  linkedToName: null,
  partnerName: null,
  weddingDate,
  warningSentAt: null,
  cancelledAt: null,
  messagingPermissionStatus: "approved",
  hasPendingMessageRequest: false,
});

const dateInDays = (days: number): string => {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString();
};

const sortByWedding = (rows: AdminUserRow[]): string[] =>
  [...rows]
    .sort((a, b) => (getSortValue(a, "wedding") < getSortValue(b, "wedding") ? -1 : 1))
    .map((row) => row.name);

describe("wedding sort order", () => {
  it("puts upcoming weddings first (closest at the top) and past weddings at the bottom", () => {
    const rows = [
      userRow("past-recent", dateInDays(-3)),
      userRow("upcoming-far", dateInDays(90)),
      userRow("no-date", null),
      userRow("past-old", dateInDays(-200)),
      userRow("upcoming-close", dateInDays(7)),
      userRow("today", dateInDays(0)),
    ];

    expect(sortByWedding(rows)).toEqual([
      "today",
      "upcoming-close",
      "upcoming-far",
      "no-date",
      "past-recent",
      "past-old",
    ]);
  });

  it("orders past weddings with the most recently passed first", () => {
    const recent = getSortValue(userRow("a", dateInDays(-1)), "wedding");
    const old = getSortValue(userRow("b", dateInDays(-30)), "wedding");
    expect(recent).toBeLessThan(old as number);
  });
});

describe("daysUntilWedding", () => {
  it("is positive for upcoming, zero for today, negative for past", () => {
    expect(daysUntilWedding(dateInDays(5))).toBe(5);
    expect(daysUntilWedding(dateInDays(0))).toBe(0);
    expect(daysUntilWedding(dateInDays(-5))).toBe(-5);
  });
});
