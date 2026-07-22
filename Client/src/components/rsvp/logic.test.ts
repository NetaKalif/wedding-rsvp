import { validateGuestsInfo } from "./logic";
import { Guest } from "../../types";

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
