import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import { MemoryRouter, useLocation } from "react-router-dom";
import EventsList from "./EventsList";
import { Event } from "../../types";

const mockSetEvents = jest.fn();
const mockUpdateEventGuests = jest.fn();
const mockRefreshEvents = jest.fn();

const events: Event[] = [
  { id: 1, user_id: "u1", is_primary: true, ceremony_name: "חתונה" },
  { id: 2, user_id: "u1", is_primary: false, ceremony_name: "חינה" },
  { id: 3, user_id: "u1", is_primary: false, ceremony_name: "רווקות" },
];

jest.mock("../../hooks/useAppData", () => ({
  useAppData: () => ({
    events,
    eventGuestsByEventId: {},
    setEvents: mockSetEvents,
    updateEventGuests: mockUpdateEventGuests,
    refreshEvents: mockRefreshEvents,
  }),
}));

jest.mock("./EventDetail", () => ({
  __esModule: true,
  default: ({ event, onBack }: { event: Event; onBack: () => void }) => (
    <div>
      <span>Detail for {event.ceremony_name}</span>
      <button onClick={onBack}>חזרה</button>
    </div>
  ),
}));

const LocationDisplay = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname + location.search}</div>;
};

const renderWithRouter = (initialPath: string) =>
  render(
    <MemoryRouter initialEntries={[initialPath]}>
      <EventsList userID="u1" guestsList={[]} primaryEvent={events[0]} />
      <LocationDisplay />
    </MemoryRouter>
  );

describe("EventsList - selected event reflected in the URL", () => {
  it("restores the selected event from the URL on mount (e.g. after a refresh)", () => {
    renderWithRouter("/rsvp?tab=events&event=2");

    expect(screen.getByText("Detail for חינה")).toBeInTheDocument();
    expect(screen.queryByText("רווקות")).not.toBeInTheDocument();
  });

  it("adds the event id to the URL when an event card is selected", () => {
    renderWithRouter("/rsvp?tab=events");

    fireEvent.click(screen.getByText("רווקות"));

    expect(screen.getByText("Detail for רווקות")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/rsvp?tab=events&event=3");
  });

  it("removes the event id from the URL when navigating back to the list", () => {
    renderWithRouter("/rsvp?tab=events&event=2");

    fireEvent.click(screen.getByText("חזרה"));

    expect(screen.getByText("חינה")).toBeInTheDocument();
    expect(screen.getByTestId("location").textContent).toBe("/rsvp?tab=events");
  });
});
