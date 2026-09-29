import { isFullScreenRoute } from "./layout";

describe("isFullScreenRoute", () => {
  it("hides the footer on the seating workspace", () => {
    expect(isFullScreenRoute("/seating")).toBe(true);
  });

  it("keeps the footer on regular pages", () => {
    expect(isFullScreenRoute("/")).toBe(false);
    expect(isFullScreenRoute("/rsvp")).toBe(false);
    expect(isFullScreenRoute("/budget")).toBe(false);
  });
});
