import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  SidePanel,
  Box,
  RadioGroup,
  InputArea,
  Text,
  Loader,
  Button,
  Checkbox,
} from "@wix/design-system";
import { Event, EventGuest } from "../../types";
import { httpRequests } from "../../httpClient";
import { useAuth } from "../../hooks/useAuth";
import GuestPicker from "./GuestPicker";
import WhatsAppPreview from "./WhatsAppPreview";
import "./css/WhatsAppMessage.css";

interface MessageGroupsModalProps {
  setIsMessageGroupsModalOpen: (value: boolean) => void;
  eventId: number;
  eventGuests: EventGuest[];
  event: Event;
}

export type MessageType =
  | "rsvp"
  | "rsvpReminder"
  | "freeText"
  | "eventReminder"
  | "thankYou";

const MessageGroupsModal: React.FC<MessageGroupsModalProps> = ({
  setIsMessageGroupsModalOpen,
  eventId,
  eventGuests,
  event,
}) => {
  const { isAdmin } = useAuth();

  const [messagingPermission, setMessagingPermission] = useState<
    { status: string; hasPendingRequest: boolean } | null
  >(null);
  const [isLoadingPermission, setIsLoadingPermission] = useState(true);
  const [isRequestingPermission, setIsRequestingPermission] = useState(false);
  const [permissionRequestSent, setPermissionRequestSent] = useState(false);

  useEffect(() => {
    httpRequests
      .getMessagingPermissionStatus()
      .then(setMessagingPermission)
      .catch((error) => console.error("Failed to load messaging permission status:", error))
      .finally(() => setIsLoadingPermission(false));
  }, []);

  const handleRequestMessagingPermission = async () => {
    setIsRequestingPermission(true);
    try {
      await httpRequests.requestMessagingPermission();
      setMessagingPermission((prev) => (prev ? { ...prev, hasPendingRequest: true } : prev));
      setPermissionRequestSent(true);
    } catch (error) {
      console.error("Failed to request messaging permission:", error);
      alert("שליחת הבקשה נכשלה. אנא נסו שנית.");
    } finally {
      setIsRequestingPermission(false);
    }
  };

  const getImageUrl = useCallback(
    () =>
      event.file_id
        ? httpRequests.getEventImageUrl(event.id)
        : httpRequests.getPrimaryImageUrl(),
    [event.id, event.file_id]
  );

  const [messageType, setMessageType] = useState<MessageType>("rsvp");
  const [customText, setCustomText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectSpecificGuests, setSelectSpecificGuests] = useState(false);
  const sendButtonRef = useRef<HTMLDivElement>(null);

  // Opening the picker pushes the send button below the fold of the
  // scrollable panel content, so scroll it (and the picker above it) into view.
  useEffect(() => {
    if (selectSpecificGuests) {
      sendButtonRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }
  }, [selectSpecificGuests]);
  const [selectedGuestIds, setSelectedGuestIds] = useState<Set<number>>(new Set());
  const [messageResults, setMessageResults] = useState<
    | {
        success: number;
        fail: number;
        failGuestsList: { guestName: string; logMessage: string }[];
      }
    | undefined
  >(undefined);

  const isPrimaryEvent = event.is_primary;

  const handleSend = () => {
    if (messageType === "freeText" && (!customText || customText.trim() === "")) return;

    const guestIds =
      selectSpecificGuests && selectedGuestIds.size > 0
        ? Array.from(selectedGuestIds)
        : undefined;

    setIsSending(true);
    httpRequests
      .sendMessage({
        eventId,
        messageType,
        guestIds,
        customText: messageType === "freeText" ? customText : undefined,
      })
      .then((result) => {
        setMessageResults({
          success: result.success,
          fail: result.fail,
          failGuestsList: result.failGuestsList,
        });
      })
      .catch((err) => {
        console.error(err);
        alert("שליחת ההודעות נכשלה. אנא נסו שנית.");
      })
      .finally(() => setIsSending(false));
  };

  // Guests with no cellphone can't receive WhatsApp messages — exclude from picking/counting/sending.
  const sendableGuests = eventGuests.filter((g) => !!g.phone);

  const selectableGuests = (() => {
    if (messageType === "rsvpReminder") {
      return sendableGuests.filter((g) => g.rsvp_status == null);
    }
    if (messageType === "eventReminder") {
      return sendableGuests.filter((g) => g.rsvp_status != null && g.rsvp_status > 0);
    }
    return sendableGuests;
  })();

  const targetGuestCount = selectableGuests.length;

  const emptyGroupMessage = (() => {
    if (selectSpecificGuests || targetGuestCount > 0) return null;
    if (messageType === "rsvpReminder") return "אין אורחים שממתינים לתגובה";
    if (messageType === "eventReminder") return "אין אורחים שאישרו הגעה";
    return "אין אורחים לשליחה";
  })();

  const isSendDisabled =
    isSending ||
    (messageType === "freeText" && (!customText || customText.trim() === "")) ||
    (selectSpecificGuests && selectedGuestIds.size === 0) ||
    (!selectSpecificGuests && targetGuestCount === 0);

  const canSendMessages = isAdmin || messagingPermission?.status === "approved";

  const renderPermissionRequest = () => (
    <Box direction="vertical" gap={3} padding="8px 0">
      {permissionRequestSent ? (
        <>
          <Text weight="bold">✅ הבקשה הועברה בהצלחה</Text>
          <Text secondary>
            הבקשה נשלחה למנהל. עדכון יישלח למייל ברגע שהבקשה תאושר.
          </Text>
          <Button priority="secondary" fullWidth onClick={() => setIsMessageGroupsModalOpen(false)}>
            סגירה
          </Button>
        </>
      ) : messagingPermission?.hasPendingRequest ? (
        <>
          <Text weight="bold">בקשתך ממתינה לאישור</Text>
          <Text secondary>
            בקשתך לשליחת הודעות נשלחה למנהל וממתינה לאישור. תקבלו מייל ברגע שהבקשה תאושר.
          </Text>
        </>
      ) : (
        <>
          <Text weight="bold">נדרשת הרשאה לשליחת הודעות</Text>
          <Text secondary>
            שליחת הודעות לאורחים כרוכה בעלות, ולכן נדרש אישור מנהל. לחצו על הכפתור כדי לשלוח בקשה — תקבלו מייל ברגע שהבקשה תאושר.
          </Text>
          <Button
            onClick={handleRequestMessagingPermission}
            disabled={isRequestingPermission}
            fullWidth
          >
            {isRequestingPermission ? <Loader size="tiny" /> : "בקשת הרשאה"}
          </Button>
        </>
      )}
    </Box>
  );

  const renderResponseMessage = () => {
    if (messageResults) {
      return (
        <Box direction="vertical" gap={2}>
          <Text>✅: {messageResults.success} הודעות נשלחו בהצלחה</Text>
          <Text>❌: {messageResults.fail} הודעות נכשלו</Text>
          {messageResults.failGuestsList.length > 0 && (
            <>
              <Text>אורחים שנכשלו:</Text>
              {messageResults.failGuestsList.map((guest) => (
                <Text key={guest.guestName}>
                  {guest.guestName}: {guest.logMessage}
                </Text>
              ))}
            </>
          )}
        </Box>
      );
    }
    return null;
  };

  return (
    <SidePanel
      skin="floating"
      onCloseButtonClick={() => setIsMessageGroupsModalOpen(false)}
      height="auto"
      maxHeight="85vh"
    >
      <SidePanel.Header title="שליחת הודעות" />
      <SidePanel.Content>
        {isLoadingPermission ? (
          <Box align="center" padding="24px 0">
            <Loader size="small" />
          </Box>
        ) : !canSendMessages ? (
          renderPermissionRequest()
        ) : messageResults ? (
          renderResponseMessage()
        ) : (
          <Box direction="vertical" gap={3}>
            <Box direction="vertical" gap={2} flexShrink={0}>
              <div data-tour="message-types">
              <RadioGroup
              value={messageType}
              onChange={(value) => {
                setMessageType(value as MessageType);
                setSelectedGuestIds(new Set());
              }}
            >
              <RadioGroup.Radio value="rsvp">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">הזמנה לאישור הגעה</Text>
                  <Text size="small" secondary>
                    שליחת הזמנה ראשונית עם כפתורי אישור הגעה
                  </Text>
                </Box>
              </RadioGroup.Radio>

              <RadioGroup.Radio value="rsvpReminder">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">שליחה חוזרת לממתינים</Text>
                  <Text size="small" secondary>
                    שליחת תזכורת רק לאורחים שעדיין לא הגיבו
                  </Text>
                </Box>
              </RadioGroup.Radio>

              {isAdmin && (
                <RadioGroup.Radio value="eventReminder">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">
                      {isPrimaryEvent ? "תזכורת לחתונה" : "תזכורת לאירוע"}
                    </Text>
                    <Text size="small" secondary>
                      {isPrimaryEvent ? (
                        <>
                          שליחת תזכורת לאורחים שאישרו ב
                          {event.reminder_day === "wedding_day"
                            ? "יום החתונה"
                            : "יום לפני החתונה"}
                          {event.reminder_time ? ` בשעה ${event.reminder_time}` : ""}
                        </>
                      ) : (
                        "שליחת תזכורת לאורחים שאישרו ביום האירוע"
                      )}
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              {isAdmin && (
                <RadioGroup.Radio value="freeText">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">הודעה מותאמת אישית</Text>
                    <Text size="small" secondary>
                      שליחת טקסט חופשי לאורחים
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              {isAdmin && isPrimaryEvent && (
                <RadioGroup.Radio value="thankYou">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">הודעת תודה</Text>
                    <Text size="small" secondary>
                      שליחת הודעת תודה לאורחים שהגיעו
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}
            </RadioGroup>
              </div>
          </Box>

            {isAdmin && messageType === "freeText" && (
              <Box direction="vertical" gap={2} flexShrink={0}>
                <Text weight="bold">הודעה מותאמת אישית:</Text>
                <InputArea
                  placeholder="הכניסו את ההודעה שלכם כאן..."
                  value={customText}
                  onChange={(e) => setCustomText(e.target.value)}
                  rows={5}
                />
                {(!customText || customText.trim() === "") && (
                  <Text size="small" secondary skin="error">
                    ⚠️ אנא הכניסו הודעה לפני השליחה
                  </Text>
                )}
              </Box>
            )}

            <Box direction="vertical" gap={2} flexShrink={0}>
              <div data-tour="select-specific-guests">
                <Checkbox
                  checked={selectSpecificGuests}
                  onChange={() => {
                    setSelectSpecificGuests((v) => !v);
                    setSelectedGuestIds(new Set());
                  }}
                >
                  <Text>בחירת אורחים ספציפיים לשליחה</Text>
                </Checkbox>
              </div>
            </Box>

              {selectSpecificGuests && (
                <GuestPicker
                  key={messageType}
                  guests={selectableGuests}
                  selectedGuestIds={selectedGuestIds}
                  onSelectionChange={setSelectedGuestIds}
                />
              )}

            <Box direction="vertical" gap={3} flexShrink={0}>
              {emptyGroupMessage && (
                <Text size="small" secondary skin="error">
                  ⚠️ {emptyGroupMessage}
                </Text>
              )}

              <div ref={sendButtonRef}>
                <Button
                  onClick={handleSend}
                  disabled={isSendDisabled}
                  fullWidth
                >
                  {isSending ? <Loader size="tiny" /> : "שליחת הודעות"}
                </Button>
              </div>

              <div data-tour="whatsapp-preview">
                <WhatsAppPreview
                  event={event}
                  getImageUrl={getImageUrl}
                  isCollapsible={true}
                  showAllMessages={false}
                  messageType={messageType}
                  customText={customText}
                />
              </div>
            </Box>
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default MessageGroupsModal;
