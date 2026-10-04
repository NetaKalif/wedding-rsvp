import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EventDetail from "./EventDetail";
import { Event, EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    callPendingGuests: jest.fn(),
    getEventGuests: jest.fn(),
  },
}));

const mockHttp = httpRequests as unknown as {
  callPendingGuests: jest.Mock;
  getEventGuests: jest.Mock;
};

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 7, name: "Pending Guest", phone: "111", rsvp_status: null, whose: "כלה", circle: "משפחה" },
  { guest_id: 2, event_id: 7, name: "Other Pending Guest", phone: "222", rsvp_status: null, whose: "חתן", circle: "חברים" },
  { guest_id: 3, event_id: 7, name: "Confirmed Guest", phone: "333", rsvp_status: 2, whose: "כלה", circle: "עבודה" },
];

const mockUpdateEventGuests = jest.fn();

// Overridable per test (e.g. to seed a guest with a delivery error)
let mockEventGuests: EventGuest[] = eventGuests;

jest.mock("../../hooks/useAppData", () => ({
  useAppData: () => ({
    eventGuestsByEventId: { 7: mockEventGuests },
    updateEventGuests: mockUpdateEventGuests,
  }),
}));

// EventDetail reads the messaging plan to pick the send modal and to hide
// the manual call button for "send and go" couples.
let mockMessagingPlan: "manual" | "scheduled" = "manual";
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({
    user: { userID: "u1", name: "u1", email: "u1@test.com", messagingPlan: mockMessagingPlan },
    isAdmin: false,
  }),
}));

// Heavy children that are irrelevant to the call-pending flow
jest.mock("./GuestList", () => ({
  __esModule: true,
  default: () => <div data-testid="guest-list" />,
}));
jest.mock("./MessageGroupsModal", () => ({
  __esModule: true,
  default: () => <div data-testid="message-groups-modal" />,
}));

const event: Event = { id: 7, user_id: "u1", is_primary: false, ceremony_name: "חינה" };

const renderDetail = () =>
  render(
    <EventDetail
      event={event}
      userID="u1"
      guestsList={[]}
      primaryEvent={null}
      onBack={jest.fn()}
      onEventDeleted={jest.fn()}
    />
  );

beforeEach(() => {
  jest.clearAllMocks();
  mockMessagingPlan = "manual";
  mockEventGuests = eventGuests;
  // Behave like the real store: an update is visible on the next render
  mockUpdateEventGuests.mockImplementation((_id: number, guests: EventGuest[]) => {
    mockEventGuests = guests;
  });
  mockHttp.getEventGuests.mockResolvedValue(eventGuests);
  mockHttp.callPendingGuests.mockResolvedValue({
    queued: 0,
    failed: 0,
    skippedNoPhone: 0,
    errors: [],
  });
});

describe("EventDetail - call pending guests", () => {
  const openCallModal = () =>
    fireEvent.click(screen.getByRole("button", { name: "שיחות לממתינים" }));

  it("opens the call-pending modal with a specific-guests picker option", async () => {
    renderDetail();
    openCallModal();

    expect(
      await screen.findByText("בחירת אורחים ספציפיים להתקשרות")
    ).toBeInTheDocument();
  });

  it("calls only the guests picked in the modal", async () => {
    renderDetail();
    openCallModal();

    fireEvent.click(await screen.findByText("בחירת אורחים ספציפיים להתקשרות"));
    fireEvent.click(screen.getByText(/Other Pending Guest/));
    fireEvent.click(screen.getByRole("button", { name: "התקשר ל-1 אורחים" }));
    // The call button opens a confirmation popup; calls go out on its "התקשר"
    fireEvent.click(screen.getByRole("button", { name: "התקשר" }));

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(7, [2]);
  });

  it("calls all pending guests when no specific guests are picked", async () => {
    renderDetail();
    openCallModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "התקשר ל-2 אורחים" })
    );
    fireEvent.click(screen.getByRole("button", { name: "התקשר" }));

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(7, undefined);
  });

  it('hides the call-pending button for "send and go" (scheduled plan) users', () => {
    mockMessagingPlan = "scheduled";
    renderDetail();

    expect(screen.queryByRole("button", { name: "שיחות לממתינים" })).not.toBeInTheDocument();
    // The rest of the quick actions are untouched
    expect(screen.getByRole("button", { name: "שליחת הודעות" })).toBeInTheDocument();
  });
});

describe("EventDetail - undelivered guests banner", () => {
  it("shows the banner automatically from the server fetch and its link opens the send modal", async () => {
    // The cached (context) list has no errors — the failure only exists server-side
    mockHttp.getEventGuests.mockResolvedValue([
      ...eventGuests,
      {
        guest_id: 4,
        event_id: 7,
        name: "Failed Guest",
        phone: "444",
        rsvp_status: null,
        last_message_type: "rsvp",
        last_send_error: "המספר אינו רשום בוואטסאפ",
      },
    ]);
    renderDetail();

    expect(await screen.findByText(/ההזמנה לא נמסרה לאורח אחד/)).toBeInTheDocument();
    expect(screen.queryByTestId("message-groups-modal")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("לבדיקה ושליחה חוזרת"));
    expect(screen.getByTestId("message-groups-modal")).toBeInTheDocument();
  });

  it("shows no banner when every delivery succeeded", async () => {
    renderDetail();
    // Wait for the banner's own fetch to settle before asserting absence
    await waitFor(() => expect(mockHttp.getEventGuests).toHaveBeenCalledWith(7));
    expect(screen.queryByText(/ההזמנה לא נמסרה/)).not.toBeInTheDocument();
  });
});
