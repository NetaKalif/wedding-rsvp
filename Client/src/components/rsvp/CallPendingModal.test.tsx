import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import CallPendingModal from "./CallPendingModal";
import { EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    callPendingGuests: jest.fn(() =>
      Promise.resolve({ queued: 0, failed: 0, skippedNoPhone: 0, errors: [] })
    ),
    getEventGuests: jest.fn(() => Promise.resolve([])),
  },
}));

const mockHttp = httpRequests as unknown as {
  callPendingGuests: jest.Mock;
  getEventGuests: jest.Mock;
};

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 1, name: "Pending Guest", phone: "111", rsvp_status: null, whose: "כלה", circle: "משפחה" },
  { guest_id: 2, event_id: 1, name: "Confirmed Guest", phone: "222", rsvp_status: 2, whose: "חתן", circle: "חברים" },
  { guest_id: 3, event_id: 1, name: "Declined Guest", phone: "333", rsvp_status: 0, whose: "כלה", circle: "עבודה" },
  { guest_id: 4, event_id: 1, name: "No Phone Guest", phone: null, rsvp_status: null, whose: "כלה", circle: "משפחה" },
  { guest_id: 5, event_id: 1, name: "Other Pending Guest", phone: "555", rsvp_status: null, whose: "חתן", circle: "חברים" },
];

beforeEach(() => {
  jest.clearAllMocks();
  mockHttp.callPendingGuests.mockResolvedValue({
    queued: 0,
    failed: 0,
    skippedNoPhone: 0,
    errors: [],
  });
  // The modal re-fetches guests on open (the prop can be stale).
  mockHttp.getEventGuests.mockResolvedValue(eventGuests);
});

const renderModal = () =>
  render(
    <CallPendingModal onClose={jest.fn()} eventId={1} eventGuests={eventGuests} />
  );

describe("CallPendingModal - calling everyone", () => {
  it("calls all pending guests (no guestIds) when no specific guests are selected", async () => {
    renderModal();

    fireEvent.click(screen.getByRole("button", { name: "התקשר ל-2 אורחים" }));

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(1, undefined);
  });

  it("shows the call summary after calling", async () => {
    mockHttp.callPendingGuests.mockResolvedValue({
      queued: 2,
      failed: 1,
      skippedNoPhone: 1,
      errors: [],
    });

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /התקשר/ }));

    expect(await screen.findByText("📞 יצאו 2 שיחות")).toBeInTheDocument();
    expect(screen.getByText("דילגנו על 1 אורחים ללא מספר טלפון")).toBeInTheDocument();
    expect(screen.getByText("❌ 1 שיחות נכשלו")).toBeInTheDocument();
  });

  it("shows the Twilio-not-configured message on a 503", async () => {
    mockHttp.callPendingGuests.mockRejectedValue(new Error("Request failed with status 503"));

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /התקשר/ }));

    expect(
      await screen.findByText(/שירות השיחות אינו מוגדר עדיין/)
    ).toBeInTheDocument();
  });
});

describe("CallPendingModal - specific guest picker", () => {
  const openPicker = () =>
    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים להתקשרות"));

  it("only lists pending guests who have a phone", () => {
    renderModal();
    openPicker();

    expect(screen.getByText(/^Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Other Pending Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/No Phone Guest/)).not.toBeInTheDocument();
  });

  it("filters the picker by search term", () => {
    renderModal();
    openPicker();

    fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם..."), {
      target: { value: "Other" },
    });

    expect(screen.getByText(/Other Pending Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/^Pending Guest/)).not.toBeInTheDocument();
  });

  it("filters the picker by the whose filter", () => {
    renderModal();
    openPicker();

    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("מוזמן ע״י"));
    fireEvent.click(screen.getByText("כלה"));

    expect(screen.getByText(/^Pending Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Other Pending Guest/)).not.toBeInTheDocument();
  });

  it("calls only the selected guests", async () => {
    renderModal();
    openPicker();

    fireEvent.click(screen.getByText(/Other Pending Guest/));
    fireEvent.click(screen.getByRole("button", { name: "התקשר ל-1 אורחים" }));

    await screen.findByText(/יצאו/);
    expect(mockHttp.callPendingGuests).toHaveBeenCalledWith(1, [5]);
  });

  it("disables the call button while specific selection is on but empty", () => {
    renderModal();
    openPicker();

    // wix design-system buttons disable via aria-disabled, not the disabled attribute
    expect(screen.getByRole("button", { name: "התקשר ל-0 אורחים" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );
  });
});

describe("CallPendingModal - last call round outcomes", () => {
  const calledGuests: EventGuest[] = [
    // Confirmed via the call — no longer pending but still counts as answered.
    { guest_id: 1, event_id: 1, name: "A", phone: "1", rsvp_status: 2, last_call_status: "completed", last_call_answered_by: "human" },
    { guest_id: 2, event_id: 1, name: "B", phone: "2", rsvp_status: null, last_call_status: "completed", last_call_answered_by: "machine_start" },
    { guest_id: 3, event_id: 1, name: "C", phone: "3", rsvp_status: null, last_call_status: "busy", last_call_answered_by: null },
    { guest_id: 4, event_id: 1, name: "D", phone: "4", rsvp_status: null, last_call_status: "no-answer", last_call_answered_by: null },
    { guest_id: 5, event_id: 1, name: "E", phone: "5", rsvp_status: null, last_call_status: "queued", last_call_answered_by: null },
  ];

  it("shows outcome counts for guests with a recorded call result", () => {
    mockHttp.getEventGuests.mockResolvedValue(calledGuests);

    render(<CallPendingModal onClose={jest.fn()} eventId={1} eventGuests={calledGuests} />);

    expect(screen.getByText("תוצאות סבב השיחות האחרון:")).toBeInTheDocument();
    expect(screen.getByText("✅ ענו לשיחה: 1")).toBeInTheDocument();
    expect(screen.getByText("📼 תא קולי: 1")).toBeInTheDocument();
    expect(screen.getByText("🚫 דחו את השיחה / תפוס: 1")).toBeInTheDocument();
    expect(screen.getByText("🔕 לא ענו: 1")).toBeInTheDocument();
    expect(screen.getByText("⏳ ממתינים לתוצאה: 1")).toBeInTheDocument();
    expect(screen.queryByText(/שיחות שנכשלו/)).not.toBeInTheDocument();
  });

  it("hides the outcome section when no guest was ever called", () => {
    renderModal();
    expect(screen.queryByText("תוצאות סבב השיחות האחרון:")).not.toBeInTheDocument();
  });

  it("re-fetches guests after a call round and shows outcomes on the result screen", async () => {
    mockHttp.callPendingGuests.mockResolvedValue({
      queued: 2,
      failed: 0,
      skippedNoPhone: 0,
      errors: [],
    });
    // Stale on open, outcomes arrive on the re-fetch after the round is placed.
    mockHttp.getEventGuests
      .mockResolvedValueOnce(eventGuests)
      .mockResolvedValue(calledGuests);

    renderModal();
    fireEvent.click(screen.getByRole("button", { name: /התקשר/ }));

    await screen.findByText("📞 יצאו 2 שיחות");
    expect(await screen.findByText("✅ ענו לשיחה: 1")).toBeInTheDocument();
    expect(screen.getByText("⏳ ממתינים לתוצאה: 1")).toBeInTheDocument();
  });

  it("shares refetched guests with the dashboard via onGuestsUpdated", async () => {
    mockHttp.getEventGuests.mockResolvedValue(calledGuests);
    const onGuestsUpdated = jest.fn();

    render(
      <CallPendingModal
        onClose={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        onGuestsUpdated={onGuestsUpdated}
      />
    );

    await screen.findByText("תוצאות סבב השיחות האחרון:");
    expect(onGuestsUpdated).toHaveBeenCalledWith(calledGuests);
  });
});
