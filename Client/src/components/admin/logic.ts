import { AdminUserRow } from "../../httpClient";

export const DELETION_DAYS = 60;

export const daysUntilDeletion = (weddingDate: string): number => {
  const deletionDate = new Date(weddingDate);
  deletionDate.setDate(deletionDate.getDate() + DELETION_DAYS);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.ceil((deletionDate.getTime() - Date.now()) / msPerDay);
};

// Positive: wedding is upcoming. Negative: wedding already happened that many days ago.
export const daysUntilWedding = (weddingDate: string): number => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const wedding = new Date(weddingDate);
  wedding.setHours(0, 0, 0, 0);
  const msPerDay = 24 * 60 * 60 * 1000;
  return Math.round((wedding.getTime() - today.getTime()) / msPerDay);
};

export type SortField = "name" | "email" | "status" | "messaging" | "partner" | "wedding" | "deletion";

// Rank offsets for the wedding sort: upcoming weddings (0..N days) come first,
// then users with no wedding date, and past weddings sink to the bottom
// (most recently passed first).
const NO_WEDDING_DATE_RANK = 1_000_000;
const PAST_WEDDING_RANK = 2_000_000;

export const getSortValue = (row: AdminUserRow, field: SortField): string | number => {
  switch (field) {
    case "name":
      return row.name.toLowerCase();
    case "email":
      return row.email.toLowerCase();
    case "status":
      return row.status;
    case "messaging":
      return row.messagingPermissionStatus === "approved" ? 2 : row.hasPendingMessageRequest ? 1 : 0;
    case "partner":
      return (row.partnerName || row.linkedToName || "").toLowerCase();
    case "wedding": {
      if (!row.weddingDate) return NO_WEDDING_DATE_RANK;
      const days = daysUntilWedding(row.weddingDate);
      return days >= 0 ? days : PAST_WEDDING_RANK + Math.abs(days);
    }
    case "deletion":
      return row.weddingDate ? daysUntilDeletion(row.weddingDate) : Infinity;
  }
};
