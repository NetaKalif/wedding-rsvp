import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    getEventGuests: jest.fn(() => Promise.resolve([])),
  },
}));

const mockGetEventGuests = httpRequests.getEventGuests as jest.Mock;

jest.mock("react-router-dom", () => ({
  useNavigate: () => jest.fn(),
  useSearchParams: () => [new URLSearchParams(), jest.fn()],
}));

let mockMessagingPlan: "manual" | "scheduled" = "manual";
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { userID: "u1", name: "u1", email: "u1@test.com", messagingPlan: mockMessagingPlan },
    isLoading: false,
    weddingInfo: { id: 1, user_id: "u1", is_primary: true, ceremony_name: "חתונה" },
    isAdmin: false,
  }),
}));

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 1, name: "Fine Guest", phone: "111", rsvp_status: null, last_message_type: "rsvp" },
];

jest.mock("../../hooks/useAppData", () => ({
  useAppData: () => ({
    guests: [],
    eventGuestsByEventId: { 1: eventGuests },
    updateEventGuests: jest.fn(),
    refreshGuests: jest.fn(),
    refreshEvents: jest.fn(),
  }),
}));

// Heavy children that are irrelevant to the banner wiring
jest.mock("../global/Header", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("./ControlPanel", () => ({ __esModule: true, default: () => <div data-testid="control-panel" /> }));
jest.mock("./GuestList", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("./EventsList", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("./AddGuestModal", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("./InfoModal", () => ({ __esModule: true, default: () => <div /> }));
jest.mock("./MessageGroupsModal", () => ({
  __esModule: true,
  default: () => <div data-testid="message-groups-modal" />,
}));
jest.mock("./ScheduledMessagingModal", () => ({
  __esModule: true,
  default: () => <div data-testid="scheduled-messaging-modal" />,
}));

// Module-level: RSVPDashboard throws without it, so set before requiring
process.env.REACT_APP_GOOGLE_CLIENT_ID = "test-client-id";
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { RSVPDashboard } = require("./RSVPDashboard");

const failedGuest: EventGuest = {
  guest_id: 2,
  event_id: 1,
  name: "Failed Guest",
  phone: "222",
  rsvp_status: null,
  last_message_type: "rsvp",
  last_send_error: "המספר אינו רשום בוואטסאפ",
};

beforeEach(() => {
  jest.clearAllMocks();
  mockMessagingPlan = "manual";
  mockGetEventGuests.mockResolvedValue(eventGuests);
});

describe("RSVPDashboard - undelivered guests banner", () => {
  it("shows the banner from the server fetch and its link opens the send modal", async () => {
    mockGetEventGuests.mockResolvedValue([...eventGuests, failedGuest]);
    render(<RSVPDashboard />);

    expect(await screen.findByText(/ההזמנה לא נמסרה לאורח אחד/)).toBeInTheDocument();
    expect(screen.queryByTestId("message-groups-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("לבדיקה ושליחה חוזרת"));
    expect(screen.getByTestId("message-groups-modal")).toBeInTheDocument();
  });

  it('opens the scheduling modal instead for "send and go" users', async () => {
    mockMessagingPlan = "scheduled";
    mockGetEventGuests.mockResolvedValue([...eventGuests, failedGuest]);
    render(<RSVPDashboard />);

    fireEvent.click(await screen.findByText("לבדיקה ושליחה חוזרת"));
    expect(screen.getByTestId("scheduled-messaging-modal")).toBeInTheDocument();
    expect(screen.queryByTestId("message-groups-modal")).not.toBeInTheDocument();
  });

  it("shows no banner when every delivery succeeded", async () => {
    render(<RSVPDashboard />);
    await waitFor(() => expect(mockGetEventGuests).toHaveBeenCalledWith(1));
    expect(screen.queryByText(/ההזמנה לא נמסרה/)).not.toBeInTheDocument();
  });
});
