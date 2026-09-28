import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import MessageGroupsModal from "./MessageGroupsModal";
import { Event, EventGuest } from "../../types";
import * as useAuthModule from "../../hooks/useAuth";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    sendMessage: jest.fn(() =>
      Promise.resolve({ success: 0, fail: 0, failGuestsList: [] })
    ),
    getSendProgress: jest.fn(() => Promise.resolve({ active: false })),
    getEventImageUrl: jest.fn(() => Promise.resolve("")),
    getPrimaryImageUrl: jest.fn(() => Promise.resolve("")),
    getMessagingPermissionStatus: jest.fn(() =>
      Promise.resolve({ status: "approved", hasPendingRequest: false })
    ),
    requestMessagingPermission: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

jest.mock("../../hooks/useAuth");

// jsdom doesn't implement scrollIntoView — stub it so the picker's
// scroll-into-view effect doesn't crash, and so tests can assert on it.
const scrollIntoViewMock = jest.fn();
window.HTMLElement.prototype.scrollIntoView = scrollIntoViewMock;

const mockUseAuth = useAuthModule.useAuth as jest.MockedFunction<typeof useAuthModule.useAuth>;
const mockHttp = httpRequests as unknown as {
  getMessagingPermissionStatus: jest.Mock;
  requestMessagingPermission: jest.Mock;
  sendMessage: jest.Mock;
  getSendProgress: jest.Mock;
};

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

const mockAuthValue = {
  user: undefined,
  partnerInfo: undefined,
  weddingInfo: null,
  weddingInfoError: false,
  isAdmin: false,
  isLoading: false,
  pendingApproval: false,
  handleLoginSuccess: jest.fn(),
  handleLogout: jest.fn(),
  switchUser: jest.fn(),
  refreshPartnerInfo: jest.fn(),
  refreshWeddingInfo: jest.fn(),
};

beforeEach(() => {
  jest.clearAllMocks();
  mockUseAuth.mockReturnValue(mockAuthValue);
  mockHttp.getMessagingPermissionStatus.mockResolvedValue({
    status: "approved",
    hasPendingRequest: false,
  });
  mockHttp.requestMessagingPermission.mockResolvedValue({ success: true });
  mockHttp.sendMessage.mockResolvedValue({ success: 0, fail: 0, failGuestsList: [] });
  mockHttp.getSendProgress.mockResolvedValue({ active: false });
});

// The modal checks messaging permission on mount, so its real content only
// appears after that async call resolves — always await the first element.
const renderModal = async (
  props: Partial<React.ComponentProps<typeof MessageGroupsModal>> = {},
) => {
  render(
    <MessageGroupsModal
      setIsMessageGroupsModalOpen={jest.fn()}
      eventId={1}
      eventGuests={eventGuests}
      event={event}
      {...props}
    />
  );
  await screen.findByText("הזמנה לאישור הגעה");
};

describe("MessageGroupsModal - specific guest picker", () => {
  it("only lists guests who have not RSVP'd when resend-to-pending and select-specific-guests are both chosen", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("שליחה חוזרת לממתינים"));
    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("only lists confirmed guests when thank-you and select-specific-guests are both chosen", async () => {
    mockUseAuth.mockReturnValue({ ...mockAuthValue, isAdmin: true });
    await renderModal();

    fireEvent.click(screen.getByText("הודעת תודה"));
    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("lists all guests when the default invite option is selected with specific guests", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
  });

  it("filters the picker by search term", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם..."), {
      target: { value: "Confirmed" },
    });

    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("filters the picker by the whose filter", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("מוזמן ע״י"));
    fireEvent.click(screen.getByText("כלה"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
  });

  it("excludes guests without a phone from the picker and from select-all", async () => {
    const guestsWithNoPhone: EventGuest[] = [
      ...eventGuests,
      { guest_id: 4, event_id: 1, name: "No Phone Guest", phone: null, rsvp_status: null, whose: "כלה", circle: "משפחה" },
    ];

    await renderModal({ eventGuests: guestsWithNoPhone });

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(screen.queryByText(/No Phone Guest/)).not.toBeInTheDocument();
    expect(screen.getByText("בחר הכל (3)")).toBeInTheDocument();

    fireEvent.click(screen.getByText(/בחר הכל/));
    expect(screen.getByText("נבחרו 3 אורחים")).toBeInTheDocument();
  });

  it("renders the guest list in a height-capped scrollable container", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    const list = document.querySelector('[data-hook="guest-picker-list"]') as HTMLElement;
    expect(list).toBeInTheDocument();
    expect(list.style.overflowY).toBe("auto");
    expect(list.style.maxHeight).toBe("40vh");
    // The guests themselves must live inside the scrollable container
    expect(list).toContainElement(screen.getByText(/Pending Guest/));
  });

  it("scrolls the send button into view when specific-guest selection is turned on", async () => {
    await renderModal();
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));

    expect(scrollIntoViewMock).toHaveBeenCalled();
    const scrolledElement = scrollIntoViewMock.mock.instances[0] as unknown as HTMLElement;
    expect(scrolledElement).toContainElement(
      screen.getByRole("button", { name: "שליחת הודעות" })
    );
  });

  it("selects all currently-filtered guests via the select-all checkbox", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.change(screen.getByPlaceholderText("חיפוש לפי שם..."), {
      target: { value: "Guest" },
    });
    fireEvent.click(screen.getByText(/בחר הכל/));

    expect(screen.getByText("נבחרו 3 אורחים")).toBeInTheDocument();
  });
});

describe("MessageGroupsModal - admin-only features", () => {
  it("only shows rsvp and rsvpReminder to non-admin users", async () => {
    await renderModal();

    expect(screen.getByText("הזמנה לאישור הגעה")).toBeInTheDocument();
    expect(screen.getByText("שליחה חוזרת לממתינים")).toBeInTheDocument();
    expect(screen.queryByText("תזכורת לחתונה")).not.toBeInTheDocument();
    expect(screen.queryByText("תזכורת לאירוע")).not.toBeInTheDocument();
    expect(screen.queryByText("הודעה מותאמת אישית")).not.toBeInTheDocument();
    expect(screen.queryByText("הודעת תודה")).not.toBeInTheDocument();
  });

  it("shows all message options to admin users", async () => {
    mockUseAuth.mockReturnValue({
      ...mockAuthValue,
      isAdmin: true,
    });

    await renderModal();

    expect(screen.getByText("הזמנה לאישור הגעה")).toBeInTheDocument();
    expect(screen.getByText("שליחה חוזרת לממתינים")).toBeInTheDocument();
    expect(screen.getByText("תזכורת לחתונה")).toBeInTheDocument();
    expect(screen.getByText("הודעה מותאמת אישית")).toBeInTheDocument();
    expect(screen.getByText("הודעת תודה")).toBeInTheDocument();
  });

  it("sends messageType eventReminder when the wedding reminder option is chosen on the primary event", async () => {
    mockUseAuth.mockReturnValue({
      ...mockAuthValue,
      isAdmin: true,
    });

    await renderModal();

    fireEvent.click(screen.getByText("תזכורת לחתונה"));
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    await screen.findByText(/הודעות נשלחו בהצלחה/);
    expect(mockHttp.sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ messageType: "eventReminder" })
    );
  });

  it("shows event reminder option for admin on non-primary events", async () => {
    mockUseAuth.mockReturnValue({
      ...mockAuthValue,
      isAdmin: true,
    });

    const nonPrimaryEvent: Event = { ...event, is_primary: false };

    await renderModal({ event: nonPrimaryEvent });

    expect(screen.getByText("תזכורת לאירוע")).toBeInTheDocument();
    expect(screen.queryByText("תזכורת לחתונה")).not.toBeInTheDocument();
    expect(screen.queryByText("הודעת תודה")).not.toBeInTheDocument();
  });
});

describe("MessageGroupsModal - send progress", () => {
  it("replaces the form with a progress view while sending and updates the counter from polling", async () => {
    let resolveSend!: (value: unknown) => void;
    mockHttp.sendMessage.mockReturnValue(new Promise((resolve) => (resolveSend = resolve)));
    mockHttp.getSendProgress.mockResolvedValue({
      active: true,
      total: 3,
      completed: 1,
      failed: 0,
      dispatchDone: false,
      deliveryFailures: [],
    });

    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    // Form is gone, progress view is up (before the first poll lands)
    expect(await screen.findByText("📨 שולח הודעות לאורחים...")).toBeInTheDocument();
    expect(screen.queryByText("הזמנה לאישור הגעה")).not.toBeInTheDocument();

    // First poll tick (1s interval) feeds the counter
    expect(await screen.findByText("1 / 3 הודעות נשלחו", {}, { timeout: 2500 })).toBeInTheDocument();

    resolveSend({ success: 3, fail: 0, failGuestsList: [] });

    // Results replace the progress view, still listening for delivery updates
    expect(await screen.findByText(/הודעות נשלחו בהצלחה/)).toBeInTheDocument();
    expect(screen.getByText("בודק עדכוני מסירה מוואטסאפ...")).toBeInTheDocument();
  });

  it("shows webhook-reported delivery failures that arrive after the send completes", async () => {
    mockHttp.sendMessage.mockResolvedValue({ success: 3, fail: 0, failGuestsList: [] });
    mockHttp.getSendProgress.mockResolvedValue({
      active: true,
      total: 3,
      completed: 3,
      failed: 0,
      dispatchDone: true,
      deliveryFailures: [
        { guestName: "Pending Guest", phone: "+972501111111", description: "כנראה שהמספר אינו רשום בוואטסאפ [error 131026]" },
      ],
    });

    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    await screen.findByText(/הודעות נשלחו בהצלחה/);

    // The 📵 failure lands on the next poll tick after the results are shown
    expect(await screen.findByText("📵 נשלחו אך לא נמסרו:", {}, { timeout: 2500 })).toBeInTheDocument();
    expect(screen.getByText(/Pending Guest.*אינו רשום בוואטסאפ/)).toBeInTheDocument();
    // Hint to verify the numbers, fix them, and re-send
    expect(screen.getByText(/מומלץ לבדוק אם המספרים/)).toBeInTheDocument();
  });

  it("copies the delivery-failures list to the clipboard", async () => {
    const writeTextMock = jest.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText: writeTextMock } });

    mockHttp.sendMessage.mockResolvedValue({ success: 3, fail: 0, failGuestsList: [] });
    mockHttp.getSendProgress.mockResolvedValue({
      active: true,
      total: 3,
      completed: 3,
      failed: 0,
      dispatchDone: true,
      deliveryFailures: [
        { guestName: "Pending Guest", phone: "+972501111111", description: "סיבה אחת" },
        { guestName: "Confirmed Guest", phone: "+972502222222", description: "סיבה שנייה" },
      ],
    });

    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
    await screen.findByText("📵 נשלחו אך לא נמסרו:", {}, { timeout: 2500 });

    fireEvent.click(screen.getByText("📋 העתקת הרשימה"));

    await waitFor(() =>
      expect(writeTextMock).toHaveBeenCalledWith(
        "Pending Guest (+972501111111): סיבה אחת\nConfirmed Guest (+972502222222): סיבה שנייה",
      ),
    );
    // Button gives visual feedback that the copy happened
    expect(await screen.findByText("✓ הרשימה הועתקה")).toBeInTheDocument();
  });

  it("stops listening for delivery updates once the server reports the job is over", async () => {
    mockHttp.sendMessage.mockResolvedValue({ success: 2, fail: 0, failGuestsList: [] });
    mockHttp.getSendProgress.mockResolvedValue({ active: false });

    await renderModal();
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    await screen.findByText(/הודעות נשלחו בהצלחה/);

    // The next poll returns active:false (grace window over) → indicator goes away
    await waitFor(
      () => expect(screen.queryByText("בודק עדכוני מסירה מוואטסאפ...")).not.toBeInTheDocument(),
      { timeout: 2500 },
    );
  });
});

describe("MessageGroupsModal - messaging permission gate", () => {
  const renderWithoutWaiting = () =>
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

  it("shows the permission-request screen instead of message options when permission is denied", async () => {
    mockHttp.getMessagingPermissionStatus.mockResolvedValue({
      status: "denied",
      hasPendingRequest: false,
    });

    renderWithoutWaiting();

    expect(await screen.findByText("נדרשת הרשאה לשליחת הודעות")).toBeInTheDocument();
    expect(screen.getByText("בקשת הרשאה")).toBeInTheDocument();
    expect(screen.queryByText("הזמנה לאישור הגעה")).not.toBeInTheDocument();
  });

  it("sends the request and shows a success confirmation", async () => {
    mockHttp.getMessagingPermissionStatus.mockResolvedValue({
      status: "denied",
      hasPendingRequest: false,
    });

    renderWithoutWaiting();

    fireEvent.click(await screen.findByText("בקשת הרשאה"));

    expect(await screen.findByText("✅ הבקשה הועברה בהצלחה")).toBeInTheDocument();
    expect(mockHttp.requestMessagingPermission).toHaveBeenCalledTimes(1);
  });

  it("shows the waiting state when a request is already pending", async () => {
    mockHttp.getMessagingPermissionStatus.mockResolvedValue({
      status: "denied",
      hasPendingRequest: true,
    });

    renderWithoutWaiting();

    expect(await screen.findByText("בקשתך ממתינה לאישור")).toBeInTheDocument();
    expect(screen.queryByText("בקשת הרשאה")).not.toBeInTheDocument();
    expect(screen.queryByText("הזמנה לאישור הגעה")).not.toBeInTheDocument();
  });

  it("admin bypasses the permission gate even without permission", async () => {
    mockUseAuth.mockReturnValue({
      ...mockAuthValue,
      isAdmin: true,
    });
    mockHttp.getMessagingPermissionStatus.mockResolvedValue({
      status: "denied",
      hasPendingRequest: false,
    });

    renderWithoutWaiting();

    expect(await screen.findByText("הזמנה לאישור הגעה")).toBeInTheDocument();
    expect(screen.queryByText("נדרשת הרשאה לשליחת הודעות")).not.toBeInTheDocument();
  });
});
