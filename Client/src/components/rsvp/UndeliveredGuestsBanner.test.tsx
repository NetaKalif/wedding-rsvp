import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import UndeliveredGuestsBanner from "./UndeliveredGuestsBanner";
import { EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    getEventGuests: jest.fn(() => Promise.resolve([])),
  },
}));

const mockGetEventGuests = httpRequests.getEventGuests as jest.Mock;

const guests = (withErrors: number): EventGuest[] => [
  { guest_id: 1, event_id: 1, name: "Fine Guest", phone: "111", rsvp_status: null, last_message_type: "rsvp" },
  ...Array.from({ length: withErrors }, (_, i) => ({
    guest_id: 10 + i,
    event_id: 1,
    name: `Failed Guest ${i + 1}`,
    phone: `22${i}`,
    rsvp_status: null,
    last_message_type: "rsvp",
    last_send_error: "המספר אינו רשום בוואטסאפ",
  })),
];

const renderBanner = (
  props: Partial<React.ComponentProps<typeof UndeliveredGuestsBanner>> = {},
) =>
  render(
    <UndeliveredGuestsBanner
      eventId={1}
      eventGuests={[]}
      onOpenSendModal={jest.fn()}
      {...props}
    />
  );

const clickClose = () =>
  fireEvent.click(document.querySelector('[data-hook="sectionhelper-close-btn"]')!);

beforeEach(() => {
  jest.clearAllMocks();
  mockGetEventGuests.mockResolvedValue([]);
});

describe("UndeliveredGuestsBanner", () => {
  it("renders nothing when no guest has a delivery error", async () => {
    mockGetEventGuests.mockResolvedValue(guests(0));
    const { container } = renderBanner({ eventGuests: guests(0) });

    await waitFor(() => expect(mockGetEventGuests).toHaveBeenCalledWith(1));
    expect(container).toBeEmptyDOMElement();
  });

  it("appears automatically from the server fetch, even when the cached list has no errors", async () => {
    // The cached (prop) list is stale — the webhook stamped the failure server-side
    mockGetEventGuests.mockResolvedValue(guests(2));
    const onGuestsRefreshed = jest.fn();
    renderBanner({ eventGuests: guests(0), onGuestsRefreshed });

    expect(await screen.findByText(/ההזמנה לא נמסרה ל-2 אורחים/)).toBeInTheDocument();
    // The fresh list is propagated so the caller's table updates too
    expect(onGuestsRefreshed).toHaveBeenCalledWith(guests(2));
  });

  it("uses singular wording for a single undelivered guest", async () => {
    mockGetEventGuests.mockResolvedValue(guests(1));
    renderBanner();
    expect(await screen.findByText(/ההזמנה לא נמסרה לאורח אחד/)).toBeInTheDocument();
  });

  it("never fetches without a valid event id (no /events/undefined/guests)", async () => {
    renderBanner({ eventId: 0, eventGuests: guests(1) });

    // Still renders from the seed data, but no request went out
    expect(screen.getByText(/ההזמנה לא נמסרה לאורח אחד/)).toBeInTheDocument();
    expect(mockGetEventGuests).not.toHaveBeenCalled();
  });

  it("re-fetches when refreshSignal changes (e.g. the send modal closed)", async () => {
    mockGetEventGuests.mockResolvedValue(guests(0));
    const { rerender } = renderBanner({ refreshSignal: true });
    await waitFor(() => expect(mockGetEventGuests).toHaveBeenCalledTimes(1));

    mockGetEventGuests.mockResolvedValue(guests(1));
    rerender(
      <UndeliveredGuestsBanner
        eventId={1}
        eventGuests={[]}
        onOpenSendModal={jest.fn()}
        refreshSignal={false}
      />
    );

    expect(await screen.findByText(/ההזמנה לא נמסרה לאורח אחד/)).toBeInTheDocument();
    expect(mockGetEventGuests).toHaveBeenCalledTimes(2);
  });

  it("the (i) icon opens the failed-guests list popup", async () => {
    mockGetEventGuests.mockResolvedValue(guests(1));
    renderBanner();
    await screen.findByText(/ההזמנה לא נמסרה/);

    fireEvent.click(screen.getByLabelText("מי האורחים שההזמנה לא נמסרה אליהם?"));

    expect(screen.getByText("Failed Guest 1 (220)")).toBeInTheDocument();
    expect(screen.getByText("המספר אינו רשום בוואטסאפ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByText("Failed Guest 1 (220)")).not.toBeInTheDocument();
  });

  it("the action link opens the send modal", async () => {
    mockGetEventGuests.mockResolvedValue(guests(1));
    const onOpenSendModal = jest.fn();
    renderBanner({ onOpenSendModal });

    fireEvent.click(await screen.findByText("לבדיקה ושליחה חוזרת"));
    expect(onOpenSendModal).toHaveBeenCalled();
  });

  it("the X dismisses the banner and it stays dismissed for the same failures", async () => {
    mockGetEventGuests.mockResolvedValue(guests(1));
    const { rerender } = renderBanner();
    await screen.findByText(/ההזמנה לא נמסרה/);

    clickClose();
    expect(screen.queryByText(/ההזמנה לא נמסרה/)).not.toBeInTheDocument();

    // Same failed guest arriving again (e.g. via a prop refresh) stays dismissed
    rerender(
      <UndeliveredGuestsBanner
        eventId={1}
        eventGuests={guests(1)}
        onOpenSendModal={jest.fn()}
      />
    );
    expect(screen.queryByText(/ההזמנה לא נמסרה/)).not.toBeInTheDocument();
  });

  it("re-appears after dismissal when a new guest fails", async () => {
    mockGetEventGuests.mockResolvedValue(guests(1));
    const { rerender } = renderBanner();
    await screen.findByText(/ההזמנה לא נמסרה לאורח אחד/);

    clickClose();

    // A second, previously-unseen guest fails
    rerender(
      <UndeliveredGuestsBanner
        eventId={1}
        eventGuests={guests(2)}
        onOpenSendModal={jest.fn()}
      />
    );
    expect(screen.getByText(/ההזמנה לא נמסרה ל-2 אורחים/)).toBeInTheDocument();
  });
});
