import {
  validateGuestsInfo,
  guestExportColumns,
  guestExportRow,
  getCallOutcomeCounts,
} from "./logic";
import { EventGuest, Guest } from "../../types";

const baseGuest = (overrides: Partial<Guest> = {}): Guest => ({
  name: "Test Guest",
  phone: "0501234567",
  whose: "כלה",
  circle: "משפחה",
  number_of_guests: 1,
  ...overrides,
} as Guest);

describe("validateGuestsInfo", () => {
  it("accepts a blank phone when allowMissingPhone is set, storing phone as null", () => {
    const { valid, rejected } = validateGuestsInfo(
      [baseGuest({ phone: "" })],
      [],
      { allowMissingPhone: true }
    );

    expect(rejected).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].phone).toBeNull();
  });

  it("accepts a non-Israeli-format phone as-is when skipIsraeliValidation is set", () => {
    const foreignPhone = "+14155550123";
    const { valid, rejected } = validateGuestsInfo(
      [baseGuest({ phone: foreignPhone })],
      [],
      { skipIsraeliValidation: true }
    );

    expect(rejected).toHaveLength(0);
    expect(valid).toHaveLength(1);
    expect(valid[0].phone).toBe(foreignPhone);
  });

  it("rejects a non-Israeli-format phone as invalid_phone when no options are passed (bulk-import default)", () => {
    const { valid, rejected } = validateGuestsInfo(
      [baseGuest({ phone: "+14155550123" })],
      []
    );

    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("invalid_phone");
  });

  it("rejects a blank phone as missing_field when no options are passed (bulk-import default)", () => {
    const { valid, rejected } = validateGuestsInfo(
      [baseGuest({ phone: "" })],
      []
    );

    expect(valid).toHaveLength(0);
    expect(rejected).toHaveLength(1);
    expect(rejected[0].reason).toBe("missing_field");
  });
});

describe("guest export", () => {
  const eventGuest = (overrides: Partial<EventGuest> = {}): EventGuest => ({
    id: 42,
    event_id: 7,
    guest_id: 99,
    user_id: "google-sub-123",
    last_rsvp_sent_at: "2026-07-01T00:00:00.000Z",
    name: "דנה כהן",
    phone: "0501234567",
    whose: "כלה",
    circle: "משפחה",
    number_of_guests: 3,
    rsvp_status: 2,
    ...overrides,
  });

  it("exports only the columns visible on the RSVP page, not internal identifiers", () => {
    const keys = guestExportColumns.map((c) => c.key);
    expect(keys).toEqual([
      "name",
      "phone",
      "whose",
      "circle",
      "status",
      "attending_count",
      "number_of_guests",
    ]);
    // Internal fields must never leak into the export.
    for (const internal of [
      "id",
      "event_id",
      "guest_id",
      "user_id",
      "last_rsvp_sent_at",
      "rsvp_status",
    ]) {
      expect(keys).not.toContain(internal);
    }
  });

  it("maps a guest row to visible fields only, with a human-readable status label", () => {
    const row = guestExportRow(eventGuest());
    expect(row).toEqual({
      name: "דנה כהן",
      phone: "0501234567",
      whose: "כלה",
      circle: "משפחה",
      status: "מאושר",
      attending_count: 2,
      number_of_guests: 3,
    });
    // No internal identifiers on the row.
    expect(row).not.toHaveProperty("id");
    expect(row).not.toHaveProperty("event_id");
    expect(row).not.toHaveProperty("guest_id");
    expect(row).not.toHaveProperty("user_id");
    expect(row).not.toHaveProperty("last_rsvp_sent_at");
  });

  it("labels pending and declined guests, leaving attending count blank when pending", () => {
    expect(guestExportRow(eventGuest({ rsvp_status: null }))).toMatchObject({
      status: "ממתין",
      attending_count: "",
    });
    expect(guestExportRow(eventGuest({ rsvp_status: 0 }))).toMatchObject({
      status: "סירוב",
      attending_count: 0,
    });
  });
});

describe("getCallOutcomeCounts", () => {
  const guest = (
    last_call_status: string | null,
    last_call_answered_by: string | null = null
  ): EventGuest => ({
    event_id: 1,
    guest_id: Math.floor(Math.random() * 100000),
    last_call_status,
    last_call_answered_by,
  });

  it("counts a completed call answered by a human (or with no verdict) as answered", () => {
    const counts = getCallOutcomeCounts([
      guest("completed", "human"),
      guest("completed", "unknown"),
      guest("completed"),
    ]);
    expect(counts.answered).toBe(3);
    expect(counts.voicemail).toBe(0);
  });

  it("counts machine-answered completed calls as voicemail", () => {
    const counts = getCallOutcomeCounts([
      guest("completed", "machine_start"),
      guest("completed", "machine_end_beep"),
      guest("completed", "fax"),
    ]);
    expect(counts.voicemail).toBe(3);
    expect(counts.answered).toBe(0);
  });

  it("buckets busy, no-answer, failed/canceled and queued separately", () => {
    const counts = getCallOutcomeCounts([
      guest("busy"),
      guest("no-answer"),
      guest("failed"),
      guest("canceled"),
      guest("queued"),
    ]);
    expect(counts).toEqual({
      answered: 0,
      voicemail: 0,
      busy: 1,
      noAnswer: 1,
      failed: 2,
      inProgress: 1,
    });
  });

  it("ignores guests who were never called", () => {
    const counts = getCallOutcomeCounts([guest(null), { event_id: 1, guest_id: 1 }]);
    expect(counts).toEqual({
      answered: 0,
      voicemail: 0,
      busy: 0,
      noAnswer: 0,
      failed: 0,
      inProgress: 0,
    });
  });
});
