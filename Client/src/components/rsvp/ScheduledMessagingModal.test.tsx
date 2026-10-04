import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import ScheduledMessagingModal, { getMissingContent } from "./ScheduledMessagingModal";
import { Event, EventGuest, ScheduledRound } from "../../types";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    getMessageSchedule: jest.fn(() => Promise.resolve([])),
    saveMessageSchedule: jest.fn(() => Promise.resolve([])),
    sendMessage: jest.fn(() => Promise.resolve({ success: 0, fail: 0, failGuestsList: [] })),
    getSendProgress: jest.fn(() => Promise.resolve({ active: false })),
    getEventGuests: jest.fn(() => Promise.resolve([])),
    resetMessageSchedule: jest.fn(() => Promise.resolve({ deletedRounds: 0 })),
  },
}));

// The modal reads isAdmin to show the QA reset tool
let mockIsAdmin = false;
jest.mock("../../hooks/useAuth", () => ({
  useAuth: () => ({ isAdmin: mockIsAdmin }),
}));

const mockHttp = httpRequests as unknown as {
  getMessageSchedule: jest.Mock;
  saveMessageSchedule: jest.Mock;
  sendMessage: jest.Mock;
  getSendProgress: jest.Mock;
  getEventGuests: jest.Mock;
  resetMessageSchedule: jest.Mock;
};

// All content complete — scheduling is enabled
const completeEvent: Event = {
  id: 1,
  user_id: "u1",
  is_primary: true,
  ceremony_name: "חתונה",
  date: "2027-06-01",
  time: "19:00",
  location: "גן האירועים",
  file_id: "media-1",
  bride_name: "כלה",
  groom_name: "חתן",
  reminder_day: "wedding_day",
  reminder_time: "09:00",
  send_thank_you: true,
};

const eventGuests: EventGuest[] = [
  { guest_id: 1, event_id: 1, name: "Good Guest", phone: "111", rsvp_status: null, last_message_type: "rsvp" },
  {
    guest_id: 2,
    event_id: 1,
    name: "Failed Guest",
    phone: "222",
    rsvp_status: null,
    last_message_type: "rsvp",
    last_send_error: "המספר אינו רשום בוואטסאפ",
  },
];

// Added after the invitation round — never had any send attempt
const lateGuest: EventGuest = { guest_id: 3, event_id: 1, name: "Late Guest", phone: "333", rsvp_status: null };

const sentRsvpRound: ScheduledRound = {
  id: 1,
  event_id: 1,
  round_type: "rsvp",
  round_number: 1,
  scheduled_at: new Date(Date.now() - 24 * 3600_000).toISOString(),
  status: "sent",
};

const futureIso = (hoursAhead: number) => new Date(Date.now() + hoursAhead * 3600_000).toISOString();

beforeEach(() => {
  jest.clearAllMocks();
  mockIsAdmin = false;
  mockHttp.getMessageSchedule.mockResolvedValue([]);
  mockHttp.resetMessageSchedule.mockResolvedValue({ deletedRounds: 0 });
  mockHttp.saveMessageSchedule.mockResolvedValue([]);
  mockHttp.sendMessage.mockResolvedValue({ success: 1, fail: 0, failGuestsList: [] });
  mockHttp.getSendProgress.mockResolvedValue({ active: false });
  mockHttp.getEventGuests.mockResolvedValue(eventGuests);
});

const renderModal = (overrides: Partial<React.ComponentProps<typeof ScheduledMessagingModal>> = {}) =>
  render(
    <ScheduledMessagingModal
      onClose={jest.fn()}
      eventId={1}
      event={completeEvent}
      eventGuests={eventGuests}
      {...overrides}
    />
  );

describe("getMissingContent", () => {
  it("returns nothing when all message content is filled", () => {
    expect(getMissingContent(completeEvent)).toEqual([]);
  });

  it("lists every missing piece of content", () => {
    const missing = getMissingContent({
      ...completeEvent,
      file_id: undefined,
      bride_name: "",
      location: undefined,
      reminder_time: undefined,
      send_thank_you: false,
    });
    expect(missing).toEqual(
      expect.arrayContaining([
        "תמונת ההזמנה",
        "שמות בני הזוג",
        "מיקום האירוע",
        "הגדרות התזכורת ליום האירוע",
        "הודעת התודה (יש להפעיל אותה)",
      ])
    );
  });

  it("requires the invitation photo", () => {
    expect(getMissingContent({ ...completeEvent, file_id: undefined })).toEqual(["תמונת ההזמנה"]);
  });
});

describe("ScheduledMessagingModal - schedule editing", () => {
  it("renders all six rounds and loads the saved schedule", async () => {
    mockHttp.getMessageSchedule.mockResolvedValue([
      {
        id: 1,
        event_id: 1,
        round_type: "rsvp",
        round_number: 1,
        scheduled_at: futureIso(24),
        status: "pending",
      } satisfies ScheduledRound,
    ]);

    renderModal();

    await screen.findByText("הזמנה ואישור הגעה");
    expect(screen.getByText("תזכורת לממתינים — סבב 3")).toBeInTheDocument();
    expect(screen.getByText("שיחות טלפון לממתינים — סבב 2")).toBeInTheDocument();
    expect(mockHttp.getMessageSchedule).toHaveBeenCalledWith(1);
    expect(await screen.findByText("מתוזמן")).toBeInTheDocument();
  });

  it("saves edited rounds with ISO timestamps", async () => {
    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");

    const input = screen.getByLabelText("הזמנה ואישור הגעה");
    const future = new Date(Date.now() + 48 * 3600_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const localValue = `${future.getFullYear()}-${pad(future.getMonth() + 1)}-${pad(future.getDate())}T${pad(future.getHours())}:${pad(future.getMinutes())}`;
    fireEvent.change(input, { target: { value: localValue } });

    fireEvent.click(screen.getByRole("button", { name: "שמירת התזמון" }));

    await waitFor(() => expect(mockHttp.saveMessageSchedule).toHaveBeenCalledTimes(1));
    const [eventId, rounds] = mockHttp.saveMessageSchedule.mock.calls[0];
    expect(eventId).toBe(1);
    expect(rounds).toEqual([
      { roundType: "rsvp", roundNumber: 1, scheduledAt: new Date(localValue).toISOString() },
    ]);
  });

  it("rejects a past date without calling the server", async () => {
    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");

    fireEvent.change(screen.getByLabelText("הזמנה ואישור הגעה"), {
      target: { value: "2020-01-01T10:00" },
    });
    fireEvent.click(screen.getByRole("button", { name: "שמירת התזמון" }));

    await screen.findByText(/חייב להיות בעתיד/);
    expect(mockHttp.saveMessageSchedule).not.toHaveBeenCalled();
  });

  it("locks a round that was already sent", async () => {
    mockHttp.getMessageSchedule.mockResolvedValue([
      {
        id: 1,
        event_id: 1,
        round_type: "rsvp",
        round_number: 1,
        scheduled_at: futureIso(-24),
        status: "sent",
      } satisfies ScheduledRound,
    ]);

    renderModal();

    expect(await screen.findByText("נשלח")).toBeInTheDocument();
    expect(screen.getByLabelText("הזמנה ואישור הגעה")).toBeDisabled();
  });

  it("blocks scheduling while message content is missing", async () => {
    const onEditDetails = jest.fn();
    renderModal({
      event: { ...completeEvent, send_thank_you: false },
      onEditDetails,
    });

    await screen.findByText("לפני שמתזמנים — חסרים פרטים");
    expect(screen.getByText("• הודעת התודה (יש להפעיל אותה)")).toBeInTheDocument();
    expect(screen.getByLabelText("הזמנה ואישור הגעה")).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "השלמת פרטים" }));
    expect(onEditDetails).toHaveBeenCalled();
  });

  it("blocks scheduling while the invitation photo is missing", async () => {
    renderModal({ event: { ...completeEvent, file_id: undefined } });

    await screen.findByText("לפני שמתזמנים — חסרים פרטים");
    expect(screen.getByText("• תמונת ההזמנה")).toBeInTheDocument();
    expect(screen.getByLabelText("הזמנה ואישור הגעה")).toBeDisabled();
  });
});

describe("ScheduledMessagingModal - failed guests resend", () => {
  it("lists guests with a send error and resends only to them", async () => {
    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");

    expect(screen.getByText(/Failed Guest/)).toBeInTheDocument();
    expect(screen.getByText("המספר אינו רשום בוואטסאפ")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /שליחת ההזמנה מחדש ל-1 אורחים/ }));
    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));

    // No messageType — the server always resends the invitation
    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith({
        eventId: 1,
        failedOnly: true,
      })
    );
    // Guests are refreshed so cleared errors disappear from the list
    await waitFor(() => expect(mockHttp.getEventGuests).toHaveBeenCalledWith(1));
  });

  it("shows an empty-state note when no guest has a send error", async () => {
    mockHttp.getEventGuests.mockResolvedValue([eventGuests[0]]);
    renderModal({ eventGuests: [eventGuests[0]] });
    await screen.findByText("הזמנה ואישור הגעה");
    expect(screen.getByText(/אין כרגע אורחים שההזמנה אליהם נכשלה/)).toBeInTheDocument();
  });

  it("shows the sending progress bar while a targeted send is in flight, like a regular send", async () => {
    let resolveSend!: (value: unknown) => void;
    mockHttp.sendMessage.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    mockHttp.getSendProgress.mockResolvedValue({
      active: true,
      total: 1,
      completed: 1,
      failed: 0,
      dispatchDone: false,
      deliveryFailures: [],
    });

    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");

    fireEvent.click(screen.getByRole("button", { name: /שליחת ההזמנה מחדש ל-1 אורחים/ }));
    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));

    expect(await screen.findByText("📨 שולח הודעות לאורחים...")).toBeInTheDocument();
    // The counter comes from polling GET /sendProgress (1s interval)
    expect(await screen.findByText("1 / 1 הודעות נשלחו", {}, { timeout: 2500 })).toBeInTheDocument();

    resolveSend({ success: 1, fail: 0, failGuestsList: [] });
    expect(await screen.findByText(/ההזמנה נשלחה: 1 הצליחו/)).toBeInTheDocument();
    expect(screen.queryByText("📨 שולח הודעות לאורחים...")).not.toBeInTheDocument();
  });
});

describe("ScheduledMessagingModal - admin view switch", () => {
  it("lets an admin switch to the manual send modal", async () => {
    mockIsAdmin = true;
    const onSwitchToManual = jest.fn();
    renderModal({ onSwitchToManual });
    await screen.findByText("הזמנה ואישור הגעה");

    fireEvent.click(screen.getByText("תצוגת אדמין: מעבר לשליחה ידנית"));
    expect(onSwitchToManual).toHaveBeenCalled();
  });

  it("hides the switch from regular users even when the callback is provided", async () => {
    renderModal({ onSwitchToManual: jest.fn() });
    await screen.findByText("הזמנה ואישור הגעה");
    expect(screen.queryByText("תצוגת אדמין: מעבר לשליחה ידנית")).not.toBeInTheDocument();
  });
});

describe("ScheduledMessagingModal - QA reset (admins only)", () => {
  it("hides the reset tool from regular users", async () => {
    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");
    expect(screen.queryByRole("button", { name: "איפוס תזמון (QA)" })).not.toBeInTheDocument();
  });

  it("lets an admin wipe the schedule and guest markers for a fresh re-test", async () => {
    mockIsAdmin = true;
    mockHttp.getMessageSchedule.mockResolvedValue([sentRsvpRound]);
    jest.spyOn(window, "confirm").mockReturnValue(true);

    renderModal();
    await screen.findByText("נשלח"); // locked, sent round loaded

    fireEvent.click(screen.getByRole("button", { name: "איפוס תזמון (QA)" }));

    await waitFor(() => expect(mockHttp.resetMessageSchedule).toHaveBeenCalledWith(1, true));
    // The schedule and guests are reloaded after the reset
    await waitFor(() => expect(mockHttp.getMessageSchedule).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(mockHttp.getEventGuests).toHaveBeenCalledWith(1));
  });

  it("does nothing when the admin cancels the confirmation", async () => {
    mockIsAdmin = true;
    jest.spyOn(window, "confirm").mockReturnValue(false);

    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");
    fireEvent.click(screen.getByRole("button", { name: "איפוס תזמון (QA)" }));

    expect(mockHttp.resetMessageSchedule).not.toHaveBeenCalled();
  });
});

describe("ScheduledMessagingModal - guests added after the invitation round", () => {
  it("offers to invite late-added guests once the invitation round was sent", async () => {
    mockHttp.getMessageSchedule.mockResolvedValue([sentRsvpRound]);
    mockHttp.getEventGuests.mockResolvedValue([...eventGuests, lateGuest]);
    renderModal({ eventGuests: [...eventGuests, lateGuest] });
    await screen.findByText("אורחים שנוספו אחרי שליחת ההזמנה");

    expect(screen.getByText(/Late Guest/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /שליחת ההזמנה ל-1 אורחים חדשים/ }));
    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));

    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith({
        eventId: 1,
        unsentOnly: true,
      })
    );
    await waitFor(() => expect(mockHttp.getEventGuests).toHaveBeenCalledWith(1));
  });

  it("hides the section while the invitation round hasn't been sent yet", async () => {
    mockHttp.getMessageSchedule.mockResolvedValue([]);
    mockHttp.getEventGuests.mockResolvedValue([...eventGuests, lateGuest]);
    renderModal({ eventGuests: [...eventGuests, lateGuest] });
    await screen.findByText("הזמנה ואישור הגעה");

    expect(screen.queryByText("אורחים שנוספו אחרי שליחת ההזמנה")).not.toBeInTheDocument();
  });

  it("hides the section when every guest already got a message", async () => {
    mockHttp.getMessageSchedule.mockResolvedValue([sentRsvpRound]);
    renderModal();
    await screen.findByText("הזמנה ואישור הגעה");

    expect(screen.queryByText("אורחים שנוספו אחרי שליחת ההזמנה")).not.toBeInTheDocument();
  });
});
