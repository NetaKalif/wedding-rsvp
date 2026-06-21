import React, { useState } from "react";
import {
  SidePanel,
  Box,
  RadioGroup,
  InputArea,
  Text,
  Loader,
  Button,
  FormField,
  Checkbox,
} from "@wix/design-system";
import { Event, EventGuest, User } from "../../types";
import { httpRequests } from "../../httpClient";
import WhatsAppPreview from "./WhatsAppPreview";
import "./css/WhatsAppMessage.css";

interface MessageGroupsModalProps {
  setIsMessageGroupsModalOpen: (value: boolean) => void;
  userID: User["userID"];
  eventId: number;
  eventGuests: EventGuest[];
  event: Event;
}

export type MessageType =
  | "rsvp"
  | "rsvpReminder"
  | "freeText"
  | "weddingReminder"
  | "thankYou";

const MessageGroupsModal: React.FC<MessageGroupsModalProps> = ({
  setIsMessageGroupsModalOpen,
  userID,
  eventId,
  eventGuests,
  event,
}) => {
  const imageUrl = event.file_id
    ? httpRequests.getEventImageUrl(event.id)
    : httpRequests.getPrimaryImageUrl(userID);

  const [messageType, setMessageType] = useState<MessageType>("rsvp");
  const [customText, setCustomText] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [selectSpecificGuests, setSelectSpecificGuests] = useState(false);
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

  const toggleGuestSelection = (guestId: number) => {
    setSelectedGuestIds((prev) => {
      const next = new Set(prev);
      if (next.has(guestId)) {
        next.delete(guestId);
      } else {
        next.add(guestId);
      }
      return next;
    });
  };

  const handleSend = () => {
    if (messageType === "freeText" && (!customText || customText.trim() === "")) return;

    const guestIds =
      selectSpecificGuests && selectedGuestIds.size > 0
        ? Array.from(selectedGuestIds)
        : undefined;

    setIsSending(true);
    httpRequests
      .sendMessage(userID, {
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

  const targetGuestCount = (() => {
    if (messageType === "rsvpReminder") {
      return eventGuests.filter((g) => g.rsvp_status == null).length;
    }
    if (messageType === "weddingReminder") {
      return eventGuests.filter((g) => g.rsvp_status != null && g.rsvp_status > 0).length;
    }
    return eventGuests.length;
  })();

  const emptyGroupMessage = (() => {
    if (selectSpecificGuests || targetGuestCount > 0) return null;
    if (messageType === "rsvpReminder") return "אין אורחים שממתינים לתגובה";
    if (messageType === "weddingReminder") return "אין אורחים שאישרו הגעה";
    return "אין אורחים לשליחה";
  })();

  const isSendDisabled =
    isSending ||
    (messageType === "freeText" && (!customText || customText.trim() === "")) ||
    (selectSpecificGuests && selectedGuestIds.size === 0) ||
    (!selectSpecificGuests && targetGuestCount === 0);

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
      height={"auto"}
    >
      <SidePanel.Header title="שליחת הודעות" />
      <SidePanel.Content>
        {messageResults ? (
          renderResponseMessage()
        ) : (
          <Box direction="vertical" gap={3}>
            <RadioGroup
              value={messageType}
              onChange={(value) => setMessageType(value as MessageType)}
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

              {isPrimaryEvent && (
                <RadioGroup.Radio value="weddingReminder">
                  <Box direction="vertical" gap={1}>
                    <Text weight="bold">תזכורת לחתונה</Text>
                    <Text size="small" secondary>
                      שליחת תזכורת לאורחים שאישרו ב
                      {event.reminder_day === "wedding_day"
                        ? "יום החתונה"
                        : "יום לפני החתונה"}
                      {event.reminder_time ? ` בשעה ${event.reminder_time}` : ""}
                    </Text>
                  </Box>
                </RadioGroup.Radio>
              )}

              <RadioGroup.Radio value="freeText">
                <Box direction="vertical" gap={1}>
                  <Text weight="bold">הודעה מותאמת אישית</Text>
                  <Text size="small" secondary>
                    שליחת טקסט חופשי לאורחים
                  </Text>
                </Box>
              </RadioGroup.Radio>

              {isPrimaryEvent && (
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

            {messageType === "freeText" && (
              <Box direction="vertical" gap={2}>
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

            <Box direction="vertical" gap={2}>
              <Checkbox
                checked={selectSpecificGuests}
                onChange={() => {
                  setSelectSpecificGuests((v) => !v);
                  setSelectedGuestIds(new Set());
                }}
              >
                <Text>בחירת אורחים ספציפיים לשליחה</Text>
              </Checkbox>

              {selectSpecificGuests && (
                <FormField label="בחרו אורחים">
                  <Box direction="vertical" gap={1} style={{ maxHeight: 200, overflowY: "auto" }}>
                    {eventGuests.map((guest) => (
                      <Checkbox
                        key={guest.guest_id}
                        checked={selectedGuestIds.has(guest.guest_id)}
                        onChange={() => toggleGuestSelection(guest.guest_id)}
                      >
                        {guest.name} {guest.phone ? `(${guest.phone})` : ""}
                      </Checkbox>
                    ))}
                  </Box>
                  {selectedGuestIds.size > 0 && (
                    <Text size="small" secondary>
                      נבחרו {selectedGuestIds.size} אורחים
                    </Text>
                  )}
                </FormField>
              )}
            </Box>

            {emptyGroupMessage && (
              <Text size="small" secondary skin="error">
                ⚠️ {emptyGroupMessage}
              </Text>
            )}

            <Button
              onClick={handleSend}
              disabled={isSendDisabled}
              fullWidth
            >
              {isSending ? <Loader size="tiny" /> : "שליחת הודעות"}
            </Button>

            <WhatsAppPreview
              event={event}
              imageUrl={imageUrl}
              isCollapsible={true}
              showAllMessages={false}
              messageType={messageType}
              customText={customText}
            />
          </Box>
        )}
      </SidePanel.Content>
    </SidePanel>
  );
};

export default MessageGroupsModal;
