import { Workbook } from "exceljs";
import { EventGuest, Gift, GiftType, Guest } from "../../types";
import {
  downloadXlsx,
  getRsvpStatus,
  guestExportColumns,
  RSVP_STATUS_LABELS,
} from "../rsvp/logic";

/** Hebrew labels for each gift type, shared by the form, the table and exports. */
export const GIFT_TYPE_LABELS: Record<GiftType, string> = {
  check: "צ׳ק",
  cash: "מזומן",
  bit: "ביט",
  paybox: "פייבוקס",
  bank_transfer: "העברה בנקאית",
  buyme: "BUYME",
};

export const GIFT_TYPE_OPTIONS = (
  Object.keys(GIFT_TYPE_LABELS) as GiftType[]
).map((type) => ({ id: type, value: GIFT_TYPE_LABELS[type] }));

/**
 * A row on the gifts page: a guest (any guest, invited or not), their
 * primary-event RSVP when they have one, and the gifts they gave.
 */
export interface GuestGiftRow {
  guest: Guest;
  /** The guest's membership in the wedding (primary event), if invited. */
  rsvp: EventGuest | null;
  gifts: Gift[];
  totalAmount: number;
}

export const buildGuestGiftRows = (
  guests: Guest[],
  primaryEventGuests: EventGuest[],
  gifts: Gift[]
): GuestGiftRow[] => {
  const rsvpByGuestId = new Map(
    primaryEventGuests.map((eg) => [eg.guest_id, eg])
  );
  const giftsByGuestId = new Map<number, Gift[]>();
  gifts.forEach((gift) => {
    const existing = giftsByGuestId.get(gift.guest_id) ?? [];
    giftsByGuestId.set(gift.guest_id, [...existing, gift]);
  });

  return guests.map((guest) => {
    const guestGifts = guest.id != null ? giftsByGuestId.get(guest.id) ?? [] : [];
    return {
      guest,
      rsvp: guest.id != null ? rsvpByGuestId.get(guest.id) ?? null : null,
      gifts: guestGifts,
      totalAmount: guestGifts.reduce((sum, gift) => sum + gift.amount, 0),
    };
  });
};

/**
 * The confirmed count shown in the gifts table: pending counts as 0 (no one
 * confirmed yet); guests not invited to the wedding have no count at all.
 */
export const displayedRsvpCount = (row: GuestGiftRow): number | "-" =>
  row.rsvp ? row.rsvp.rsvp_status ?? 0 : "-";

export interface GiftStats {
  totalAmount: number;
  giftCount: number;
  /**
   * Total number of people behind the gifts — each gifting guest counts as
   * their confirmed RSVP headcount (a couple that confirmed 2 counts as 2),
   * or as 1 when they have no confirmed count (uninvited / sent without
   * showing up).
   */
  gifterGuestCount: number;
  averagePerGuest: number;
}

export const getGiftStats = (rows: GuestGiftRow[]): GiftStats => {
  const giftingRows = rows.filter((row) => row.gifts.length > 0);
  const totalAmount = giftingRows.reduce((sum, row) => sum + row.totalAmount, 0);
  const giftCount = giftingRows.reduce((sum, row) => sum + row.gifts.length, 0);
  const gifterGuestCount = giftingRows.reduce((sum, row) => {
    const confirmed = row.rsvp?.rsvp_status;
    return sum + (confirmed && confirmed > 0 ? confirmed : 1);
  }, 0);
  return {
    totalAmount,
    giftCount,
    gifterGuestCount,
    averagePerGuest: gifterGuestCount > 0 ? totalAmount / gifterGuestCount : 0,
  };
};

/** The RSVP-page export columns plus the gift columns. */
export const giftExportColumns = [
  ...guestExportColumns,
  { header: "סוג מתנה", key: "gift_types", width: 20 },
  { header: "סכום מתנה", key: "gift_amount", width: 15 },
];

/** Maps a guest+gifts row to a single export row for the visible columns. */
export const giftExportRow = (row: GuestGiftRow): Record<string, unknown> => ({
  name: row.guest.name,
  phone: row.guest.phone,
  whose: row.guest.whose,
  circle: row.guest.circle,
  status: row.rsvp ? RSVP_STATUS_LABELS[getRsvpStatus(row.rsvp.rsvp_status)] : "",
  attending_count: row.rsvp?.rsvp_status ?? "",
  number_of_guests: row.guest.number_of_guests,
  gift_types: row.gifts
    .map((gift) => GIFT_TYPE_LABELS[gift.gift_type])
    .join(", "),
  gift_amount: row.gifts.length > 0 ? row.totalAmount : "",
});

export const handleGiftsExport = async (rows: GuestGiftRow[]) => {
  const workbook = new Workbook();
  const worksheet = workbook.addWorksheet("Gifts");

  worksheet.columns = giftExportColumns;
  rows.forEach((row) => worksheet.addRow(giftExportRow(row)));

  await downloadXlsx(workbook, "giftsList.xlsx");
};

export const formatCurrency = (amount: number): string =>
  new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(amount);
