import React from "react";
import { render, screen, fireEvent } from "@testing-library/react";
import MessageGroupsModal from "./MessageGroupsModal";
import { Event, EventGuest } from "../../types";
import * as useAuthModule from "../../hooks/useAuth";
import { httpRequests } from "../../httpClient";

jest.mock("../../httpClient", () => ({
  httpRequests: {
    sendMessage: jest.fn(() =>
      Promise.resolve({ success: 0, fail: 0, failGuestsList: [] })
    ),
    getEventImageUrl: jest.fn(() => Promise.resolve("")),
    getPrimaryImageUrl: jest.fn(() => Promise.resolve("")),
    getMessagingPermissionStatus: jest.fn(() =>
      Promise.resolve({ status: "approved", hasPendingRequest: false })
    ),
    requestMessagingPermission: jest.fn(() => Promise.resolve({ success: true })),
  },
}));

jest.mock("../../hooks/useAuth");

const mockUseAuth = useAuthModule.useAuth as jest.MockedFunction<typeof useAuthModule.useAuth>;
const mockHttp = httpRequests as unknown as {
  getMessagingPermissionStatus: jest.Mock;
  requestMessagingPermission: jest.Mock;
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
