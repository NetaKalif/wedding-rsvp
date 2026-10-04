import React from "react";
import { render, screen } from "@testing-library/react";
import ControlPanel from "./ControlPanel";
import { EventGuest } from "../../types";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    getEventGuests: jest.fn(() => Promise.resolve([])),
    deleteAllGuests: jest.fn(() => Promise.resolve([])),
  },
}));

// ControlPanel hides the manual call-pending button for "send and go"
// (scheduled plan) couples — their call rounds run automatically.
let mockMessagingPlan: "manual" | "scheduled" = "manual";
let mockIsAdmin = false;
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    weddingInfo: { id: 1, ceremony_name: "חתונה" },
    user: { userID: "u1", name: "u1", email: "u1@test.com", messagingPlan: mockMessagingPlan },
    isAdmin: mockIsAdmin,
  }),
}));

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 1, name: "Pending Guest", phone: "111", rsvp_status: null, whose: "כלה", circle: "משפחה" },
];

const renderPanel = () =>
  render(
    <ControlPanel
      setIsAddGuestModalOpen={jest.fn()}
      setIsInfoModalOpen={jest.fn()}
      setIsMessageGroupsModalOpen={jest.fn()}
      setEventGuests={jest.fn()}
      eventGuests={eventGuests}
      userID="u1"
      eventId={1}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockMessagingPlan = "manual";
  mockIsAdmin = false;
});

describe("ControlPanel - call-pending button by messaging plan", () => {
  it("shows the call-pending button on the manual plan", () => {
    renderPanel();
    expect(screen.getByRole("button", { name: "שיחות לממתינים" })).toBeInTheDocument();
  });

  it('hides the call-pending button for "send and go" (scheduled plan) users', () => {
    mockMessagingPlan = "scheduled";
    renderPanel();
    expect(screen.queryByRole("button", { name: "שיחות לממתינים" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחת הודעות" })).toBeInTheDocument();
  });

  it("keeps the button for admins even on the scheduled plan", () => {
    mockMessagingPlan = "scheduled";
    mockIsAdmin = true;
    renderPanel();
    expect(screen.getByRole("button", { name: "שיחות לממתינים" })).toBeInTheDocument();
  });
});
