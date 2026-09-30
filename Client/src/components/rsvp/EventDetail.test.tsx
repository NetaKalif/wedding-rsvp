import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
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

jest.mock("../../hooks/useAppData", () => ({
  useAppData: () => ({
    eventGuestsByEventId: { 7: eventGuests },
    updateEventGuests: mockUpdateEventGuests,
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

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(7, [2]);
  });

  it("calls all pending guests when no specific guests are picked", async () => {
    renderDetail();
    openCallModal();

    fireEvent.click(
      await screen.findByRole("button", { name: "התקשר ל-2 אורחים" })
    );

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(7, undefined);
  });
});
