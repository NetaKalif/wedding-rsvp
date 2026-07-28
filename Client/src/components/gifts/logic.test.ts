import {
  buildGuestGiftRows,
  displayedRsvpCount,
  getGiftStats,
  giftExportColumns,
  giftExportRow,
  GIFT_TYPE_LABELS,
} from "./logic";
import { guestExportColumns } from "../rsvp/logic";
import { EventGuest, Gift, Guest } from "../../types";

const guest = (id: number, overrides: Partial<Guest> = {}): Guest => ({
  id,
  name: `Guest ${id}`,
  phone: `+97250000000${id}`,
  whose: "כלה",
  circle: "משפחה",
  number_of_guests: 2,
  ...overrides,
});

const eventGuest = (
  guestId: number,
  rsvpStatus: number | null
): EventGuest => ({
  event_id: 1,
  guest_id: guestId,
  rsvp_status: rsvpStatus,
});

const gift = (
  giftId: number,
  guestId: number,
  amount: number,
  giftType: Gift["gift_type"] = "cash"
): Gift => ({
  gift_id: giftId,
  guest_id: guestId,
  gift_type: giftType,
  amount,
});

describe("buildGuestGiftRows", () => {
  it("joins every guest with their primary-event RSVP and their gifts", () => {
    const rows = buildGuestGiftRows(
      [guest(1), guest(2)],
      [eventGuest(1, 3)],
      [gift(10, 1, 500, "check"), gift(11, 1, 200, "cash")]
    );

    expect(rows).toHaveLength(2);
    expect(rows[0].rsvp?.rsvp_status).toBe(3);
    expect(rows[0].gifts).toHaveLength(2);
    expect(rows[0].totalAmount).toBe(700);
    // Guest 2 is not invited to the wedding and gave nothing
    expect(rows[1].rsvp).toBeNull();
    expect(rows[1].gifts).toHaveLength(0);
    expect(rows[1].totalAmount).toBe(0);
  });

  it("includes uninvited guests (no event membership) so their gifts can be tracked", () => {
    const rows = buildGuestGiftRows(
      [guest(5)],
      [],
      [gift(20, 5, 300, "bit")]
    );

    expect(rows[0].rsvp).toBeNull();
    expect(rows[0].totalAmount).toBe(300);
  });
});

describe("displayedRsvpCount", () => {
  it("shows 0 for an invited guest whose RSVP is still pending", () => {
    const [row] = buildGuestGiftRows([guest(1)], [eventGuest(1, null)], []);
    expect(displayedRsvpCount(row)).toBe(0);
  });

  it("shows the confirmed count for a confirmed guest and 0 for a declined one", () => {
    const rows = buildGuestGiftRows(
      [guest(1), guest(2)],
      [eventGuest(1, 3), eventGuest(2, 0)],
      []
    );
    expect(displayedRsvpCount(rows[0])).toBe(3);
    expect(displayedRsvpCount(rows[1])).toBe(0);
  });

  it("shows '-' for a guest that is not invited to the wedding", () => {
    const [row] = buildGuestGiftRows([guest(1)], [], []);
    expect(displayedRsvpCount(row)).toBe("-");
  });
});

describe("getGiftStats", () => {
  it("counts each gifting guest by their confirmed RSVP headcount, not as one row", () => {
    // Neta came with her partner (rsvp count 2) and gave 1000 ₪
    const rows = buildGuestGiftRows(
      [guest(1, { name: "Neta" })],
      [eventGuest(1, 2)],
      [gift(1, 1, 1000)]
    );
    const stats = getGiftStats(rows);

    expect(stats.gifterGuestCount).toBe(2);
    expect(stats.averagePerGuest).toBe(500);
  });

  it("sums totals and headcounts across gifting guests, ignoring guests without gifts", () => {
    const rows = buildGuestGiftRows(
      [guest(1), guest(2), guest(3)],
      [eventGuest(1, 2), eventGuest(2, 3), eventGuest(3, 4)],
      // Guest 1 gave two gifts; guest 3 (rsvp 4) gave nothing
      [gift(1, 1, 500), gift(2, 1, 100), gift(3, 2, 400)]
    );
    const stats = getGiftStats(rows);

    expect(stats.totalAmount).toBe(1000);
    expect(stats.giftCount).toBe(3);
    expect(stats.gifterGuestCount).toBe(5); // 2 (guest 1) + 3 (guest 2)
    expect(stats.averagePerGuest).toBe(200);
  });

  it("counts a gifter without a confirmed RSVP (uninvited or didn't show) as 1 guest", () => {
    const rows = buildGuestGiftRows(
      [guest(1), guest(2)],
      [eventGuest(2, null)], // guest 1 uninvited, guest 2 pending
      [gift(1, 1, 300), gift(2, 2, 200)]
    );
    const stats = getGiftStats(rows);

    expect(stats.gifterGuestCount).toBe(2);
    expect(stats.averagePerGuest).toBe(250);
  });

  it("returns zeros for no gifts (no division by zero)", () => {
    const stats = getGiftStats(buildGuestGiftRows([guest(1)], [], []));

    expect(stats.totalAmount).toBe(0);
    expect(stats.giftCount).toBe(0);
    expect(stats.gifterGuestCount).toBe(0);
    expect(stats.averagePerGuest).toBe(0);
  });
});

describe("gift export", () => {
  it("export columns are the RSVP-page columns plus the two gift columns", () => {
    expect(giftExportColumns.slice(0, guestExportColumns.length)).toEqual(
      guestExportColumns
    );
    expect(giftExportColumns.map((c) => c.key)).toEqual(
      expect.arrayContaining(["gift_types", "gift_amount"])
    );
  });

  it("maps a row with gifts to Hebrew gift-type labels and the summed amount", () => {
    const rows = buildGuestGiftRows(
      [guest(1)],
      [eventGuest(1, 2)],
      [gift(1, 1, 500, "check"), gift(2, 1, 250, "buyme")]
    );
    const exported = giftExportRow(rows[0]);

    expect(exported.name).toBe("Guest 1");
    expect(exported.status).toBe("מאושר");
    expect(exported.attending_count).toBe(2);
    expect(exported.gift_types).toBe(
      `${GIFT_TYPE_LABELS.check}, ${GIFT_TYPE_LABELS.buyme}`
    );
    expect(exported.gift_amount).toBe(750);
  });

  it("leaves RSVP and gift cells empty for an uninvited guest with no gifts", () => {
    const rows = buildGuestGiftRows([guest(9)], [], []);
    const exported = giftExportRow(rows[0]);

    expect(exported.status).toBe("");
    expect(exported.attending_count).toBe("");
    expect(exported.gift_types).toBe("");
    expect(exported.gift_amount).toBe("");
  });
});
