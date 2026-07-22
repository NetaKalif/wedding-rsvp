import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import MessageGroupsModal from "./MessageGroupsModal";
import { Event, EventGuest } from "../../types";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    sendMessage: jest.fn(() =>
      Promise.resolve({ success: 0, fail: 0, failGuestsList: [] })
    ),
    getEventImageUrl: jest.fn(() => Promise.resolve("")),
    getPrimaryImageUrl: jest.fn(() => Promise.resolve("")),
  },
}));

const event: Event = {
  id: 1,
  user_id: "user-1",
  is_primary: true,
  ceremony_name: "חתונה",
};

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 1, name: "Pending Guest", phone: "111", rsvp_status: null, whose: "כלה", circle: "משפחה" },
  { guest_id: 2, event_id: 1, name: "Confirmed Guest", phone: "222", rsvp_status: 2, whose: "חתן", circle: "חברים" },
  { guest_id: 3, event_id: 1, name: "Declined Guest", phone: "333", rsvp_status: 0, whose: "כלה", circle: "עבודה" },
];

describe("MessageGroupsModal - specific guest picker", () => {
  it("only lists guests who have not RSVP'd when resend-to-pending and select-specific-guests are both chosen", () => {
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("שליחה חוזרת לממתינים"));
    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("lists all guests when the default invite option is selected with specific guests", () => {
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
  });

  it("filters the picker by search term", () => {
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם..."), {
      target: { value: "Confirmed" },
    });

    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("filters the picker by the whose filter", () => {
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("מוזמן ע״י"));
    fireEvent.click(screen.getByText("כלה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
  });

  it("excludes guests without a phone from the picker and from select-all", () => {
    const guestsWithNoPhone: EventGuest[] = [
      ...eventGuests,
      { guest_id: 4, event_id: 1, name: "No Phone Guest", phone: null, rsvp_status: null, whose: "כלה", circle: "משפחה" },
    ];

    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={guestsWithNoPhone}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.queryByText(/No Phone Guest/)).not.toBeInTheDocument();
    expect(screen.getByText("בחר הכל (3)")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/בחר הכל/));
    expect(screen.getByText("נבחרו 3 אורחים")).toBeInTheDocument();
  });

  it("selects all currently-filtered guests via the select-all checkbox", () => {
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם..."), {
      target: { value: "Guest" },
    });
    fireEvent.click(screen.getByText(/בחר הכל/));

    expect(screen.getByText("נבחרו 3 אורחים")).toBeInTheDocument();
  });
});
