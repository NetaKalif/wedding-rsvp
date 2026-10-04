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
    getEventGuests: jest.fn(() => Promise.resolve([])),
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

// Invitation-complete (photo, names, date, location) — the invitation send is
// blocked while any of that is missing, so the default fixture has it all.
const event: Event = {
  id: 1,
  user_id: "user-1",
  is_primary: true,
  ceremony_name: "חתונה",
  date: "2027-06-01",
  location: "גן האירועים",
  file_id: "media-1",
  bride_name: "כלה",
  groom_name: "חתן",
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
  // The targeted-sends panel refreshes guests on mount
  (httpRequests.getEventGuests as jest.Mock).mockResolvedValue([]);
});

// The modal checks messaging permission on mount, so its real content only
// appears after that async call resolves — always await the first element.
// It also refreshes the guest list from the server on mount — keep the mock
// consistent with the prop so the refresh doesn't wipe the fixture.
const renderModal = async (
  props: Partial<React.ComponentProps<typeof MessageGroupsModal>> = {},
) => {
  (httpRequests.getEventGuests as jest.Mock).mockResolvedValue(props.eventGuests ?? eventGuests);
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

// The send button opens a confirmation popup; the actual send happens on its
// "שליחה" button.
const clickSendAndConfirm = () => {
  fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
  fireEvent.click(screen.getByRole("button", { name: "שליחה" }));
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

  it("filters the picker by RSVP status", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("סטטוס אישור הגעה"));
    fireEvent.click(screen.getByText("מאושר"));

    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Pending Guest/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Declined Guest/)).not.toBeInTheDocument();
  });

  it("combines multiple RSVP statuses in the picker filter", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("סטטוס אישור הגעה"));
    fireEvent.click(screen.getByText("ממתין"));
    fireEvent.click(screen.getByText("סירוב"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
    expect(screen.queryByText(/Confirmed Guest/)).not.toBeInTheDocument();
  });

  it("restores the full picker list when RSVP status filters are cleared", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/סינון/));
    fireEvent.click(screen.getByText("סטטוס אישור הגעה"));
    fireEvent.click(screen.getByText("מאושר"));
    expect(screen.queryByText(/Pending Guest/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("נקה מסננים"));

    expect(screen.getByText(/Pending Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Confirmed Guest/)).toBeInTheDocument();
    expect(screen.getByText(/Declined Guest/)).toBeInTheDocument();
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
    clickSendAndConfirm();

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

describe("MessageGroupsModal - send confirmation popup", () => {
  it("shows a confirmation with the number of messages about to be sent instead of sending immediately", async () => {
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    // All 3 guests have a phone → 3 messages
    expect(screen.getByText("3 הודעות עומדות להישלח. האם להמשיך?")).toBeInTheDocument();
    expect(mockHttp.sendMessage).not.toHaveBeenCalled();
  });

  it("counts only the target group of the selected message type", async () => {
    await renderModal();

    // Only one guest is still pending
    fireEvent.click(screen.getByText("שליחה חוזרת לממתינים"));
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    expect(screen.getByText("הודעה אחת עומדת להישלח. האם להמשיך?")).toBeInTheDocument();
  });

  it("counts the picked guests when specific guests are selected", async () => {
    await renderModal();

    fireEvent.click(screen.getByText("בחירת אורחים ספציפיים לשליחה"));
    fireEvent.click(screen.getByText(/Pending Guest/));
    fireEvent.click(screen.getByText(/Confirmed Guest/));
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));

    expect(screen.getByText("2 הודעות עומדות להישלח. האם להמשיך?")).toBeInTheDocument();
  });

  it("sends only after the confirmation is approved", async () => {
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
    expect(mockHttp.sendMessage).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));

    await screen.findByText(/הודעות נשלחו בהצלחה/);
    expect(mockHttp.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("does not send when the confirmation is cancelled", async () => {
    await renderModal();

    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
    fireEvent.click(screen.getByRole("button", { name: "ביטול" }));

    await waitFor(() =>
      expect(screen.queryByText(/עומדות להישלח/)).not.toBeInTheDocument(),
    );
    expect(mockHttp.sendMessage).not.toHaveBeenCalled();
    // The form is still there for another attempt
    expect(screen.getByText("הזמנה לאישור הגעה")).toBeInTheDocument();
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
    clickSendAndConfirm();

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
    clickSendAndConfirm();

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
    clickSendAndConfirm();
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
    clickSendAndConfirm();

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

describe("MessageGroupsModal - invitation sub-targets (all / new guests / failed)", () => {
  const sentGuests: EventGuest[] = [
    { guest_id: 1, event_id: 1, name: "Sent Guest", phone: "111", rsvp_status: null, last_message_type: "rsvp" },
    {
      guest_id: 2,
      event_id: 1,
      name: "Failed Guest",
      phone: "222",
      rsvp_status: null,
      last_message_type: "rsvp",
      last_send_error: "המספר אינו רשום בוואטסאפ",
    },
    { guest_id: 3, event_id: 1, name: "Late Guest", phone: "333", rsvp_status: null },
  ];

  it("shows the three sub-targets under the invitation option, defaulting to everyone", async () => {
    await renderModal({ eventGuests: sentGuests });

    expect(screen.getByText("שליחה לכל האורחים")).toBeInTheDocument();
    expect(screen.getByText("אורחים חדשים שטרם קיבלו הזמנה (1)")).toBeInTheDocument();
    expect(screen.getByText("אורחים שההזמנה לא נמסרה אליהם (1)")).toBeInTheDocument();

    // Default is the regular send to everyone
    clickSendAndConfirm();
    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: "rsvp" })
      )
    );
  });

  it("hides the sub-targets when another message type is selected", async () => {
    await renderModal({ eventGuests: sentGuests });

    fireEvent.click(screen.getByText("שליחה חוזרת לממתינים"));

    expect(screen.queryByText("שליחה לכל האורחים")).not.toBeInTheDocument();
    expect(screen.queryByText(/אורחים חדשים שטרם קיבלו הזמנה/)).not.toBeInTheDocument();
  });

  it("hides the sub-targets entirely before anything was ever sent", async () => {
    await renderModal(); // default fixtures: no sends, no errors

    // No empty categories → no sub-options at all, just the regular send
    expect(screen.queryByText("שליחה לכל האורחים")).not.toBeInTheDocument();
    expect(screen.queryByText(/אורחים חדשים שטרם קיבלו הזמנה/)).not.toBeInTheDocument();
    expect(screen.queryByText(/אורחים שההזמנה לא נמסרה אליהם/)).not.toBeInTheDocument();

    clickSendAndConfirm();
    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: "rsvp" })
      )
    );
  });

  it("hides only the empty category when the other has guests", async () => {
    // Everyone got a message, one delivery failed — no late-added guests
    const failedOnlyGuests = sentGuests.filter((g) => g.guest_id !== 3);
    await renderModal({ eventGuests: failedOnlyGuests });

    expect(screen.getByText("שליחה לכל האורחים")).toBeInTheDocument();
    expect(screen.getByText("אורחים שההזמנה לא נמסרה אליהם (1)")).toBeInTheDocument();
    expect(screen.queryByText(/אורחים חדשים שטרם קיבלו הזמנה/)).not.toBeInTheDocument();
  });

  it("resends the invitation to failed guests only via the failed sub-target", async () => {
    await renderModal({ eventGuests: sentGuests });

    fireEvent.click(screen.getByText("אורחים שההזמנה לא נמסרה אליהם (1)"));

    // The exact guest set is fixed — no specific-guests picker
    expect(screen.queryByText("בחירת אורחים ספציפיים לשליחה")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
    // The confirmation reflects the one failed guest
    expect(screen.getByText("הודעה אחת עומדת להישלח. האם להמשיך?")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "שליחה" }));

    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith({ eventId: 1, failedOnly: true })
    );
  });

  it("sends the invitation to late-added guests via the new-guests sub-target", async () => {
    await renderModal({ eventGuests: sentGuests });

    fireEvent.click(screen.getByText("אורחים חדשים שטרם קיבלו הזמנה (1)"));
    clickSendAndConfirm();

    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith({ eventId: 1, unsentOnly: true })
    );
  });

  it("shows the sending progress view for a targeted send, like a regular send", async () => {
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

    await renderModal({ eventGuests: sentGuests });
    fireEvent.click(screen.getByText("אורחים שההזמנה לא נמסרה אליהם (1)"));
    clickSendAndConfirm();

    expect(await screen.findByText("📨 שולח הודעות לאורחים...")).toBeInTheDocument();
    expect(await screen.findByText("1 / 1 הודעות נשלחו", {}, { timeout: 2500 })).toBeInTheDocument();

    resolveSend({ success: 1, fail: 0, failGuestsList: [] });
    expect(await screen.findByText(/הודעות נשלחו בהצלחה/)).toBeInTheDocument();
  });

  it("sub-targets appear from the server fetch even when the cached guest list is stale", async () => {
    // The prop list knows nothing of the failure — it was stamped server-side
    (httpRequests.getEventGuests as jest.Mock).mockResolvedValue(sentGuests);
    render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );
    await screen.findByText("הזמנה לאישור הגעה");

    expect(await screen.findByText("אורחים שההזמנה לא נמסרה אליהם (1)")).toBeInTheDocument();
    expect(screen.getByText("אורחים חדשים שטרם קיבלו הזמנה (1)")).toBeInTheDocument();
  });

  it("falls back to the regular send when the selected target's guests disappear", async () => {
    (httpRequests.getEventGuests as jest.Mock).mockResolvedValue(sentGuests);
    const { rerender } = render(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={sentGuests}
        event={event}
      />
    );
    await screen.findByText("הזמנה לאישור הגעה");

    fireEvent.click(screen.getByText("אורחים שההזמנה לא נמסרה אליהם (1)"));
    // Targeted send selected — the specific-guests picker is hidden
    expect(screen.queryByText("בחירת אורחים ספציפיים לשליחה")).not.toBeInTheDocument();

    // A refresh clears the failures (e.g. they were resent successfully)
    rerender(
      <MessageGroupsModal
        setIsMessageGroupsModalOpen={jest.fn()}
        eventId={1}
        eventGuests={eventGuests}
        event={event}
      />
    );

    // Back on the regular send: sub-options gone, picker offered again
    await screen.findByText("בחירת אורחים ספציפיים לשליחה");
    expect(screen.queryByText(/אורחים שההזמנה לא נמסרה אליהם/)).not.toBeInTheDocument();
  });

  it("the (i) icon opens a popup listing the category's guests without switching the target", async () => {
    await renderModal({ eventGuests: sentGuests });

    fireEvent.click(screen.getByLabelText("מי האורחים שההזמנה לא נמסרה אליהם?"));

    expect(screen.getByText("Failed Guest (222)")).toBeInTheDocument();
    expect(screen.getByText("המספר אינו רשום בוואטסאפ")).toBeInTheDocument();
    // The target was not switched — the regular send's picker is still offered
    expect(screen.getByText("בחירת אורחים ספציפיים לשליחה")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "סגירה" }));
    expect(screen.queryByText("Failed Guest (222)")).not.toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("מי האורחים החדשים?"));
    expect(screen.getByText("Late Guest (333)")).toBeInTheDocument();
  });
});

describe("MessageGroupsModal - invitation completeness gate", () => {
  it("blocks the invitation send and lists what's missing when the photo is absent", async () => {
    await renderModal({ event: { ...event, file_id: undefined } });

    expect(screen.getByText("לפני ששולחים — חסרים פרטים")).toBeInTheDocument();
    expect(screen.getByText("• תמונת ההזמנה")).toBeInTheDocument();
    // The Wix Button exposes disabled via aria-disabled, not the native attribute
    expect(screen.getByRole("button", { name: "שליחת הודעות" })).toHaveAttribute(
      "aria-disabled",
      "true"
    );

    // Clicking the disabled button must not open the send confirmation
    fireEvent.click(screen.getByRole("button", { name: "שליחת הודעות" }));
    expect(screen.queryByText(/עומדות להישלח|עומדת להישלח/)).not.toBeInTheDocument();
    expect(mockHttp.sendMessage).not.toHaveBeenCalled();
  });

  it("lists every missing invitation field", async () => {
    await renderModal({
      event: { ...event, file_id: undefined, bride_name: "", date: undefined, location: undefined },
    });

    expect(screen.getByText("• תמונת ההזמנה")).toBeInTheDocument();
    expect(screen.getByText("• שמות בני הזוג")).toBeInTheDocument();
    expect(screen.getByText("• תאריך האירוע")).toBeInTheDocument();
    expect(screen.getByText("• מיקום האירוע")).toBeInTheDocument();
  });

  it("only gates the invitation — the pending reminder can still be sent", async () => {
    await renderModal({ event: { ...event, file_id: undefined } });

    fireEvent.click(screen.getByText("שליחה חוזרת לממתינים"));

    expect(screen.queryByText("לפני ששולחים — חסרים פרטים")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "שליחת הודעות" })).not.toBeDisabled();

    clickSendAndConfirm();
    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: "rsvpReminder" })
      )
    );
  });

  it("sends the invitation when all content is present", async () => {
    await renderModal();

    expect(screen.queryByText("לפני ששולחים — חסרים פרטים")).not.toBeInTheDocument();
    clickSendAndConfirm();

    await waitFor(() =>
      expect(mockHttp.sendMessage).toHaveBeenCalledWith(
        expect.objectContaining({ messageType: "rsvp" })
      )
    );
  });
});

describe("MessageGroupsModal - admin view switch", () => {
  it("lets an admin switch back to the scheduling modal", async () => {
    mockUseAuth.mockReturnValue({ ...mockAuthValue, isAdmin: true });
    const onSwitchToScheduled = jest.fn();
    await renderModal({ onSwitchToScheduled });

    fireEvent.click(screen.getByText("תצוגת אדמין: מעבר לתזמון (שלח וגמרנו)"));
    expect(onSwitchToScheduled).toHaveBeenCalled();
  });

  it("hides the switch from regular users even when the callback is provided", async () => {
    await renderModal({ onSwitchToScheduled: jest.fn() });
    expect(screen.queryByText("תצוגת אדמין: מעבר לתזמון (שלח וגמרנו)")).not.toBeInTheDocument();
  });
});
